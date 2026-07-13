import json
import math
import os
import re
import time
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np


class VectorStoreError(Exception):
    pass


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    dot = float(np.dot(a, b))
    norm_a = float(np.linalg.norm(a))
    norm_b = float(np.linalg.norm(b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def default_storage_path() -> str:
    base = os.environ.get(
        "RAG_DATA_DIR",
        str(Path(__file__).parent.parent.parent / "app" / "rag-data"),
    )
    Path(base).mkdir(parents=True, exist_ok=True)
    return os.path.join(base, "vector_store.json")


class BM25Index:
    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.doc_freqs: Dict[str, int] = {}
        self.doc_lengths: List[int] = []
        self.doc_count = 0
        self.avg_doc_length = 0
        self.doc_chunks: List[str] = []
        self.chunk_ids: List[str] = []

    def tokenize(self, text: str) -> List[str]:
        return re.findall(r"\w+", text.lower())

    def add_document(self, chunk_id: str, text: str):
        tokens = self.tokenize(text)
        self.doc_chunks.append(text)
        self.chunk_ids.append(chunk_id)
        self.doc_lengths.append(len(tokens))
        seen = set(tokens)
        for token in seen:
            self.doc_freqs[token] = self.doc_freqs.get(token, 0) + 1
        self.doc_count += 1
        self.avg_doc_length = sum(self.doc_lengths) / len(self.doc_lengths)

    def search(self, query: str, top_k: int = 10) -> List[Tuple[str, float]]:
        query_tokens = self.tokenize(query)
        if not query_tokens or self.doc_count == 0:
            return []

        scores = []
        for idx, chunk_text in enumerate(self.doc_chunks):
            doc_tokens = self.tokenize(chunk_text)
            doc_len = len(doc_tokens)
            if doc_len == 0:
                scores.append(0)
                continue
            counter = Counter(doc_tokens)
            score = 0.0
            for token in query_tokens:
                if token not in self.doc_freqs:
                    continue
                idf = math.log(
                    (self.doc_count - self.doc_freqs[token] + 0.5)
                    / (self.doc_freqs[token] + 0.5)
                    + 1.0
                )
                tf = counter.get(token, 0)
                numerator = tf * (self.k1 + 1)
                denominator = tf + self.k1 * (
                    1 - self.b + self.b * doc_len / self.avg_doc_length
                )
                score += idf * (numerator / denominator)
            scores.append(score)

        indexed = list(enumerate(scores))
        indexed.sort(key=lambda x: x[1], reverse=True)
        return [
            (self.chunk_ids[idx], float(score))
            for idx, score in indexed[:top_k]
            if score > 0
        ]


class VectorStore:
    def __init__(self, storage_path: Optional[str] = None):
        self.storage_path = storage_path or default_storage_path()
        self.chunks: Dict[str, dict] = {}
        self.bm25 = BM25Index()
        self._load()

    def _load(self):
        if os.path.exists(self.storage_path):
            try:
                with open(self.storage_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                raw_chunks = data.get("chunks", {})
                loaded = 0
                for cid, entry in raw_chunks.items():
                    vec = np.array(entry.get("embedding", []), dtype=np.float32)
                    if vec.size == 0:
                        continue
                    self.chunks[cid] = {
                        "text": entry.get("text", ""),
                        "embedding": vec,
                        "metadata": entry.get("metadata", {}),
                    }
                    self.bm25.add_document(cid, entry.get("text", ""))
                    loaded += 1
            except (json.JSONDecodeError, KeyError, ValueError) as e:
                raise VectorStoreError(f"Failed to load vector store: {e}") from e

    def _save(self):
        serializable = {}
        for cid, entry in self.chunks.items():
            serializable[cid] = {
                "text": entry["text"],
                "embedding": entry["embedding"].tolist(),
                "metadata": entry["metadata"],
            }
        data = {"chunks": serializable}
        Path(self.storage_path).parent.mkdir(parents=True, exist_ok=True)
        with open(self.storage_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def add_chunk(
        self,
        chunk_id: str,
        text: str,
        embedding: np.ndarray,
        metadata: Optional[dict] = None,
    ):
        self.chunks[chunk_id] = {
            "text": text,
            "embedding": embedding.astype(np.float32),
            "metadata": metadata or {},
        }
        self.bm25.add_document(chunk_id, text)

    def remove_chunk(self, chunk_id: str) -> bool:
        if chunk_id in self.chunks:
            del self.chunks[chunk_id]
            return True
        return False

    def remove_document_chunks(self, document_id: str):
        to_remove = [
            cid
            for cid, entry in self.chunks.items()
            if entry.get("metadata", {}).get("document_id") == document_id
        ]
        for cid in to_remove:
            del self.chunks[cid]

    def vector_search(
        self, query_embedding: np.ndarray, top_k: int = 10
    ) -> List[Tuple[str, str, float]]:
        results = []
        for cid, entry in self.chunks.items():
            score = cosine_similarity(query_embedding, entry["embedding"])
            results.append((cid, entry["text"], score))
        results.sort(key=lambda x: x[2], reverse=True)
        return results[:top_k]

    def hybrid_search(
        self,
        query_text: str,
        query_embedding: np.ndarray,
        top_k: int = 10,
        alpha: float = 0.7,
    ) -> List[Tuple[str, str, float]]:
        vector_results = self.vector_search(query_embedding, top_k * 3)
        bm25_results = self.bm25.search(query_text, top_k * 3)

        vector_map = {cid: score for cid, _text, score in vector_results}
        bm25_map = dict(bm25_results)

        all_ids = set(vector_map.keys()) | set(bm25_map.keys())

        def minmax_normalize(score_map: dict) -> dict:
            values = [v for v in score_map.values() if v > 0]
            if not values:
                return score_map
            mn, mx = min(values), max(values)
            if mx == mn:
                return {k: 1.0 if v > 0 else 0.0 for k, v in score_map.items()}
            return {k: (v - mn) / (mx - mn) for k, v in score_map.items()}

        vector_norm = minmax_normalize(vector_map)
        bm25_norm = minmax_normalize(bm25_map)

        fused = []
        for cid in all_ids:
            v_score = vector_norm.get(cid, 0.0)
            b_score = bm25_norm.get(cid, 0.0)
            fused.append((cid, alpha * v_score + (1 - alpha) * v_score if True else 0))

        fused_results = []
        for cid in all_ids:
            text = self.chunks[cid]["text"]
            v_score = vector_norm.get(cid, 0.0)
            b_score = bm25_norm.get(cid, 0.0)
            combined = alpha * v_score + (1 - alpha) * b_score
            fused_results.append((cid, text, combined))

        fused_results.sort(key=lambda x: x[2], reverse=True)
        return fused_results[:top_k]

    def get_all_documents(self) -> List[dict]:
        seen = {}
        for cid, entry in self.chunks.items():
            meta = entry.get("metadata", {})
            doc_id = meta.get("document_id", "unknown")
            if doc_id not in seen:
                seen[doc_id] = {
                    "id": doc_id,
                    "filename": meta.get("filename", "unknown"),
                    "chunk_count": 0,
                    "created_at": meta.get("created_at", ""),
                }
            seen[doc_id]["chunk_count"] += 1
        return list(seen.values())

    def persist(self):
        self._save()

    def count_chunks(self) -> int:
        return len(self.chunks)
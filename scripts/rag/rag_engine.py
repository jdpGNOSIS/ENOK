import os
import time
import uuid
from pathlib import Path
from typing import List, Optional, Tuple

from .chunker import chunk_document
from .document_loader import load_document, get_document_metadata, DocumentLoadError
from .embeddings import EmbeddingModel, EmbeddingError, EMBEDDING_DIM
from .vector_store import VectorStore, VectorStoreError


class RAGEngineError(Exception):
    pass


class RAGEngine:
    def __init__(
        self,
        storage_path: Optional[str] = None,
        chunk_size: int = 512,
        chunk_overlap: int = 64,
        chunk_strategy: str = "semantic",
        embedding_dim: int = EMBEDDING_DIM,
    ):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.chunk_strategy = chunk_strategy
        self.embedding_dim = embedding_dim
        self.storage_path = storage_path

        try:
            self.vector_store = VectorStore(storage_path=storage_path)
        except VectorStoreError as e:
            raise RAGEngineError(f"Failed to initialize vector store: {e}") from e

        try:
            self.embedding_model = EmbeddingModel.get_instance()
            self.embedding_model.load()
        except EmbeddingError as e:
            raise RAGEngineError(f"Failed to load embedding model: {e}") from e

    def ingest_file(self, file_path: str) -> Tuple[str, int]:
        if not os.path.exists(file_path):
            raise RAGEngineError(f"File not found: {file_path}")

        document_id = str(uuid.uuid4())
        meta = get_document_metadata(file_path)

        try:
            text = load_document(file_path)
        except DocumentLoadError as e:
            raise RAGEngineError(str(e)) from e

        chunks = chunk_document(
            text,
            strategy=self.chunk_strategy,
            chunk_size=self.chunk_size,
            overlap=self.chunk_overlap,
        )

        if not chunks:
            raise RAGEngineError(f"No text content extracted from {file_path}")

        if self.embedding_model.session is None:
            self.embedding_model.load()

        chunk_metadata = {
            "document_id": document_id,
            "filename": meta["filename"],
            "extension": meta["extension"],
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        for i, chunk_text in enumerate(chunks):
            chunk_id = f"{document_id}_{i}"
            embedding = self.embedding_model.encode([chunk_text])[0]
            self.vector_store.add_chunk(
                chunk_id=chunk_id,
                text=chunk_text,
                embedding=embedding,
                metadata={**chunk_metadata, "chunk_index": i},
            )

        self.vector_store.persist()
        return document_id, len(chunks)

    def search(
        self,
        query: str,
        top_k: int = 10,
        alpha: float = 0.7,
    ) -> List[dict]:
        if not query or not query.strip():
            return []

        if self.embedding_model.session is None:
            self.embedding_model.load()

        query_embedding = self.embedding_model.encode([query])[0]

        try:
            results = self.vector_store.hybrid_search(
                query_text=query,
                query_embedding=query_embedding,
                top_k=top_k,
                alpha=alpha,
            )
        except VectorStoreError as e:
            raise RAGEngineError(f"Search failed: {e}") from e

        return [
            {
                "chunk_id": cid,
                "text": text,
                "score": round(float(score), 4),
                "metadata": self.vector_store.chunks.get(cid, {}).get("metadata", {}),
            }
            for cid, text, score in results
        ]

    def chat_context(
        self,
        query: str,
        top_k: int = 5,
        alpha: float = 0.7,
        max_tokens: int = 4096,
    ) -> Tuple[str, List[dict]]:
        results = self.search(query=query, top_k=top_k, alpha=alpha)
        context_parts = []
        included_results = []
        token_budget = 0

        for r in results:
            text_tokens = len(r["text"].split())
            if token_budget + text_tokens > max_tokens:
                continue
            cid = r["chunk_id"]
            meta = r.get("metadata", {})
            source = meta.get("filename", "unknown")
            header = f"[Source: {source}]"
            context_parts.append(f"{header}\n{r['text']}")
            included_results.append(r)
            token_budget += text_tokens

        context = "\n\n---\n\n".join(context_parts)
        return context, included_results

    def list_documents(self) -> List[dict]:
        return self.vector_store.get_all_documents()

    def delete_document(self, document_id: str) -> bool:
        self.vector_store.remove_document_chunks(document_id)
        self.vector_store.persist()
        return True

    def get_chunk_count(self) -> int:
        return self.vector_store.count_chunks()
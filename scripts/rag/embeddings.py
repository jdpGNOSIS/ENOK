import json
import os
import re
import urllib.request
from pathlib import Path
from typing import List, Optional

import numpy as np


EMBEDDING_DIM = 384
MAX_SEQ_LEN = 256

ONNX_MODEL_URL = (
    "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2"
    "/resolve/main/onnx/model_O4.onnx"
)
HF_VOCAB_URL = (
    "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2"
    "/resolve/main/vocab.txt"
)
HF_TOKENIZER_URL = (
    "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2"
    "/resolve/main/tokenizer.json"
)


class EmbeddingError(Exception):
    pass


def _get_cache_dir() -> Path:
    base = Path(os.environ.get(
        "RAG_CACHE_DIR", Path.home() / ".cache" / "rag-embeddings"
    ))
    base.mkdir(parents=True, exist_ok=True)
    return base


def _download_file(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    print(f"[rag-embeddings] Downloading {url.split('/')[-1]}...", flush=True)
    try:
        urllib.request.urlretrieve(url, str(dest))
    except Exception as e:
        raise EmbeddingError(f"Failed to download {url}: {e}") from e


def _load_vocab(vocab_path: str) -> dict:
    with open(vocab_path, "r", encoding="utf-8") as f:
        raw = f.read()
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        pass
    lines = raw.strip().split("\n")
    return {line.strip(): idx for idx, line in enumerate(lines)}


def ensure_model() -> tuple:
    cache = _get_cache_dir()
    model_path = cache / "model_O4.onnx"
    vocab_path = cache / "vocab.txt"
    tokenizer_path = cache / "tokenizer.json"

    _download_file(ONNX_MODEL_URL, model_path)
    _download_file(HF_VOCAB_URL, vocab_path)
    _download_file(HF_TOKENIZER_URL, tokenizer_path)

    return str(model_path), str(tokenizer_path), str(vocab_path)


class BertWordPieceTokenizer:
    def __init__(self, vocab: dict):
        self.vocab = vocab
        self.unk_token = "[UNK]"
        self.cls_token = "[CLS]"
        self.sep_token = "[SEP]"
        self.pad_token = "[PAD]"
        self.unk_id = vocab.get(self.unk_token, 0)

    def tokenize(self, text: str) -> List[str]:
        text = text.strip().lower()
        text = re.sub(r"[^\w\s]", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        words = text.split()
        tokens = []
        for word in words:
            if word in self.vocab:
                tokens.append(word)
                continue
            sub_tokens = self._wordpiece_tokenize(word)
            tokens.extend(sub_tokens)
        return tokens

    def _wordpiece_tokenize(self, word: str) -> List[str]:
        if word in self.vocab:
            return [word]
        tokens = []
        start = 0
        while start < len(word):
            end = len(word)
            found = False
            while end > start:
                sub = word[start:end]
                if start > 0:
                    sub = "##" + sub
                if sub in self.vocab:
                    tokens.append(sub)
                    found = True
                    break
                end -= 1
            if not found:
                tokens.append(self.unk_token)
                break
            start = end
        return tokens

    def encode(self, text: str, max_len: int = MAX_SEQ_LEN) -> tuple:
        tokens = self.tokenize(text)
        input_ids = [self.vocab.get(t, self.unk_id) for t in tokens]
        cls_id = self.vocab.get("[CLS]", 101)
        sep_id = self.vocab.get("[SEP]", 102)
        pad_id = self.vocab.get("[PAD]", 0)

        ids = [cls_id] + input_ids + [sep_id]

        if len(ids) > max_len:
            ids = ids[:max_len - 1] + [sep_id]

        attention_mask = [1] * len(ids)
        while len(ids) < max_len:
            ids.append(pad_id)
            attention_mask.append(0)

        return np.array([ids], dtype=np.int64), np.array([attention_mask], dtype=np.int64)


class EmbeddingModel:
    _instance = None

    def __init__(self):
        self.session = None
        self.input_name = None
        self.tokenizer = None
        self._loaded = False

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def load(self):
        if self._loaded:
            return
        try:
            import onnxruntime as ort
        except ImportError:
            raise EmbeddingError(
                "onnxruntime is required. Install with: pip install onnxruntime"
            ) from None

        model_path, tokenizer_path, vocab_path = ensure_model()

        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.enable_cpu_mem_arena = False
        try:
            self.session = ort.InferenceSession(
                model_path, sess_options=so,
                providers=["CPUExecutionProvider"]
            )
        except Exception as e:
            raise EmbeddingError(f"Failed to load ONNX model: {e}") from e

        self.input_name = self.session.get_inputs()[0].name

        vocab = _load_vocab(vocab_path)
        self.tokenizer = BertWordPieceTokenizer(vocab)
        self._loaded = True

    def encode(self, texts: List[str], normalize: bool = True) -> np.ndarray:
        if not self._loaded:
            self.load()

        all_embeddings = []
        for text in texts:
            if not text or not text.strip():
                all_embeddings.append(np.zeros(EMBEDDING_DIM, dtype=np.float32))
                continue

            input_ids, attention_mask = self.tokenizer.encode(text, MAX_SEQ_LEN)

            try:
                result = self.session.run(
                    None,
                    {self.input_name: input_ids, "attention_mask": attention_mask},
                )
                embedding = result[0][0].astype(np.float32)
            except Exception as e:
                raise EmbeddingError(f"ONNX inference failed: {e}") from e

            if normalize:
                norm = np.linalg.norm(embedding)
                if norm > 0:
                    embedding = embedding / norm

            all_embeddings.append(embedding)

        return np.array(all_embeddings, dtype=np.float32)


__all__ = ["EmbeddingModel", "ensure_model", "EmbeddingError", "EMBEDDING_DIM"]
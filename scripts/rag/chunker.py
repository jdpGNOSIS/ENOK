import re
from typing import List, Optional


def count_tokens(text: str) -> int:
    return len(text.split())


def chunk_by_tokens(
    text: str,
    chunk_size: int = 512,
    overlap: int = 64,
) -> List[str]:
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunk = " ".join(words[start:end])
        chunks.append(chunk)
        if end >= len(words):
            break
        start += chunk_size - overlap
    return chunks


def split_sentences(text: str) -> List[str]:
    sentence_end = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"\'(])")
    parts = sentence_end.split(text)
    result = []
    for p in parts:
        p = p.strip()
        if p:
            result.append(p)
    return result


def split_paragraphs(text: str) -> List[str]:
    raw = re.split(r"\n\s*\n", text)
    return [p.strip() for p in raw if p.strip()]


def chunk_semantic(
    text: str,
    chunk_size: int = 512,
    overlap: int = 64,
) -> List[str]:
    paragraphs = split_paragraphs(text)
    if not paragraphs:
        return []

    chunks = []
    current_chunk = []
    current_tokens = 0

    for para in paragraphs:
        para_tokens = count_tokens(para)

        if para_tokens >= chunk_size:
            if current_chunk:
                chunks.append(" ".join(current_chunk))
                current_chunk = []
                current_tokens = 0
            sub_chunks = chunk_by_tokens(para, chunk_size, overlap)
            chunks.extend(sub_chunks)
            continue

        if current_tokens + para_tokens > chunk_size and current_chunk:
            chunks.append(" ".join(current_chunk))
            overlap_words = []
            if overlap > 0 and current_chunk:
                words = current_chunk[-1].split()
                if len(words) > overlap:
                    overlap_words = [" ".join(words[-overlap:])]
                else:
                    overlap_words = current_chunk[-1:]
            current_chunk = list(overlap_words) if overlap_words else []
            current_tokens = count_tokens(" ".join(current_chunk))

        current_chunk.append(para)
        current_tokens += para_tokens

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return chunks


def chunk_sentences(
    text: str,
    chunk_size: int = 512,
    overlap: int = 64,
) -> List[str]:
    sentences = split_sentences(text)
    if not sentences:
        return []

    chunks = []
    current = []
    current_tokens = 0

    for sent in sentences:
        sent_tokens = count_tokens(sent)
        if current_tokens + sent_tokens > chunk_size and current:
            chunks.append(" ".join(current))
            overlap_count = 0
            overlap_sents = []
            for s in reversed(current):
                t = count_tokens(s)
                if overlap_count + t > overlap:
                    break
                overlap_sents.insert(0, s)
                overlap_count += t
            current = list(overlap_sents)
            current_tokens = overlap_count
        current.append(sent)
        current_tokens += sent_tokens

    if current:
        chunks.append(" ".join(current))
    return chunks


def chunk_document(
    text: str,
    strategy: str = "semantic",
    chunk_size: int = 512,
    overlap: int = 64,
) -> List[str]:
    if not text or not text.strip():
        return []
    if strategy == "token":
        return chunk_by_tokens(text, chunk_size, overlap)
    elif strategy == "sentence":
        return chunk_sentences(text, chunk_size, overlap)
    else:
        return chunk_semantic(text, chunk_size, overlap)
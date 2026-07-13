import csv
import io
import os
import re
import traceback
from pathlib import Path
from typing import Optional


class DocumentLoadError(Exception):
    pass


def load_text(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception as e:
        raise DocumentLoadError(f"Failed to read text file {path}: {e}") from e


def load_markdown(path: str) -> str:
    return load_text(path)


def load_csv(path: str) -> str:
    try:
        import pandas as pd
        df = pd.read_csv(path, encoding="utf-8", engine="python", on_bad_lines="skip")
        return df.to_string(index=False)
    except ImportError:
        rows = []
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            reader = csv.reader(f)
            for row in reader:
                rows.append(", ".join(row))
        return "\n".join(rows)
    except Exception as e:
        raise DocumentLoadError(f"Failed to read CSV file {path}: {e}") from e


def load_pdf(path: str) -> str:
    errors = []
    try:
        import pymupdf
        doc = pymupdf.open(path)
        pages = [page.get_text() for page in doc]
        doc.close()
        if pages:
            return "\n\n".join(pages)
    except ImportError:
        errors.append("pymupdf not available")
    except Exception as e:
        errors.append(f"pymupdf error: {e}")

    try:
        import pdfplumber
        pages = []
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                pages.append(text)
        if pages:
            return "\n\n".join(pages)
    except ImportError:
        errors.append("pdfplumber not available")
    except Exception as e:
        errors.append(f"pdfplumber error: {e}")

    if errors:
        raise DocumentLoadError(f"Cannot load PDF {path}. Tried: {'; '.join(errors)}")
    raise DocumentLoadError(f"No PDF loader could process {path}")


def load_docx(path: str) -> str:
    try:
        from docx import Document
        doc = Document(path)
        paragraphs = [p.text for p in doc.paragraphs]
        return "\n".join(paragraphs)
    except ImportError:
        try:
            import zipfile
            import xml.etree.ElementTree as ET
            with zipfile.ZipFile(path) as z:
                xml_content = z.read("word/document.xml")
                root = ET.fromstring(xml_content)
                ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
                texts = []
                for t in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"):
                    if t.text:
                        texts.append(t.text)
                return " ".join(texts)
        except Exception as e2:
            raise DocumentLoadError(f"Failed to read DOCX {path}: {e2}") from e2
    except Exception as e:
        raise DocumentLoadError(f"Failed to read DOCX {path}: {e}") from e


EXTENSION_MAP = {
    ".txt": load_text,
    ".md": load_markdown,
    ".csv": load_csv,
    ".pdf": load_pdf,
    ".docx": load_docx,
}


def load_document(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    loader = EXTENSION_MAP.get(ext)
    if loader is None:
        supported = ", ".join(EXTENSION_MAP.keys())
        raise DocumentLoadError(f"Unsupported file extension '{ext}'. Supported: {supported}")
    return loader(path)


def get_document_metadata(path: str) -> dict:
    p = Path(path)
    stat = p.stat()
    return {
        "filename": p.name,
        "path": str(p.resolve()),
        "extension": p.suffix.lower(),
        "size_bytes": stat.st_size,
        "modified_at": stat.st_mtime,
    }
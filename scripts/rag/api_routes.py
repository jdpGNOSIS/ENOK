"""
FastMCP-style API routes for RAG engine.

Import into serve.cjs and register routes at /api/rag/*.
Uses a subprocess to call the Python RAG engine via JSON-over-stdin/stdout.
"""

import json
import os
import sys
import tempfile
import traceback
from pathlib import Path
from typing import Optional

from .rag_engine import RAGEngine, RAGEngineError

_engine: Optional[RAGEngine] = None


def get_engine() -> RAGEngine:
    global _engine
    if _engine is None:
        data_dir = os.environ.get(
            "RAG_DATA_DIR",
            str(Path(__file__).parent.parent.parent / "app" / "rag-data"),
        )
        Path(data_dir).mkdir(parents=True, exist_ok=True)
        storage_path = os.path.join(data_dir, "vector_store.json")
        _engine = RAGEngine(storage_path=storage_path)
    return _engine


def _json_response(data: dict, status: int = 200) -> dict:
    return {"status": status, "body": json.dumps(data, ensure_ascii=False) + "\n"}


def handle_ingest(params: dict) -> dict:
    file_path = params.get("file_path", "").strip()
    if not file_path or not os.path.exists(file_path):
        return _json_response(
            {"ok": False, "error": f"File not found: {file_path}"}, status=400
        )
    try:
        engine = get_engine()
        doc_id, chunk_count = engine.ingest_file(file_path)
        return _json_response({
            "ok": True,
            "document_id": doc_id,
            "chunk_count": chunk_count,
            "filename": os.path.basename(file_path),
        })
    except RAGEngineError as e:
        return _json_response({"ok": False, "error": str(e)}, status=500)
    except Exception as e:
        return _json_response(
            {"ok": False, "error": f"Internal error: {e}"}, status=500
        )


def handle_list_documents(params: dict = None) -> dict:
    try:
        engine = get_engine()
        docs = engine.list_documents()
        return _json_response({"ok": True, "documents": docs})
    except Exception as e:
        return _json_response({"ok": False, "error": str(e)}, status=500)


def handle_delete_document(params: dict) -> dict:
    doc_id = params.get("document_id", "").strip() if params else ""
    if not doc_id:
        return _json_response(
            {"ok": False, "error": "document_id is required"}, status=400
        )
    try:
        engine = get_engine()
        engine.delete_document(doc_id)
        return _json_response({"ok": True, "document_id": doc_id})
    except Exception as e:
        return _json_response({"ok": False, "error": str(e)}, status=500)


def handle_search(params: dict) -> dict:
    query = (params or {}).get("query", "").strip()
    if not query:
        return _json_response(
            {"ok": False, "error": "query is required"}, status=400
        )
    try:
        top_k = int(params.get("top_k", 10))
        alpha = float(params.get("alpha", 0.7))
        engine = get_engine()
        results = engine.search(query=query, top_k=top_k, alpha=alpha)
        return _json_response({"ok": True, "results": results})
    except Exception as e:
        return _json_response({"ok": False, "error": str(e)}, status=500)


def handle_chat(params: dict) -> dict:
    query = (params or {}).get("query", "").strip()
    if not query:
        return _json_response(
            {"ok": False, "error": "query is required"}, status=400
        )
    try:
        top_k = int(params.get("top_k", 5))
        alpha = float(params.get("alpha", 0.7))
        max_tokens = int(params.get("max_context_tokens", 4096))
        user_message = params.get("message", query)

        engine = get_engine()
        context, sources = engine.chat_context(
            query=query, top_k=top_k, alpha=alpha, max_tokens=max_tokens
        )

        return _json_response({
            "ok": True,
            "context": context,
            "sources": sources,
            "augmented_prompt": (
                "Use the following context to answer the user's question.\n\n"
                f"Context:\n{context}\n\n"
                f"User question: {user_message}"
            ),
        })
    except Exception as e:
        return _json_response({"ok": False, "error": str(e)}, status=500)


ROUTES = {
    "POST /api/rag/ingest": handle_ingest,
    "GET /api/rag/documents": handle_list_documents,
    "POST /api/rag/search": handle_search,
    "POST /api/rag/chat": handle_chat,
}


def handle_delete_document_route(params: dict) -> dict:
    return handle_delete_document(params)


def route_request(method: str, path: str, body: Optional[dict] = None) -> dict:
    route_key = f"{method.upper()} {path.rstrip('/')}"

    # Normalize path: DELETE /api/rag/documents/:id
    if method.upper() == "DELETE" and path.startswith("/api/rag/documents/"):
        doc_id = path.split("/")[-1]
        if doc_id:
            return handle_delete_document({"document_id": doc_id})

    if method.upper() == "GET" and path.rstrip("/") == "/api/rag/documents":
        return handle_list_documents()

    handler = ROUTES.get(route_key)
    if handler is None:
        return _json_response(
            {"ok": False, "error": f"Route not found: {method} {path}"}, status=404
        )

    return handler(body or {})


def main():
    """CLI entry point for subprocess communication with serve.cjs."""
    if len(sys.argv) > 1:
        command = sys.argv[1]
        params_raw = sys.argv[2] if len(sys.argv) > 2 else "{}"
        try:
            params = json.loads(params_raw)
        except json.JSONDecodeError:
            params = {}

        if command == "ingest":
            result = handle_ingest(params)
        elif command == "list":
            result = handle_list_documents()
        elif command == "delete":
            result = handle_delete_document(params)
        elif command == "search":
            result = handle_search(params)
        elif command == "chat":
            result = handle_chat(params)
        else:
            result = _json_response(
                {"ok": False, "error": f"Unknown command: {command}"}, status=400
            )

        sys.stdout.write(result["body"])
        sys.exit(0 if result["status"] == 200 else 1)

    print("RAG API routes loaded. Available endpoints:", file=sys.stderr)
    for route in sorted(ROUTES.keys()):
        print(f"  {route}", file=sys.stderr)
    print("\n  DELETE /api/rag/documents/:id", file=sys.stderr)


if __name__ == "__main__":
    main()
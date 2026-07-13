#!/usr/bin/env python3
"""
Bridge between api_routes.js and the Python AgentRuntime.
Reads a JSON line from stdin, processes the request, and outputs a JSON result.
"""
import sys
import json
import os
import asyncio

from agent_runtime import AgentRuntime

# Global runtime instance persists across calls within a single process lifetime
_runtime = None


def get_runtime(llm_endpoint=""):
    global _runtime
    if _runtime is None:
        root = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
        _runtime = AgentRuntime(
            llm_endpoint=llm_endpoint or "http://127.0.0.1:10086/v1/chat/completions",
            project_root=root,
        )
    if llm_endpoint:
        _runtime.llm_endpoint = llm_endpoint
    return _runtime


async def handle_request(request):
    method = request.get("method", "")
    payload = request.get("payload", {})

    runtime = get_runtime(payload.get("llm_endpoint", ""))

    if method == "list_tools":
        tools = runtime.list_tools()
        return {"status": "ok", "tools": tools}

    elif method == "chat":
        user_message = payload.get("user_message", "")
        messages = payload.get("messages", [])
        temperature = payload.get("temperature", 0.7)
        max_tokens = payload.get("max_tokens", 2048)
        extra_context = payload.get("extra_context", "")
        reset = payload.get("reset", False)

        if reset:
            runtime.reset_conversation()

        # If full messages array is provided, restore conversation history
        if messages and isinstance(messages, list):
            runtime.conversation_history = messages

        result = await runtime.chat(
            user_message=user_message,
            temperature=temperature,
            max_tokens=max_tokens,
            extra_context=extra_context,
        )
        return {"status": "ok", "result": result}

    elif method == "execute_tool":
        tool_name = payload.get("tool", "")
        arguments = payload.get("arguments", {})
        result = await runtime.execute_tool(tool_name, arguments)
        return {"status": "ok", "result": result}

    elif method == "reset":
        runtime.reset_conversation()
        return {"status": "ok", "message": "Conversation reset"}

    elif method == "set_system_prompt":
        prompt = payload.get("prompt", "")
        runtime.set_system_prompt(prompt)
        return {"status": "ok", "message": "System prompt updated"}

    else:
        return {"status": "error", "error": f"Unknown method: {method}"}


async def main():
    line = sys.stdin.readline()
    if not line:
        sys.stderr.write("No input received\n")
        sys.exit(1)

    try:
        request = json.loads(line.strip())
    except json.JSONDecodeError as e:
        sys.stderr.write(f"Invalid JSON: {e}\n")
        sys.exit(1)

    result = await handle_request(request)
    print(json.dumps(result))
    sys.stdout.flush()


if __name__ == "__main__":
    asyncio.run(main())

import json
import asyncio
import os
import re
import logging
import urllib.request
import urllib.error

from .tool_registry import ToolRegistry
from .builtin_tools import BuiltinTools


logger = logging.getLogger(__name__)


OPENAI_TOOL_FORMAT_SYSTEM_PROMPT = """You are an AI assistant with access to tools. You can use these tools to help the user.

When you need to use a tool, respond with a JSON object in this exact format:
{"tool": "tool_name", "arguments": {"arg1": "value1"}}

Otherwise, respond normally in natural language.

Rules:
- Only use tools when necessary
- Use the exact tool names and argument schemas provided
- Never invent tools that don't exist
- If a tool fails, try an alternative approach or inform the user
- For calculations, use the calculate tool
- For current information, use the web_search tool
- For file operations, use the file tools
"""


class AgentRuntime:
    def __init__(self, llm_endpoint=None, allowed_dirs=None, project_root=None):
        self.registry = ToolRegistry()
        self.project_root = project_root or os.getcwd()
        self.llm_endpoint = llm_endpoint or "http://127.0.0.1:10086/v1/chat/completions"
        self.conversation_history = []
        self.system_prompt = OPENAI_TOOL_FORMAT_SYSTEM_PROMPT
        self.max_turns = 10

        if allowed_dirs is None:
            allowed_dirs = [
                self.project_root,
                os.path.join(self.project_root, "app", "models"),
                os.path.join(self.project_root, "app", "outputs"),
                os.path.join(self.project_root, "app", "llm-models"),
                os.path.join(self.project_root, "scripts"),
            ]

        self.builtin_tools = BuiltinTools(
            self.registry,
            allowed_dirs=allowed_dirs,
            project_root=self.project_root,
        )

    def reset_conversation(self):
        self.conversation_history = []

    def get_conversation(self):
        return self.conversation_history

    def set_system_prompt(self, prompt):
        self.system_prompt = prompt

    def get_tool_defs(self):
        return self.registry.get_openai_tools()

    def format_system_message(self, extra_context=None):
        parts = [self.system_prompt]
        if extra_context:
            parts.append(f"\nAdditional context:\n{extra_context}")
        tools = self.get_tool_defs()
        if tools:
            parts.append(f"\nAvailable tools:\n{json.dumps(tools, indent=2)}")
        return {"role": "system", "content": "\n".join(parts)}

    async def chat_completion(self, messages, temperature=0.7, max_tokens=2048):
        payload = {
            "model": "local-model",
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.llm_endpoint,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        loop = asyncio.get_event_loop()

        def _do_request():
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    if resp.status != 200:
                        raise RuntimeError(f"LLM returned HTTP {resp.status}")
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="replace")[:500]
                raise RuntimeError(f"LLM returned HTTP {e.code}: {body}")
            except urllib.error.URLError as e:
                raise RuntimeError(
                    f"Cannot connect to LLM backend at {self.llm_endpoint}: {e.reason}. Ensure a text model is loaded."
                )

        try:
            return await loop.run_in_executor(None, _do_request)
        except asyncio.TimeoutError:
            raise RuntimeError("LLM request timed out")

    async def chat(self, user_message, temperature=0.7, max_tokens=2048, extra_context=None):
        messages = [self.format_system_message(extra_context)]
        for turn in self.conversation_history:
            messages.append(turn)

        messages.append({"role": "user", "content": user_message})

        for turn_index in range(self.max_turns):
            response = await self.chat_completion(messages, temperature, max_tokens)
            content = response.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

            tool_call = self._parse_tool_call(content)

            if not tool_call:
                assistant_msg = {"role": "assistant", "content": content}
                self.conversation_history.append({"role": "user", "content": user_message})
                self.conversation_history.append(assistant_msg)
                return {
                    "response": content,
                    "tool_calls": [],
                    "turn_count": turn_index + 1,
                }

            tool_name = tool_call.get("tool", tool_call.get("name", ""))
            tool_args = tool_call.get("arguments", {})
            if isinstance(tool_args, str):
                try:
                    tool_args = json.loads(tool_args)
                except json.JSONDecodeError:
                    tool_args = {}

            messages.append({
                "role": "assistant",
                "content": json.dumps({"tool_call": {"name": tool_name, "arguments": tool_args}}),
            })

            result = await self.registry.execute(tool_name, tool_args)

            messages.append({
                "role": "user",
                "content": f"Tool result for {tool_name}:\n{json.dumps(result, indent=2)}\n\nContinue with the result or use another tool if needed.",
            })

            if turn_index == self.max_turns - 1:
                final = await self.chat_completion(messages, temperature, 512)
                final_content = final.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
                self.conversation_history.append({"role": "user", "content": user_message})
                self.conversation_history.append({"role": "assistant", "content": final_content})
                return {
                    "response": final_content,
                    "tool_calls": [{"name": tool_name, "result": result}],
                    "turn_count": turn_index + 1,
                }

        final = await self.chat_completion(messages, temperature, 512)
        final_content = final.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        self.conversation_history.append({"role": "user", "content": user_message})
        self.conversation_history.append({"role": "assistant", "content": final_content})
        return {
            "response": final_content,
            "tool_chain": True,
            "turn_count": self.max_turns,
        }

    def _parse_tool_call(self, content):
        content = content.strip()
        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict):
                if "tool" in parsed or "name" in parsed:
                    return parsed
        except json.JSONDecodeError:
            pass
        tool_match = re.search(r'\{\s*"(?:tool|name)"\s*:\s*"[^"]+".*?\}', content, re.DOTALL)
        if tool_match:
            try:
                return json.loads(tool_match.group())
            except json.JSONDecodeError:
                pass
        return None

    async def execute_tool(self, tool_name, arguments):
        return await self.registry.execute(tool_name, arguments)

    def list_tools(self):
        return self.registry.list_tools()

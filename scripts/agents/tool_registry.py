import json
import inspect
import asyncio
import traceback

try:
    from jsonschema import validate, ValidationError
    HAS_JSONSCHEMA = True
except ImportError:
    HAS_JSONSCHEMA = False
    ValidationError = type("ValidationError", (Exception,), {})


class ToolRegistry:
    def __init__(self):
        self._tools = {}
        self._async_tools = {}

    def register(self, name, description, parameters=None, fn=None, is_async=False):
        if parameters is None:
            parameters = {"type": "object", "properties": {}}
        tool_def = {
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": parameters,
            },
        }
        if is_async:
            self._async_tools[name] = {"def": tool_def, "fn": fn}
        else:
            self._tools[name] = {"def": tool_def, "fn": fn}
        return tool_def

    def register_sync(self, name, description, parameters=None):
        def decorator(fn):
            self.register(name, description, parameters, fn=fn, is_async=False)
            return fn
        return decorator

    def register_async(self, name, description, parameters=None):
        def decorator(fn):
            self.register(name, description, parameters, fn=fn, is_async=True)
            return fn
        return decorator

    def get_tool_defs(self):
        defs = []
        for entry in self._tools.values():
            defs.append(entry["def"])
        for entry in self._async_tools.values():
            defs.append(entry["def"])
        return defs

    def get_openai_tools(self):
        return self.get_tool_defs()

    def validate_args(self, name, args):
        entry = self._tools.get(name) or self._async_tools.get(name)
        if not entry:
            raise ValueError(f"Unknown tool: {name}")
        schema = entry["def"]["function"].get("parameters", {"type": "object", "properties": {}})
        if HAS_JSONSCHEMA and schema.get("type") == "object":
            try:
                validate(instance=args, schema=schema)
            except ValidationError as e:
                raise ValueError(f"Validation failed for {name}: {e.message}")

    async def execute(self, name, args):
        entry = self._tools.get(name) or self._async_tools.get(name)
        if not entry:
            raise ValueError(f"Unknown tool: {name}")
        self.validate_args(name, args)
        fn = entry["fn"]
        is_async = name in self._async_tools
        try:
            if is_async:
                result = await fn(**args)
            else:
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(None, lambda: fn(**args))
            return {"status": "success", "tool": name, "result": result}
        except Exception as e:
            return {
                "status": "error",
                "tool": name,
                "error": str(e),
                "traceback": traceback.format_exc(),
            }

    async def execute_tool_call(self, tool_call):
        name = tool_call.get("function", {}).get("name", "")
        raw_args = tool_call.get("function", {}).get("arguments", "{}")
        if isinstance(raw_args, str):
            try:
                args = json.loads(raw_args)
            except json.JSONDecodeError:
                args = {}
        else:
            args = raw_args or {}
        return await self.execute(name, args)

    def list_tools(self):
        result = []
        for name, entry in self._tools.items():
            info = entry["def"]["function"].copy()
            info["async"] = False
            result.append(info)
        for name, entry in self._async_tools.items():
            info = entry["def"]["function"].copy()
            info["async"] = True
            result.append(info)
        return result

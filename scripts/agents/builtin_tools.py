import os
import math
import json
import datetime
import subprocess
import sys
import urllib.request
import urllib.parse
import urllib.error
import pathlib
import re


class BuiltinTools:
    def __init__(self, registry, allowed_dirs=None, search_module_path=None, project_root=None):
        self.registry = registry
        self.allowed_dirs = allowed_dirs or []
        self.project_root = project_root or os.getcwd()
        self.search_module_path = search_module_path
        self._register_all()

    def _check_path(self, path):
        abs_path = os.path.abspath(os.path.normpath(path))
        if not self.allowed_dirs:
            return abs_path
        for allowed in self.allowed_dirs:
            allowed_abs = os.path.abspath(os.path.normpath(allowed))
            if abs_path.startswith(allowed_abs):
                return abs_path
        raise PermissionError(f"Access denied: {path} is not in allowed directories")

    def _register_all(self):
        self.registry.register(
            name="web_search",
            description="Search the web for current information. Returns snippets and URLs.",
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query"},
                    "time_filter": {
                        "type": "string",
                        "description": "Time filter: any, day, week, month, year",
                        "enum": ["any", "day", "week", "month", "year"],
                        "default": "any",
                    },
                },
                "required": ["query"],
            },
            fn=self.web_search,
        )

        self.registry.register(
            name="python_execute",
            description="Execute Python code in a sandboxed environment. Returns stdout/stderr. Use for calculations, data processing, and scripting.",
            parameters={
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "Python code to execute"},
                },
                "required": ["code"],
            },
            fn=self.python_execute,
        )

        self.registry.register(
            name="read_file",
            description="Read the contents of a file from allowed directories.",
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path to the file"},
                },
                "required": ["path"],
            },
            fn=self.read_file,
        )

        self.registry.register(
            name="write_file",
            description="Write content to a file in allowed directories.",
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path to the file"},
                    "content": {"type": "string", "description": "Content to write"},
                },
                "required": ["path", "content"],
            },
            fn=self.write_file,
        )

        self.registry.register(
            name="list_files",
            description="List files and directories at the given path.",
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path to the directory"},
                },
                "required": ["path"],
            },
            fn=self.list_files,
        )

        self.registry.register(
            name="image_generate",
            description="Generate an image using the Stable Diffusion backend. Requires backend to be loaded.",
            parameters={
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "Text prompt for image generation"},
                    "negative_prompt": {
                        "type": "string",
                        "description": "Things to avoid in the image",
                        "default": "",
                    },
                    "steps": {
                        "type": "integer",
                        "description": "Number of inference steps",
                        "default": 20,
                        "minimum": 1,
                        "maximum": 150,
                    },
                    "width": {"type": "integer", "default": 512, "minimum": 64, "maximum": 2048},
                    "height": {"type": "integer", "default": 512, "minimum": 64, "maximum": 2048},
                },
                "required": ["prompt"],
            },
            fn=self.image_generate,
        )

        self.registry.register(
            name="calculate",
            description="Evaluate a mathematical expression safely. Supports +, -, *, /, **, sin, cos, sqrt, etc.",
            parameters={
                "type": "object",
                "properties": {
                    "expression": {"type": "string", "description": "Math expression to evaluate"},
                },
                "required": ["expression"],
            },
            fn=self.calculate,
        )

        self.registry.register(
            name="current_time",
            description="Get the current date and time.",
            parameters={
                "type": "object",
                "properties": {
                    "timezone": {
                        "type": "string",
                        "description": "Optional timezone (e.g. UTC, US/Eastern)",
                        "default": "local",
                    },
                },
            },
            fn=self.current_time,
        )

        self.registry.register(
            name="weather",
            description="Get current weather for a location using wttr.in (free, no API key).",
            parameters={
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "City name or coordinates"},
                },
                "required": ["location"],
            },
            fn=self.weather,
        )

    def web_search(self, query, time_filter="any"):
        try:
            url = "https://lite.duckduckgo.com/lite/?q=" + urllib.parse.quote(query)
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (compatible; UncensoredAIStudio/1.0)"},
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode("utf-8", errors="replace")

            results = []
            snippets = re.findall(
                r'class="result-snippet"[^>]*>(.*?)</(?:td|a|div)',
                html, re.DOTALL
            )
            links = re.findall(r'class="result-link"[^>]*>.*?href="(https?://[^"]+)"[^>]*>(.*?)</a>', html, re.DOTALL)
            for i, (url_text, title_html) in enumerate(links[:8]):
                title = re.sub(r"<[^>]+>", "", title_html).strip()
                snippet = ""
                if i < len(snippets):
                    snippet = re.sub(r"<[^>]+>", "", snippets[i]).strip()
                results.append({"title": title, "url": url_text, "snippet": snippet})

            return {"query": query, "results": results, "count": len(results)}
        except Exception as e:
            return {"query": query, "error": str(e), "results": []}

    def python_execute(self, code):
        from .sandbox import Sandbox
        sandbox = Sandbox(allowed_dirs=self.allowed_dirs, timeout=30)
        return sandbox.execute_subprocess(code, timeout=30)

    def read_file(self, path):
        safe_path = self._check_path(path)
        if not os.path.isfile(safe_path):
            return {"error": f"File not found: {path}"}
        try:
            with open(safe_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            return {
                "path": path,
                "size": len(content),
                "content": content,
            }
        except Exception as e:
            return {"error": str(e)}

    def write_file(self, path, content):
        safe_path = self._check_path(path)
        try:
            os.makedirs(os.path.dirname(safe_path), exist_ok=True)
            with open(safe_path, "w", encoding="utf-8") as f:
                f.write(content)
            return {"path": path, "written": len(content), "status": "ok"}
        except Exception as e:
            return {"error": str(e)}

    def list_files(self, path):
        safe_path = self._check_path(path)
        if not os.path.isdir(safe_path):
            return {"error": f"Directory not found: {path}"}
        try:
            entries = []
            for entry in os.scandir(safe_path):
                entries.append({
                    "name": entry.name,
                    "type": "directory" if entry.is_dir() else "file",
                    "size": entry.stat().st_size if entry.is_file() else 0,
                })
            entries.sort(key=lambda e: (e["type"] != "directory", e["name"]))
            return {"path": path, "entries": entries, "count": len(entries)}
        except Exception as e:
            return {"error": str(e)}

    def image_generate(self, prompt, negative_prompt="", steps=20, width=512, height=512):
        try:
            port = os.environ.get("SD_BACKEND_PORT", "8080")
            url = f"http://127.0.0.1:{port}/v1/generate"
            payload = json.dumps({
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "steps": steps,
                "width": width,
                "height": height,
            }).encode("utf-8")
            req = urllib.request.Request(
                url, data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=300) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            return {
                "status": "generated",
                "prompt": prompt,
                "image": result.get("images", [None])[0] or result.get("image", ""),
                "seed": result.get("seed"),
            }
        except Exception as e:
            return {"error": f"Image generation failed: {e}"}

    def calculate(self, expression):
        allowed_names = {
            k: v for k, v in math.__dict__.items() if not k.startswith("__")
        }
        allowed_names.update({
            "abs": abs, "max": max, "min": min, "round": round,
            "sum": sum, "pow": pow, "float": float, "int": int,
        })
        try:
            result = eval(expression, {"__builtins__": {}}, allowed_names)
            return {"expression": expression, "result": result}
        except Exception as e:
            return {"error": f"Calculation error: {e}"}

    def current_time(self, timezone="local"):
        now = datetime.datetime.now()
        return {
            "timezone": timezone,
            "datetime": now.isoformat(),
            "date": now.strftime("%Y-%m-%d"),
            "time": now.strftime("%H:%M:%S"),
            "weekday": now.strftime("%A"),
            "unix_timestamp": int(now.timestamp()),
        }

    def weather(self, location):
        try:
            encoded = urllib.parse.quote(location)
            url = f"https://wttr.in/{encoded}?format=j1"
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "curl/8.0"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            current = data.get("current_condition", [{}])[0]
            return {
                "location": location,
                "temperature_c": current.get("temp_C"),
                "temperature_f": current.get("temp_F"),
                "humidity": current.get("humidity"),
                "weather_desc": current.get("weatherDesc", [{}])[0].get("value", ""),
                "wind_speed_kmh": current.get("windspeedKmph"),
                "visibility_km": current.get("visibility"),
                "feels_like_c": current.get("FeelsLikeC"),
            }
        except Exception as e:
            return {"error": f"Weather lookup failed: {e}"}

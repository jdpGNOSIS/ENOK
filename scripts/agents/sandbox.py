import sys
import os
import subprocess
import ast
import time
import signal
import tempfile
import re


ALLOWED_DIRS = []
_RESTRICTED_BUILTINS = {
    "abs": abs, "all": all, "any": any, "ascii": ascii, "bin": bin,
    "bool": bool, "bytearray": bytearray, "bytes": bytes, "chr": chr,
    "complex": complex, "dict": dict, "dir": dir, "divmod": divmod,
    "enumerate": enumerate, "filter": filter, "float": float, "format": format,
    "frozenset": frozenset, "getattr": getattr, "hasattr": hasattr,
    "hash": hash, "hex": hex, "id": id, "int": int, "isinstance": isinstance,
    "issubclass": issubclass, "iter": iter, "len": len, "list": list,
    "map": map, "max": max, "min": min, "next": next, "object": object,
    "oct": oct, "ord": ord, "pow": pow, "print": print, "range": range,
    "repr": repr, "reversed": reversed, "round": round, "set": set,
    "slice": slice, "sorted": sorted, "str": str, "sum": sum,
    "tuple": tuple, "type": type, "zip": zip,
}


FORBIDDEN_IMPORTS = {
    "os", "subprocess", "shutil", "sys", "ctypes", "socket",
    "signal", "multiprocessing", "threading", "importlib",
    "builtins", "inspect", "pickle", "code", "codeop",
    "pty", "tty", "termios", "fcntl",
    "http", "urllib", "requests", "aiohttp",
    "crypt", "cffi", "distutils",
    "contextlib",  # allow but restrict
}

FORBIDDEN_IMPORT_PREFIXES = {
    "os.", "subprocess.", "ctypes.", "socket.", "multiprocessing.",
    "threading.", "importlib.", "pickle.", "code.",
}


class Sandbox:
    def __init__(self, allowed_dirs=None, timeout=30, max_memory_mb=256):
        self.timeout = timeout
        self.max_memory_mb = max_memory_mb
        self.allowed_dirs = allowed_dirs or []

    def _check_imports(self, tree):
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    name = alias.name
                    if name in FORBIDDEN_IMPORTS:
                        raise ValueError(f"Import forbidden in sandbox: {name}")
                    for prefix in FORBIDDEN_IMPORT_PREFIXES:
                        if name.startswith(prefix):
                            raise ValueError(f"Import forbidden in sandbox: {name}")
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                if module in FORBIDDEN_IMPORTS:
                    raise ValueError(f"Import forbidden in sandbox: {module}")
                for prefix in FORBIDDEN_IMPORT_PREFIXES:
                    if module.startswith(prefix):
                        raise ValueError(f"Import forbidden in sandbox: {module}")
                for alias in node.names:
                    if alias.name == "os":
                        raise ValueError("Import forbidden in sandbox: os")

    def _check_path_access(self, path):
        abs_path = os.path.abspath(os.path.normpath(path))
        if not self.allowed_dirs:
            return
        for allowed in self.allowed_dirs:
            allowed_abs = os.path.abspath(os.path.normpath(allowed))
            if abs_path.startswith(allowed_abs):
                return
        raise PermissionError(f"Access denied to path outside allowed directories: {path}")

    def execute(self, code, filename="<sandbox>"):
        try:
            tree = ast.parse(code, filename=filename)
        except SyntaxError as e:
            return {"status": "error", "error": f"Syntax error: {e}"}
        try:
            self._check_imports(tree)
        except ValueError as e:
            return {"status": "error", "error": str(e)}

        safe_globals = {
            "__builtins__": _RESTRICTED_BUILTINS,
            "__name__": "__sandbox__",
            "_sandbox_instance": self,
        }

        try:
            compiled = compile(tree, filename=filename, mode="exec")
        except Exception as e:
            return {"status": "error", "error": f"Compile error: {e}"}

        import io
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        sys.stdout = stdout_capture
        sys.stderr = stderr_capture

        try:
            exec(compiled, safe_globals)
            output = stdout_capture.getvalue()
            error_output = stderr_capture.getvalue()
            return {
                "status": "success",
                "stdout": output,
                "stderr": error_output,
            }
        except Exception as e:
            error_output = stderr_capture.getvalue()
            return {
                "status": "error",
                "stdout": stdout_capture.getvalue(),
                "stderr": error_output,
                "error": f"{type(e).__name__}: {e}",
            }
        finally:
            sys.stdout = old_stdout
            sys.stderr = old_stderr

    def execute_subprocess(self, code, timeout=None):
        if timeout is None:
            timeout = self.timeout
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = f.name

        safe_builtins = list(_RESTRICTED_BUILTINS.keys())
        preamble = (
            "import sys as _sys\n"
            "import io as _io\n"
            "_sys.stdout = _io.StringIO()\n"
            "_sys.stderr = _io.StringIO()\n"
            f"_allowed_dirs = {self.allowed_dirs}\n"
        )
        guard_code = (
            "import builtins\n"
            "_original_import = builtins.__import__\n"
            "_forbidden = {'os','subprocess','shutil','ctypes','socket','signal','multiprocessing','threading','importlib','pickle','code','codeop','pty','tty','http','urllib','requests','aiohttp'}\n"
            "def _safe_import(name, *args, **kwargs):\n"
            "    base = name.split('.')[0]\n"
            "    if base in _forbidden:\n"
            "        raise ImportError(f'Import forbidden: {name}')\n"
            "    return _original_import(name, *args, **kwargs)\n"
            "builtins.__import__ = _safe_import\n"
        )

        try:
            result = subprocess.run(
                [sys.executable, "-c", guard_code + preamble + code],
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            return {
                "status": "success" if result.returncode == 0 else "error",
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode,
            }
        except subprocess.TimeoutExpired:
            return {"status": "error", "error": f"Execution timed out after {timeout}s"}
        except Exception as e:
            return {"status": "error", "error": str(e)}
        finally:
            try:
                os.unlink(temp_path)
            except OSError:
                pass

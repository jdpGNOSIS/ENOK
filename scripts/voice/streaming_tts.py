"""
Streaming TTS — chunked audio synthesis with WebSocket/SSE support.

Reads from the kokoro-js worker pipeline and streams audio chunks
for real-time playback. Supports multiple voices concurrently.
"""

import asyncio
import io
import json
import logging
import os
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import AsyncGenerator, Optional

import numpy as np

logger = logging.getLogger("streaming_tts")

ROOT = Path(__file__).parent.parent.parent
TTS_RUNTIME = ROOT / "app" / "tts-runtime"
TTS_WORKER = ROOT / "scripts" / "workers" / "tts-kokoro-worker.mjs"
TTS_CACHE = ROOT / "app" / "tts-cache"
TTS_OUTPUTS = ROOT / "app" / "tts-outputs"
TTS_MODELS = ROOT / "app" / "tts-models"

TTS_OUTPUTS.mkdir(parents=True, exist_ok=True)
TTS_CACHE.mkdir(parents=True, exist_ok=True)

CHUNK_DURATION_MS = 200
SAMPLE_RATE = 24000
CHUNK_SIZE = int(SAMPLE_RATE * CHUNK_DURATION_MS / 1000)


class StreamingTTS:
    """Streaming TTS that generates audio chunks for real-time playback.

    Uses the same kokoro-js worker as the non-streaming TTS, but splits
    long text into sentences and synthesizes them incrementally.
    """

    def __init__(self):
        self._active_streams: dict = {}
        self._node_path = self._find_node()

    def _find_node(self) -> str:
        candidates = [
            str(TTS_RUNTIME.parent / "tools" / "node-win" / "node.exe"),
            str(TTS_RUNTIME.parent / "tools" / "node-mac" / "bin" / "node"),
            str(TTS_RUNTIME.parent / "tools" / "node-linux" / "bin" / "node"),
            "node",
        ]
        for c in candidates:
            if os.path.exists(c):
                return c
        return "node"

    def _is_installed(self) -> bool:
        node_modules = TTS_RUNTIME / "node_modules"
        return node_modules.exists() and (node_modules / "kokoro-js").exists() and TTS_WORKER.exists()

    def _split_sentences(self, text: str) -> list:
        """Split text into sentence-sized chunks for streaming."""
        import re
        sentences = re.split(r"(?<=[.!?])\s+", text)
        chunks = []
        current = ""
        for s in sentences:
            s = s.strip()
            if not s:
                continue
            if len(current) + len(s) < 200:
                current += " " + s if current else s
            else:
                if current:
                    chunks.append(current)
                current = s
        if current:
            chunks.append(current)
        return chunks if chunks else [text]

    async def text_to_speech_stream(
        self,
        text: str,
        voice: str = "af_heart",
        speed: float = 1.0,
        model_id: str = "onnx-community/Kokoro-82M-v1.0-ONNX",
        dtype: str = "q8",
        stream_id: Optional[str] = None,
    ) -> AsyncGenerator[bytes, None]:
        """Stream audio chunks for the given text.

        Yields:
            Raw PCM int16 audio chunks (4800 samples = 200ms at 24kHz).
        """
        if not self._is_installed():
            logger.warning("kokoro-js runtime not installed")
            yield b""
            return

        if stream_id is None:
            stream_id = f"stream_{int(time.time() * 1000)}"

        self._active_streams[stream_id] = {"active": True}
        sentences = self._split_sentences(text)

        try:
            for i, sentence in enumerate(sentences):
                if not self._active_streams.get(stream_id, {}).get("active", True):
                    break

                wav_data = await asyncio.get_event_loop().run_in_executor(
                    None,
                    self._synthesize_chunk,
                    sentence, voice, speed, model_id, dtype,
                )

                if wav_data:
                    pcm = self._wav_to_pcm(wav_data)
                    chunk_size = 4800
                    for start in range(0, len(pcm), chunk_size):
                        yield pcm[start:start + chunk_size]

        finally:
            self._active_streams.pop(stream_id, None)

    def _synthesize_chunk(
        self,
        text: str,
        voice: str,
        speed: float,
        model_id: str,
        dtype: str,
    ) -> Optional[bytes]:
        stamp = str(int(time.time() * 1000000))
        temp_wav = str(TTS_OUTPUTS / f".stream-{stamp}.wav")

        payload = {
            "text": text,
            "modelId": model_id,
            "dtype": dtype,
            "voice": voice,
            "speed": speed,
            "output": temp_wav,
            "cacheDir": str(TTS_CACHE),
        }

        try:
            proc = subprocess.run(
                [self._node_path, str(TTS_WORKER)],
                input=json.dumps(payload),
                capture_output=True,
                timeout=60,
                cwd=str(ROOT),
                env={
                    **os.environ,
                    "NODE_PATH": str(TTS_RUNTIME / "node_modules"),
                    "TTS_RUNTIME": str(TTS_RUNTIME),
                },
            )

            if proc.returncode != 0:
                stderr = proc.stderr.decode("utf-8", errors="replace").strip()
                logger.warning(f"Chunk synthesis failed: {stderr}")
                return None

            result = json.loads(proc.stdout.decode("utf-8").strip())
            if not result.get("ok"):
                return None

            if os.path.exists(temp_wav):
                with open(temp_wav, "rb") as f:
                    data = f.read()
                os.unlink(temp_wav)
                return data
            return None
        except subprocess.TimeoutExpired:
            logger.warning("Chunk synthesis timed out")
            try:
                os.unlink(temp_wav)
            except OSError:
                pass
            return None
        except Exception as e:
            logger.warning(f"Chunk synthesis error: {e}")
            try:
                os.unlink(temp_wav)
            except OSError:
                pass
            return None

    def _wav_to_pcm(self, wav_data: bytes) -> bytes:
        """Convert WAV bytes to raw PCM int16."""
        if len(wav_data) < 44:
            return b""
        pcm = wav_data[44:]
        return pcm

    def cancel_stream(self, stream_id: str):
        if stream_id in self._active_streams:
            self._active_streams[stream_id]["active"] = False

    def get_active_streams(self) -> list:
        return [sid for sid, info in self._active_streams.items() if info.get("active")]


_streaming_tts_instance = StreamingTTS()


def get_streaming_tts() -> StreamingTTS:
    global _streaming_tts_instance
    return _streaming_tts_instance


async def handle_streaming_request(params: dict) -> AsyncGenerator[dict, None]:
    """Handle an SSE streaming TTS request."""
    text = params.get("text", "").strip()
    if not text:
        yield {"event": "error", "data": {"error": "No text provided"}}
        return

    voice = params.get("voice", "af_heart")
    speed = max(0.5, min(2.0, float(params.get("speed", 1.0))))
    stream_id = params.get("stream_id", f"stream_{int(time.time() * 1000)}")

    tts = get_streaming_tts()
    total_len = 0
    chunk_count = 0

    yield {"event": "start", "data": {"stream_id": stream_id, "voice": voice}}

    try:
        async for chunk in tts.text_to_speech_stream(text, voice, speed, stream_id=stream_id):
            if chunk:
                total_len += len(chunk)
                chunk_count += 1
                yield {
                    "event": "audio",
                    "data": {
                        "pcm_base64": chunk.hex(),
                        "bytes": len(chunk),
                        "sample_rate": SAMPLE_RATE,
                        "stream_id": stream_id,
                    },
                }

        yield {
            "event": "done",
            "data": {
                "stream_id": stream_id,
                "total_bytes": total_len,
                "chunk_count": chunk_count,
            },
        }
    except Exception as e:
        yield {"event": "error", "data": {"error": str(e), "stream_id": stream_id}}


def main():
    """CLI entry point for subprocess communication."""
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    params_raw = sys.argv[2] if len(sys.argv) > 2 else "{}"
    try:
        params = json.loads(params_raw)
    except json.JSONDecodeError:
        params = {}

    tts = get_streaming_tts()
    result = {"ok": False, "error": "Unknown command"}

    if command == "status":
        result = {
            "ok": True,
            "installed": tts._is_installed(),
            "node_path": tts._node_path,
            "active_streams": tts.get_active_streams(),
        }
    elif command == "speak":
        import base64
        text = params.get("text", "").strip()
        if not text:
            result = {"ok": False, "error": "No text"}
        else:
            voice = params.get("voice", "af_heart")
            speed = max(0.5, min(2.0, float(params.get("speed", 1.0))))
            all_chunks = []
            for chunk in tts.text_to_speech_stream(text, voice, speed):
                if isinstance(chunk, bytes):
                    all_chunks.append(chunk)
            combined = b"".join(all_chunks)
            result = {
                "ok": True,
                "pcm_base64": combined.hex() if combined else "",
                "bytes": len(combined),
                "sample_rate": SAMPLE_RATE,
            }
    elif command == "cancel":
        stream_id = params.get("stream_id", "")
        tts.cancel_stream(stream_id)
        result = {"ok": True, "cancelled": stream_id}

    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()

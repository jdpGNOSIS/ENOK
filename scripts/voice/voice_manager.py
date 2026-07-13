"""
Voice management — list, save, load, preview, interpolate voices.
"""

import json
import logging
import os
import shutil
from pathlib import Path
from typing import List, Optional

import numpy as np

logger = logging.getLogger("voice_manager")

ROOT = Path(__file__).parent.parent.parent
VOICE_MODELS_DIR = ROOT / "app" / "voice-models"
TTS_OUTPUTS = ROOT / "app" / "tts-outputs"
TTS_OUTPUTS.mkdir(parents=True, exist_ok=True)

BUILTIN_VOICES = [
    {"id": "af_heart", "name": "Heart", "language": "en-us", "gender": "Female", "type": "builtin"},
    {"id": "af_bella", "name": "Bella", "language": "en-us", "gender": "Female", "type": "builtin"},
    {"id": "af_nicole", "name": "Nicole", "language": "en-us", "gender": "Female", "type": "builtin"},
    {"id": "af_sarah", "name": "Sarah", "language": "en-us", "gender": "Female", "type": "builtin"},
    {"id": "am_michael", "name": "Michael", "language": "en-us", "gender": "Male", "type": "builtin"},
    {"id": "am_fenrir", "name": "Fenrir", "language": "en-us", "gender": "Male", "type": "builtin"},
    {"id": "bf_emma", "name": "Emma", "language": "en-gb", "gender": "Female", "type": "builtin"},
    {"id": "bm_george", "name": "George", "language": "en-gb", "gender": "Male", "type": "builtin"},
]

PREVIEW_TEXT = "The quick brown fox jumps over the lazy dog. This voice was cloned using artificial intelligence."


class VoiceManager:
    """Manages built-in and cloned voices."""

    def __init__(self, voices_dir: Optional[str] = None):
        self.voices_dir = Path(voices_dir) if voices_dir else VOICE_MODELS_DIR
        self.voices_dir.mkdir(parents=True, exist_ok=True)

    def list_voices(self) -> list:
        """List all available voices (built-in + cloned)."""
        cloned = self._list_cloned_voices()
        return BUILTIN_VOICES + cloned

    def _list_cloned_voices(self) -> list:
        cloned = []
        if not self.voices_dir.exists():
            return cloned
        for entry in self.voices_dir.iterdir():
            if entry.suffix == ".json":
                try:
                    meta = json.loads(entry.read_text("utf-8"))
                    meta["type"] = "cloned"
                    if "id" not in meta:
                        meta["id"] = entry.stem
                    cloned.append(meta)
                except (json.JSONDecodeError, OSError):
                    pass
        return cloned

    def get_voice(self, voice_id: str) -> Optional[dict]:
        """Get a voice by ID, checking built-in first then cloned."""
        for v in BUILTIN_VOICES:
            if v["id"] == voice_id:
                return v
        meta_path = self.voices_dir / f"{voice_id}.json"
        if meta_path.exists():
            try:
                return json.loads(meta_path.read_text("utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
        return None

    def save_cloned_voice(self, voice_id: str, metadata: dict, audio_bytes: Optional[bytes] = None) -> dict:
        """Save a cloned voice's metadata and optionally an audio sample."""
        safe_id = "".join(c for c in voice_id if c.isalnum() or c in "_-").strip()
        if not safe_id:
            safe_id = f"voice_{len(list(self.voices_dir.glob('*.json')))}"

        meta_path = self.voices_dir / f"{safe_id}.json"
        metadata.update({
            "id": safe_id,
            "type": "cloned",
            "createdAt": metadata.get("createdAt", ""),
        })
        meta_path.write_text(json.dumps(metadata, indent=2), "utf-8")

        if audio_bytes:
            wav_path = self.voices_dir / f"{safe_id}.wav"
            wav_path.write_bytes(audio_bytes)
            metadata["sampleFile"] = str(wav_path.name)

        return metadata

    def delete_voice(self, voice_id: str) -> bool:
        """Delete a cloned voice by ID."""
        meta_path = self.voices_dir / f"{voice_id}.json"
        wav_path = self.voices_dir / f"{voice_id}.wav"
        npy_path = self.voices_dir / f"{voice_id}.npy"
        deleted = False
        for p in [meta_path, wav_path, npy_path]:
            if p.exists():
                p.unlink()
                deleted = True
        return deleted

    def generate_preview(
        self,
        voice_id: str,
        text: str = PREVIEW_TEXT,
        output_dir: Optional[str] = None,
    ) -> Optional[str]:
        """Generate a preview WAV for a voice.

        Returns path to generated WAV file, or None if failed.
        """
        out_dir = Path(output_dir) if output_dir else TTS_OUTPUTS
        out_dir.mkdir(parents=True, exist_ok=True)

        voice = self.get_voice(voice_id)
        if not voice:
            return None

        stamp = str(int(__import__("time").time() * 1000))
        preview_path = out_dir / f"preview-{voice_id}-{stamp}.wav"

        json_payload = json.dumps({
            "text": text,
            "voice": voice_id,
            "speed": 1.0,
            "modelId": "onnx-community/Kokoro-82M-v1.0-ONNX",
            "dtype": "q8",
            "output": str(preview_path),
            "cacheDir": str(ROOT / "app" / "tts-cache"),
        })

        try:
            import subprocess
            node_path = str(ROOT / "scripts" / "workers" / "tts-kokoro-worker.mjs")
            tts_runtime = str(ROOT / "app" / "tts-runtime")
            proc = subprocess.run(
                [self._find_node(), node_path],
                input=json_payload,
                capture_output=True,
                timeout=120,
                cwd=str(ROOT),
                env={
                    **os.environ,
                    "NODE_PATH": str(Path(tts_runtime) / "node_modules"),
                    "TTS_RUNTIME": tts_runtime,
                },
            )
            if proc.returncode != 0 or not preview_path.exists():
                return None
            return str(preview_path)
        except Exception as e:
            logger.warning(f"Preview generation failed: {e}")
            return None

    def _find_node(self) -> str:
        candidates = [
            str(ROOT / "app" / "tools" / "node-win" / "node.exe"),
            str(ROOT / "app" / "tools" / "node-mac" / "bin" / "node"),
            str(ROOT / "app" / "tools" / "node-linux" / "bin" / "node"),
            "node",
        ]
        for c in candidates:
            if os.path.exists(c):
                return c
        return "node"

    def interpolate_voices(self, voice_a_id: str, voice_b_id: str, alpha: float = 0.5) -> Optional[dict]:
        """Interpolate between two voices.

        Args:
            voice_a_id: First voice ID.
            voice_b_id: Second voice ID.
            alpha: Blend factor (0 = voice_a, 1 = voice_b).

        Returns:
            Dict with interpolated voice info, or None if embeddings not found.
        """
        emb_a = self._load_embedding(voice_a_id)
        emb_b = self._load_embedding(voice_b_id)
        if emb_a is None or emb_b is None:
            return None

        alpha = max(0.0, min(1.0, alpha))
        interpolated = (1.0 - alpha) * emb_a + alpha * emb_b

        interp_id = f"interp_{voice_a_id}_{voice_b_id}_{int(alpha * 100)}"
        npy_path = self.voices_dir / f"{interp_id}.npy"
        np.save(str(npy_path), interpolated)

        meta = {
            "id": interp_id,
            "name": f"{voice_a_id} + {voice_b_id} ({int(alpha * 100)}%)",
            "type": "interpolated",
            "voiceA": voice_a_id,
            "voiceB": voice_b_id,
            "alpha": alpha,
            "embedding": str(npy_path.name),
            "createdAt": __import__("datetime").datetime.now().isoformat(),
        }
        meta_path = self.voices_dir / f"{interp_id}.json"
        meta_path.write_text(json.dumps(meta, indent=2), "utf-8")

        return meta

    def _load_embedding(self, voice_id: str) -> Optional[np.ndarray]:
        """Load a speaker embedding .npy file for a voice."""
        npy_path = self.voices_dir / f"{voice_id}.npy"
        if npy_path.exists():
            try:
                return np.load(str(npy_path))
            except Exception:
                pass

        meta = self.get_voice(voice_id)
        if meta and "embedding" in meta:
            emb_path = self.voices_dir / meta["embedding"]
            if emb_path.exists():
                try:
                    return np.load(str(emb_path))
                except Exception:
                    pass
        return None


def main():
    """CLI entry point for subprocess communication."""
    import sys
    import json
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    params_raw = sys.argv[2] if len(sys.argv) > 2 else "{}"
    try:
        params = json.loads(params_raw)
    except json.JSONDecodeError:
        params = {}

    manager = VoiceManager()
    result = {"ok": False, "error": "Unknown command"}

    if command == "list":
        voices = manager.list_voices()
        result = {"ok": True, "voices": voices}
    elif command == "get":
        voice = manager.get_voice(params.get("voice_id", ""))
        result = {"ok": voice is not None, "voice": voice} if voice else {"ok": False, "error": "Voice not found"}
    elif command == "delete":
        deleted = manager.delete_voice(params.get("voice_id", ""))
        result = {"ok": deleted, "deleted": deleted}
    elif command == "preview":
        path = manager.generate_preview(
            voice_id=params.get("voice_id", ""),
            text=params.get("text", PREVIEW_TEXT),
        )
        result = {"ok": path is not None, "path": path} if path else {"ok": False, "error": "Preview generation failed"}
    elif command == "interpolate":
        interp = manager.interpolate_voices(
            voice_a_id=params.get("voice_a", ""),
            voice_b_id=params.get("voice_b", ""),
            alpha=float(params.get("alpha", 0.5)),
        )
        result = {"ok": interp is not None, "interpolation": interp} if interp else {"ok": False, "error": "Interpolation failed — embeddings not found"}

    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()

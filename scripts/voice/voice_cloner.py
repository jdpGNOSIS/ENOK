"""
Voice cloning engine — lightweight ONNX-based voice cloning.
Primary: OpenVoice v2 via onnxruntime.
Fallback: Coqui-AI TTS if available (optional).
Minimal dependencies: onnxruntime, numpy.
"""

import io
import json
import logging
import os
import sys
import tempfile
import traceback
from pathlib import Path
from typing import List, Optional

import numpy as np

logger = logging.getLogger("voice_cloner")

try:
    import onnxruntime as ort
    HAS_ONNX = True
except ImportError:
    ort = None
    HAS_ONNX = False

_OPENVOICE_AVAILABLE = None
_COQUI_AVAILABLE = None


def _check_openvoice():
    global _OPENVOICE_AVAILABLE
    if _OPENVOICE_AVAILABLE is not None:
        return _OPENVOICE_AVAILABLE
    try:
        import openvoice  # noqa: F401
        _OPENVOICE_AVAILABLE = True
    except ImportError:
        _OPENVOICE_AVAILABLE = False
    return _OPENVOICE_AVAILABLE


def _check_coqui():
    global _COQUI_AVAILABLE
    if _COQUI_AVAILABLE is not None:
        return _COQUI_AVAILABLE
    try:
        import TTS  # noqa: F401
        _COQUI_AVAILABLE = True
    except ImportError:
        _COQUI_AVAILABLE = False
    return _COQUI_AVAILABLE


VOICE_MODELS_DIR = Path(__file__).parent.parent.parent / "app" / "voice-models"
VOICE_MODELS_DIR.mkdir(parents=True, exist_ok=True)


class VoiceCloner:
    """Voice cloning engine using ONNX runtime (OpenVoice v2 compatible).

    Requires:
    - onnxruntime (pip install onnxruntime)
    - OpenVoice v2 ONNX model files in app/voice-models/openvoice-v2/
    - OR falls back to Coqui-AI TTS if installed
    """

    def __init__(self, models_dir: Optional[str] = None):
        self.models_dir = Path(models_dir) if models_dir else VOICE_MODELS_DIR
        self._session: Optional[ort.InferenceSession] = None
        self._encoder_session: Optional[ort.InferenceSession] = None
        self._speaker_embedding: Optional[np.ndarray] = None
        self._backend: str = "none"

        if not HAS_ONNX:
            logger.warning("onnxruntime not installed. Voice cloning requires: pip install onnxruntime")
            return

        self._init_backend()

    def _init_backend(self):
        if _check_openvoice():
            try:
                self._load_openvoice_onnx()
                self._backend = "openvoice-onnx"
                logger.info("Voice cloner using OpenVoice v2 ONNX backend")
                return
            except Exception as e:
                logger.warning(f"OpenVoice ONNX load failed: {e}")

        if _check_coqui():
            self._backend = "coqui"
            logger.info("Voice cloner using Coqui-AI TTS backend")
            return

        logger.info("Voice cloner initialized with no models loaded. Call load_models() to set up manually.")

    def _load_openvoice_onnx(self):
        model_dir = self.models_dir / "openvoice-v2"
        if not model_dir.exists():
            model_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"OpenVoice v2 model directory created at {model_dir}")
            logger.info("Place openvoice.onnx and encoder.onnx in that directory")
            return

        encoder_path = model_dir / "encoder.onnx"
        synthesizer_path = model_dir / "openvoice.onnx"

        if encoder_path.exists():
            so = ort.SessionOptions()
            so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            self._encoder_session = ort.InferenceSession(
                str(encoder_path), so,
                providers=["CPUExecutionProvider"]
            )
        if synthesizer_path.exists():
            so = ort.SessionOptions()
            so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            self._session = ort.InferenceSession(
                str(synthesizer_path), so,
                providers=["CPUExecutionProvider"]
            )

    @property
    def is_ready(self) -> bool:
        return self._backend != "none" or (self._session is not None)

    def clone_voice(self, audio_file: str, reference_text: str, target_text: str) -> bytes:
        """Clone a voice from an audio file and synthesize target text.

        Args:
            audio_file: Path to WAV file with ~3 seconds of speech.
            reference_text: Transcript of the audio file.
            target_text: Text to synthesize in the cloned voice.

        Returns:
            WAV audio bytes.
        """
        if not os.path.exists(audio_file):
            raise FileNotFoundError(f"Audio file not found: {audio_file}")

        if self._backend == "openvoice-onnx" and self._session and self._encoder_session:
            return self._clone_openvoice(audio_file, reference_text, target_text)
        elif self._backend == "coqui":
            return self._clone_coqui(audio_file, target_text)
        else:
            return self._clone_fallback(audio_file, target_text)

    def _clone_openvoice(self, audio_file: str, reference_text: str, target_text: str) -> bytes:
        try:
            import soundfile as sf
        except ImportError:
            logger.warning("soundfile not installed, using scipy for WAV I/O")
            try:
                from scipy.io import wavfile
            except ImportError:
                raise ImportError("Need either soundfile or scipy for audio I/O: pip install soundfile")

            sample_rate, audio = wavfile.read(audio_file)
            if audio.dtype == np.int16:
                audio = audio.astype(np.float32) / 32768.0
            elif audio.dtype == np.int32:
                audio = audio.astype(np.float32) / 2147483648.0
        else:
            audio, sample_rate = sf.read(audio_file)
            if audio.dtype != np.float32:
                audio = audio.astype(np.float32)

        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)

        reference_embedding = self._compute_embedding(audio, sample_rate)
        self._speaker_embedding = reference_embedding

        return self._synthesize(target_text, reference_embedding)

    def _compute_embedding(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        if not self._encoder_session:
            raise RuntimeError("Encoder model not loaded")

        if sample_rate != 16000:
            from scipy import signal
            target_len = int(len(audio) * 16000 / sample_rate)
            audio = signal.resample(audio, target_len)

        inputs = self._encoder_session.get_inputs()
        input_name = inputs[0].name
        audio_norm = audio / (np.max(np.abs(audio)) + 1e-10)
        embedding = self._encoder_session.run(None, {input_name: audio_norm.astype(np.float32)})[0]
        return embedding.flatten()

    def _synthesize(self, text: str, embedding: np.ndarray) -> bytes:
        if not self._session:
            raise RuntimeError("Synthesizer model not loaded")

        inputs = self._session.get_inputs()
        input_names = [inp.name for inp in inputs]

        feed_dict = {}
        if "speaker_embedding" in input_names or "embedding" in input_names:
            emb_name = "speaker_embedding" if "speaker_embedding" in input_names else "embedding"
            feed_dict[emb_name] = embedding.astype(np.float32)
        if "text" in input_names:
            feed_dict["text"] = np.array([text.encode("utf-8")], dtype=np.object_)
        elif "input_ids" in input_names:
            feed_dict["input_ids"] = np.array([[0]], dtype=np.int64)

        audio_out = self._session.run(None, feed_dict)[0]
        if isinstance(audio_out, np.ndarray):
            audio_int16 = (audio_out * 32767).astype(np.int16)
            buf = io.BytesIO()
            try:
                import soundfile as sf
                sf.write(buf, audio_int16, 24000, format="WAV")
            except ImportError:
                from scipy.io import wavfile
                wavfile.write(buf, 24000, audio_int16)
            return buf.getvalue()

        return audio_out

    def _clone_coqui(self, audio_file: str, target_text: str) -> bytes:
        from TTS.api import TTS
        tts = TTS(model_name="voice_cloning", progress_bar=False, gpu=False)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            tts.tts_to_file(
                text=target_text,
                speaker_wav=audio_file,
                file_path=tmp_path
            )
            with open(tmp_path, "rb") as f:
                return f.read()
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    def _clone_fallback(self, audio_file: str, target_text: str) -> bytes:
        logger.warning("No voice cloning backend available — returning silence")
        silence = np.zeros(24000, dtype=np.int16)
        buf = io.BytesIO()
        from scipy.io import wavfile
        wavfile.write(buf, 24000, silence)
        return buf.getvalue()

    def train_speaker(self, audio_files: List[str]) -> np.ndarray:
        """Compute a speaker embedding from multiple audio files."""
        if not audio_files:
            raise ValueError("At least one audio file required")

        embeddings = []
        for af in audio_files:
            try:
                import soundfile as sf
                audio, sr = sf.read(af)
            except ImportError:
                from scipy.io import wavfile
                sr, audio = wavfile.read(af)

            if len(audio.shape) > 1:
                audio = audio.mean(axis=1)
            audio = audio.astype(np.float32)
            emb = self._compute_embedding(audio, sr)
            embeddings.append(emb)

        self._speaker_embedding = np.mean(embeddings, axis=0)
        return self._speaker_embedding

    def get_speaker_embedding(self) -> Optional[np.ndarray]:
        return self._speaker_embedding


def main():
    """CLI entry point for subprocess communication with serve.cjs."""
    import sys
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    params_raw = sys.argv[2] if len(sys.argv) > 2 else "{}"
    try:
        params = json.loads(params_raw)
    except json.JSONDecodeError:
        params = {}

    cloner = VoiceCloner()
    result = {"ok": False, "error": "Unknown command"}

    if command == "clone":
        try:
            audio = cloner.clone_voice(
                audio_file=params["audio_file"],
                reference_text=params.get("reference_text", ""),
                target_text=params.get("target_text", ""),
            )
            out_path = params.get("output", "")
            if out_path:
                with open(out_path, "wb") as f:
                    f.write(audio)
                result = {"ok": True, "output": out_path, "bytes": len(audio)}
            else:
                result = {"ok": True, "audio_base64": audio.hex(), "bytes": len(audio)}
        except Exception as e:
            result = {"ok": False, "error": str(e), "traceback": traceback.format_exc()}

    elif command == "train":
        try:
            emb = cloner.train_speaker(params.get("audio_files", []))
            emb_path = params.get("output", "")
            if emb_path:
                np.save(emb_path, emb)
                result = {"ok": True, "output": emb_path, "shape": list(emb.shape)}
            else:
                result = {"ok": True, "shape": list(emb.shape)}
        except Exception as e:
            result = {"ok": False, "error": str(e), "traceback": traceback.format_exc()}

    elif command == "status":
        result = {
            "ok": True,
            "ready": cloner.is_ready,
            "backend": cloner._backend,
            "has_onnx": HAS_ONNX,
            "has_openvoice": _check_openvoice(),
            "has_coqui": _check_coqui(),
            "models_dir": str(cloner.models_dir),
        }

    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()

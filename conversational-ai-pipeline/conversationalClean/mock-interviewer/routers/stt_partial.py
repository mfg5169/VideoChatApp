# routers/stt_partial.py
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from typing import Optional

import av
from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from pydantic import BaseModel
from faster_whisper import WhisperModel

logger = logging.getLogger(__name__)
router = APIRouter()

# Skip transcribe for very small uploads (Whisper often fails on near-empty audio)
MIN_AUDIO_BYTES = 500

MODEL_SIZE = os.getenv("STT_MODEL_SIZE", "small")
COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "int8")
DEVICE = os.getenv("STT_DEVICE", "cpu")

_model: Optional[WhisperModel] = None
# Only one transcribe at a time; faster_whisper is not safe for concurrent use
_transcribe_lock = asyncio.Lock()


def get_model() -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
    return _model


def _transcribe_sync(path: str, language: str) -> str:
    model = get_model()
    segments, _info = model.transcribe(
        path,
        language=language,
        beam_size=1,
        vad_filter=False,
        temperature=0.0,
    )
    parts = []
    for s in segments:
        t = (s.text or "").strip()
        if t:
            parts.append(t)
    return " ".join(parts).strip()


class STTPartialOut(BaseModel):
    text: str


@router.post("/stt_partial", response_model=STTPartialOut)
async def stt_partial(
    audio: UploadFile = File(...),
    language: str = Query(default="en"),
):
    suffix = os.path.splitext(audio.filename or "")[1] or ".webm"
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
            data = await audio.read()
            tmp.write(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read upload: {e}")

    try:
        size = os.path.getsize(tmp_path)
        if size < MIN_AUDIO_BYTES:
            return STTPartialOut(text="")

        loop = asyncio.get_event_loop()
        async with _transcribe_lock:
            text = await loop.run_in_executor(
                None,
                lambda: _transcribe_sync(tmp_path, language),
            )
        return STTPartialOut(text=text)
    except av.error.InvalidDataError as e:
        logger.warning("Invalid audio data (e.g. truncated WebM): %s", e)
        return STTPartialOut(text="")
    except Exception as e:
        logger.exception("STT partial failed: %s", e)
        raise HTTPException(status_code=500, detail=f"STT partial failed: {e}")
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass
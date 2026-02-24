# routers/stt.py
from __future__ import annotations

import os
import tempfile
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from pydantic import BaseModel
from faster_whisper import WhisperModel

router = APIRouter()

# ---- Model init (load once) ----
# Good defaults for M2: "small" or "medium". Start with "small" for speed.
MODEL_SIZE = os.getenv("STT_MODEL_SIZE", "small")
COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "int8")  # int8 is usually fast on CPU
DEVICE = os.getenv("STT_DEVICE", "cpu")

# Lazy global
_model: Optional[WhisperModel] = None

def get_model() -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
    return _model


class STTOut(BaseModel):
    text: str
    language: Optional[str] = None
    segments: List[Dict[str, Any]]


@router.post("/stt", response_model=STTOut)
async def stt(
    audio: UploadFile = File(...),
    # Optional knobs
    language: Optional[str] = Query(default=None, description="e.g. 'en' to force English"),
    vad_filter: bool = Query(default=True, description="Enable VAD to ignore silence"),
):
    # Save to temp file
    suffix = os.path.splitext(audio.filename or "")[1] or ".wav"
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
            content = await audio.read()
            tmp.write(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read upload: {e}")

    try:
        model = get_model()

        segments, info = model.transcribe(
            tmp_path,
            language=language,           # None = auto-detect
            vad_filter=vad_filter,       # helps a lot for push-to-talk recordings
            beam_size=5,
        )

        seg_list = []
        full_text_parts = []
        for s in segments:
            seg_list.append({
                "start": float(s.start),
                "end": float(s.end),
                "text": s.text,
            })
            full_text_parts.append(s.text)

        full_text = " ".join(t.strip() for t in full_text_parts).strip()

        return STTOut(
            text=full_text,
            language=getattr(info, "language", None),
            segments=seg_list,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"STT failed: {e}")
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass


@router.get("/stt/health")
async def stt_health():
    # Just confirm the model can load
    try:
        _ = get_model()
        return {"ok": True, "model": MODEL_SIZE, "device": DEVICE, "compute_type": COMPUTE_TYPE}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"STT not ready: {e}")
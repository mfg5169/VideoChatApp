# routers/tts.py
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
router = APIRouter()

# Configurable via env var so you can change ports/hosts without code edits
PIPER_BASE_URL = os.getenv("PIPER_BASE_URL", "http://127.0.0.1:5000")


class TTSIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)

    # Piper-compatible knobs (all optional)
    speaker_id: Optional[int] = None
    length_scale: Optional[float] = Field(default=None, gt=0.0, le=3.0)  # speed (lower=faster)
    noise_scale: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    noise_w: Optional[float] = Field(default=None, ge=0.0, le=1.0)


@router.get("/tts/health")
async def tts_health():
    # Piper doesn't necessarily have a health endpoint, so we just do a tiny synth call.
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(PIPER_BASE_URL, json={"text": "ok"})
            r.raise_for_status()
        return {"ok": True, "piper_url": PIPER_BASE_URL}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Piper not reachable at {PIPER_BASE_URL}: {e}")


@router.post("/tts")
async def tts(payload: TTSIn):
    # Proxy to Piper and return WAV bytes
    req = {"text": payload.text}

    # Only include keys if present (keeps compatibility with Piper versions)
    if payload.speaker_id is not None:
        req["speaker_id"] = payload.speaker_id
    if payload.length_scale is not None:
        req["length_scale"] = payload.length_scale
    if payload.noise_scale is not None:
        req["noise_scale"] = payload.noise_scale
    if payload.noise_w is not None:
        req["noise_w"] = payload.noise_w

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(PIPER_BASE_URL, json=req)
            r.raise_for_status()

            # Piper returns raw WAV bytes
            audio_bytes = r.content

        return Response(
            content=audio_bytes,
            media_type="audio/wav",
            headers={
                # Helps browsers/Electron treat it like a file stream
                "Content-Disposition": 'inline; filename="tts.wav"'
            },
        )
    except httpx.HTTPStatusError as e:
        # Piper returned 4xx/5xx (e.g. 400 bad request, 500 server error)
        logger.warning("Piper TTS returned %s: %s", e.response.status_code, e.response.text[:500])
        raise HTTPException(
            status_code=502,
            detail=f"Piper error (HTTP {e.response.status_code}): {e.response.text[:500]}",
        )
    except httpx.ConnectError as e:
        logger.warning("Piper TTS not reachable at %s: %s", PIPER_BASE_URL, e)
        raise HTTPException(
            status_code=503,
            detail=f"Piper not reachable at {PIPER_BASE_URL}. Is the TTS server running?",
        )
    except Exception as e:
        logger.exception("TTS request failed")
        raise HTTPException(status_code=503, detail=f"Failed to synthesize speech: {e}")
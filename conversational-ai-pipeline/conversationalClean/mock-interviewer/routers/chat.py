"""Simple /chat endpoint."""

import httpx
from fastapi import APIRouter

from uts.config import MODEL, OLLAMA_URL
from uts.models import ChatIn

router = APIRouter()


@router.post("/chat")
async def chat(payload: ChatIn):
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": payload.message},
        ],
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(OLLAMA_URL, json=body)
        r.raise_for_status()
        data = r.json()
    return {"reply": data["message"]["content"]}

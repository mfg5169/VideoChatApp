"""Job description: /set_job_description."""

import httpx
from fastapi import APIRouter

from uts.config import MODEL, OLLAMA_URL
from db import load_session, save_session
from uts.models import SetJDIn
from uts.prompts import JD_PARSER_SYSTEM
from uts.utils import parse_json_loose, strip_code_fences

router = APIRouter()


@router.post("/set_job_description")
async def set_job_description(payload: SetJDIn):
    state = await load_session(payload.session_id)
    state["job_description_raw"] = payload.job_description
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": JD_PARSER_SYSTEM},
            {"role": "user", "content": payload.job_description},
        ],
        "stream": False,
        "options": {"temperature": 0.2},
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(OLLAMA_URL, json=body)
        r.raise_for_status()
        data = r.json()
    raw = data["message"]["content"].strip()
    clean = strip_code_fences(raw)
    try:
        jd_struct = parse_json_loose(clean)
    except Exception:
        return {"error": "jd_parser_output_not_valid_json", "raw": raw, "clean": clean[:1200]}
    state["job_description_struct"] = jd_struct
    await save_session(payload.session_id, state)
    return {"ok": True, "job_description_struct": jd_struct, "state": state}

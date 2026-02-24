"""Resume: /set_resume (parse + seed memory)."""

import httpx
from fastapi import APIRouter

from uts.config import MODEL, OLLAMA_URL
from db import load_session, save_session
from uts.dependencies import get_mem_store
from uts.models import SetResumeIn
from uts.prompts import RESUME_PARSER_SYSTEM
from uts.utils import parse_json_loose, strip_code_fences

router = APIRouter()


@router.post("/set_resume")
async def set_resume(payload: SetResumeIn):
    mem_store = get_mem_store()
    state = await load_session(payload.session_id)
    state["resume_raw"] = payload.resume_text
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": RESUME_PARSER_SYSTEM},
            {"role": "user", "content": payload.resume_text},
        ],
        "stream": False,
        "options": {"num_predict": 1200, "temperature": 0.1},
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(OLLAMA_URL, json=body)
        r.raise_for_status()
        data = r.json()
    raw = data["message"]["content"].strip()
    clean = strip_code_fences(raw)
    try:
        resume_struct = parse_json_loose(clean)
    except Exception:
        return {"error": "resume_parser_output_not_valid_json", "raw": raw, "clean": clean[:1200]}
    state["resume_struct"] = resume_struct
    await save_session(payload.session_id, state)
    company = state.get("company", "Myles Inc.")
    role_title = state.get("role_title", "Unknown")
    top_skills = resume_struct.get("top_skills", [])[:25]
    if top_skills:
        mem_store.add_or_update_memory(
            text=f"Candidate top skills: {top_skills}",
            session_id=payload.session_id,
            mem_type="skill_evidence",
            tags=["resume", "skills"] + top_skills[:10],
            importance=4,
            role_title=role_title,
            company=company,
        )

    def seed_item(kind: str, item: dict):
        name = item.get("company") if kind == "role" else item.get("name")
        bullets = item.get("bullets", [])[:6]
        skills = item.get("skills", [])[:15]
        hooks = item.get("story_hooks", [])[:8]
        if bullets:
            mem_store.add_or_update_memory(
                text=f"{kind.upper()} {name}: bullets={bullets}",
                session_id=payload.session_id,
                mem_type="skill_evidence",
                tags=["resume", kind] + skills[:10],
                importance=3,
                role_title=role_title,
                company=company,
                extra={"source_name": str(name)[:80]},
            )
        for h in hooks:
            topic = h.get("topic", "ownership")
            hook = h.get("hook", "")
            if hook:
                mem_store.add_or_update_memory(
                    text=f"Story hook ({topic}) from {kind} {name}: {hook}",
                    session_id=payload.session_id,
                    mem_type="story_hook",
                    tags=["resume", "story", topic] + skills[:8],
                    importance=4,
                    role_title=role_title,
                    company=company,
                    extra={"source_name": str(name)[:80], "topic": topic},
                )

    for ritem in resume_struct.get("roles", [])[:8]:
        seed_item("role", ritem)
    for pitem in resume_struct.get("projects", [])[:8]:
        seed_item("project", pitem)
    return {"ok": True, "resume_struct": resume_struct, "state": state}

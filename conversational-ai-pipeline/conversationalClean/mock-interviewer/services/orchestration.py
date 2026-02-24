"""Interview orchestration: persona speech, consistency check, and next-question helpers."""

import httpx

from uts.config import MODEL, OLLAMA_URL
from uts.prompts import CONSISTENCY_CHECK_SYSTEM, PERSONA_SYSTEM
from uts.utils import parse_json_loose


def choose_speaker(state: dict) -> dict:
    """Round-robin panel speaker by turn_index."""
    panel = state["panel"]
    idx = state["turn_index"] % len(panel)
    return panel[idx]


def question_prompt_for_turn(state: dict, speaker_type: str) -> str:
    """Deterministic behavioral sequence for /next_question (simple flow)."""
    t = state["turn_index"]
    if t == 0:
        return "Start the interview. Ask the candidate to introduce themselves."
    if t == 1 and speaker_type in ("hiring_manager", "recruiter"):
        return "Ask why the candidate is interested in this role and Myles Inc."
    themes = [
        "ownership/initiative",
        "conflict/disagreement",
        "failure/learning",
        "ambiguity/prioritization",
        "collaboration/stakeholder communication",
    ]
    theme = themes[(t - 2) % len(themes)]
    return f"Ask a behavioral question about {theme}. Prefer STAR."


async def run_consistency_check(
    session_id: str, state: dict, question: str, answer: str, recent_turns: list
) -> dict:
    """Call LLM to check candidate answer vs resume/memory; return parsed JSON."""
    resume_struct = state.get("resume_struct") or {}
    resume_facts = {
        "roles": (resume_struct.get("roles") or [])[:4],
        "projects": (resume_struct.get("projects") or [])[:4],
        "top_skills": (resume_struct.get("top_skills") or [])[:20],
    }
    last_mem_ids = state.get("last_prompted_memory_ids", [])[:2]
    checker_input = {
        "question": question,
        "candidate_answer": answer[:1200],
        "resume_facts": resume_facts,
        "last_prompted_memory_ids": last_mem_ids,
        "recent_turns": recent_turns[-4:],
    }
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": CONSISTENCY_CHECK_SYSTEM},
            {"role": "user", "content": f"Check consistency:\n{checker_input}"},
        ],
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 600},
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(OLLAMA_URL, json=body)
        r.raise_for_status()
        data = r.json()
    raw = data["message"]["content"].strip()
    return parse_json_loose(raw)


async def persona_speak(
    persona_type: str,
    persona_name: str,
    instruction: str,
    extra_context: str = "",
) -> str:
    """Have a panel persona generate the next question text via LLM."""
    system_prompt = PERSONA_SYSTEM[persona_type]
    if extra_context:
        system_prompt = system_prompt + "\n\n" + extra_context
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": instruction},
        ],
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(OLLAMA_URL, json=body)
        r.raise_for_status()
        data = r.json()
    return data["message"]["content"].strip()

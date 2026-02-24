"""Session and panel routes: start_session, set_panel, next_question, next_turn."""

import httpx
from fastapi import APIRouter

from uts.config import MODEL, OLLAMA_URL
from db import add_turn, create_session, get_recent_turns, load_session, save_session
from uts.models import NextQIn, NextTurnIn, SetPanelIn, StartIn
from uts.prompts import ORCHESTRATOR_SYSTEM, PANEL_PRESETS, PERSONA_SYSTEM
from services.orchestration import choose_speaker, persona_speak, question_prompt_for_turn
from uts.utils import contains_non_english_chars, merge_unique, parse_json_loose

router = APIRouter()


@router.post("/start_session")
async def start_session(payload: StartIn):
    import uuid
    session_id = str(uuid.uuid4())
    state = await create_session(session_id, payload.role_title)
    return {"session_id": session_id, "state": state}


@router.post("/set_panel")
async def set_panel(payload: SetPanelIn):
    state = await load_session(payload.session_id)
    if payload.panel_type not in PANEL_PRESETS:
        return {"error": "unknown panel_type", "allowed": list(PANEL_PRESETS.keys())}
    state["panel"] = PANEL_PRESETS[payload.panel_type]
    await save_session(payload.session_id, state)
    return {"ok": True, "state": state}


@router.post("/next_question")
async def next_question(payload: NextQIn):
    state = await load_session(payload.session_id)
    speaker = choose_speaker(state)
    persona_type = speaker["type"]
    system_prompt = PERSONA_SYSTEM[persona_type]
    user_prompt = question_prompt_for_turn(state, persona_type)
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(OLLAMA_URL, json=body)
        r.raise_for_status()
        data = r.json()
    question = data["message"]["content"].strip()
    display_name = f'{speaker["name"]} ({persona_type.replace("_", " ").title()})'
    await add_turn(payload.session_id, speaker["id"], question)
    state["turn_index"] += 1
    state["last_question"] = question
    await save_session(payload.session_id, state)
    return {"speaker": display_name, "text": question, "state": state}


@router.post("/next_turn")
async def next_turn(payload: NextTurnIn):
    from uts.dependencies import get_mem_store

    mem_store = get_mem_store()
    state = await load_session(payload.session_id)
    panel = state.get("panel", [])
    if not panel:
        return {"error": "No panel in session state. Call /set_panel or use defaults."}

    # Buffered question path: skip orchestrator, ask buffered question
    if (not state.get("clarification_mode")) and state.get("pending_question_prompt"):
        buffered_prompt = state["pending_question_prompt"]
        buffered_speaker_id = state.get("pending_speaker_id")
        state["pending_question_prompt"] = None
        state["pending_speaker_id"] = None
        forced_use_ids = state.get("pending_use_memory_ids", [])[:2]
        state["pending_use_memory_ids"] = []
        await save_session(payload.session_id, state)
        plan = {
            "next_speaker_id": buffered_speaker_id or panel[0]["id"],
            "question_intent": "ask_new",
            "topic": state.get("last_topic") or "behavioral",
            "question_prompt": buffered_prompt,
            "rubric": {},
            "use_memory_ids": forced_use_ids,
            "followup_comment": "",
            "should_interrupt": False,
            "difficulty": state.get("difficulty_level", 2),
        }
        memories = []  # buffered path: no retrieval
    else:
        plan = None
        memories = None

    recent_turns = await get_recent_turns(payload.session_id, limit=14)
    weaknesses = state.get("weaknesses", [])
    strengths = state.get("strengths", [])
    topics_covered = state.get("topics_covered", [])
    turn_index = state.get("turn_index", 0)
    last_q = state.get("last_question")

    if plan is None:
        orchestrator_input = {
            "company": state.get("company", "Myles Inc."),
            "mode": state.get("mode", "behavioral_standard"),
            "role_title": state.get("role_title", "Unknown"),
            "panel": panel,
            "turn_index": turn_index,
            "topics_covered": topics_covered[-20:],
            "weakness_tags": weaknesses[-20:],
            "strength_tags": strengths[-20:],
            "last_question": last_q,
            "recent_turns": recent_turns[-10:],
            "job_description_struct": state.get("job_description_struct"),
            "phase_hint": "opening" if turn_index < 2 else ("closing" if turn_index >= 8 else "core"),
        }
        jd = state.get("job_description_struct") or {}
        jd_keywords = jd.get("keywords", [])[:12]
        weakness_tags = weaknesses[-10:]
        role_title = state.get("role_title", "Unknown")
        retrieval_query = (
            f"behavioral interview. role={role_title}. "
            f"topics_covered={topics_covered[-8:]}. "
            f"weaknesses={weakness_tags}. "
            f"jd_keywords={jd_keywords}."
        )
        memories = mem_store.search(
            query=retrieval_query, top_k=10, tag_filter_any=(weakness_tags if weakness_tags else None), min_importance=2
        )
        if len(memories) < 5:
            memories = mem_store.search(query=retrieval_query, top_k=10, tag_filter_any=None, min_importance=2)
        orchestrator_input["relevant_memories"] = [
            {
                "id": m["id"],
                "text": m["text"][:400],
                "type": m["meta"].get("type"),
                "tags": m["meta"].get("tags"),
                "importance": m["meta"].get("importance"),
                "source_name": m["meta"].get("source_name"),
                "topic": m["meta"].get("topic"),
            }
            for m in memories
        ]
        orchestrator_input["followup_streak"] = state.get("followup_streak", 0)
        orchestrator_input["last_topic"] = state.get("last_topic")
        orchestrator_input["last_intent"] = state.get("last_intent")
        orchestrator_input["last_answer_summary"] = state.get("last_answer_summary")
        orchestrator_input["difficulty_level"] = state.get("difficulty_level", 2)
        orchestrator_input["last_prompted_memory_ids"] = state.get("last_prompted_memory_ids", [])

        body = {
            "model": MODEL,
            "messages": [
                {"role": "system", "content": ORCHESTRATOR_SYSTEM},
                {"role": "user", "content": f"Decide the next turn:\n{orchestrator_input}"},
            ],
            "stream": False,
        }
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(OLLAMA_URL, json=body)
            r.raise_for_status()
            data = r.json()
        raw = data["message"]["content"].strip()
        try:
            plan = parse_json_loose(raw)
        except Exception:
            return {"error": "orchestrator_output_not_valid_json", "raw": raw}

        if state.get("clarification_mode") and state.get("open_contradictions"):
            if not state.get("pending_question_prompt"):
                state["pending_question_prompt"] = plan.get("question_prompt")
                state["pending_speaker_id"] = plan.get("next_speaker_id")
                state["pending_use_memory_ids"] = plan.get("use_memory_ids", [])[:2]
            c = state["open_contradictions"][0]
            plan["question_intent"] = "follow_up"
            plan["topic"] = "clarification"
            plan["use_memory_ids"] = state.get("pending_use_memory_ids", [])[:2]
            plan["question_prompt"] = (
                "Ask a short clarification question to resolve this contradiction:\n"
                f"{c.get('clarifying_question')}"
            )
            plan["should_interrupt"] = True
            plan["followup_comment"] = "Before we continue, I want to clarify something quickly."

    use_ids = plan.get("use_memory_ids", [])[:2]
    state["last_prompted_memory_ids"] = use_ids
    speaker_id = plan["next_speaker_id"]
    speaker = next((p for p in panel if p["id"] == speaker_id), None) or panel[0]
    persona_type = speaker["type"]
    persona_name = speaker["name"]

    mem_by_id = {m["id"]: m for m in memories}
    anchor_texts = []
    for mid in use_ids:
        m = mem_by_id.get(mid)
        if m:
            anchor_texts.append(f"- ({m['meta'].get('type','memory')}) {m['text'][:260]}")
    memory_anchor_block = ""
    if anchor_texts:
        memory_anchor_block = "MEMORY ANCHORS (use these to ground the question):\n" + "\n".join(anchor_texts) + "\n"

    jd2 = state.get("job_description_struct") or {}
    must = jd2.get("must_have_skills", [])
    resp = jd2.get("responsibilities", [])
    extra = ""
    if persona_type == "senior_engineer" and (must or resp):
        extra = (
            "INTERVIEW CONTEXT:\n"
            f"- Role target: {state.get('role_title','Unknown')}\n"
            f"- Must-have skills (use to tailor questions): {must[:12]}\n"
            f"- Key responsibilities (use to tailor questions): {resp[:8]}\n"
            "CRITICAL LANGUAGE RULE: English only. No non-English characters.\n"
        )
    instruction = memory_anchor_block + "\n" + plan["question_prompt"]
    spoken_q = await persona_speak(persona_type, persona_name, instruction, extra_context=extra)
    comment = (plan.get("followup_comment") or "").strip()
    should_interrupt = bool(plan.get("should_interrupt", False))
    prefix = ""
    if comment:
        prefix = f"{comment} "
        if should_interrupt:
            prefix = f"Let me stop you there for a second. {comment} "
    spoken = prefix + spoken_q if prefix else spoken_q
    if contains_non_english_chars(spoken):
        retry_instruction = instruction + "\n\nCRITICAL LANGUAGE RULE: Always respond in English only. Do not use Chinese or any non-English characters."
        spoken_q = await persona_speak(persona_type, persona_name, retry_instruction, extra_context=extra)
        spoken = prefix + spoken_q if prefix else spoken_q

    await add_turn(payload.session_id, speaker["id"], spoken)
    state["turn_index"] = turn_index + 1
    state["last_question"] = spoken
    state["topics_covered"] = merge_unique(topics_covered, [plan.get("topic", "behavioral")])
    state["last_topic"] = plan.get("topic")
    state["last_intent"] = plan.get("question_intent")
    if plan.get("question_intent") == "follow_up":
        state["followup_streak"] = int(state.get("followup_streak", 0)) + 1
    else:
        state["followup_streak"] = 0
    d = int(plan.get("difficulty", state.get("difficulty_level", 2)))
    state["difficulty_level"] = max(1, min(5, d))
    await save_session(payload.session_id, state)
    display_name = f'{persona_name} ({persona_type.replace("_"," ").title()})'
    return {
        "speaker": display_name,
        "text": spoken,
        "topic": plan.get("topic"),
        "intent": plan.get("question_intent"),
        "rubric_flags": plan.get("rubric", {}),
        "state": state,
    }

"""Grade candidate answer: /answer (grading, consistency, memory, state updates)."""

import json
import httpx
from fastapi import APIRouter

from uts.config import MODEL, OLLAMA_URL
from db import add_grade, add_turn, get_recent_turns, load_session, save_session
from uts.dependencies import get_mem_store
from uts.models import AnswerIn
from uts.prompts import BEHAVIORAL_RUBRIC, GRADER_SYSTEM
from services.orchestration import run_consistency_check
from uts.utils import merge_unique, parse_json_loose

router = APIRouter()


@router.post("/answer")
async def answer(payload: AnswerIn):
    mem_store = get_mem_store()
    state = await load_session(payload.session_id)
    question = state.get("last_question")
    if not question:
        return {"error": "No last_question found. Call /next_question first."}

    recent_turns = await get_recent_turns(payload.session_id, limit=10)
    grader_user = {
        "question": question,
        "answer": payload.answer,
        "rubric": BEHAVIORAL_RUBRIC,
        "recent_context": recent_turns[-6:],
        "role_title": state.get("role_title", "Unknown"),
        "company": state.get("company", "Myles Inc."),
    }
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": GRADER_SYSTEM},
            {"role": "user", "content": f"Grade this:\n{grader_user}"},
        ],
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(OLLAMA_URL, json=body)
        r.raise_for_status()
        data = r.json()
    raw = data["message"]["content"].strip()
    await add_turn(payload.session_id, "candidate", payload.answer)

    try:
        grade_obj = parse_json_loose(raw)
        grade_json = json.dumps(grade_obj)
        state["last_grade_overall"] = float(grade_obj.get("overall") or 0.0)
        state["last_answer_summary"] = {
            "key_strengths": grade_obj.get("detected_strength_tags", [])[:6],
            "key_weaknesses": grade_obj.get("detected_weakness_tags", [])[:6],
            "top_improve": grade_obj.get("what_to_improve", [])[:2],
            "one_sentence_better": grade_obj.get("one_sentence_better_answer", ""),
        }

        # Consistency / contradiction check (single block)
        try:
            consistency = await run_consistency_check(
                payload.session_id, state, question, payload.answer, recent_turns
            )
        except Exception:
            consistency = {"has_contradiction": False, "contradictions": []}
        if consistency.get("has_contradiction"):
            contras = consistency.get("contradictions", [])
            for c in contras[:2]:
                state["open_contradictions"] = (state.get("open_contradictions") or [])
                state["open_contradictions"].append(c)
                mem_store.add_or_update_memory(
                    text=(
                        f"CONTRADICTION [{c.get('key')}], kind={c.get('kind')}, severity={c.get('severity')}\n"
                        f"existing: {c.get('existing')}\n"
                        f"new: {c.get('new')}\n"
                        f"clarify: {c.get('clarifying_question')}"
                    ),
                    session_id=payload.session_id,
                    mem_type="contradiction",
                    tags=["contradiction", c.get("severity", "medium"), c.get("kind", "candidate_vs_resume")],
                    importance=4 if c.get("severity") == "high" else 3,
                    role_title=state.get("role_title", "Unknown"),
                    company=state.get("company", "Myles Inc."),
                )
                state["mem_write_count"] = int(state.get("mem_write_count", 0)) + 1
            if any(c.get("severity") == "high" for c in contras):
                state["clarification_mode"] = True

    except Exception:
        await add_grade(
            payload.session_id, state["turn_index"], question, payload.answer, raw
        )
        return {
            "question": question,
            "answer": payload.answer,
            "grade_raw_json": raw,
            "error": "grader_output_not_valid_json",
        }

    await add_grade(
        payload.session_id, state["turn_index"], question, payload.answer, grade_json
    )

    feedback_text = (
        f"Feedback summary for {state.get('role_title','Unknown')} at {state.get('company','Myles Inc.')}: "
        f"overall={grade_obj.get('overall')}. "
        f"Weaknesses={grade_obj.get('detected_weakness_tags', [])}. "
        f"Strengths={grade_obj.get('detected_strength_tags', [])}. "
        f"Top improvements={grade_obj.get('what_to_improve', [])[:2]}."
    )
    mem_store.add_or_update_memory(
        text=feedback_text,
        session_id=payload.session_id,
        mem_type="feedback_trend",
        tags=(grade_obj.get("detected_weakness_tags", []) + grade_obj.get("detected_strength_tags", []))[:20],
        importance=3,
        role_title=state.get("role_title", "Unknown"),
        company=state.get("company", "Myles Inc."),
    )
    state["mem_write_count"] = int(state.get("mem_write_count", 0)) + 1
    if state["mem_write_count"] % 10 == 0:
        mem_store.prune_session(
            session_id=payload.session_id,
            keep_per_type={
                "feedback_trend": 30,
                "skill_evidence": 80,
                "story_hook": 60,
                "contradiction": 30,
                "profile_fact": 50,
            },
        )
    scores = grade_obj.get("scores", {})
    overall = float(grade_obj.get("overall") or 0.0)
    if overall >= 3.5 or (scores.get("star_structure", 0) >= 4 and scores.get("communication", 0) >= 4):
        story_text = (
            "Reusable behavioral story:\n"
            f"Q: {question}\n"
            f"Better 1-sentence: {grade_obj.get('one_sentence_better_answer','')}\n"
            f"Key strengths: {grade_obj.get('detected_strength_tags', [])}\n"
            f"Candidate answer excerpt: {payload.answer[:400]}"
        )
        mem_store.add_or_update_memory(
            text=story_text,
            session_id=payload.session_id,
            mem_type="story",
            tags=["story"] + grade_obj.get("detected_strength_tags", [])[:10],
            importance=4,
            role_title=state.get("role_title", "Unknown"),
            company=state.get("company", "Myles Inc."),
        )
        state["mem_write_count"] = int(state.get("mem_write_count", 0)) + 1
        if state["mem_write_count"] % 10 == 0:
            mem_store.prune_session(
                session_id=payload.session_id,
                keep_per_type={
                    "feedback_trend": 30,
                    "skill_evidence": 80,
                    "story_hook": 60,
                    "contradiction": 30,
                    "profile_fact": 50,
                },
            )
    weaknesses = merge_unique(state.get("weaknesses", []), grade_obj.get("detected_weakness_tags", []))
    strengths = merge_unique(state.get("strengths", []), grade_obj.get("detected_strength_tags", []))
    state["weaknesses"] = weaknesses
    state["strengths"] = strengths
    state["topics_covered"] = merge_unique(state.get("topics_covered", []), ["behavioral"])
    state["session_summary"] = (state.get("session_summary", "") + "\n"
        + f"- Q: {question}\n"
        + f"- Key feedback: {', '.join(grade_obj.get('what_to_improve', [])[:2])}\n"
        + f"- Weakness tags: {', '.join(grade_obj.get('detected_weakness_tags', []))}\n"
        + f"- Strength tags: {', '.join(grade_obj.get('detected_strength_tags', []))}\n"
    )
    await save_session(payload.session_id, state)
    return {
        "question": question,
        "answer": payload.answer,
        "scores": grade_obj.get("scores", {}),
        "overall": grade_obj.get("overall"),
        "what_went_well": grade_obj.get("what_went_well", []),
        "what_to_improve": grade_obj.get("what_to_improve", []),
        "one_sentence_better_answer": grade_obj.get("one_sentence_better_answer", ""),
        "recommended_followup": grade_obj.get("recommended_followup", ""),
        "weaknesses": state["weaknesses"],
        "strengths": state["strengths"],
        "state": state,
    }

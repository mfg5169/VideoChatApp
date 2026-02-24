import aiosqlite
import json
from typing import Any, Dict

DB_PATH = "app.db"

# DEFAULT_STATE = {
#     "company": "Myles Inc.",
#     "mode": "behavioral_standard",
#     "role_title": "Unknown",
#     "panel": [{"id": "hm", "type": "hiring_manager", "name": "Jordan"}],
#     "turn_index": 0,
#     "topics_covered": [],
#     "session_summary": "",
#     "last_question": None
# }

DEFAULT_STATE = {
    "company": "Myles Inc.",
    "mode": "behavioral_standard",
    "role_title": "Unknown",
    "panel": [{"id": "hm", "type": "hiring_manager", "name": "Jordan"}],
    "turn_index": 0,
    "topics_covered": [],
    "session_summary": "",
    "last_question": None,
    "weaknesses": [],
    "strengths": [],
    "job_description_raw": None,
    "job_description_struct": None,
    "resume_raw": None,
    "resume_struct": None,
    "last_prompted_memory_ids": [],
    "followup_streak": 0,          # how many follow-ups in a row on same topic/story
    "last_topic": None,
    "last_intent": None,
    "last_answer_summary": None,   # compact summary of what candidate said
    "last_grade_overall": None,
    "difficulty_level": 2,         # 1..5
    "pending_question_prompt": None,
    "pending_speaker_id": None,
    "pending_use_memory_ids": [],
    "clarification_mode": False,
    "open_contradictions": [],  # list of dicts from checker
    "mem_write_count": 0
}

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            state_json TEXT NOT NULL
        )
        """)
        await db.execute("""
        CREATE TABLE IF NOT EXISTS turns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            speaker TEXT NOT NULL,
            text TEXT NOT NULL
        )
        """)
        
        await db.execute("""
        CREATE TABLE IF NOT EXISTS grades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            turn_index INTEGER NOT NULL,
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            grader_json TEXT NOT NULL
        )
        """)
        await db.commit()
    

async def create_session(session_id: str, role_title: str | None = None) -> Dict[str, Any]:
    state = dict(DEFAULT_STATE)
    if role_title:
        state["role_title"] = role_title
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO sessions (session_id, state_json) VALUES (?, ?)",
            (session_id, json.dumps(state)),
        )
        await db.commit()
    return state

async def load_session(session_id: str) -> Dict[str, Any]:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT state_json FROM sessions WHERE session_id = ?", (session_id,)) as cur:
            row = await cur.fetchone()
            if not row:
                raise KeyError("session not found")
            return json.loads(row[0])

async def save_session(session_id: str, state: Dict[str, Any]) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE sessions SET state_json = ? WHERE session_id = ?",
            (json.dumps(state), session_id),
        )
        await db.commit()

async def add_turn(session_id: str, speaker: str, text: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO turns (session_id, speaker, text) VALUES (?, ?, ?)",
            (session_id, speaker, text),
        )
        await db.commit()

async def add_grade(session_id: str, turn_index: int, question: str, answer: str, grader_json: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO grades (session_id, turn_index, question, answer, grader_json) VALUES (?, ?, ?, ?, ?)",
            (session_id, turn_index, question, answer, grader_json),
        )
        await db.commit()

async def get_recent_turns(session_id: str, limit: int = 12):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT speaker, text FROM turns WHERE session_id = ? ORDER BY id DESC LIMIT ?",
            (session_id, limit),
        ) as cur:
            rows = await cur.fetchall()
    rows.reverse()
    return [{"speaker": r[0], "text": r[1]} for r in rows]
# Mock Interviewer API

FastAPI app for a panel-style mock behavioral interview (Ollama-backed).

## Code layout

- **`app.py`** – Creates the FastAPI app, inits DB and memory store, mounts routers. Keep this file small.
- **`config.py`** – `MODEL`, `OLLAMA_URL` and other env/config.
- **`models.py`** – Pydantic request bodies (`StartIn`, `AnswerIn`, `SetJDIn`, etc.).
- **`prompts.py`** – All system prompts and panel presets (`PERSONA_SYSTEM`, `GRADER_SYSTEM`, `ORCHESTRATOR_SYSTEM`, `JD_PARSER_SYSTEM`, `RESUME_PARSER_SYSTEM`, `PANEL_PRESETS`, etc.).
- **`utils.py`** – Shared helpers: `parse_json_loose`, `merge_unique`, `strip_code_fences`, `contains_non_english_chars`.
- **`services/orchestration.py`** – Interview logic that calls Ollama: `choose_speaker`, `question_prompt_for_turn`, `run_consistency_check`, `persona_speak`.
- **`routers/`** – Route handlers by domain:
  - **`session.py`** – `/start_session`, `/set_panel`, `/next_question`, `/next_turn`
  - **`answer.py`** – `/answer` (grade, consistency, memory, state)
  - **`chat.py`** – `/chat`
  - **`jd.py`** – `/set_job_description`
  - **`resume.py`** – `/set_resume`
  - **`debug.py`** – `/debug/memory_search`
- **`dependencies.py`** – `get_mem_store` / `set_mem_store` for injecting the memory store into routes.
- **`db.py`** – Session DB (init, load, save, turns, grades).
- **`memory_store.py`** – Chroma-backed long-term memory.

Run from this directory: `uvicorn app:app --reload`.

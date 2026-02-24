# Mock Interview Conversational AI (Local, Offline) — 10 Steps Completed So Far

This document summarizes the 10 implementation steps we’ve built up to this point for the **local/offline mock interview conversational AI** (panel interview, job-role aware, memory-enabled).

> Core goal: **Realistic mock interviews** with a selectable panel (Hiring Manager + others), question generation + grading, and long-term memory using local embeddings + a local vector DB — **no Wi-Fi required**.

---

## Step 1 — Run a free local LLM and confirm you can chat with it
**What we did**
- Chose a local LLM runtime (e.g., **Ollama**) so everything runs offline.
- Verified a simple chat call returns a response.
- Confirmed the LLM API endpoint (e.g., `http://localhost:11434/api/chat`) and tested it.

**Why**
- Guarantees the system can run fully local on your M2 16GB machine.
- Forms the core “brain” behind interview questions, grading prompts, and orchestration.

**Output**
- A working local model call returning a response.

---

## Step 2 — Build a minimal FastAPI server and create a session-based workflow
**What we did**
- Created a FastAPI service as the backend API.
- Added **session_id** support (so the interview is stateful per session).
- Confirmed endpoints respond correctly.

**Why**
- You need a reliable “controller” around the LLM:
  - store session state
  - store turn history
  - manage panel roles
  - coordinate question ↔ answer ↔ feedback loops

**Output**
- Running FastAPI server (uvicorn).
- First proof-of-concept endpoint calls working.

---

## Step 3 — Store conversation turns in SQLite (persistent short-history)
**What we did**
- Implemented a turns table (speaker, text) and helper functions:
  - `add_turn(session_id, speaker, text)`
  - `get_recent_turns(session_id, limit=...)`

**Why**
- Even with long-term memory, you still need a **short local conversation window** (last ~10–20 turns) for realism, continuity, and grading context.

**Output**
- Your backend can fetch the most recent turn history and pass it into prompts.

---

## Step 4 — Implement the interviewer “grader” (`/answer`) endpoint
**What we did**
- Built `/answer` that:
  - reads the last interviewer question from session state
  - stores the candidate answer as a turn
  - calls a **grading prompt** (GRADER_SYSTEM) using the local LLM
  - parses the LLM JSON grading output
  - persists grade to DB
  - updates session weaknesses/strengths and summary fields

**Why**
- The interview has to **evaluate** the candidate’s response and adapt future questions.

**Output**
- Working grading output (JSON) like:
  - rubric sub-scores
  - overall score
  - strengths/weaknesses tags
  - “one_sentence_better_answer”
  - suggested follow-up focus

---

## Step 5 — Create the panel “orchestrator” (`/next_turn`) to pick who speaks + what to ask
**What we did**
- Built `/next_turn` that:
  - loads session panel members (hiring manager, senior engineer, etc.)
  - builds `orchestrator_input` with:
    - role/company
    - topics covered
    - weakness/strength tags
    - recent turns
    - phase hint (opening/core/closing)
  - calls an **ORCHESTRATOR_SYSTEM** prompt that returns strict JSON:
    - next_speaker_id
    - question_intent (ask_new / follow_up / wrap_up)
    - topic
    - question_prompt (instruction to persona)
    - rubric emphasis flags

**Why**
- This creates the realism of multiple interviewers + varied question styles.
- It decides the direction of the interview without the persona directly “thinking aloud.”

**Output**
- `/next_turn` returns: speaker name/type + the next question + topic/intent/rubric flags.

---

## Step 6 — Add persona speakers (each panel member has a unique voice)
**What we did**
- Implemented a `persona_speak(persona_type, persona_name, prompt, extra_context=...)` function.
- The orchestrator produces an instruction; persona_speak converts that into the actual spoken interviewer question.

**Why**
- Real panel interviews feel different depending on who’s asking:
  - hiring manager is behavioral + leadership
  - senior engineer drills tradeoffs
  - recruiter focuses communication / motivation

**Output**
- Panel “feels” like multiple humans rather than a single chatbot.

---

## Step 7 — Add Long-Term Memory (local embeddings + Chroma persistent DB)
**What we did**
- Implemented `MemoryStore`:
  - SentenceTransformer embeddings (e.g. BGE small)
  - Chroma persistent vector DB on disk
  - `add_memory`, `search`, and **`add_or_update_memory`** (dedup)

**Why**
- You want:
  - feedback trend across the session
  - resume “story hooks”
  - repeated weakness tags
  - content that the AI can recall later without stuffing everything in the prompt

**Output**
- Working memory writes + searches.
- Fixed a Chroma API include error (`ids` not allowed in query include in your version).

---

## Step 8 — Memory wiring: store distilled memories + retrieve “relevant_memories” for orchestration
**What we did**
- In `/answer`:
  - wrote **feedback_trend** memories (distilled, not raw transcripts)
  - optionally wrote **story** memories for strong answers
- In `/next_turn`:
  - performed memory retrieval and injected results into `orchestrator_input["relevant_memories"]`
  - added `last_prompted_memory_ids` for coherence

**Why**
- Memory should guide:
  - what to ask next
  - what to drill deeper
  - what to avoid repeating
  - what strengths/weakness trends exist

**Output**
- Orchestrator sees relevant memories and can choose targeted follow-ups.

---

## Step 9 — Make the interview feel real: follow-up comments, interrupts, and “punch above weight class” difficulty
**What we did**
- Extended orchestrator behavior rules to support:
  - `followup_comment`: short natural reaction sentence
  - `should_interrupt`: triggers “Let me stop you there…” style redirect
  - `difficulty`: 1–5 ladder (easy → stretch → above weight class)
- Updated `/next_turn` so:
  - it calls `persona_speak` **once**
  - prefixes the question with the follow-up comment / interruption tone
  - retries if non-English characters appear

**Why**
- Real interviews:
  - interrupt rambling
  - call out missing metrics
  - escalate from basic to deeper “edge of knowledge” questions
  - maintain coherent follow-up chains on one story

**Output**
- Interview questions now feel fluid and tougher:
  - “tell me about X” → “what were the metrics?” → “what would you do if constraints changed?”

---

## Step 10 — Add resume + job description ingestion, plus memory hygiene foundations
**What we did**
- Added:
  - Resume parsing (structured `resume_struct`)
  - JD parsing (structured `job_description_structured`)
  - memory chunking from resume into searchable memory
- Added dedup logic in `MemoryStore.add_or_update_memory` to avoid duplicates.
- Began wiring memory hygiene:
  - added `mem_write_count` in state
  - added calls to `mem_store.prune_session(...)` every 10 writes (the prune function itself still needs to be implemented in MemoryStore)

**Why**
- Resume + JD provide grounded “interview content.”
- Memory hygiene prevents long-term memory from becoming noisy.

**Output**
- The system can:
  - ask job/resume-relevant questions
  - store and retrieve resume chunks
  - avoid storing identical memories repeatedly

---

# What’s next (not fully implemented yet)
These are *planned additions* based on your newest goals:

### B2 — Contradictions + buffered clarification
- Detect contradictions:
  - resume vs candidate
  - candidate vs previous statements
  - “plausibility gap” claims
- If contradiction is high severity:
  - immediately ask a clarification question
  - buffer the current planned question to resume after

### B3 — Full pruning function
- Implement `mem_store.prune_session(...)` inside `MemoryStore`
- Use importance + recency scoring to delete old/low-value memories per type

---

## Current system architecture snapshot
- **Local LLM** (Ollama): question generation, orchestrator decisions, grading, (future) contradiction checking
- **FastAPI backend**: `/next_turn`, `/answer`, session state
- **SQLite**: turn history + grades
- **Chroma + embeddings**: long-term memory retrieval and dedup

---

## Default experience
- Default company: **Myles Inc.**
- Default mode: **behavioral_standard**
- Default panel: **Jordan (Hiring Manager)** with selectable expansion to multi-interviewer panels
- Offline-first design (no Wi-Fi required for the core loop)

---
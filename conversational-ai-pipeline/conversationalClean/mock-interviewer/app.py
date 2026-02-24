"""
Mock interviewer FastAPI app.
Routes and prompts live in routers/, prompts/, and services/.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import init_db
from uts.dependencies import set_mem_store
from memory_store import MemoryStore
from routers import answer, chat, debug, jd, resume, session, tts, stt, stt_partial

app = FastAPI()

# Allow frontend opened from file:// (origin "null") or any host to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Memory store is created at startup and injected into routes via dependencies.get_mem_store()
mem_store = MemoryStore(
    persist_dir="chroma_mem",
    embed_model_name="BAAI/bge-small-en-v1.5",
    collection_name="memories",
)


@app.on_event("startup")
async def _startup():
    await init_db()
    set_mem_store(mem_store)


# Include all route modules (no prefix; routes define full paths like /start_session, /answer)
app.include_router(session.router, tags=["session"])
app.include_router(chat.router, tags=["chat"])
app.include_router(answer.router, tags=["answer"])
app.include_router(jd.router, tags=["jd"])
app.include_router(resume.router, tags=["resume"])
app.include_router(debug.router, tags=["debug"])
app.include_router(tts.router, tags=["tts"])
app.include_router(stt.router, tags=["stt"])
app.include_router(stt_partial.router, tags=["stt_partial"])
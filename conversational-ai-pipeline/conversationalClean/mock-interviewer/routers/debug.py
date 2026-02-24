"""Debug: /debug/memory_search."""

from fastapi import APIRouter

from uts.dependencies import get_mem_store
from uts.models import MemorySearchIn

router = APIRouter()


@router.post("/debug/memory_search")
async def debug_memory_search(payload: MemorySearchIn):
    mem_store = get_mem_store()
    res = mem_store.search(query=payload.query, top_k=payload.top_k)
    return {"results": res}

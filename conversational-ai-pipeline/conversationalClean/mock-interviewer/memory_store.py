import os
import time
from typing import Any, Dict, List, Optional

import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
from typing import Tuple


class MemoryStore:
    """
    Local long-term memory using:
      - SentenceTransformer embeddings
      - Chroma persistent vector DB on disk
    """

    def __init__(
        self,
        persist_dir: str = "chroma_mem",
        embed_model_name: str = "BAAI/bge-small-en-v1.5",
        collection_name: str = "memories",
    ):
        os.makedirs(persist_dir, exist_ok=True)

        self.embedder = SentenceTransformer(embed_model_name)
        self.client = chromadb.PersistentClient(
            path=persist_dir,
            settings=Settings(anonymized_telemetry=False),
        )
        self.col = self.client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )

    def _embed(self, texts: List[str]) -> List[List[float]]:
        vecs = self.embedder.encode(texts, normalize_embeddings=True)
        # sentence-transformers returns numpy arrays; cast to python lists
        return [v.tolist() for v in vecs]

    def add_memory(
        self,
        *,
        text: str,
        session_id: str,
        mem_type: str,
        tags: List[str],
        importance: int = 3,
        role_title: str = "Unknown",
        company: str = "Myles Inc.",
        extra: Optional[Dict[str, Any]] = None,
    ) -> str:
        mem_id = f"mem_{int(time.time() * 1000)}"
        meta = {
            "session_id": session_id,
            "type": mem_type,
            "tags": ",".join(tags[:25]),
            "importance": int(importance),
            "role_title": role_title,
            "company": company,
            "created_at": int(time.time()),
        }
        if extra:
            # store only shallow simple values
            for k, v in extra.items():
                if isinstance(v, (str, int, float, bool)):
                    meta[k] = v

        emb = self._embed([text])[0]
        self.col.add(
            ids=[mem_id],
            documents=[text],
            embeddings=[emb],
            metadatas=[meta],
        )
        return mem_id

    def search(
        self,
        *,
        query: str,
        top_k: int = 10,
        tag_filter_any: Optional[List[str]] = None,
        min_importance: int = 1,
    ) -> List[Dict[str, Any]]:
        q_emb = self._embed([query])[0]

        # Chroma filters are limited; easiest is:
        # - pull top_k*3 candidates
        # - then filter in Python by tags/importance
        res = self.col.query(
            query_embeddings=[q_emb],
            n_results=max(top_k * 3, top_k),
                        # include=["documents", "metadatas", "distances", "ids"],
            include=["documents", "metadatas", "distances"],
            # include=["documents", "metadatas", "distances", "ids"],
        )

        out = []
        ids = res.get("ids", [[]])[0]
        docs = res.get("documents", [[]])[0]
        metas = res.get("metadatas", [[]])[0]
        dists = res.get("distances", [[]])[0]

        for mem_id, doc, meta, dist in zip(ids, docs, metas, dists):
            if not meta:
                continue
            if int(meta.get("importance", 1)) < min_importance:
                continue

            tags = (meta.get("tags") or "").split(",") if meta.get("tags") else []
            if tag_filter_any:
                if not any(t in tags for t in tag_filter_any):
                    continue

            out.append(
                {
                    "id": mem_id,
                    "text": doc,
                    "meta": meta,
                    "distance": dist,  # cosine distance-ish
                }
            )

        # sort by importance desc, then distance asc
        out.sort(key=lambda x: (-int(x["meta"].get("importance", 1)), x["distance"]))
        return out[:top_k]

    def add_or_update_memory(
        self,
        *,
        text: str,
        session_id: str,
        mem_type: str,
        tags: List[str],
        importance: int = 3,
        role_title: str = "Unknown",
        company: str = "Myles Inc.",
        extra: Optional[Dict[str, Any]] = None,
        dedup_threshold: float = 0.12,
    ) -> str:
        emb = self._embed([text])[0]

        # get nearest neighbors
        res = self.col.query(
            query_embeddings=[emb],
            n_results=3,
            include=["documents", "metadatas", "distances"],  # no ids in include
        )

        ids = res.get("ids", [[]])[0]
        docs = res.get("documents", [[]])[0]
        metas = res.get("metadatas", [[]])[0]
        dists = res.get("distances", [[]])[0]

        # find best match of same type
        best = None
        for mid, doc, meta, dist in zip(ids, docs, metas, dists):
            if not meta:
                continue
            if meta.get("type") != mem_type:
                continue
            if float(dist) < dedup_threshold:
                best = (mid, doc, meta, dist)
                break

        now = int(time.time())
        if best:
            mid, old_doc, old_meta, dist = best
            # bump importance slightly and update last_used_at
            new_importance = max(int(old_meta.get("importance", 1)), importance)
            merged_text = old_doc

            # if new text is meaningfully longer/different, append a small delta
            if text not in old_doc and len(text) > len(old_doc) + 40:
                merged_text = (old_doc[:800] + "\nUPDATE: " + text[:400])[:1200]

            old_meta["importance"] = int(new_importance)
            old_meta["last_used_at"] = now

            self.col.update(ids=[mid], documents=[merged_text], metadatas=[old_meta], embeddings=[emb])
            return mid

        # else add new
        return self.add_memory(
            text=text,
            session_id=session_id,
            mem_type=mem_type,
            tags=tags,
            importance=importance,
            role_title=role_title,
            company=company,
            extra=extra,
        )


    def _parse_tags(self, tag_str: str) -> List[str]:
        if not tag_str:
            return []
        return [t for t in tag_str.split(",") if t]

    def get_active_profile_fact(self, *, session_id: str, fact_key: str) -> Optional[Dict[str, Any]]:
        """
        Returns the newest non-superseded profile_fact for (session_id, fact_key).
        We store profile_fact memories with metadata: type='profile_fact', fact_key, fact_value,
        and optionally superseded_by.
        """
        # Pull a limited slice; profile_facts should be few.
        res = self.col.get(include=["documents", "metadatas", "ids"])
        ids = res.get("ids", [])
        docs = res.get("documents", [])
        metas = res.get("metadatas", [])

        best = None
        best_ts = -1
        for mid, doc, meta in zip(ids, docs, metas):
            if not meta:
                continue
            if meta.get("session_id") != session_id:
                continue
            if meta.get("type") != "profile_fact":
                continue
            if meta.get("fact_key") != fact_key:
                continue
            if meta.get("superseded_by"):
                continue
            ts = int(meta.get("created_at", 0))
            if ts > best_ts:
                best_ts = ts
                best = {"id": mid, "text": doc, "meta": meta}
        return best

    def upsert_profile_fact(
        self,
        *,
        session_id: str,
        fact_key: str,
        fact_value: str,
        source: str,                  # "resume" | "candidate" | "system"
        confidence: float = 0.7,
        importance: int = 3,
        role_title: str = "Unknown",
        company: str = "Myles Inc.",
    ) -> str:
        """
        If existing active fact has same value -> update last_used_at/importance.
        If different -> supersede old fact and add new one.
        """
        existing = self.get_active_profile_fact(session_id=session_id, fact_key=fact_key)
        now = int(time.time())

        # Normalize
        new_val = (fact_value or "").strip()

        if existing:
            old_val = (existing["meta"].get("fact_value") or "").strip()
            if old_val.lower() == new_val.lower():
                # just bump
                meta = existing["meta"]
                meta["importance"] = int(max(int(meta.get("importance", 1)), importance))
                meta["last_used_at"] = now
                self.col.update(ids=[existing["id"]], metadatas=[meta])
                return existing["id"]

            # supersede old
            old_meta = existing["meta"]
            old_meta["superseded_by"] = f"mem_{int(time.time() * 1000)}"  # temporary placeholder
            # We'll create new id next; update old with real new id after creation
            # (Chroma update after add)
            self.col.update(ids=[existing["id"]], metadatas=[old_meta])

        # create new fact memory
        mem_id = f"mem_{int(time.time() * 1000)}"
        meta = {
            "session_id": session_id,
            "type": "profile_fact",
            "fact_key": fact_key,
            "fact_value": new_val,
            "source": source,
            "confidence": float(confidence),
            "importance": int(importance),
            "role_title": role_title,
            "company": company,
            "created_at": int(time.time()),
            "last_used_at": now,
        }

        # store as document too for retrieval
        text = f"PROFILE FACT [{fact_key}] = {new_val} (source={source}, conf={confidence})"
        emb = self._embed([text])[0]
        self.col.add(ids=[mem_id], documents=[text], embeddings=[emb], metadatas=[meta])

        # If we superseded an old one, fix its superseded_by to real id
        if existing:
            old_meta = existing["meta"]
            old_meta["superseded_by"] = mem_id
            self.col.update(ids=[existing["id"]], metadatas=[old_meta])
            # also mark new as supersedes
            meta["supersedes"] = existing["id"]
            self.col.update(ids=[mem_id], metadatas=[meta])

        return mem_id



    def add_contradiction_memory(
        self,
        *,
        session_id: str,
        contradiction_key: str,
        kind: str,              # "candidate_vs_resume" | "candidate_vs_claim" | etc.
        existing: str,
        new: str,
        severity: str,          # "high" | "medium" | "low"
        clarifying_question: str,
        status: str = "open",
        importance: int = 4,
        role_title: str = "Unknown",
        company: str = "Myles Inc.",
    ) -> str:
        text = (
            f"CONTRADICTION [{contradiction_key}] ({kind}, severity={severity}, status={status})\n"
            f"- existing: {existing}\n"
            f"- new: {new}\n"
            f"- clarify: {clarifying_question}"
        )
        return self.add_or_update_memory(
            text=text,
            session_id=session_id,
            mem_type="contradiction",
            tags=["contradiction", severity, kind],
            importance=importance,
            role_title=role_title,
            company=company,
            extra={"contradiction_key": contradiction_key, "status": status},
            dedup_threshold=0.10,
        )

    def prune_session(
        self,
        *,
        session_id: str,
        keep_per_type: Dict[str, int],
    ) -> Dict[str, int]:
        """
        keep_per_type example:
        {"feedback_trend": 30, "skill_evidence": 80, "story_hook": 60, "contradiction": 30, "profile_fact": 50}
        Returns number deleted per type.
        """
        res = self.col.get(include=["metadatas", "ids"])
        ids = res.get("ids", [])
        metas = res.get("metadatas", [])

        # group by type
        by_type: Dict[str, List[Tuple[str, Dict[str, Any]]]] = {}
        for mid, meta in zip(ids, metas):
            if not meta:
                continue
            if meta.get("session_id") != session_id:
                continue
            t = meta.get("type") or "unknown"
            by_type.setdefault(t, []).append((mid, meta))

        deleted_counts: Dict[str, int] = {}

        for t, items in by_type.items():
            keep_n = int(keep_per_type.get(t, 999999))
            if len(items) <= keep_n:
                continue

            # score: importance desc, last_used_at desc, created_at desc
            def score(item):
                _, meta = item
                imp = int(meta.get("importance", 1))
                last_used = int(meta.get("last_used_at", 0))
                created = int(meta.get("created_at", 0))
                return (imp, last_used, created)

            items.sort(key=score, reverse=True)

            to_delete = [mid for (mid, _) in items[keep_n:]]

            if to_delete:
                self.col.delete(ids=to_delete)
                deleted_counts[t] = len(to_delete)

        return deleted_counts

    

#     def prune_session(
#     self,
#     *,
#     session_id: str,
#     keep_per_type: Dict[str, int],
# ) -> Dict[str, int]:
#     """
#     Keeps only the top-N memories per type (per session) using a simple score:
#       importance desc, last_used_at desc, created_at desc.
#     Returns {type: deleted_count}.
#     """
#     res = self.col.get(include=["metadatas", "ids"])
#     ids = res.get("ids", [])
#     metas = res.get("metadatas", [])

#     by_type: Dict[str, List[tuple]] = {}
#     for mid, meta in zip(ids, metas):
#         if not meta:
#             continue
#         if meta.get("session_id") != session_id:
#             continue
#         t = meta.get("type") or "unknown"
#         by_type.setdefault(t, []).append((mid, meta))

#     deleted_counts: Dict[str, int] = {}

#     for t, items in by_type.items():
#         keep_n = int(keep_per_type.get(t, 999999))
#         if len(items) <= keep_n:
#             continue

#         def score(item):
#             _, m = item
#             imp = int(m.get("importance", 1))
#             last_used = int(m.get("last_used_at", 0))
#             created = int(m.get("created_at", 0))
#             return (imp, last_used, created)

#         items.sort(key=score, reverse=True)
#         to_delete = [mid for (mid, _) in items[keep_n:]]

#         if to_delete:
#             self.col.delete(ids=to_delete)
#             deleted_counts[t] = len(to_delete)

#     return deleted_counts
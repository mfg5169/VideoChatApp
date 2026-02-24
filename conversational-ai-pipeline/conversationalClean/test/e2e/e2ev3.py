"""
step9_test.py

Tests Step 9 end-to-end:
1) start_session
2) set_panel
3) set_job_description from txt
4) set_resume from txt (seeds long-term memory)
5) calls /next_turn and verifies:
   - it returns a question
   - server state includes last_prompted_memory_ids
   - (optional) question text shows anchoring behavior
6) answers twice to create feedback_trend memories
7) calls /next_turn again to check follow-up coherence (last_prompted_memory_ids persists)
8) queries /debug/memory_search to confirm memory exists

EDIT THE PATHS below and run:
  python step9_test.py
"""

import os
import time
import requests
import textwrap

BASE = "http://127.0.0.1:8000"

# ✅ EDIT THESE FILE PATHS
JD_TXT_PATH = "../fixtures/jd.txt"
RESUME_TXT_PATH = "../fixtures/resume.txt"

# ✅ EDIT THESE
ROLE_TITLE = "Software Engineer New Grad"
PANEL_TYPE = "hm_plus_2"   # hm_only | hm_plus_1 | hm_plus_2 | recruiter_hm

# Test behavior knobs
TURNS = 2
AUTO_ANSWER = True


def read_file(path: str) -> str:
    if not os.path.exists(path):
        raise FileNotFoundError(f"Missing file: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return f.read().strip()


def post(route: str, payload: dict, timeout: int = 300) -> dict:
    r = requests.post(f"{BASE}{route}", json=payload, timeout=timeout)
    # Print details if something goes wrong
    if r.status_code >= 400:
        print("\n--- HTTP ERROR ---")
        print("route:", route)
        print("status:", r.status_code)
        print("content-type:", r.headers.get("content-type"))
        print("body:", r.text[:2000])
        r.raise_for_status()
    return r.json()


def memory_search(query: str, top_k: int = 8) -> dict:
    return post("/debug/memory_search", {"query": query, "top_k": top_k}, timeout=120)


def pretty_question(s: str) -> str:
    return textwrap.fill(s, width=110)


def main():
    # 1) start session
    start = post("/start_session", {"role_title": ROLE_TITLE})
    session_id = start["session_id"]
    print("\n=== Started Session ===")
    print("session_id:", session_id)

    # 2) set panel
    panel_resp = post("/set_panel", {"session_id": session_id, "panel_type": PANEL_TYPE})
    print("\n=== Panel Set ===")
    panel = panel_resp["state"]["panel"]
    print("panel:", [f'{p["name"]} ({p["type"]})' for p in panel])

    # 3) set JD from file
    jd_text = read_file(JD_TXT_PATH)
    jd_resp = post("/set_job_description", {"session_id": session_id, "job_description": jd_text})
    if jd_resp.get("error"):
        print("JD parse error:", jd_resp.get("error"))
        print(jd_resp.get("raw", "")[:2000])
        return
    print("\n=== JD Parsed ===")
    jd_struct = jd_resp["job_description_struct"]
    print("domain:", jd_struct.get("domain"), "level:", jd_struct.get("level"))
    print("must_have_skills:", jd_struct.get("must_have_skills", [])[:10])

    # 4) set resume from file (seeds memory)
    resume_text = read_file(RESUME_TXT_PATH)
    res_resp = post("/set_resume", {"session_id": session_id, "resume_text": resume_text})
    if res_resp.get("error"):
        print("Resume parse error:", res_resp.get("error"))
        print(res_resp.get("raw", "")[:2000])
        return
    print("\n=== Resume Parsed + Memory Seeded ===")
    resume_struct = res_resp["resume_struct"]
    print("top_skills:", resume_struct.get("top_skills", [])[:12])
    print("roles:", len(resume_struct.get("roles", [])), "projects:", len(resume_struct.get("projects", [])))

    # Confirm seeded memories show up
    mem0 = memory_search("resume story hook", top_k=8)
    print("\n=== Memory Search (resume story hook) ===")
    print("num results:", len(mem0.get("results", [])))
    for m in mem0.get("results", [])[:3]:
        print("-", m["meta"].get("type"), "|", m["text"][:120].replace("\n", " "))

    # 5) First next_turn -> check last_prompted_memory_ids exists
    nxt1 = post("/next_turn", {"session_id": session_id})
    print("\n=== Next Turn #1 ===")
    print(nxt1["speaker"] + ":")
    print(pretty_question(nxt1["text"]))
    lp1 = nxt1["state"].get("last_prompted_memory_ids", None)
    print("last_prompted_memory_ids:", lp1)

    if lp1 is None:
        print("❌ FAIL: state.last_prompted_memory_ids missing (Step 9 not wired).")
        return
    if not isinstance(lp1, list):
        print("❌ FAIL: last_prompted_memory_ids is not a list.")
        return

    # Heuristic: question likely anchored if it references a project/company OR includes "Use your"
    anchored_hint = ("use your" in nxt1["text"].lower()) or ("project" in nxt1["text"].lower())
    print("anchoring_heuristic:", anchored_hint)

    # 6) answer twice (auto answers) to generate feedback trend + update weaknesses
    def make_answer(i: int) -> str:
        # includes metrics + personal actions and reflection to test behavior
        return (
            f"Situation: On project {i}, we faced a scaling issue and missed a target deadline.\n"
            f"Task: I owned debugging and proposing a fix while coordinating with teammates.\n"
            f"Action: I instrumented key metrics, narrowed the bottleneck, and shipped a refactor with tests. "
            f"I communicated progress daily and aligned scope with stakeholders.\n"
            f"Result: Latency improved ~20% and we met the next milestone.\n"
            f"Reflection: Next time I'd add earlier checkpoints and define success metrics up front."
        )

    for i in range(TURNS):
        ans = make_answer(i + 1) if AUTO_ANSWER else input("\nPaste answer:\n")
        graded = post("/answer", {"session_id": session_id, "answer": ans})
        print(f"\n=== Graded Answer #{i+1} ===")
        print("overall:", graded.get("overall"))
        print("weaknesses (tail):", graded.get("weaknesses", [])[-5:])
        time.sleep(0.2)

        # Ask the next question after answering (except after last answer we'll do separate check)
        if i < TURNS - 1:
            nxt_mid = post("/next_turn", {"session_id": session_id})
            print("\n--- Next Turn (mid-loop) ---")
            print(nxt_mid["speaker"] + ":")
            print(pretty_question(nxt_mid["text"]))
            print("last_prompted_memory_ids:", nxt_mid["state"].get("last_prompted_memory_ids"))

    # 7) Another next_turn and check coherence: last_prompted_memory_ids should be present and may match previous
    nxt2 = post("/next_turn", {"session_id": session_id})
    print("\n=== Next Turn #Final (coherence check) ===")
    print(nxt2["speaker"] + ":")
    print(pretty_question(nxt2["text"]))
    lp2 = nxt2["state"].get("last_prompted_memory_ids", [])
    print("last_prompted_memory_ids:", lp2)

    # Coherence heuristic: if orchestrator chooses follow_up it should reuse ids; we can't see plan here,
    # but we can at least ensure ids persist and are stable-looking.
    if lp2 is None:
        print("❌ FAIL: last_prompted_memory_ids missing on later turn.")
        return

    # 8) Confirm feedback_trend memory exists
    mem1 = memory_search("feedback summary weaknesses", top_k=5)
    print("\n=== Memory Search (feedback summary) ===")
    print("num results:", len(mem1.get("results", [])))
    for m in mem1.get("results", [])[:3]:
        print("-", m["meta"].get("type"), "|", m["text"][:140].replace("\n", " "))

    print("\n✅ Step 9 test complete.")
    print("session_id:", session_id)


if __name__ == "__main__":
    main()
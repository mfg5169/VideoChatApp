"""Shared utilities: JSON parsing, text helpers, merge."""

import json
import re
from typing import Any, Dict


def contains_non_english_chars(s: str) -> bool:
    """Flags any non-ASCII character (covers Chinese, emojis, etc.)."""
    return any(ord(ch) > 127 for ch in s)


def parse_json_loose(text: str) -> Dict[str, Any]:
    """
    Attempts to parse JSON even if the model wraps it in extra text/code fences.
    Raises ValueError if it can't recover.
    """
    s = text.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    if not (s.startswith("{") and s.endswith("}")):
        m = re.search(r"\{.*\}", s, flags=re.DOTALL)
        if m:
            s = m.group(0)
    return json.loads(s)


def merge_unique(existing: list[str], new_items: list[str], limit: int = 25) -> list[str]:
    seen = set(existing)
    out = list(existing)
    for x in new_items:
        if x not in seen:
            out.append(x)
            seen.add(x)
    return out[-limit:]


def strip_code_fences(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    return s.strip()

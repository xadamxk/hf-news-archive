"""
Unify every events.json event to:
  category, title, description, url, users? (users only if non-empty list)

- topic -> category (manual editions)
- thread -> url (null thread becomes "")
- title missing or blank: derive from description when description is non-empty
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDITIONS = ROOT / "editions"

SENTENCE_END = re.compile(r"^(.{12,}?[.!?])(?:\s|$)")


def derive_title(description: str, max_len: int = 100) -> str:
    text = " ".join(description.split())
    if not text:
        return ""
    m = SENTENCE_END.match(text)
    if m:
        s = m.group(1).strip()
        if len(s) <= 140:
            return s[:max_len] + ("..." if len(s) > max_len else "")
    if len(text) <= max_len:
        return text
    cut = text[: max_len + 1]
    ls = cut.rfind(" ")
    if ls > 30:
        return cut[:ls].rstrip() + "..."
    return text[:max_len].rstrip() + "..."


def consolidate_event(ev: object) -> object:
    if not isinstance(ev, dict):
        return ev
    d = dict(ev)

    if "topic" in d:
        d["category"] = d.pop("topic")
    d.setdefault("category", "unknown")

    if "thread" in d:
        th = d.pop("thread")
        d["url"] = "" if th is None else th
    if "url" not in d or d["url"] is None:
        d["url"] = ""
    if not isinstance(d["url"], str):
        d["url"] = str(d["url"])

    desc = d.get("description", "")
    if desc is None:
        desc = ""
    elif not isinstance(desc, str):
        desc = str(desc)
    d["description"] = desc

    tit = d.get("title", "")
    if tit is None:
        tit = ""
    elif not isinstance(tit, str):
        tit = str(tit)
    if not tit.strip() and desc.strip():
        tit = derive_title(desc)
    d["title"] = tit

    out: dict = {}
    for k in ("category", "title", "description", "url"):
        out[k] = d[k]
    if "users" in d and isinstance(d["users"], list) and len(d["users"]) > 0:
        out["users"] = d["users"]
    return out


def guess_indent(raw: str) -> int:
    m = re.search(r"\n(\s+)\"", raw)
    if m:
        n = len(m.group(1))
        if n >= 2:
            return n
    return 2


def main() -> None:
    changed = 0
    for path in sorted(EDITIONS.glob("**/events.json")):
        raw = path.read_text(encoding="utf-8")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            print("skip bad json", path.relative_to(ROOT))
            continue
        if not isinstance(data, dict) or "events" not in data:
            continue
        evs = data["events"]
        if not isinstance(evs, list):
            continue
        new_events = [consolidate_event(ev) for ev in evs]
        data = {"events": new_events}
        new_raw = json.dumps(data, indent=guess_indent(raw), ensure_ascii=False) + "\n"
        if new_raw != raw:
            path.write_text(new_raw, encoding="utf-8")
            changed += 1
    print(f"updated {changed} events.json files")


if __name__ == "__main__":
    main()

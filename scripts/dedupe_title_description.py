"""
When title and description are the same (ignoring whitespace runs):

- Short text (<= SHORT_MAX chars): keep title, set description to "".
- Longer: prefer first-sentence title + remainder in description; else a
  truncated headline title + full text in description.

Never leaves identical non-empty title and description.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDITIONS = ROOT / "editions"

SHORT_MAX = 140

FIRST_SENT = re.compile(
    r"^(.{8,}?(?:[.!?]|\u203c|\u203d|…))(?:\s+(.+))?$",
    re.DOTALL,
)


def norm_ws(s: str) -> str:
    return " ".join(s.split())


def truncate_at_word(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    cut = text[: max_len + 1]
    sp = cut.rfind(" ")
    if sp > max_len // 2:
        return cut[:sp].rstrip()
    return text[:max_len].rstrip()


def split_sentence_rest(text: str) -> tuple[str | None, str | None]:
    m = FIRST_SENT.match(text.strip())
    if not m or not m.group(2):
        return None, None
    first = m.group(1).strip()
    rest = m.group(2).strip()
    if not rest or norm_ws(first) == norm_ws(text):
        return None, None
    if len(first) > 130:
        return None, None
    return first, rest


def clean_pair(title: str, desc: str) -> tuple[str, str]:
    t_raw = "" if title is None else str(title)
    d_raw = "" if desc is None else str(desc)
    t = t_raw.strip()
    d = d_raw.strip()

    if not t and not d:
        return "", ""

    if norm_ws(t) != norm_ws(d):
        return t_raw if t_raw else "", d_raw if d_raw else ""

    text = t
    if len(text) <= SHORT_MAX:
        return text, ""

    first, rest = split_sentence_rest(text)
    if first and rest:
        return first, rest

    head = truncate_at_word(text, 92)
    if len(text) > 92:
        head = head + "..."
    if norm_ws(head) == norm_ws(text):
        head = text[:72].rstrip()
        if len(text) > 72:
            head += "..."
    if norm_ws(head) == norm_ws(text):
        head = text[:55] + "..."
    return head, text


def guess_indent(raw: str) -> int:
    m = re.search(r"\n(\s+)\"", raw)
    if m:
        n = len(m.group(1))
        if n >= 2:
            return n
    return 2


def main() -> None:
    changed_files = 0
    changed_events = 0
    for path in sorted(EDITIONS.glob("**/events.json")):
        raw = path.read_text(encoding="utf-8")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            print("skip bad json", path.relative_to(ROOT))
            continue
        evs = data.get("events")
        if not isinstance(evs, list):
            continue
        file_changed = False
        for ev in evs:
            if not isinstance(ev, dict):
                continue
            if "title" not in ev or "description" not in ev:
                continue
            new_t, new_d = clean_pair(ev.get("title", ""), ev.get("description", ""))
            if new_t != ev.get("title") or new_d != ev.get("description"):
                ev["title"] = new_t
                ev["description"] = new_d
                file_changed = True
                changed_events += 1
        if file_changed:
            new_raw = json.dumps(data, indent=guess_indent(raw), ensure_ascii=False) + "\n"
            path.write_text(new_raw, encoding="utf-8")
            changed_files += 1
    print(f"updated {changed_files} files, {changed_events} events")


if __name__ == "__main__":
    main()

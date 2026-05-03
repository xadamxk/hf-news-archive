"""Normalize events.json user fields.

1) Remove the file-level `users` key when present (any value — contributor/index lists).
2) Recursively remove `users` only when it is an empty list `[]` (e.g. on event objects).

Per-event `users` with entries are kept. Preserves detected indent.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDITIONS = ROOT / "editions"


def strip_empty_users(obj: object) -> None:
    if isinstance(obj, dict):
        if obj.get("users") == []:
            del obj["users"]
        for v in list(obj.values()):
            strip_empty_users(v)
    elif isinstance(obj, list):
        for item in obj:
            strip_empty_users(item)


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
        if isinstance(data, dict) and "users" in data:
            del data["users"]
        strip_empty_users(data)
        new_raw = json.dumps(data, indent=guess_indent(raw), ensure_ascii=False) + "\n"
        if new_raw != raw:
            path.write_text(new_raw, encoding="utf-8")
            changed += 1
    print(f"updated {changed} events.json files")


if __name__ == "__main__":
    main()

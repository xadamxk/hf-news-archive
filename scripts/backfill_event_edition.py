"""
Set each event's `edition` from the parent folder name under editions/
(e.g. 1 -> 1, 8.1 -> 8.1, 221 -> 221). Whole-number folders use int; dotted use float.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

_EDITION_DIR = re.compile(r"^\d+(?:\.\d+)?$")


def folder_name_to_edition(name: str) -> int | float:
    if "." in name:
        return float(name)
    return int(name)


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    editions = root / "editions"
    if not editions.is_dir():
        print("No editions directory", file=sys.stderr)
        return 1

    updated = 0
    errors: list[str] = []

    for folder in sorted(editions.iterdir(), key=lambda p: p.name):
        if not folder.is_dir():
            continue
        name = folder.name
        if not _EDITION_DIR.match(name):
            continue
        events_path = folder / "events.json"
        if not events_path.is_file():
            continue
        try:
            edition_val = folder_name_to_edition(name)
        except ValueError:
            errors.append(f"{name}: folder name not parseable as edition")
            continue

        try:
            events_data = json.loads(events_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            errors.append(f"{name}: cannot read events.json ({e})")
            continue
        evs = events_data.get("events")
        if not isinstance(evs, list):
            errors.append(f"{name}: events.json missing events array")
            continue

        changed = False
        for ev in evs:
            if not isinstance(ev, dict):
                continue
            if ev.get("edition") != edition_val:
                ev["edition"] = edition_val
                changed = True

        if changed:
            out = json.dumps(events_data, indent=2, ensure_ascii=False) + "\n"
            events_path.write_text(out, encoding="utf-8", newline="\n")
            updated += 1

    print(f"Updated {updated} events.json files with edition.")
    if errors:
        print("\nIssues:", file=sys.stderr)
        for line in errors:
            print(line, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

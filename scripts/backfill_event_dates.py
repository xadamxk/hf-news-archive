"""
Set each event's `date` from the first post's `dateline` in that edition's posts.json.
`date` is stored as an integer Unix timestamp (MyBB dateline), matching parse-prompt.txt.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    editions = root / "editions"
    if not editions.is_dir():
        print("No editions directory", file=sys.stderr)
        return 1

    updated = 0
    skipped_no_posts = 0
    skipped_empty_posts = 0
    skipped_no_dateline = 0
    skipped_no_events = 0
    errors: list[str] = []

    for folder in sorted(editions.iterdir(), key=lambda p: p.name):
        if not folder.is_dir():
            continue
        events_path = folder / "events.json"
        posts_path = folder / "posts.json"
        if not events_path.is_file():
            continue
        if not posts_path.is_file():
            skipped_no_posts += 1
            errors.append(f"{folder.name}: events.json exists but no posts.json")
            continue
        try:
            posts_data = json.loads(posts_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            errors.append(f"{folder.name}: cannot read posts.json ({e})")
            continue
        posts = posts_data.get("posts")
        if not posts:
            skipped_empty_posts += 1
            errors.append(f"{folder.name}: posts.json has no posts")
            continue
        raw = posts[0].get("dateline")
        if raw is None:
            skipped_no_dateline += 1
            errors.append(f"{folder.name}: first post has no dateline")
            continue
        try:
            date_val = int(raw)
        except (TypeError, ValueError):
            errors.append(f"{folder.name}: dateline not int-coercible: {raw!r}")
            continue

        try:
            events_data = json.loads(events_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            errors.append(f"{folder.name}: cannot read events.json ({e})")
            continue
        evs = events_data.get("events")
        if not isinstance(evs, list):
            skipped_no_events += 1
            errors.append(f"{folder.name}: events.json missing events array")
            continue

        changed = False
        for ev in evs:
            if not isinstance(ev, dict):
                continue
            if ev.get("date") != date_val:
                ev["date"] = date_val
                changed = True

        if changed:
            out = json.dumps(events_data, indent=2, ensure_ascii=False) + "\n"
            events_path.write_text(out, encoding="utf-8", newline="\n")
            updated += 1

    print(
        f"Updated {updated} events.json files. "
        f"Skipped: no_posts={skipped_no_posts} empty_posts={skipped_empty_posts} "
        f"no_dateline={skipped_no_dateline} bad_events={skipped_no_events}"
    )
    if errors:
        print("\nIssues:", file=sys.stderr)
        for line in errors:
            print(line, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""
One-off migration: manual editions (events with topic + per-event users list).
1) users (formerly related_users) -> [{ "uid": "<string>"|null, "username": "..." }]
2) Add missing "description" (empty string).

UID resolution: file users[] + posts.json BBCode profile links + global scan of
all events.json for {username, uid} pairs.
"""
from __future__ import annotations

import html
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDITIONS = ROOT / "editions"

BB_URL = re.compile(r"\[url=([^\]]+)\]([^\[]*?)\[/url\]", re.IGNORECASE | re.DOTALL)
UID_IN_URL = re.compile(r"(?:^|[?&])uid=(\d+)", re.IGNORECASE)
BAD_LABELS = frozenset(
    {
        "here",
        "here.",
        "link",
        "profile",
        "click here",
        "click",
        "this",
        "this thread",
        "thread",
        "read more",
        "more",
        "video",
        "image",
        "picture",
    }
)


def fold(s: str) -> str:
    return unicodedata.normalize("NFKC", s).casefold()


def norm_uid(u) -> str | None:
    if u is None:
        return None
    if isinstance(u, str):
        t = u.strip()
        if not t or t.lower() == "null":
            return None
        if t.isdigit():
            return str(int(t))
        return t
    if isinstance(u, bool):
        return None
    if isinstance(u, int):
        return str(u)
    return str(u)


def collect_pairs(obj, out: dict[str, tuple[str, str]]) -> None:
    if isinstance(obj, dict):
        un = obj.get("username")
        uid = norm_uid(obj.get("uid"))
        if isinstance(un, str) and uid:
            out[fold(un)] = (un, uid)
        for v in obj.values():
            collect_pairs(v, out)
    elif isinstance(obj, list):
        for x in obj:
            collect_pairs(x, out)


def profile_links_from_message(message: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for m in BB_URL.finditer(message):
        url_raw = html.unescape(m.group(1).strip())
        label = html.unescape(m.group(2).strip())
        if "member.php" not in url_raw.lower():
            continue
        um = UID_IN_URL.search(url_raw.replace("&amp;", "&"))
        if not um:
            continue
        uid = um.group(1)
        lf = fold(label)
        if not label or len(label) > 64:
            continue
        if lf in BAD_LABELS:
            continue
        if lf.startswith("http"):
            continue
        found[fold(label)] = uid
    return found


def build_global_uid_by_username() -> dict[str, tuple[str, str]]:
    out: dict[str, tuple[str, str]] = {}
    for path in sorted(EDITIONS.glob("**/events.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        collect_pairs(data, out)
    return out


def migrate_events_file(path: Path, global_map: dict[str, tuple[str, str]]) -> bool:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or "events" not in data:
        return False
    events = data["events"]
    if not events or not isinstance(events, list):
        return False
    first = events[0]
    if not isinstance(first, dict) or "topic" not in first:
        return False

    lookup: dict[str, str] = {}

    users_arr = data.get("users")
    if isinstance(users_arr, list):
        for u in users_arr:
            if not isinstance(u, dict):
                continue
            un = u.get("username")
            uid = norm_uid(u.get("uid"))
            if isinstance(un, str) and uid:
                lookup[fold(un)] = uid

    edition_dir = path.parent
    posts_path = edition_dir / "posts.json"
    if posts_path.is_file():
        try:
            posts_data = json.loads(posts_path.read_text(encoding="utf-8"))
            posts = posts_data.get("posts") if isinstance(posts_data, dict) else None
            if isinstance(posts, list):
                for p in posts:
                    if not isinstance(p, dict):
                        continue
                    msg = p.get("message")
                    if isinstance(msg, str):
                        for fk, uid in profile_links_from_message(msg).items():
                            lookup[fk] = uid
                    uid = norm_uid(p.get("uid"))
                    # Poster uid without username in JSON — skip
        except (json.JSONDecodeError, OSError):
            pass

    for fk, (_canon, uid) in global_map.items():
        if fk not in lookup:
            lookup[fk] = uid

    new_events = []
    for ev in events:
        if not isinstance(ev, dict):
            new_events.append(ev)
            continue
        ev = dict(ev)
        if "description" not in ev:
            out_ev = {}
            for k, v in ev.items():
                out_ev[k] = v
                if k == "title":
                    out_ev["description"] = ""
            if "title" not in ev:
                out_ev["description"] = ""
            ev = out_ev
        ru = ev.get("related_users")
        if ru is None:
            ru = ev.get("users")
        ev.pop("related_users", None)
        if isinstance(ru, list) and ru and isinstance(ru[0], str):
            new_ru = []
            for name in ru:
                if not isinstance(name, str):
                    continue
                fk = fold(name)
                uid = lookup.get(fk)
                uid_out = uid if uid is not None else None
                new_ru.append({"username": name, "uid": uid_out})
            ev["users"] = new_ru
        elif isinstance(ru, list) and ru and isinstance(ru[0], dict):
            new_ru = []
            for u in ru:
                if not isinstance(u, dict):
                    continue
                name = u.get("username")
                if not isinstance(name, str):
                    continue
                fk = fold(name)
                uid = norm_uid(u.get("uid"))
                if uid is None:
                    uid = lookup.get(fk)
                new_ru.append({"username": name, "uid": uid})
            ev["users"] = new_ru
        elif isinstance(ru, list) and len(ru) == 0:
            ev.pop("users", None)
        new_events.append(ev)

    data["events"] = new_events
    path.write_text(json.dumps(data, indent=4, ensure_ascii=False) + "\n", encoding="utf-8")
    return True


def main() -> None:
    manual_paths = []
    for path in sorted(EDITIONS.glob("**/events.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        evs = data.get("events")
        if not isinstance(evs, list) or not evs:
            continue
        fe = evs[0]
        if isinstance(fe, dict) and "topic" in fe:
            manual_paths.append(path)

    for _ in range(2):
        global_map = build_global_uid_by_username()
        for path in manual_paths:
            migrate_events_file(path, global_map)

    unresolved: list[tuple[str, str]] = []
    for path in manual_paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        for ev in data.get("events", []):
            if not isinstance(ev, dict):
                continue
            for u in ev.get("users") or []:
                if isinstance(u, dict) and u.get("uid") is None and u.get("username"):
                    unresolved.append((str(path.relative_to(ROOT)), u["username"]))

    print(f"Updated {len(manual_paths)} manual edition event files (2-pass UID merge).")
    if unresolved:
        print(f"Unresolved usernames (uid null): {len(unresolved)}")
        for p, n in unresolved[:40]:
            safe = n.encode("ascii", "backslashreplace").decode("ascii")
            print(f"  {p}: {safe}")
        if len(unresolved) > 40:
            print("  ...")


if __name__ == "__main__":
    main()

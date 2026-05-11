"""
Build a MyBB BBCode bulleted list of every HF News edition from editions.csv.
Writes the result to thread/editions.txt at the repo root.

Each linked edition becomes:
    [*] [url=LINK]Edition N - Mmm. D, YYYY[/url]
Missing editions (Note column contains "MISSING") become:
    [*] Edition N [MISSING]

The date comes from each edition's events.json (edition.date is unix seconds).

Usage:
    python scripts/build_editions_list.py
"""
import csv, json, os, sys, io
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

# Resolve REPO from the script's own location so this works on any clone.
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(REPO, "editions.csv")
OUT = os.path.join(REPO, "thread", "editions.txt")

# 3-letter month abbreviations with periods, matching the requested
# "Oct. 8, 2014" style. May stays bare ("May 8, 2010") per AP convention.
MONTH_3 = {
    1: "Jan.", 2: "Feb.", 3: "Mar.", 4: "Apr.", 5: "May",
    6: "Jun.", 7: "Jul.", 8: "Aug.", 9: "Sep.", 10: "Oct.",
    11: "Nov.", 12: "Dec.",
}


def fmt_date(sec: int) -> str:
    dt = datetime.fromtimestamp(int(sec))
    return f"{MONTH_3[dt.month]} {dt.day}, {dt.year}"


def edition_date(n: str):
    """Return formatted date string for edition `n`, or None if no events.json."""
    p = os.path.join(REPO, "editions", n, "events.json")
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        sec = d.get("edition", {}).get("date")
        if isinstance(sec, (int, float)):
            return fmt_date(sec)
    except Exception:
        return None
    return None


def main():
    rows = []  # list of (edition, line)
    missing_count = 0
    with open(CSV_PATH, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            link = (r.get("Link") or "").strip()
            edition = (r.get("Edition") or "").strip()
            note = (r.get("Note") or "").strip().upper()
            if not edition:
                continue
            if "MISSING" in note:
                # Missing editions: just the number + tag, no link or date.
                rows.append((edition, f"[*] Edition {edition} [MISSING]"))
                missing_count += 1
                continue
            if not link:
                # Row with no link and not flagged MISSING — skip defensively.
                continue
            date_str = edition_date(edition) or "Date unknown"
            rows.append(
                (
                    edition,
                    f"[*] [url={link}]Edition {edition} - {date_str}[/url]",
                )
            )

    out_lines = ["[list]"]
    out_lines.extend(line for _ed, line in rows)
    out_lines.append("[/list]")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out_lines) + "\n")
    print(f"Wrote {len(rows)} editions to {OUT} ({missing_count} marked MISSING)")


if __name__ == "__main__":
    main()

"""Parse the Kaplan Food Schedule Google Doc export into clean JSON for import.

Usage: python3 parse_doc.py doc.json out.json report.txt
"""
import calendar
import collections
import datetime as dt
import json
import re
import sys

MONTHS = {m: i for i, m in enumerate(calendar.month_name) if m}
NAME_FIX = {
    "Deandre": "DeAndre",
    "O’Ryan": "O'Ryan",
}
HOLIDAY_WORDS = {"OFF"}

TIME_RE = re.compile(
    r"(\d{1,2})(?::(\d{2}))?\s*([AaPp])?(?![0-9])"
)
HOUR = r"(1[0-2]|0?[1-9])"
RANGE_RE = re.compile(
    HOUR + r"(?::\s*(\d{2}))?\s*([AP])?\s*-\s*(?:" + HOUR + r"(?::\s*(\d{2}))?\s*([AP])?)?"
)


def clean(cell):
    try:
        cell = cell.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    c = cell.replace("\\*", "").replace("**", "").replace("\\", "")
    return re.sub(r"\s+", " ", c).strip()


def to_min(h, m, suffix, after=None):
    """Return minutes from midnight. Infer AM/PM when the suffix is missing.

    Start times without a suffix: 5-11 => AM, 12 => noon, 1-4 => PM.
    End times without a suffix: the first time after the start.
    """
    h = int(h)
    m = int(m or 0)
    if suffix:
        s = suffix.upper()
        if s == "A":
            h24 = 0 if h == 12 else h
        else:
            h24 = 12 if h == 12 else h + 12
        return h24 * 60 + m
    if after is None:
        if 5 <= h <= 11:
            return h * 60 + m
        if h == 12:
            return 12 * 60 + m
        return (h + 12) * 60 + m
    for cand in (h * 60 + m, ((h % 12) + 12) * 60 + m):
        if cand > after:
            return cand
    return ((h % 12) + 12) * 60 + m


ROLE_TOKENS = [
    (re.compile(r"(?<![A-Za-z])(KITCHEN|KIT|KN)\b", re.I), "kitchen"),
    (re.compile(r"(?<![A-Za-z])FT\b", re.I), "cashier"),
]
BLOCK_RE = re.compile(
    HOUR + r"(?::\s*(\d{2}))?\s*([AP])?\s*-\s*(?:" + HOUR + r"(?::\s*(\d{2}))?\s*([AP])?)?(\s*Z)?"
)


def parse_cell(raw):
    """Return dict: {off, blocks:[{s,e,role?,pz?}], text}"""
    c = clean(raw)
    out = {"off": False, "blocks": [], "text": ""}
    c = re.sub(r"(\d)\s*([ap])(?=\b|Z|z)", lambda m: m.group(1) + m.group(2).upper(), c)
    c = c.replace("–", "-").replace("—", "-")
    c = re.sub(r"(?<=[AP])z", "Z", c)
    c = re.sub(r"^[.\s]+", "", c)
    if not c:
        return out
    if re.fullmatch(r"OFF\.?", c, re.I):
        out["off"] = True
        return out
    matches = list(BLOCK_RE.finditer(c))
    leftovers = []
    for i, m in enumerate(matches):
        sh, sm, ss, eh, em, es, z = m.groups()
        s = to_min(sh, sm, ss)
        prev = out["blocks"][-1] if out["blocks"] else None
        if not ss and prev and prev["e"] is not None and s < prev["e"] and s + 12 * 60 < 24 * 60:
            s += 12 * 60  # second half of a split shift is later in the day
        e = to_min(eh, em, es, after=s) if eh else None
        if e is not None and e - s > 14 * 60 and es == "P" and e - 12 * 60 > s:
            e -= 12 * 60  # e.g. "8:30 - 11:30P" is really 8:30A - 11:30A
        b = {"s": s, "e": e}
        tail = c[m.end(): matches[i + 1].start() if i + 1 < len(matches) else len(c)]
        if z:
            b["pz"] = True
            b["role"] = "kitchen"
        for rx, role in ROLE_TOKENS:
            if rx.search(tail):
                b["role"] = role
                tail = rx.sub("", tail)
        if re.search(r"^\s*PZ\b", tail):
            b["pz"] = True
            b["role"] = "kitchen"
            tail = re.sub(r"^\s*PZ\b", "", tail)
        tail = re.sub(r"\bOFF\b", "", tail, flags=re.I)
        tail = re.sub(r"[\s.\-]+", " ", tail).strip()
        if tail:
            leftovers.append(tail)
        out["blocks"].append(b)
    if not matches:
        if re.search(r"\bOFF\b", c, re.I):
            out["off"] = True
        else:
            out["text"] = c
    else:
        head = c[: matches[0].start()].strip(" .-")
        if head:
            leftovers.insert(0, head)
        out["text"] = " ".join(leftovers)
    return out


def resolve_monday(month_name, nums, year_label):
    mon = MONTHS.get(month_name.strip())
    year = int(year_label)
    best = None
    for y in range(year - 2, year + 3):
        for mo in range(1, 13):
            try:
                d = dt.date(y, mo, nums[0])
            except ValueError:
                continue
            if d.weekday() != 0:
                continue
            ok = all((d + dt.timedelta(i)).day == n for i, n in enumerate(nums))
            if not ok:
                continue
            score = abs(mo - mon) * 12 + abs(y - year) if mon else abs(y - year)
            if best is None or score < best[0]:
                best = (score, d)
    if best and best[0] <= 13:
        return best[1], best[0] != 0
    # fallback: nearest Monday to the labelled date
    try:
        d = dt.date(year, mon, nums[0])
    except ValueError:
        d = dt.date(year, mon, 28)
    back = d.weekday()
    d2 = d - dt.timedelta(back) if back <= 3 else d + dt.timedelta(7 - back)
    return d2, True


def main(src, dst, report_path):
    s = json.load(open(src))["fileContent"]
    tables = [t for t in s.split("\n\n") if t.strip().startswith("|")]
    report = []
    weeks = {}
    names = collections.OrderedDict()
    role_count = collections.defaultdict(collections.Counter)
    unparsed = collections.Counter()
    for ti, t in enumerate(tables):
        rows = [
            [c for c in r.strip().strip("|").split("|")]
            for r in t.strip().split("\n")
        ]
        rows = [r for r in rows if not set("".join(r)) <= set(":- ")]
        head = [clean(c) for c in rows[0]]
        if len(head) != 8:
            report.append(f"table {ti}: skipped partial week {head}")
            continue
        try:
            nums = [int(x) for x in head[1:]]
        except ValueError:
            report.append(f"table {ti}: bad header {head}")
            continue
        monday, fixed = resolve_monday(head[0], nums, clean(rows[1][0]))
        wid = monday.isoformat()
        if fixed:
            report.append(
                f"table {ti}: header '{head[0]} {nums[0]} {clean(rows[1][0])}' -> week of {wid}"
            )
        if wid in weeks:
            report.append(f"table {ti}: duplicate week {wid}, kept the copy higher in the doc")
            continue
        rowsout = []
        cells = {}
        day_text = collections.defaultdict(list)
        for r in rows[2:]:
            name = clean(r[0])
            if not name:
                continue
            name = NAME_FIX.get(name, name)
            eid = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            names.setdefault(eid, name)
            rowsout.append(eid)
            for d in range(7):
                raw = r[d + 1] if d + 1 < len(r) else ""
                p = parse_cell(raw)
                cell = None
                if p["off"]:
                    cell = {"off": True}
                elif p["blocks"]:
                    cell = {"blocks": p["blocks"]}
                    for b in p["blocks"]:
                        role_count[eid][b.get("role", "none")] += 1
                    if p["text"]:
                        cell["note"] = p["text"]
                elif p["text"]:
                    day_text[d].append(p["text"])
                    unparsed[p["text"]] += 1
                if cell:
                    cells.setdefault(eid, {})[str(d)] = cell
        notes = {str(d): " ".join(v) for d, v in day_text.items()}
        weeks[wid] = {"rows": rowsout, "cells": cells, "notes": notes}
    employees = []
    latest = max(weeks)
    for i, (eid, name) in enumerate(names.items()):
        employees.append(
            {
                "id": eid,
                "name": name,
                "role": "kitchen" if role_count[eid]["kitchen"] >= 0.3 * sum(role_count[eid].values()) and role_count[eid]["kitchen"] else "cashier",
                "active": eid in weeks[latest]["rows"],
                "order": i,
            }
        )
    data = {"version": 1, "employees": employees, "weeks": weeks}
    json.dump(data, open(dst, "w"), indent=1)
    report.append("")
    report.append(f"weeks: {len(weeks)}  {min(weeks)} .. {max(weeks)}")
    report.append(f"employees: {len(employees)}")
    report.append("default kitchen: " + ", ".join(e["name"] for e in employees if e["role"] == "kitchen"))
    report.append("active now: " + ", ".join(e["name"] for e in employees if e["active"]))
    report.append("text-only cells turned into day notes: " + json.dumps(unparsed.most_common()))
    open(report_path, "w").write("\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main(*sys.argv[1:4])

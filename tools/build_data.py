"""Build site/data/spells.json from source/ and data-src/ (offline; CI runs this).

  python tools/build_data.py

- data-src/spell-facts.json : facts for every official spell (from 5etools, no text)
- data-src/classes.json     : class progressions and subclass spell lists (facts)
- source/open5e-spells.json : SRD 5.1 / 5.2 spell text (CC-BY-4.0), matched by name
"""
import datetime
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# a fixed hue per book, so the source colours stay put between builds
HUES = {"PHB": 140, "XPHB": 205, "XGE": 30, "TCE": 285, "FTD": 0, "SCC": 255, "EGW": 175, "GGR": 340,
        "AAG": 225, "AI": 60, "IDRotF": 190, "SatO": 315, "BMT": 45, "FRHoF": 100, "EFA": 20, "AU": 265,
        "DMG": 10, "SCAG": 80, "VRGR": 350, "DSotDQ": 240, "RHW": 300}
SHORT = {"PHB": "PHB 2014", "XPHB": "PHB 2024", "XGE": "Xanathar's", "TCE": "Tasha's", "FTD": "Fizban's",
         "SCC": "Strixhaven", "EGW": "Wildemount", "GGR": "Ravnica", "AAG": "Astral Adv.", "AI": "Acq. Inc.",
         "IDRotF": "Icewind Dale", "SatO": "Sigil", "BMT": "Many Things", "FRHoF": "Heroes of Faerun",
         "EFA": "Forge of the Artificer", "AU": "Arcana Unleashed", "DMG": "DMG 2014", "SCAG": "Sword Coast",
         "VRGR": "Van Richten's", "DSotDQ": "Dragonlance", "RHW": "Horrors Within"}
CORE = ["PHB", "XPHB", "XGE", "TCE"]


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def inline(t):
    """Open5e markdown -> tiny safe HTML (escape first, then bold/italic)."""
    t = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    t = re.sub(r"\*\*\*(.+?)\*\*\*", r"<b><i>\1</i></b>", t)
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"(?<![\w*])[_*]([^_*\n]+?)[_*](?![\w*])", r"<i>\1</i>", t)
    return t


def table_rows(lines):
    rows = []
    for ln in lines:
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        rows.append([inline(c) for c in cells])
    return rows


def blocks(text):
    """Split SRD text into [{'p': html} | {'t': title, 'rows': [[...]]} | {'li': [html]}]."""
    out = []
    if not text:
        return out
    text = text.replace("\r", "")
    paras = re.split(r"\n\s*\n", text)
    for para in paras:
        lines = [l for l in para.split("\n") if l.strip()]
        if not lines:
            continue
        # tables spread over lines
        if sum(1 for l in lines if l.strip().startswith("|")) >= 2:
            head = [l for l in lines if not l.strip().startswith("|")]
            tl = [l for l in lines if l.strip().startswith("|")]
            title = None
            for h in head:
                m = re.match(r"\s*(?:\*\*)?Table:?\s*(.+?)(?:\*\*)?\s*$", h)
                if m:
                    title = m.group(1)
                else:
                    out.append({"p": inline(h)})
            out.append({"t": title, "rows": table_rows(tl)})
            continue
        # a table squeezed onto one line: "Table: Omens | a | b | |---|---| | x | y | Rest of text"
        one = " ".join(l.strip() for l in lines)
        m = re.search(r"(?:Table:\s*([^|]+?)\s*)?(\|.*\|)", one)
        if m and "---" in m.group(2):
            before, after = one[:m.start()].strip(), one[m.end():].strip()
            if before:
                out.append({"p": inline(before)})
            rows = re.split(r"\|\s+\|", m.group(2))
            out.append({"t": m.group(1), "rows": table_rows(["|" + r.strip(" |") + "|" for r in rows])})
            if after:
                out.append({"p": inline(after)})
            continue
        if all(re.match(r"\s*[-*]\s+", l) for l in lines):
            out.append({"li": [inline(re.sub(r"^\s*[-*]\s+", "", l)) for l in lines]})
            continue
        for l in lines:
            if re.match(r"\s*[-*]\s+", l) and out and "li" in out[-1]:
                out[-1]["li"].append(inline(re.sub(r"^\s*[-*]\s+", "", l)))
            elif re.match(r"\s*[-*]\s+", l):
                out.append({"li": [inline(re.sub(r"^\s*[-*]\s+", "", l))]})
            else:
                out.append({"p": inline(l.strip())})
    # SRD 5.1 lists sometimes run straight into the next paragraph ("...especially good or bad The spell
    # doesn't..."): split the last item where a sentence obviously starts
    fixed = []
    for b in out:
        fixed.append(b)
        if "li" in b and len(b["li"][-1]) > 120:
            m = re.search(r"(?<=[a-z]) (?=(?:The|You|If|Each|This|While|When|Until|A|An|On|For) [a-z])", b["li"][-1])
            if m and m.start() > 15:
                last = b["li"][-1]
                b["li"][-1] = last[:m.start()].strip()
                fixed.append({"p": last[m.start():].strip()})
    return fixed


def main():
    facts = json.loads((ROOT / "data-src" / "spell-facts.json").read_text(encoding="utf-8"))["spells"]
    classes = json.loads((ROOT / "data-src" / "classes.json").read_text(encoding="utf-8"))
    o5 = json.loads((ROOT / "source" / "open5e-spells.json").read_text(encoding="utf-8"))
    srd = {(r["document"], norm(r["name"])): r for r in o5}

    books = {}
    for k, v in classes.pop("books").items():
        books[k] = {"name": v["name"], "short": SHORT.get(k, k), "pub": v["published"], "h": HUES.get(k, (len(books) * 47) % 360),
                    "core": k in CORE}

    spells, matched, missing = [], 0, []
    by_ref = {}
    # names that have a 2024-rules version in any book (the 2024 PHB or a later one, e.g. Catnap)
    new_names = {norm(s["name"]) for s in facts if s["ed"] == "2024"}
    for s in facts:
        rec = dict(s)
        rec.pop("srdName", None)
        rec.pop("reprint", None)
        # in the 2024 rules, an older spell that no 2024 book reprinted is still usable ("from older books")
        reprinted = s["ed"] == "2014" and ("XPHB" in s["reprint"] or norm(s["name"]) in new_names)
        rec["legacy"] = s["ed"] == "2014" and not reprinted and "2024" in s["lists"]
        if reprinted:
            rec["lists"].pop("2024", None)
        if s["srd"]:
            doc = "srd-2024" if s["srd"] == "5.2" else "srd-2014"
            r = srd.get((doc, norm(s.get("srdName") or s["name"]))) or srd.get((doc, norm(s["name"])))
            if r:
                matched += 1
                rec["text"] = blocks(r["desc"])
                if r.get("higher_level"):
                    rec["higher"] = blocks(r["higher_level"])
                if r.get("material_specified"):
                    rec["mat"] = inline(r["material_specified"])
                if r["name"] != s["name"]:
                    rec["srdName"] = r["name"]
            else:
                missing.append(f"{s['name']} ({s['srd']})")
                rec["srd"] = None
        for k in ("dmg", "save", "cond"):
            if not rec[k]:
                rec.pop(k)
        for k in ("atk", "mcost", "conc", "ritual", "legacy"):
            if not rec.get(k):
                rec.pop(k, None)
        spells.append(rec)
        by_ref[f"{norm(s['name'])}|{s['src']}"] = rec["id"]

    # resolve subclass spell refs ("bless|PHB") to spell ids; keep the 2024 reprint where there is one
    unresolved = set()
    by_name = {}
    for s in spells:
        by_name.setdefault(norm(s["name"]), []).append(s)
    for ed, cls in classes.items():
        for c in cls:
            for sub in c["subclasses"]:
                for opt in sub["options"]:
                    keep = []
                    for sp in opt["spells"]:
                        nm, src = sp.pop("ref").rsplit("|", 1)
                        sid = by_ref.get(f"{norm(nm)}|{src}")
                        cands = by_name.get(norm(nm), [])
                        if ed == "2024":
                            new = [x for x in cands if x["ed"] == "2024"]
                            if new:
                                sid = new[0]["id"]
                        elif not sid and cands:
                            sid = next((x["id"] for x in cands if x["ed"] == "2014"), cands[0]["id"])
                        if not sid:
                            unresolved.add(nm)
                            continue
                        sp["id"] = sid
                        if not sp["bySpellLevel"]:
                            sp.pop("bySpellLevel")
                        keep.append(sp)
                    opt["spells"] = keep

    out = {
        "generated": datetime.date.today().isoformat(),
        "books": books,
        "classes": classes,
        "spells": spells,
    }
    p = ROOT / "site" / "data" / "spells.json"
    p.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(spells)} spells ({matched} with SRD text) -> {p} ({p.stat().st_size // 1024} KB)")
    if missing:
        print("  SRD spells without an Open5e match:", ", ".join(missing))
    if unresolved:
        print("  unresolved subclass spells:", ", ".join(sorted(unresolved)))


if __name__ == "__main__":
    main()

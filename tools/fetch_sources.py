"""Refresh the raw inputs in source/ and data-src/.

Run by hand (not in CI):  python tools/fetch_sources.py

1. Open5e v2 API -> source/open5e-spells.json
   SRD 5.1 (srd-2014) and SRD 5.2 (srd-2024) spells only. CC-BY-4.0 text.
2. 5etools-src (fan dataset on GitHub) -> data-src/spell-facts.json and data-src/classes.json
   FACTS ONLY: spell name, level, school, casting time, range, components (V/S/M flags,
   no material text), duration, concentration, ritual, damage types, saves, classes, book
   and page; class spell-slot / cantrip / known / prepared numbers; subclass spell lists
   (spell names by level). No description text is kept, ever.
"""
import datetime
import json
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "dnd-magic-site-build/1.0 (+https://github.com/WernerCD/dnd-magic)"}
FIVE = "https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/"
TODAY = datetime.date.today().isoformat()
NEW_RULES = "2024-09-17"  # 2024 Player's Handbook: books from here on use the 2024 rules
CLASSES = ["artificer", "bard", "cleric", "druid", "fighter", "paladin", "ranger", "rogue",
           "sorcerer", "warlock", "wizard"]
# class source per edition (Artificer 2014 = Tasha's, 2024 = Eberron: Forge of the Artificer)
CLASS_SRC = {"2014": {"PHB", "TCE"}, "2024": {"XPHB", "EFA"}}


def get(url):
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print("  retry", url, e)
            time.sleep(3)


def fetch_open5e():
    url = "https://api.open5e.com/v2/spells/?document__key__in=srd-2014,srd-2024&limit=200"
    rows = []
    while url:
        print("GET", url)
        d = get(url)
        rows.extend(d["results"])
        url = d.get("next")
    keep = ("key", "name", "level", "desc", "higher_level", "material_specified", "material_cost",
            "material_consumed", "casting_time", "range_text", "duration", "concentration", "ritual")
    out = []
    for r in rows:
        o = {k: r.get(k) for k in keep}
        o["document"] = r["document"]["key"]
        o["classes"] = [c["name"] for c in r.get("classes", [])]
        out.append(o)
    out.sort(key=lambda r: r["key"])
    p = ROOT / "source" / "open5e-spells.json"
    p.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"  open5e spells: {len(out)} rows -> {p.name}")


# ---------------------------------------------------------------- 5etools facts
SCHOOL = {"A": "Abjuration", "C": "Conjuration", "D": "Divination", "E": "Enchantment",
          "V": "Evocation", "I": "Illusion", "N": "Necromancy", "T": "Transmutation", "P": "Psionic"}


def books():
    b = {x["id"]: x for x in get(FIVE + "books.json")["book"]}
    a = {x["id"]: x for x in get(FIVE + "adventures.json")["adventure"]}
    names = {}
    for k, x in list(b.items()) + list(a.items()):
        if str(x.get("group", "")).endswith("-alt"):
            continue  # partnered / third-party products
        pub = x.get("published", "")
        if pub and pub > TODAY:
            continue  # not out yet
        names[k] = {"name": x["name"], "published": pub}
    return names


def fmt_time(t):
    t = t[0]
    n, u = t.get("number", 1), t.get("unit")
    if u == "bonus":
        return "1 bonus action", "bonus"
    if u == "reaction":
        return "1 reaction", "reaction"
    if u == "action":
        return f"{n} action" + ("s" if n != 1 else ""), "action"
    return f"{n} {u}" + ("s" if n != 1 else ""), "long"


def fmt_range(r):
    t = r.get("type")
    d = r.get("distance") or {}
    dt, amt = d.get("type"), d.get("amount")
    if t == "point":
        if dt in ("self", "touch", "sight", "unlimited"):
            return dt.title()
        if dt == "plane":
            return "Same plane"
        return f"{amt} {'foot' if amt == 1 else dt}" if dt == "feet" else f"{amt} {dt}" if amt != 1 else f"1 {dt.rstrip('s')}"
    if t in ("radius", "sphere", "cone", "line", "cube", "emanation", "hemisphere", "cylinder"):
        unit = "foot" if dt == "feet" else dt.rstrip("s")
        return f"Self ({amt}-{unit} {t})"
    if t == "special":
        return "Special"
    return t.title() if t else ""


def fmt_dur(ds):
    out, conc = [], False
    for d in ds:
        t = d.get("type")
        if t == "instant":
            out.append("Instantaneous")
        elif t == "timed":
            x = d["duration"]
            amt, u = x.get("amount", 1), x["type"]
            s = f"{amt} {u}" + ("s" if amt != 1 else "")
            if x.get("upTo") or d.get("concentration"):
                s = "Up to " + s
            if d.get("concentration"):
                conc = True
                s = "Concentration, " + s[0].lower() + s[1:]
            out.append(s)
        elif t == "permanent":
            ends = d.get("ends") or []
            if "dispel" in ends and "trigger" in ends:
                out.append("Until dispelled or triggered")
            elif "dispel" in ends:
                out.append("Until dispelled")
            else:
                out.append("Permanent")
        elif t == "special":
            out.append("Special")
    return " or ".join(out), conc


def comp(c):
    parts = [k.upper() for k in ("v", "s") if c.get(k)]
    m = c.get("m")
    cost = False
    if m:
        parts.append("M")
        if isinstance(m, dict) and (m.get("cost") or m.get("consume")):
            cost = True
    if c.get("r"):
        parts.append("R")
    return ", ".join(parts), cost


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("'", "")).strip("-")


def fetch_5etools():
    names = books()
    idx = get(FIVE + "spells/index.json")
    lookup = get(FIVE + "spells/sources.json")
    spells = []
    for src, fn in idx.items():
        if src not in names:
            continue
        for s in get(FIVE + "spells/" + fn).get("spell", []):
            if s.get("source") not in names:
                continue
            tm, tcat = fmt_time(s["time"])
            dur, conc = fmt_dur(s.get("duration", []))
            cs, mcost = comp(s.get("components", {}))
            ed = "2024" if (s.get("source") == "XPHB" or names[s["source"]]["published"] >= NEW_RULES) else "2014"
            cl = lookup.get(s["source"], {}).get(s["name"], {})
            lists = {"2014": {}, "2024": {}}
            for c, variant in [(c, False) for c in cl.get("class", [])] + [(c, True) for c in cl.get("classVariant", [])]:
                for e, srcs in CLASS_SRC.items():
                    if c["source"] in srcs and c["name"] not in lists[e]:
                        # Tasha's optional expanded class lists are flagged so they can be shown as such
                        lists[e][c["name"]] = "tce" if variant and c.get("definedInSource") == "TCE" else 1
            atk = s.get("spellAttack") or []
            spells.append({
                "id": f"{s['source'].lower()}.{slug(s['name'])}",
                "name": s["name"],
                "src": s["source"],
                "page": s.get("page"),
                "ed": ed,
                "lvl": s["level"],
                "school": SCHOOL.get(s["school"], s["school"]),
                "time": tm, "tcat": tcat,
                "range": fmt_range(s.get("range", {})),
                "comp": cs, "mcost": mcost,
                "dur": dur, "conc": conc,
                "ritual": bool((s.get("meta") or {}).get("ritual")),
                "dmg": sorted(s.get("damageInflict") or []),
                "save": sorted(x.title() for x in (s.get("savingThrow") or [])),
                "atk": "Melee" if atk == ["M"] else "Ranged" if atk == ["R"] else ("Melee/Ranged" if atk else None),
                "cond": sorted(s.get("conditionInflict") or []),
                "srd": "5.2" if s.get("srd52") else ("5.1" if s.get("srd") else None),
                # the SRD sometimes prints a spell under another name (Acid Arrow for Melf's Acid Arrow)
                "srdName": next((x for x in (s.get("srd52"), s.get("srd")) if isinstance(x, str)), None),
                "reprint": [r.split("|")[1] if "|" in r else "PHB" for r in (s.get("reprintedAs") or [])],
                "lists": {e: v for e, v in lists.items() if v},
            })
    spells.sort(key=lambda r: (r["name"], r["src"]))
    out = ROOT / "data-src" / "spell-facts.json"
    out.write_text(json.dumps({"spells": spells}, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"  spell facts: {len(spells)} rows -> {out.name}")
    fetch_classes(names)


def spell_refs(v):
    """additionalSpells value -> (list of 'name|SRC' refs, list of notes)."""
    refs, notes = [], []
    items = []
    if isinstance(v, list):
        items = v
    elif isinstance(v, dict):
        for k, x in v.items():
            items += x if isinstance(x, list) else []
    for x in items:
        if isinstance(x, str):
            nm, _, src = x.partition("|")
            src = src.split("#")[0] or "PHB"
            refs.append(f"{nm.split('#')[0]}|{src.upper()}")
        elif isinstance(x, dict) and "all" in x:
            m = re.search(r"class=(\w+)", x["all"])
            lv = re.search(r"level=(\d)", x["all"])
            if m:
                notes.append({"allOf": m.group(1).title(), "lvl": int(lv.group(1)) if lv else None})
        elif isinstance(x, dict) and "choose" in x:
            notes.append({"choose": x["choose"] if isinstance(x["choose"], str) else "list", "count": x.get("count", 1)})
    return refs, notes


def table(groups):
    """Pull the cantrips / known / prepared / slots columns out of 5etools classTableGroups."""
    out = {}
    for g in groups or []:
        labels = [re.sub(r"\{@filter ([^|]+)\|.*?\}", r"\1", l) if isinstance(l, str) else "" for l in g.get("colLabels", [])]
        if "rowsSpellProgression" in g:
            out["slots"] = g["rowsSpellProgression"]
            continue
        rows = g.get("rows") or []
        for i, l in enumerate(labels):
            col = [r[i] if i < len(r) else None for r in rows]
            col = [re.sub(r"\{@filter ([^|]+)\|.*?\}", r"\1", c) if isinstance(c, str) else c for c in col]
            key = {"Spell Slots": "pactSlots", "Slot Level": "pactLevel"}.get(l)
            if key:
                out[key] = col
    return out


def fetch_classes(names):
    out = {"2014": [], "2024": []}
    for cname in CLASSES:
        d = get(FIVE + f"class/class-{cname}.json")
        allsubs = d.get("subclass", [])
        orig = {(s["name"], s["source"], s["classSource"]): s for s in allsubs if not s.get("_copy")}
        for cl in d.get("class", []):
            ed = next((e for e, srcs in CLASS_SRC.items() if cl["source"] in srcs), None)
            if not ed or cl["source"] not in names:
                continue
            t = table(cl.get("classTableGroups"))
            rec = {
                "id": slug(cl["name"]), "name": cl["name"], "src": cl["source"], "page": cl.get("page"),
                "ability": cl.get("spellcastingAbility"), "caster": cl.get("casterProgression"),
                "cantrips": cl.get("cantripProgression"),
                "known": cl.get("spellsKnownProgression"),
                "prepared": cl.get("preparedSpellsProgression"),
                "preparedFormula": cl.get("preparedSpells"),
                "spellbook": cl.get("spellsKnownProgressionFixed"),
                "slots": t.get("slots"), "pactSlots": t.get("pactSlots"), "pactLevel": t.get("pactLevel"),
                "subclassTitle": cl.get("subclassTitle"),
                "subclasses": [],
            }
            subs = [s for s in allsubs if s["className"] == cl["name"] and s["classSource"] == cl["source"]]
            native = {s["shortName"] for s in subs if not s.get("_copy")}
            for s in subs:
                if s.get("_copy"):
                    if s["shortName"] in native:
                        continue  # a newer version of this subclass exists for this class
                    c = s["_copy"]
                    base = orig.get((c["name"], c["source"], c["classSource"]))
                    if not base or base.get("reprintedAs"):
                        continue  # missing, or the old version of a subclass reprinted for this class
                    s = {**base, **{k: v for k, v in s.items() if k != "_copy"}}
                if s["source"] not in names:
                    continue  # UA, partnered or unreleased
                sub = {"id": slug(s["shortName"]) + ("-" + s["source"].lower() if s["source"] not in ("PHB", "XPHB") else ""),
                       "name": s["name"], "short": s["shortName"], "src": s["source"], "page": s.get("page"),
                       "srd": bool(s.get("srd") or s.get("srd52")),
                       "legacy": ed == "2024" and names[s["source"]]["published"] < NEW_RULES,
                       "options": []}
                if s.get("casterProgression"):
                    st = table(s.get("subclassTableGroups"))
                    sub.update({"ability": s.get("spellcastingAbility"), "caster": s["casterProgression"],
                                "cantrips": s.get("cantripProgression"), "known": s.get("spellsKnownProgression"),
                                "prepared": s.get("preparedSpellsProgression"), "slots": st.get("slots")})
                for a in s.get("additionalSpells") or []:
                    opt = {"name": a.get("name"), "spells": [], "notes": []}
                    for kind in ("prepared", "known", "expanded", "innate"):
                        for lv, v in (a.get(kind) or {}).items():
                            refs, notes = spell_refs(v)
                            lvl = int(lv[1:]) if lv.startswith("s") else (int(lv) if lv.isdigit() else 1)
                            for r in refs:
                                opt["spells"].append({"ref": r, "at": lvl, "kind": kind, "bySpellLevel": lv.startswith("s")})
                            for n in notes:
                                n.update({"kind": kind, "at": lvl})
                                opt["notes"].append(n)
                    if opt["spells"] or opt["notes"]:
                        sub["options"].append(opt)
                rec["subclasses"].append(sub)
            rec["subclasses"].sort(key=lambda x: (x["legacy"], x["name"]))
            out[ed].append(rec)
    used = {s["src"] for s in json.loads((ROOT / "data-src" / "spell-facts.json").read_text(encoding="utf-8"))["spells"]}
    used |= {c["src"] for e in out.values() for c in e} | {s["src"] for e in out.values() for c in e for s in c["subclasses"]}
    out["books"] = {k: v for k, v in sorted(names.items()) if k in used}
    p = ROOT / "data-src" / "classes.json"
    p.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"  books: {len(out['books'])}; classes: {len(out['2014'])} (2014), {len(out['2024'])} (2024) -> {p.name}")


if __name__ == "__main__":
    fetch_open5e()
    fetch_5etools()

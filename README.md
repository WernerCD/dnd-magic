# D&D Spell Planner

Plan spell lists for 2014 and 2024 D&D 5e rules: class and subclass spell lists, spell slots and known or prepared counts at any level, and your own ranked, annotated spell lists.

**Live:** https://wernercd.github.io/dnd-magic/ · part of the [D&D Toolbox](https://wernercd.github.io/dnd/) · [Changes](https://wernercd.github.io/dnd-magic/changes.html)

## Features
- Pick the rules (2014 or 2024), a class, subclass and level. Classes: Artificer, Bard, Cleric, Druid, Paladin, Ranger, Sorcerer, Warlock, Wizard, plus the Eldritch Knight (Fighter) and Arcane Trickster (Rogue) third casters. In 2024 mode, older-book subclasses are listed separately under "From older books".
- The spellcasting card shows cantrips, spells known or prepared (with your ability modifier for the 2014 Cleric, Druid, Paladin, Wizard and Artificer formulas), the Wizard spellbook size, the highest spell level, the spell slots, Pact Magic slots and Mystic Arcanum.
- Subclass spells are marked: **Always prepared** (domain, oath, circle and 2024 subclass spells), **Bonus spell** (always known, not counted) and **Expanded list** (2014 warlock patrons). Choices such as the Circle of the Land terrain, the Genie kind or the Divine Soul affinity have their own menu. A subclass that grants another class's list (Divine Soul) adds it.
- Browse the class list, or **All spells** (for feats, Magical Secrets and the like). Filters: name, level, school, casting time, concentration, ritual, damage type, saving throw or spell attack, sources, "castable now", "hide picked", and Tasha's optional class spells (2014) or older-book spells (2024).
- Cards at **Basic**, **Stats** or **Full** detail, and a detail dialog with the facts, the full SRD text where there is one, and a 2014/2024 switch when a spell exists in both.
- **My lists:** add spells with **+**; they group by spell level with a count against your cantrip and known/prepared limits. Rank them by dragging the handle (mouse or touch), with the arrow buttons, or with the arrow keys on the focused handle. Give each a tier (S to D) and a short note. Wizards mark prepared spells with **P**.
- **Print my spell sheet** (in the list menu) prints the spellcasting stats and your ranked list, with each spell's casting time, range, components, duration, save, book and page, plus your tiers and notes.
- Keep as many lists as you like (saved in this browser's localStorage), copy a **share link** that carries the whole list in the URL (`#list=...`), and **export/import** every list as a JSON backup.
- Filters live in the URL (`?lv=1,2&school=Evocation&conc=yes&view=full`), and `?spell=xphb.fireball` opens one spell.
- The header, footer, theme (`dnd.theme`) and update notice follow the shared toolbox conventions (`WernerCD/dnd`, `STYLE.md`). The change log is `site/changes.html`.

## Data and copyright
The repo and site are public, so only freely licensed text is reproduced.

| Data | Where it comes from | What is shown |
|---|---|---|
| SRD 5.1 spells (2014 rules) | [Open5e API v2](https://api.open5e.com/v2/spells/) `document__key__in=srd-2014` | Full text |
| SRD 5.2 spells (2024 rules) | Same endpoint, `srd-2024` | Full text |
| Spells from other official books (Xanathar's, Tasha's, Fizban's, the 2024 PHB beyond the SRD...) | Compiled from the community [5etools-src](https://github.com/5etools-mirror-3/5etools-src) dataset | **Facts only**: name, level, school, casting time, range, components (V/S/M flags, no material text), duration, concentration, ritual, damage types, saves, classes, book and page. No rules text |
| Class tables and subclass spell lists | Same 5etools data | Numbers and spell names only |

Nothing is taken from D&D Beyond. Partnered ("-alt") products and books not yet released are left out.

## Layout
| Path | What |
|---|---|
| `site/` | The static site (HTML/CSS/JS, no build step for the page itself), including `404.html` |
| `site/data/spells.json` | Generated data, rebuilt by CI on every push |
| `tools/build_data.py` | Builds the data from `source/` and `data-src/` (offline) |
| `tools/fetch_sources.py` | Refreshes `source/` from Open5e and `data-src/` from 5etools (run by hand) |
| `tools/check_site.py` | Shared toolbox smoke check, run by CI before every deploy |
| `source/open5e-spells.json` | SRD 5.1 and 5.2 spells (CC-BY-4.0) |
| `data-src/spell-facts.json` | Facts for every official spell |
| `data-src/classes.json` | Class progressions, subclasses and their spell lists, book names |

## Run locally
```bash
python tools/fetch_sources.py   # only to refresh the inputs
python tools/build_data.py
python -m http.server 8773 --directory site
```
Checks (CI runs the same before every deploy): `python tools/check_site.py`. Every push to `main` deploys to GitHub Pages via `.github/workflows/pages.yml`, which stamps the commit id over `?v=dev` on the asset links.

## Credits and license
- Code: MIT, see [LICENSE](LICENSE).
- This work includes material from the System Reference Document 5.1 and 5.2 by Wizards of the Coast LLC, available at https://dnd.wizards.com/resources/systems-reference-document, licensed under the Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/legalcode).
- SRD text retrieved through [Open5e](https://open5e.com). Facts for non-SRD spells, the class tables and subclass spell lists compiled from [5etools-src](https://github.com/5etools-mirror-3/5etools-src).
- Unofficial fan content. Not affiliated with or endorsed by Wizards of the Coast.

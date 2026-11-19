"""Spell Planner checks for the shared smoke suite (tools/smoke_test.py, STYLE.md 7).

run(page, base, check) is called with a fresh 1280x900 page; check(cond, message) records a result.
"""


def run(page, base, check):
    def fresh(url=""):
        page.goto(base + url, wait_until="load")
        page.wait_for_function("document.querySelectorAll('#list .card').length > 0", timeout=15000)
        page.wait_for_timeout(300)

    def search(text):
        page.fill("#search", text)
        page.wait_for_timeout(400)

    def card(name):
        return page.locator("#list .card", has=page.locator(f".nm:text-is('{name}')"))

    page.goto(base, wait_until="load")
    page.evaluate("['dm.lists','dm.char','dnd.characters'].forEach(k => localStorage.removeItem(k))")
    fresh()

    # the default build: a 2024 Wizard 5 with its spell list
    check("Wizard, level 5" in page.inner_text("#rulesTitle"), "[spells] default build is Wizard level 5")
    check(page.locator("#slots .slot").count() == 9, "[spells] spell slot row shows 9 levels")

    # Sources default to the core books only (STYLE 6f)
    check(page.inner_text("#srcSum").strip() == "Sources: core", "[spells] Sources picker defaults to core books")
    ticked = page.evaluate("[...document.querySelectorAll('#srcList input:checked')].map(i => i.dataset.src)")
    check(ticked == ["XPHB"], f"[spells] only the 2024 Player's Handbook is ticked by default (got {ticked})")

    # picking a class shows its own spell list
    page.select_option("#cls0", "cleric")
    page.wait_for_timeout(400)
    check("Cleric" in page.inner_text("#rulesTitle"), "[spells] picking Cleric updates the rules card")
    search("Guiding Bolt")
    check(card("Guiding Bolt").count() == 1, "[spells] the Cleric list has Guiding Bolt")
    search("Magic Missile")
    check(card("Magic Missile").count() == 0, "[spells] the Cleric list leaves out Magic Missile")
    search("")

    # a tick-box filter narrows the list and goes into the URL
    before = page.locator("#list .card").count()
    page.click("#mPick-lv summary")
    page.click("[data-mk='lv'][data-mo='1']")
    page.wait_for_timeout(300)
    levels = page.evaluate("[...document.querySelectorAll('#list .card .cr')].map(e => e.textContent)")
    check(levels and all(x == "1st" for x in levels), "[spells] Level filter shows only level 1 spells")
    check("lv=1" in page.url, "[spells] the filter is kept in the URL")
    page.keyboard.press("Escape")
    check(not page.locator("#mPick-lv").evaluate("d => d.open"), "[spells] Escape closes the filter menu")
    page.click("#resetBtn")
    page.wait_for_timeout(300)
    check(page.locator("#list .card").count() >= before, "[spells] Reset filters brings the list back")

    # add a spell, rate it, and both survive a reload
    search("Bless")
    card("Bless").locator("[data-add]").click()
    page.wait_for_timeout(200)
    check(page.locator("#groups li.row[data-id='xphb.bless']").count() == 1, "[spells] + adds Bless to My list")
    page.click("#groups [data-rate='xphb.bless'][data-v='4']")
    page.wait_for_timeout(200)
    fresh()
    check(page.locator("#groups li.row[data-id='xphb.bless']").count() == 1, "[spells] My list keeps Bless after a reload")
    stars = page.locator("#groups [data-rate='xphb.bless'][aria-checked='true']").get_attribute("data-v")
    check(stars == "4", f"[spells] the 4-star rating survives a reload (got {stars})")

    # multiclassing: a second class shows a combined build
    page.click("#addCls")
    page.wait_for_timeout(300)
    check(" / " in page.inner_text("#rulesTitle"), "[spells] + Add a class makes a multiclass build")
    check(page.locator("#mcTable table.mc").count() == 1, "[spells] the multiclass table appears")

    # a share link carries the list (spells and ratings) into a fresh browser
    page.evaluate("Object.defineProperty(navigator, 'clipboard', {value: {writeText: t => { window.__shared = t; return Promise.resolve(); }}, configurable: true})")
    page.click("#listMenu summary")
    page.click("[data-act='share']")
    page.wait_for_timeout(300)
    link = page.evaluate("window.__shared || ''")
    check("#list=" in link, "[spells] Copy share link makes a #list= link")
    if "#list=" in link:
        page.evaluate("['dm.lists','dm.char','dnd.characters'].forEach(k => localStorage.removeItem(k))")
        page.goto(base + "?shared=1#" + link.split("#", 1)[1], wait_until="load")
        page.wait_for_function("document.querySelectorAll('#list .card').length > 0", timeout=15000)
        page.wait_for_timeout(300)
        name = page.evaluate("document.querySelector('#listSel').selectedOptions[0].textContent")
        check(name.endswith("(shared)"), f"[spells] the share link adds a '(shared)' list (got {name!r})")
        check(page.locator("#groups li.row[data-id='xphb.bless']").count() == 1, "[spells] the shared list has Bless")
        check(page.locator("#groups [data-rate='xphb.bless'][aria-checked='true']").count() == 1, "[spells] the shared list keeps the rating")
    page.evaluate("['dm.lists','dm.char','dnd.characters'].forEach(k => localStorage.removeItem(k))")

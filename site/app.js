/* D&D Spell Planner: vanilla JS, no build step. Data: data/spells.json (built by tools/build_data.py). */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode or full */ } }
  };

  var TIERS = ['S', 'A', 'B', 'C', 'D'];
  var TIER_NAME = { S: 'S: must have', A: 'A: great', B: 'B: good', C: 'C: situational', D: 'D: skip' };
  var SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation'];
  var SCH_HUE = { Abjuration: 205, Conjuration: 45, Divination: 185, Enchantment: 320, Evocation: 10, Illusion: 265, Necromancy: 140, Transmutation: 95 };
  var ABIL = { int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
  var KIND = { prepared: 'Always prepared', known: 'Bonus spell', innate: 'Bonus spell', expanded: 'Expanded list' };
  var PAGE = 60;

  var DATA = null, SP = {}, BYNAME = {};
  var F = defaults();
  var LS = { lists: [], cur: null };
  var L = null;          // the current list
  var shown = PAGE, editing = {}, lastRows = [];

  function defaults() {
    return { q: '', lv: [], sch: [], time: '', conc: '', rit: '', dmg: '', save: '', books: null, scope: 'class', only: '',
      castable: false, hidePicked: false, opt: true, view: store.get('dm.view', 'stats'), sort: 'level' };
  }
  function lvName(n) { return n === 0 ? 'Cantrip' : 'Level ' + n; }
  function lvShort(n) { return n === 0 ? 'Cantrip' : n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th'; }
  function uid() { return Math.random().toString(36).slice(2, 10); }

  // ------------------------------------------------------------ class model
  // A list holds up to 3 class rows (L.k): {cls, sub, opt, lvl, mod}. cls "_other" is a class without
  // spellcasting: it only adds to the character level.
  var OTHER = '_other', MAXROWS = 3;
  function classes() { return DATA.classes[L.ed] || []; }
  function casterClasses() {
    return classes().filter(function (c) { return c.caster || c.subclasses.some(function (s) { return s.caster; }); });
  }
  function clsRec(r) { return r.cls === OTHER ? null : (classes().find(function (c) { return c.id === r.cls; }) || casterClasses()[0]); }
  function subs(r) { var c = clsRec(r); if (!c) return []; return c.caster ? c.subclasses : c.subclasses.filter(function (s) { return s.caster; }); }
  function subRec(r) { var c = clsRec(r); if (!c) return null; var s = subs(r); return s.find(function (x) { return x.id === r.sub; }) || (c.caster ? null : s[0]); }
  function optRec(r) {
    var s = subRec(r);
    if (!s || !s.options.length) return null;
    return s.options.find(function (o) { return o.name === r.opt; }) || s.options[0];
  }
  function sumTo(arr, n) { var t = 0; for (var i = 0; i < n; i++) t += arr[i] || 0; return t; }
  function charLevel() { return L.k.reduce(function (t, r) { return t + r.lvl; }, 0); }
  function rowLabel(r) { var c = clsRec(r), s = subRec(r); return !c ? 'Other class' : (s && !c.caster ? s.name : c.name); }

  function prog(row) {
    var c = clsRec(row), s = subRec(row), lv = row.lvl, i = lv - 1;
    var src = s && s.caster ? s : c;
    var r = { ability: src.ability, caster: src.caster, cantrips: src.cantrips ? src.cantrips[i] : 0, slots: [0, 0, 0, 0, 0, 0, 0, 0, 0], max: 0 };
    if (src.slots) src.slots[i].forEach(function (n, k) { r.slots[k] = n; });
    if (c.pactSlots && !(s && s.caster)) {
      r.pact = { n: c.pactSlots[i], lvl: parseInt(c.pactLevel[i], 10) };
      r.arcanum = [6, 7, 8, 9].filter(function (x, k) { return lv >= 11 + 2 * k; });
    }
    r.slots.forEach(function (n, k) { if (n > 0) r.max = k + 1; });
    if (r.pact) r.max = r.pact.lvl;
    r.maxAny = r.arcanum && r.arcanum.length ? r.arcanum[r.arcanum.length - 1] : r.max;
    if (src.known) { r.kind = 'known'; r.count = src.known[i]; }
    else if (src.prepared) { r.kind = 'prepared'; r.count = src.prepared[i]; }
    else if (c.preparedFormula) {
      var half = /\/\s*2/.test(c.preparedFormula);
      r.kind = 'prepared'; r.formula = half ? 'half' : 'full';
      r.count = r.max ? Math.max(1, (half ? Math.floor(lv / 2) : lv) + (row.mod | 0)) : 0;
    }
    if (c.spellbook && !(s && s.caster)) r.book = sumTo(c.spellbook, lv);
    r.listClass = c.caster ? c.name : 'Wizard';
    return r;
  }
  // lowest class level at which a spell level can be cast by this class alone
  function minLevelFor(sl, row) {
    if (sl === 0) return 1;
    var out = null;
    for (var lv = 1; lv <= 20 && out == null; lv++) {
      var p = prog({ cls: row.cls, sub: row.sub, opt: row.opt, lvl: lv, mod: row.mod });
      if (p.maxAny >= sl) out = lv;
    }
    return out;
  }

  // which spells come from the subclass: id -> {kind, at, bySpellLevel}
  function subSpells(row) {
    var o = optRec(row), m = {};
    if (!o) return m;
    o.spells.forEach(function (x) { if (!m[x.id]) m[x.id] = x; });
    return m;
  }
  function unlocked(x, sp, X) { return x.bySpellLevel ? sp.lvl <= X.P.maxAny : x.at <= X.r.lvl; }
  function extraLists(row) {
    var o = optRec(row), out = [];
    if (o) o.notes.forEach(function (n) { if (n.allOf && out.indexOf(n.allOf) < 0) out.push(n.allOf); });
    return out;
  }

  // the spellcasting classes of the current list, each with its own progression and subclass spells
  function contexts() {
    return L.k.filter(function (r) { return r.cls !== OTHER; }).map(function (r) {
      var c = clsRec(r), P = prog(r);
      return { r: r, key: c.id, c: c, s: subRec(r), o: optRec(r), P: P, SS: subSpells(r), names: [P.listClass].concat(extraLists(r)), label: rowLabel(r) };
    });
  }
  // shared spell slots. One class with Spellcasting uses its own table; two or more add up a caster level
  // (full casters count fully, Paladin/Ranger half, Artificer half rounded up, EK/AT a third) and use the
  // multiclass table. Pact Magic stays separate.
  function combine(X) {
    var full = (classes().find(function (c) { return c.id === 'wizard'; }) || {}).slots;
    var r = { slots: [0, 0, 0, 0, 0, 0, 0, 0, 0], max: 0, pact: null, arcanum: null, casterLevel: null };
    var sc = X.filter(function (x) { return !x.P.pact && x.P.max > 0; });
    if (sc.length === 1) r.slots = sc[0].P.slots.slice();
    else if (sc.length > 1) {
      var cl = 0;
      sc.forEach(function (x) {
        var t = x.P.caster, l = x.r.lvl;
        x.contrib = t === 'full' ? l : t === '1/2' ? Math.floor(l / 2) : t === 'artificer' ? Math.ceil(l / 2) : t === '1/3' ? Math.floor(l / 3) : 0;
        cl += x.contrib;
      });
      r.casterLevel = Math.min(20, cl);
      r.parts = sc;
      if (r.casterLevel > 0 && full) r.slots = full[r.casterLevel - 1].slice();
    }
    r.slots.forEach(function (n, k) { if (n > 0) r.max = k + 1; });
    X.forEach(function (x) { if (x.P.pact) { r.pact = x.P.pact; r.arcanum = x.P.arcanum; r.pactBy = x; } });
    r.maxAny = Math.max(r.max, r.pact ? r.pact.lvl : 0, r.arcanum && r.arcanum.length ? r.arcanum[r.arcanum.length - 1] : 0);
    r.cantrips = X.some(function (x) { return x.P.cantrips; });
    return r;
  }

  // ------------------------------------------------------------ spell pool
  function pool() {
    return DATA.spells.filter(function (s) {
      if (L.ed === '2014') return s.ed === '2014';
      return s.ed === '2024' || (s.legacy && F.opt);
    });
  }
  function member1(s, X) {
    var v = null, lists = s.lists[L.ed] || {}, names = X.names;
    if (X.SS[s.id]) return { on: true, sub: X.SS[s.id] };
    for (var k = 0; k < names.length; k++) {
      var x = lists[names[k]];
      if (x === 1) return { on: true };
      if (x === 'tce') v = 'tce';
    }
    if (v === 'tce' && F.opt) return { on: true, tce: true };
    return { on: false, tce: v === 'tce' };
  }
  // {on, by: [contexts that have it], sub, subBy, tce}
  function membership(s) {
    var res = { on: false, by: [], sub: null, tce: false }, plain = false, tce = false;
    CTX.forEach(function (X) {
      var m = member1(s, X);
      if (m.sub && !res.sub) { res.sub = m.sub; res.subBy = X; }
      if (m.on) { res.on = true; res.by.push(X); if (m.tce) tce = true; else plain = true; }
      else if (m.tce) tce = true;
    });
    res.tce = tce && !plain;
    return res;
  }
  // the highest spell level this spell could be learned at: by a class that has it, else by any class
  function learnMax(m) {
    var X = m.by.length ? m.by : CTX;
    return X.reduce(function (t, x) { return Math.max(t, x.P.maxAny); }, 0);
  }
  function hasCantrips(m) { return (m.by.length ? m.by : CTX).some(function (x) { return x.P.cantrips; }); }
  // which class a spell on the list counts against (null = "other", not counted)
  function assigned(it, sp) {
    if (it.c === '-') return null;
    if (it.c) { var f = CTX.find(function (x) { return x.key === it.c; }); if (f) return f; }
    var m = membership(sp);
    return m.by.find(function (x) { return sp.lvl === 0 ? x.P.cantrips : x.P.maxAny >= sp.lvl; }) || m.by[0] || null;
  }

  // ------------------------------------------------------------ lists
  function newList(name) {
    var ed = L ? L.ed : '2024', k = L ? JSON.parse(JSON.stringify(L.k)) : [{ cls: 'wizard', sub: null, opt: null, lvl: 5, mod: 3 }];
    return { id: uid(), name: name || 'My spells', ed: ed, k: k, items: [] };
  }
  function cleanRow(r) {
    r = r || {};
    return { cls: String(r.cls || 'wizard').slice(0, 40), sub: r.sub ? String(r.sub).slice(0, 60) : null, opt: r.opt ? String(r.opt).slice(0, 60) : null,
      lvl: Math.min(20, Math.max(1, parseInt(r.lvl, 10) || 1)), mod: Math.min(10, Math.max(-5, parseInt(r.mod, 10) || 0)) };
  }
  function saveLists() { LS.cur = L.id; store.set('dm.lists', LS); }
  function loadLists() {
    var d = store.get('dm.lists', null);
    if (d && Array.isArray(d.lists) && d.lists.length) {
      LS = { lists: d.lists.map(clean).filter(Boolean), cur: d.cur };
    }
    if (!LS.lists.length) { L = null; LS.lists = [newList('My spells')]; }
    L = LS.lists.find(function (x) { return x.id === LS.cur; }) || LS.lists[0];
  }
  function clean(x) {
    if (!x || typeof x !== 'object') return null;
    var items = Array.isArray(x.items) ? x.items : [];
    // lists saved before multiclassing kept one class at the top level
    var k = (Array.isArray(x.k) && x.k.length ? x.k : [x]).slice(0, MAXROWS).map(cleanRow);
    var seen = {}, tot = 0;
    k = k.filter(function (r, i) {
      if (i && r.cls !== OTHER && seen[r.cls]) return false;
      seen[r.cls] = 1;
      if (tot + r.lvl > 20) r.lvl = 20 - tot;
      tot += r.lvl;
      return r.lvl >= 1 && !(i === 0 && r.cls === OTHER);
    });
    if (!k.length) k = [cleanRow({})];
    return {
      id: typeof x.id === 'string' && x.id ? x.id.slice(0, 20) : uid(),
      name: String(x.name || 'Imported list').slice(0, 60),
      ed: x.ed === '2014' ? '2014' : '2024',
      k: k,
      ch: typeof x.ch === 'string' ? x.ch.slice(0, 40) : undefined, chU: typeof x.chU === 'string' ? x.chU.slice(0, 40) : undefined,
      items: items.filter(function (it) { return it && typeof it.id === 'string'; }).slice(0, 400).map(function (it) {
        var o = { id: it.id.slice(0, 80), t: TIERS.indexOf(it.t) >= 0 ? it.t : '', n: String(it.n || '').slice(0, 500), p: !!it.p };
        if (it.c) o.c = String(it.c).slice(0, 40);
        return o;
      })
    };
  }
  function has(id) { return L.items.some(function (it) { return it.id === id; }); }
  function addSpell(id) { if (!has(id)) { L.items.push({ id: id, t: '', n: '', p: false }); saveLists(); } }
  function removeSpell(id) { L.items = L.items.filter(function (it) { return it.id !== id; }); saveLists(); }
  function item(id) { return L.items.find(function (it) { return it.id === id; }); }
  // switching rules: carry each spell over to the same-named spell of the other edition where there is one
  function remapEdition(ed) {
    L.items.forEach(function (it) {
      var s = SP[it.id];
      if (!s) return;
      var c = (BYNAME[norm(s.name)] || []).filter(function (x) { return ed === '2014' ? x.ed === '2014' : (x.ed === '2024' || x.legacy); });
      c.sort(function (a, b) { return (a.ed === ed ? 0 : 1) - (b.ed === ed ? 0 : 1); });
      if (c[0]) it.id = c[0].id;
    });
    var seen = {};
    L.items = L.items.filter(function (it) { if (seen[it.id]) return false; seen[it.id] = 1; return true; });
  }

  // ------------------------------------------------------------ shared characters (dnd.characters, STYLE 6c)
  // A character gets one spell list here holding all its spellcasting classes (multiclass). The list remembers
  // the character (L.ch) and the character's 'updated' stamp it was last synced from (L.chU); the character's
  // link links['dnd-magic'] = { list: <preferred list id> }. Syncing only changes rules, classes, levels,
  // subclasses and modifiers, never the spells, tiers or notes.
  var REPO = 'dnd-magic';
  var DC = window.DndChar || null;
  function charOf(x) { return DC && x && x.ch ? DC.get(x.ch) : null; }
  // the character's classes as list rows (at most 3, non-casters folded into one "other" row)
  function charRows(ch) {
    var keep = L, rows = [], other = 0;
    L = { ed: ch.ed, k: [] };
    ch.classes.forEach(function (x) {
      var c = casterClasses().find(function (c) { return c.id === x.cls; });
      var row = c ? { cls: c.id, sub: null, opt: null, lvl: x.lvl, mod: 0 } : null;
      if (row) {
        var s = subs(row).find(function (s) { return DC.sameSub({ sub: s.id, subName: s.name }, x) || DC.sameSub({ sub: s.short, subName: s.short }, x); });
        if (s) row.sub = s.id;
        else if (!c.caster) row = null;   // a Fighter or Rogue that is not an Eldritch Knight or Arcane Trickster
      }
      if (row) {
        var src = row.sub && subRec(row) && subRec(row).caster ? subRec(row) : c;
        row.mod = Math.max(-5, Math.min(10, DC.mod(ch, src.ability || c.ability)));
      }
      if (row && rows.length < MAXROWS - (other ? 1 : 0)) rows.push(row); else other += x.lvl;
    });
    L = keep;
    if (rows.length && other) {
      if (rows.length === MAXROWS) rows.pop();
      rows.push({ cls: OTHER, sub: null, opt: null, lvl: Math.min(other, 20), mod: 0 });
    }
    return rows;
  }
  // bring one list in line with its character; returns true if anything changed
  function syncList(x, ch) {
    var rows = charRows(ch);
    if (!rows.length) return false;
    var before = JSON.stringify([x.ed, x.k]);
    if (x.ed !== ch.ed) { var keep = L; L = x; remapEdition(ch.ed); L = keep; x.ed = ch.ed; }
    rows.forEach(function (r) { var o = x.k.find(function (y) { return y.cls === r.cls && y.sub === r.sub; }); if (o && o.opt) r.opt = o.opt; });
    x.k = rows;
    x.chU = ch.updated;
    return JSON.stringify([x.ed, x.k]) !== before;
  }
  function charLists(ch) { return LS.lists.filter(function (x) { return x.ch === ch.id; }); }
  // switch to the active character's list, creating it if needed; quiet = no notices
  function useChar(ch, quiet) {
    if (!DC || !ch) return false;
    if (!charRows(ch).length) { if (!quiet) notice(ch.name + ' has no spellcasting class yet, so your lists stay as they are.'); return false; }
    var mine = charLists(ch), link = ch.links[REPO] || {};
    var x = mine.find(function (y) { return y.id === link.list; }) || mine[0];
    if (!x) {
      x = { id: uid(), name: (ch.name + "'s spells").slice(0, 60), ed: ch.ed, k: [], items: [], ch: ch.id };
      // a brand-new visitor's empty starter list is replaced, not kept beside it
      if (LS.lists.length === 1 && !LS.lists[0].items.length && !LS.lists[0].ch) LS.lists = [];
      LS.lists.push(x);
      if (!quiet) notice('Made the list "' + x.name + '" for ' + ch.name + ' (' + DC.summary(ch) + ').');
    }
    syncList(x, ch);
    L = x;
    if (link.list !== x.id) DC.setLink(ch.id, REPO, { list: x.id });
    return true;
  }
  // characters changed (here, in another tab, or on another site): resync linked lists, follow the active one
  var lastActive = null, quietChars = false;
  function onChars(active) {
    if (quietChars) return;
    var changed = false;
    LS.lists.forEach(function (x) {
      var ch = charOf(x);
      if (ch && ch.updated !== x.chU && syncList(x, ch)) changed = true;
      else if (ch) x.chU = ch.updated;
    });
    var aid = active ? active.id : null;
    if (aid !== lastActive) {
      lastActive = aid;
      store.set('dm.char', aid);
      if (active && L.ch !== aid && useChar(active)) changed = true;
    }
    if (changed || LS.lists.some(function (x) { return x.ch && !charOf(x); })) { editing = {}; shown = PAGE; }
    saveLists();
    renderAll();
  }
  // "Save as character": a new shared character from this list's classes (only when the list has none)
  function saveAsChar() {
    if (!DC) return;
    var name = prompt('Name for the new character:', L.name.replace(/'s spells$/, ''));
    if (name == null || !name.trim()) return;
    var ab = [10, 10, 10, 10, 10, 10], ix = { str: 0, dex: 1, con: 2, int: 3, wis: 4, cha: 5 };
    var cls = L.k.filter(function (r) { return r.cls !== OTHER; }).map(function (r) {
      var c = clsRec(r), s = subRec(r), src = s && s.caster ? s : c;
      if (c.preparedFormula && ix[c.ability] != null) ab[ix[c.ability]] = Math.max(ab[ix[c.ability]], 10 + 2 * r.mod);
      return { cls: c.id, lvl: r.lvl, sub: s ? s.id : null, subName: s ? s.name : null, ab: src.ability };
    });
    quietChars = true;
    var ch = DC.save({ name: name.trim().slice(0, 60), ed: L.ed, ab: ab,
      classes: cls.map(function (x) { return { cls: x.cls, lvl: x.lvl, sub: x.sub, subName: x.subName }; }), links: {} }, REPO);
    L.ch = ch.id; L.chU = ch.updated;
    saveLists();
    DC.setLink(ch.id, REPO, { list: L.id });
    lastActive = ch.id;
    store.set('dm.char', ch.id);
    DC.setActive(ch.id);
    quietChars = false;
    renderAll();
    notice('Saved ' + ch.name + ' as a shared character. The other D&D Toolbox sites can use it now.' +
      (L.k.some(function (r) { return r.cls === OTHER; }) ? ' Classes without spellcasting were left out; add them in the Multiclass Planner.' : ''));
  }
  function charNote() {
    var ch = charOf(L);
    if (!ch) return '';
    return '<span class="small muted charnote">Linked to <b>' + esc(ch.name) + '</b> (' + esc(DC.summary(ch)) + '). Level-ups made on other sites update this list; changes here stay in this list.' +
      ' <button type="button" class="linkish" id="unlinkChar">Unlink</button></span>';
  }

  // ------------------------------------------------------------ share / export
  function b64e(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64d(s) {
    var bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function shareUrl() {
    var c = { v: 2, n: L.name, e: L.ed, k: L.k.map(function (r) { return [r.cls, r.sub, r.opt, r.lvl, r.mod]; }),
      i: L.items.map(function (it) {
        var r = [it.id, it.t, it.n, it.p ? 1 : 0, it.c || ''];
        while (r.length > 1 && !r[r.length - 1]) r.pop();
        return r;
      }) };
    return location.origin + location.pathname + '#list=' + b64e(JSON.stringify(c));
  }
  function readShare() {
    var m = /#list=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      var c = JSON.parse(b64d(m[1]));
      var k = Array.isArray(c.k) ? c.k.map(function (r) { return { cls: r[0], sub: r[1], opt: r[2], lvl: r[3], mod: r[4] }; })
        : [{ cls: c.c, sub: c.s, opt: c.o, lvl: c.l, mod: c.m }];
      var x = clean({ name: c.n, ed: c.e, k: k,
        items: (c.i || []).map(function (r) { return { id: r[0], t: r[1], n: r[2], p: r[3], c: r[4] }; }) });
      x.id = uid();
      var sig = JSON.stringify([x.ed, x.k, x.items]);
      var same = LS.lists.find(function (y) { return JSON.stringify([y.ed, y.k, y.items]) === sig; });
      if (same) { L = same; notice('That shared list is already saved as "' + same.name + '".'); }
      else {
        x.name = x.name + ' (shared)';
        // a brand-new visitor only has the empty starter list: replace it rather than keep it beside the shared one
        if (LS.lists.length === 1 && !LS.lists[0].items.length) LS.lists = [];
        LS.lists.push(x); L = x; notice('Added the shared list "' + x.name + '" to your lists.'); }
      saveLists();
    } catch (e) { notice('That share link could not be read.'); }
  }
  function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function importJson(text) {
    var d = JSON.parse(text), arr = Array.isArray(d) ? d : (Array.isArray(d.lists) ? d.lists : [d]);
    var n = 0;
    arr.forEach(function (x) {
      var c = clean(x);
      if (!c) return;
      if (LS.lists.some(function (y) { return y.id === c.id; })) c.id = uid();
      LS.lists.push(c); n++;
    });
    if (!n) throw new Error('no lists');
    L = LS.lists[LS.lists.length - 1];
    saveLists();
    return n;
  }
  var noticeTimer = null;
  function notice(msg) {
    var n = $('#notice');
    n.textContent = msg; n.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { n.hidden = true; }, 6000);
  }

  // ------------------------------------------------------------ URL
  function readUrl() {
    var p = new URLSearchParams(location.search);
    if (p.get('q')) F.q = p.get('q');
    if (p.get('lv')) F.lv = p.get('lv').split(',').map(Number).filter(function (n) { return n >= 0 && n <= 9; });
    if (p.get('school')) F.sch = p.get('school').split(',').filter(function (s) { return SCHOOLS.indexOf(s) >= 0; });
    ['time', 'conc', 'rit', 'dmg', 'save', 'sort'].forEach(function (k) { if (p.get(k)) F[k] = p.get(k); });
    if (p.get('books')) F.books = p.get('books') === 'all' ? null : p.get('books').split(',');
    if (p.get('scope') === 'all') F.scope = 'all';
    if (p.get('only')) F.only = p.get('only');
    if (p.get('view')) F.view = ['basic', 'stats', 'full'].indexOf(p.get('view')) >= 0 ? p.get('view') : F.view;
    if (p.get('castable') === '1') F.castable = true;
    if (p.get('hide') === '1') F.hidePicked = true;
    if (p.get('opt') === '0') F.opt = false;
    return p.get('spell');
  }
  function writeUrl() {
    var p = new URLSearchParams();
    if (F.q) p.set('q', F.q);
    if (F.lv.length) p.set('lv', F.lv.join(','));
    if (F.sch.length) p.set('school', F.sch.join(','));
    ['time', 'conc', 'rit', 'dmg', 'save'].forEach(function (k) { if (F[k]) p.set(k, F[k]); });
    if (F.sort !== 'level') p.set('sort', F.sort);
    if (F.books) p.set('books', F.books.join(','));
    if (F.scope === 'all') p.set('scope', 'all');
    else if (F.only) p.set('only', F.only);
    if (F.view !== 'stats') p.set('view', F.view);
    if (F.castable) p.set('castable', '1');
    if (F.hidePicked) p.set('hide', '1');
    if (!F.opt) p.set('opt', '0');
    var open = $('#detail').open && $('#detail').dataset.id;
    if (open) p.set('spell', open);
    var qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }

  // ------------------------------------------------------------ build controls
  function rowHtmlBuild(r, i) {
    var c = clsRec(r), multi = L.k.length > 1;
    if (c) r.cls = c.id;
    var used = L.k.map(function (x, j) { return j === i ? null : x.cls; });
    var opts = casterClasses().filter(function (x) { return used.indexOf(x.id) < 0; }).map(function (x) {
      var label = x.caster ? x.name : (x.subclasses.find(function (s) { return s.caster; }).name + ' (' + x.name + ')');
      return '<option value="' + esc(x.id) + '"' + (c && x.id === c.id ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('') + (i ? '<option value="' + OTHER + '"' + (!c ? ' selected' : '') + '>Other class (no spells)</option>' : '');
    var n = i + 1, h = '<div class="crow" data-row="' + i + '">';
    h += '<div class="ctl"><label class="ctl-label" for="cls' + i + '">' + (multi ? 'Class ' + n : 'Class') + '</label><select id="cls' + i + '" data-f="cls">' + opts + '</select></div>';
    if (c) {
      var ss = subs(r), s = subRec(r);
      r.sub = s ? s.id : null;
      var lab = function (x) { return x.name + (x.legacy ? ' (' + DATA.books[x.src].short + ')' : ''); };
      var o1 = function (x) { return '<option value="' + esc(x.id) + '"' + (s && x.id === s.id ? ' selected' : '') + '>' + esc(lab(x)) + '</option>'; };
      var native = ss.filter(function (x) { return !x.legacy; }), old = ss.filter(function (x) { return x.legacy; });
      h += '<div class="ctl"><label class="ctl-label" for="sub' + i + '">' + esc(c.subclassTitle || 'Subclass') + '</label><select id="sub' + i + '" data-f="sub">' +
        (c.caster ? '<option value="">None yet / not chosen</option>' : '') + native.map(o1).join('') +
        (old.length ? '<optgroup label="From older books">' + old.map(o1).join('') + '</optgroup>' : '') + '</select></div>';
      var named = s ? s.options.filter(function (o) { return o.name; }) : [];
      if (named.length >= 2) {
        var o = optRec(r);
        r.opt = o.name;
        h += '<div class="ctl"><label class="ctl-label" for="opt' + i + '">' + (/Land/.test(s.name) ? 'Land' : /Genie/.test(s.name) ? 'Genie kind' : /Divine Soul/.test(s.name) ? 'Affinity' : 'Option') + '</label><select id="opt' + i + '" data-f="opt">' +
          named.map(function (x) { return '<option' + (x.name === o.name ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></div>';
      } else r.opt = null;
    } else { r.sub = null; r.opt = null; }
    var room = 20 - (charLevel() - r.lvl);
    h += '<div class="ctl ctl-level"><label class="ctl-label" for="lvl' + i + '">' + (multi ? esc(rowLabel(r)) + ' level' : 'Level') + ' <output for="lvl' + i + '">' + r.lvl + '</output></label>' +
      '<input type="range" id="lvl' + i + '" data-f="lvl" min="1" max="' + room + '" value="' + r.lvl + '"' + (room <= 1 ? ' disabled' : '') + '></div>';
    if (c && c.preparedFormula && !(subRec(r) && subRec(r).caster)) {
      h += '<div class="ctl ctl-wis"><label class="ctl-label" for="mod' + i + '">' + (ABIL[c.ability] || 'Ability').slice(0, 3).toUpperCase() + ' modifier</label><input type="number" id="mod' + i + '" data-f="mod" min="-5" max="10" value="' + r.mod + '" inputmode="numeric"></div>';
    }
    if (multi) h += '<button type="button" class="icon-btn crow-rm" data-rmrow="' + i + '" aria-label="Remove ' + esc(rowLabel(r)) + ' from this character" title="Remove this class">\u2715</button>';
    return h + '</div>';
  }
  function renderBuild() {
    $$('[data-ed]').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.ed === L.ed)); });
    var h = L.k.map(rowHtmlBuild).join('');
    var free = 20 - charLevel();
    if (L.k.length < MAXROWS) h += '<div class="crow crow-add"><button type="button" class="btn" id="addCls"' + (free < 1 ? ' disabled title="Your character is already level 20"' : '') + '>+ Add a class (multiclass)</button>' +
      (L.k.length > 1 ? '<span class="small muted">Character level ' + charLevel() + '</span>' : '') + '</div>';
    else h += '<div class="crow crow-add"><span class="small muted">Character level ' + charLevel() + ' (3 classes at most here)</span></div>';
    $('#classRows').innerHTML = h + charNote();
    var sc = $('[data-act="savechar"]');
    if (sc) sc.hidden = !DC || !!charOf(L);
    $('#listSel').innerHTML = LS.lists.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === L.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('');
    $('#optTogText').textContent = L.ed === '2014' ? "Tasha's optional class spells" : 'Spells from older books';
    $('#optTogWrap').title = L.ed === '2014' ? "Include the optional class spells Tasha's Cauldron of Everything adds to each list" : 'Include spells from 2014-era books that the 2024 Player\'s Handbook did not reprint';
    $('#optTog').checked = F.opt;
  }

  function classNotes(X, multi) {
    var notes = [], P = X.P, c = X.c, s = X.s, lv = X.r.lvl;
    if (!P.maxAny && !P.cantrips) {
      var first = minLevelFor(1, X.r);
      notes.push('No spellcasting yet' + (first ? ': it starts at ' + (multi ? esc(X.label) + ' ' : '') + 'level ' + first + '.' : '.'));
    }
    if (P.formula) notes.push('Prepared spells = ' + (P.formula === 'half' ? 'half your ' + c.name + ' level (rounded down)' : 'your ' + c.name + ' level') + ' + your ' + (ABIL[c.ability] || '') + ' modifier (minimum 1). Set the modifier above.');
    if (P.book != null) notes.push('Your spellbook starts with 6 level 1 spells and gains 2 each ' + (multi ? 'Wizard ' : '') + 'level; you can also copy spells you find. Mark the spells you have prepared with the <b>P</b> box in your list.');
    if (P.pact) notes.push('Pact Magic: all your Pact slots are level ' + P.pact.lvl + ' and come back on a short rest.' + (multi ? ' You can cast your other classes\' spells with them, and your Warlock spells with your other slots.' : ''));
    if (P.arcanum && P.arcanum.length) notes.push('Mystic Arcanum: one spell each of level ' + P.arcanum.join(', ') + ', cast once per long rest without a slot. They do not count against your prepared or known spells.');
    if (L.ed === '2014' && s && s.caster) notes.push(s.name === 'Eldritch Knight' ? 'Most of your spells must be abjuration or evocation; the spells you learn at levels 3, 8, 14 and 20 can be from any school.' : 'Most of your spells must be enchantment or illusion; the spells you learn at levels 3, 8, 14 and 20 can be from any school.');
    if (X.o) X.o.notes.forEach(function (n) {
      if (n.allOf) notes.push('Your subclass adds the whole ' + esc(n.allOf) + ' spell list to yours (shown in Class list).');
      if (n.choose && n.at <= lv) notes.push('At level ' + n.at + ' your subclass also lets you pick ' + (n.count > 1 ? n.count + ' extra spells' : 'an extra spell') + ' (see the book for which).');
    });
    if (s && s.legacy) notes.push('This subclass is from ' + esc(DATA.books[s.src].name) + ', written for the 2014 rules. The 2024 rules allow older subclasses if your DM agrees.');
    if (s && !s.srd) notes.push('Subclass from ' + esc(DATA.books[s.src].name) + (s.page ? ' p.' + s.page : '') + ': only its spell list is shown here.');
    var nSub = Object.keys(X.SS).filter(function (id) { return SP[id] && unlocked(X.SS[id], SP[id], X) && X.SS[id].kind !== 'expanded'; }).length;
    if (nSub) notes.push(nSub + ' subclass spell' + (nSub === 1 ? ' is' : 's are') + ' always on hand at this level and do' + (nSub === 1 ? 'es' : '') + ' not count against your ' + (P.kind || 'spell') + ' total.');
    var pre = multi ? '<b>' + esc(X.label) + ':</b> ' : '';
    return notes.map(function (n) { return pre + n; });
  }
  function slotsHtml(slots) {
    return '<span class="ctl-label">Spell slots</span>' + slots.map(function (n, k) {
      return '<span class="slot' + (n ? '' : ' none') + '" title="' + n + ' level ' + (k + 1) + ' slot' + (n === 1 ? '' : 's') + '"><i>' + (k + 1) + '</i><b>' + (n || '\u2013') + '</b></span>';
    }).join('');
  }
  var CONTRIB = { full: 'full level', '1/2': 'half, rounded down', artificer: 'half, rounded up', '1/3': 'a third, rounded down' };
  function renderRules() {
    var C = COMBO, multi = L.k.length > 1, st = [], notes = [];
    var statHtml = function () { return st.map(function (x) { return '<div class="stat"><b>' + esc(x[1]) + '</b><span>' + esc(x[0]) + '</span></div>'; }).join(''); };
    if (!multi) {
      var X = CTX[0], P = X.P;
      $('#rulesTitle').textContent = X.label + ', level ' + X.r.lvl;
      $('#rulesSub').innerHTML = (X.s ? esc(X.s.name) + ' &middot; ' : '') + esc(L.ed) + ' rules &middot; ' + esc(ABIL[P.ability] || '') + ' spellcasting';
      st.push(['Cantrips', P.cantrips || 0]);
      if (P.kind) st.push([P.kind === 'known' ? 'Spells known' : 'Prepared spells', P.count]);
      if (P.book != null) st.push(['Spellbook (minimum)', P.book]);
      st.push(['Highest spell level', P.maxAny ? (P.arcanum && P.arcanum.length ? P.max + ' (+' + P.arcanum.join(', ') + ')' : P.max) : 'none yet']);
      if (P.pact) st.push(['Pact slots', P.pact.n + ' \u00d7 level ' + P.pact.lvl]);
      $('#stats').innerHTML = statHtml();
      $('#mcTable').innerHTML = '';
      $('#slots').innerHTML = P.pact ? '' : slotsHtml(P.slots);
      notes = classNotes(X, false);
    } else {
      $('#rulesTitle').textContent = L.k.map(function (r) { return rowLabel(r) + ' ' + r.lvl; }).join(' / ');
      $('#rulesSub').innerHTML = 'Character level ' + charLevel() + ' &middot; ' + esc(L.ed) + ' rules &middot; multiclass';
      st.push(['Character level', charLevel()]);
      if (C.casterLevel) st.push(['Caster level (slots)', C.casterLevel]);
      var top = Math.max(C.max, C.pact ? C.pact.lvl : 0);
      st.push(['Highest spell slot', C.maxAny ? (C.arcanum && C.arcanum.length ? top + ' (+' + C.arcanum.join(', ') + ')' : top) : 'none yet']);
      if (C.pact) st.push(['Pact slots', C.pact.n + ' \u00d7 level ' + C.pact.lvl]);
      $('#stats').innerHTML = statHtml();
      $('#mcTable').innerHTML = '<table class="mc"><thead><tr><th scope="col">Class</th><th scope="col">Cantrips</th><th scope="col">Spells</th><th scope="col">Learn up to</th></tr></thead><tbody>' +
        CTX.map(function (X) {
          var P = X.P;
          var sp = P.book != null ? P.count + ' prepared (' + P.book + '+ in book)' : P.kind ? P.count + ' ' + P.kind : '\u2013';
          return '<tr><th scope="row">' + esc(X.label) + ' ' + X.r.lvl + (X.s && X.c.caster ? ' <span class="small muted">' + esc(X.s.short || X.s.name) + '</span>' : '') + '</th><td>' + (P.cantrips || 0) + '</td><td>' + esc(sp) + '</td><td>' + (P.maxAny ? 'level ' + P.maxAny : 'none yet') + '</td></tr>';
        }).join('') + L.k.filter(function (r) { return r.cls === OTHER; }).map(function (r) {
          return '<tr class="muted"><th scope="row">Other class ' + r.lvl + '</th><td colspan="3">no spellcasting</td></tr>';
        }).join('') + '</tbody></table>';
      $('#slots').innerHTML = C.max ? slotsHtml(C.slots) : '';
      if (C.casterLevel) notes.push('Spell slots come from the multiclass Spellcaster table at caster level ' + C.casterLevel + ': ' +
        C.parts.map(function (x) { return esc(x.label) + ' ' + x.r.lvl + ' (' + CONTRIB[x.P.caster] + ') = ' + x.contrib; }).join(' + ') + '.');
      else if (C.max) {
        var one = CTX.find(function (x) { return !x.P.pact && x.P.max > 0; });
        notes.push('Only one of your classes has spell slots yet, so they come from the ' + esc(one.label) + ' table.');
      }
      notes.push('Each class learns or prepares its own spells with its own ability, only up to the highest level that class could cast on its own (the "Learn up to" column). Any slot can cast any of them. Pick which class each spell counts for in your list.');
      notes.push('Multiclassing needs 13 or more in the main ability of each of your classes.');
      CTX.forEach(function (X) { notes = notes.concat(classNotes(X, true)); });
    }
    $('#rulesNotes').innerHTML = notes.map(function (n) { return '<li>' + n + '</li>'; }).join('');
  }

  // ------------------------------------------------------------ filters
  var POOL = [], CTX = [], COMBO = null;
  function prepare() {
    POOL = pool(); CTX = contexts(); COMBO = combine(CTX);
  }
  function passBase(s, m) {
    if (F.scope === 'class' && !m.on) return false;
    if (F.books && F.books.indexOf(s.src) < 0) return false;
    return true;
  }
  function passFilters(s, m) {
    if (F.q && norm(s.name).indexOf(norm(F.q)) < 0) return false;
    if (F.lv.length && F.lv.indexOf(s.lvl) < 0) return false;
    if (F.sch.length && F.sch.indexOf(s.school) < 0) return false;
    if (F.time && s.tcat !== F.time) return false;
    if (F.conc && !!s.conc !== (F.conc === 'yes')) return false;
    if (F.rit && !!s.ritual !== (F.rit === 'yes')) return false;
    if (F.dmg && (!s.dmg || s.dmg.indexOf(F.dmg) < 0)) return false;
    if (F.save) {
      if (F.save === 'atk') { if (!s.atk) return false; }
      else if (!s.save || s.save.indexOf(F.save) < 0) return false;
    }
    if (F.castable && s.lvl > 0 && s.lvl > learnMax(m)) return false;
    if (F.castable && s.lvl === 0 && !hasCantrips(m)) return false;
    if (F.only && F.scope === 'class' && !m.by.some(function (x) { return x.key === F.only; })) return false;
    if (F.hidePicked && has(s.id)) return false;
    return true;
  }
  function results() {
    var out = [];
    POOL.forEach(function (s) {
      var m = membership(s);
      if (!passBase(s, m) || !passFilters(s, m)) return;
      out.push({ s: s, m: m });
    });
    var q = norm(F.q);
    out.sort(function (a, b) {
      var x = a.s, y = b.s;
      if (q) { var ax = norm(x.name).indexOf(q) === 0 ? 0 : 1, by = norm(y.name).indexOf(q) === 0 ? 0 : 1; if (ax !== by) return ax - by; }
      if (F.sort === 'level' && x.lvl !== y.lvl) return x.lvl - y.lvl;
      if (F.sort === 'school' && x.school !== y.school) return x.school < y.school ? -1 : 1;
      if (F.sort === 'src' && x.src !== y.src) return DATA.books[x.src].name < DATA.books[y.src].name ? -1 : 1;
      return x.name < y.name ? -1 : x.name > y.name ? 1 : 0;
    });
    return out;
  }

  function renderFilters() {
    $('#search').value = F.q;
    $$('[data-scope]').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.scope === F.scope)); });
    if (F.only && !CTX.some(function (x) { return x.key === F.only; })) F.only = '';
    $('#onlyCls').hidden = CTX.length < 2 || F.scope !== 'class';
    $('#onlyCls').innerHTML = '<option value="">All my classes</option>' + CTX.map(function (x) { return '<option value="' + esc(x.key) + '"' + (F.only === x.key ? ' selected' : '') + '>' + esc(x.label) + ' list</option>'; }).join('');
    $$('[data-detail]').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.detail === F.view)); });
    $('#lvlChips').innerHTML = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) {
      return '<button type="button" class="chip" data-lv="' + n + '" aria-pressed="' + (F.lv.indexOf(n) >= 0) + '" title="' + lvName(n) + '">' + (n === 0 ? 'C' : n) + '</button>';
    }).join('');
    $('#schChips').innerHTML = SCHOOLS.map(function (s) {
      return '<button type="button" class="chip schip" style="--h:' + SCH_HUE[s] + '" data-sch="' + s + '" aria-pressed="' + (F.sch.indexOf(s) >= 0) + '">' + s + '</button>';
    }).join('');
    $('#schSum').textContent = F.sch.length ? (F.sch.length === 1 ? F.sch[0] : F.sch.length + ' schools') : 'School';
    $('#schPick').classList.toggle('filtered', !!F.sch.length);
    ['time', 'conc', 'rit', 'sort'].forEach(function (k) { $('#' + k).value = F[k]; });
    var dm = {};
    POOL.forEach(function (s) { (s.dmg || []).forEach(function (d) { dm[d] = 1; }); });
    $('#dmg').innerHTML = '<option value="">Any damage type</option>' + Object.keys(dm).sort().map(function (d) { return '<option value="' + d + '"' + (F.dmg === d ? ' selected' : '') + '>' + d[0].toUpperCase() + d.slice(1) + ' damage</option>'; }).join('');
    $('#save').innerHTML = '<option value="">Any save or attack</option>' + ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'].map(function (a) {
      return '<option value="' + a + '"' + (F.save === a ? ' selected' : '') + '>' + a + ' save</option>';
    }).join('') + '<option value="atk"' + (F.save === 'atk' ? ' selected' : '') + '>Spell attack</option>';
    $('#castable').checked = F.castable; $('#hidePicked').checked = F.hidePicked;
    renderSources();
  }
  function renderSources() {
    var cnt = {};
    POOL.forEach(function (s) { cnt[s.src] = (cnt[s.src] || 0) + 1; });
    var codes = Object.keys(cnt).sort(function (a, b) {
      var A = DATA.books[a], B = DATA.books[b];
      if (A.core !== B.core) return A.core ? -1 : 1;
      return A.pub < B.pub ? -1 : 1;
    });
    var q = norm($('#srcQ').value || '');
    $('#srcList').innerHTML = codes.map(function (k) {
      var b = DATA.books[k], on = !F.books || F.books.indexOf(k) >= 0;
      var hide = q && norm(b.name).indexOf(q) < 0 && norm(k).indexOf(q) < 0;
      return '<label class="srcrow" style="--h:' + b.h + '"' + (hide ? ' hidden' : '') + '><input type="checkbox" data-src="' + k + '"' + (on ? ' checked' : '') + '><span class="dot"></span><span>' + esc(b.name) + '</span><span class="n">' + cnt[k] + '</span></label>';
    }).join('');
    var sel = F.books ? F.books.filter(function (k) { return cnt[k]; }).length : codes.length;
    $('#srcSum').textContent = sel === codes.length ? 'Sources' : 'Sources (' + sel + '/' + codes.length + ')';
    $('#srcPick').classList.toggle('filtered', sel !== codes.length);
  }

  // ------------------------------------------------------------ cards
  function tagsFor(s, m) {
    var t = [];
    if (s.conc) t.push('<span class="tag t-conc" title="Concentration">C</span>');
    if (s.ritual) t.push('<span class="tag t-rit" title="Ritual">R</span>');
    var multi = CTX.length > 1;
    if (m && m.sub) t.push('<span class="tag t-sub" title="From your ' + (multi ? esc(m.subBy.label) + ' ' : '') + 'subclass' + (m.sub.bySpellLevel ? '' : ', from ' + (multi ? esc(m.subBy.label) + ' ' : '') + 'level ' + m.sub.at) + '">' + KIND[m.sub.kind] + (multi ? ' (' + esc(m.subBy.label) + ')' : '') + '</span>');
    if (m && multi) m.by.forEach(function (x) { if (x !== m.subBy) t.push('<span class="tag t-cls" title="On the ' + esc(x.label) + ' spell list">' + esc(x.label) + '</span>'); });
    if (m && m.tce) t.push('<span class="tag t-opt" title="Optional class spell from Tasha\'s Cauldron of Everything">Tasha\'s optional</span>');
    if (s.legacy && L.ed === '2024') t.push('<span class="tag t-old" title="From a 2014-era book; not reprinted in the 2024 Player\'s Handbook">Older book</span>');
    return t.join('');
  }
  function srcTag(s) {
    var b = DATA.books[s.src];
    return '<span class="srctag" style="--h:' + b.h + '" title="' + esc(b.name) + (s.page ? ' p.' + s.page : '') + '">' + esc(b.short) + (s.srd ? ' \u00b7 SRD ' + s.srd : '') + '</span>';
  }
  function factsHtml(s) {
    var rows = [['Casting time', s.time], ['Range', s.range], ['Components', s.comp + (s.mcost ? ' (costly)' : '')], ['Duration', s.dur]];
    if (s.dmg) rows.push(['Damage', s.dmg.map(cap).join(', ')]);
    if (s.save) rows.push(['Save', s.save.join(', ')]);
    if (s.atk) rows.push(['Attack', s.atk + ' spell attack']);
    return rows;
  }
  function cap(x) { return x[0].toUpperCase() + x.slice(1); }
  function blocksHtml(bl) {
    return (bl || []).map(function (b) {
      if (b.p != null) return '<p>' + b.p + '</p>';
      if (b.li) return '<ul>' + b.li.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
      if (b.rows) return '<div class="tbl">' + (b.t ? '<b>' + esc(b.t) + '</b>' : '') + '<table>' + b.rows.map(function (r, i) {
        return '<tr>' + r.map(function (c) { return i ? '<td>' + c + '</td>' : '<th>' + c + '</th>'; }).join('') + '</tr>';
      }).join('') + '</table></div>';
      return '';
    }).join('');
  }
  function lineFor(s) { return (s.lvl === 0 ? s.school + ' cantrip' : 'Level ' + s.lvl + ' ' + s.school.toLowerCase()); }
  // "Castable from level 9" / "From Wizard level 5": the soonest class level that can learn this spell
  function whenText(s, m) {
    var best = null;
    (m.by.length ? m.by : CTX).forEach(function (x) {
      var l = minLevelFor(s.lvl, x.r);
      if (l && (!best || l - x.r.lvl < best.l - best.x.r.lvl)) best = { l: l, x: x };
    });
    if (!best) return CTX.length > 1 ? 'Not castable by these classes' : 'Not castable by this class';
    return CTX.length > 1 ? 'From ' + esc(best.x.label) + ' level ' + best.l : 'Castable from level ' + best.l;
  }
  function card(r) {
    var s = r.s, m = r.m, on = has(s.id);
    var tooHigh = s.lvl > learnMax(m) && s.lvl > 0;
    var h = '<article class="card' + (tooHigh ? ' locked' : '') + (m.on ? '' : ' off-list') + '" data-id="' + s.id + '" style="--h:' + SCH_HUE[s.school] + '">';
    h += '<div class="card-top"><h3><button type="button" class="linkish nm" data-open="' + s.id + '">' + esc(s.name) + '</button></h3><span class="cr" title="' + lvName(s.lvl) + '">' + lvShort(s.lvl) + '</span></div>';
    h += '<div class="meta">' + esc(lineFor(s)) + (F.view === 'basic' ? ' &middot; ' + esc(s.time) : '') + '</div>';
    h += '<div class="pills">' + tagsFor(s, m) + srcTag(s) + (m.on || F.scope !== 'all' ? '' : '<span class="tag t-off" title="Not on your class list">Not on your list</span>') + '</div>';
    if (F.view !== 'basic') {
      h += '<dl class="facts cfacts">' + factsHtml(s).map(function (x) { return '<dt>' + x[0] + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl>';
    }
    if (F.view === 'full') {
      h += s.text ? '<div class="itext mini">' + blocksHtml(s.text) + (s.higher ? '<p><b><i>' + (s.lvl ? 'At Higher Levels.' : 'Cantrip Upgrade.') + '</i></b> ' + blocksHtml(s.higher).replace(/^<p>|<\/p>$/g, '') + '</p>' : '') + '</div>'
        : '<p class="small muted factsonly">Rules text: ' + esc(DATA.books[s.src].name) + (s.page ? ' p.' + s.page : '') + '.</p>';
    }
    if (tooHigh) h += '<div class="why">' + whenText(s, m) + '</div>';
    h += '<button type="button" class="fav add" data-add="' + s.id + '" aria-pressed="' + on + '" aria-label="' + (on ? 'Remove ' : 'Add ') + esc(s.name) + (on ? ' from' : ' to') + ' my list" title="' + (on ? 'On your list: click to remove' : 'Add to my list') + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' + (on ? '<path d="M5 12l5 5 9-10"/>' : '<path d="M12 5v14M5 12h14"/>') + '</svg></button>';
    return h + '</article>';
  }
  function renderList() {
    lastRows = results();
    var list = $('#list');
    list.className = 'list detail-' + F.view;
    list.innerHTML = lastRows.slice(0, shown).map(card).join('');
    $('#count').textContent = lastRows.length + ' spell' + (lastRows.length === 1 ? '' : 's');
    $('#empty').hidden = lastRows.length > 0;
    $('#moreBtn').hidden = lastRows.length <= shown;
  }

  // ------------------------------------------------------------ my list
  function classCounts() {
    var out = { _: { cantrips: 0, spells: 0, prepared: 0 } };
    CTX.forEach(function (x) { out[x.key] = { cantrips: 0, spells: 0, prepared: 0 }; });
    L.items.forEach(function (it) {
      var sp = SP[it.id];
      if (!sp) return;
      var x = assigned(it, sp), c = x ? out[x.key] : out._;
      if (sp.lvl === 0) c.cantrips++; else { c.spells++; if (it.p) c.prepared++; }
    });
    return out;
  }
  function slotText(lv) {
    var C = COMBO, parts = [], n = C.slots[lv - 1];
    if (n) parts.push(n + ' slot' + (n === 1 ? '' : 's'));
    if (C.pact && lv <= C.pact.lvl) parts.push('pact slots');
    else if (C.arcanum && C.arcanum.indexOf(lv) >= 0) parts.push('Mystic Arcanum');
    return parts.join(' + ') || 'not yet';
  }
  function renderMine() {
    var K = classCounts(), multi = CTX.length > 1;
    $('#mineTitle').textContent = L.name;
    var sub;
    if (L.k.length > 1) sub = L.k.map(function (r) { return rowLabel(r) + ' ' + r.lvl; }).join(' / ');
    else { var X0 = CTX[0]; sub = (X0.s && !X0.c.caster ? X0.s.name : X0.c.name + (X0.s ? ' (' + X0.s.short + ')' : '')) + ', level ' + X0.r.lvl; }
    var owner = charOf(L);
    $('#mineSub').textContent = (owner ? owner.name + ': ' : '') + sub + ', ' + L.ed + ' rules';
    var meter = function (label, have, max, title) {
      var cls = max == null ? '' : have > max ? ' over' : have === max ? ' full' : '';
      return '<span class="meter' + cls + '" title="' + esc(title || '') + '"><b>' + have + (max == null ? '' : ' / ' + max) + '</b> ' + label + '</span>';
    };
    var html = CTX.map(function (X) {
      var P = X.P, C = K[X.key], cs = [];
      if (P.cantrips || C.cantrips) cs.push(meter('cantrips', C.cantrips, P.cantrips || 0, X.label + ' cantrips on your list / cantrips you know at this level'));
      if (P.book != null) {
        cs.push(meter('in spellbook', C.spells, null, 'Leveled ' + X.label + ' spells on your list'));
        cs.push(meter('prepared (P)', C.prepared, P.count, 'Spells marked P / spells you can prepare'));
      } else if (P.kind) {
        cs.push(meter(P.kind === 'known' ? 'known' : 'prepared', C.spells, P.count, 'Leveled ' + X.label + ' spells on your list / spells you ' + (P.kind === 'known' ? 'know' : 'can prepare') + ' at this level'));
      }
      return (multi ? '<span class="mlabel">' + esc(X.label) + '</span>' : '') + cs.join('');
    }).join(multi ? '<span class="msep"></span>' : '');
    var o = K._.cantrips + K._.spells;
    if (o) html += (multi ? '<span class="msep"></span>' : '') + meter('other, not counted', o, null, 'Spells not counted against a class (feats, items, or not on your class list). Pick a class for a spell in its row to count it.');
    $('#counts').innerHTML = html;
    $('#tabCount').textContent = '(' + L.items.length + ')';
    $('#tabCount').setAttribute('aria-label', L.items.length + ' spells');

    var byLv = {}, seenFixed = {};
    for (var i = 0; i <= 9; i++) byLv[i] = { fixed: [], items: [] };
    CTX.forEach(function (X) {
      Object.keys(X.SS).forEach(function (id) {
        var x = X.SS[id], sp = SP[id];
        if (sp && x.kind !== 'expanded' && unlocked(x, sp, X) && !seenFixed[id]) { seenFixed[id] = 1; byLv[sp.lvl].fixed.push({ sp: sp, x: x, X: X }); }
      });
    });
    var unknown = [];
    L.items.forEach(function (it) { var sp = SP[it.id]; if (sp) byLv[sp.lvl].items.push(it); else unknown.push(it); });
    html = '';
    for (var lv = 0; lv <= 9; lv++) {
      var g = byLv[lv];
      if (!g.fixed.length && !g.items.length) continue;
      var slotTxt = lv === 0 ? '' : slotText(lv);
      html += '<section class="grp" data-lv="' + lv + '"><h3>' + (lv === 0 ? 'Cantrips' : 'Level ' + lv) + ' <span class="n">' + g.items.length + '</span>' + (slotTxt ? '<span class="gslots">' + slotTxt + '</span>' : '') + '</h3><ul class="rows">';
      g.fixed.forEach(function (f) {
        html += '<li class="row fixed"><span class="fixmark" aria-hidden="true">\u2605</span><button type="button" class="linkish nm" data-open="' + f.sp.id + '">' + esc(f.sp.name) + '</button><span class="tag t-sub">' + KIND[f.x.kind] + (multi ? ' (' + esc(f.X.label) + ')' : '') + '</span>' + pfacts(f.sp) + '</li>';
      });
      g.items.forEach(function (it, k) { html += rowHtml(it, SP[it.id], k, g.items.length); });
      html += '</ul></section>';
    }
    if (unknown.length) {
      html += '<section class="grp"><h3>Not in this data <span class="n">' + unknown.length + '</span></h3><ul class="rows">' + unknown.map(function (it) {
        return '<li class="row" data-id="' + esc(it.id) + '"><span class="nm">' + esc(it.id) + '</span><span class="row-btns"><button type="button" class="mini-btn" data-rm="' + esc(it.id) + '" aria-label="Remove">\u2715</button></span></li>';
      }).join('') + '</ul></section>';
    }
    if (!html) html = '<p class="empty">No spells yet. Use <b>+</b> on a spell card to add it here.</p>';
    $('#groups').innerHTML = html;
  }
  function rowHtml(it, sp, k, n) {
    var nm = esc(sp.name), X = assigned(it, sp), m = membership(sp), multi = CTX.length > 1;
    var tooHigh = sp.lvl > 0 && sp.lvl > (X ? X.P.maxAny : COMBO.maxAny);
    var h = '<li class="row' + (tooHigh ? ' locked' : '') + '" data-id="' + sp.id + '">';
    h += '<button type="button" class="handle" data-drag aria-label="Move ' + nm + ': drag, or use the up and down arrow keys" title="Drag to reorder (or focus and use arrow keys)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></button>';
    h += '<span class="rank" aria-hidden="true">' + (k + 1) + '</span>';
    h += '<select class="tier" data-tier="' + sp.id + '" aria-label="Tier for ' + nm + '"' + (it.t ? ' data-t="' + it.t + '"' : '') + '><option value="">\u2013</option>' + TIERS.map(function (t) { return '<option value="' + t + '"' + (it.t === t ? ' selected' : '') + ' title="' + TIER_NAME[t] + '">' + t + '</option>'; }).join('') + '</select>';
    h += '<span class="row-main"><button type="button" class="linkish nm" data-open="' + sp.id + '">' + nm + '</button>' + (sp.conc ? '<span class="tag t-conc" title="Concentration">C</span>' : '') + (sp.ritual ? '<span class="tag t-rit" title="Ritual">R</span>' : '') +
      (tooHigh ? '<span class="small muted"> (later)</span>' : '') + (it.t ? '<span class="ptier">' + it.t + '</span>' : '') + (it.p ? '<span class="ptier">Prepared</span>' : '') +
      (multi || !X ? '<span class="ptier">' + (X ? esc(X.label) : 'Other') + '</span>' : '') + '</span>' + pfacts(sp);
    if (X && X.P.book != null && sp.lvl > 0) h += '<label class="prep" title="Prepared today"><input type="checkbox" data-prep="' + sp.id + '"' + (it.p ? ' checked' : '') + '> P</label>';
    if (multi || !m.on || it.c) {
      h += '<select class="rcls" data-rcls="' + sp.id + '" aria-label="Class ' + nm + ' counts for" title="Which class this spell counts for">' +
        CTX.map(function (x) { var on = m.by.indexOf(x) >= 0; return '<option value="' + esc(x.key) + '"' + (X === x ? ' selected' : '') + '>' + esc(x.label) + (on ? '' : ' (not on its list)') + '</option>'; }).join('') +
        '<option value="-"' + (!X ? ' selected' : '') + '>Other (feat, item...)</option></select>';
    }
    h += '<span class="row-btns">' +
      '<button type="button" class="mini-btn" data-mv="-1" data-id="' + sp.id + '" aria-label="Move ' + nm + ' up"' + (k === 0 ? ' disabled' : '') + '>\u25b2</button>' +
      '<button type="button" class="mini-btn" data-mv="1" data-id="' + sp.id + '" aria-label="Move ' + nm + ' down"' + (k === n - 1 ? ' disabled' : '') + '>\u25bc</button>' +
      '<button type="button" class="mini-btn' + (it.n ? ' has-note' : '') + '" data-note="' + sp.id + '" aria-label="Note for ' + nm + '" aria-expanded="' + !!editing[sp.id] + '" title="Note">\u270e</button>' +
      '<button type="button" class="mini-btn" data-rm="' + sp.id + '" aria-label="Remove ' + nm + '" title="Remove">\u2715</button></span>';
    if (editing[sp.id]) h += '<textarea class="rnote-edit" data-noteedit="' + sp.id + '" rows="2" maxlength="500" aria-label="Note for ' + nm + '" placeholder="Why this spell? When to use it?">' + esc(it.n) + '</textarea>';
    else if (it.n) h += '<p class="rnote">' + esc(it.n) + '</p>';
    return h + '</li>';
  }
  // facts line shown only on the printed spell sheet
  function pfacts(sp) {
    return '<span class="pfacts">' + esc([sp.time, sp.range, sp.comp + (sp.mcost ? ' (costly)' : ''), sp.dur].join(' \u00b7 ')) +
      (sp.save ? esc(' \u00b7 ' + sp.save.join('/') + ' save') : '') + (sp.atk ? esc(' \u00b7 ' + sp.atk.toLowerCase() + ' attack') : '') +
      ' \u00b7 ' + esc(DATA.books[sp.src].short + (sp.page ? ' p.' + sp.page : '')) + '</span>';
  }
  function levelItems(lv) { return L.items.filter(function (it) { var s = SP[it.id]; return s && s.lvl === lv; }); }
  function reorderLevel(lv, ids) {
    var other = L.items.filter(function (it) { var s = SP[it.id]; return !s || s.lvl !== lv; });
    var mine = ids.map(item).filter(Boolean);
    L.items = other.concat(mine);
    saveLists();
  }
  function move(id, d) {
    var lv = SP[id].lvl, arr = levelItems(lv).map(function (x) { return x.id; }), i = arr.indexOf(id), j = i + d;
    if (j < 0 || j >= arr.length) return false;
    arr.splice(i, 1); arr.splice(j, 0, id);
    reorderLevel(lv, arr);
    return true;
  }

  // drag by pointer: works for mouse, pen and touch (the handle has touch-action: none)
  function startDrag(e) {
    var h = e.target.closest('[data-drag]');
    if (!h || (e.pointerType === 'mouse' && e.button !== 0)) return;
    var li = h.closest('li.row'), ul = li.parentElement;
    e.preventDefault();
    try { h.setPointerCapture(e.pointerId); } catch (x) { /* old browsers */ }
    li.classList.add('dragging');
    var scroller = $('#mine .mine-inner');
    var moveFn = function (ev) {
      var y = ev.clientY, before = null;
      var rows = $$('li.row:not(.fixed)', ul).filter(function (r) { return r !== li; });
      for (var i = 0; i < rows.length; i++) { var b = rows[i].getBoundingClientRect(); if (y < b.top + b.height / 2) { before = rows[i]; break; } }
      if (before) { if (li.nextSibling !== before) ul.insertBefore(li, before); } else if (ul.lastElementChild !== li) ul.appendChild(li);
      var sc = scroller && scroller.scrollHeight > scroller.clientHeight + 4 ? scroller : null;
      var top = sc ? sc.getBoundingClientRect().top : 0, bot = sc ? sc.getBoundingClientRect().bottom : innerHeight;
      if (y < top + 40) (sc || window).scrollBy(0, -14); else if (y > bot - 40) (sc || window).scrollBy(0, 14);
    };
    var up = function () {
      h.removeEventListener('pointermove', moveFn); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
      li.classList.remove('dragging');
      var lv = +ul.closest('.grp').dataset.lv;
      reorderLevel(lv, $$('li.row:not(.fixed)', ul).map(function (r) { return r.dataset.id; }));
      var id = li.dataset.id;
      renderMine();
      var nh = $('#groups li.row[data-id="' + id + '"] [data-drag]');
      if (nh) nh.focus();
    };
    h.addEventListener('pointermove', moveFn); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  }

  // ------------------------------------------------------------ detail dialog
  function openSpell(id) {
    var s = SP[id];
    if (!s) return;
    var dlg = $('#detail');
    dlg.dataset.id = id;
    var m = membership(s), on = has(id), it = item(id);
    var twins = (BYNAME[norm(s.name)] || []).filter(function (x) { return x.id !== id; });
    var h = '<div class="sb-head"><h2 id="dTitle">' + esc(s.name) + '</h2></div>';
    h += '<p class="sb-sub">' + esc(lineFor(s)) + (s.ritual ? ' (ritual)' : '') + ' ' + srcTag(s) + '</p>';
    if (twins.length) h += '<div class="ed-tabs" role="group" aria-label="Other versions">' + [s].concat(twins).map(function (x) {
      return '<button type="button" data-open="' + x.id + '" aria-selected="' + (x.id === id) + '">' + esc(DATA.books[x.src].short) + '</button>';
    }).join('') + '</div>';
    h += '<div class="pills">' + tagsFor(s, m) + '</div>';
    var rows = factsHtml(s);
    if (s.cond) rows.push(['Conditions', s.cond.map(cap).join(', ')]);
    var cl = Object.keys(s.lists[L.ed] || s.lists[s.ed] || {});
    rows.push(['Classes', cl.length ? cl.map(function (c) { return c + ((s.lists[L.ed] || s.lists[s.ed])[c] === 'tce' ? ' (Tasha\'s optional)' : ''); }).join(', ') : 'None']);
    rows.push(['Source', DATA.books[s.src].name + (s.page ? ', p.' + s.page : '') + (s.srdName ? ' (in the SRD as ' + s.srdName + ')' : '')]);
    h += '<dl class="facts-dl">' + rows.map(function (x) { return '<dt>' + x[0] + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl>';
    if (s.text) {
      h += '<div class="itext">' + blocksHtml(s.text);
      if (s.higher) h += '<p><b><i>' + (s.lvl ? (s.ed === '2024' ? 'Using a Higher-Level Spell Slot.' : 'At Higher Levels.') : 'Cantrip Upgrade.') + '</i></b> ' + blocksHtml(s.higher).replace(/^<p>|<\/p>$/g, '') + '</p>';
      if (s.mat) h += '<p class="small">Material component: ' + s.mat + '</p>';
      h += '</div><p class="small muted">Text from the System Reference Document ' + s.srd + ' by Wizards of the Coast LLC, licensed under CC BY 4.0.</p>';
    } else {
      h += '<p class="wsnote">This spell is not in the free System Reference Document, so only its facts are listed. Its rules text is in <b>' + esc(DATA.books[s.src].name) + '</b>' + (s.page ? ', page ' + s.page : '') + '.</p>';
    }
    h += '<div class="mynotes">';
    if (on) {
      h += '<label for="dTier">Tier</label><select id="dTier" data-tier="' + id + '"><option value="">No tier</option>' + TIERS.map(function (t) { return '<option value="' + t + '"' + (it.t === t ? ' selected' : '') + '>' + TIER_NAME[t] + '</option>'; }).join('') + '</select>';
      h += '<label for="dNote">My note</label><textarea id="dNote" data-noteedit="' + id + '" rows="3" maxlength="500" placeholder="Why this spell? When to use it?">' + esc(it.n) + '</textarea>';
    }
    h += '<div class="mn-actions"><button type="button" class="btn" data-add="' + id + '" aria-pressed="' + on + '">' + (on ? 'Remove from ' : 'Add to ') + esc(L.name) + '</button></div></div>';
    $('#dBody').innerHTML = h;
    if (!dlg.open) dlg.showModal();
    writeUrl();
  }

  // ------------------------------------------------------------ render all
  function renderAll() {
    renderBuild();
    prepare();
    renderRules();
    renderFilters();
    renderList();
    renderMine();
    writeUrl();
  }
  function refreshCards() { prepare(); renderList(); renderMine(); renderRules(); writeUrl(); }

  // ------------------------------------------------------------ events
  function bind() {
    $$('[data-ed]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (L.ed === b.dataset.ed) return;
        var old = L.k.map(function (r) { return subRec(r); });
        remapEdition(b.dataset.ed);
        L.ed = b.dataset.ed;
        L.k.forEach(function (r, i) {
          if (r.cls === OTHER) return;
          if (!classes().some(function (c) { return c.id === r.cls; })) r.cls = casterClasses()[0].id;
          r.sub = null;
          var o = old[i];
          if (o) { var n = subs(r).find(function (x) { return x.short === o.short || x.name === o.name; }); if (n) r.sub = n.id; }
        });
        F.books = null; shown = PAGE;
        saveLists(); renderAll();
      });
    });
    var rows = $('#classRows');
    var rowOf = function (el) { var w = el.closest('[data-row]'); return w ? L.k[+w.dataset.row] : null; };
    rows.addEventListener('change', function (e) {
      var t = e.target, r = rowOf(t), f = t.dataset.f;
      if (!r || !f) return;
      if (f === 'cls') { r.cls = t.value; r.sub = null; r.opt = null; shown = PAGE; }
      else if (f === 'sub') { r.sub = t.value || null; r.opt = null; }
      else if (f === 'opt') r.opt = t.value;
      else if (f === 'lvl') r.lvl = +t.value;
      else return;
      var id = t.id;
      saveLists(); renderAll();
      var again = document.getElementById(id); if (again) again.focus();
    });
    rows.addEventListener('input', function (e) {
      var t = e.target, r = rowOf(t), f = t.dataset.f;
      if (!r) return;
      if (f === 'lvl') { r.lvl = +t.value; t.previousElementSibling.querySelector('output').textContent = r.lvl; saveLists(); refreshCards(); }
      else if (f === 'mod') { var v = parseInt(t.value, 10); if (isNaN(v)) return; r.mod = Math.max(-5, Math.min(10, v)); saveLists(); refreshCards(); }
    });
    rows.addEventListener('click', function (e) {
      if (e.target.closest('#unlinkChar')) {
        var och = charOf(L);
        delete L.ch; delete L.chU;
        if (och && (och.links[REPO] || {}).list === L.id) DC.setLink(och.id, REPO, null);
        saveLists(); renderAll(); notice('This list is no longer linked to a character.');
        return;
      }
      var t = e.target.closest('#addCls, [data-rmrow]');
      if (!t) return;
      if (t.id === 'addCls') {
        if (L.k.length >= MAXROWS || charLevel() >= 20) return;
        var used = L.k.map(function (r) { return r.cls; });
        var c = casterClasses().find(function (x) { return used.indexOf(x.id) < 0; });
        L.k.push({ cls: c ? c.id : OTHER, sub: null, opt: null, lvl: 1, mod: 3 });
        saveLists(); renderAll();
        var sel = document.getElementById('cls' + (L.k.length - 1)); if (sel) sel.focus();
      } else {
        var i = +t.dataset.rmrow;
        L.k.splice(i, 1);
        if (L.k[0].cls === OTHER) L.k[0].cls = casterClasses()[0].id;
        saveLists(); renderAll();
        var a = $('#addCls') || $('#cls0'); if (a) a.focus();
      }
    });
    $('#listSel').addEventListener('change', function () {
      L = LS.lists.find(function (x) { return x.id === this.value; }, this) || L; editing = {}; shown = PAGE; saveLists(); renderAll();
    });
    $('#listMenu').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      this.open = false;
      var act = b.dataset.act, name;
      if (act === 'new') { name = prompt('Name for the new list:', 'New list'); if (name == null) return; L = newList(name.trim() || 'New list'); LS.lists.push(L); }
      else if (act === 'rename') { name = prompt('Rename this list:', L.name); if (name == null || !name.trim()) return; L.name = name.trim().slice(0, 60); }
      else if (act === 'dup') { var d = clean(JSON.parse(JSON.stringify(L))); d.id = uid(); delete d.ch; delete d.chU; d.name = (L.name + ' (copy)').slice(0, 60); LS.lists.push(d); L = d; }
      else if (act === 'clear') { if (!L.items.length || !confirm('Remove all ' + L.items.length + ' spells from "' + L.name + '"?')) return; L.items = []; }
      else if (act === 'delete') {
        if (!confirm('Delete the list "' + L.name + '"? Export first if you want a backup.')) return;
        LS.lists = LS.lists.filter(function (x) { return x !== L; });
        if (!LS.lists.length) LS.lists.push(newList('My spells'));
        L = LS.lists[0];
      }
      else if (act === 'share') {
        var url = shareUrl();
        var done = function () { notice('Share link copied. Anyone who opens it gets a copy of "' + L.name + '".'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { prompt('Copy this link:', url); });
        else prompt('Copy this link:', url);
        return;
      }
      else if (act === 'export') {
        download('spell-lists-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ app: 'dnd-magic', version: 1, exported: new Date().toISOString(), lists: LS.lists }, null, 1));
        return;
      }
      else if (act === 'import') { $('#importFile').click(); return; }
      else if (act === 'savechar') { saveAsChar(); return; }
      else if (act === 'print') { window.print(); return; }
      editing = {}; saveLists(); renderAll();
    });
    $('#importFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try { var n = importJson(rd.result); notice('Imported ' + n + ' list' + (n === 1 ? '' : 's') + '.'); renderAll(); }
        catch (e) { notice('That file is not a spell list export.'); }
      };
      rd.readAsText(f);
      this.value = '';
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('details')) $$('details[open]').forEach(function (d) { d.open = false; });
      var t;
      if ((t = e.target.closest('[data-add]'))) {
        var id = t.dataset.add;
        if (has(id)) removeSpell(id); else addSpell(id);
        var dlgOpen = $('#detail').open;
        var y = window.scrollY;
        renderList(); renderMine(); renderRules();
        window.scrollTo(0, y);
        if (dlgOpen) openSpell(id);
        else { var nb = $('#list [data-add="' + id + '"]'); if (nb) nb.focus(); }
        return;
      }
      if ((t = e.target.closest('[data-open]'))) { openSpell(t.dataset.open); return; }
      if ((t = e.target.closest('#list .card')) && !e.target.closest('button, a, select, input, textarea, label')) { openSpell(t.dataset.id); return; }
      if ((t = e.target.closest('[data-mv]'))) {
        var mid = t.dataset.id, d = +t.dataset.mv;
        if (move(mid, d)) { renderMine(); var nb2 = $('#groups [data-mv="' + d + '"][data-id="' + mid + '"]'); if (nb2 && !nb2.disabled) nb2.focus(); else { nb2 = $('#groups [data-mv="' + (-d) + '"][data-id="' + mid + '"]'); if (nb2) nb2.focus(); } }
        return;
      }
      if ((t = e.target.closest('[data-rm]'))) { removeSpell(t.dataset.rm); delete editing[t.dataset.rm]; renderList(); renderMine(); renderRules(); return; }
      if ((t = e.target.closest('[data-note]'))) {
        var nid = t.dataset.note;
        editing[nid] = !editing[nid];
        renderMine();
        var ta = $('#groups [data-noteedit="' + nid + '"]');
        if (ta) ta.focus(); else { var nb3 = $('#groups [data-note="' + nid + '"]'); if (nb3) nb3.focus(); }
        return;
      }
      if ((t = e.target.closest('[data-lv]')) && t.closest('#lvlChips')) {
        var lv = +t.dataset.lv, i = F.lv.indexOf(lv);
        if (i >= 0) F.lv.splice(i, 1); else F.lv.push(lv);
        F.lv.sort(); shown = PAGE; renderFilters(); renderList(); writeUrl(); return;
      }
      if ((t = e.target.closest('[data-sch]'))) {
        var sc = t.dataset.sch, j = F.sch.indexOf(sc);
        if (j >= 0) F.sch.splice(j, 1); else F.sch.push(sc);
        shown = PAGE; renderFilters(); $('#schPick').open = true; renderList(); writeUrl(); return;
      }
      if ((t = e.target.closest('[data-scope]'))) { F.scope = t.dataset.scope; shown = PAGE; renderFilters(); renderList(); writeUrl(); return; }
      if ((t = e.target.closest('[data-detail]'))) { F.view = t.dataset.detail; store.set('dm.view', F.view); renderFilters(); renderList(); writeUrl(); return; }
    });
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset.tier) { var it = item(t.dataset.tier); if (it) { it.t = t.value; saveLists(); renderMine(); if ($('#detail').open && t.id !== 'dTier') openSpell($('#detail').dataset.id); } return; }
      if (t.dataset.rcls) { var ic = item(t.dataset.rcls); if (ic) { ic.c = t.value; saveLists(); renderMine(); var rc = $('#groups [data-rcls="' + ic.id + '"]'); if (rc) rc.focus(); } return; }
      if (t.dataset.prep) { var ip = item(t.dataset.prep); if (ip) { ip.p = t.checked; saveLists(); renderMine(); var c = $('#groups [data-prep="' + ip.id + '"]'); if (c) c.focus(); } return; }
      if (t.dataset.src) {
        var all = Object.keys(DATA.books);
        var cur = F.books ? F.books.slice() : all.slice();
        var k = cur.indexOf(t.dataset.src);
        if (t.checked && k < 0) cur.push(t.dataset.src); else if (!t.checked && k >= 0) cur.splice(k, 1);
        F.books = cur.length >= all.length ? null : cur;
        shown = PAGE; renderSources(); renderList(); writeUrl();
      }
    });
    var noteTimer = null;
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (!t.dataset.noteedit) return;
      var it = item(t.dataset.noteedit);
      if (!it) return;
      it.n = t.value.slice(0, 500);
      clearTimeout(noteTimer);
      noteTimer = setTimeout(saveLists, 300);
    });
    document.addEventListener('focusout', function (e) {
      var t = e.target;
      if (t.dataset && t.dataset.noteedit && t.closest('#groups')) {
        saveLists();
        setTimeout(function () {
          if (document.activeElement && document.activeElement.closest && document.activeElement.closest('li.row[data-id="' + t.dataset.noteedit + '"]')) return;
          editing[t.dataset.noteedit] = false; renderMine();
        }, 0);
      }
    });
    $('#groups').addEventListener('pointerdown', startDrag);
    $('#groups').addEventListener('keydown', function (e) {
      var h = e.target.closest('[data-drag]');
      if (!h || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      var id = h.closest('li.row').dataset.id;
      if (move(id, e.key === 'ArrowUp' ? -1 : 1)) { renderMine(); var nh = $('#groups li.row[data-id="' + id + '"] [data-drag]'); if (nh) nh.focus(); }
    });
    var qTimer = null;
    $('#search').addEventListener('input', function () { F.q = this.value; clearTimeout(qTimer); qTimer = setTimeout(function () { shown = PAGE; renderList(); writeUrl(); }, 120); });
    ['time', 'conc', 'rit', 'dmg', 'save', 'sort'].forEach(function (k) {
      $('#' + k).addEventListener('change', function () { F[k] = this.value; shown = PAGE; renderList(); writeUrl(); });
    });
    $('#onlyCls').addEventListener('change', function () { F.only = this.value; shown = PAGE; renderList(); writeUrl(); });
    $('#castable').addEventListener('change', function () { F.castable = this.checked; shown = PAGE; renderList(); writeUrl(); });
    $('#hidePicked').addEventListener('change', function () { F.hidePicked = this.checked; shown = PAGE; renderList(); writeUrl(); });
    $('#optTog').addEventListener('change', function () { F.opt = this.checked; shown = PAGE; prepare(); renderFilters(); renderList(); renderMine(); writeUrl(); });
    $('#schClear').addEventListener('click', function () { F.sch = []; renderFilters(); renderList(); writeUrl(); });
    $('#srcQ').addEventListener('input', renderSources);
    $('#srcCore').addEventListener('click', function () { F.books = Object.keys(DATA.books).filter(function (k) { return DATA.books[k].core; }); renderSources(); renderList(); writeUrl(); });
    $('#srcAll').addEventListener('click', function () { F.books = null; renderSources(); renderList(); writeUrl(); });
    $('#srcNone').addEventListener('click', function () { F.books = []; renderSources(); renderList(); writeUrl(); });
    $('#srcShown').addEventListener('click', function () {
      F.books = $$('#srcList .srcrow:not([hidden]) input').map(function (i) { return i.dataset.src; });
      renderSources(); renderList(); writeUrl();
    });
    $('#resetBtn').addEventListener('click', function () { var v = F.view; F = defaults(); F.view = v; shown = PAGE; prepare(); renderFilters(); renderList(); writeUrl(); });
    $('#moreBtn').addEventListener('click', function () { shown += PAGE; renderList(); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { if (en[0].isIntersecting && !$('#moreBtn').hidden) { shown += PAGE; renderList(); } }, { rootMargin: '400px' }).observe($('#moreBtn'));
    }
    var dlg = $('#detail');
    $('#closeDlg').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', function () { delete dlg.dataset.id; writeUrl(); });
    // phone tabs
    var tabs = [$('#tabBrowse'), $('#tabMine')];
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { setTab(i); });
      t.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setTab(1 - i); tabs[1 - i].focus(); }
      });
    });
    function setTab(i) {
      document.body.classList.toggle('show-mine', i === 1);
      tabs.forEach(function (t, k) { t.setAttribute('aria-selected', String(k === i)); t.tabIndex = k === i ? 0 : -1; });
    }
    setTab(0);
  }

  // ------------------------------------------------------------ start
  fetch('data/spells.json?v=dev').then(function (r) { return r.json(); }).then(function (d) {
    DATA = d;
    d.spells.forEach(function (s) { SP[s.id] = s; (BYNAME[norm(s.name)] = BYNAME[norm(s.name)] || []).push(s); });
    loadLists();
    var spell = readUrl();
    var hadShare = /#list=/.test(location.hash);
    readShare();
    if (DC) {
      LS.lists.forEach(function (x) { var ch = charOf(x); if (ch && ch.updated !== x.chU) syncList(x, ch); });
      var act = DC.active();
      lastActive = act ? act.id : null;
      // switch to the character's list; make one only for a character this site has not seen active before
      // (so a list the user unlinked does not come back on the next visit)
      if (act && !hadShare && L.ch !== act.id && (charLists(act).length || store.get('dm.char', null) !== act.id)) useChar(act, true);
      store.set('dm.char', lastActive);
      saveLists();
      DC.onChange(onChars);
    }
    $('#generated').textContent = 'Data built ' + d.generated + ': ' + d.spells.length + ' spells, ' + d.spells.filter(function (s) { return s.text; }).length + ' with SRD text.';
    bind();
    renderAll();
    if (spell && SP[spell]) openSpell(spell);
  }).catch(function (e) {
    $('#list').innerHTML = '<p class="empty">The spell data could not be loaded (' + esc(e.message) + '). Try reloading the page.</p>';
    if (window.console) console.error(e);
  });
})();

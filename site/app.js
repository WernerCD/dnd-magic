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
    return { q: '', lv: [], sch: [], time: '', conc: '', rit: '', dmg: '', save: '', books: null, scope: 'class',
      castable: false, hidePicked: false, opt: true, view: store.get('dm.view', 'stats'), sort: 'level' };
  }
  function lvName(n) { return n === 0 ? 'Cantrip' : 'Level ' + n; }
  function lvShort(n) { return n === 0 ? 'Cantrip' : n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th'; }
  function uid() { return Math.random().toString(36).slice(2, 10); }

  // ------------------------------------------------------------ class model
  function classes() { return DATA.classes[L.ed] || []; }
  function casterClasses() {
    return classes().filter(function (c) { return c.caster || c.subclasses.some(function (s) { return s.caster; }); });
  }
  function clsRec() { return classes().find(function (c) { return c.id === L.cls; }) || casterClasses()[0]; }
  function subs() { var c = clsRec(); return c.caster ? c.subclasses : c.subclasses.filter(function (s) { return s.caster; }); }
  function subRec() { var s = subs(); return s.find(function (x) { return x.id === L.sub; }) || (clsRec().caster ? null : s[0]); }
  function optRec() {
    var s = subRec();
    if (!s || !s.options.length) return null;
    return s.options.find(function (o) { return o.name === L.opt; }) || s.options[0];
  }
  function sumTo(arr, n) { var t = 0; for (var i = 0; i < n; i++) t += arr[i] || 0; return t; }

  function prog() {
    var c = clsRec(), s = subRec(), lv = L.lvl, i = lv - 1;
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
      r.count = r.max ? Math.max(1, (half ? Math.floor(lv / 2) : lv) + (L.mod | 0)) : 0;
    }
    if (c.spellbook && !(s && s.caster)) r.book = sumTo(c.spellbook, lv);
    r.listClass = c.caster ? c.name : 'Wizard';
    return r;
  }
  // lowest class level at which a spell level can be cast
  function minLevelFor(sl) {
    if (sl === 0) return 1;
    var keep = L.lvl, out = null;
    for (var lv = 1; lv <= 20 && out == null; lv++) {
      L.lvl = lv;
      var p = prog();
      if (p.maxAny >= sl) out = lv;
    }
    L.lvl = keep;
    return out;
  }

  // which spells come from the subclass: id -> {kind, at, bySpellLevel}
  function subSpells() {
    var o = optRec(), m = {};
    if (!o) return m;
    o.spells.forEach(function (x) { if (!m[x.id]) m[x.id] = x; });
    return m;
  }
  function unlocked(x, sp, P) { return x.bySpellLevel ? sp.lvl <= P.maxAny : x.at <= L.lvl; }
  function extraLists() {
    var o = optRec(), out = [];
    if (o) o.notes.forEach(function (n) { if (n.allOf && out.indexOf(n.allOf) < 0) out.push(n.allOf); });
    return out;
  }

  // ------------------------------------------------------------ spell pool
  function pool() {
    return DATA.spells.filter(function (s) {
      if (L.ed === '2014') return s.ed === '2014';
      return s.ed === '2024' || (s.legacy && F.opt);
    });
  }
  function membership(s, P, SS, names) {
    var v = null, lists = s.lists[L.ed] || {};
    if (SS[s.id]) return { on: true, sub: SS[s.id] };
    for (var k = 0; k < names.length; k++) {
      var x = lists[names[k]];
      if (x === 1) return { on: true };
      if (x === 'tce') v = 'tce';
    }
    if (v === 'tce' && F.opt) return { on: true, tce: true };
    return { on: false, tce: v === 'tce' };
  }

  // ------------------------------------------------------------ lists
  function newList(name) {
    var base = L || { ed: '2024', cls: 'wizard', sub: null, opt: null, lvl: 5, mod: 3 };
    return { id: uid(), name: name || 'My spells', ed: base.ed, cls: base.cls, sub: base.sub, opt: base.opt, lvl: base.lvl, mod: base.mod, items: [] };
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
    return {
      id: typeof x.id === 'string' && x.id ? x.id.slice(0, 20) : uid(),
      name: String(x.name || 'Imported list').slice(0, 60),
      ed: x.ed === '2014' ? '2014' : '2024',
      cls: String(x.cls || 'wizard').slice(0, 40), sub: x.sub ? String(x.sub).slice(0, 60) : null,
      opt: x.opt ? String(x.opt).slice(0, 60) : null,
      lvl: Math.min(20, Math.max(1, parseInt(x.lvl, 10) || 1)), mod: Math.min(10, Math.max(-5, parseInt(x.mod, 10) || 0)),
      items: items.filter(function (it) { return it && typeof it.id === 'string'; }).slice(0, 400).map(function (it) {
        return { id: it.id.slice(0, 80), t: TIERS.indexOf(it.t) >= 0 ? it.t : '', n: String(it.n || '').slice(0, 500), p: !!it.p };
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
    var c = { v: 1, n: L.name, e: L.ed, c: L.cls, s: L.sub, o: L.opt, l: L.lvl, m: L.mod,
      i: L.items.map(function (it) { var r = [it.id]; if (it.t || it.n || it.p) r.push(it.t); if (it.n || it.p) r.push(it.n); if (it.p) r.push(1); return r; }) };
    return location.origin + location.pathname + '#list=' + b64e(JSON.stringify(c));
  }
  function readShare() {
    var m = /#list=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      var c = JSON.parse(b64d(m[1]));
      var x = clean({ name: c.n, ed: c.e, cls: c.c, sub: c.s, opt: c.o, lvl: c.l, mod: c.m,
        items: (c.i || []).map(function (r) { return { id: r[0], t: r[1], n: r[2], p: r[3] }; }) });
      x.id = uid();
      var sig = JSON.stringify([x.ed, x.cls, x.sub, x.items]);
      var same = LS.lists.find(function (y) { return JSON.stringify([y.ed, y.cls, y.sub, y.items]) === sig; });
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
  function renderBuild() {
    $$('[data-ed]').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.ed === L.ed)); });
    var c = clsRec();
    L.cls = c.id;
    $('#cls').innerHTML = casterClasses().map(function (x) {
      var label = x.caster ? x.name : (x.subclasses.find(function (s) { return s.caster; }).name + ' (' + x.name + ')');
      return '<option value="' + esc(x.id) + '"' + (x.id === c.id ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
    var ss = subs(), s = subRec();
    L.sub = s ? s.id : null;
    $('#subLabel').textContent = c.subclassTitle || 'Subclass';
    var lab = function (x) { return x.name + (x.legacy ? ' (' + DATA.books[x.src].short + ')' : ''); };
    var native = ss.filter(function (x) { return !x.legacy; }), old = ss.filter(function (x) { return x.legacy; });
    $('#sub').innerHTML = (c.caster ? '<option value="">None yet / not chosen</option>' : '') +
      native.map(function (x) { return '<option value="' + esc(x.id) + '"' + (s && x.id === s.id ? ' selected' : '') + '>' + esc(lab(x)) + '</option>'; }).join('') +
      (old.length ? '<optgroup label="From older books">' + old.map(function (x) { return '<option value="' + esc(x.id) + '"' + (s && x.id === s.id ? ' selected' : '') + '>' + esc(lab(x)) + '</option>'; }).join('') + '</optgroup>' : '');
    var named = s ? s.options.filter(function (o) { return o.name; }) : [];
    $('#optWrap').hidden = named.length < 2;
    if (named.length >= 2) {
      var o = optRec();
      L.opt = o.name;
      $('#optLabel').textContent = /Land/.test(s.name) ? 'Land' : /Genie/.test(s.name) ? 'Genie kind' : /Divine Soul/.test(s.name) ? 'Affinity' : 'Option';
      $('#opt').innerHTML = named.map(function (x) { return '<option' + (x.name === o.name ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('');
    } else L.opt = null;
    $('#lvl').value = L.lvl; $('#lvlOut').textContent = L.lvl;
    $('#mod').value = L.mod;
    $('#modWrap').hidden = !clsRec().preparedFormula || !!(s && s.caster);
    $('#modLabel').textContent = (ABIL[clsRec().ability] || 'Ability').slice(0, 3).toUpperCase() + ' modifier';
    $('#listSel').innerHTML = LS.lists.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === L.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('');
    $('#optTogText').textContent = L.ed === '2014' ? "Tasha's optional class spells" : 'Spells from older books';
    $('#optTogWrap').title = L.ed === '2014' ? "Include the optional class spells Tasha's Cauldron of Everything adds to each list" : 'Include spells from 2014-era books that the 2024 Player\'s Handbook did not reprint';
    $('#optTog').checked = F.opt;
  }

  function renderRules() {
    var P = prog(), c = clsRec(), s = subRec();
    $('#rulesTitle').textContent = (s && !c.caster ? s.name : c.name) + ', level ' + L.lvl;
    var bk = DATA.books[c.src];
    $('#rulesSub').innerHTML = (s ? esc(s.name) + ' &middot; ' : '') + esc(L.ed) + ' rules &middot; ' + esc(ABIL[P.ability] || '') + ' spellcasting';
    var st = [];
    st.push(['Cantrips', P.cantrips || 0]);
    if (P.kind) st.push([P.kind === 'known' ? 'Spells known' : 'Prepared spells', P.count]);
    if (P.book != null) st.push(['Spellbook (minimum)', P.book]);
    st.push(['Highest spell level', P.maxAny ? (P.arcanum && P.arcanum.length ? P.max + ' (+' + P.arcanum.join(', ') + ')' : P.max) : 'none yet']);
    if (P.pact) st.push(['Pact slots', P.pact.n + ' \u00d7 level ' + P.pact.lvl]);
    var C = counts(P);
    $('#stats').innerHTML = st.map(function (x) { return '<div class="stat"><b>' + esc(x[1]) + '</b><span>' + esc(x[0]) + '</span></div>'; }).join('');
    if (P.pact) $('#slots').innerHTML = '';
    else $('#slots').innerHTML = '<span class="ctl-label">Spell slots</span>' + P.slots.map(function (n, k) {
      return '<span class="slot' + (n ? '' : ' none') + '" title="' + n + ' level ' + (k + 1) + ' slot' + (n === 1 ? '' : 's') + '"><i>' + (k + 1) + '</i><b>' + (n || '\u2013') + '</b></span>';
    }).join('');
    var notes = [];
    if (!P.maxAny && !P.cantrips) {
      var first = minLevelFor(1);
      notes.push('No spellcasting yet' + (first ? ': it starts at level ' + first + '.' : '.'));
    }
    if (P.formula) notes.push('Prepared spells = ' + (P.formula === 'half' ? 'half your ' + c.name + ' level (rounded down)' : 'your ' + c.name + ' level') + ' + your ' + (ABIL[c.ability] || '') + ' modifier (minimum 1). Set the modifier above.');
    if (P.book != null) notes.push('Your spellbook starts with 6 level 1 spells and gains 2 each level; you can also copy spells you find. Mark the spells you have prepared with the <b>P</b> box in your list.');
    if (P.pact) notes.push('Pact Magic: all your slots are level ' + P.pact.lvl + ' and come back on a short rest.');
    if (P.arcanum && P.arcanum.length) notes.push('Mystic Arcanum: one spell each of level ' + P.arcanum.join(', ') + ', cast once per long rest without a slot. They do not count against your prepared or known spells.');
    if (L.ed === '2014' && s && s.caster) notes.push(s.name === 'Eldritch Knight' ? 'Most of your spells must be abjuration or evocation; the spells you learn at levels 3, 8, 14 and 20 can be from any school.' : 'Most of your spells must be enchantment or illusion; the spells you learn at levels 3, 8, 14 and 20 can be from any school.');
    var o = optRec();
    if (o) o.notes.forEach(function (n) {
      if (n.allOf && notes.join().indexOf(n.allOf + ' spell list') < 0) notes.push('Your subclass adds the whole ' + esc(n.allOf) + ' spell list to yours (shown in Class list).');
      if (n.choose && n.at <= L.lvl) notes.push('At level ' + n.at + ' your subclass also lets you pick ' + (n.count > 1 ? n.count + ' extra spells' : 'an extra spell') + ' (see the book for which).');
    });
    if (s && s.legacy) notes.push('This subclass is from ' + esc(DATA.books[s.src].name) + ', written for the 2014 rules. The 2024 rules allow older subclasses if your DM agrees.');
    if (s && !s.srd) notes.push('Subclass from ' + esc(DATA.books[s.src].name) + (s.page ? ' p.' + s.page : '') + ': only its spell list is shown here.');
    var SS = subSpells(), nSub = Object.keys(SS).filter(function (id) { return SP[id] && unlocked(SS[id], SP[id], P) && SS[id].kind !== 'expanded'; }).length;
    if (nSub) notes.push(nSub + ' subclass spell' + (nSub === 1 ? ' is' : 's are') + ' always on hand at this level and do' + (nSub === 1 ? 'es' : '') + ' not count against your ' + (P.kind || 'spell') + ' total.');
    $('#rulesNotes').innerHTML = notes.map(function (n) { return '<li>' + n + '</li>'; }).join('');
    void bk; void C;
  }

  // ------------------------------------------------------------ filters
  var POOL = [], PROG = null, SUBS = {}, NAMES = [];
  function prepare() {
    POOL = pool(); PROG = prog(); SUBS = subSpells();
    NAMES = [PROG.listClass].concat(extraLists());
  }
  function passBase(s, m) {
    if (F.scope === 'class' && !m.on) return false;
    if (F.books && F.books.indexOf(s.src) < 0) return false;
    return true;
  }
  function passFilters(s) {
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
    if (F.castable && s.lvl > PROG.maxAny && !(s.lvl === 0 && PROG.cantrips)) return false;
    if (F.castable && s.lvl === 0 && !PROG.cantrips) return false;
    if (F.hidePicked && has(s.id)) return false;
    return true;
  }
  function results() {
    var out = [];
    POOL.forEach(function (s) {
      var m = membership(s, PROG, SUBS, NAMES);
      if (!passBase(s, m) || !passFilters(s)) return;
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
    if (m && m.sub) t.push('<span class="tag t-sub" title="From your subclass' + (m.sub.bySpellLevel ? '' : ', from level ' + m.sub.at) + '">' + KIND[m.sub.kind] + '</span>');
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
  function card(r) {
    var s = r.s, m = r.m, on = has(s.id);
    var tooHigh = s.lvl > PROG.maxAny && s.lvl > 0;
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
    if (tooHigh) { var ml = minLevelFor(s.lvl); h += '<div class="why">' + (ml ? 'Castable from level ' + ml : 'Not castable by this class') + '</div>'; }
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
  function counts(P) {
    var c = { cantrips: 0, spells: 0, prepared: 0 };
    L.items.forEach(function (it) {
      var s = SP[it.id];
      if (!s) return;
      if (s.lvl === 0) c.cantrips++; else { c.spells++; if (it.p) c.prepared++; }
    });
    return c;
  }
  function renderMine() {
    var P = PROG, C = counts(P), SS = SUBS;
    $('#mineTitle').textContent = L.name;
    var c = clsRec(), s = subRec();
    $('#mineSub').textContent = (s && !c.caster ? s.name : c.name + (s ? ' (' + s.short + ')' : '')) + ', level ' + L.lvl + ', ' + L.ed + ' rules';
    var cs = [];
    var meter = function (label, have, max, title) {
      var cls = max == null ? '' : have > max ? ' over' : have === max ? ' full' : '';
      return '<span class="meter' + cls + '" title="' + esc(title || '') + '"><b>' + have + (max == null ? '' : ' / ' + max) + '</b> ' + label + '</span>';
    };
    cs.push(meter('cantrips', C.cantrips, P.cantrips || 0, 'Cantrips on your list / cantrips you know at this level'));
    if (P.book != null) {
      cs.push(meter('in spellbook', C.spells, null, 'Leveled spells on your list'));
      cs.push(meter('prepared (P)', C.prepared, P.count, 'Spells marked P / spells you can prepare'));
    } else if (P.kind) {
      cs.push(meter(P.kind === 'known' ? 'known' : 'prepared', C.spells, P.count, 'Leveled spells on your list / spells you ' + (P.kind === 'known' ? 'know' : 'can prepare') + ' at this level'));
    }
    $('#counts').innerHTML = cs.join('');
    $('#tabCount').textContent = '(' + L.items.length + ')';
    $('#tabCount').setAttribute('aria-label', L.items.length + ' spells');

    var byLv = {};
    for (var i = 0; i <= 9; i++) byLv[i] = { fixed: [], items: [] };
    Object.keys(SS).forEach(function (id) {
      var x = SS[id], sp = SP[id];
      if (sp && x.kind !== 'expanded' && unlocked(x, sp, P)) byLv[sp.lvl].fixed.push(sp);
    });
    var unknown = [];
    L.items.forEach(function (it) { var sp = SP[it.id]; if (sp) byLv[sp.lvl].items.push(it); else unknown.push(it); });
    var html = '';
    for (var lv = 0; lv <= 9; lv++) {
      var g = byLv[lv];
      if (!g.fixed.length && !g.items.length) continue;
      var slotTxt = lv === 0 ? '' : P.pact ? (lv <= P.pact.lvl ? 'pact slots' : (P.arcanum && P.arcanum.indexOf(lv) >= 0 ? 'Mystic Arcanum' : 'not yet')) : (P.slots[lv - 1] ? P.slots[lv - 1] + ' slot' + (P.slots[lv - 1] === 1 ? '' : 's') : 'not yet');
      html += '<section class="grp" data-lv="' + lv + '"><h3>' + (lv === 0 ? 'Cantrips' : 'Level ' + lv) + ' <span class="n">' + g.items.length + '</span>' + (slotTxt ? '<span class="gslots">' + slotTxt + '</span>' : '') + '</h3><ul class="rows">';
      g.fixed.forEach(function (sp) {
        html += '<li class="row fixed"><span class="fixmark" aria-hidden="true">\u2605</span><button type="button" class="linkish nm" data-open="' + sp.id + '">' + esc(sp.name) + '</button><span class="tag t-sub">' + KIND[SS[sp.id].kind] + '</span>' + pfacts(sp) + '</li>';
      });
      g.items.forEach(function (it, k) { html += rowHtml(it, SP[it.id], k, g.items.length, P); });
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
  function rowHtml(it, sp, k, n, P) {
    var nm = esc(sp.name);
    var tooHigh = sp.lvl > P.maxAny && sp.lvl > 0;
    var h = '<li class="row' + (tooHigh ? ' locked' : '') + '" data-id="' + sp.id + '">';
    h += '<button type="button" class="handle" data-drag aria-label="Move ' + nm + ': drag, or use the up and down arrow keys" title="Drag to reorder (or focus and use arrow keys)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></button>';
    h += '<span class="rank" aria-hidden="true">' + (k + 1) + '</span>';
    h += '<select class="tier" data-tier="' + sp.id + '" aria-label="Tier for ' + nm + '"' + (it.t ? ' data-t="' + it.t + '"' : '') + '><option value="">\u2013</option>' + TIERS.map(function (t) { return '<option value="' + t + '"' + (it.t === t ? ' selected' : '') + ' title="' + TIER_NAME[t] + '">' + t + '</option>'; }).join('') + '</select>';
    h += '<span class="row-main"><button type="button" class="linkish nm" data-open="' + sp.id + '">' + nm + '</button>' + (sp.conc ? '<span class="tag t-conc" title="Concentration">C</span>' : '') + (sp.ritual ? '<span class="tag t-rit" title="Ritual">R</span>' : '') +
      (tooHigh ? '<span class="small muted"> (later)</span>' : '') + (it.t ? '<span class="ptier">' + it.t + '</span>' : '') + (it.p ? '<span class="ptier">Prepared</span>' : '') + '</span>' + pfacts(sp);
    if (P.book != null && sp.lvl > 0) h += '<label class="prep" title="Prepared today"><input type="checkbox" data-prep="' + sp.id + '"' + (it.p ? ' checked' : '') + '> P</label>';
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
    var m = membership(s, PROG, SUBS, NAMES), on = has(id), it = item(id);
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
        var oldCls = L.cls, oldSub = subRec();
        remapEdition(b.dataset.ed);
        L.ed = b.dataset.ed;
        L.cls = oldCls;
        if (!classes().some(function (c) { return c.id === oldCls; })) L.cls = casterClasses()[0].id;
        L.sub = null;
        if (oldSub) { var n = subs().find(function (x) { return x.short === oldSub.short || x.name === oldSub.name; }); if (n) L.sub = n.id; }
        F.books = null; shown = PAGE;
        saveLists(); renderAll();
      });
    });
    $('#cls').addEventListener('change', function () { L.cls = this.value; L.sub = null; L.opt = null; shown = PAGE; saveLists(); renderAll(); });
    $('#sub').addEventListener('change', function () { L.sub = this.value || null; L.opt = null; saveLists(); renderAll(); });
    $('#opt').addEventListener('change', function () { L.opt = this.value; saveLists(); renderAll(); });
    $('#lvl').addEventListener('input', function () { L.lvl = +this.value; $('#lvlOut').textContent = L.lvl; saveLists(); refreshCards(); });
    $('#mod').addEventListener('input', function () { var v = parseInt(this.value, 10); if (isNaN(v)) return; L.mod = Math.max(-5, Math.min(10, v)); saveLists(); refreshCards(); });
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
      else if (act === 'dup') { var d = clean(JSON.parse(JSON.stringify(L))); d.id = uid(); d.name = (L.name + ' (copy)').slice(0, 60); LS.lists.push(d); L = d; }
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
    readShare();
    $('#generated').textContent = 'Data built ' + d.generated + ': ' + d.spells.length + ' spells, ' + d.spells.filter(function (s) { return s.text; }).length + ' with SRD text.';
    bind();
    renderAll();
    if (spell && SP[spell]) openSpell(spell);
  }).catch(function (e) {
    $('#list').innerHTML = '<p class="empty">The spell data could not be loaded (' + esc(e.message) + '). Try reloading the page.</p>';
    if (window.console) console.error(e);
  });
})();

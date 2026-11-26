/* Our lovely house — shared expenses app for Paul & Grace */
(() => {
  'use strict';
  const CFG = window.HOUSE_CONFIG || {api: 'mock'};
  const LS = {
    get: (k, d) => { try { const v = localStorage.getItem('house.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem('house.' + k, JSON.stringify(v)); } catch {} },
    del: (k) => { try { localStorage.removeItem('house.' + k); } catch {} },
  };

  // ---------------- state ----------------
  const S = {
    pin: LS.get('pin', ''),
    me: LS.get('me', ''),
    data: LS.get('data', null),
    tab: 'home',
    month: null,
    xq: '', xMonth: 'month', xCat: '', xWho: '',
    busy: false,
    picking: false, picked: new Set(),
  };
  let D = null; // derived

  // ---------------- utils ----------------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const r2 = (v) => Math.round((+v || 0) * 100) / 100;
  const money = (v, cents) => {
    const n = r2(v), neg = n < 0, a = Math.abs(n);
    const s = a.toLocaleString('en-US', {minimumFractionDigits: cents || a % 1 ? 2 : 0, maximumFractionDigits: 2});
    return (neg ? '−' : '') + '$' + s;
  };
  const moneyShort = (v) => { const a = Math.abs(v); return a >= 1000 ? '$' + (a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : '$' + Math.round(a); };
  const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const mLong = (m) => MN[+m.slice(5) - 1] + ' ' + m.slice(0, 4);
  const mShort = (m) => MN[+m.slice(5) - 1].slice(0, 3);
  const pad = (n) => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const dayLabel = (iso) => {
    const t = todayISO();
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yi = y.getFullYear() + '-' + pad(y.getMonth() + 1) + '-' + pad(y.getDate());
    if (iso === t) return 'Today';
    if (iso === yi) return 'Yesterday';
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short'});
  };
  const other = (p) => (p === 'Paul' ? 'Grace' : 'Paul');
  const tint = (hex, a) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };

  // ---------------- api ----------------
  const api = {
    async load() {
      if (CFG.api === 'mock') return Mock.snapshot();
      const res = await fetch(CFG.api + '?pin=' + encodeURIComponent(S.pin), {cache: 'no-store'});
      return check(await res.json());
    },
    async post(action, payload) {
      if (CFG.api === 'mock') return Mock.post(action, payload, S.me);
      const res = await fetch(CFG.api, {method: 'POST', body: JSON.stringify({pin: S.pin, action, payload, user: S.me})});
      return check(await res.json());
    },
  };
  function check(j) { if (!j.ok) { const e = new Error(j.error || 'Something went wrong.'); e.pin = /PIN/i.test(j.error || ''); throw e; } return j; }

  // Local stand-in for the Google script, used for testing (config api: "mock").
  const Mock = {
    db: null,
    async init() {
      if (this.db) return;
      this.db = LS.get('mockdb', null) || (window.HOUSE_SEED ? JSON.parse(JSON.stringify(window.HOUSE_SEED)) : await (await fetch('seed.json')).json());
    },
    save() { LS.set('mockdb', this.db); },
    async snapshot() { await this.init(); if (S.pin !== (CFG.mockPin || '000000')) throw Object.assign(new Error('Wrong PIN.'), {pin: true}); return JSON.parse(JSON.stringify({ok: true, ...this.db})); },
    async post(action, p, user) {
      await this.init();
      const db = this.db, id = () => Math.random().toString(36).slice(2, 10), info = {};
      const ex = (i) => { const e = db.expenses.find((x) => x.id === i); if (!e) throw new Error('Item not found.'); return e; };
      if (action === 'addExpense') db.expenses.push({...p, id: 'e' + id(), type: 'expense', month: p.date.slice(0, 7), created_by: user, created_at: new Date().toISOString()});
      else if (action === 'updateExpense') Object.assign(ex(p.id), {...p, month: p.date.slice(0, 7)});
      else if (action === 'deleteExpense') db.expenses = db.expenses.filter((x) => x.id !== p.id);
      else if (action === 'addPayment') db.expenses.push({id: 'p' + id(), date: p.date, month: p.date.slice(0, 7), title: 'Payment ' + p.from + ' → ' + p.to, amount: r2(p.amount), category_id: '', paid_by: p.from, grace_share: p.to === 'Grace' ? r2(p.amount) : 0, paul_share: p.to === 'Paul' ? r2(p.amount) : 0, type: 'payment', note: '', created_by: user});
      else if (action === 'addCategory') db.categories.push({id: 'c' + id(), name: p.name, emoji: p.emoji, color: p.color, sort: db.categories.length + 1, archived: false});
      else if (action === 'updateCategory') Object.assign(db.categories.find((c) => c.id === p.id), p);
      else if (action === 'mergeCategory') { let n = 0; db.expenses.forEach((e) => { if (e.category_id === p.from) { e.category_id = p.to; n++; } }); db.categories.find((c) => c.id === p.from).archived = true; info.changed = n; }
      else if (action === 'addRule' || action === 'applyRule') {
        let rule = p;
        if (action === 'addRule') { rule = {id: 'r' + id(), match: p.match, category_id: p.category_id}; db.rules.push(rule); } else rule = db.rules.find((r) => r.id === p.id);
        let n = 0;
        if (action === 'applyRule' || p.apply) db.expenses.forEach((e) => { if (e.type !== 'payment' && e.title.toLowerCase().includes(rule.match.toLowerCase()) && e.category_id !== rule.category_id) { e.category_id = rule.category_id; n++; } });
        info.changed = n;
      } else if (action === 'deleteRule') db.rules = db.rules.filter((r) => r.id !== p.id);
      else if (action === 'bulkUpdate') { let n = 0; db.expenses.forEach((e) => { if (p.ids.includes(e.id)) { if (p.category_id) e.category_id = p.category_id; if (p.sub !== undefined) e.sub = p.sub; n++; } }); info.changed = n; }
      else if (action === 'setSub') { let n = 0; db.expenses.forEach((e) => { if (p.ids.includes(e.id)) { e.sub = p.sub; n++; } }); info.changed = n; }
      else if (action === 'renameSub') { let n = 0; db.expenses.forEach((e) => { if (e.category_id === p.category_id && e.sub === p.from) { e.sub = p.to; n++; } }); info.changed = n; }
      this.save();
      await new Promise((r) => setTimeout(r, 250));
      return {ok: true, ...JSON.parse(JSON.stringify(db)), info};
    },
  };

  // ---------------- derive ----------------
  function derive() {
    const data = S.data;
    const cats = {};
    data.categories.forEach((c) => { cats[c.id] = c; });
    const months = new Set([todayISO().slice(0, 7)]);
    const byMonth = {};
    const blank = () => ({total: 0, grace_share: 0, paul_share: 0, grace_paid: 0, paul_paid: 0, net: 0, payments: 0, count: 0, cats: {}});
    data.expenses.forEach((e) => {
      const m = e.month || e.date.slice(0, 7);
      months.add(m);
      const b = byMonth[m] || (byMonth[m] = blank());
      const paulPaid = e.paid_by === 'Paul' ? e.amount : 0;
      b.net += paulPaid - e.paul_share;
      if (e.type === 'payment') { b.payments += e.amount; return; }
      b.total += e.amount; b.count++;
      b.grace_share += e.grace_share; b.paul_share += e.paul_share;
      if (e.paid_by === 'Paul') b.paul_paid += e.amount; else b.grace_paid += e.amount;
      const c = b.cats[e.category_id] || (b.cats[e.category_id] = {total: 0, grace: 0, paul: 0, count: 0});
      c.total += e.amount; c.grace += e.grace_share; c.paul += e.paul_share; c.count++;
    });
    const list = [...months].sort();
    let run = 0;
    const running = {};
    list.forEach((m) => { byMonth[m] = byMonth[m] || blank(); run += byMonth[m].net; running[m] = r2(run); });
    const usage = {};
    data.expenses.forEach((e) => { if (e.type !== 'payment') usage[e.category_id] = (usage[e.category_id] || 0) + 1; });
    D = {cats, months: list, byMonth, running, balance: r2(run), usage};
    if (!S.month || !byMonth[S.month]) S.month = list[list.length - 1];
  }
  const activeCats = () => S.data.categories.filter((c) => !c.archived).sort((a, b) => (D.usage[b.id] || 0) - (D.usage[a.id] || 0) || a.sort - b.sort);
  const cat = (id) => D.cats[id] || {name: 'Uncategorised', emoji: '🏷️', color: '#8A8F98'};
  const moved = (r) => { const n = (r.info && r.info.changed) || 0; return n === 1 ? '1 expense moved' : n + ' expenses moved'; };
  const subsOf = (cid) => { const n = {}; S.data.expenses.forEach((e) => { if (e.category_id === cid && e.sub) n[e.sub] = (n[e.sub] || 0) + 1; }); return Object.entries(n).sort((a, b) => b[1] - a[1]).map(([s, c]) => ({sub: s, n: c})); };
  const catLabel = (e) => (e.sub ? esc(e.sub) + ' · ' : '') + esc(cat(e.category_id).name);
  const matches = (e, q) => !q || [e.title, cat(e.category_id).name, e.sub || '', e.note || '', e.paid_by, String(e.amount), e.date].some((s) => String(s).toLowerCase().includes(q));
  const owesText = (net) => (Math.abs(net) < 0.005 ? 'All square' : net > 0 ? 'Grace owes Paul' : 'Paul owes Grace');

  // ---------------- icons ----------------
  const I = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    left: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="color:var(--muted)"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    house: '<svg class="mark" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#2F5D50"/><path d="M14 30 32 16l18 14v18H14z" fill="#EEF1EE"/><rect x="14" y="40" width="12" height="8" fill="#C2577D"/><rect x="26" y="40" width="9" height="8" fill="#3D5AA8"/><rect x="35" y="40" width="15" height="8" fill="#D9982A"/></svg>',
  };

  // ---------------- render ----------------
  const app = () => $('#app');
  function render() {
    if (!S.pin || !S.me || !S.data) return renderLogin();
    derive();
    const views = {home: viewHome, list: viewList, insights: viewInsights, settings: viewSettings};
    app().innerHTML = views[S.tab]();
    renderNav();
  }

  function renderNav() {
    let nav = $('.nav');
    if (!nav) { nav = document.createElement('nav'); nav.className = 'nav'; nav.setAttribute('aria-label', 'Main'); document.body.append(nav); }
    const b = (t, icon, label) => `<button data-act="tab" data-tab="${t}" class="${S.tab === t ? 'on' : ''}" aria-current="${S.tab === t ? 'page' : 'false'}">${icon}<span>${label}</span></button>`;
    nav.innerHTML = `<div class="in">${b('home', I.home, 'Home')}${b('list', I.list, 'Expenses')}<button class="add" data-act="add" aria-label="Add expense">${I.plus}</button>${b('insights', I.chart, 'Insights')}${b('settings', I.gear, 'Settings')}</div>`;
  }

  function monthNav() {
    const i = D.months.indexOf(S.month);
    return `<div class="monthnav">
      <button data-act="month" data-d="-1" ${i <= 0 ? 'disabled' : ''} aria-label="Previous month">${I.left}</button>
      <button class="label" data-act="pickmonth">${mLong(S.month)}</button>
      <button data-act="month" data-d="1" ${i >= D.months.length - 1 ? 'disabled' : ''} aria-label="Next month">${I.right}</button></div>`;
  }
  const meBtn = () => `<span class="topr"><button class="iconbtn" data-act="search" aria-label="Search expenses">${I.search}</button><button class="me ${S.me}" data-act="tab" data-tab="settings" aria-label="Settings">${S.me[0]}</button></span>`;

  // Cash out vs own expenses, per person
  function cashCard(b, title) {
    const max = Math.max(1, b.grace_paid, b.paul_paid, b.grace_share, b.paul_share);
    const person = (p) => {
      const k = p.toLowerCase(), paid = b[k + '_paid'], share = b[k + '_share'], diff = r2(paid - share);
      const line = Math.abs(diff) < .005 ? 'Paid exactly their own share' : diff > 0 ? `Paid ${money(diff)} more than ${p === 'Paul' ? 'his' : 'her'} share` : `Paid ${money(-diff)} less than ${p === 'Paul' ? 'his' : 'her'} share`;
      return `<div class="cash-p">
        <div class="cash-h"><span class="me ${p}" aria-hidden="true">${p[0]}</span><b>${p}</b><span class="cash-d ${diff > .005 ? 'over' : diff < -.005 ? 'under' : ''}">${line}</span></div>
        <div class="cash-l"><span>Cash out</span><div class="cash-t"><i class="${p}" style="width:${(paid / max * 100).toFixed(1)}%"></i></div><span class="num">${money(paid)}</span></div>
        <div class="cash-l"><span>Own expenses</span><div class="cash-t"><i class="${p} soft" style="width:${(share / max * 100).toFixed(1)}%"></i></div><span class="num">${money(share)}</span></div>
      </div>`;
    };
    return `<section class="card" id="cash"><h2>${title}</h2><p class="sub">Cash out is what each of you paid. Own expenses is each person’s share, whoever paid.</p>${person('Paul')}${person('Grace')}</section>`;
  }

  function balanceCard(b) {
    const net = b ? r2(b.net) : 0, bal = D.balance;
    return `<section class="balance">
        <div class="txt">
          <div class="lead">Overall balance</div>
          <div class="main num ${Math.abs(bal) < .005 ? 'even' : ''}">${owesText(bal)}${Math.abs(bal) >= .005 ? ' ' + money(Math.abs(bal)) : ''}</div>
          <div class="minor num">${b ? 'This month: ' + (Math.abs(net) < .005 ? 'no change' : (net > 0 ? 'Grace' : 'Paul') + ' fell behind by ' + money(Math.abs(net))) : ''}</div>
        </div>
        ${Math.abs(bal) >= .005 ? '<button class="btn" data-act="settle">Settle up</button>' : ''}
      </section>`;
  }

  const modeSeg = () => `<div class="seg" style="margin-bottom:18px" role="tablist">
      <button data-act="hmode" data-v="month" class="${S.hmode !== 'compare' ? 'on' : ''}" role="tab">One month</button>
      <button data-act="hmode" data-v="compare" class="${S.hmode === 'compare' ? 'on' : ''}" role="tab">Compare months</button></div>`;
  const syncLine = () => `<div class="sync">${S.busy ? '<span class="spin"></span> Syncing' : 'Pull down or tap to refresh · ' + (S.data.at ? 'updated ' + new Date(S.data.at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '')}</div>`;

  function viewHome() {
    if (S.hmode === 'compare') return viewCompare();
    const m = S.month, b = D.byMonth[m];
    const i = D.months.indexOf(m), prev = i > 0 ? D.byMonth[D.months[i - 1]] : null;
    const rows = Object.entries(b.cats).sort((a, b2) => b2[1].total - a[1].total);
    let delta = '';
    if (prev && prev.total > 0) {
      const d = (b.total - prev.total) / prev.total * 100;
      delta = `<div class="delta"><b class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}%</b> vs ${MN[+D.months[i - 1].slice(5) - 1]} (${money(prev.total)}) · ${b.count} expenses</div>`;
    } else delta = `<div class="delta">${b.count} expenses</div>`;
    const total = r2(b.total), whole = Math.floor(total), cents = Math.round((total - whole) * 100);
    return `
      <div class="top">${monthNav()}${meBtn()}</div>
      ${modeSeg()}
      <section class="hero">
        <div class="cap">Spent in ${MN[+m.slice(5) - 1]}</div>
        <div class="big num">$${whole.toLocaleString('en-US')}${cents ? `<small>.${pad(cents)}</small>` : ''}</div>
        ${delta}
      </section>
      ${cashCard(b, 'Cash out vs own expenses')}
      <section class="card">
        <h2>Where it went</h2>
        <p class="sub">Tap a category to see every expense in it.</p>
        ${rows.length ? `<ul class="rows">${rows.map(([cid, v]) => {
          const c = cat(cid), pv = prev && prev.cats[cid] ? prev.cats[cid].total : 0;
          return `<li><button class="crow" data-act="cat" data-cat="${esc(cid)}">
            <span class="ico" style="background:${tint(c.color, .16)}">${c.emoji}</span>
            <span style="min-width:0"><div class="name">${esc(c.name)}</div><div class="bar"><i style="width:${(v.total / rows[0][1].total * 100).toFixed(1)}%;background:${c.color}"></i></div></span>
            <span class="right"><div class="v num">${money(v.total)}</div><div class="pc num">${(v.total / b.total * 100).toFixed(0)}%${pv && Math.abs(v.total - pv) >= 1 ? ' · ' + (v.total >= pv ? '+' : '−') + moneyShort(Math.abs(v.total - pv)) : ''}</div></span>
          </button></li>`;
        }).join('')}</ul>` : `<div class="empty"><b>Nothing logged yet</b>Tap + to add the first expense of ${MN[+m.slice(5) - 1]}.</div>`}
      </section>
      ${balanceCard(b)}
      ${syncLine()}`;
  }

  function viewCompare() {
    const avail = D.months.filter((m) => D.byMonth[m].count);
    if (!S.cmp) S.cmp = avail.slice(-3);
    const ms = avail.filter((m) => S.cmp.includes(m));
    const sum = (k) => ms.reduce((s, m) => s + D.byMonth[m][k], 0);
    const cats = {};
    ms.forEach((m) => Object.entries(D.byMonth[m].cats).forEach(([cid, v]) => { cats[cid] = (cats[cid] || 0) + v.total; }));
    const order = Object.keys(cats).sort((a, b) => cats[b] - cats[a]);
    const last = ms[ms.length - 1], before = ms[ms.length - 2];
    const chg = (a, b) => (b ? (a - b >= 0 ? '+' : '−') + moneyShort(Math.abs(a - b)) : '');
    const cell = (v, strong) => `<td class="num${strong ? ' strong' : ''}">${v ? money(Math.round(v)) : '·'}</td>`;
    const line = (label, k, cls) => `<tr class="${cls || ''}"><th scope="row">${label}</th>${ms.map((m) => cell(D.byMonth[m][k], cls === 'total')).join('')}${before ? `<td class="num chg">${chg(D.byMonth[last][k], D.byMonth[before][k])}</td>` : ''}</tr>`;
    const combined = {grace_paid: sum('grace_paid'), paul_paid: sum('paul_paid'), grace_share: sum('grace_share'), paul_share: sum('paul_share')};
    return `
      <div class="top"><h1>Compare months</h1>${meBtn()}</div>
      ${modeSeg()}
      <div class="lbl" style="margin-top:0"><span>Pick the months to put side by side</span></div>
      <div class="chips">${avail.map((m) => `<button class="chip ${S.cmp.includes(m) ? 'on' : ''}" data-act="cmp" data-m="${m}">${mShort(m)} ${m.slice(2, 4)}</button>`).join('')}</div>
      ${ms.length ? `
      <section class="card">
        <h2>Spending, month by month</h2>
        <p class="sub">Each bar is split by whose expense it was. Tap a bar to open that month.</p>
        <div class="legend"><span><i class="dot Grace"></i>Grace</span><span><i class="dot Paul"></i>Paul</span></div>
        ${trendChart(ms, 'open')}
      </section>
      <section class="card cmp">
        <h2>Side by side</h2>
        <p class="sub">${before ? `Last column: ${mShort(last)} vs ${mShort(before)}.` : 'Pick a second month to see the change.'} Tap a category for its expenses.</p>
        <div class="cmp-scroll"><table>
          <thead><tr><th></th>${ms.map((m) => `<th scope="col">${mShort(m)}</th>`).join('')}${before ? '<th scope="col">Change</th>' : ''}</tr></thead>
          <tbody>
            ${line('Total spent', 'total', 'total')}
            <tr class="grp"><th colspan="${ms.length + 2}">Paul</th></tr>
            ${line('Cash out', 'paul_paid')}${line('Own expenses', 'paul_share')}
            <tr class="grp"><th colspan="${ms.length + 2}">Grace</th></tr>
            ${line('Cash out', 'grace_paid')}${line('Own expenses', 'grace_share')}
            <tr class="grp"><th colspan="${ms.length + 2}">Categories</th></tr>
            ${order.map((cid) => { const c = cat(cid); const v = (m) => (D.byMonth[m].cats[cid] || {}).total || 0;
              return `<tr class="crow-t" data-act="cat" data-cat="${esc(cid)}" data-ms="${ms.join(',')}"><th scope="row"><span class="cdot" style="background:${c.color}"></span>${c.emoji} ${esc(c.name)}</th>${ms.map((m) => cell(v(m))).join('')}${before ? `<td class="num chg ${v(last) > v(before) ? 'up' : v(last) < v(before) ? 'down' : ''}">${chg(v(last), v(before))}</td>` : ''}</tr>`; }).join('')}
          </tbody></table></div>
      </section>
      ${cashCard(combined, ms.length > 1 ? `Cash out vs own expenses · ${ms.length} months` : 'Cash out vs own expenses')}`
      : '<div class="empty"><b>No months picked</b>Tap the months above to compare them.</div>'}
      ${balanceCard(null)}
      ${syncLine()}`;
  }

  function filteredExpenses() {
    const q = S.xq.trim().toLowerCase();
    return S.data.expenses.filter((e) => {
      if (S.xMonth === 'month' && !q && (e.month || e.date.slice(0, 7)) !== S.month) return false;
      if (S.xCat && e.category_id !== S.xCat) return false;
      if (S.xWho && e.paid_by !== S.xWho) return false;
      if (!matches(e, q)) return false;
      return true;
    }).sort((a, b) => (b.date + (b.created_at || '')).localeCompare(a.date + (a.created_at || '')));
  }

  function xrow(e) {
    const c = cat(e.category_id), pay = e.type === 'payment';
    const split = pay ? 'settle-up' : e.grace_share && e.paul_share ? (Math.abs(e.grace_share - e.paul_share) < .01 ? 'split equally' : `G ${money(e.grace_share)} · P ${money(e.paul_share)}`) : (e.paul_share ? 'Paul’s only' : 'Grace’s only');
    return `<button class="xrow ${pay ? 'payment' : ''}" data-act="${pay ? 'editpay' : 'edit'}" data-id="${esc(e.id)}">
      <span class="ico" style="background:${pay ? '' : tint(c.color, .16)}">${pay ? '🤝' : c.emoji}</span>
      <span style="min-width:0"><div class="t">${esc(e.title)}</div><div class="m"><span class="dot ${esc(e.paid_by)}"></span><span>${esc(e.paid_by)} paid · ${pay ? 'Payment' : catLabel(e)}</span></div></span>
      <span><div class="a num">${money(e.amount)}</div><div class="s">${split}</div></span></button>`;
  }

  function viewList() {
    const list = filteredExpenses();
    const groups = {};
    list.forEach((e) => { (groups[e.date] = groups[e.date] || []).push(e); });
    const total = list.filter((e) => e.type !== 'payment').reduce((s, e) => s + e.amount, 0);
    const usedCats = activeCats().filter((c) => D.usage[c.id]);
    return `
      <div class="top"><h1>Expenses</h1>${meBtn()}</div>
      <label class="search">${I.search}<input type="search" placeholder="Search name, category, note or amount" value="${esc(S.xq)}" data-input="xq" aria-label="Search expenses"></label>
      ${S.xq.trim() ? '<div class="hint">Searching every month</div>' : ''}
      <div class="chips">
        <button class="chip ${S.xMonth === 'month' && !S.xq.trim() ? 'on' : ''}" data-act="xmonth" data-v="month">${mLong(S.month)}</button>
        <button class="chip ${S.xMonth === 'all' || S.xq.trim() ? 'on' : ''}" data-act="xmonth" data-v="all">All time</button>
        <button class="chip ${S.xWho === 'Paul' ? 'on' : ''}" data-act="xwho" data-v="Paul"><span class="dot Paul"></span>Paul paid</button>
        <button class="chip ${S.xWho === 'Grace' ? 'on' : ''}" data-act="xwho" data-v="Grace"><span class="dot Grace"></span>Grace paid</button>
      </div>
      <div class="chips">
        <button class="chip ${!S.xCat ? 'on' : ''}" data-act="xcat" data-v="">All categories</button>
        ${usedCats.map((c) => `<button class="chip ${S.xCat === c.id ? 'on' : ''}" data-act="xcat" data-v="${c.id}">${c.emoji} ${esc(c.name)}</button>`).join('')}
      </div>
      <div class="day"><span>${list.length} items · <span class="num">${money(total)}</span></span>${S.picking ? `<button class="linkbtn" data-act="pickall">Select all ${list.filter((e) => e.type !== 'payment').length}</button>` : '<button class="linkbtn" data-act="pickstart">Select</button>'}</div>
      ${list.length ? Object.entries(groups).map(([d, es]) => `<div class="day"><span>${dayLabel(d)}</span><span class="num">${money(es.filter((e) => e.type !== 'payment').reduce((s, e) => s + e.amount, 0))}</span></div><div class="group">${es.map((e) => S.picking ? (e.type === 'payment' ? '' : pickRow(e, S.picked.has(e.id))) : xrow(e)).join('')}</div>`).join('')
        : '<div class="empty"><b>No expenses match</b>Change the filters above, or tap + to add one.</div>'}
      ${S.picking ? dockHtml(S.picked) : ''}`;
  }

  // ---------- charts ----------
  function trendChart(months, mode) {
    const W = 340, H = 190, top = 22, bot = 24, left = 6;
    const max = Math.max(1, ...months.map((m) => D.byMonth[m].total));
    const bw = (W - left * 2) / months.length;
    const y = (v) => H - bot - (v / max) * (H - top - bot);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly spending split by person">
      ${months.map((m, i) => {
        const b = D.byMonth[m], x = left + i * bw + bw * 0.18, w = bw * 0.64, sel = mode === 'open' || m === S.month;
        const yg = y(b.grace_share), yt = y(b.total);
        return `<g class="hit" data-act="${mode === 'open' ? 'openmonth' : 'setmonth'}" data-m="${m}" opacity="${sel ? 1 : .55}">
          <rect x="${left + i * bw}" y="0" width="${bw}" height="${H}" fill="transparent"/>
          <rect x="${x}" y="${yg}" width="${w}" height="${H - bot - yg}" rx="3" fill="var(--grace)"/>
          <rect x="${x}" y="${yt}" width="${w}" height="${Math.max(0, yg - yt - 1.5)}" rx="3" fill="var(--paul)"/>
          <text x="${x + w / 2}" y="${yt - 6}" text-anchor="middle" class="${sel ? 'val' : ''}">${b.total ? moneyShort(b.total) : ''}</text>
          <text x="${x + w / 2}" y="${H - 7}" text-anchor="middle" class="${sel ? 'val' : ''}">${mShort(m)}</text></g>`;
      }).join('')}</svg>`;
  }

  function balanceChart(months) {
    const W = 340, H = 150, top = 20, bot = 24, l = 18, r = 18;
    const vals = months.map((m) => D.running[m]);
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals, 1);
    const x = (i) => months.length === 1 ? W / 2 : l + i * (W - l - r) / (months.length - 1);
    const y = (v) => top + (hi - v) / (hi - lo || 1) * (H - top - bot);
    const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Running balance between Grace and Paul">
      <line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)" stroke-dasharray="3 4"/>
      <polyline points="${pts}" fill="none" stroke="var(--saffron)" stroke-width="2.5" stroke-linejoin="round"/>
      ${vals.map((v, i) => `<g class="hit" data-act="setmonth" data-m="${months[i]}"><circle cx="${x(i)}" cy="${y(v)}" r="${months[i] === S.month ? 6 : 4}" fill="var(--saffron)" stroke="var(--surface)" stroke-width="2"/>
        <text x="${x(i)}" y="${y(v) + (v >= 0 ? -10 : 18)}" text-anchor="middle" class="${months[i] === S.month ? 'val' : ''}">${v < 0 ? '−' : ''}${moneyShort(v)}</text>
        <text x="${x(i)}" y="${H - 6}" text-anchor="middle">${mShort(months[i])}</text></g>`).join('')}
    </svg>`;
  }

  function viewInsights() {
    const months = D.months.filter((m) => D.byMonth[m].count || m === S.month).slice(-6);
    const full = D.months.filter((m) => D.byMonth[m].count);
    const totalAll = full.reduce((s, m) => s + D.byMonth[m].total, 0);
    const avg = full.length ? totalAll / full.length : 0;
    // category matrix
    const catTotals = {};
    full.forEach((m) => Object.entries(D.byMonth[m].cats).forEach(([cid, v]) => { catTotals[cid] = (catTotals[cid] || 0) + v.total; }));
    const order = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]);
    const maxCell = Math.max(1, ...order.flatMap((cid) => months.map((m) => (D.byMonth[m].cats[cid] || {}).total || 0)));
    // top places
    const places = {};
    S.data.expenses.filter((e) => e.type !== 'payment' && (e.month || e.date.slice(0, 7)) === S.month).forEach((e) => {
      const k = e.title.trim().toLowerCase();
      (places[k] = places[k] || {title: e.title.trim(), total: 0, n: 0, cid: e.category_id}).total += e.amount; places[k].n++;
    });
    const topPlaces = Object.values(places).sort((a, b) => b.total - a.total).slice(0, 6);
    const b = D.byMonth[S.month];
    const big = S.data.expenses.filter((e) => e.type !== 'payment' && (e.month || e.date.slice(0, 7)) === S.month).sort((a, c) => c.amount - a.amount).slice(0, 5);
    const bigSum = big.reduce((s, e) => s + e.amount, 0);
    return `
      <div class="top">${monthNav()}${meBtn()}</div>
      <section class="card">
        <h2>Monthly spend</h2>
        <p class="sub">Each bar is split by whose cost it was. Tap a month to switch.</p>
        <div class="legend"><span><i class="dot Grace"></i>Grace</span><span><i class="dot Paul"></i>Paul</span></div>
        ${trendChart(months)}
        <div class="stat-grid" style="margin-top:12px">
          <div class="stat"><div class="k">Average month</div><div class="v num">${money(Math.round(avg))}</div></div>
          <div class="stat"><div class="k">${mShort(S.month)} vs average</div><div class="v num" style="color:${b.total > avg ? 'var(--bad)' : 'var(--good)'}">${avg ? (b.total >= avg ? '+' : '−') + Math.abs((b.total - avg) / avg * 100).toFixed(0) + '%' : '—'}</div></div>
        </div>
      </section>
      <section class="card">
        <h2>Running balance</h2>
        <p class="sub">Above the line, Grace owes Paul. Below it, Paul owes Grace.</p>
        ${balanceChart(D.months.filter((m) => D.byMonth[m].count || D.byMonth[m].payments || m === S.month).slice(-6))}
      </section>
      <section class="card">
        <h2>Categories over time</h2>
        <p class="sub">Darker means more spent. Tap a cell to see those expenses.</p>
        <div class="heat"><table><thead><tr><th></th>${months.map((m) => `<th>${mShort(m)}</th>`).join('')}<th>Avg</th></tr></thead><tbody>
          ${order.map((cid) => { const c = cat(cid); return `<tr><td class="cat">${c.emoji} ${esc(c.name)}</td>${months.map((m) => {
            const v = (D.byMonth[m].cats[cid] || {}).total || 0;
            return `<td class="cell num" data-act="cat" data-cat="${esc(cid)}" data-m="${m}" style="background:${v ? tint(c.color, .1 + .75 * Math.sqrt(v / maxCell)) : 'var(--sunk)'};${v / maxCell > .45 ? 'color:#fff;' : ''}">${v ? moneyShort(v) : '·'}</td>`;
          }).join('')}<td class="num" style="color:var(--muted)">${moneyShort(catTotals[cid] / (full.length || 1))}</td></tr>`; }).join('')}
        </tbody></table></div>
      </section>
      <section class="card">
        <h2>Biggest items in ${MN[+S.month.slice(5) - 1]}</h2>
        <p class="sub">The top ${big.length} make up ${b.total ? (bigSum / b.total * 100).toFixed(0) : 0}% of the month.</p>
        <div class="group" style="box-shadow:none;border:1px solid var(--line)">${big.map(xrow).join('') || '<div class="empty">Nothing yet.</div>'}</div>
      </section>
      <section class="card">
        <h2>Where you go most</h2>
        <p class="sub">Same name, added up for ${MN[+S.month.slice(5) - 1]}.</p>
        <ul class="rows">${topPlaces.map((p) => { const c = cat(p.cid); return `<li><div class="crow"><span class="ico" style="background:${tint(c.color, .16)}">${c.emoji}</span><span style="min-width:0"><div class="name">${esc(p.title)}</div><div class="pc">${p.n} time${p.n > 1 ? 's' : ''}</div></span><span class="right"><div class="v num">${money(p.total)}</div></span></div></li>`; }).join('')}</ul>
      </section>`;
  }

  function viewSettings() {
    const cats = activeCats();
    return `
      <div class="top"><h1>Settings</h1>${meBtn()}</div>
      <div class="section-t">This phone belongs to</div>
      <div class="whoami">${['Paul', 'Grace'].map((p) => `<button class="${S.me === p ? 'on' : ''}" data-act="setme" data-v="${p}"><span class="me ${p}">${p[0]}</span>${p}</button>`).join('')}</div>
      <div class="section-t">Categories · rename one and every past expense follows</div>
      <div class="list">
        ${cats.map((c) => `<button data-act="editcat" data-id="${c.id}"><span class="ico" style="background:${tint(c.color, .16)}">${c.emoji}</span><span class="grow">${esc(c.name)}<small>${D.usage[c.id] || 0} expenses</small></span><span class="chev">${I.right}</span></button>`).join('')}
        <button data-act="newcat"><span class="ico" style="background:var(--sunk)">＋</span><span class="grow">Add a category</span></button>
      </div>
      <div class="section-t">Rules · sort expenses by name automatically</div>
      <div class="list">
        ${S.data.rules.map((r) => { const c = cat(r.category_id); return `<div><span class="ico" style="background:${tint(c.color, .16)}">${c.emoji}</span><span class="grow">“${esc(r.match)}” → ${esc(c.name)}</span><button class="btn ghost" data-act="applyrule" data-id="${r.id}">Apply</button><button class="x" data-act="delrule" data-id="${r.id}" aria-label="Delete rule">${I.x}</button></div>`; }).join('')}
        <button data-act="newrule"><span class="ico" style="background:var(--sunk)">＋</span><span class="grow">Add a rule<small>e.g. anything named “Spinneys” goes to Groceries</small></span></button>
      </div>
      <div class="section-t">Data</div>
      <div class="list">
        <button data-act="export"><span class="grow">Download all expenses (CSV)<small>Opens in Excel or Google Sheets. Good as a monthly backup.</small></span></button>
        <button data-act="refresh"><span class="grow">Refresh now</span></button>
        <button data-act="logout"><span class="grow" style="color:var(--bad)">Sign out of this phone</span></button>
      </div>
      <div class="sync">${S.data.expenses.length} records · ${CFG.api === 'mock' ? 'test mode' : 'synced with your Google Sheet'}</div>`;
  }

  function renderLogin() {
    const nav = $('.nav'); if (nav) nav.remove();
    app().innerHTML = `
      <div class="login">
        ${I.house}
        <h1>Our lovely house</h1>
        <p>Shared expenses for Grace and Paul. Enter the PIN from your Google Sheet’s Settings tab.</p>
        <input class="pin num" id="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="••••••" value="${esc(S.pin)}" aria-label="PIN">
        <div class="section-t" style="margin:4px">Who’s using this phone?</div>
        <div class="whoami">${['Paul', 'Grace'].map((p) => `<button class="${S.me === p ? 'on' : ''}" data-act="pickme" data-v="${p}"><span class="me ${p}">${p[0]}</span>${p}</button>`).join('')}</div>
        <button class="btn wide" data-act="login">Open the house book</button>
        <div class="err" id="err"></div>
      </div>`;
  }

  // ---------------- sheets ----------------
  function openSheet(html, onMount) {
    closeSheet(true);
    const scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.dataset.act = 'close';
    const sh = document.createElement('div'); sh.className = 'sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
    sh.innerHTML = '<div class="grab"></div>' + html;
    document.body.append(scrim, sh);
    requestAnimationFrame(() => { scrim.classList.add('open'); sh.classList.add('open'); });
    document.body.style.overflow = 'hidden';
    if (onMount) onMount(sh);
    return sh;
  }
  function closeSheet(instant) {
    const sh = $('.sheet'), sc = $('.scrim');
    if (!sh) return;
    document.body.style.overflow = '';
    if (instant) { sh.remove(); sc && sc.remove(); return; }
    sh.classList.remove('open'); sc && sc.classList.remove('open');
    setTimeout(() => { sh.remove(); sc && sc.remove(); }, 260);
  }
  const head = (t) => `<div class="sheet-head"><h2>${t}</h2><button class="x" data-act="close" aria-label="Close">${I.x}</button></div>`;

  // Add / edit expense
  function expenseForm(e) {
    const isNew = !e;
    const f = e ? {...e} : {amount: '', title: '', category_id: '', paid_by: S.me, date: todayISO(), split: 'equal', grace_share: 0, paul_share: 0, note: ''};
    if (e) f.split = !e.grace_share ? 'Paul' : !e.paul_share ? 'Grace' : Math.abs(e.grace_share - e.paul_share) < .011 ? 'equal' : 'custom';
    const cats = activeCats();
    const sh = openSheet(`${head(isNew ? 'New expense' : 'Edit expense')}
      <div class="amount"><span>$</span><input id="f-amount" inputmode="decimal" placeholder="0" value="${f.amount === '' ? '' : f.amount}" aria-label="Amount"></div>
      <div class="field"><label for="f-title">What was it?</label><input id="f-title" placeholder="e.g. Spinneys, Fuel, Generator" value="${esc(f.title)}" autocomplete="off"></div>
      <div class="sugg" id="f-sugg"></div>
      <div class="lbl"><span>Category</span></div>
      <div class="catgrid more-hidden" id="f-cats">${cats.map((c, i) => `<button type="button" data-cat="${c.id}" class="${f.category_id === c.id ? 'on' : ''} ${i >= 8 && f.category_id !== c.id ? 'extra' : ''}"><span class="e">${c.emoji}</span><span>${esc(c.name)}</span></button>`).join('')}</div>
      ${cats.length > 8 ? `<button type="button" class="morecats" id="f-more">Show all ${cats.length} categories</button>` : ''}
      <div class="lbl"><span>Subcategory <small>(optional)</small></span></div>
      <div class="field"><input id="f-sub" placeholder="e.g. Zanzibar, Kids’ restaurants" value="${esc(f.sub || '')}" autocomplete="off" aria-label="Subcategory"></div>
      <div class="sugg" id="f-subs"></div>
      <div class="lbl"><span>Who paid?</span></div>
      <div class="seg" id="f-payer">${['Paul', 'Grace'].map((p) => `<button type="button" data-v="${p}" class="${p} ${f.paid_by === p ? 'on' : ''}">${p}</button>`).join('')}</div>
      <div class="lbl"><span>Whose expense is it?</span><span id="f-splitinfo" class="num"></span></div>
      <div class="seg" id="f-split">
        <button type="button" data-v="equal" class="${f.split === 'equal' ? 'on' : ''}">50/50</button>
        <button type="button" data-v="Paul" class="Paul ${f.split === 'Paul' ? 'on' : ''}">Paul’s</button>
        <button type="button" data-v="Grace" class="Grace ${f.split === 'Grace' ? 'on' : ''}">Grace’s</button>
        <button type="button" data-v="custom" class="${f.split === 'custom' ? 'on' : ''}">Custom</button>
      </div>
      <div class="custom" id="f-custom" ${f.split === 'custom' ? '' : 'hidden'}>
        <div class="field"><label>Grace’s part</label><input id="f-gs" inputmode="decimal" value="${f.split === 'custom' ? f.grace_share : ''}"></div>
        <div class="field"><label>Paul’s part</label><input id="f-ps" inputmode="decimal" value="${f.split === 'custom' ? f.paul_share : ''}"></div>
      </div>
      <div class="row2" style="margin-top:12px">
        <div class="field"><label for="f-date">Date</label><input id="f-date" type="date" value="${f.date}"></div>
        <div class="field"><label for="f-note">Note</label><input id="f-note" value="${esc(f.note)}" placeholder="Optional"></div>
      </div>
      <div class="err" id="f-err"></div>
      <div class="actions">${isNew ? '' : '<button class="btn danger" data-act="delexp">Delete</button>'}<button class="btn" id="f-save">${isNew ? 'Add expense' : 'Save changes'}</button></div>`);

    const amt = $('#f-amount', sh), title = $('#f-title', sh);
    const setSeg = (id, v) => sh.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    const showSubs = () => {
      const box = $('#f-subs', sh), cur = $('#f-sub', sh).value.trim().toLowerCase();
      const subs = f.category_id ? subsOf(f.category_id).filter((s) => s.sub.toLowerCase() !== cur) : [];
      box.innerHTML = subs.slice(0, 8).map((s) => `<button type="button" data-sub="${esc(s.sub)}">${esc(s.sub)}</button>`).join('');
    };
    const pickCat = (id) => { f.category_id = id; sh.querySelectorAll('#f-cats button').forEach((b) => { b.classList.toggle('on', b.dataset.cat === id); if (b.dataset.cat === id) b.classList.remove('extra'); }); showSubs(); };
    $('#f-subs', sh).addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { $('#f-sub', sh).value = b.dataset.sub; showSubs(); } });
    $('#f-sub', sh).addEventListener('input', showSubs);
    const more = $('#f-more', sh);
    if (more) more.addEventListener('click', () => { $('#f-cats', sh).classList.remove('more-hidden'); more.remove(); });
    const sizeAmt = () => { amt.style.width = Math.max(1, amt.value.length || 1) + 0.6 + 'ch'; };
    amt.addEventListener('input', sizeAmt); sizeAmt();
    const info = () => {
      const a = r2(amt.value.replace(',', '.'));
      let t = '';
      if (f.split === 'equal' && a) t = money(a / 2) + ' each';
      if (f.split === 'custom') {
        const g = r2($('#f-gs', sh).value.replace(',', '.')), p = r2($('#f-ps', sh).value.replace(',', '.'));
        t = Math.abs(g + p - a) < .011 ? '' : 'Parts add to ' + money(g + p);
      }
      $('#f-splitinfo', sh).textContent = t;
    };
    // suggestions from history and rules
    // For each name used before: the category and split used most often.
    const history = {};
    const tally = {};
    S.data.expenses.filter((x) => x.type !== 'payment').forEach((x) => {
      const k = x.title.trim().toLowerCase();
      const sp = !x.grace_share ? 'Paul' : !x.paul_share ? 'Grace' : 'equal';
      const t = tally[k] || (tally[k] = {title: x.title.trim(), date: x.date, n: 0, cats: {}, splits: {}, subs: {}});
      t.n++; if (x.sub) t.subs[x.sub] = (t.subs[x.sub] || 0) + 1; t.cats[x.category_id] = (t.cats[x.category_id] || 0) + 1; t.splits[sp] = (t.splits[sp] || 0) + 1;
      if (x.date > t.date) t.date = x.date;
    });
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0][0];
    Object.entries(tally).forEach(([k, t]) => { history[k] = {title: t.title, date: t.date, n: t.n, category_id: top(t.cats), split: top(t.splits), sub: Object.keys(t.subs).length ? top(t.subs) : ''}; });
    const suggest = () => {
      const q = title.value.trim().toLowerCase();
      const box = $('#f-sugg', sh);
      if (!q || !isNew) { box.innerHTML = ''; }
      else {
        const hits = Object.values(history).filter((x) => x.title.toLowerCase().includes(q) && x.title.toLowerCase() !== q).sort((a, b) => b.n - a.n || b.date.localeCompare(a.date)).slice(0, 4);
        box.innerHTML = hits.map((x) => `<button type="button" data-t="${esc(x.title)}">${cat(x.category_id).emoji} ${esc(x.title)}</button>`).join('');
      }
      if (!q) return;
      const rule = S.data.rules.find((r) => q.includes(r.match.toLowerCase()));
      if (rule && !f.touchedCat) pickCat(rule.category_id);
      else if (history[q] && !f.touchedCat) pickCat(history[q].category_id);
    };
    const applyHistory = (t) => {
      const x = history[t.toLowerCase()];
      title.value = t;
      if (x) {
        pickCat(x.category_id);
        f.split = x.split;
        if (x.sub && !$('#f-sub', sh).value) { $('#f-sub', sh).value = x.sub; showSubs(); }
        setSeg('f-split', f.split); $('#f-custom', sh).hidden = true;
      }
      $('#f-sugg', sh).innerHTML = ''; info();
    };
    title.addEventListener('input', suggest);
    $('#f-sugg', sh).addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) applyHistory(b.dataset.t); });
    $('#f-cats', sh).addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { f.touchedCat = true; pickCat(b.dataset.cat); } });
    $('#f-payer', sh).addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { f.paid_by = b.dataset.v; setSeg('f-payer', f.paid_by); } });
    $('#f-split', sh).addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      f.split = b.dataset.v; setSeg('f-split', f.split); $('#f-custom', sh).hidden = f.split !== 'custom';
      if (f.split === 'custom' && !$('#f-gs', sh).value) { const a = r2(amt.value); $('#f-gs', sh).value = r2(a / 2); $('#f-ps', sh).value = r2(a - r2(a / 2)); }
      info();
    });
    $('#f-gs', sh).addEventListener('input', () => { const a = r2(amt.value.replace(',', '.')); $('#f-ps', sh).value = r2(a - r2($('#f-gs', sh).value.replace(',', '.'))); info(); });
    $('#f-ps', sh).addEventListener('input', info);
    amt.addEventListener('input', info);
    info(); showSubs();
    if (isNew) setTimeout(() => amt.focus(), 300);

    $('#f-save', sh).addEventListener('click', async () => {
      const a = r2(amt.value.replace(',', '.'));
      const err = (m) => { $('#f-err', sh).textContent = m; };
      if (!(a > 0)) return err('Enter an amount above zero.');
      if (!title.value.trim()) return err('Give the expense a name.');
      if (!f.category_id) return err('Pick a category.');
      let gs, ps;
      if (f.split === 'equal') { gs = r2(a / 2); ps = r2(a - gs); }
      else if (f.split === 'Paul') { gs = 0; ps = a; }
      else if (f.split === 'Grace') { gs = a; ps = 0; }
      else { gs = r2($('#f-gs', sh).value.replace(',', '.')); ps = r2($('#f-ps', sh).value.replace(',', '.')); if (Math.abs(gs + ps - a) > .011) return err('Grace’s and Paul’s parts must add up to ' + money(a) + '.'); }
      const payload = {amount: a, title: title.value.trim(), category_id: f.category_id, paid_by: f.paid_by, grace_share: gs, paul_share: ps, date: $('#f-date', sh).value || todayISO(), note: $('#f-note', sh).value.trim(), sub: $('#f-sub', sh).value.trim()};
      if (!isNew) payload.id = e.id;
      const btn = $('#f-save', sh); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
      try {
        await mutate(isNew ? 'addExpense' : 'updateExpense', payload);
        S.month = payload.date.slice(0, 7);
        closeSheet(); toast(isNew ? 'Expense added' : 'Changes saved'); render();
      } catch (x) { btn.disabled = false; btn.textContent = isNew ? 'Add expense' : 'Save changes'; err(x.message); }
    });
    sh.dataset.id = e ? e.id : '';
  }

  function settleSheet(existing) {
    const bal = D.balance;
    const from = existing ? existing.paid_by : bal > 0 ? 'Grace' : 'Paul';
    const sh = openSheet(`${head(existing ? 'Payment' : 'Settle up')}
      ${existing ? `<p class="sub">${esc(existing.paid_by)} paid ${esc(other(existing.paid_by))} ${money(existing.amount)} on ${dayLabel(existing.date)}.</p>
        <div class="actions"><button class="btn danger" data-act="delexp">Delete payment</button><button class="btn ghost" data-act="close">Keep</button></div>`
      : `<p style="color:var(--muted);margin:0 0 14px">${owesText(bal)} <b class="num" style="color:var(--ink)">${money(Math.abs(bal))}</b>. Record a payment when money changes hands; it brings the balance down without counting as spending.</p>
      <div class="lbl"><span>Who is paying?</span></div>
      <div class="seg" id="s-from">${['Grace', 'Paul'].map((p) => `<button type="button" data-v="${p}" class="${p} ${from === p ? 'on' : ''}">${p} pays ${other(p)}</button>`).join('')}</div>
      <div class="amount"><span>$</span><input id="s-amt" inputmode="decimal" value="${r2(Math.abs(bal))}" aria-label="Amount"></div>
      <div class="field"><label for="s-date">Date</label><input id="s-date" type="date" value="${todayISO()}"></div>
      <div class="err" id="s-err"></div>
      <div class="actions"><button class="btn" id="s-save">Record payment</button></div>`}`);
    if (existing) { sh.dataset.id = existing.id; return; }
    let who = from;
    $('#s-from', sh).addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { who = b.dataset.v; sh.querySelectorAll('#s-from button').forEach((x) => x.classList.toggle('on', x === b)); } });
    $('#s-save', sh).addEventListener('click', async () => {
      const a = r2($('#s-amt', sh).value.replace(',', '.'));
      if (!(a > 0)) { $('#s-err', sh).textContent = 'Enter an amount above zero.'; return; }
      try { await mutate('addPayment', {from: who, to: other(who), amount: a, date: $('#s-date', sh).value || todayISO()}); closeSheet(); toast('Payment recorded'); render(); }
      catch (x) { $('#s-err', sh).textContent = x.message; }
    });
  }

  function categorySheet(cid, month, sel, initSub) {
    const c = cat(cid);
    let scope = sel ? 'sel' : month || S.month;
    const inScope = (m) => scope === 'all' || (scope === 'sel' ? sel.includes(m) : m === scope);
    // Months offered: the compared months, or every month with expenses (newest last)
    const ms = sel ? sel.slice().sort() : D.months.filter((m) => D.byMonth[m].count);
    let subF = initSub === undefined ? null : initSub, picking = false; const picked = new Set();
    const draw = (sh) => {
      const all = S.data.expenses.filter((e) => e.category_id === cid && e.type !== 'payment' && inScope(e.month || e.date.slice(0, 7))).sort((a, b) => b.date.localeCompare(a.date));
      const subT = {};
      all.forEach((e) => { const k = e.sub || ''; subT[k] = (subT[k] || 0) + e.amount; });
      const subRows = Object.entries(subT).sort((a, b) => (a[0] === '') - (b[0] === '') || b[1] - a[1]);
      const hasSubs = subRows.some(([k]) => k);
      const es = subF === null ? all : all.filter((e) => (e.sub || '') === subF);
      const tot = es.reduce((s, e) => s + e.amount, 0), g = es.reduce((s, e) => s + e.grace_share, 0), p = es.reduce((s, e) => s + e.paul_share, 0);
      const chartMs = ms.slice(-6);
      const mx = Math.max(1, ...chartMs.map((m) => (D.byMonth[m].cats[cid] || {}).total || 0));
      const label = scope === 'all' ? 'All time' : scope === 'sel' ? (sel.length > 1 ? mShort(sel[0]) + '–' + mShort(sel[sel.length - 1]) : mLong(sel[0])) : mLong(scope);
      const chip = (val, text) => `<button class="chip ${scope === val ? 'on' : ''}" data-scope="${val}">${text}</button>`;
      $('#c-body', sh).innerHTML = `
        <div class="chips">
          ${sel && sel.length > 1 ? chip('sel', mShort(sel[0]) + '–' + mShort(sel[sel.length - 1])) : ''}
          ${ms.slice().reverse().map((m) => chip(m, mShort(m) + ' ' + m.slice(2, 4))).join('')}
          ${chip('all', 'All time')}
        </div>
        <div class="hero" style="margin:4px 2px 12px"><div class="cap">${label}</div><div class="big num" style="font-size:40px">${money(tot)}</div><div class="delta num">${es.length} expense${es.length === 1 ? '' : 's'} · Grace ${money(g)} · Paul ${money(p)}</div></div>
        <svg class="chart" viewBox="0 0 340 90" role="img" aria-label="${esc(c.name)} by month; tap a month to see it">${chartMs.map((m, i) => {
          const v = (D.byMonth[m].cats[cid] || {}).total || 0, bw = 340 / chartMs.length, h = v / mx * 54;
          return `<g class="hit" data-scope="${m}"><rect x="${i * bw}" y="0" width="${bw}" height="90" fill="transparent"/><rect x="${i * bw + bw * .2}" y="${68 - h}" width="${bw * .6}" height="${Math.max(h, 1)}" rx="3" fill="${c.color}" opacity="${inScope(m) ? 1 : .35}"/><text x="${i * bw + bw / 2}" y="${63 - h}" text-anchor="middle" class="${m === scope ? 'val' : ''}">${v ? moneyShort(v) : ''}</text><text x="${i * bw + bw / 2}" y="85" text-anchor="middle" class="${m === scope ? 'val' : ''}">${mShort(m)}</text></g>`;
        }).join('')}</svg>
        ${hasSubs ? `<div class="lbl"><span>By subcategory</span>${subF !== null ? '<button class="linkbtn" data-subf="__all">Show all</button>' : ''}</div>
        <div class="subs">${subRows.map(([k, v]) => `<button class="subrow ${subF === k ? 'on' : ''}" data-subf="${esc(k)}"><span class="sn">${k ? esc(k) : 'No subcategory'}</span><span class="sb"><i style="width:${(v / subRows.reduce((m, r) => Math.max(m, r[1]), 1) * 100).toFixed(1)}%;background:${c.color}"></i></span><span class="num">${money(v)}</span></button>`).join('')}</div>` : ''}
        <div class="lbl"><span>${es.length} expense${es.length === 1 ? '' : 's'}${subF !== null ? ' · ' + (subF ? esc(subF) : 'no subcategory') : ''}</span>${picking ? `<button class="linkbtn" data-pickall="1">Select all ${es.length}</button>` : '<button class="linkbtn" data-pick="1">Select</button>'}</div>
        <div class="group">${es.map((e) => picking ? pickRow(e, picked.has(e.id)) : xrow(e)).join('') || '<div class="empty" style="background:var(--surface)">Nothing in this category for this period.</div>'}</div>
        ${picking ? dockHtml(picked) : ''}`;
      if (picking) updateDock(picked, $('.pickdock', sh));
      const on = $('#c-body .chip.on', sh); if (on && first) { on.parentElement.scrollLeft = Math.max(0, on.offsetLeft - 24); first = false; }
    };
    let first = true;
    const redraw = () => { const st = sh.scrollTop; draw(sh); sh.scrollTop = st; };
    const sh = openSheet(`${head(`${c.emoji} ${esc(c.name)}`)}<div id="c-body"></div>`);
    sh.classList.add('tall');
    draw(sh);
    sh.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-scope],[data-subf],[data-pick],[data-pickid],[data-pickall],[data-pickcancel],[data-move]'); if (!b) return;
      if (b.dataset.pickid) return togglePick(picked, b, $('.pickdock', sh));
      if (b.dataset.move) { const ids = [...picked]; return moveSheet(ids, null); }
      if (b.dataset.pickall) { sh.querySelectorAll('[data-pickid]').forEach((r) => { picked.add(r.dataset.pickid); r.classList.add('sel'); }); return updateDock(picked, $('.pickdock', sh)); }
      if (b.dataset.scope) { scope = b.dataset.scope; subF = null; }
      else if (b.dataset.subf !== undefined) subF = b.dataset.subf === '__all' || subF === b.dataset.subf ? null : b.dataset.subf;
      else if (b.dataset.pick) { picking = true; picked.clear(); }
      else if (b.dataset.pickcancel) { picking = false; picked.clear(); }
      redraw();
    });
  }

  const EMOJIS = ['🛒', '🍽️', '⛽', '🏠', '✈️', '⚖️', '🛋️', '🤝', '💆', '🧸', '🚗', '🩺', '🧴', '🧹', '⚡', '🎁', '💡', '👕', '📱', '📦', '🎬', '🔁', '📚', '🏷️', '☕', '🍷', '🐾', '💊', '🏋️', '🎓', '🧾', '💳', '🌿', '🛠️', '🎉', '👶'];
  const COLORS = ['#2F5D50', '#7A5BA8', '#D9982A', '#5B8C6B', '#C97B3D', '#3F8C9A', '#9A4F4F', '#6B7A3D', '#B08A3D', '#8C5B7A', '#A8704F', '#8A8F98'];

  function catEditor(c) {
    const isNew = !c;
    const f = c ? {...c} : {name: '', emoji: '🏷️', color: COLORS[0]};
    const others = activeCats().filter((x) => !c || x.id !== c.id);
    const sh = openSheet(`${head(isNew ? 'New category' : 'Edit category')}
      <div class="field"><label for="k-name">Name</label><input id="k-name" value="${esc(f.name)}" placeholder="e.g. Pets"></div>
      ${isNew ? '' : `<p class="sub" style="margin:-4px 4px 12px">Renaming updates all ${D.usage[c.id] || 0} past expenses automatically.</p>`}
      <div class="lbl"><span>Icon</span></div>
      <div class="emoji-pick" id="k-emo">${EMOJIS.map((e) => `<button type="button" class="${e === f.emoji ? 'on' : ''}">${e}</button>`).join('')}</div>
      <div class="lbl"><span>Colour</span></div>
      <div class="swatches" id="k-col">${COLORS.map((x) => `<button type="button" data-c="${x}" class="${x === f.color ? 'on' : ''}" style="background:${x}" aria-label="Colour ${x}"></button>`).join('')}</div>
      <div class="err" id="k-err"></div>
      <div class="actions"><button class="btn" id="k-save">${isNew ? 'Add category' : 'Save'}</button></div>
      ${isNew || !subsOf(c.id).length ? '' : `<div class="section-t">Subcategories · rename one and its past expenses follow</div>
        <div class="list">${subsOf(c.id).map((s) => `<div><input class="subname" data-old="${esc(s.sub)}" value="${esc(s.sub)}" aria-label="Subcategory name"><small style="color:var(--muted)">${s.n}</small><button class="btn ghost" data-rensub="${esc(s.sub)}">Rename</button></div>`).join('')}</div>`}
      ${isNew ? '' : `<div class="section-t">Merge into another category</div>
        <p class="sub" style="margin:0 4px 10px">Moves every ${esc(c.name)} expense into the one you pick, then removes ${esc(c.name)}.</p>
        <div class="field"><select id="k-merge"><option value="">Choose a category…</option>${others.map((o) => `<option value="${o.id}">${o.emoji} ${esc(o.name)}</option>`).join('')}</select></div>
        <div class="actions"><button class="btn ghost" id="k-merge-go">Merge</button></div>`}`);
    $('#k-emo', sh).addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { f.emoji = b.textContent; sh.querySelectorAll('#k-emo button').forEach((x) => x.classList.toggle('on', x === b)); } });
    $('#k-col', sh).addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { f.color = b.dataset.c; sh.querySelectorAll('#k-col button').forEach((x) => x.classList.toggle('on', x === b)); } });
    $('#k-save', sh).addEventListener('click', async () => {
      const name = $('#k-name', sh).value.trim();
      if (!name) { $('#k-err', sh).textContent = 'Give the category a name.'; return; }
      try { await mutate(isNew ? 'addCategory' : 'updateCategory', isNew ? {name, emoji: f.emoji, color: f.color} : {id: c.id, name, emoji: f.emoji, color: f.color}); closeSheet(); toast(isNew ? 'Category added' : 'Category saved'); render(); }
      catch (x) { $('#k-err', sh).textContent = x.message; }
    });
    sh.querySelectorAll('[data-rensub]').forEach((btn) => btn.addEventListener('click', async () => {
      const from = btn.dataset.rensub, inp = [...sh.querySelectorAll('.subname')].find((x) => x.dataset.old === from), to = inp.value.trim();
      if (to === from) return;
      try { const r = await mutate('renameSub', {category_id: c.id, from, to}); toast(to ? `Renamed · ${moved(r).replace('moved', 'updated')}` : 'Subcategory removed'); closeSheet(); render(); }
      catch (x) { $('#k-err', sh).textContent = x.message; }
    }));
    const mg = $('#k-merge-go', sh);
    if (mg) mg.addEventListener('click', async () => {
      const to = $('#k-merge', sh).value;
      if (!to) { $('#k-err', sh).textContent = 'Choose the category to merge into.'; return; }
      try { const r = await mutate('mergeCategory', {from: c.id, to}); closeSheet(); toast(`Merged · ${moved(r)}`); render(); }
      catch (x) { $('#k-err', sh).textContent = x.message; }
    });
  }

  function ruleEditor() {
    const cats = activeCats();
    let cid = '';
    const sh = openSheet(`${head('New rule')}
      <p class="sub" style="margin:0 4px 12px">Any expense whose name contains these words goes to the category you pick. New expenses get it automatically.</p>
      <div class="field"><label for="u-match">Name contains</label><input id="u-match" placeholder="e.g. Spinneys" autocomplete="off"></div>
      <div class="lbl"><span>Category</span><span id="u-count"></span></div>
      <div class="catgrid" id="u-cats">${cats.map((c) => `<button type="button" data-cat="${c.id}"><span class="e">${c.emoji}</span><span>${esc(c.name)}</span></button>`).join('')}</div>
      <div class="err" id="u-err"></div>
      <div class="actions"><button class="btn ghost" id="u-save">Save for new only</button><button class="btn" id="u-apply">Save and apply to past</button></div>`);
    const count = () => {
      const q = $('#u-match', sh).value.trim().toLowerCase();
      const n = q ? S.data.expenses.filter((e) => e.type !== 'payment' && e.title.toLowerCase().includes(q) && e.category_id !== cid).length : 0;
      $('#u-count', sh).textContent = q ? `${n} past expense${n === 1 ? '' : 's'} would move` : '';
    };
    $('#u-match', sh).addEventListener('input', count);
    $('#u-cats', sh).addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { cid = b.dataset.cat; sh.querySelectorAll('#u-cats button').forEach((x) => x.classList.toggle('on', x === b)); count(); } });
    const save = async (apply) => {
      const match = $('#u-match', sh).value.trim();
      if (!match || !cid) { $('#u-err', sh).textContent = 'Type a word to match and pick a category.'; return; }
      try { const r = await mutate('addRule', {match, category_id: cid, apply}); closeSheet(); toast(apply ? `Rule saved · ${moved(r)}` : 'Rule saved'); render(); }
      catch (x) { $('#u-err', sh).textContent = x.message; }
    };
    $('#u-save', sh).addEventListener('click', () => save(false));
    $('#u-apply', sh).addEventListener('click', () => save(true));
  }

  // ----- multi-select: move expenses to a category and/or subcategory -----
  const pickRow = (e, on) => { const c = cat(e.category_id); return `<button class="xrow pick ${on ? 'sel' : ''}" data-pickid="${esc(e.id)}" aria-pressed="${on}"><span class="ico chk" aria-hidden="true"></span><span style="min-width:0"><div class="t">${esc(e.title)}</div><div class="m"><span class="when">${dayLabel(e.date)}</span><span>${c.emoji} ${catLabel(e)}</span></div></span><span><div class="a num">${money(e.amount)}</div></span></button>`; };
  // Toggle one row in place, so the screen never jumps.
  function togglePick(set, btn, dock) {
    const id = btn.dataset.pickid;
    set.has(id) ? set.delete(id) : set.add(id);
    btn.classList.toggle('sel', set.has(id)); btn.setAttribute('aria-pressed', String(set.has(id)));
    updateDock(set, dock);
  }
  function updateDock(set, dock) {
    if (!dock) return;
    const sum = S.data.expenses.filter((e) => set.has(e.id)).reduce((s, e) => s + e.amount, 0);
    dock.querySelector('.dn').textContent = set.size ? `${set.size} selected · ${money(sum)}` : 'Tap expenses to select them';
    dock.querySelector('[data-move]').disabled = !set.size;
  }
  const dockHtml = (set) => `<div class="pickdock"><span class="dn">${set.size ? set.size + ' selected' : 'Tap expenses to select them'}</span><button class="btn ghost" data-pickcancel="1">Cancel</button><button class="btn" data-move="1" ${set.size ? '' : 'disabled'}>Move or group</button></div>`;

  function moveSheet(ids, done) {
    const es = S.data.expenses.filter((e) => ids.includes(e.id));
    const curCats = [...new Set(es.map((e) => e.category_id))];
    let target = '';
    const cats = activeCats();
    const sh = openSheet(`${head(`Move ${es.length} expense${es.length === 1 ? '' : 's'}`)}
      <p class="sub" style="margin:0 4px 12px">Currently in ${curCats.length === 1 ? cat(curCats[0]).emoji + ' ' + esc(cat(curCats[0]).name) : curCats.length + ' categories'} · ${money(es.reduce((s, e) => s + e.amount, 0))}</p>
      <div class="lbl"><span>Category</span></div>
      <div class="catgrid more-hidden" id="m-cats"><button type="button" data-cat="" class="on"><span class="e">↩︎</span><span>Keep as is</span></button>${cats.map((c, i) => `<button type="button" data-cat="${c.id}" class="${i >= 11 ? 'extra' : ''}"><span class="e">${c.emoji}</span><span>${esc(c.name)}</span></button>`).join('')}</div>
      ${cats.length > 11 ? `<button type="button" class="morecats" id="m-more">Show all ${cats.length} categories</button>` : ''}
      <div class="lbl"><span>Subcategory</span></div>
      <div class="field"><input id="m-sub" placeholder="e.g. Zanzibar — leave empty for none" autocomplete="off" aria-label="Subcategory"></div>
      <div class="sugg" id="m-subs"></div>
      <div class="err" id="m-err"></div>
      <div class="actions"><button class="btn" id="m-go">Apply to ${es.length}</button></div>`);
    sh.classList.add('tall');
    const subs = () => {
      const pool = target ? [target] : curCats;
      const n = {}; pool.forEach((cid) => subsOf(cid).forEach((s) => { n[s.sub] = (n[s.sub] || 0) + s.n; }));
      $('#m-subs', sh).innerHTML = Object.entries(n).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([s]) => `<button type="button" data-sub="${esc(s)}">${esc(s)}</button>`).join('');
    };
    subs();
    const mm = $('#m-more', sh); if (mm) mm.addEventListener('click', () => { $('#m-cats', sh).classList.remove('more-hidden'); mm.remove(); });
    $('#m-cats', sh).addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; target = b.dataset.cat; sh.querySelectorAll('#m-cats button').forEach((x) => x.classList.toggle('on', x === b)); subs(); });
    $('#m-subs', sh).addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) $('#m-sub', sh).value = b.dataset.sub; });
    $('#m-go', sh).addEventListener('click', async () => {
      const sub = $('#m-sub', sh).value.trim();
      const payload = {ids, sub};
      if (target) payload.category_id = target;
      const btn = $('#m-go', sh); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
      try {
        await mutate('bulkUpdate', payload);
        closeSheet();
        toast(target ? `${ids.length} moved to ${cat(target).name}${sub ? ' › ' + sub : ''}` : sub ? `${ids.length} grouped under ${sub}` : `Subcategory removed from ${ids.length}`);
        if (done) done();
        render();
      } catch (x) { btn.disabled = false; btn.textContent = `Apply to ${es.length}`; $('#m-err', sh).textContent = x.message; }
    });
  }

  function searchSheet() {
    const sh = openSheet(`${head('Search')}<label class="search">${I.search}<input type="search" id="q-in" placeholder="Name, category, note, amount or date" autocomplete="off" aria-label="Search all expenses"></label><div id="q-out"></div>`);
    sh.classList.add('tall');
    const inp = $('#q-in', sh), out = $('#q-out', sh);
    const run = () => {
      const q = inp.value.trim().toLowerCase();
      if (!q) { out.innerHTML = '<div class="empty">Type a word or amount. Searches every month.</div>'; return; }
      const hits = S.data.expenses.filter((e) => matches(e, q)).sort((a, b) => b.date.localeCompare(a.date));
      const tot = hits.filter((e) => e.type !== 'payment').reduce((s, e) => s + e.amount, 0);
      // Categories and subcategories whose name matches, with their all-time totals
      const spend = S.data.expenses.filter((e) => e.type !== 'payment');
      const catHits = S.data.categories.filter((c) => !c.archived && c.name.toLowerCase().includes(q)).map((c) => {
        const es = spend.filter((e) => e.category_id === c.id); return {c, n: es.length, t: es.reduce((s, e) => s + e.amount, 0)};
      }).filter((x) => x.n).sort((a, b) => b.t - a.t);
      const subMap = {};
      spend.forEach((e) => { if (e.sub && e.sub.toLowerCase().includes(q)) { const k = e.category_id + '|' + e.sub; const m = subMap[k] || (subMap[k] = {cid: e.category_id, sub: e.sub, n: 0, t: 0}); m.n++; m.t += e.amount; } });
      const subHits = Object.values(subMap).sort((a, b) => b.t - a.t);
      const groupRows = [
        ...catHits.map((x) => `<button class="xrow" data-act="cat" data-cat="${esc(x.c.id)}" data-m="all"><span class="ico" style="background:${tint(x.c.color, .16)}">${x.c.emoji}</span><span style="min-width:0"><div class="t">${esc(x.c.name)}</div><div class="m"><span>Category · ${x.n} expense${x.n === 1 ? '' : 's'}</span></div></span><span><div class="a num">${money(x.t)}</div><div class="s">all time ›</div></span></button>`),
        ...subHits.map((x) => { const c = cat(x.cid); return `<button class="xrow" data-act="cat" data-cat="${esc(x.cid)}" data-m="all" data-sub="${esc(x.sub)}"><span class="ico" style="background:${tint(c.color, .16)}">${c.emoji}</span><span style="min-width:0"><div class="t">${esc(x.sub)}</div><div class="m"><span>Subcategory of ${esc(c.name)} · ${x.n}</span></div></span><span><div class="a num">${money(x.t)}</div><div class="s">all time ›</div></span></button>`; }),
      ];
      const groupsHtml = groupRows.length ? `<div class="day"><span>Categories</span></div><div class="group">${groupRows.join('')}</div>` : '';
      out.innerHTML = (hits.length || groupRows.length) ? `${groupsHtml}${hits.length ? `<div class="day"><span>${hits.length} expense${hits.length === 1 ? '' : 's'}</span><span class="num">${money(tot)}</span></div>` : ''}<div class="group">${hits.slice(0, 200).map((e) => xrow(e).replace('<div class="m">', `<div class="m"><span class="when">${dayLabel(e.date)}${e.date.slice(0, 4) !== todayISO().slice(0, 4) ? ' ' + e.date.slice(0, 4) : ''}</span>`)).join('')}</div>`
        : `<div class="empty"><b>Nothing matches “${esc(inp.value.trim())}”</b>Try part of the name, e.g. “spinn”.</div>`;
    };
    inp.addEventListener('input', run); run();
    setTimeout(() => inp.focus(), 250);
  }

  function monthPicker() {
    const ms = [...D.months].reverse();
    openSheet(`${head('Choose a month')}<div class="list">${ms.map((m) => `<button data-act="setmonth" data-m="${m}" data-close="1"><span class="grow">${mLong(m)}<small>${D.byMonth[m].count} expenses</small></span><span class="num">${money(D.byMonth[m].total)}</span></button>`).join('')}</div>`);
  }

  // ---------------- data flow ----------------
  async function mutate(action, payload) {
    const r = await api.post(action, payload);
    accept(r);
    return r;
  }
  function accept(r) {
    const {ok, info, ...data} = r;
    data.at = data.at || new Date().toISOString();
    S.data = data; LS.set('data', data);
  }
  async function refresh(quiet) {
    if (S.busy) return;
    S.busy = true; if (!quiet) render();
    try { accept(await api.load()); }
    catch (x) { if (x.pin) { S.pin = ''; LS.del('pin'); } else toast(navigator.onLine ? x.message : 'You’re offline. Showing saved data.'); }
    S.busy = false; render();
  }
  function exportCSV() {
    const cols = ['date', 'title', 'category', 'amount', 'paid_by', 'grace_share', 'paul_share', 'type', 'note'];
    const rows = S.data.expenses.slice().sort((a, b) => a.date.localeCompare(b.date)).map((e) => cols.map((k) => k === 'category' ? (e.type === 'payment' ? 'Payment' : cat(e.category_id).name) : e[k]));
    const csv = [cols, ...rows].map((r) => r.map((v) => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'}));
    a.download = `house-expenses-${todayISO()}.csv`;
    document.body.append(a); a.click(); a.remove();
  }
  let toastT;
  function toast(msg) {
    let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------------- events ----------------
  document.addEventListener('click', async (ev) => {
    if (S.tab === 'list' && S.picking && !ev.target.closest('.sheet')) {
      const r = ev.target.closest('[data-pickid]'); if (r) return togglePick(S.picked, r, $('#app .pickdock'));
      if (ev.target.closest('[data-pickcancel]')) { S.picking = false; S.picked = new Set(); render(); return; }
      if (ev.target.closest('[data-move]')) return moveSheet([...S.picked], () => { S.picking = false; S.picked = new Set(); });
    }
    const el = ev.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act;
    if (a === 'close') return closeSheet();
    if (a === 'tab') { S.tab = el.dataset.tab; S.picking = false; S.picked = new Set(); render(); window.scrollTo(0, 0); return; }
    if (a === 'add') return expenseForm(null);
    if (a === 'month') { const i = D.months.indexOf(S.month) + (+el.dataset.d); if (D.months[i]) { S.month = D.months[i]; render(); } return; }
    if (a === 'pickmonth') return monthPicker();
    if (a === 'pickstart') { S.picking = true; S.picked = new Set(); render(); return; }
    if (a === 'pickall') { document.querySelectorAll('#app [data-pickid]').forEach((r) => { S.picked.add(r.dataset.pickid); r.classList.add('sel'); }); updateDock(S.picked, $('#app .pickdock')); return; }
    if (a === 'search') return searchSheet();
    if (a === 'hmode') { S.hmode = el.dataset.v; render(); return; }
    if (a === 'cmp') { const m = el.dataset.m; S.cmp = S.cmp.includes(m) ? S.cmp.filter((x) => x !== m) : [...S.cmp, m]; render(); return; }
    if (a === 'openmonth') { S.month = el.dataset.m; S.hmode = 'month'; render(); window.scrollTo(0, 0); return; }
    if (a === 'setmonth') { S.month = el.dataset.m; if (el.dataset.close) closeSheet(); render(); return; }
    if (a === 'cat') return categorySheet(el.dataset.cat, el.dataset.m, el.dataset.ms ? el.dataset.ms.split(',') : null, el.dataset.sub);
    if (a === 'edit') { closeSheet(true); return expenseForm(S.data.expenses.find((x) => x.id === el.dataset.id)); }
    if (a === 'editpay') { closeSheet(true); return settleSheet(S.data.expenses.find((x) => x.id === el.dataset.id)); }
    if (a === 'settle') return settleSheet(null);
    if (a === 'delexp') {
      const sh = $('.sheet'); const id = sh && sh.dataset.id;
      if (!id) return;
      if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Tap again to delete'; return; }
      try { await mutate('deleteExpense', {id}); closeSheet(); toast('Deleted'); render(); } catch (x) { toast(x.message); }
      return;
    }
    if (a === 'xmonth') { S.xMonth = el.dataset.v; render(); return; }
    if (a === 'xcat') { S.xCat = el.dataset.v; render(); return; }
    if (a === 'xwho') { S.xWho = S.xWho === el.dataset.v ? '' : el.dataset.v; render(); return; }
    if (a === 'setme') { S.me = el.dataset.v; LS.set('me', S.me); render(); return; }
    if (a === 'editcat') return catEditor(S.data.categories.find((c) => c.id === el.dataset.id));
    if (a === 'newcat') return catEditor(null);
    if (a === 'newrule') return ruleEditor();
    if (a === 'applyrule') { try { const r = await mutate('applyRule', {id: el.dataset.id}); toast(moved(r)); render(); } catch (x) { toast(x.message); } return; }
    if (a === 'delrule') { try { await mutate('deleteRule', {id: el.dataset.id}); toast('Rule removed'); render(); } catch (x) { toast(x.message); } return; }
    if (a === 'export') return exportCSV();
    if (a === 'refresh') return refresh();
    if (a === 'logout') { LS.del('pin'); LS.del('data'); S.pin = ''; S.data = null; render(); return; }
    if (a === 'pickme') { S.me = el.dataset.v; document.querySelectorAll('[data-act="pickme"]').forEach((b) => b.classList.toggle('on', b === el)); return; }
    if (a === 'login') {
      const pin = $('#pin').value.trim();
      const err = $('#err');
      if (!pin) { err.textContent = 'Enter the PIN.'; return; }
      if (!S.me) { err.textContent = 'Choose who is using this phone.'; return; }
      el.disabled = true; el.innerHTML = '<span class="spin"></span>';
      S.pin = pin;
      try { accept(await api.load()); LS.set('pin', pin); LS.set('me', S.me); S.tab = 'home'; render(); }
      catch (x) { S.pin = ''; el.disabled = false; el.textContent = 'Open the house book'; err.textContent = x.pin ? 'That PIN didn’t work. Check the Settings tab of your Google Sheet.' : 'Couldn’t reach the Google Sheet. Check your connection and try again.'; }
    }
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.dataset.input === 'xq') {
      S.xq = ev.target.value;
      const pos = ev.target.selectionStart;
      render();
      const inp = $('[data-input="xq"]'); inp.focus(); inp.setSelectionRange(pos, pos);
    }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeSheet(); });
  document.addEventListener('click', (ev) => { if (ev.target.closest('.sync')) refresh(); });
  // pull to refresh
  let y0 = null;
  window.addEventListener('touchstart', (e) => { y0 = window.scrollY === 0 && !$('.sheet') ? e.touches[0].clientY : null; }, {passive: true});
  window.addEventListener('touchend', (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 90) refresh(); y0 = null; }, {passive: true});
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.pin && S.data) refresh(true); });

  // ---------------- start ----------------
  render();
  if (S.pin && S.me) refresh(!!S.data);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();

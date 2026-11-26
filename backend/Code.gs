/**
 * Our lovely house — expense app backend.
 * Lives inside the Google Sheet (Extensions → Apps Script). The app on your phones talks to it.
 * Tabs used: Expenses, Categories, Rules, Settings. The PIN is in Settings (key "pin").
 */

const SHEETS = {
  Expenses: ['id', 'date', 'month', 'title', 'amount', 'category_id', 'paid_by', 'grace_share', 'paul_share', 'type', 'note', 'created_by', 'created_at', 'sub'],
  Categories: ['id', 'name', 'emoji', 'color', 'sort', 'archived'],
  Rules: ['id', 'match', 'category_id', 'created_at'],
  Settings: ['key', 'value'],
};
// Your Google Sheet "Our lovely house — data". Lets this script work from script.google.com too.
const SHEET_ID = '102IwLdZnlvlh7bnN4YeMBDCjlX2KiZdHcovP9qdqKMU';
const NUMERIC = new Set(['amount', 'grace_share', 'paul_share', 'sort']);
const MAX_FAILS = 10; // wrong PINs allowed per 15 minutes

function doGet(e) {
  return handle_(() => {
    checkPin_(e.parameter.pin);
    return snapshot_();
  });
}

function doPost(e) {
  return handle_(() => {
    const body = JSON.parse(e.postData.contents || '{}');
    checkPin_(body.pin);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const result = ACTIONS[body.action];
      if (!result) throw new Error('Unknown action: ' + body.action);
      const info = result(body.payload || {}, body.user || '') || {};
      return Object.assign(snapshot_(), {info});
    } finally {
      lock.releaseLock();
    }
  });
}

const ACTIONS = {
  addExpense(p, user) {
    const row = cleanExpense_(p);
    row.id = 'e' + Utilities.getUuid().slice(0, 8);
    row.created_by = user;
    row.created_at = new Date().toISOString();
    append_('Expenses', row);
    return {id: row.id};
  },
  updateExpense(p) {
    const row = cleanExpense_(p);
    delete row.created_by; delete row.created_at;
    updateById_('Expenses', p.id, row);
  },
  deleteExpense(p) { deleteById_('Expenses', p.id); },
  addPayment(p, user) {
    // A settle-up: "from" pays "to". It moves the balance but is not spending.
    const amount = round_(p.amount);
    if (!(amount > 0)) throw new Error('Enter an amount above zero.');
    const date = p.date || today_();
    const id = 'p' + Utilities.getUuid().slice(0, 8);
    append_('Expenses', {
      id, date, month: date.slice(0, 7), title: p.title || ('Payment ' + p.from + ' → ' + p.to),
      amount, category_id: '', paid_by: p.from,
      grace_share: p.to === 'Grace' ? amount : 0, paul_share: p.to === 'Paul' ? amount : 0,
      type: 'payment', note: p.note || '', created_by: user, created_at: new Date().toISOString(),
    });
    return {id};
  },
  addCategory(p) {
    const name = String(p.name || '').trim();
    if (!name) throw new Error('Give the category a name.');
    const cats = read_('Categories');
    if (cats.some((c) => c.name.toLowerCase() === name.toLowerCase() && !c.archived)) throw new Error('A category with that name already exists.');
    const id = 'c' + Utilities.getUuid().slice(0, 6);
    append_('Categories', {id, name, emoji: p.emoji || '🏷️', color: p.color || '#8A8F98', sort: cats.length + 1, archived: false});
    return {id};
  },
  updateCategory(p) {
    const fields = {};
    ['name', 'emoji', 'color', 'sort', 'archived'].forEach((k) => { if (p[k] !== undefined) fields[k] = p[k]; });
    updateById_('Categories', p.id, fields);
  },
  mergeCategory(p) {
    if (!p.from || !p.to || p.from === p.to) throw new Error('Pick two different categories.');
    const n = setWhere_('Expenses', (r) => r.category_id === p.from, {category_id: p.to});
    updateById_('Categories', p.from, {archived: true});
    return {changed: n};
  },
  addRule(p) {
    const match = String(p.match || '').trim();
    if (!match || !p.category_id) throw new Error('A rule needs a word to match and a category.');
    const id = 'r' + Utilities.getUuid().slice(0, 6);
    append_('Rules', {id, match, category_id: p.category_id, created_at: new Date().toISOString()});
    const n = p.apply ? applyRule_(match, p.category_id) : 0;
    return {id, changed: n};
  },
  applyRule(p) {
    const rule = read_('Rules').find((r) => r.id === p.id);
    if (!rule) throw new Error('That rule no longer exists.');
    return {changed: applyRule_(rule.match, rule.category_id)};
  },
  deleteRule(p) { deleteById_('Rules', p.id); },
  setSub(p) {
    // Put several expenses under one subcategory (empty text removes it)
    const ids = new Set((p.ids || []).map(String));
    if (!ids.size) throw new Error('Select at least one expense.');
    return {changed: setWhere_('Expenses', (r) => ids.has(r.id), {sub: String(p.sub || '').trim()})};
  },
  changePin(p) {
    // The current PIN was already checked; set the new one in the Settings tab
    const pin = String(p.pin || '').trim();
    if (!/^[0-9]{4,8}$/.test(pin)) throw new Error('The PIN must be 4 to 8 digits.');
    const rows = read_('Settings');
    const i = rows.findIndex((s) => s.key === 'pin');
    if (i < 0) throw new Error('No PIN row in Settings.');
    sheet_('Settings').getRange(i + 2, 2).setNumberFormat('@').setValue(pin);
  },
  bulkUpdate(p) {
    // Move several expenses at once: to another category and/or subcategory
    const ids = new Set((p.ids || []).map(String));
    if (!ids.size) throw new Error('Select at least one expense.');
    const fields = {};
    if (p.category_id) {
      if (!read_('Categories').some((c) => c.id === p.category_id)) throw new Error('That category no longer exists.');
      fields.category_id = p.category_id;
    }
    if (p.sub !== undefined) fields.sub = String(p.sub || '').trim();
    return {changed: setWhere_('Expenses', (r) => ids.has(r.id) && r.type !== 'payment', fields)};
  },
  renameSub(p) {
    if (!p.category_id || !p.from) throw new Error('Pick the subcategory to rename.');
    return {changed: setWhere_('Expenses', (r) => r.category_id === p.category_id && r.sub === p.from, {sub: String(p.to || '').trim()})};
  },
};

// ---------- helpers ----------

function handle_(fn) {
  let out;
  try { out = {ok: true, ...fn()}; } catch (err) { out = {ok: false, error: String(err.message || err)}; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function checkPin_(pin) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('fails') || 0);
  if (fails >= MAX_FAILS) throw new Error('Too many wrong PINs. Try again in 15 minutes.');
  const real = String((read_('Settings').find((s) => s.key === 'pin') || {}).value || '').trim();
  if (!real || String(pin || '').trim() !== real) {
    cache.put('fails', String(fails + 1), 900);
    throw new Error('Wrong PIN.');
  }
}

function snapshot_() {
  const settings = Object.fromEntries(read_('Settings').filter((s) => s.key !== 'pin').map((s) => [s.key, s.value]));
  return {
    expenses: read_('Expenses'),
    categories: read_('Categories'),
    rules: read_('Rules'),
    people: String(settings.people || 'Paul,Grace').split(',').map((s) => s.trim()),
    currency: settings.currency || 'USD',
    at: new Date().toISOString(),
  };
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(SHEETS[name]); }
  // Add any column the app needs that the tab doesn't have yet (e.g. "sub" for subcategories)
  const want = SHEETS[name];
  const have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
  want.forEach((h, i) => { if (have[i] !== h && have.indexOf(h) < 0) sh.getRange(1, i + 1).setValue(h); });
  return sh;
}

function read_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const head = values.shift().map(String);
  const tz = Session.getScriptTimeZone();
  return values.filter((r) => r.some((v) => v !== '')).map((r) => {
    const o = {};
    head.forEach((h, i) => {
      let v = r[i];
      if (v instanceof Date) v = Utilities.formatDate(v, tz, h === 'month' ? 'yyyy-MM' : (h === 'created_at' ? "yyyy-MM-dd'T'HH:mm:ss'Z'" : 'yyyy-MM-dd'));
      if (NUMERIC.has(h)) v = Number(v) || 0;
      else if (h === 'archived') v = v === true || String(v).toUpperCase() === 'TRUE';
      else v = v === null ? '' : String(v);
      o[h] = v;
    });
    return o;
  });
}

function rowOf_(name, obj) {
  return SHEETS[name].map((h) => (obj[h] === undefined ? '' : obj[h]));
}

function append_(name, obj) {
  const sh = sheet_(name);
  const row = rowOf_(name, obj);
  const r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row.map((v) => (typeof v === 'number' ? v : String(v)))]);
  SHEETS[name].forEach((h, i) => { if (NUMERIC.has(h)) sh.getRange(r, i + 1).setNumberFormat('0.00').setValue(Number(obj[h]) || 0); });
}

function findRow_(name, id) {
  const sh = sheet_(name);
  const ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues().map((r) => String(r[0]));
  const i = ids.indexOf(String(id));
  if (i < 0) throw new Error('Item not found. Pull to refresh and try again.');
  return i + 2;
}

function updateById_(name, id, fields) {
  const sh = sheet_(name);
  const r = findRow_(name, id);
  SHEETS[name].forEach((h, i) => {
    if (fields[h] === undefined || h === 'id') return;
    const cell = sh.getRange(r, i + 1);
    if (NUMERIC.has(h)) cell.setNumberFormat('0.00').setValue(Number(fields[h]) || 0);
    else cell.setNumberFormat('@').setValue(String(fields[h]));
  });
}

function deleteById_(name, id) {
  sheet_(name).deleteRow(findRow_(name, id));
}

function setWhere_(name, pred, fields) {
  const sh = sheet_(name);
  const rows = read_(name);
  let n = 0;
  rows.forEach((row, i) => {
    if (!pred(row)) return;
    SHEETS[name].forEach((h, j) => { if (fields[h] !== undefined) sh.getRange(i + 2, j + 1).setNumberFormat('@').setValue(String(fields[h])); });
    n++;
  });
  return n;
}

function applyRule_(match, categoryId) {
  const m = match.toLowerCase();
  return setWhere_('Expenses', (r) => r.type !== 'payment' && r.title.toLowerCase().includes(m) && r.category_id !== categoryId, {category_id: categoryId});
}

function cleanExpense_(p) {
  const amount = round_(p.amount);
  if (!(amount > 0)) throw new Error('Enter an amount above zero.');
  if (!String(p.title || '').trim()) throw new Error('Give the expense a name.');
  if (!p.category_id) throw new Error('Pick a category.');
  const gs = round_(p.grace_share), ps = round_(p.paul_share);
  if (Math.abs(gs + ps - amount) > 0.011) throw new Error('The split must add up to the amount.');
  const date = String(p.date || today_());
  return {
    date, month: p.month || date.slice(0, 7), title: String(p.title).trim(), amount, category_id: p.category_id,
    paid_by: p.paid_by, grace_share: gs, paul_share: ps, type: 'expense', note: p.note || '', sub: String(p.sub || '').trim(),
  };
}

function round_(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function today_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

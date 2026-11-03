// App databases (Phase D1). Every published app can have its own database:
// tables described in its data/schema.json, records kept in Grandpa AI's own
// Postgres, fully separate per app, checked against the design on every save,
// and within fair limits. Nothing outside is paid for or called.
import crypto from 'node:crypto';
import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { postgresPoolOptions } from './postgres-options.js';
import { postgresTransaction } from './postgres-transaction.js';
import { governanceScope } from './governance-postgres.js';

export const LIMITS = Object.freeze({ records: 20_000, bytes: 25 * 1024 * 1024, writesPerDay: 3_000 });
export const TYPES = ['text', 'longtext', 'number', 'integer', 'money', 'boolean', 'date', 'datetime', 'time', 'choice', 'email', 'phone', 'url', 'image', 'file', 'autonumber', 'link'];
export const FILE_ID = /^f_[A-Za-z0-9_-]{24}$/;
export const ACCESS = ['team', 'public-read', 'public-add', 'public'];
const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const RESERVED = new Set(['id', 'created', 'updated']);
const RECORD_BYTES = 20_000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** The app's data design, checked and made regular. Throws a clear message for the builder or the owner. */
export function checkSchema(input) {
  const raw = typeof input === 'string' ? (() => { try { return JSON.parse(input); } catch { throw fail('data/schema.json is not valid JSON.'); } })() : input;
  if (!raw || typeof raw !== 'object' || !raw.tables || typeof raw.tables !== 'object' || Array.isArray(raw.tables)) throw fail('data/schema.json needs "tables": { "name": { "fields": { … } } }.');
  const names = Object.keys(raw.tables);
  if (!names.length || names.length > 20) throw fail('An app database has 1 to 20 tables.');
  const accounts = checkAccounts(raw.accounts);
  const tables = {};
  for (const name of names) {
    if (!NAME.test(name)) throw fail(`Table name "${String(name).slice(0, 40)}": use lower-case letters, digits and _ (start with a letter).`);
    const t = raw.tables[name] || {};
    const access = t.access || 'team';
    if (!ACCESS.includes(access)) throw fail(`Table ${name}: access must be one of ${ACCESS.join(', ')}.`);
    const fieldNames = Object.keys(t.fields || {});
    if (!fieldNames.length || fieldNames.length > 40) throw fail(`Table ${name} needs 1 to 40 fields.`);
    const fields = {};
    for (const f of fieldNames) {
      const d = typeof t.fields[f] === 'string' ? { type: t.fields[f] } : (t.fields[f] || {});
      if (!NAME.test(f) || RESERVED.has(f)) throw fail(`Table ${name}, field "${String(f).slice(0, 40)}": use lower-case letters, digits and _ (not id, created or updated, which every record has).`);
      if (!TYPES.includes(d.type)) throw fail(`Table ${name}, field ${f}: type must be one of ${TYPES.join(', ')}.`);
      const field = { type: d.type, required: Boolean(d.required), label: String(d.label || f.replace(/_/g, ' ')).slice(0, 60) };
      if (d.type === 'choice') {
        if (!Array.isArray(d.options) || !d.options.length || d.options.length > 50) throw fail(`Table ${name}, field ${f}: a choice needs 1 to 50 options.`);
        field.options = [...new Set(d.options.map((o) => String(o).slice(0, 60)))];
      }
      if (['number', 'integer', 'money'].includes(d.type)) for (const k of ['min', 'max']) if (d[k] != null) { if (!Number.isFinite(Number(d[k]))) throw fail(`Table ${name}, field ${f}: ${k} must be a number.`); field[k] = Number(d[k]); }
      if (['text', 'longtext'].includes(d.type)) field.max = Math.min(d.type === 'longtext' ? 10_000 : 500, Math.max(1, Number(d.max) || (d.type === 'longtext' ? 5_000 : 200)));
      if (d.type === 'autonumber') {
        field.prefix = String(d.prefix ?? '').slice(0, 10);
        if (!/^[A-Za-z0-9 #/_-]*$/.test(field.prefix)) throw fail(`Table ${name}, field ${f}: the prefix may use letters, digits, space, #, /, _ and -.`);
        field.digits = Math.min(9, Math.max(1, Math.floor(Number(d.digits) || 4)));
        field.start = Math.max(0, Math.floor(Number(d.start) || 1));
        field.required = false;
      }
      if (d.type === 'link') { if (typeof d.table !== 'string') throw fail(`Table ${name}, field ${f}: a link needs "table": the table it points to.`); field.table = d.table; }
      fields[f] = field;
    }
    tables[name] = { label: String(t.label || name.replace(/_/g, ' ')).slice(0, 60), access, fields, rules: checkRules(name, t.rules, access, accounts) };
  }
  checkFeatures(tables, raw, accounts);
  const alerts = checkAlerts(raw.alerts, tables, accounts);
  return { tables, ...(accounts ? { accounts } : {}), ...(alerts.length ? { alerts } : {}) };
}

// ---- Links, effects and alerts (Phase D3) ---------------------------------------------
/** Links point at real tables; effects ("a sale lowers the stock") are checked against the fields they use. */
function checkFeatures(tables, raw) {
  for (const [name, t] of Object.entries(tables)) {
    for (const [f, field] of Object.entries(t.fields)) if (field.type === 'link' && !tables[field.table]) throw fail(`Table ${name}, field ${f}: there is no table "${String(field.table).slice(0, 40)}" to link to.`);
    const effects = raw.tables[name].effects;
    if (effects == null) { t.effects = []; continue; }
    if (!Array.isArray(effects) || effects.length > 10) throw fail(`Table ${name}: effects must be a list of up to 10.`);
    t.effects = effects.map((e, i) => {
      const where = `Table ${name}, effect ${i + 1}`;
      const link = t.fields[e?.link];
      if (!link || link.type !== 'link') throw fail(`${where}: "link" must be one of this table's link fields.`);
      const target = tables[link.table], field = target.fields[e.field];
      if (!field || !numeric(field)) throw fail(`${where}: "field" must be a number field of ${link.table}.`);
      const m = /^([+-])\s*([a-z][a-z0-9_]{0,39}|\d+(?:\.\d+)?)$/.exec(String(e.change || ''));
      if (!m) throw fail(`${where}: "change" is + or - and a number field of this table, like "-qty", or a number, like "+1".`);
      if (/^[a-z]/.test(m[2]) && !numeric(t.fields[m[2]])) throw fail(`${where}: "${m[2]}" must be a number field of this table.`);
      return { link: e.link, table: link.table, field: e.field, sign: m[1] === '-' ? -1 : 1, by: /^[a-z]/.test(m[2]) ? m[2] : Number(m[2]) };
    });
  }
}
/** "alerts": [{ "table": "products", "on": "add" | "change" | "any", "when": { "stock": { "lte": 5 } }, "message": "Stock low: {name}", "for": ["staff"] }] */
function checkAlerts(input, tables, accounts) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 20) throw fail('alerts must be a list of up to 20.');
  return input.map((a, i) => {
    const where = `Alert ${i + 1}`;
    const table = tables[a?.table];
    if (!table) throw fail(`${where}: "table" must be one of the app's tables.`);
    const on = a.on || 'any';
    if (!['add', 'change', 'any'].includes(on)) throw fail(`${where}: "on" is add, change or any.`);
    const message = String(a.message || '').slice(0, 200);
    if (!message) throw fail(`${where} needs a "message", like "Stock low: {name}".`);
    for (const m of message.matchAll(/\{([a-z][a-z0-9_]*)\}/g)) if (!table.fields[m[1]] && m[1] !== 'by') throw fail(`${where}: {${m[1]}} is not a field of ${a.table}.`);
    const when = a.when == null ? null : cleanQuery(table, { where: a.when }).filters;
    const forWho = Array.isArray(a.for) && a.for.length ? a.for.map(String) : ['team'];
    for (const who of forWho) if (who !== 'team' && !(accounts && accounts.roles.includes(who))) throw fail(`${where}: "for" lists team or the app's roles.`);
    return { table: a.table, on, when, message, for: forWho };
  });
}
/** Does a record match an alert's conditions? */
export const recordMatches = (record, filters, table) => matches(record, filters || [], table, '');
/** The alert's message with the record's values filled in. */
export const fillMessage = (message, record, byName = '') => message.replace(/\{([a-z][a-z0-9_]*)\}/g, (_, k) => (k === 'by' ? byName : record[k] == null ? '' : String(record[k]))).slice(0, 240);

// ---- Accounts and rules (Phase D2) ----------------------------------------------------
export const RULE_WORDS = ['anyone', 'signed-in', 'team', 'own'];
const ACTIONS = ['read', 'add', 'change', 'remove'];
/** "accounts": { "signup": "open" | "invite" | "off", "roles": ["staff", "customer"], "defaultRole": "customer" } */
export function checkAccounts(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw fail('accounts must be { "signup": "open", "roles": [...], "defaultRole": "..." }.');
  const signup = input.signup || 'open';
  if (!['open', 'invite', 'off'].includes(signup)) throw fail('accounts.signup must be open, invite or off.');
  const roles = Array.isArray(input.roles) && input.roles.length ? [...new Set(input.roles.map(String))] : ['member'];
  if (roles.length > 10) throw fail('Use at most 10 roles.');
  for (const role of roles) if (!/^[a-z][a-z0-9_]{0,20}$/.test(role) || RULE_WORDS.includes(role) || role === 'owner') throw fail(`Role "${role.slice(0, 30)}": lower-case letters, digits and _ (not owner, anyone, signed-in, team or own; the app's owner is always allowed everything).`);
  const defaultRole = input.defaultRole || roles[roles.length - 1];
  if (!roles.includes(defaultRole)) throw fail('accounts.defaultRole must be one of the roles.');
  return { signup, roles, defaultRole };
}
/** Who may read, add, change and remove: lists of anyone, signed-in, team, own and role names. Without rules, the table's access says. */
function checkRules(table, input, access, accounts) {
  const from = { team: { read: ['team'], add: ['team'], change: ['team'], remove: ['team'] }, 'public-read': { read: ['anyone'], add: ['team'], change: ['team'], remove: ['team'] },
    'public-add': { read: ['team'], add: ['anyone'], change: ['team'], remove: ['team'] }, public: { read: ['anyone'], add: ['anyone'], change: ['anyone'], remove: ['anyone'] } }[access];
  if (input == null) return from;
  if (typeof input !== 'object' || Array.isArray(input)) throw fail(`Table ${table}: rules must be { "read": [...], "add": [...], "change": [...], "remove": [...] }.`);
  const out = {};
  for (const action of ACTIONS) {
    const list = input[action] == null ? ['team'] : Array.isArray(input[action]) ? input[action].map(String) : [String(input[action])];
    for (const who of list) {
      if (who === 'own' && action === 'add') throw fail(`Table ${table}: "own" cannot be used for add (a record is not anyone's until it is added).`);
      if (!RULE_WORDS.includes(who) && !(accounts && accounts.roles.includes(who))) throw fail(`Table ${table}, rule ${action}: "${who.slice(0, 30)}" is not ${accounts ? 'anyone, signed-in, team, own or a role' : 'anyone, signed-in, team or own (add "accounts" to use roles)'}.`);
      if (['signed-in', 'own'].includes(who) && !accounts) throw fail(`Table ${table}: "${who}" needs "accounts" in data/schema.json.`);
    }
    out[action] = [...new Set(list)];
  }
  return out;
}
/**
 * What this person may do: 'all', 'own' (only records they added) or 'none'.
 * who = { kind: 'owner' | 'team' | 'user' | 'visitor', role, id }.
 */
export function allowed(table, action, who) {
  if (who.kind === 'owner') return 'all';
  const list = table.rules[action] || [];
  if (list.includes('anyone')) return 'all';
  if (who.kind === 'team' && (list.includes('team') || list.includes('signed-in'))) return 'all';
  if (who.kind === 'user') {
    if (list.includes('signed-in') || list.includes(who.role)) return 'all';
    if (list.includes('own')) return 'own';
  }
  return 'none';
}

/** A record checked against its table: the cleaned values, or a clear message. `partial` is for updates. */
export function cleanRecord(table, input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Send the record as an object of field values.');
  const out = {};
  for (const key of Object.keys(input)) if (!table.fields[key] && !RESERVED.has(key)) throw fail(`There is no field "${String(key).slice(0, 40)}" in this table.`);
  for (const [name, f] of Object.entries(table.fields)) {
    if (f.type === 'autonumber') continue;   // the server numbers records itself
    if (!(name in input)) { if (f.required && !partial) throw fail(`${f.label} is required.`); continue; }
    let v = input[name];
    if (v === null || v === '' || v === undefined) { if (f.required) throw fail(`${f.label} is required.`); out[name] = null; continue; }
    const bad = (what) => fail(`${f.label}: ${what}.`);
    switch (f.type) {
      case 'text': case 'longtext': v = String(v).trim(); if (v.length > f.max) throw bad(`at most ${f.max} characters`); break;
      case 'number': case 'money': case 'integer':
        v = typeof v === 'string' ? Number(v.replace(/[, ]/g, '')) : Number(v);
        if (!Number.isFinite(v)) throw bad('write a number');
        if (f.type === 'integer' && !Number.isInteger(v)) throw bad('write a whole number');
        if (f.type === 'money') v = Math.round(v * 100) / 100;
        if (f.min != null && v < f.min) throw bad(`the smallest allowed is ${f.min}`);
        if (f.max != null && v > f.max) throw bad(`the largest allowed is ${f.max}`);
        break;
      case 'boolean': if (typeof v !== 'boolean') { if (['true', '1', 'yes'].includes(String(v).toLowerCase())) v = true; else if (['false', '0', 'no'].includes(String(v).toLowerCase())) v = false; else throw bad('yes or no'); } break;
      case 'date': v = String(v); if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw bad('a date like 2026-11-03'); break;
      case 'datetime': { const t = Date.parse(String(v)); if (Number.isNaN(t)) throw bad('a date and time'); v = new Date(t).toISOString(); break; }
      case 'time': v = String(v); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw bad('a time like 14:30'); break;
      case 'choice': v = String(v); if (!f.options.includes(v)) throw bad(`one of ${f.options.join(', ')}`); break;
      case 'email': v = String(v).trim(); if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(v)) throw bad('an email like name@example.com'); break;
      case 'phone': v = String(v).trim(); if (!/^\+?[\d\s()-]{4,24}$/.test(v)) throw bad('a phone number'); break;
      case 'url': v = String(v).trim(); if (!/^https?:\/\/[^\s]{3,500}$/.test(v)) throw bad('a web address starting with https://'); break;
      case 'image': case 'file': v = String(v); if (!FILE_ID.test(v)) throw bad('upload it with App.db.upload first'); break;
      case 'link': v = String(v); if (!/^[A-Za-z0-9_-]{1,40}$/.test(v)) throw bad('choose a record'); break;
      default: throw bad('unknown type');
    }
    out[name] = v;
  }
  if (Buffer.byteLength(JSON.stringify(out)) > RECORD_BYTES) throw fail('This record is too large.');
  return out;
}

/** A list request made safe: filters on known fields only, a known sort, a bounded page. */
export function cleanQuery(table, { where = {}, sort = '', limit = 100, offset = 0, q = '' } = {}) {
  const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'];
  const filters = [];
  const w = typeof where === 'string' ? (() => { try { return JSON.parse(where || '{}'); } catch { throw fail('The filter is not valid JSON.'); } })() : where;
  for (const [field, cond] of Object.entries(w || {})) {
    if (!table.fields[field] && !['created', 'updated'].includes(field)) throw fail(`There is no field "${String(field).slice(0, 40)}" to filter on.`);
    const pairs = cond !== null && typeof cond === 'object' && !Array.isArray(cond) ? Object.entries(cond) : [['eq', cond]];
    for (const [op, value] of pairs) {
      if (!OPS.includes(op)) throw fail(`Unknown filter "${op}". Use ${OPS.join(', ')}.`);
      if (op === 'in' && (!Array.isArray(value) || value.length > 50)) throw fail('"in" takes a list of up to 50 values.');
      filters.push({ field, op, value });
    }
  }
  if (filters.length > 10) throw fail('Use at most 10 filters.');
  const m = /^(-)?([a-z][a-z0-9_]{0,39})$/.exec(String(sort || '-created'));
  if (!m || (!table.fields[m[2]] && !['created', 'updated'].includes(m[2]))) throw fail('Sort by a field name, with - in front for largest or newest first.');
  return { filters, sort: { field: m[2], desc: Boolean(m[1]) }, limit: Math.min(500, Math.max(1, Number(limit) || 100)), offset: Math.min(50_000, Math.max(0, Number(offset) || 0)), q: String(q || '').trim().slice(0, 100) };
}

const numeric = (f) => ['number', 'integer', 'money'].includes(f?.type);
const rowOut = (id, data, created, updated, by = null) => ({ id, created: new Date(created).toISOString(), updated: new Date(updated).toISOString(), by: by || null, ...data });
const newId = () => crypto.randomBytes(9).toString('base64url');
const today = (now) => new Date(now).toISOString().slice(0, 10);
const groupKey = (value, part) => (value == null ? '' : part === 'day' ? String(value).slice(0, 10) : part === 'month' ? String(value).slice(0, 7) : part === 'year' ? String(value).slice(0, 4) : String(value));

/** Grouped totals: { by: 'field' or 'field:day|month|year', sum: 'numeric field' }. */
export function cleanSummary(table, { by = '', sum = '' } = {}) {
  const [field, part = ''] = String(by || '').split(':');
  if (field && !table.fields[field] && !['created', 'updated'].includes(field)) throw fail(`There is no field "${field.slice(0, 40)}" to group by.`);
  if (part && !['day', 'month', 'year'].includes(part)) throw fail('Group dates by day, month or year.');
  if (sum && !numeric(table.fields[sum])) throw fail('Sum a number or money field.');
  return { by: field, part, sum };
}

// ---- Phase D3 helpers shared by both stores -------------------------------------------
/** A record's name for people: its first text field (or its number), else its id. */
export function labelOf(table, record) {
  if (!table || !record) return '';
  const field = Object.entries(table.fields).find(([, f]) => ['text', 'autonumber'].includes(f.type) && record[f[0]] != null);
  const first = Object.entries(table.fields).find(([k, f]) => ['text', 'autonumber', 'choice'].includes(f.type) && record[k] != null && record[k] !== '');
  return String(first ? record[first[0]] : field ? record[field[0]] : record.id || '').slice(0, 80);
}
/** What a record's effects change elsewhere: undo the old record's, apply the new one's. */
export function effectChanges(table, before, after) {
  const changes = new Map();
  const add = (record, sign) => {
    if (!record) return;
    for (const e of table?.effects || []) {
      const id = record[e.link];
      if (!id) continue;
      const amount = typeof e.by === 'number' ? e.by : Number(record[e.by]) || 0;
      const key = `${e.table}/${id}/${e.field}`;
      const c = changes.get(key) || { table: e.table, id, field: e.field, delta: 0 };
      c.delta += sign * e.sign * amount;
      changes.set(key, c);
    }
  };
  add(before, -1); add(after, 1);
  return [...changes.values()].filter((c) => Math.abs(c.delta) > 1e-9).map((c) => ({ ...c, delta: Math.round(c.delta * 1e6) / 1e6 }));
}
/** The next automatic number: prefix and zero-padded count. */
const autoValue = (field, n) => `${field.prefix || ''}${String(n).padStart(field.digits || 4, '0')}`;
const notEnough = (schema, change, current, record) => {
  const target = schema.tables[change.table], f = target.fields[change.field];
  return fail(`Not enough ${f.label} for ${labelOf(target, record) || 'that record'}: ${current} left.`, 409);
};
export const FILE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx' };
export const FILE_BYTES = 2 * 1024 * 1024;
const newFileId = () => `f_${crypto.randomBytes(18).toString('base64url')}`;
const ACTIVITY_KEPT = 2000, ALERTS_KEPT = 500;

// ---- in memory (tests and local use) --------------------------------------------------
function matches(record, filters, table, q) {
  const value = (field) => record[field];
  for (const { field, op, value: want } of filters) {
    const have = value(field), num = numeric(table.fields[field]);
    const a = num ? Number(have) : have, b = num && op !== 'in' ? Number(want) : want;
    const ok = op === 'eq' ? String(have ?? '') === String(want ?? '') : op === 'ne' ? String(have ?? '') !== String(want ?? '')
      : op === 'contains' ? String(have ?? '').toLowerCase().includes(String(want ?? '').toLowerCase())
      : op === 'in' ? want.map(String).includes(String(have ?? ''))
      : have == null ? false : op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b;
    if (!ok) return false;
  }
  if (q) { const text = Object.entries(table.fields).filter(([, f]) => !numeric(f)).map(([k]) => record[k] ?? '').join(' ').toLowerCase(); if (!text.includes(q.toLowerCase())) return false; }
  return true;
}

export function createMemoryAppDb({ now = () => Date.now() } = {}) {
  const apps = new Map();
  const app = (slug) => { if (!apps.has(slug)) apps.set(slug, { rows: new Map(), files: new Map(), activity: [], alerts: [], usage: { records: 0, bytes: 0, day: '', writes: 0, limits: {}, versions: {}, counters: {} } }); return apps.get(slug); };
  /** Links must point at records that exist; effects must not take a number below its minimum. All checked before anything changes. */
  const prepare = (a, schema, tbl, before, after) => {
    const t = schema?.tables[tbl];
    if (!t) return [];
    for (const [f, field] of Object.entries(t.fields)) if (field.type === 'link' && after?.[f] && after[f] !== before?.[f] && !a.rows.get(`${field.table}/${after[f]}`)) throw fail(`${field.label}: that record is not there any more.`);
    return effectChanges(t, before, after).map((c) => {
      const r = a.rows.get(`${c.table}/${c.id}`);
      if (!r) return null;
      const current = Number(r.data[c.field]) || 0, next = Math.round((current + c.delta) * 1e6) / 1e6, min = schema.tables[c.table].fields[c.field].min;
      if (min != null && next < min && c.delta < 0) throw notEnough(schema, c, current, { id: r.id, ...r.data });
      return { r, field: c.field, next, table: c.table };
    }).filter(Boolean);
  };
  const applyEffects = (a, planned) => { for (const p of planned) { p.r.data = { ...p.r.data, [p.field]: p.next }; p.r.updated = Math.max(now(), p.r.updated + 1); bump(a, p.table); } };
  const limitsOf = (a) => ({ ...LIMITS, ...a.usage.limits });
  const write = (a, records, bytes) => {
    const l = limitsOf(a), u = a.usage, d = today(now());
    if (u.day !== d) { u.day = d; u.writes = 0; }
    if (u.writes >= l.writesPerDay) throw fail('This app has saved too much today. It will work again tomorrow.', 429);
    if (u.records + records > l.records) throw fail(`This app's database is full (${l.records.toLocaleString('en')} records). Delete old records to make room.`, 507);
    if (u.bytes + bytes > l.bytes) throw fail('This app\'s database is full. Delete old records to make room.', 507);
    u.writes += 1; u.records += records; u.bytes += bytes;
  };
  const bump = (a, tbl) => { a.usage.versions[tbl] = (a.usage.versions[tbl] || 0) + 1; };
  return {
    durable: false,
    async add(slug, tbl, data, by = null, schema = null) {
      const a = app(slug);
      data = { ...data };
      const fields = schema?.tables[tbl]?.fields || {};
      const planned = prepare(a, schema, tbl, null, data);
      for (const [f, field] of Object.entries(fields)) if (field.type === 'autonumber') { const key = `${tbl}.${f}`, n = a.usage.counters[key] ?? field.start; data[f] = autoValue(field, n); a.usage.counters[key] = n + 1; }
      const size = Buffer.byteLength(JSON.stringify(data));
      write(a, 1, size);
      applyEffects(a, planned);
      const id = newId(), t = now();
      a.rows.set(`${tbl}/${id}`, { tbl, id, data, size, created: t, updated: t, by });
      bump(a, tbl);
      return rowOut(id, data, t, t, by);
    },
    async get(slug, tbl, id) { const r = app(slug).rows.get(`${tbl}/${id}`); return r ? rowOut(r.id, r.data, r.created, r.updated, r.by) : null; },
    async update(slug, tbl, id, data, schema = null) {
      const a = app(slug), r = a.rows.get(`${tbl}/${id}`);
      if (!r) return null;
      const merged = { ...r.data, ...data }, size = Buffer.byteLength(JSON.stringify(merged));
      const planned = prepare(a, schema, tbl, r.data, merged);
      write(a, 0, size - r.size);
      applyEffects(a, planned);
      Object.assign(r, { data: merged, size, updated: Math.max(now(), r.updated + 1) });
      bump(a, tbl);
      return rowOut(r.id, r.data, r.created, r.updated, r.by);
    },
    async remove(slug, tbl, id, schema = null) {
      const a = app(slug), r = a.rows.get(`${tbl}/${id}`);
      if (!r) return false;
      applyEffects(a, prepare(a, schema, tbl, r.data, null));
      a.rows.delete(`${tbl}/${id}`); a.usage.records -= 1; a.usage.bytes -= r.size; bump(a, tbl);
      return rowOut(r.id, r.data, r.created, r.updated, r.by);
    },
    async getMany(slug, tbl, ids) { const a = app(slug); return [...new Set(ids)].slice(0, 500).map((id) => a.rows.get(`${tbl}/${id}`)).filter(Boolean).map((r) => rowOut(r.id, r.data, r.created, r.updated, r.by)); },
    async putFile(slug, { name, type, data, by = null }) {
      const a = app(slug); write(a, 0, data.length);
      const id = newFileId(); a.files.set(id, { id, name, type, data: Buffer.from(data), size: data.length, by, created: now() }); bump(a, '_files');
      return { id, size: data.length, type, name };
    },
    async getFile(slug, id) { return apps.get(slug)?.files.get(id) || null; },
    async removeFiles(slug, ids) { const a = app(slug); for (const id of ids) { const f = a.files.get(id); if (f) { a.files.delete(id); a.usage.bytes -= f.size; } } return true; },
    async log(slug, entry) { const a = app(slug); a.activity.unshift({ id: newId(), at: new Date(now()).toISOString(), ...entry }); a.activity.length = Math.min(a.activity.length, ACTIVITY_KEPT); return true; },
    async activity(slug, limit = 200) { return app(slug).activity.slice(0, Math.min(500, limit)); },
    async addAlert(slug, alert) { const a = app(slug); const made = { id: newId(), at: new Date(Math.max(now(), a.alerts[0] ? Date.parse(a.alerts[0].at) + 1 : 0)).toISOString(), message: alert.message, for: alert.for, table: alert.table || '', record: alert.record || '' }; a.alerts.unshift(made); a.alerts.length = Math.min(a.alerts.length, ALERTS_KEPT); bump(a, '_alerts'); return made; },
    async alerts(slug, { since = '', limit = 50 } = {}) { return app(slug).alerts.filter((x) => !since || x.at > since).slice(0, Math.min(200, limit)); },
    async list(slug, tbl, query, table) {
      const all = [...app(slug).rows.values()].filter((r) => r.tbl === tbl && (!query.by || r.by === query.by)).map((r) => rowOut(r.id, r.data, r.created, r.updated, r.by)).filter((r) => matches(r, query.filters, table, query.q));
      const { field, desc } = query.sort, num = numeric(table.fields[field]);
      all.sort((x, y) => { const a = x[field], b = y[field]; const c = a == null ? (b == null ? 0 : 1) : b == null ? -1 : num ? a - b : String(a).localeCompare(String(b)); return (desc && a != null && b != null ? -c : c) || (x.id < y.id ? -1 : 1); });
      return { records: all.slice(query.offset, query.offset + query.limit), total: all.length };
    },
    async summary(slug, tbl, query, table, s) {
      const { records } = await this.list(slug, tbl, { ...query, limit: 1e9, offset: 0 }, table);
      const groups = new Map();
      for (const r of records) { const k = s.by ? groupKey(r[s.by], s.part) : ''; const g = groups.get(k) || { key: k, count: 0, sum: 0 }; g.count += 1; if (s.sum) g.sum += Number(r[s.sum]) || 0; groups.set(k, g); }
      return [...groups.values()].map((g) => ({ ...g, sum: Math.round(g.sum * 100) / 100 })).sort((x, y) => (x.key < y.key ? -1 : 1)).slice(0, 400);
    },
    async versions(slug) { return { ...app(slug).usage.versions }; },
    async usage(slug) { const a = app(slug); return { records: a.usage.records, bytes: a.usage.bytes, writesToday: a.usage.day === today(now()) ? a.usage.writes : 0, limits: limitsOf(a) }; },
    async setLimits(slug, limits) { app(slug).usage.limits = cleanLimits(limits); return limitsOf(app(slug)); },
    async exportAll(slug) { return [...app(slug).rows.values()].map((r) => ({ table: r.tbl, ...rowOut(r.id, r.data, r.created, r.updated, r.by) })); },
    async counters(slug) { return { ...app(slug).usage.counters }; },
    async removeSite(slug) { apps.delete(slug); return true; },
  };
}

/** Limits the owner of Grandpa AI may raise for one app (never unlimited). */
export function cleanLimits(input = {}) {
  const out = {};
  for (const [k, most] of [['records', 1_000_000], ['bytes', 1024 * 1024 * 1024], ['writesPerDay', 200_000]]) if (input[k] != null) {
    const n = Math.floor(Number(input[k]));
    if (!Number.isFinite(n) || n < 1 || n > most) throw fail(`${k} must be between 1 and ${most}.`);
    out[k] = n;
  }
  return out;
}

// ---- Postgres ----------------------------------------------------------------------------
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS public.grandpa_ai_app_records (
    scope text NOT NULL, slug text NOT NULL, tbl text NOT NULL, id text NOT NULL,
    data jsonb NOT NULL, size integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (scope, slug, tbl, id)
  )`,
  'CREATE INDEX IF NOT EXISTS grandpa_ai_app_records_by_time ON public.grandpa_ai_app_records (scope, slug, tbl, created_at)',
  // Phase D2: who added each record (an app account's id), for "own" rules.
  'ALTER TABLE public.grandpa_ai_app_records ADD COLUMN IF NOT EXISTS by_user text',
  // Phase D3: automatic numbers, files, the activity log and alerts.
  `CREATE TABLE IF NOT EXISTS public.grandpa_ai_app_files (
    scope text NOT NULL, slug text NOT NULL, id text NOT NULL, name text NOT NULL, type text NOT NULL, size integer NOT NULL, data bytea NOT NULL,
    by_user text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (scope, slug, id)
  )`,
  `CREATE TABLE IF NOT EXISTS public.grandpa_ai_app_activity (
    scope text NOT NULL, slug text NOT NULL, id text NOT NULL, at timestamptz NOT NULL DEFAULT clock_timestamp(),
    who text NOT NULL, action text NOT NULL, tbl text NOT NULL, record_id text NOT NULL, summary text NOT NULL, PRIMARY KEY (scope, slug, id)
  )`,
  'CREATE INDEX IF NOT EXISTS grandpa_ai_app_activity_by_time ON public.grandpa_ai_app_activity (scope, slug, at)',
  `CREATE TABLE IF NOT EXISTS public.grandpa_ai_app_alerts (
    scope text NOT NULL, slug text NOT NULL, id text NOT NULL, at timestamptz NOT NULL DEFAULT clock_timestamp(),
    message text NOT NULL, for_who jsonb NOT NULL, tbl text NOT NULL DEFAULT '', record_id text NOT NULL DEFAULT '', PRIMARY KEY (scope, slug, id)
  )`,
  'CREATE INDEX IF NOT EXISTS grandpa_ai_app_alerts_by_time ON public.grandpa_ai_app_alerts (scope, slug, at)',
  `CREATE TABLE IF NOT EXISTS public.grandpa_ai_app_usage (
    scope text NOT NULL, slug text NOT NULL,
    records integer NOT NULL DEFAULT 0, bytes bigint NOT NULL DEFAULT 0, day text NOT NULL DEFAULT '', writes integer NOT NULL DEFAULT 0,
    limits jsonb NOT NULL DEFAULT '{}', versions jsonb NOT NULL DEFAULT '{}',
    PRIMARY KEY (scope, slug)
  )`,
  `ALTER TABLE public.grandpa_ai_app_usage ADD COLUMN IF NOT EXISTS counters jsonb NOT NULL DEFAULT '{}'`,
];

/** SQL for one field's value, by its type (field names go in as parameters, never as text). */
function fieldSql(table, field, param) {
  if (field === 'created' || field === 'updated') return `${field}_at`;
  const f = table.fields[field];
  if (numeric(f)) return `NULLIF(data->>${param}, '')::numeric`;
  if (f.type === 'boolean') return `(data->>${param})::boolean`;
  return `(data->>${param})`;
}

export function createPostgresAppDb({ connectionString, pool: suppliedPool, scope = governanceScope(), now = () => Date.now() } = {}) {
  const pool = suppliedPool || new pg.Pool(postgresPoolOptions(connectionString, { max: 3, connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000, allowExitOnIdle: true }));
  if (!suppliedPool && process.env.VERCEL) attachDatabasePool(pool);
  pool.on?.('error', () => console.error('[app-db] Database connection unavailable.'));
  let ready;
  const initialize = async () => {
    if (!ready) ready = postgresTransaction(pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('grandpa_ai_app_db_v1'))");
      for (const statement of SCHEMA) await client.query(statement);
    }, { lock: '8s' }).catch((error) => { ready = undefined; throw error; });
    await ready;
  };
  const transaction = async (action) => {
    try { await initialize(); return await postgresTransaction(pool, action, { lock: '5s' }); }
    catch (error) { if (error.status) throw error; console.error('[app-db]', error.message); throw fail('The app\'s database could not be reached. Try again in a moment.', 503); }
  };
  const usageRow = async (client, slug) => {
    await client.query('INSERT INTO public.grandpa_ai_app_usage (scope, slug) VALUES ($1,$2) ON CONFLICT DO NOTHING', [scope, slug]);
    return (await client.query('SELECT * FROM public.grandpa_ai_app_usage WHERE scope=$1 AND slug=$2 FOR UPDATE', [scope, slug])).rows[0];
  };
  const limitsOf = (row) => ({ ...LIMITS, ...(typeof row.limits === 'string' ? JSON.parse(row.limits) : row.limits || {}) });
  /** Counts a write within the limits and bumps the table's version, in the same transaction. */
  const write = async (client, slug, tbl, records, bytes) => {
    const u = await usageRow(client, slug), l = limitsOf(u), d = today(now());
    const writes = u.day === d ? Number(u.writes) : 0;
    if (writes >= l.writesPerDay) throw fail('This app has saved too much today. It will work again tomorrow.', 429);
    if (Number(u.records) + records > l.records) throw fail(`This app's database is full (${l.records.toLocaleString('en')} records). Delete old records to make room.`, 507);
    if (Number(u.bytes) + bytes > l.bytes) throw fail('This app\'s database is full. Delete old records to make room.', 507);
    await client.query(`UPDATE public.grandpa_ai_app_usage SET records=records+$3, bytes=bytes+$4, day=$5, writes=$6,
      versions=jsonb_set(versions, ARRAY[$7::text], to_jsonb(COALESCE((versions->>$7)::integer, 0) + 1)) WHERE scope=$1 AND slug=$2`, [scope, slug, records, bytes, d, writes + 1, tbl]);
  };
  const out = (r) => rowOut(r.id, typeof r.data === 'string' ? JSON.parse(r.data) : r.data, r.created_at, r.updated_at, r.by_user);
  const dataOf = (r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data);
  const bumpTable = (client, slug, tbl) => client.query(`UPDATE public.grandpa_ai_app_usage SET versions=jsonb_set(versions, ARRAY[$3::text], to_jsonb(COALESCE((versions->>$3)::integer, 0) + 1)) WHERE scope=$1 AND slug=$2`, [scope, slug, tbl]);
  /** In the write's transaction: check links, then change the linked numbers (locked), refusing to go below a minimum. */
  const prepare = async (client, slug, schema, tbl, before, after) => {
    const t = schema?.tables[tbl];
    if (!t) return;
    for (const [f, field] of Object.entries(t.fields)) if (field.type === 'link' && after?.[f] && after[f] !== before?.[f]) {
      if (!(await client.query('SELECT 1 FROM public.grandpa_ai_app_records WHERE scope=$1 AND slug=$2 AND tbl=$3 AND id=$4', [scope, slug, field.table, String(after[f])])).rows.length) throw fail(`${field.label}: that record is not there any more.`);
    }
    for (const c of effectChanges(t, before, after)) {
      const r = (await client.query('SELECT id, data FROM public.grandpa_ai_app_records WHERE scope=$1 AND slug=$2 AND tbl=$3 AND id=$4 FOR UPDATE', [scope, slug, c.table, String(c.id)])).rows[0];
      if (!r) continue;
      const data = dataOf(r), current = Number(data[c.field]) || 0, next = Math.round((current + c.delta) * 1e6) / 1e6, min = schema.tables[c.table].fields[c.field].min;
      if (min != null && next < min && c.delta < 0) throw notEnough(schema, c, current, { id: r.id, ...data });
      await client.query(`UPDATE public.grandpa_ai_app_records SET data=jsonb_set(data, ARRAY[$5::text], to_jsonb($6::numeric)), updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 millisecond') WHERE scope=$1 AND slug=$2 AND tbl=$3 AND id=$4`, [scope, slug, c.table, String(c.id), c.field, next]);
      await bumpTable(client, slug, c.table);
    }
  };
  const whereSql = (table, query, params) => {
    const parts = [];
    if (query.by) { params.push(query.by); parts.push(`by_user = $${params.length}`); }
    for (const { field, op, value } of query.filters) {
      const key = field === 'created' || field === 'updated' ? '' : (params.push(field), `$${params.length}`);
      const col = fieldSql(table, field, key), num = numeric(table.fields[field]) ;
      if (op === 'in') { params.push(value.map(String)); parts.push(`${field === 'created' || field === 'updated' ? `${col}::text` : `(data->>${key})`} = ANY($${params.length}::text[])`); continue; }
      if (op === 'contains') { params.push(`%${String(value ?? '').replace(/[\\%_]/g, (c) => `\\${c}`)}%`); parts.push(`${key ? `(data->>${key})` : `${col}::text`} ILIKE $${params.length}`); continue; }
      if (op === 'eq' || op === 'ne') { params.push(String(value ?? '')); parts.push(`COALESCE(${key ? `(data->>${key})` : `${col}::text`}, '') ${op === 'eq' ? '=' : '<>'} $${params.length}`); continue; }
      params.push(num ? Number(value) : String(value));
      parts.push(`${col} ${{ gt: '>', gte: '>=', lt: '<', lte: '<=' }[op]} $${params.length}${num ? '::numeric' : field === 'created' || field === 'updated' ? '::timestamptz' : ''}`);
    }
    if (query.q) {
      const texts = Object.entries(table.fields).filter(([, f]) => !numeric(f)).map(([k]) => { params.push(k); return `COALESCE(data->>$${params.length}, '')`; });
      params.push(`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      parts.push(`concat_ws(' ', ${texts.join(', ') || "''"}) ILIKE $${params.length}`);
    }
    return parts.length ? ` AND ${parts.join(' AND ')}` : '';
  };
  return {
    durable: true,
    async add(slug, tbl, data, by = null, schema = null) {
      const id = newId();
      return transaction(async (client) => {
        data = { ...data };
        await prepare(client, slug, schema, tbl, null, data);
        const autos = Object.entries(schema?.tables[tbl]?.fields || {}).filter(([, f]) => f.type === 'autonumber');
        if (autos.length) {
          const u = await usageRow(client, slug), counters = typeof u.counters === 'string' ? JSON.parse(u.counters) : (u.counters || {});
          for (const [f, field] of autos) { const key = `${tbl}.${f}`, n = counters[key] ?? field.start; data[f] = autoValue(field, n); counters[key] = n + 1; }
          await client.query('UPDATE public.grandpa_ai_app_usage SET counters=$3 WHERE scope=$1 AND slug=$2', [scope, slug, JSON.stringify(counters)]);
        }
        const size = Buffer.byteLength(JSON.stringify(data));
        await write(client, slug, tbl, 1, size);
        return out((await client.query('INSERT INTO public.grandpa_ai_app_records (scope, slug, tbl, id, data, size, by_user) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [scope, slug, tbl, id, JSON.stringify(data), size, by])).rows[0]);
      });
    },
    async get(slug, tbl, id) {
      return transaction(async (client) => { const r = (await client.query('SELECT * FROM public.grandpa_ai_app_records WHERE scope=$1 AND slug=$2 AND tbl=$3 AND id=$4', [scope, slug, tbl, String(id)])).rows[0]; return r ? out(r) : null; });
    },
    async update(slug, tbl, id, data, schema = null) {
      return transaction(async (client) => {
        const r = (await client.query('SELECT * FROM public.grandpa_ai_app_records WHERE scope=$1 AND slug=$2 AND tbl=$3 AND id=$4 FOR UPDATE', [scope, slug, tbl, String(id)])).rows[0];
        if (!r) return null;
        const merged = { ...dataOf(r), ...data }, size = Buffer.byteLength(JSON.stringify(merged));
        await prepare(client, slug, schema, tbl, dataOf(r), merged);
        await write(client, slug, tbl, 0, size - r.size);
        return out((await client.query('UPDATE public.grandpa_ai_app_records SET data=$5, size=$6, updated_at=GREATEST(clock_timestamp(), updated_at + interval \'1 millisecond\') WHERE scope=$1 AND slug=$2 AND tbl=$3 AND id=$4 RETURNING *', [scope, slug, tbl, String(id), JSON.stringify(merged), size])).rows[0]);
      });
    },
    async remove(slug, tbl, id, schema = null) {
      return transaction(async (client) => {
        const before = (await client.query('SELECT * FROM public.grandpa_ai_app_records WHERE scope=$1 AND slug=$2 AND tbl=$3 AND id=$4 FOR UPDATE', [scope, slug, tbl, String(id)])).rows[0];
        if (!before) return false;
        await prepare(client, slug, schema, tbl, dataOf(before), null);
        const r = (await client.query('DELETE FROM public.grandpa_ai_app_records WHERE scope=$1 AND slug=$2 AND tbl=$3 AND id=$4 RETURNING size', [scope, slug, tbl, String(id)])).rows[0];
        if (!r) return false;
        await usageRow(client, slug);
        await client.query(`UPDATE public.grandpa_ai_app_usage SET records=GREATEST(records-1, 0), bytes=GREATEST(bytes-$3, 0),
          versions=jsonb_set(versions, ARRAY[$4::text], to_jsonb(COALESCE((versions->>$4)::integer, 0) + 1)) WHERE scope=$1 AND slug=$2`, [scope, slug, r.size, tbl]);
        return out(before);
      });
    },
    async getMany(slug, tbl, ids) {
      const list = [...new Set(ids.map(String))].slice(0, 500);
      if (!list.length) return [];
      return transaction(async (client) => (await client.query('SELECT * FROM public.grandpa_ai_app_records WHERE scope=$1 AND slug=$2 AND tbl=$3 AND id = ANY($4::text[])', [scope, slug, tbl, list])).rows.map(out));
    },
    async putFile(slug, { name, type, data, by = null }) {
      const id = newFileId();
      return transaction(async (client) => {
        await write(client, slug, '_files', 0, data.length);
        await client.query('INSERT INTO public.grandpa_ai_app_files (scope, slug, id, name, type, size, data, by_user) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [scope, slug, id, name, type, data.length, Buffer.from(data), by]);
        return { id, size: data.length, type, name };
      });
    },
    async getFile(slug, id) {
      return transaction(async (client) => { const r = (await client.query('SELECT * FROM public.grandpa_ai_app_files WHERE scope=$1 AND slug=$2 AND id=$3', [scope, slug, String(id)])).rows[0]; return r ? { id: r.id, name: r.name, type: r.type, size: r.size, data: Buffer.from(r.data), by: r.by_user } : null; });
    },
    async removeFiles(slug, ids) {
      if (!ids.length) return true;
      return transaction(async (client) => {
        const gone = (await client.query('DELETE FROM public.grandpa_ai_app_files WHERE scope=$1 AND slug=$2 AND id = ANY($3::text[]) RETURNING size', [scope, slug, ids])).rows.reduce((n, r) => n + Number(r.size), 0);
        if (gone) await client.query('UPDATE public.grandpa_ai_app_usage SET bytes=GREATEST(bytes-$3, 0) WHERE scope=$1 AND slug=$2', [scope, slug, gone]);
        return true;
      });
    },
    async log(slug, entry) {
      return transaction(async (client) => {
        await client.query('INSERT INTO public.grandpa_ai_app_activity (scope, slug, id, who, action, tbl, record_id, summary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [scope, slug, newId(), String(entry.who).slice(0, 80), entry.action, entry.table, String(entry.record || ''), String(entry.summary || '').slice(0, 200)]);
        await client.query(`DELETE FROM public.grandpa_ai_app_activity WHERE scope=$1 AND slug=$2 AND at < (SELECT at FROM public.grandpa_ai_app_activity WHERE scope=$1 AND slug=$2 ORDER BY at DESC OFFSET ${ACTIVITY_KEPT - 1} LIMIT 1)`, [scope, slug]);
        return true;
      });
    },
    async activity(slug, limit = 200) {
      return transaction(async (client) => (await client.query('SELECT * FROM public.grandpa_ai_app_activity WHERE scope=$1 AND slug=$2 ORDER BY at DESC LIMIT $3', [scope, slug, Math.min(500, limit)])).rows
        .map((r) => ({ id: r.id, at: new Date(r.at).toISOString(), who: r.who, action: r.action, table: r.tbl, record: r.record_id, summary: r.summary })));
    },
    async addAlert(slug, alert) {
      return transaction(async (client) => {
        await usageRow(client, slug);
        const r = (await client.query('INSERT INTO public.grandpa_ai_app_alerts (scope, slug, id, message, for_who, tbl, record_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [scope, slug, newId(), alert.message, JSON.stringify(alert.for), alert.table || '', alert.record || ''])).rows[0];
        await client.query(`DELETE FROM public.grandpa_ai_app_alerts WHERE scope=$1 AND slug=$2 AND at < (SELECT at FROM public.grandpa_ai_app_alerts WHERE scope=$1 AND slug=$2 ORDER BY at DESC OFFSET ${ALERTS_KEPT - 1} LIMIT 1)`, [scope, slug]);
        await bumpTable(client, slug, '_alerts');
        return { id: r.id, at: new Date(r.at).toISOString(), message: r.message, for: alert.for, table: r.tbl, record: r.record_id };
      });
    },
    async alerts(slug, { since = '', limit = 50 } = {}) {
      return transaction(async (client) => (await client.query(`SELECT * FROM public.grandpa_ai_app_alerts WHERE scope=$1 AND slug=$2${since ? ' AND at > $4::timestamptz' : ''} ORDER BY at DESC LIMIT $3`, [scope, slug, Math.min(200, limit), ...(since ? [since] : [])])).rows
        .map((r) => ({ id: r.id, at: new Date(r.at).toISOString(), message: r.message, for: typeof r.for_who === 'string' ? JSON.parse(r.for_who) : r.for_who, table: r.tbl, record: r.record_id })));
    },
    async counters(slug) {
      return transaction(async (client) => { const r = (await client.query('SELECT counters FROM public.grandpa_ai_app_usage WHERE scope=$1 AND slug=$2', [scope, slug])).rows[0]; return r ? (typeof r.counters === 'string' ? JSON.parse(r.counters) : r.counters) : {}; });
    },
    async list(slug, tbl, query, table) {
      return transaction(async (client) => {
        const params = [scope, slug, tbl];
        const where = whereSql(table, query, params);
        const total = Number((await client.query(`SELECT count(*)::integer AS n FROM public.grandpa_ai_app_records WHERE scope=$1 AND slug=$2 AND tbl=$3${where}`, params)).rows[0].n);
        const sortKey = query.sort.field === 'created' || query.sort.field === 'updated' ? '' : (params.push(query.sort.field), `$${params.length}`);
        const order = `${fieldSql(table, query.sort.field, sortKey)} ${query.sort.desc ? 'DESC' : 'ASC'} NULLS LAST, id ASC`;
        params.push(query.limit, query.offset);
        const rows = (await client.query(`SELECT * FROM public.grandpa_ai_app_records WHERE scope=$1 AND slug=$2 AND tbl=$3${where} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
        return { records: rows.map(out), total };
      });
    },
    async summary(slug, tbl, query, table, s) {
      return transaction(async (client) => {
        const params = [scope, slug, tbl];
        const where = whereSql(table, query, params);
        let key = "''";
        if (s.by) {
          const base = s.by === 'created' || s.by === 'updated' ? `to_char(${s.by}_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')` : (params.push(s.by), `COALESCE(data->>$${params.length}, '')`);
          key = s.part === 'day' ? `left(${base}, 10)` : s.part === 'month' ? `left(${base}, 7)` : s.part === 'year' ? `left(${base}, 4)` : base;
        }
        let total = '0';
        if (s.sum) { params.push(s.sum); total = `COALESCE(sum(NULLIF(data->>$${params.length}, '')::numeric), 0)`; }
        const rows = (await client.query(`SELECT ${key} AS key, count(*)::integer AS count, ${total} AS sum FROM public.grandpa_ai_app_records WHERE scope=$1 AND slug=$2 AND tbl=$3${where} GROUP BY 1 ORDER BY 1 LIMIT 400`, params)).rows;
        return rows.map((r) => ({ key: r.key, count: Number(r.count), sum: Math.round(Number(r.sum) * 100) / 100 }));
      });
    },
    async versions(slug) {
      return transaction(async (client) => { const r = (await client.query('SELECT versions FROM public.grandpa_ai_app_usage WHERE scope=$1 AND slug=$2', [scope, slug])).rows[0]; return r ? (typeof r.versions === 'string' ? JSON.parse(r.versions) : r.versions) : {}; });
    },
    async usage(slug) {
      return transaction(async (client) => {
        const r = (await client.query('SELECT * FROM public.grandpa_ai_app_usage WHERE scope=$1 AND slug=$2', [scope, slug])).rows[0];
        return r ? { records: Number(r.records), bytes: Number(r.bytes), writesToday: r.day === today(now()) ? Number(r.writes) : 0, limits: limitsOf(r) } : { records: 0, bytes: 0, writesToday: 0, limits: { ...LIMITS } };
      });
    },
    async setLimits(slug, limits) {
      const clean = cleanLimits(limits);
      return transaction(async (client) => { await usageRow(client, slug); await client.query('UPDATE public.grandpa_ai_app_usage SET limits=$3 WHERE scope=$1 AND slug=$2', [scope, slug, JSON.stringify(clean)]); return { ...LIMITS, ...clean }; });
    },
    async exportAll(slug) {
      return transaction(async (client) => (await client.query('SELECT * FROM public.grandpa_ai_app_records WHERE scope=$1 AND slug=$2 ORDER BY tbl, created_at, id LIMIT 1000000', [scope, slug])).rows.map((r) => ({ table: r.tbl, ...out(r) })));
    },
    async removeSite(slug) {
      return transaction(async (client) => {
        for (const table of ['grandpa_ai_app_records', 'grandpa_ai_app_usage', 'grandpa_ai_app_files', 'grandpa_ai_app_activity', 'grandpa_ai_app_alerts']) await client.query(`DELETE FROM public.${table} WHERE scope=$1 AND slug=$2`, [scope, slug]);
        return true;
      });
    },
  };
}

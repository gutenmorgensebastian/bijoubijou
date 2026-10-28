#!/usr/bin/env node
// Hüttenplan – Schichtplanung Märchenhütten
// Node >= 22, keine Abhängigkeiten (node:sqlite eingebaut)
'use strict';
process.removeAllListeners('warning');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3080);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'huettenplan.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

// ---------- Schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS gewerke(id INTEGER PRIMARY KEY, name TEXT, short TEXT, rate REAL, lead_min INTEGER, lead_handover_min INTEGER,
  demand_day INTEGER DEFAULT 0, demand_eve INTEGER DEFAULT 1, demand_eve_peak INTEGER DEFAULT 1, color TEXT, sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS people(id INTEGER PRIMARY KEY, name TEXT, phone TEXT, email TEXT, pin TEXT, token TEXT, role TEXT DEFAULT 'staff',
  employment TEXT DEFAULT 'minijob', budget_month REAL DEFAULT 40, budget_week REAL DEFAULT 20, gewerke TEXT DEFAULT '[]', notes TEXT, active INTEGER DEFAULT 1, created TEXT);
CREATE TABLE IF NOT EXISTS performances(id INTEGER PRIMARY KEY, date TEXT, time TEXT, title TEXT, audience TEXT, source TEXT DEFAULT 'import', UNIQUE(date,time,title));
CREATE TABLE IF NOT EXISTS shifts(id INTEGER PRIMARY KEY, date TEXT, kind TEXT, start TEXT, end TEXT, note TEXT, manual INTEGER DEFAULT 0, UNIQUE(date,kind));
CREATE TABLE IF NOT EXISTS demand(shift_id INTEGER, gewerk_id INTEGER, count INTEGER, PRIMARY KEY(shift_id,gewerk_id));
CREATE TABLE IF NOT EXISTS assignments(id INTEGER PRIMARY KEY, shift_id INTEGER, gewerk_id INTEGER, person_id INTEGER, status TEXT DEFAULT 'fest',
  arrive TEXT, actual_start TEXT, actual_end TEXT, note TEXT, created TEXT, released_by INTEGER);
CREATE TABLE IF NOT EXISTS availability(person_id INTEGER, date TEXT, status TEXT, note TEXT, PRIMARY KEY(person_id,date));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, channel TEXT, person_id INTEGER, text TEXT, ts TEXT, pinned INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS checklist(id INTEGER PRIMARY KEY, gewerk_id INTEGER, text TEXT, phase TEXT DEFAULT 'start', sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS checks(shift_id INTEGER, item_id INTEGER, person_id INTEGER, ts TEXT, PRIMARY KEY(shift_id,item_id));
CREATE TABLE IF NOT EXISTS todos(id INTEGER PRIMARY KEY, gewerk_id INTEGER, shift_id INTEGER, text TEXT, done INTEGER DEFAULT 0, done_by INTEGER, done_ts TEXT, created_by INTEGER, ts TEXT);
CREATE TABLE IF NOT EXISTS reports(shift_id INTEGER PRIMARY KEY, person_id INTEGER, text TEXT, visitors INTEGER, cash REAL, incidents TEXT, ts TEXT);
CREATE TABLE IF NOT EXISTS log(id INTEGER PRIMARY KEY, ts TEXT, person_id INTEGER, action TEXT, detail TEXT);
`);

const q = (sql) => db.prepare(sql);
const all = (sql, ...p) => q(sql).all(...p);
const get = (sql, ...p) => q(sql).get(...p);
const run = (sql, ...p) => q(sql).run(...p);
const now = () => new Date().toISOString();
const setting = (k, d) => { const r = get('SELECT value FROM settings WHERE key=?', k); return r ? JSON.parse(r.value) : d; };
const setSetting = (k, v) => run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(v));
const clients = new Set();
function broadcast(msg) { const s = `data: ${JSON.stringify(msg)}\n\n`; for (const c of clients) c.write(s); }
const log = (pid, action, detail) => { run('INSERT INTO log(ts,person_id,action,detail) VALUES(?,?,?,?)', now(), pid || null, action, detail || ''); broadcast({ type: 'log' }); };

// ---------- Seed ----------
if (!get('SELECT 1 FROM settings WHERE key=?', 'seeded')) {
  setSetting('season', { start: '2026-11-13', end: '2027-01-31', name: 'Märchenhütten Winter 2026/27' });
  setSetting('rules', { day_cutoff: '13:00', after_min: 90, minijob_2026: 603, minijob_2027: 633, max_day_h: 10, rest_h: 11, peak_days: [5, 6, 0], peak_from: '2026-12-01', peak_to: '2026-12-31', swap_mode: 'direct' });
  setSetting('admin_pin', '1234');
  const gw = [
    ['Kasse', 'K', 15, 60, 30, 1, 1, 2, '#2f6fde'],
    ['Einlass', 'E', 15, 30, 30, 1, 2, 3, '#1f9d55'],
    ['Bühnenassistenz', 'BA', 16, 60, 30, 0, 1, 2, '#b7791f'],
    ['Abenddienstleitung', 'ADL', 18, 120, 0, 0, 1, 1, '#c53030'],
  ];
  gw.forEach((g, i) => run('INSERT INTO gewerke(name,short,rate,lead_min,lead_handover_min,demand_day,demand_eve,demand_eve_peak,color,sort) VALUES(?,?,?,?,?,?,?,?,?,?)', ...g, i));
  const cl = {
    1: [['Kasse aufschließen, Wechselgeld zählen', 'start'], ['Kassensystem/Billeto-Scanner starten', 'start'], ['Kassenabschluss, Bericht ausdrucken', 'ende'], ['Einnahmen übergeben an ADL', 'ende']],
    2: [['Hütten heizen (alle Öfen an)', 'start'], ['Wege und Eingänge prüfen, Licht an', 'start'], ['Einlasslisten/Scanner bereit', 'start'], ['Öfen aus, Hütten kontrollieren', 'ende']],
    3: [['Bühne und Requisiten vorbereiten', 'start'], ['Absprache mit Darsteller:innen', 'start'], ['Bühne aufräumen, Requisiten verstauen', 'ende']],
    4: [['Aufschließen, Rundgang, Strom/Heizung', 'start'], ['Anwesenheit aller Gewerke und Darsteller:innen prüfen', 'start'], ['Notausgänge und Feuerlöscher prüfen', 'start'], ['Kassenabrechnung entgegennehmen', 'ende'], ['Abschließen, Rundgang, Schichtbericht ausfüllen', 'ende']],
  };
  Object.entries(cl).forEach(([g, items]) => items.forEach(([t, ph], i) => run('INSERT INTO checklist(gewerk_id,text,phase,sort) VALUES(?,?,?,?)', g, t, ph, i)));
  const seedFile = path.join(DATA_DIR, 'spielplan-seed.json');
  if (fs.existsSync(seedFile)) {
    const rows = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    const ins = q('INSERT OR IGNORE INTO performances(date,time,title,audience,source) VALUES(?,?,?,?,?)');
    rows.forEach(r => ins.run(r.date, r.time, r.title, r.audience, 'import'));
  }
  run('INSERT INTO people(name,role,pin,token,employment,gewerke,created,budget_month,budget_week) VALUES(?,?,?,?,?,?,?,?,?)', 'Sebastian (Produktion)', 'admin', '1234', crypto.randomBytes(12).toString('hex'), 'leitung', '[4]', now(), 999, 99);
  setSetting('seeded', true);
  setSetting('needs_generate', true);
}

// ---------- Zeitlogik ----------
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toT = (m) => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const isPeak = (date) => { const r = setting('rules'); return date >= r.peak_from && date <= r.peak_to && r.peak_days.includes(dow(date)); };
const isHoliday = (d) => ['2026-12-25', '2026-12-26', '2027-01-01'].includes(d) || dow(d) === 0;

function regenerateShifts(pid) {
  const rules = setting('rules');
  const cutoff = toMin(rules.day_cutoff);
  const dates = all('SELECT DISTINCT date FROM performances ORDER BY date');
  const gws = all('SELECT * FROM gewerke WHERE active=1');
  let created = 0;
  for (const { date } of dates) {
    const perfs = all('SELECT time FROM performances WHERE date=? ORDER BY time', date).map(p => toMin(p.time));
    const blocks = { tag: perfs.filter(m => m < cutoff), abend: perfs.filter(m => m >= cutoff) };
    for (const kind of ['tag', 'abend']) {
      const ps = blocks[kind];
      if (!ps.length) continue;
      const start = toT(ps[0]), end = toT(ps[ps.length - 1] + rules.after_min);
      const ex = get('SELECT * FROM shifts WHERE date=? AND kind=?', date, kind);
      if (ex) { if (!ex.manual) run('UPDATE shifts SET start=?,end=? WHERE id=?', start, end, ex.id); continue; }
      const r = run('INSERT INTO shifts(date,kind,start,end) VALUES(?,?,?,?)', date, kind, start, end);
      const sid = Number(r.lastInsertRowid); created++;
      for (const g of gws) {
        const c = kind === 'tag' ? g.demand_day : (isPeak(date) ? g.demand_eve_peak : g.demand_eve);
        run('INSERT INTO demand(shift_id,gewerk_id,count) VALUES(?,?,?)', sid, g.id, c);
      }
    }
  }
  if (created) log(pid, 'shifts.generate', `${created} Schichten angelegt`);
  return created;
}

// Antrittszeit: Übergabe, wenn in der Tagschicht desselben Tages dasselbe Gewerk besetzt ist
function arrival(shift, gw, asg) {
  if (asg && asg.arrive) return asg.arrive;
  let handover = false;
  if (shift.kind === 'abend') {
    // Übergabe nur, wenn die Tagschicht noch läuft, wenn der normale Vorlauf beginnen würde
    const tag = get('SELECT id,end FROM shifts WHERE date=? AND kind=?', shift.date, 'tag');
    if (tag && toMin(tag.end) >= toMin(shift.start) - gw.lead_min) handover = !!get("SELECT 1 FROM assignments WHERE shift_id=? AND gewerk_id=? AND status!='frei' AND person_id IS NOT NULL", tag.id, gw.id);
  }
  return toT(toMin(shift.start) - (handover ? gw.lead_handover_min : gw.lead_min));
}
function hoursOf(shift, gw, asg) {
  const a = asg.actual_start || arrival(shift, gw, asg), e = asg.actual_end || shift.end;
  let m = toMin(e) - toMin(a); if (m < 0) m += 1440; return Math.round(m / 6) / 10;
}

function shiftView(s) {
  const gws = all('SELECT * FROM gewerke WHERE active=1 ORDER BY sort');
  const dem = Object.fromEntries(all('SELECT gewerk_id,count FROM demand WHERE shift_id=?', s.id).map(d => [d.gewerk_id, d.count]));
  const asgs = all('SELECT a.*,p.name person_name FROM assignments a LEFT JOIN people p ON p.id=a.person_id WHERE shift_id=? ORDER BY a.id', s.id);
  const cut = setting('rules').day_cutoff;
  const perfs = all(s.kind === 'tag' ? 'SELECT time,title,audience FROM performances WHERE date=? AND time<? ORDER BY time' : 'SELECT time,title,audience FROM performances WHERE date=? AND time>=? ORDER BY time', s.date, cut);
  const g = gws.map(gw => {
    const a = asgs.filter(x => x.gewerk_id === gw.id).map(x => ({ ...x, arrive_calc: arrival(s, gw, x), hours: hoursOf(s, gw, x) }));
    const filled = a.filter(x => x.status !== 'frei' && x.person_id).length;
    const open = a.filter(x => x.status === 'frei').length;
    return { gewerk: gw, demand: dem[gw.id] ?? 0, assignments: a, filled, open, missing: Math.max(0, (dem[gw.id] ?? 0) - filled - open) };
  });
  const checks = all('SELECT * FROM checks WHERE shift_id=?', s.id);
  const report = get('SELECT r.*,p.name person_name FROM reports r LEFT JOIN people p ON p.id=r.person_id WHERE shift_id=?', s.id);
  const todos = all('SELECT t.*,p.name done_name FROM todos t LEFT JOIN people p ON p.id=t.done_by WHERE shift_id=? ORDER BY done,id', s.id);
  const missing = g.reduce((n, x) => n + x.missing, 0);
  return { ...s, performances: perfs, gewerke: g, status: missing ? 'offen' : 'voll', missing, checks, report, todos, peak: isPeak(s.date), holiday: isHoliday(s.date) };
}

// ---------- Stunden / Warnungen ----------
function personStats(pid, month) {
  const rows = all(`SELECT a.*,s.date,s.start,s.end,s.kind,g.rate,g.name gname,g.id gid,g.lead_min,g.lead_handover_min FROM assignments a JOIN shifts s ON s.id=a.shift_id JOIN gewerke g ON g.id=a.gewerk_id
    WHERE a.person_id=? AND a.status!='frei' ${month ? 'AND substr(s.date,1,7)=?' : ''} ORDER BY s.date,s.start`, ...(month ? [pid, month] : [pid]));
  let hours = 0, pay = 0; const days = {};
  const lines = rows.map(r => {
    const s = { id: r.shift_id, date: r.date, start: r.start, end: r.end, kind: r.kind }, gw = { id: r.gid, lead_min: r.lead_min, lead_handover_min: r.lead_handover_min };
    const h = hoursOf(s, gw, r); hours += h; pay += h * r.rate; days[r.date] = (days[r.date] || 0) + h;
    return { date: r.date, kind: r.kind, gewerk: r.gname, arrive: arrival(s, gw, r), end: r.actual_end || r.end, hours: h, rate: r.rate, pay: Math.round(h * r.rate * 100) / 100, holiday: isHoliday(r.date) };
  });
  const rules = setting('rules');
  const warnings = [];
  const p = get('SELECT * FROM people WHERE id=?', pid);
  if (p && month) {
    const limit = month.startsWith('2027') ? rules.minijob_2027 : rules.minijob_2026;
    if (p.employment === 'minijob' && pay > limit) warnings.push(`Minijob-Grenze ${limit} € überschritten (${pay.toFixed(0)} €)`);
    if (hours > p.budget_month) warnings.push(`Monatsbudget ${p.budget_month} h überschritten (${hours.toFixed(1)} h)`);
    Object.entries(days).filter(([, h]) => h > rules.max_day_h).forEach(([d, h]) => warnings.push(`${d}: ${h.toFixed(1)} h am Tag (max. ${rules.max_day_h})`));
  }
  return { hours: Math.round(hours * 10) / 10, pay: Math.round(pay * 100) / 100, lines, warnings };
}

// ---------- Spielplan-Import (maerchenhuetten.com) ----------
async function importSpielplan(pid) {
  const season = setting('season');
  const found = []; const seen = new Set();
  for (let page = 1; page <= 20; page++) {
    const url = page === 1 ? 'https://maerchenhuetten.com/spielplan/' : `https://maerchenhuetten.com/spielplan/page/${page}/`;
    let html;
    try { const r = await fetch(url, { headers: { 'user-agent': 'Huettenplan/1.0' } }); if (!r.ok) break; html = await r.text(); } catch (e) { break; }
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<h2[^>]*>/gi, '\n@@H2 ').replace(/<\/h2>/gi, ' @@/H2\n').replace(/<[^>]+>/g, '\n')
      .replace(/&amp;/g, '&').replace(/&#8211;|&ndash;/g, '–').replace(/&#038;/g, '&').replace(/&quot;/g, '"').replace(/&#8217;/g, '’').replace(/&nbsp;/g, ' ');
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let cur = null, n = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const md = l.match(/^(?:Mo|Di|Mi|Do|Fr|Sa|So)[a-z]*\.?,?\s*(\d{1,2})\.(\d{1,2})\.?(\d{4})?/);
      if (md) { cur = { d: md[1].padStart(2, '0'), m: md[2].padStart(2, '0'), y: md[3] }; continue; }
      const mt = l.match(/^(\d{1,2}):(\d{2})\s*Uhr/);
      if (mt && cur) { cur.t = mt[1].padStart(2, '0') + ':' + mt[2]; continue; }
      const mh = l.match(/@@H2\s*(.*?)\s*@@\/H2/);
      if (mh && cur && cur.t) {
        const title = mh[1].replace(/\s+/g, ' ').trim();
        const rest = lines.slice(i + 1, i + 6).join(' ');
        const audience = /Nur für Erwachsene/i.test(rest) ? 'Erwachsene' : /Familienvorstellung/i.test(rest) ? 'Familie' : /Zu Gast/i.test(rest) ? 'Gastspiel' : (toMin(cur.t) < 12 * 60 ? 'Kinder' : 'Erwachsene');
        let y = cur.y || (cur.m >= '07' ? season.start.slice(0, 4) : season.end.slice(0, 4));
        const date = `${y}-${cur.m}-${cur.d}`;
        const key = date + cur.t + title;
        if (!seen.has(key)) { seen.add(key); found.push({ date, time: cur.t, title, audience }); n++; }
        cur.t = null;
      }
    }
    if (!n) break;
  }
  if (!found.length) return { ok: false, error: 'Keine Termine erkannt. Seite nicht erreichbar oder Aufbau geändert. Bitte Spielplan per CSV einspielen.' };
  const ins = q('INSERT OR IGNORE INTO performances(date,time,title,audience,source) VALUES(?,?,?,?,?)');
  let added = 0; found.forEach(f => { if (ins.run(f.date, f.time, f.title, f.audience, 'import').changes) added++; });
  const created = regenerateShifts(pid);
  log(pid, 'spielplan.import', `${found.length} gelesen, ${added} neu, ${created} Schichten neu`);
  return { ok: true, read: found.length, added, shifts: created };
}

if (setting('needs_generate')) { regenerateShifts(null); setSetting('needs_generate', false); }


// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { ok({}); } }); });
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]));

function auth(req) {
  const c = cookies(req);
  const tok = c.hp || new URL(req.url, 'http://x').searchParams.get('token');
  if (!tok) return null;
  return get('SELECT * FROM people WHERE token=? AND active=1', tok) || null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const me = auth(req);
  const admin = me && me.role === 'admin';
  const body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {};
  const need = (cond, msg = 'Nicht erlaubt') => { if (!cond) throw Object.assign(new Error(msg), { status: 403 }); return true; };

  try {
    // --- Login ---
    if (p === '/api/login' && req.method === 'POST') {
      const pin = String(body.pin || '').trim();
      const person = get('SELECT * FROM people WHERE pin=? AND active=1', pin);
      if (!person) return json(res, 401, { error: 'PIN unbekannt' });
      res.setHeader('set-cookie', `hp=${person.token}; Path=/; Max-Age=31536000; SameSite=Lax`);
      log(person.id, 'login', '');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/logout') { res.setHeader('set-cookie', 'hp=; Path=/; Max-Age=0'); return json(res, 200, { ok: true }); }
    if (p === '/api/me') return json(res, 200, me ? { ...me, pin: undefined, gewerke: JSON.parse(me.gewerke || '[]') } : null);

    // --- ICS (per Token) ---
    if (p === '/ics' || p.endsWith('.ics')) {
      if (!me) { res.writeHead(401); return res.end('token?'); }
      const st = personStats(me.id, null);
      const esc = s => String(s).replace(/[,;]/g, m => '\\' + m);
      let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Huettenplan//DE\r\nX-WR-CALNAME:Märchenhütten Schichten\r\n';
      for (const l of st.lines) {
        const d = l.date.replace(/-/g, ''); const endD = toMin(l.end) < toMin(l.arrive) ? addDays(l.date, 1).replace(/-/g, '') : d;
        ics += `BEGIN:VEVENT\r\nUID:${d}${l.arrive.replace(':', '')}${l.gewerk}@huettenplan\r\nDTSTART;TZID=Europe/Berlin:${d}T${l.arrive.replace(':', '')}00\r\nDTEND;TZID=Europe/Berlin:${endD}T${l.end.replace(':', '')}00\r\nSUMMARY:${esc(l.gewerk)} Märchenhütten\r\nDESCRIPTION:Kommzeit ${l.arrive} (${l.kind}schicht)\r\nLOCATION:Märchenhütten Monbijoupark\r\nEND:VEVENT\r\n`;
      }
      ics += 'END:VCALENDAR\r\n';
      res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8' }); return res.end(ics);
    }

    if (p.startsWith('/api/')) {
      if (!me) return json(res, 401, { error: 'Bitte anmelden' });

      // --- Events ---
      if (p === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write('data: {"type":"hello"}\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
      }

      // --- Stammdaten ---
      if (p === '/api/bootstrap') {
        const people = all('SELECT id,name,phone,email,role,employment,budget_month,budget_week,gewerke,notes,active FROM people ORDER BY name').map(x => ({ ...x, gewerke: JSON.parse(x.gewerke || '[]'), phone: admin || x.id === me.id ? x.phone : (x.phone ? x.phone : ''), email: admin || x.id === me.id ? x.email : '' }));
        return json(res, 200, { me: { ...me, pin: undefined, gewerke: JSON.parse(me.gewerke || '[]') }, people, gewerke: all('SELECT * FROM gewerke ORDER BY sort'), season: setting('season'), rules: setting('rules'), checklist: all('SELECT * FROM checklist ORDER BY gewerk_id,phase,sort') });
      }

      // --- Plan ---
      if (p === '/api/shifts') {
        const from = url.searchParams.get('from') || setting('season').start, to = url.searchParams.get('to') || setting('season').end;
        const shifts = all('SELECT * FROM shifts WHERE date>=? AND date<=? ORDER BY date,kind DESC', from, to).map(shiftView);
        const avail = all('SELECT * FROM availability WHERE date>=? AND date<=?', from, to);
        // Budget-Ampel je Person und Monat: ok / warn (>85 %) / bad (Budget oder Minijob-Grenze überschritten)
        const months = [...new Set(shifts.map(s => s.date.slice(0, 7)))];
        const budget = {};
        for (const pp of all('SELECT id,budget_month FROM people WHERE active=1')) for (const mo of months) {
          const st = personStats(pp.id, mo); const pct = st.hours / (pp.budget_month || 1);
          budget[`${pp.id}:${mo}`] = { hours: st.hours, level: st.warnings.length || pct > 1 ? 'bad' : pct > 0.85 ? 'warn' : 'ok' };
        }
        return json(res, 200, { shifts, availability: avail, budget });
      }
      const ms = p.match(/^\/api\/shifts\/(\d+)$/);
      if (ms) {
        const s = get('SELECT * FROM shifts WHERE id=?', ms[1]); if (!s) return json(res, 404, {});
        if (req.method === 'GET') return json(res, 200, shiftView(s));
        if (req.method === 'PUT' && need(admin)) {
          run('UPDATE shifts SET start=?,end=?,note=?,manual=1 WHERE id=?', body.start || s.start, body.end || s.end, body.note ?? s.note, s.id);
          if (body.demand) for (const [g, c] of Object.entries(body.demand)) run('INSERT INTO demand(shift_id,gewerk_id,count) VALUES(?,?,?) ON CONFLICT DO UPDATE SET count=excluded.count', s.id, g, c);
          log(me.id, 'shift.edit', `${s.date} ${s.kind}`); broadcast({ type: 'shifts' }); return json(res, 200, shiftView(s));
        }
        if (req.method === 'DELETE' && need(admin)) { run('DELETE FROM assignments WHERE shift_id=?', s.id); run('DELETE FROM demand WHERE shift_id=?', s.id); run('DELETE FROM shifts WHERE id=?', s.id); log(me.id, 'shift.delete', `${s.date} ${s.kind}`); broadcast({ type: 'shifts' }); return json(res, 200, { ok: true }); }
      }
      if (p === '/api/shifts' && req.method === 'POST' && need(admin)) {
        const r = run('INSERT INTO shifts(date,kind,start,end,manual,note) VALUES(?,?,?,?,1,?)', body.date, body.kind || 'abend', body.start || '17:00', body.end || '23:00', body.note || '');
        const sid = Number(r.lastInsertRowid);
        for (const g of all('SELECT * FROM gewerke WHERE active=1')) run('INSERT INTO demand VALUES(?,?,?)', sid, g.id, body.kind === 'tag' ? g.demand_day : g.demand_eve);
        log(me.id, 'shift.create', `${body.date} ${body.kind}`); broadcast({ type: 'shifts' }); return json(res, 200, shiftView(get('SELECT * FROM shifts WHERE id=?', sid)));
      }
      if (p === '/api/shifts/regenerate' && req.method === 'POST' && need(admin)) { const n = regenerateShifts(me.id); broadcast({ type: 'shifts' }); return json(res, 200, { created: n }); }

      // --- Zuweisungen ---
      if (p === '/api/assign' && req.method === 'POST') {
        const s = get('SELECT * FROM shifts WHERE id=?', body.shift_id); const gw = get('SELECT * FROM gewerke WHERE id=?', body.gewerk_id);
        if (!s || !gw) return json(res, 400, { error: 'Schicht/Gewerk fehlt' });
        const pid = admin && body.person_id ? body.person_id : me.id;
        const person = get('SELECT * FROM people WHERE id=?', pid);
        if (!admin && !JSON.parse(person.gewerke || '[]').includes(gw.id)) return json(res, 403, { error: 'Dieses Gewerk ist dir nicht zugeordnet' });
        if (get("SELECT 1 FROM assignments WHERE shift_id=? AND person_id=? AND status!='frei'", s.id, pid)) return json(res, 400, { error: 'Person ist in dieser Schicht schon eingeteilt' });
        if (body.take_id) { // freie Schicht übernehmen
          const a = get("SELECT * FROM assignments WHERE id=? AND status='frei'", body.take_id); if (!a) return json(res, 400, { error: 'Schicht ist nicht mehr frei' });
          const mode = setting('rules').swap_mode;
          run('UPDATE assignments SET person_id=?,status=?,arrive=NULL WHERE id=?', pid, mode === 'approve' && !admin ? 'angefragt' : 'fest', a.id);
          log(me.id, 'shift.take', `${person.name} übernimmt ${gw.name} am ${s.date} (${s.kind})`);
        } else {
          const dem = get('SELECT count FROM demand WHERE shift_id=? AND gewerk_id=?', s.id, gw.id)?.count ?? 0;
          const filled = get("SELECT count(*) n FROM assignments WHERE shift_id=? AND gewerk_id=? AND status!='frei'", s.id, gw.id).n;
          if (!admin && filled >= dem) return json(res, 400, { error: 'Dieses Gewerk ist in der Schicht schon voll besetzt' });
          run('INSERT INTO assignments(shift_id,gewerk_id,person_id,status,created) VALUES(?,?,?,?,?)', s.id, gw.id, pid, 'fest', now());
          log(me.id, 'shift.assign', `${person.name} → ${gw.name} ${s.date} (${s.kind})`);
        }
        const st = personStats(pid, s.date.slice(0, 7));
        broadcast({ type: 'shifts' }); return json(res, 200, { ok: true, warnings: st.warnings });
      }
      const ma = p.match(/^\/api\/assign\/(\d+)$/);
      if (ma) {
        const a = get('SELECT * FROM assignments WHERE id=?', ma[1]); if (!a) return json(res, 404, {});
        const s = get('SELECT * FROM shifts WHERE id=?', a.shift_id); const gw = get('SELECT name FROM gewerke WHERE id=?', a.gewerk_id);
        if (!admin && a.person_id !== me.id) return json(res, 403, { error: 'Nicht deine Schicht' });
        if (req.method === 'DELETE') { run('DELETE FROM assignments WHERE id=?', a.id); log(me.id, 'shift.unassign', `${gw.name} ${s.date} (${s.kind}) entfernt`); broadcast({ type: 'shifts' }); return json(res, 200, { ok: true }); }
        if (req.method === 'PUT') {
          if (body.action === 'release') { run("UPDATE assignments SET status='frei',released_by=?,note=? WHERE id=?", a.person_id, body.note || '', a.id); const pn = get('SELECT name FROM people WHERE id=?', a.person_id)?.name; log(me.id, 'shift.release', `${pn} gibt ${gw.name} am ${s.date} (${s.kind}) frei`); run('INSERT INTO messages(channel,person_id,text,ts) VALUES(?,?,?,?)', 'allgemein', me.id, `🔄 Schicht frei: ${gw.name} am ${s.date} (${s.kind}schicht)${body.note ? ' – ' + body.note : ''}`, now()); broadcast({ type: 'chat' }); }
          else if (body.action === 'approve' && need(admin)) { run("UPDATE assignments SET status='fest' WHERE id=?", a.id); log(me.id, 'shift.approve', `${gw.name} ${s.date}`); }
          else if (body.action === 'times') { run('UPDATE assignments SET arrive=?,actual_start=?,actual_end=? WHERE id=?', body.arrive || null, body.actual_start || null, body.actual_end || null, a.id); log(me.id, 'shift.times', `${gw.name} ${s.date}: ${body.actual_start || '-'}–${body.actual_end || '-'}`); }
          broadcast({ type: 'shifts' }); return json(res, 200, { ok: true });
        }
      }

      // --- Verfügbarkeit ---
      if (p === '/api/availability' && req.method === 'POST') {
        const pid = admin && body.person_id ? body.person_id : me.id;
        if (!body.status) run('DELETE FROM availability WHERE person_id=? AND date=?', pid, body.date);
        else run('INSERT INTO availability VALUES(?,?,?,?) ON CONFLICT DO UPDATE SET status=excluded.status,note=excluded.note', pid, body.date, body.status, body.note || '');
        broadcast({ type: 'shifts' }); return json(res, 200, { ok: true });
      }
      if (p === '/api/availability') return json(res, 200, all('SELECT * FROM availability WHERE person_id=?', me.id));

      // --- Leute ---
      if (p === '/api/people' && req.method === 'POST' && need(admin)) {
        const pin = body.pin || String(Math.floor(1000 + Math.random() * 9000));
        if (get('SELECT 1 FROM people WHERE pin=?', pin)) return json(res, 400, { error: 'PIN schon vergeben' });
        const r = run('INSERT INTO people(name,phone,email,pin,token,role,employment,budget_month,budget_week,gewerke,notes,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', body.name, body.phone || '', body.email || '', pin, crypto.randomBytes(12).toString('hex'), body.role || 'staff', body.employment || 'minijob', body.budget_month ?? 40, body.budget_week ?? 20, JSON.stringify(body.gewerke || []), body.notes || '', now());
        log(me.id, 'person.create', body.name); broadcast({ type: 'people' }); return json(res, 200, { id: Number(r.lastInsertRowid), pin });
      }
      const mp = p.match(/^\/api\/people\/(\d+)$/);
      if (mp) {
        const id = Number(mp[1]); const pr = get('SELECT * FROM people WHERE id=?', id); if (!pr) return json(res, 404, {});
        if (req.method === 'GET') { if (!admin && id !== me.id) return json(res, 403, {}); return json(res, 200, { ...pr, gewerke: JSON.parse(pr.gewerke || '[]'), pin: admin || id === me.id ? pr.pin : undefined, token: id === me.id || admin ? pr.token : undefined }); }
        if (req.method === 'PUT') {
          if (admin) run('UPDATE people SET name=?,phone=?,email=?,role=?,employment=?,budget_month=?,budget_week=?,gewerke=?,notes=?,active=?,pin=? WHERE id=?', body.name ?? pr.name, body.phone ?? pr.phone, body.email ?? pr.email, body.role ?? pr.role, body.employment ?? pr.employment, body.budget_month ?? pr.budget_month, body.budget_week ?? pr.budget_week, JSON.stringify(body.gewerke ?? JSON.parse(pr.gewerke || '[]')), body.notes ?? pr.notes, body.active ?? pr.active, body.pin ?? pr.pin, id);
          else if (id === me.id) run('UPDATE people SET phone=?,email=?,pin=? WHERE id=?', body.phone ?? pr.phone, body.email ?? pr.email, body.pin ?? pr.pin, id);
          else return json(res, 403, {});
          log(me.id, 'person.edit', pr.name); broadcast({ type: 'people' }); return json(res, 200, { ok: true });
        }
        if (req.method === 'DELETE' && need(admin)) { run('UPDATE people SET active=0 WHERE id=?', id); log(me.id, 'person.deactivate', pr.name); broadcast({ type: 'people' }); return json(res, 200, { ok: true }); }
      }

      // --- Stunden ---
      if (p === '/api/hours') {
        const month = url.searchParams.get('month');
        const ids = admin ? all('SELECT id,name,employment,budget_month FROM people WHERE active=1 ORDER BY name') : [{ id: me.id, name: me.name, employment: me.employment, budget_month: me.budget_month }];
        return json(res, 200, ids.map(pp => ({ ...pp, ...personStats(pp.id, month) })));
      }
      if (p === '/api/hours.csv' && need(admin)) {
        const month = url.searchParams.get('month');
        let csv = 'Name;Beschäftigung;Datum;Schicht;Gewerk;Kommzeit;Ende;Stunden;Satz;Betrag;Sonn/Feiertag\n';
        for (const pp of all('SELECT id,name,employment FROM people WHERE active=1 ORDER BY name')) for (const l of personStats(pp.id, month).lines) csv += `${pp.name};${pp.employment};${l.date};${l.kind};${l.gewerk};${l.arrive};${l.end};${String(l.hours).replace('.', ',')};${String(l.rate).replace('.', ',')};${String(l.pay).replace('.', ',')};${l.holiday ? 'ja' : ''}\n`;
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="stunden-${month || 'alle'}.csv"` }); return res.end('﻿' + csv);
      }

      // --- Chat ---
      if (p === '/api/messages') {
        if (req.method === 'GET') { const ch = url.searchParams.get('channel') || 'allgemein'; return json(res, 200, all('SELECT m.*,p.name FROM messages m LEFT JOIN people p ON p.id=m.person_id WHERE channel=? ORDER BY m.id DESC LIMIT 200', ch).reverse()); }
        if (req.method === 'POST') { if (!body.text?.trim()) return json(res, 400, {}); run('INSERT INTO messages(channel,person_id,text,ts,pinned) VALUES(?,?,?,?,?)', body.channel || 'allgemein', me.id, body.text.trim(), now(), admin && body.pinned ? 1 : 0); broadcast({ type: 'chat', channel: body.channel || 'allgemein' }); return json(res, 200, { ok: true }); }
      }
      if (p === '/api/channels') return json(res, 200, all("SELECT channel, count(*) n, max(ts) last FROM messages GROUP BY channel ORDER BY last DESC"));
      const mm = p.match(/^\/api\/messages\/(\d+)$/);
      if (mm && req.method === 'DELETE') { const m = get('SELECT * FROM messages WHERE id=?', mm[1]); if (m && (admin || m.person_id === me.id)) run('DELETE FROM messages WHERE id=?', m.id); broadcast({ type: 'chat' }); return json(res, 200, { ok: true }); }
      if (mm && req.method === 'PUT' && need(admin)) { run('UPDATE messages SET pinned=? WHERE id=?', body.pinned ? 1 : 0, mm[1]); broadcast({ type: 'chat' }); return json(res, 200, { ok: true }); }

      // --- Checkliste / Todos / Bericht ---
      if (p === '/api/check' && req.method === 'POST') { if (body.done) run('INSERT OR REPLACE INTO checks VALUES(?,?,?,?)', body.shift_id, body.item_id, me.id, now()); else run('DELETE FROM checks WHERE shift_id=? AND item_id=?', body.shift_id, body.item_id); broadcast({ type: 'shifts' }); return json(res, 200, { ok: true }); }
      if (p === '/api/todos' && req.method === 'POST') { run('INSERT INTO todos(gewerk_id,shift_id,text,created_by,ts) VALUES(?,?,?,?,?)', body.gewerk_id || null, body.shift_id || null, body.text, me.id, now()); log(me.id, 'todo.create', body.text); broadcast({ type: 'shifts' }); return json(res, 200, { ok: true }); }
      if (p === '/api/todos' && req.method === 'GET') return json(res, 200, all('SELECT t.*,p.name done_name,s.date,s.kind FROM todos t LEFT JOIN people p ON p.id=t.done_by LEFT JOIN shifts s ON s.id=t.shift_id ORDER BY done,t.id DESC'));
      const mt = p.match(/^\/api\/todos\/(\d+)$/);
      if (mt && req.method === 'PUT') { run('UPDATE todos SET done=?,done_by=?,done_ts=? WHERE id=?', body.done ? 1 : 0, body.done ? me.id : null, body.done ? now() : null, mt[1]); broadcast({ type: 'shifts' }); return json(res, 200, { ok: true }); }
      if (mt && req.method === 'DELETE') { run('DELETE FROM todos WHERE id=?', mt[1]); broadcast({ type: 'shifts' }); return json(res, 200, { ok: true }); }
      if (p === '/api/report' && req.method === 'POST') { run('INSERT INTO reports(shift_id,person_id,text,visitors,cash,incidents,ts) VALUES(?,?,?,?,?,?,?) ON CONFLICT(shift_id) DO UPDATE SET person_id=excluded.person_id,text=excluded.text,visitors=excluded.visitors,cash=excluded.cash,incidents=excluded.incidents,ts=excluded.ts', body.shift_id, me.id, body.text || '', body.visitors ?? null, body.cash ?? null, body.incidents || '', now()); log(me.id, 'report', `Schichtbericht ${body.shift_id}`); broadcast({ type: 'shifts' }); return json(res, 200, { ok: true }); }
      if (p === '/api/reports') return json(res, 200, all('SELECT r.*,p.name,s.date,s.kind FROM reports r LEFT JOIN people p ON p.id=r.person_id JOIN shifts s ON s.id=r.shift_id ORDER BY s.date DESC'));

      // --- Spielplan ---
      if (p === '/api/performances' && req.method === 'GET') return json(res, 200, all('SELECT * FROM performances ORDER BY date,time'));
      if (p === '/api/performances' && req.method === 'POST' && need(admin)) {
        if (body.csv) { let n = 0; for (const line of body.csv.split('\n')) { const [d, t, ti, a] = line.split(/[;|\t]/).map(x => x?.trim()); if (/^\d{4}-\d{2}-\d{2}$/.test(d || '') && /^\d{2}:\d{2}$/.test(t || '')) n += run('INSERT OR IGNORE INTO performances(date,time,title,audience,source) VALUES(?,?,?,?,?)', d, t, ti || '', a || '', 'manuell').changes; } const c = regenerateShifts(me.id); log(me.id, 'spielplan.csv', `${n} Termine`); broadcast({ type: 'shifts' }); return json(res, 200, { added: n, shifts: c }); }
        run('INSERT OR IGNORE INTO performances(date,time,title,audience,source) VALUES(?,?,?,?,?)', body.date, body.time, body.title, body.audience || '', 'manuell'); regenerateShifts(me.id); broadcast({ type: 'shifts' }); return json(res, 200, { ok: true });
      }
      const mpf = p.match(/^\/api\/performances\/(\d+)$/);
      if (mpf && req.method === 'DELETE' && need(admin)) { run('DELETE FROM performances WHERE id=?', mpf[1]); broadcast({ type: 'shifts' }); return json(res, 200, { ok: true }); }
      if (p === '/api/performances/import' && req.method === 'POST' && need(admin)) { const r = await importSpielplan(me.id); broadcast({ type: 'shifts' }); return json(res, 200, r); }

      // --- Einstellungen ---
      if (p === '/api/settings' && req.method === 'PUT' && need(admin)) {
        if (body.rules) setSetting('rules', { ...setting('rules'), ...body.rules });
        if (body.season) setSetting('season', { ...setting('season'), ...body.season });
        if (body.gewerke) for (const g of body.gewerke) { if (g.id) run('UPDATE gewerke SET name=?,short=?,rate=?,lead_min=?,lead_handover_min=?,demand_day=?,demand_eve=?,demand_eve_peak=?,color=?,sort=?,active=? WHERE id=?', g.name, g.short, g.rate, g.lead_min, g.lead_handover_min, g.demand_day, g.demand_eve, g.demand_eve_peak, g.color, g.sort ?? 0, g.active ?? 1, g.id); else { const r = run('INSERT INTO gewerke(name,short,rate,lead_min,lead_handover_min,demand_day,demand_eve,demand_eve_peak,color,sort) VALUES(?,?,?,?,?,?,?,?,?,?)', g.name, g.short, g.rate, g.lead_min, g.lead_handover_min, g.demand_day, g.demand_eve, g.demand_eve_peak, g.color || '#666', g.sort ?? 99); for (const s of all('SELECT id FROM shifts')) run('INSERT OR IGNORE INTO demand VALUES(?,?,0)', s.id, Number(r.lastInsertRowid)); } }
        if (body.checklist) { run('DELETE FROM checklist'); body.checklist.forEach((c, i) => run('INSERT INTO checklist(gewerk_id,text,phase,sort) VALUES(?,?,?,?)', c.gewerk_id, c.text, c.phase || 'start', i)); }
        log(me.id, 'settings', Object.keys(body).join(',')); broadcast({ type: 'settings' }); return json(res, 200, { ok: true });
      }
      if (p === '/api/log') { if (!admin) return json(res, 403, {}); return json(res, 200, all('SELECT l.*,p.name FROM log l LEFT JOIN people p ON p.id=l.person_id ORDER BY l.id DESC LIMIT 300')); }
      if (p === '/api/backup' && need(admin)) { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="huettenplan-backup.sqlite"' }); db.exec('PRAGMA wal_checkpoint(FULL)'); return fs.createReadStream(path.join(DATA_DIR, 'huettenplan.sqlite')).pipe(res); }
      return json(res, 404, { error: 'unbekannt' });
    }

    // --- static ---
    let f = p === '/' ? '/index.html' : p;
    f = path.join(__dirname, 'public', path.normalize(f).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(f)) { f = path.join(__dirname, 'public', 'index.html'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    if (!e.status) console.error(e);
    if (res.headersSent) return res.end();
    json(res, e.status || 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`Hüttenplan läuft auf http://localhost:${PORT}  (Admin-PIN beim ersten Start: 1234)`));

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

for (const sql of ['ALTER TABLE gewerke ADD COLUMN end_after_last INTEGER', "ALTER TABLE people ADD COLUMN fixed INTEGER DEFAULT 0", "ALTER TABLE people ADD COLUMN main_gewerke TEXT DEFAULT '[]'", "ALTER TABLE people ADD COLUMN aliases TEXT DEFAULT ''", "ALTER TABLE people ADD COLUMN available_from TEXT DEFAULT ''", "ALTER TABLE people ADD COLUMN available_until TEXT DEFAULT ''", 'ALTER TABLE assignments ADD COLUMN plan_end TEXT']) {
  try { db.exec(sql); } catch (e) { /* Spalte existiert schon */ }
}
const q = (sql) => db.prepare(sql);
const all = (sql, ...p) => q(sql).all(...p);
const get = (sql, ...p) => q(sql).get(...p);
const planCache = new Map(); // Arbeitstage je Datum; wird bei Änderungen an Spielplan, Gewerken und Regeln geleert
const run = (sql, ...p) => { if (/performances|gewerke|settings/i.test(sql)) planCache.clear(); return q(sql).run(...p); };
const now = () => new Date().toISOString();
const setting = (k, d) => { const r = get('SELECT value FROM settings WHERE key=?', k); return r ? JSON.parse(r.value) : d; };
const setSetting = (k, v) => run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(v));
const clients = new Set();
function broadcast(msg) { const s = `data: ${JSON.stringify(msg)}\n\n`; for (const c of clients) c.write(s); }
const log = (pid, action, detail) => { run('INSERT INTO log(ts,person_id,action,detail) VALUES(?,?,?,?)', now(), pid || null, action, detail || ''); broadcast({ type: 'log' }); };

// ---------- Seed ----------
if (!get('SELECT 1 FROM settings WHERE key=?', 'seeded')) {
  setSetting('season', { start: '2026-11-13', end: '2027-01-31', name: 'Märchenhütten Winter 2026/27' });
  setSetting('rules', { day_cutoff: '13:00', play_min: 60, after_min: 90, after_min_floor: 90, split_min: 360, max_shift_min: 360, split_mode: 'half', pause_min: 180, minijob_2026: 603, minijob_2027: 633, max_day_h: 10, rest_h: 11, peak_days: [5, 6, 0], peak_from: '2026-12-01', peak_to: '2026-12-31', swap_mode: 'direct' });
  setSetting('admin_pin', '1234');
  const gw = [
    ['Kasse', 'K', 15, 75, 0, 1, 1, 1, '#2f6fde'],
    ['Einlass', 'E', 15, 60, 0, 1, 1, 1, '#1f9d55'],
    ['Bühnenassistenz', 'BA', 16, 60, 0, 2, 2, 2, '#b7791f'],
    ['Abenddienstleitung', 'ADL', 18, 90, 0, 1, 1, 1, '#c53030'],
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

// Reparatur: Personen ohne PIN (früherer Fehler beim Speichern unter „Mein Plan“) bekommen wieder eine
for (const p of all("SELECT id,name,role FROM people WHERE pin IS NULL OR TRIM(pin)=''")) {
  let pin = p.role === 'admin' ? '1234' : '';
  while (!pin || get('SELECT 1 FROM people WHERE pin=?', pin)) pin = String(Math.floor(1000 + Math.random() * 9000));
  run('UPDATE people SET pin=? WHERE id=?', pin, p.id);
  console.log(`PIN-Reparatur: ${p.name} hat jetzt die PIN ${pin}`);
}

// ---------- Zeitlogik ----------
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toT = (m) => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const isPeak = (date) => { const r = setting('rules'); return date >= r.peak_from && date <= r.peak_to && r.peak_days.includes(dow(date)); };
const isHoliday = (d) => ['2026-12-25', '2026-12-26', '2027-01-01'].includes(d) || dow(d) === 0;

// Arbeitstag eines Tages aus dem Spielplan: erstes/letztes Stück (frühester/spätester Beginn), Arbeitsbeginn und -ende (Minuten,
// das Ende kann über 1440 liegen) und die Aufteilung in Schichten (day.parts, je Teil kind/s/e/ref). Regel split_mode:
//   'half'  Arbeitstag länger als split_min → gleich lange Schichten (Mitte, auf 5 min gerundet)
//   'pause' gibt es zwischen zwei Stücken eine Pause von mindestens pause_min (und ohne Überschneidung der Arbeitszeiten),
//           bekommt jeder Block eine eigene Schicht mit eigenem Beginn/Ende; sonst wie 'half'
//   'off'   nie teilen
// Zusätzlich gilt max_shift_min (Standard 360): ist eine Schicht länger, wird sie weiter in gleich lange Teile geteilt
// (höchstens 3 Schichten pro Tag: tag, mitte, abend); nur bei „nie teilen“ bleibt es bei einer Schicht.
function dayPlan(date) {
  if (planCache.has(date)) return planCache.get(date);
  const day = computeDayPlan(date); planCache.set(date, day); return day;
}
function computeDayPlan(date) {
  const rules = setting('rules');
  const ps = all('SELECT time FROM performances WHERE date=? ORDER BY time', date).map(p => toMin(p.time));
  if (!ps.length) return null;
  const lead = Math.max(0, ...all('SELECT lead_min FROM gewerke WHERE active=1').map(g => g.lead_min || 0));
  const after = Math.max(rules.after_min ?? 90, rules.after_min_floor ?? 0), play = rules.play_min ?? 0; // Nachlauf zählt ab Ende des letzten Stücks
  const mk = (a) => ({ first: a[0], last: a[a.length - 1], start: a[0] - lead, end: a[a.length - 1] + play + after });
  const day = mk(ps); day.total = day.end - day.start;
  const mode = rules.split_mode || 'half', maxLen = rules.max_shift_min || 0;
  const cut = (s, e, n, ref) => Array.from({ length: n }, (_, i) => ({ s: i ? s + Math.round((e - s) * i / n / 5) * 5 : s, e: i === n - 1 ? e : s + Math.round((e - s) * (i + 1) / n / 5) * 5, ref }));
  let parts = null;
  if (mode === 'pause') {
    let gi = -1, gap = 0;
    for (let i = 1; i < ps.length; i++) if (ps[i] - ps[i - 1] > gap) { gap = ps[i] - ps[i - 1]; gi = i; }
    if (gi > 0 && gap >= (rules.pause_min ?? 180)) {
      const b = [mk(ps.slice(0, gi)), mk(ps.slice(gi))];
      if (b[0].end < b[1].start) {
        parts = b.map(x => ({ s: x.start, e: x.end, ref: x }));
        if (maxLen) { // längsten Block weiter teilen, solange es höchstens 3 Schichten bleiben
          const i = parts[0].e - parts[0].s >= parts[1].e - parts[1].s ? 0 : 1, p = parts[i];
          if (p.e - p.s > maxLen && Math.ceil((p.e - p.s) / maxLen) === 2) parts.splice(i, 1, ...cut(p.s, p.e, 2, p.ref));
        }
      }
    }
  }
  if (!parts) {
    let n = 1;
    if (mode !== 'off') {
      if (day.total > (rules.split_min ?? 360)) n = 2;
      if (maxLen) n = Math.max(n, Math.ceil(day.total / maxLen));
    }
    parts = cut(day.start, day.end, Math.min(n, 3), day);
  }
  const kinds = parts.length === 1 ? [day.first < toMin(rules.day_cutoff) ? 'tag' : 'abend'] : parts.length === 2 ? ['tag', 'abend'] : ['tag', 'mitte', 'abend'];
  day.parts = parts.map((x, i) => ({ ...x, kind: kinds[i] }));
  day.split = day.parts.length > 1; day.mode = mode;
  return day;
}
// Arbeitsfenster eines Gewerks innerhalb einer Schicht (absolute Minuten): Beginn = erstes Stück − Vorlauf, Ende = Kassenregel
// (letztes Stück + Minuten) oder Ende des Arbeitstags; beides auf die Schicht zugeschnitten. Bei Teilung an der Pause gilt
// „erstes/letztes Stück“ für den Block der Schicht.
function shiftWin(shift) { const s = toMin(shift.start); let e = toMin(shift.end); if (e <= s) e += 1440; return [s, e]; }
function gwWindow(shift, gw) {
  const [ss, se] = shiftWin(shift), dp = dayPlan(shift.date);
  if (!dp) return [ss - (gw.lead_min || 0), se]; // von Hand angelegte Schicht ohne Vorstellungen: Beginn der Schicht = erstes Stück
  const ref = dp.parts.find(x => x.kind === shift.kind)?.ref || dp;
  const gs = ref.first - (gw.lead_min || 0), ge = gw.end_after_last != null ? ref.last + gw.end_after_last : ref.end;
  return [Math.max(ss, gs), Math.min(se, ge)];
}

function regenerateShifts(pid) {
  const rules = setting('rules');
  const dates = all('SELECT DISTINCT date FROM performances ORDER BY date');
  const gws = all('SELECT * FROM gewerke WHERE active=1');
  let created = 0;
  const fixed = setting('fixed_plan'); // Zeitraum eines 1:1 übernommenen Schichtplans: dort nichts automatisch anlegen oder ändern
  for (const { date } of dates) {
    if (fixed && date >= fixed.from && date <= fixed.to) continue;
    const dp = dayPlan(date);
    const want = dp.parts;
    for (const w of want) {
      const start = toT(w.s), end = toT(w.e);
      const ex = get('SELECT * FROM shifts WHERE date=? AND kind=?', date, w.kind);
      if (ex) { if (!ex.manual) run('UPDATE shifts SET start=?,end=? WHERE id=?', start, end, ex.id); continue; }
      const r = run('INSERT INTO shifts(date,kind,start,end) VALUES(?,?,?,?)', date, w.kind, start, end);
      const sid = Number(r.lastInsertRowid); created++;
      for (const g of gws) {
        const [a, e] = gwWindow({ date, kind: w.kind, start, end }, g);
        const c = e <= a ? 0 : w.kind === 'tag' ? g.demand_day : (isPeak(date) ? g.demand_eve_peak : g.demand_eve);
        run('INSERT INTO demand(shift_id,gewerk_id,count) VALUES(?,?,?)', sid, g.id, c);
      }
    }
    // nicht mehr benötigte, nicht von Hand angelegte Schicht ohne Einteilung entfernen (z. B. Tag zusammengefasst)
    for (const s of all('SELECT * FROM shifts WHERE date=? AND manual=0', date)) {
      if (want.some(w => w.kind === s.kind) || get('SELECT 1 FROM assignments WHERE shift_id=?', s.id)) continue;
      run('DELETE FROM demand WHERE shift_id=?', s.id); run('DELETE FROM shifts WHERE id=?', s.id);
    }
  }
  if (created) log(pid, 'shifts.generate', `${created} Schichten angelegt`);
  return created;
}

// Kommzeit/Ende je Gewerk (feste Vorlaufzeiten, Kassenende, Arbeitstagende), Ist-Zeiten gehen vor
function arrival(shift, gw, asg) {
  if (asg && asg.arrive) return asg.arrive;
  return toT(gwWindow(shift, gw)[0]);
}
function endOf(shift, gw, asg) { return asg?.plan_end || toT(gwWindow(shift, gw)[1]); } // plan_end: Ende laut übernommenem Schichtplan
function hoursOf(shift, gw, asg) {
  const a = asg.actual_start || arrival(shift, gw, asg), e = asg.actual_end || endOf(shift, gw, asg);
  let m = toMin(e) - toMin(a); if (m < 0) m += 1440; return Math.round(m / 6) / 10;
}

// Schichttausch: angebotene Schicht (status 'tausch') bleibt bei der Person, bis jemand Gleichqualifiziertes sie übernimmt.
// Gleichwertig sind dasselbe Gewerk und Kasse ↔ Einlass.
const SWAP_GROUPS = [['K', 'E']];
const swapWhen = (s) => `${+s.date.slice(8)}.${+s.date.slice(5, 7)}. (${{ tag: 'Tagschicht', mitte: 'Mittelschicht', abend: 'Abendschicht' }[s.kind] || s.kind}`;
function canTake(person, gw) {
  const mine = JSON.parse(person.gewerke || '[]');
  if (mine.includes(gw.id)) return true;
  const shorts = all('SELECT id,short FROM gewerke').filter(g => mine.includes(g.id)).map(g => g.short.toUpperCase());
  return SWAP_GROUPS.some(grp => grp.includes(gw.short.toUpperCase()) && shorts.some(x => grp.includes(x)));
}
// Arbeitszeit einer Person an einem Tag, die sich mit [a,e] überschneidet (andere Schichten)
function overlapOf(pid, date, shiftId, a, e) {
  for (const r of all("SELECT a.*,s.date,s.start,s.end,s.kind,g.id gid,g.name gname,g.lead_min,g.end_after_last FROM assignments a JOIN shifts s ON s.id=a.shift_id JOIN gewerke g ON g.id=a.gewerk_id WHERE a.person_id=? AND s.date=? AND s.id!=? AND a.status!='frei'", pid, date, shiftId)) {
    const sh = { id: r.shift_id, date: r.date, start: r.start, end: r.end, kind: r.kind }, g = { id: r.gid, lead_min: r.lead_min, end_after_last: r.end_after_last };
    const ra = toMin(arrival(sh, g, r)); let re = toMin(endOf(sh, g, r)); if (re <= ra) re += 1440;
    if (ra < e && a < re) return `${r.gname} ${toT(ra)}–${toT(re % 1440)}`;
  }
  return null;
}

function shiftView(s) {
  const gws = all('SELECT * FROM gewerke WHERE active=1 ORDER BY sort');
  const dem = Object.fromEntries(all('SELECT gewerk_id,count FROM demand WHERE shift_id=?', s.id).map(d => [d.gewerk_id, d.count]));
  const asgs = all('SELECT a.*,p.name person_name FROM assignments a LEFT JOIN people p ON p.id=a.person_id WHERE shift_id=? ORDER BY a.id', s.id);
  const [ws, we] = shiftWin(s);
  const perfs = all('SELECT time,title,audience FROM performances WHERE date=? ORDER BY time', s.date).filter(p => { const m = toMin(p.time); return m >= ws && m < we; });
  const g = gws.map(gw => {
    const a = asgs.filter(x => x.gewerk_id === gw.id).map(x => ({ ...x, arrive_calc: arrival(s, gw, x), end_calc: endOf(s, gw, x), hours: hoursOf(s, gw, x) }));
    const filled = a.filter(x => x.status !== 'frei' && x.person_id).length;
    const open = a.filter(x => x.status === 'frei').length, swap = a.filter(x => x.status === 'tausch').length;
    return { gewerk: gw, demand: dem[gw.id] ?? 0, assignments: a, filled, open, swap, missing: Math.max(0, (dem[gw.id] ?? 0) - filled - open) };
  });
  const checks = all('SELECT * FROM checks WHERE shift_id=?', s.id);
  const report = get('SELECT r.*,p.name person_name FROM reports r LEFT JOIN people p ON p.id=r.person_id WHERE shift_id=?', s.id);
  const todos = all('SELECT t.*,p.name done_name FROM todos t LEFT JOIN people p ON p.id=t.done_by WHERE shift_id=? ORDER BY done,id', s.id);
  const missing = g.reduce((n, x) => n + x.missing, 0);
  return { ...s, performances: perfs, gewerke: g, status: missing ? 'offen' : 'voll', missing, checks, report, todos, peak: isPeak(s.date), holiday: isHoliday(s.date) };
}

// Einlesen (Textliste/Excel) und Dienstplan-Planer: eigene Dateien, bekommen die Datenbank-Helfer
const importer = require('./importer.js')({ db, all, get, run, crypto, now, log, setting, setSetting });
const planner = require('./planer.js')({ all, get, run, setting, shiftView, gwWindow, log, now });

// ---------- Stunden / Warnungen ----------
function personStats(pid, month) {
  const rows = all(`SELECT a.*,s.date,s.start,s.end,s.kind,g.rate,g.name gname,g.id gid,g.lead_min,g.end_after_last FROM assignments a JOIN shifts s ON s.id=a.shift_id JOIN gewerke g ON g.id=a.gewerk_id
    WHERE a.person_id=? AND a.status!='frei' ${month ? 'AND substr(s.date,1,7)=?' : ''} ORDER BY s.date,s.start`, ...(month ? [pid, month] : [pid]));
  let hours = 0, pay = 0; const days = {};
  const lines = rows.map(r => {
    const s = { id: r.shift_id, date: r.date, start: r.start, end: r.end, kind: r.kind }, gw = { id: r.gid, lead_min: r.lead_min, end_after_last: r.end_after_last };
    const h = hoursOf(s, gw, r); hours += h; pay += h * r.rate; days[r.date] = (days[r.date] || 0) + h;
    return { date: r.date, kind: r.kind, gewerk: r.gname, arrive: arrival(s, gw, r), end: r.actual_end || endOf(s, gw, r), hours: h, rate: r.rate, pay: Math.round(h * r.rate * 100) / 100, holiday: isHoliday(r.date) };
  });
  const rules = setting('rules');
  const warnings = [];
  const p = get('SELECT * FROM people WHERE id=?', pid);
  if (p && month) {
    const limit = month.startsWith('2027') ? rules.minijob_2027 : rules.minijob_2026;
    if (p.employment === 'minijob' && pay > limit) warnings.push(`Minijob-Grenze ${limit} € überschritten (${pay.toFixed(0)} €)`);
    if (!p.fixed && hours > p.budget_month) warnings.push(`Monatsbudget ${p.budget_month} h überschritten (${hours.toFixed(1)} h)`);
    Object.entries(days).filter(([, h]) => h > rules.max_day_h).forEach(([d, h]) => warnings.push(`${d}: ${h.toFixed(1)} h am Tag (max. ${rules.max_day_h})`));
  }
  return { hours: Math.round(hours * 10) / 10, pay: Math.round(pay * 100) / 100, lines, warnings };
}

// ---------- Spielplan-Import (maerchenhuetten.com) ----------
async function importSpielplan(pid) {
  const season = setting('season');
  const found = []; const seen = new Set(); let netError = '';
  for (let page = 1; page <= 20; page++) {
    const url = page === 1 ? 'https://maerchenhuetten.com/spielplan/' : `https://maerchenhuetten.com/spielplan/page/${page}/`;
    let html;
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) Huettenplan/1.0' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) { if (page === 1) netError = `Seite antwortet mit Fehler ${r.status}`; break; }
      html = await r.text();
    } catch (e) { if (page === 1) netError = `maerchenhuetten.com nicht erreichbar (${e.cause?.code || e.name || e.message}) – Internetverbindung prüfen`; break; }
    // Titel steht in <h2>, die Stücke darin sind einzeln verlinkt: erst den Titel zu einer Zeile machen, dann alle Tags entfernen
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, x) => '\n@@H2 ' + x.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ') + ' @@/H2\n').replace(/<[^>]+>/g, '\n')
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
        const audience = /Nur für Erwachsene/i.test(rest) ? 'Erwachsene' : /Familienvorstellung|Kinder und Familien/i.test(rest) ? 'Familie' : /Zu Gast/i.test(rest) ? 'Gastspiel' : (toMin(cur.t) < 12 * 60 ? 'Kinder' : 'Erwachsene');
        let y = cur.y || (cur.m >= '07' ? season.start.slice(0, 4) : season.end.slice(0, 4));
        const date = `${y}-${cur.m}-${cur.d}`;
        const key = date + cur.t + title;
        if (!seen.has(key)) { seen.add(key); found.push({ date, time: cur.t, title, audience }); n++; }
        cur.t = null;
      }
    }
    if (!n) break;
  }
  if (!found.length) return { ok: false, error: netError || 'Seite erreichbar, aber keine Termine erkannt (Aufbau der Seite geändert?). Bitte Spielplan per CSV einspielen.' };
  // Abgleich: im Zeitraum der Webseite gilt die Webseite. Früher eingelesene Vorstellungen, die dort nicht mehr stehen
  // (abgesagt, verschoben, Titel anders geschrieben), werden entfernt; von Hand oder per CSV eingetragene bleiben.
  const d0 = found.reduce((a, f) => f.date < a ? f.date : a, found[0].date), d1 = found.reduce((a, f) => f.date > a ? f.date : a, found[0].date);
  const keep = new Set(found.map(f => f.date + f.time + f.title));
  const stale = all("SELECT id,date,time,title FROM performances WHERE source='import' AND date>=? AND date<=?", d0, d1).filter(p => !keep.has(p.date + p.time + p.title));
  for (const p of stale) run('DELETE FROM performances WHERE id=?', p.id);
  const ins = q('INSERT OR IGNORE INTO performances(date,time,title,audience,source) VALUES(?,?,?,?,?)');
  let added = 0; found.forEach(f => { if (ins.run(f.date, f.time, f.title, f.audience, 'import').changes) added++; });
  planCache.clear();
  const created = regenerateShifts(pid);
  log(pid, 'spielplan.import', `${found.length} gelesen, ${added} neu, ${stale.length} entfernt, ${created} Schichten neu`);
  return { ok: true, read: found.length, added, removed: stale.length, shifts: created, from: d0, to: d1 };
}

// Einmalige Umstellung auf die feste Zeitlogik (Vorläufe, Kassenende, Nachlauf, Schichtteilung)
if (!get("SELECT 1 FROM settings WHERE key='zeitlogik_v2'")) {
  setSetting('rules', { ...setting('rules'), after_min: 105, after_min_floor: 90, split_min: 360 });
  for (const [short, lead, endAfter] of [['K', 75, 30], ['E', 60, null], ['BA', 60, null], ['ADL', 120, null]]) run('UPDATE gewerke SET lead_min=?,end_after_last=? WHERE short=?', lead, endAfter, short);
  setSetting('zeitlogik_v2', true); setSetting('needs_generate', true);
}
// Einmalige Umstellung: ADL 90 min Vorlauf, Besetzung Kasse 1 / Einlass 1 (eine Person für beide Hütten) / BA 2 / ADL 1, Schichten höchstens 6 h
if (!get("SELECT 1 FROM settings WHERE key='zeitlogik_v3'")) {
  setSetting('rules', { ...setting('rules'), max_shift_min: 360 });
  run("UPDATE gewerke SET lead_min=90 WHERE short='ADL' AND lead_min=120");
  for (const [short, d, e, pk] of [['K', 1, 1, 1], ['E', 1, 1, 1], ['BA', 2, 2, 2], ['ADL', 1, 1, 1]]) run('UPDATE gewerke SET demand_day=?,demand_eve=?,demand_eve_peak=? WHERE short=?', d, e, pk, short);
  setSetting('zeitlogik_v3', true); setSetting('needs_generate', true);
}
// Einlass ist immer nur mit einer Person besetzt: Besetzung 1, wo nicht schon mehr Personen eingeteilt sind
if (!get("SELECT 1 FROM settings WHERE key='einlass1'")) {
  const e = get("SELECT id FROM gewerke WHERE short='E'");
  if (e) run("UPDATE demand SET count=1 WHERE gewerk_id=? AND count>1 AND (SELECT COUNT(*) FROM assignments a WHERE a.shift_id=demand.shift_id AND a.gewerk_id=demand.gewerk_id AND a.status!='frei')<=1", e.id);
  setSetting('einlass1', true);
}
// Einmalige Umstellung: Nachlauf zählt ab Ende des letzten Stücks (Beginn + Spieldauer 60 min), danach 90 min
if (!get("SELECT 1 FROM settings WHERE key='zeitlogik_v4'")) {
  setSetting('rules', { ...setting('rules'), play_min: 60, after_min: 90, after_min_floor: 90 });
  setSetting('zeitlogik_v4', true); setSetting('needs_generate', true);
}
// Einmalige Umstellung: freigegebene Schichten bleiben bei der Person, bis jemand übernimmt
if (!get("SELECT 1 FROM settings WHERE key='tausch_v1'")) { run("UPDATE assignments SET status='tausch' WHERE status='frei' AND person_id IS NOT NULL"); setSetting('tausch_v1', true); }
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

// ---------- Anmeldeschutz ----------
// Echte Absender-Adresse: hinter einem Tunnel (cloudflared) kommt alles von 127.0.0.1, dann zählt der Kopf des Tunnels
const clientIp = (req) => { const ra = req.socket.remoteAddress || ''; const local = /^(::1|127\.|::ffff:127\.)/.test(ra); return (local && (req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())) || ra; };
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || /"scheme":"https"/.test(String(req.headers['cf-visitor'] || ''));
// Nach 5 falschen PINs von einer Adresse 15 min Pause; insgesamt höchstens 50 Fehlversuche in 15 min (gegen verteiltes Raten)
const LOGIN_WIN = 15 * 60000, fails = new Map(); let allFails = [];
function loginBlocked(ip) {
  const t = Date.now(), f = (fails.get(ip) || []).filter(x => t - x < LOGIN_WIN); fails.set(ip, f); allFails = allFails.filter(x => t - x < LOGIN_WIN);
  const until = f.length >= 5 ? f[f.length - 5] + LOGIN_WIN : allFails.length >= 50 ? allFails[allFails.length - 50] + LOGIN_WIN : 0;
  return until > t ? Math.ceil((until - t) / 60000) : 0;
}
function loginFailed(ip) { const t = Date.now(); fails.set(ip, [...(fails.get(ip) || []), t]); allFails.push(t); log(null, 'login.fail', ip); }
function loginOk(ip) { fails.delete(ip); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const me = auth(req);
  const admin = me && me.role === 'admin';
  const body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {};
  const need = (cond, msg = 'Nicht erlaubt') => { if (!cond) { json(res, 403, { error: msg }); return false; } return true; };

  try {
    // --- Login ---
    if (p === '/api/login' && req.method === 'POST') {
      const ip = clientIp(req), wait = loginBlocked(ip);
      if (wait) return json(res, 429, { error: `Zu viele falsche PINs. Bitte in ${wait} min erneut versuchen.` });
      const pin = String(body.pin || '').trim();
      const person = /^\d{4}$/.test(pin) ? get('SELECT * FROM people WHERE pin=? AND active=1', pin) : null;
      if (!person) { loginFailed(ip); return json(res, 401, { error: 'PIN unbekannt' }); }
      loginOk(ip);
      res.setHeader('set-cookie', `hp=${person.token}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${isHttps(req) ? '; Secure' : ''}`);
      log(person.id, 'login', '');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/logout') { res.setHeader('set-cookie', `hp=; Path=/; Max-Age=0; HttpOnly${isHttps(req) ? '; Secure' : ''}`); return json(res, 200, { ok: true }); }
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
        const people = all('SELECT id,name,phone,email,role,employment,budget_month,budget_week,gewerke,main_gewerke,fixed,aliases,available_from,available_until,notes,active FROM people ORDER BY name').map(x => ({ ...x, gewerke: JSON.parse(x.gewerke || '[]'), main_gewerke: JSON.parse(x.main_gewerke || '[]'), phone: admin || x.id === me.id ? x.phone : (x.phone ? x.phone : ''), email: admin || x.id === me.id ? x.email : '' }));
        return json(res, 200, { me: { ...me, pin: undefined, weak_pin: me.role === 'admin' && me.pin === '1234', gewerke: JSON.parse(me.gewerke || '[]') }, people, gewerke: all('SELECT * FROM gewerke ORDER BY sort'), season: setting('season'), rules: setting('rules'), checklist: all('SELECT * FROM checklist ORDER BY gewerk_id,phase,sort') });
      }

      // --- Plan ---
      if (p === '/api/shifts' && req.method === 'GET') {
        const from = url.searchParams.get('from') || setting('season').start, to = url.searchParams.get('to') || setting('season').end;
        const shifts = all('SELECT * FROM shifts WHERE date>=? AND date<=? ORDER BY date,kind DESC', from, to).map(shiftView);
        const avail = all('SELECT * FROM availability WHERE date>=? AND date<=?', from, to);
        // Budget-Ampel je Person und Monat: ok / warn (>85 %) / bad (Budget oder Minijob-Grenze überschritten)
        const months = [...new Set(shifts.map(s => s.date.slice(0, 7)))];
        const budget = {};
        for (const pp of all('SELECT id,budget_month,fixed FROM people WHERE active=1')) for (const mo of months) {
          const st = personStats(pp.id, mo); const pct = pp.fixed ? 0 : st.hours / (pp.budget_month || 1); // „Schichten fix“: Kontingent = die eingetragenen Schichten
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
      // Arbeitsplatz (Platz eines Gewerks) in einer Schicht hinzufügen (delta +1) oder entfernen (delta -1)
      const mslot = p.match(/^\/api\/shifts\/(\d+)\/slots$/);
      if (mslot && req.method === 'POST' && need(admin)) {
        const s = get('SELECT * FROM shifts WHERE id=?', mslot[1]), g = get('SELECT * FROM gewerke WHERE id=?', body.gewerk_id);
        if (!s || !g) return json(res, 400, { error: 'Schicht/Arbeitsplatz fehlt' });
        const cur = get('SELECT count FROM demand WHERE shift_id=? AND gewerk_id=?', s.id, g.id)?.count ?? 0;
        if (body.delta < 0) {
          if (cur <= 0) return json(res, 400, { error: `Kein ${g.name}-Platz in dieser Schicht` });
          const sv = shiftView(s).gewerke.find(x => x.gewerk.id === g.id);
          if (!sv.missing) { // kein unbesetzter Platz: freigegebenen, sonst letzten eingeteilten Eintrag mit entfernen
            const a = sv.assignments.filter(x => x.status === 'frei').pop() || sv.assignments[sv.assignments.length - 1];
            if (a) run('DELETE FROM assignments WHERE id=?', a.id);
          }
        }
        run('INSERT INTO demand(shift_id,gewerk_id,count) VALUES(?,?,?) ON CONFLICT DO UPDATE SET count=excluded.count', s.id, g.id, body.delta < 0 ? cur - 1 : cur + 1);
        log(me.id, body.delta < 0 ? 'shift.slot.remove' : 'shift.slot.add', `${g.name} ${s.date} (${s.kind})`); broadcast({ type: 'shifts' });
        return json(res, 200, shiftView(s));
      }
      if (p === '/api/shifts' && req.method === 'POST' && need(admin)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) return json(res, 400, { error: 'Datum fehlt (JJJJ-MM-TT)' });
        if (get('SELECT 1 FROM shifts WHERE date=? AND kind=?', body.date, body.kind || 'abend')) return json(res, 400, { error: 'Diese Schicht gibt es an dem Tag schon' });
        const r = run('INSERT INTO shifts(date,kind,start,end,manual,note) VALUES(?,?,?,?,1,?)', body.date, body.kind || 'abend', body.start || '17:00', body.end || '23:00', body.note || '');
        const sid = Number(r.lastInsertRowid);
        for (const g of all('SELECT * FROM gewerke WHERE active=1')) run('INSERT INTO demand VALUES(?,?,?)', sid, g.id, body.kind === 'tag' ? g.demand_day : (isPeak(body.date) ? g.demand_eve_peak : g.demand_eve));
        log(me.id, 'shift.create', `${body.date} ${body.kind}`); broadcast({ type: 'shifts' }); return json(res, 200, shiftView(get('SELECT * FROM shifts WHERE id=?', sid)));
      }
      if (p === '/api/shifts/regenerate' && req.method === 'POST' && need(admin)) { const n = regenerateShifts(me.id); broadcast({ type: 'shifts' }); return json(res, 200, { created: n }); }

      // --- Zuweisungen ---
      if (p === '/api/assign' && req.method === 'POST') {
        const s = get('SELECT * FROM shifts WHERE id=?', body.shift_id); const gw = get('SELECT * FROM gewerke WHERE id=?', body.gewerk_id);
        if (!s || !gw) return json(res, 400, { error: 'Schicht/Gewerk fehlt' });
        const pid = admin && body.person_id ? body.person_id : me.id;
        const person = get('SELECT * FROM people WHERE id=?', pid);
        if (!admin && !(body.take_id ? canTake(person, gw) : JSON.parse(person.gewerke || '[]').includes(gw.id))) return json(res, 403, { error: body.take_id ? `Diese Schicht kannst du nicht übernehmen (${gw.name})` : 'Dieses Gewerk ist dir nicht zugeordnet' });
        if (get("SELECT 1 FROM assignments WHERE shift_id=? AND person_id=? AND status!='frei'", s.id, pid)) return json(res, 400, { error: 'Person ist in dieser Schicht schon eingeteilt' });
        if (body.take_id) { // freie Schicht übernehmen
          const a = get("SELECT * FROM assignments WHERE id=? AND status IN ('frei','tausch')", body.take_id); if (!a) return json(res, 400, { error: 'Schicht wird nicht mehr zum Tausch angeboten' });
          if (a.person_id === pid) return json(res, 400, { error: 'Das ist deine eigene Schicht' });
          if (!admin) { // keine Überschneidung mit einer anderen eigenen Schicht am selben Tag
            const g = get('SELECT * FROM gewerke WHERE id=?', a.gewerk_id), ra = toMin(arrival(s, g, a)); let re = toMin(endOf(s, g, a)); if (re <= ra) re += 1440;
            const clash = overlapOf(pid, s.date, s.id, ra, re); if (clash) return json(res, 400, { error: `Du arbeitest zu der Zeit schon (${clash})` });
          }
          const mode = setting('rules').swap_mode, from = get('SELECT name FROM people WHERE id=?', a.person_id)?.name;
          // Zeiten (Kommzeit/Ende laut Plan) gehören zum Platz und bleiben erhalten
          run('UPDATE assignments SET person_id=?,status=?,released_by=?,note=? WHERE id=?', pid, mode === 'approve' && !admin ? 'angefragt' : 'fest', a.person_id, '', a.id);
          log(me.id, 'shift.take', `${person.name} übernimmt ${gw.name} am ${s.date} (${s.kind})${from ? ' von ' + from : ''}`);
          run('INSERT INTO messages(channel,person_id,text,ts) VALUES(?,?,?,?)', 'allgemein', me.id, `✅ Getauscht: ${person.name} übernimmt ${gw.name} am ${swapWhen(s)})${from ? ' von ' + from : ''}.`, now()); broadcast({ type: 'chat' });
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
        const s = get('SELECT * FROM shifts WHERE id=?', a.shift_id); const gw = get('SELECT name,short FROM gewerke WHERE id=?', a.gewerk_id);
        if (!admin && a.person_id !== me.id) return json(res, 403, { error: 'Nicht deine Schicht' });
        if (req.method === 'DELETE') { run('DELETE FROM assignments WHERE id=?', a.id); log(me.id, 'shift.unassign', `${gw.name} ${s.date} (${s.kind}) entfernt`); broadcast({ type: 'shifts' }); return json(res, 200, { ok: true }); }
        if (req.method === 'PUT') {
          if (body.action === 'release') { // zum Tausch anbieten: Person bleibt eingeteilt, bis jemand übernimmt
            if (a.status !== 'fest') return json(res, 400, { error: 'Nur feste Einteilungen können zum Tausch angeboten werden' });
            run("UPDATE assignments SET status='tausch',note=? WHERE id=?", body.note || '', a.id); const pn = get('SELECT name FROM people WHERE id=?', a.person_id)?.name;
            const alt = SWAP_GROUPS.find(g => g.includes(String(gw.short).toUpperCase())), wer = alt ? alt.map(x => get('SELECT name FROM gewerke WHERE short=?', x)?.name || x).join(' oder ') : gw.name;
            log(me.id, 'shift.release', `${pn} bietet ${gw.name} am ${s.date} (${s.kind}) zum Tausch an`);
            run('INSERT INTO messages(channel,person_id,text,ts) VALUES(?,?,?,?)', 'allgemein', me.id, `🔄 Tausch gesucht: ${gw.name} am ${swapWhen(s)}${a.arrive ? ', ab ' + a.arrive : ''}) – ${pn} bleibt eingeteilt, bis jemand (${wer}) unter „Offen“ übernimmt.${body.note ? ' ' + body.note : ''}`, now()); broadcast({ type: 'chat' });
          }
          else if (body.action === 'withdraw') { // Angebot zurückziehen
            if (a.status !== 'tausch') return json(res, 400, { error: 'Diese Schicht wird nicht zum Tausch angeboten' });
            run("UPDATE assignments SET status='fest',note='' WHERE id=?", a.id); log(me.id, 'shift.withdraw', `${gw.name} ${s.date} (${s.kind}) nicht mehr zum Tausch`);
          }
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

      // --- Einlesen (Textliste / Excel) und Dienstplan-Vorschlag ---
      if (p === '/api/import/people' && req.method === 'POST' && need(admin)) { const r = importer.importPeopleText(String(body.text || ''), !!body.apply); if (body.apply) broadcast({ type: 'people' }); return json(res, 200, r); }
      if (p === '/api/import/xlsx' && req.method === 'POST' && need(admin)) {
        let r; try { r = importer.importXlsx(Buffer.from(String(body.file || ''), 'base64'), !!body.apply); } catch (e) { return json(res, 400, { error: e.message }); }
        if (body.apply) { broadcast({ type: 'people' }); broadcast({ type: 'shifts' }); } return json(res, 200, r);
      }
      if (p === '/api/import/staff' && req.method === 'POST' && need(admin)) {
        let r; try { r = importer.importStaff(Buffer.from(String(body.file || ''), 'base64'), !!body.apply); } catch (e) { return json(res, 400, { error: e.message }); }
        if (body.apply) { broadcast({ type: 'people' }); broadcast({ type: 'shifts' }); } return json(res, 200, r);
      }
      if (p === '/api/import/exact' && req.method === 'POST' && need(admin)) {
        let r; try { r = importer.importExact(Buffer.from(String(body.file || ''), 'base64'), !!body.apply); } catch (e) { return json(res, 400, { error: e.message }); }
        if (body.apply) { planCache.clear(); broadcast({ type: 'people' }); broadcast({ type: 'shifts' }); } return json(res, 200, r);
      }
      if (p === '/api/plan/propose' && req.method === 'POST' && need(admin)) return json(res, 200, planner.propose(body));
      if (p === '/api/plan/apply' && req.method === 'POST' && need(admin)) { const r = planner.apply(body.proposals || [], me.id); broadcast({ type: 'shifts' }); return json(res, 200, r); }

      // --- Leute ---
      if (p === '/api/people' && req.method === 'POST' && need(admin)) {
        const pin = body.pin || String(Math.floor(1000 + Math.random() * 9000));
        if (get('SELECT 1 FROM people WHERE pin=?', pin)) return json(res, 400, { error: 'PIN schon vergeben' });
        const r = run('INSERT INTO people(name,phone,email,pin,token,role,employment,budget_month,budget_week,gewerke,main_gewerke,fixed,aliases,available_from,available_until,notes,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', body.name, body.phone || '', body.email || '', pin, crypto.randomBytes(12).toString('hex'), body.role || 'staff', body.employment || 'minijob', body.budget_month ?? 40, body.budget_week ?? 20, JSON.stringify(body.gewerke || []), JSON.stringify(body.main_gewerke || []), body.fixed ? 1 : 0, body.aliases || '', body.available_from || '', body.available_until || '', body.notes || '', now());
        log(me.id, 'person.create', body.name); broadcast({ type: 'people' }); return json(res, 200, { id: Number(r.lastInsertRowid), pin });
      }
      const mp = p.match(/^\/api\/people\/(\d+)$/);
      if (mp) {
        const id = Number(mp[1]); const pr = get('SELECT * FROM people WHERE id=?', id); if (!pr) return json(res, 404, {});
        if (req.method === 'GET') { if (!admin && id !== me.id) return json(res, 403, {}); return json(res, 200, { ...pr, gewerke: JSON.parse(pr.gewerke || '[]'), pin: admin || id === me.id ? pr.pin : undefined, token: id === me.id || admin ? pr.token : undefined }); }
        if (req.method === 'PUT') {
          const np = String(body.pin ?? '').trim();
          if (np) {
            if (!/^\d{4}$/.test(np)) return json(res, 400, { error: 'PIN muss aus 4 Ziffern bestehen' });
            if (get('SELECT 1 FROM people WHERE pin=? AND id<>?', np, id)) return json(res, 400, { error: 'PIN schon vergeben' });
          }
          body.pin = np || undefined;
          if (admin) run('UPDATE people SET name=?,phone=?,email=?,role=?,employment=?,budget_month=?,budget_week=?,gewerke=?,main_gewerke=?,fixed=?,aliases=?,available_from=?,available_until=?,notes=?,active=?,pin=? WHERE id=?', body.name ?? pr.name, body.phone ?? pr.phone, body.email ?? pr.email, body.role ?? pr.role, body.employment ?? pr.employment, body.budget_month ?? pr.budget_month, body.budget_week ?? pr.budget_week, JSON.stringify(body.gewerke ?? JSON.parse(pr.gewerke || '[]')), JSON.stringify(body.main_gewerke ?? JSON.parse(pr.main_gewerke || '[]')), body.fixed != null ? (body.fixed ? 1 : 0) : pr.fixed, body.aliases ?? pr.aliases, body.available_from ?? pr.available_from, body.available_until ?? pr.available_until, body.notes ?? pr.notes, body.active ?? pr.active, body.pin ?? pr.pin, id);
          else if (id === me.id) run('UPDATE people SET phone=?,email=?,pin=? WHERE id=?', body.phone ?? pr.phone, body.email ?? pr.email, body.pin ?? pr.pin, id);
          else return json(res, 403, {});
          log(me.id, 'person.edit', pr.name); broadcast({ type: 'people' }); return json(res, 200, { ok: true });
        }
        if (req.method === 'DELETE' && need(admin)) { run('UPDATE people SET active=0 WHERE id=?', id); log(me.id, 'person.deactivate', pr.name); broadcast({ type: 'people' }); return json(res, 200, { ok: true }); }
      }

      // --- Stunden ---
      if (p === '/api/hours') {
        const month = url.searchParams.get('month');
        const ids = admin ? all('SELECT id,name,employment,budget_month,fixed FROM people WHERE active=1 ORDER BY name') : [{ id: me.id, name: me.name, employment: me.employment, budget_month: me.budget_month, fixed: me.fixed }];
        return json(res, 200, ids.map(pp => { const st = personStats(pp.id, month); return { ...pp, ...st, budget_month: pp.fixed ? st.hours : pp.budget_month }; })); // fix: Budget = Summe der Schichten
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
        if (body.rules) { setSetting('rules', { ...setting('rules'), ...body.rules }); regenerateShifts(me.id); }
        if (body.season) setSetting('season', { ...setting('season'), ...body.season });
        if (body.gewerke) for (const g of body.gewerke) { if (g.id) run('UPDATE gewerke SET name=?,short=?,rate=?,lead_min=?,lead_handover_min=?,end_after_last=?,demand_day=?,demand_eve=?,demand_eve_peak=?,color=?,sort=?,active=? WHERE id=?', g.name, g.short, g.rate, g.lead_min, g.lead_handover_min ?? 0, g.end_after_last ?? null, g.demand_day, g.demand_eve, g.demand_eve_peak, g.color, g.sort ?? 0, g.active ?? 1, g.id); else { const r = run('INSERT INTO gewerke(name,short,rate,lead_min,lead_handover_min,end_after_last,demand_day,demand_eve,demand_eve_peak,color,sort) VALUES(?,?,?,?,?,?,?,?,?,?,?)', g.name, g.short, g.rate, g.lead_min, g.lead_handover_min ?? 0, g.end_after_last ?? null, g.demand_day, g.demand_eve, g.demand_eve_peak, g.color || '#666', g.sort ?? 99); for (const s of all('SELECT id FROM shifts')) run('INSERT OR IGNORE INTO demand VALUES(?,?,0)', s.id, Number(r.lastInsertRowid)); } }
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
    console.error(e); json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`Hüttenplan läuft auf http://localhost:${PORT}  (Admin-PIN beim ersten Start: 1234)`));

'use strict';
// Einlesen von Personal (Textliste) und Excel-Dienstplan (Notizen, SPERRER, Schichtplan).
// Alles läuft erst als Vorschau (apply=false: es wird nichts geschrieben) und dann mit apply=true.
const { readXlsx, serialToDate } = require('./xlsx.js');

module.exports = (ctx) => {
  const { db, all, get, run, crypto, now, log } = ctx;
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const EMP_DEFAULT = 'teilzeit';

  // ---------- Namen ----------
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z ]/g, ' ').replace(/(.)\1+/g, '$1').replace(/\s+/g, ' ').trim();
  const ALIAS = { doro: 'dorothea' };
  function loadPeople() {
    return all('SELECT * FROM people ORDER BY id').map(p => ({ ...p, gw: JSON.parse(p.gewerke || '[]'), main: JSON.parse(p.main_gewerke || '[]'), n: norm(p.name), virtual: false }));
  }
  // Name aus Tabelle/Liste einer Person zuordnen: Vorname (auch Kurzform oder Rufname = zweiter Name), optional Initial/Nachname;
  // bei Mehrdeutigkeit entscheidet das Gewerk. Gibt es zum genannten Nachnamen niemanden, ist es eine neue Person (null).
  function resolve(people, text, gwId, exclude) {
    const cleaned = String(text || '').replace(/\([^)]*\)/g, ' ');
    const t = norm(cleaned).split(' ').filter(Boolean); if (!t.length) return null;
    const first = ALIAS[t[0]] || t[0], pool = people.filter(p => !exclude?.has(p.id));
    let c = pool.filter(p => p.n.split(' ')[0] === first);
    if (!c.length) c = pool.filter(p => p.n.split(' ').includes(first));
    if (t[1]) c = c.filter(p => p.n.split(' ').slice(1).some(w => w.startsWith(t[1])));
    if (c.length > 1 && gwId) { const c2 = c.filter(p => p.gw.includes(gwId)); if (c2.length) c = c2; }
    return c.length === 1 ? c[0] : null;
  }

  // Zeitraum aus Text: „ab Dezember“, „nur im Dezember“, „kann noch 30h im Dezember“, „ab 13.11.“
  const MONTHS = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
  function monthDates(name) {
    const mi = MONTHS.indexOf(String(name).toLowerCase()); if (mi < 0) return null;
    const season = ctx.setting('season'), y = mi + 1 >= 7 ? +season.start.slice(0, 4) : +season.end.slice(0, 4);
    return { from: new Date(Date.UTC(y, mi, 1)).toISOString().slice(0, 10), until: new Date(Date.UTC(y, mi + 1, 0)).toISOString().slice(0, 10) };
  }
  function windowIn(text) {
    const t = String(text || ''), season = ctx.setting('season');
    let m = /nur im (\p{L}+)/iu.exec(t) || /kann noch .*? im (\p{L}+)/iu.exec(t); if (m && monthDates(m[1])) return monthDates(m[1]);
    m = /\bab (?:dem )?(\d{1,2})\.(\d{1,2})\./i.exec(t); if (m) { const mo = +m[2], y = mo >= 7 ? +season.start.slice(0, 4) : +season.end.slice(0, 4); return { from: `${y}-${String(mo).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`, until: '' }; }
    m = /\bab (\p{L}+)/iu.exec(t); if (m && monthDates(m[1])) return { from: monthDates(m[1]).from, until: '' };
    return null;
  }
  function newPerson(people, apply, fields) {
    const pin = (() => { let x; do x = String(Math.floor(1000 + Math.random() * 9000)); while (get('SELECT 1 FROM people WHERE pin=?', x) || people.some(p => p.pin === x)); return x; })();
    const row = { name: fields.name, phone: '', email: '', pin, role: 'staff', employment: EMP_DEFAULT, budget_month: 40, budget_week: 20, gw: [], main: [], fixed: 0, notes: '', active: 1, aliases: '', ...fields };
    if (apply) {
      const r = run('INSERT INTO people(name,phone,email,pin,token,role,employment,budget_month,budget_week,gewerke,main_gewerke,fixed,aliases,available_from,available_until,notes,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        row.name, '', '', pin, crypto.randomBytes(12).toString('hex'), 'staff', row.employment, row.budget_month, row.budget_week, JSON.stringify(row.gw), JSON.stringify(row.main), row.fixed, row.aliases, '', '', row.notes, now());
      row.id = Number(r.lastInsertRowid);
    } else row.id = -(people.length + 1);
    row.n = norm(row.name); row.virtual = !apply; people.push(row); return row;
  }
  function savePerson(p) {
    run('UPDATE people SET gewerke=?,main_gewerke=?,fixed=?,budget_month=?,budget_week=?,employment=?,aliases=?,available_from=?,available_until=?,notes=? WHERE id=?', JSON.stringify(p.gw), JSON.stringify(p.main), p.fixed || 0, p.budget_month, p.budget_week, p.employment, p.aliases || '', p.available_from || '', p.available_until || '', p.notes || '', p.id);
  }

  // ---------- Textliste ----------
  const GW_KEYS = [['ADL', /\badl\b|abenddienst/ig], ['BA', /\bba\b|bühnenassist/ig], ['K', /\bkasse\b/ig], ['E', /\beinlass\b/ig]];
  const gewerkeIn = (text) => GW_KEYS.flatMap(([s, re]) => { re.lastIndex = 0; const m = re.exec(text); return m ? [[s, m.index]] : []; }).sort((a, b) => a[1] - b[1]).map(x => x[0]);
  const NAME_RE = /^[\p{Lu}][\p{L}'’-]*\.?(?: [\p{L}'’-]+\.?){0,3}$/u;
  function parsePeopleText(text) {
    const rows = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim(); if (!line) continue;
      const hrs = /(\d+(?:[.,]\d+)?)\s*h?\s*(\+)?\s*\/\s*w\b/i.exec(line);
      const cap = /kann noch (\d+(?:[.,]\d+)?)\s*h\s*im\s*(\p{L}+)/iu.exec(line);
      const fixed = /schichten\s+(?:sind\s+fix|stehen\s+fest)/i.test(line);
      if (!hrs && !cap && !fixed) continue;
      const cuts = [hrs?.index, line.search(/kann noch/i), line.indexOf(','), line.search(/schichten/i)].filter(i => i != null && i >= 0);
      const cut = Math.min(...cuts);
      const name = line.slice(0, cut).replace(/[,\s]+$/, '').trim();
      if (!NAME_RE.test(name) || / und /i.test(name) || /^(Für|Wenn|Wer|Schön|Die|Der|Das|ADL)\b/.test(name)) continue;
      const rest = line.slice(cut), vorw = /vorwiegend\s+(.*)$/i.exec(rest);
      const gw = gewerkeIn(rest);
      rows.push({ win: windowIn(line), name, week: hrs ? Number(hrs[1].replace(',', '.')) : null, plus: !!hrs?.[2], cap: cap ? Number(cap[1].replace(',', '.')) : null, capMonth: cap?.[2] || '', fixed, gw, main: vorw ? gewerkeIn(vorw[1]) : gw, line });
    }
    return rows;
  }
  // Regelzeilen: „Wenn A und B am gleichen Tag arbeiten, bitte so lassen.“ / „ADL im November ist fix.“
  function parseRules(text) {
    const together = [], rules = {};
    for (const line of String(text || '').split(/\r?\n/)) {
      const m = /wenn (.+?) am gleichen Tag arbeiten, bitte so lassen/i.exec(line);
      if (m) together.push(m[1].split(/,| und /).map(x => x.trim()).filter(Boolean));
      const a = /ADL im (\p{L}+) ist fix/iu.exec(line);
      if (a) {
        const mi = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'].indexOf(a[1].toLowerCase());
        if (mi >= 0) { const season = ctx.setting('season'), y = mi + 1 >= 7 ? +season.start.slice(0, 4) : +season.end.slice(0, 4); rules.adl_fixed_until = new Date(Date.UTC(y, mi + 1, 0)).toISOString().slice(0, 10); }
      }
    }
    return { together, rules };
  }
  function importPeopleText(text, apply) {
    const gws = Object.fromEntries(all('SELECT id,short FROM gewerke WHERE active=1').map(g => [g.short.toUpperCase(), g.id]));
    const rows = parsePeopleText(text), people = loadPeople(), pr = parseRules(text), out = { created: [], updated: [], rows: rows.length, together: pr.together, rules: pr.rules };
    if (apply) db.exec('BEGIN');
    try {
      for (const r of rows) {
        let p = resolve(people, r.name, null);
        const isNew = !p;
        if (isNew) p = newPerson(people, apply, { name: r.name });
        p.gw = [...new Set([...(isNew ? [] : p.gw), ...r.gw.map(s => gws[s]).filter(Boolean)])];
        p.main = r.main.length && r.main.length < r.gw.length ? r.main.map(s => gws[s]).filter(Boolean) : (isNew ? [] : p.main);
        if (r.fixed) { p.fixed = 1; p.budget_week = 99; p.budget_month = 999; }
        else if (r.cap != null) { p.budget_month = r.cap; p.budget_week = Math.round(r.cap / 4.45 * 10) / 10; }
        else if (r.week != null) { p.budget_week = r.week; p.budget_month = Math.ceil(r.week * 4.45 * (r.plus ? 1.15 : 1)); }
        if (!r.fixed) p.fixed = 0;
        if (r.win) { p.available_from = r.win.from; p.available_until = r.win.until; }
        p.employment = p.employment === 'leitung' ? 'leitung' : EMP_DEFAULT;
        p.notes = [p.notes, p.notes?.includes(r.line) ? '' : r.line].filter(Boolean).join('\n');
        if (apply) savePerson(p);
        (isNew ? out.created : out.updated).push({ von: r.win?.from || '', bis: r.win?.until || '', name: p.name, week: r.week, plus: r.plus, cap: r.cap, fixed: r.fixed, gewerke: r.gw, main: r.main });
      }
      if (apply) { if (pr.together.length) ctx.setSetting('keep_together', pr.together); if (Object.keys(pr.rules).length) ctx.setSetting('rules', { ...ctx.setting('rules'), ...pr.rules }); db.exec('COMMIT'); log(null, 'import.people', `${out.created.length} neu, ${out.updated.length} aktualisiert`); }
    } catch (e) { if (apply) db.exec('ROLLBACK'); throw e; }
    return out;
  }

  // ---------- Excel ----------
  const TIME_RE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;
  const POS = [{ t: 'B', n: 'C', g: 'ADL' }, { t: 'D', n: 'E', g: 'K' }, { t: 'F', n: 'G', g: 'E' }, { t: 'H', n: 'I', g: 'BA' }, { t: 'J', n: 'K', g: 'E' }, { t: 'L', n: 'M', g: 'BA' }];
  function importXlsx(buf, apply) {
    const sheets = readXlsx(buf);
    const gwRows = all('SELECT * FROM gewerke WHERE active=1'), gws = Object.fromEntries(gwRows.map(g => [g.short.toUpperCase(), g]));
    const people = loadPeople();
    const out = { people: { created: [], updated: [] }, blocks: 0, assignments: { added: 0, existing: 0, doppelt: 0 }, offen: 0, shiftsCreated: 0, unresolved: {}, blockedPeople: [], konflikte: [], einlassExtra: [], paarErhalten: [], paarVerloren: [] };
    const miss = (n) => { out.unresolved[n] = (out.unresolved[n] || 0) + 1; };
    if (apply) db.exec('BEGIN');
    try {
      // Notizen: Personal, Stunden, Gewerke (X)
      for (const [rn, row] of Object.entries(sheets.Notizen || {})) {
        if (typeof row.C !== 'string' || +rn < 5) continue;
        const nm = row.C.replace(/\(.*\)/, '').trim(), hm = /\((\d+(?:[.,]\d+)?)(\+)?\)/.exec(row.C);
        const have = [['BA', row.D], ['E', row.E], ['K', row.F], ['ADL', row.G]].filter(([, x]) => String(x).trim().toUpperCase() === 'X').map(([s]) => gws[s]?.id).filter(Boolean);
        if (!nm || !have.length) continue;
        let p = resolve(people, nm, null); const isNew = !p;
        if (isNew) { p = newPerson(people, apply, { name: nm }); if (hm) { p.budget_week = Number(hm[1].replace(',', '.')); p.budget_month = Math.ceil(p.budget_week * 4.45 * (hm[2] ? 1.15 : 1)); } }
        p.gw = [...new Set([...p.gw, ...have])];
        if (!p.aliases?.toLowerCase().includes(nm.toLowerCase())) p.aliases = [p.aliases, nm].filter(Boolean).join('; ');
        if (apply) savePerson(p);
        (isNew ? out.people.created : out.people.updated).push(p.name);
      }
      // SPERRER: gesperrte Tage je Person (X, D.B., S, …)
      const blocked = new Set(); // 'personId:Datum'
      const sp = sheets.SPERRER || {}, head = sp[1] || {}, cols = {}, used = new Set();
      const order = Object.entries(head).sort((a, b) => /[.\s]\S/.test(b[1]) - /[.\s]\S/.test(a[1])); // „Juliane T.“ vor „Juliane“
      for (const [c, nm] of order) { const p = resolve(people, nm, null, used); if (p) { cols[c] = p; used.add(p.id); } else if (typeof nm === 'string') miss('SPERRER: ' + nm); }
      const ins = apply ? db.prepare("INSERT INTO availability(person_id,date,status,note) VALUES(?,?,'no',?) ON CONFLICT(person_id,date) DO UPDATE SET status='no',note=excluded.note") : null;
      for (const [rn, row] of Object.entries(sp)) {
        if (+rn < 2 || typeof row.B !== 'number' || row.B < 40000) continue;
        const date = serialToDate(row.B);
        for (const [c, p] of Object.entries(cols)) if (row[c] != null && String(row[c]).trim()) { out.blocks++; blocked.add(p.id + ':' + date); ins?.run(p.id, date, 'SPERRER ' + String(row[c]).trim()); }
      }
      out.blockedPeople = [...new Set(Object.values(cols).map(p => p.name))];
      // Bewerber: Verfügbarkeit („ab Dezember“, „ab 13.11.“) für bekannte Personen übernehmen, sofern dort noch nichts steht
      out.verfuegbar = [];
      for (const [rn, row] of Object.entries(sheets.Bewerber || {})) {
        if (+rn < 2 || typeof row.B !== 'string') continue;
        const p = resolve(people, row.B.replace(/\s+/g, ' ').trim(), null), w = p && windowIn(row.G);
        if (!p || !w || p.available_from || p.available_until || p.virtual) continue;
        p.available_from = w.from; p.available_until = w.until; out.verfuegbar.push({ name: p.name, von: w.from, bis: w.until });
        if (apply) savePerson(p);
      }
      // Schichtplan: Einteilungen je Position
      const cutoff = toMin(ctx.setting('rules').day_cutoff || '13:00');
      const taken = new Set(); // shift:person (auch in der Vorschau)
      const eTaken = {}, baTaken = {}, needBy = {}, dates = [];
      const together = ctx.setting('keep_together', []).map(g => g.map(n => resolve(people, n, null)?.id).filter(Boolean)).filter(g => g.length > 1);
      const togetherNames = (p) => { const ids = new Set(together.filter(g => g.includes(p.id)).flat()); return ids.size ? ids : null; }; // Besetzung je Schicht laut Schichtplan
      for (const [rn, row] of Object.entries(sheets.Schichtplan || {})) {
        if (+rn < 2 || typeof row.A !== 'number' || row.A < 40000) continue;
        const date = serialToDate(row.A); dates.push(date);
        const ent = POS.map(p => ({ ...p, m: TIME_RE.exec(String(row[p.t] ?? '')), nm: row[p.n] })).filter(e => e.m);
        if (!ent.length) continue;
        const win = (e) => { const s = +e.m[1] * 60 + +e.m[2]; let x = +e.m[3] * 60 + +e.m[4]; if (x <= s) x += 1440; return [s, x]; };
        const adl = ent.find(e => e.g === 'ADL'), ws = (adl ? [win(adl)] : ent.map(win)), w0 = Math.min(...ws.map(x => x[0])), w1 = Math.max(...ws.map(x => x[1]));
        let best = null, bo = 0;
        for (const s of all('SELECT * FROM shifts WHERE date=?', date)) { let e = toMin(s.end); const st = toMin(s.start); if (e <= st) e += 1440; const o = Math.min(e, w1) - Math.max(st, w0); if (o > bo) { bo = o; best = s; } }
        if (!best) {
          const kind = w0 < cutoff ? 'tag' : 'abend', T = (m) => String(Math.floor((m % 1440) / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
          const k2 = get('SELECT 1 FROM shifts WHERE date=? AND kind=?', date, kind) ? (kind === 'tag' ? 'abend' : 'tag') : kind;
          if (apply) { const r = run('INSERT INTO shifts(date,kind,start,end,manual) VALUES(?,?,?,?,1)', date, k2, T(w0), T(w1)); best = { id: Number(r.lastInsertRowid), date, kind: k2 }; for (const g of gwRows) run('INSERT OR IGNORE INTO demand(shift_id,gewerk_id,count) VALUES(?,?,0)', best.id, g.id); }
          else best = { id: -(out.shiftsCreated + 1), date, kind: k2 };
          out.shiftsCreated++;
        }
        const need = {};
        // Einlass ist immer nur mit einer Person besetzt (sie wechselt zwischen den Hütten): steht in der Tabelle für beide Hütten jemand,
        // wird eine Person übernommen (bevorzugt „Schichten fix“, sonst die erste), die andere nur gemeldet
        const namesOf = (e) => String(e.nm ?? '').split(/[\/,]/).map(n => resolve(people, n.trim(), gws[e.g]?.id)).filter(Boolean);
        const matesHere = (p) => { const grp = togetherNames(p); return !!grp && ent.some(x => namesOf(x).some(q => q.id !== p.id && grp.has(q.id))); };
        // Reihenfolge der Einlass-Einträge: „Schichten fix“ zuerst, dann Personen, deren Gruppe an dem Tag zusammenbleiben soll, dann die übrigen
        const fixedFirst = (e) => e.g !== 'E' ? 1 : namesOf(e).some(p => p.fixed) ? 0 : namesOf(e).some(matesHere) ? 1 : 2;
        for (const e of [...ent].sort((a, b) => (a.g === 'E' ? 10 : 0) + fixedFirst(a) - (b.g === 'E' ? 10 : 0) - fixedFirst(b))) { // Einlass zuletzt, damit BA-Plätze schon bekannt sind
          const g = gws[e.g]; if (!g) continue;
          need[e.g] = (need[e.g] || 0) + 1;
          const names = String(e.nm ?? '').split(/[\/,]/).map(x => x.trim()).filter(x => x && x !== '?' && !/^technik$/i.test(x));
          if (!names.length) { out.offen++; continue; }
          for (const nm of names.slice(0, e.g === 'ADL' ? 1 : names.length)) {
            const p = resolve(people, nm, g.id);
            if (!p) { miss(nm); continue; }
            const key = best.id + ':' + p.id;
            if (taken.has(key) || (best.id > 0 && get("SELECT 1 FROM assignments WHERE shift_id=? AND person_id=? AND status!='frei'", best.id, p.id))) { out.assignments[taken.has(key) ? 'doppelt' : 'existing']++; continue; }
            if (e.g === 'E') {
              const have = (best.id > 0 ? get("SELECT COUNT(*) c FROM assignments WHERE shift_id=? AND gewerk_id=? AND status!='frei'", best.id, g.id).c : 0) + (eTaken[best.id] || 0);
              if (have >= 1) {
                // Gruppe „zusammen lassen“ (z. B. Helena/Finn): zweite Einlass-Person weicht auf einen freien BA-Platz aus, damit das Paar am Tag bleibt
                const grp = togetherNames(p), mates = grp && ent.some(x => String(x.nm ?? '').split(/[\/,]/).some(n => { const q = resolve(people, n.trim(), null); return q && q.id !== p.id && grp.has(q.id); }));
                const ba = gws.BA, baHave = (best.id > 0 ? get("SELECT COUNT(*) c FROM assignments WHERE shift_id=? AND gewerk_id=? AND status!='frei'", best.id, ba?.id).c : 0) + (baTaken[best.id] || 0);
                if (mates && ba && p.gw.includes(ba.id) && baHave < 2) {
                  baTaken[best.id] = (baTaken[best.id] || 0) + 1; out.paarErhalten.push({ name: p.name, date }); out.assignments.added++;
                  if (apply) run("INSERT INTO assignments(shift_id,gewerk_id,person_id,status,created) VALUES(?,?,?,'fest',?)", best.id, ba.id, p.id, now());
                  taken.add(key); continue;
                }
                if (mates) out.paarVerloren.push({ name: p.name, date });
                out.einlassExtra.push({ name: p.name, date }); continue;
              }
              eTaken[best.id] = (eTaken[best.id] || 0) + 1;
            }
            if (blocked.has(p.id + ':' + date)) out.konflikte.push({ name: p.name, date, gewerk: e.g });
            taken.add(key); out.assignments.added++;
            if (apply) run("INSERT INTO assignments(shift_id,gewerk_id,person_id,status,created) VALUES(?,?,?,'fest',?)", best.id, g.id, p.id, now());
          }
        }
        const nb = needBy[best.id] ||= {};
        for (const [s, n] of Object.entries(need)) nb[s] = Math.max(nb[s] || 0, s === 'BA' ? Math.min(n, 2) : 1);
      }
      // Besetzung = Plätze laut Schichtplan (nur Plätze mit Zeitangabe); Schichten ohne Zeile im Zeitraum des Plans (z. B. Vormittage) bleiben unbesetzt
      if (dates.length) {
        const d0 = dates.reduce((a, b) => a < b ? a : b), d1 = dates.reduce((a, b) => a > b ? a : b);
        out.demand = { angepasst: 0, ohneBesetzung: 0 };
        for (const s of all('SELECT * FROM shifts WHERE date>=? AND date<=?', d0, d1)) {
          const nb = needBy[s.id]; out.demand[nb ? 'angepasst' : 'ohneBesetzung']++;
          if (apply) for (const [short, g] of Object.entries(gws)) {
            const have = get("SELECT COUNT(*) c FROM assignments WHERE shift_id=? AND gewerk_id=? AND status!='frei'", s.id, g.id).c;
            run('INSERT INTO demand(shift_id,gewerk_id,count) VALUES(?,?,?) ON CONFLICT(shift_id,gewerk_id) DO UPDATE SET count=excluded.count', s.id, g.id, Math.max(nb?.[short] || 0, have));
          }
        }
      }
      if (apply) { db.exec('COMMIT'); log(null, 'import.xlsx', `${out.assignments.added} Einteilungen, ${out.blocks} Sperrtage`); }
    } catch (e) { if (apply) db.exec('ROLLBACK'); throw e; }
    return out;
  }

  // ---------- Schichtplan 1:1 übernehmen ----------
  // Jede Zeile des Blatts „Schichtplan“ ist eine Schicht (Zeile ohne ADL, die sich mit einer Schicht desselben Tages überschneidet,
  // gehört zu dieser). Schicht = frühester Beginn bis spätestes Ende aller Plätze der Zeile; jede Person bekommt genau die Zeiten
  // ihres Platzes (arrive/plan_end). Im Zeitraum der Datei werden die bisherigen Schichten ersetzt und nicht mehr automatisch erzeugt.
  const EXACT_POS = [{ t: 'B', n: 'C', g: 'ADL', label: 'ADL' }, { t: 'D', n: 'E', g: 'K', label: 'Kasse' }, { t: 'F', n: 'G', g: 'E', label: 'Einlass Wilhelm' }, { t: 'H', n: 'I', g: 'BA', label: 'BA Wilhelm' },
    { t: 'J', n: 'K', g: 'E', label: 'Einlass Jakob' }, { t: 'L', n: 'M', g: 'BA', label: 'BA Jakob' }];
  const RANGE_RE = /^\s*(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})\s*$/;
  const T = (m) => String(Math.floor((m % 1440) / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const dm = (d) => `${+d.slice(8)}.${+d.slice(5, 7)}.`;
  function parseExact(sheet) {
    const head = sheet[1] || {}, shifts = [], notes = [];
    // weitere Spalten mit Zeiten (z. B. „Jochen“): Spaltenkopf = Name, Platz ohne Gewerk-Angabe → ADL-Spalte des Kopfs
    const extra = Object.entries(head).filter(([c, v]) => typeof v === 'string' && !EXACT_POS.some(p => p.t === c || p.n === c) && c !== 'A').map(([c, v]) => ({ t: c, name: v.trim(), g: 'ADL', label: v.trim() + ' (eigene Spalte)' }));
    for (const rn of Object.keys(sheet).map(Number).sort((a, b) => a - b)) {
      const row = sheet[rn]; if (rn < 2 || typeof row.A !== 'number' || row.A < 40000) continue;
      const date = serialToDate(row.A), ent = [];
      for (const p of [...EXACT_POS, ...extra]) {
        const raw = row[p.t]; if (raw == null || String(raw).trim() === '') { if (p.n && row[p.n] != null && String(row[p.n]).trim()) notes.push(`${dm(date)} ${p.label}: Name „${row[p.n]}“ ohne Zeit (Zeile ${rn})`); continue; }
        const m = RANGE_RE.exec(String(raw));
        if (!m) { notes.push(`${dm(date)} ${p.label}: „${raw}“ ist keine Zeitangabe – nicht übernommen (Zeile ${rn})`); continue; }
        const s = +m[1] * 60 + +m[2]; let e = +m[3] * 60 + +m[4]; if (e <= s) e += 1440;
        const nmRaw = p.name || String(row[p.n] ?? '').trim();
        const names = nmRaw.split(/[\/,&+]| und /).map(x => x.trim()).filter(x => x && x !== '?');
        const technik = names.some(x => /^technik$/i.test(x));
        ent.push({ ...p, s, e, row: rn, names: names.filter(x => !/^technik$/i.test(x)), technik, raw: nmRaw });
      }
      if (!ent.length) continue;
      const w0 = Math.min(...ent.map(x => x.s)), w1 = Math.max(...ent.map(x => x.e));
      const prev = !ent.some(x => x.g === 'ADL' && !x.name) && shifts.find(x => x.date === date && Math.min(x.e, w1) > Math.max(x.s, w0));
      if (prev) { prev.ent.push(...ent); prev.s = Math.min(prev.s, w0); prev.e = Math.max(prev.e, w1); prev.rows.push(rn); }
      else shifts.push({ date, s: w0, e: w1, ent, rows: [rn] });
    }
    // Schichtart nach Reihenfolge am Tag
    const byDate = {}; for (const x of shifts) (byDate[x.date] ||= []).push(x);
    for (const [d, xs] of Object.entries(byDate)) {
      xs.sort((a, b) => a.s - b.s);
      const kinds = xs.length === 1 ? [xs[0].s < toMin(ctx.setting('rules').day_cutoff || '13:00') ? 'tag' : 'abend'] : xs.length === 2 ? ['tag', 'abend'] : ['tag', 'mitte', 'abend'];
      if (xs.length > 3) notes.push(`${dm(d)}: ${xs.length} Schichten an einem Tag – nur 3 möglich, die übrigen fehlen`);
      xs.forEach((x, i) => { x.kind = kinds[i]; });
    }
    return { shifts: shifts.filter(x => x.kind), notes };
  }
  function importExact(buf, apply) {
    const sheets = readXlsx(buf);
    if (!sheets.Schichtplan) throw new Error('Blatt „Schichtplan“ nicht gefunden');
    const gws = Object.fromEntries(all('SELECT * FROM gewerke WHERE active=1').map(g => [g.short.toUpperCase(), g]));
    const { shifts, notes } = parseExact(sheets.Schichtplan);
    if (!shifts.length) throw new Error('Im Blatt „Schichtplan“ keine Schichten mit Zeiten gefunden');
    const rules = ctx.setting('rules'), people = loadPeople();
    const d0 = shifts[0].date, d1 = shifts.reduce((a, x) => x.date > a ? x.date : a, d0);
    const out = { from: d0, to: d1, shifts: shifts.length, assignments: 0, people: { created: [], matched: [] }, replaced: 0, offen: [], technik: [], doppelt: [], zwei: [], ueberlang: [], ruhe: [], ohneSchicht: [], ohneVorstellung: [], ungedeckt: [], notes };
    // Namen zuordnen: genauere Angaben zuerst („Juliane T“ vor „Juliane“), jede Person nur für eine Schreibweise
    const labels = [...new Set(shifts.flatMap(x => x.ent.flatMap(e => e.names)))].sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length || b.length - a.length);
    const used = new Set(), who = {};
    if (apply) db.exec('BEGIN');
    try {
      for (const l of labels) {
        const gIds = [...new Set(shifts.flatMap(x => x.ent.filter(e => e.names.includes(l)).map(e => gws[e.g]?.id)).filter(Boolean))];
        let p = resolve(people, l, gIds.length === 1 ? gIds[0] : null, used);
        if (p) out.people.matched.push(l === p.name ? l : `${l} → ${p.name}`);
        else { p = newPerson(people, apply, { name: l, gw: gIds, main: [] }); out.people.created.push(l); }
        const add = gIds.filter(id => !p.gw.includes(id)); if (add.length) { p.gw = [...p.gw, ...add]; if (apply) savePerson(p); }
        used.add(p.id); who[l] = p;
      }
      if (apply) {
        for (const s of all('SELECT id FROM shifts WHERE date>=? AND date<=?', d0, d1)) {
          for (const t of ['assignments', 'demand', 'checks', 'todos']) run(`DELETE FROM ${t} WHERE shift_id=?`, s.id);
          run('DELETE FROM shifts WHERE id=?', s.id); out.replaced++;
        }
      } else out.replaced = get('SELECT COUNT(*) c FROM shifts WHERE date>=? AND date<=?', d0, d1).c;
      const perDay = {}; // Person → Datum → [[s,e,label]]
      for (const x of shifts) {
        let sid = null;
        // Schichtzeit = Zeit der ADL (wie im Plan), ohne ADL der früheste Beginn bis zum spätesten Ende der Zeile
        const adl = x.ent.filter(e => e.g === 'ADL'), ss = adl.length ? Math.min(...adl.map(e => e.s)) : x.s, se = adl.length ? Math.max(...adl.map(e => e.e)) : x.e;
        if (apply) sid = Number(run('INSERT INTO shifts(date,kind,start,end,note,manual) VALUES(?,?,?,?,?,1)', x.date, x.kind, T(ss), T(se), '').lastInsertRowid);
        const need = {};
        for (const e of x.ent) {
          const g = gws[e.g]; if (!g) continue;
          if (e.technik && !e.names.length) { out.technik.push(`${dm(x.date)} ${e.label} ${T(e.s)}–${T(e.e)}`); continue; }
          need[g.id] = (need[g.id] || 0) + Math.max(1, e.names.length);
          if (!e.names.length) { out.offen.push(`${dm(x.date)} ${e.label} ${T(e.s)}–${T(e.e)}`); continue; }
          if (e.names.length > 1) out.zwei.push(`${dm(x.date)} ${e.label} ${T(e.s)}–${T(e.e)}: ${e.names.join(' + ')}`);
          for (const l of e.names) {
            const p = who[l]; out.assignments++;
            ((perDay[p.name] ||= {})[x.date] ||= []).push([e.s, e.e, e.label]);
            if (apply) run("INSERT INTO assignments(shift_id,gewerk_id,person_id,status,arrive,plan_end,created) VALUES(?,?,?,'fest',?,?,?)", sid, g.id, p.id, T(e.s), T(e.e), now());
          }
        }
        if (apply) for (const g of Object.values(gws)) run('INSERT INTO demand(shift_id,gewerk_id,count) VALUES(?,?,?)', sid, g.id, need[g.id] || 0);
      }
      // Prüfungen
      const maxDay = (rules.max_day_h || 10) * 60, rest = (rules.rest_h || 11) * 60;
      for (const [nm, days] of Object.entries(perDay)) {
        const ds = Object.keys(days).sort();
        for (const d of ds) {
          const w = days[d].sort((a, b) => a[0] - b[0]);
          for (let i = 1; i < w.length; i++) if (w[i][0] < w[i - 1][1]) out.doppelt.push(`${dm(d)} ${nm}: ${w[i - 1][2]} ${T(w[i - 1][0])}–${T(w[i - 1][1])} und ${w[i][2]} ${T(w[i][0])}–${T(w[i][1])}`);
          const sum = w.reduce((n, x) => n + x[1] - x[0], 0); if (sum > maxDay) out.ueberlang.push(`${dm(d)} ${nm}: ${Math.round(sum / 6) / 10} h`);
        }
        for (let i = 1; i < ds.length; i++) {
          const a = days[ds[i - 1]], b = days[ds[i]], gap = (Date.parse(ds[i]) - Date.parse(ds[i - 1])) / 60000 + Math.min(...b.map(x => x[0])) - Math.max(...a.map(x => x[1]));
          if (gap < rest) out.ruhe.push(`${nm}: ${dm(ds[i - 1])} bis ${T(Math.max(...a.map(x => x[1])))} → ${dm(ds[i])} ab ${T(Math.min(...b.map(x => x[0])))} (${Math.round(gap / 6) / 10} h Pause)`);
        }
      }
      const planDates = new Set(shifts.map(x => x.date));
      for (const { date } of all('SELECT DISTINCT date FROM performances WHERE date>=? AND date<=? ORDER BY date', d0, d1)) if (!planDates.has(date)) out.ohneSchicht.push(`${dm(date)} (${all('SELECT time FROM performances WHERE date=? ORDER BY time', date).map(p => p.time).join(', ')})`);
      for (const d of [...planDates].sort()) {
        const perfs = all('SELECT time FROM performances WHERE date=? ORDER BY time', d).map(p => toMin(p.time));
        if (!perfs.length) { out.ohneVorstellung.push(dm(d)); continue; }
        const adl = shifts.filter(x => x.date === d).flatMap(x => x.ent.filter(e => e.g === 'ADL' && (e.names.length || e.technik)));
        // ADL muss vom Beginn bis 45 min danach da sein (Übergabe zwischen zwei ADL zählt, wenn lückenlos)
        const covered = (a, b) => { let t = a; for (const e of [...adl].sort((x, y) => x.s - y.s)) if (e.s <= t && e.e > t) t = e.e; return t >= b; };
        for (const t of perfs) if (!covered(t, t + 45)) out.ungedeckt.push(`${dm(d)} ${T(t)}`);
      }
      if (apply) {
        ctx.setSetting('fixed_plan', { from: d0, to: d1 });
        const season = ctx.setting('season'); if (d0 < season.start || d1 > season.end) ctx.setSetting('season', { ...season, start: d0 < season.start ? d0 : season.start, end: d1 > season.end ? d1 : season.end });
        db.exec('COMMIT'); log(null, 'import.schichtplan', `${shifts.length} Schichten, ${out.assignments} Einteilungen (${d0} bis ${d1}) 1:1 übernommen`);
      }
    } catch (e) { if (apply) db.exec('ROLLBACK'); throw e; }
    return out;
  }

  // ---------- Mitarbeiterliste (Name, voller Name, Aufgabenbereiche, Stunden/Vertrag, Sperrtage) ----------
  // „20h“ = Stunden pro Woche (Monatsbudget = Woche × 4,45, mit „+“ 15 % mehr), „max. 60h“ = Monatsbudget,
  // „offen“ = Budget bleibt. „nur Dezember“, „ab Dezember“, „ab 13.11.“, „13.11.–31.01.“ = Verfügbarkeitszeitraum.
  const GW_WORDS = [['ADL', /\badl\b|abenddienst/i], ['BA', /\bba\b|bühnenassist/i], ['K', /\bkasse\b/i], ['E', /\beinlass\b/i]];
  function parseHours(t) {
    t = String(t || '').trim(); const r = {};
    if (!t || /^offen$/i.test(t)) return r;
    const max = /max\.?\s*(\d+(?:[.,]\d+)?)\s*h/i.exec(t), h = /(\d+(?:[.,]\d+)?)\s*h(\+)?/i.exec(t);
    if (max) { r.month = Number(max[1].replace(',', '.')); r.week = Math.round(r.month / 4.45 * 10) / 10; }
    else if (h) { r.week = Number(h[1].replace(',', '.')); r.plus = !!h[2] || /mehr als/i.test(t); r.month = Math.ceil(r.week * 4.45 * (r.plus ? 1.15 : 1)); }
    if (/midijob/i.test(t)) r.employment = 'midijob'; else if (/minijob/i.test(t)) r.employment = 'minijob';
    const season = ctx.setting('season'), yOf = (mo) => mo >= 7 ? +season.start.slice(0, 4) : +season.end.slice(0, 4);
    const iso = (d, mo) => `${yOf(mo)}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const rng = /(\d{1,2})\.(\d{1,2})\.?\s*[–-]\s*(\d{1,2})\.(\d{1,2})\./.exec(t);
    if (rng) r.win = { from: iso(+rng[1], +rng[2]), until: iso(+rng[3], +rng[4]) };
    else { const m = /nur (?:im )?(\p{L}+)/iu.exec(t); if (m && monthDates(m[1])) r.win = monthDates(m[1]); else r.win = windowIn(t); }
    return r;
  }
  // Person zu einem Namen der Liste finden: Vorname (auch Kurzform wie Doro/Dorothea), Nachname passend zum Initial („Juliane T“ = „Juliane Torhorst“);
  // erst Personen mit passendem Nachnamen, dann solche ohne Nachnamen.
  function matchStaff(people, short, full, used) {
    const toks = norm(full || short).split(' ').filter(Boolean), shortToks = norm(short).split(' ').filter(Boolean);
    const first = toks[0], last = toks.length > 1 ? toks[toks.length - 1] : (shortToks[1] || '');
    const pool = people.filter(p => !used.has(p.id) && p.role !== 'admin');
    const same = (a, b) => a === b || ALIAS[a] === b || ALIAS[b] === a; // Julia ≠ Juliane, Doro = Dorothea
    const fm = pool.filter(p => { const f = p.n.split(' ')[0]; return f && first && same(f, first); });
    const surnameOk = (p) => { const rest = p.n.split(' ').slice(1); return rest.length && last && rest.some(w => w.startsWith(last) || last.startsWith(w)); };
    let c = fm.filter(surnameOk); if (c.length === 1) return c[0];
    if (!c.length) { c = fm.filter(p => p.n.split(' ').length === 1); if (c.length === 1) return c[0]; if (!c.length && fm.length === 1 && !last) return fm[0]; }
    return null;
  }
  function importStaff(buf, apply) {
    const sheets = readXlsx(buf), list = sheets.Mitarbeiterliste;
    if (!list) throw new Error('Blatt „Mitarbeiterliste“ nicht gefunden');
    const head = list[1] || {}, col = (re) => Object.keys(head).find(c => re.test(String(head[c])));
    const C = { name: col(/^name$/i) || 'A', full: col(/voller name/i), gw: col(/aufgaben/i), hours: col(/stunden/i), mail: col(/mail/i), phone: col(/handy|telefon/i), hint: col(/hinweis/i) };
    const gws = Object.fromEntries(all('SELECT id,short FROM gewerke WHERE active=1').map(g => [g.short.toUpperCase(), g.id]));
    const people = loadPeople(), used = new Set(), byLabel = {};
    const out = { updated: [], created: [], offen: [], renamed: [], blocks: 0, konflikte: [], unbekannt: [] };
    const rows = Object.entries(list).filter(([rn, r]) => +rn > 1 && r[C.name]).map(([, r]) => r);
    if (apply) db.exec('BEGIN');
    try {
      for (const r of rows) {
        const short = String(r[C.name]).trim(), full = String(r[C.full] || short).trim();
        let p = matchStaff(people, short, full, used); const isNew = !p;
        const gwList = String(r[C.gw] || '').replace(/\([^)]*\)/g, ' ');
        const gIds = GW_WORDS.filter(([, re]) => re.test(gwList)).map(([k]) => gws[k]).filter(Boolean);
        if (isNew) p = newPerson(people, apply, { name: full, gw: gIds });
        used.add(p.id); byLabel[norm(short)] = p; byLabel[norm(full)] = p;
        const before = { name: p.name, week: p.budget_week, month: p.budget_month };
        if (!isNew && full.length > p.name.length && norm(full).startsWith(p.n.split(' ')[0].slice(0, 3))) {
          if (!String(p.aliases || '').toLowerCase().includes(p.name.toLowerCase())) p.aliases = [p.aliases, p.name].filter(Boolean).join('; ');
          out.renamed.push(`${p.name} → ${full}`); p.name = full; if (apply) run('UPDATE people SET name=? WHERE id=?', full, p.id);
        }
        p.gw = [...new Set([...p.gw, ...gIds])];
        const h = parseHours(r[C.hours]);
        if (h.week != null) { p.budget_week = h.week; p.budget_month = h.month; } else out.offen.push(p.name);
        if (h.employment) p.employment = h.employment;
        if (h.win) { p.available_from = h.win.from || ''; p.available_until = h.win.until || ''; }
        const hint = [r[C.hours] ? `Stunden/Vertrag: ${r[C.hours]}` : '', r[C.hint] ? String(r[C.hint]) : ''].filter(Boolean).join(' · ');
        if (hint && !String(p.notes || '').includes(hint)) p.notes = [p.notes, hint].filter(Boolean).join('\n');
        if (apply) {
          savePerson(p);
          if (C.mail && r[C.mail] && !/^offen$/i.test(r[C.mail])) run('UPDATE people SET email=? WHERE id=?', String(r[C.mail]).trim(), p.id);
          if (C.phone && r[C.phone] && !/^offen$/i.test(r[C.phone])) run('UPDATE people SET phone=? WHERE id=?', String(r[C.phone]).trim(), p.id);
        }
        if (h.win && p.id > 0) for (const a of all("SELECT s.date,g.name gname FROM assignments a JOIN shifts s ON s.id=a.shift_id JOIN gewerke g ON g.id=a.gewerk_id WHERE a.person_id=? AND a.status!='frei' AND (s.date<? OR (?!='' AND s.date>?)) ORDER BY s.date", p.id, h.win.from || '0000', h.win.until || '', h.win.until || '9999'))
          out.konflikte.push(`${p.name}: ${dm(a.date)} ${a.gname} – laut Liste nur verfügbar ${h.win.from ? 'ab ' + dm(h.win.from) : ''}${h.win.until ? ' bis ' + dm(h.win.until) : ''}`);
        const entry = { name: p.name, vorher: isNew ? null : `${before.week} h/W · ${before.month} h/M`, jetzt: `${p.budget_week} h/W · ${p.budget_month} h/M`, text: String(r[C.hours] || ''), von: p.available_from || '', bis: p.available_until || '' };
        (isNew ? out.created : out.updated).push(entry);
      }
      // Sperrtage (Blatt „Sperrtage einzeln“) und Abgleich mit den Einteilungen
      const sp = sheets['Sperrtage einzeln'] || {};
      const ins = apply ? db.prepare("INSERT INTO availability(person_id,date,status,note) VALUES(?,?,'no',?) ON CONFLICT(person_id,date) DO UPDATE SET status='no',note=excluded.note") : null;
      const seen = new Set();
      for (const [rn, r] of Object.entries(sp)) {
        if (+rn < 2 || typeof r.B !== 'number') continue;
        const label = String(r.A || '').trim(), p = byLabel[norm(label)] || matchStaff(people, label, label, new Set());
        if (!p) { if (!out.unbekannt.includes(label)) out.unbekannt.push(label); continue; }
        const date = serialToDate(r.B), key = p.id + date; if (seen.has(key)) continue; seen.add(key);
        out.blocks++; ins?.run(p.id, date, 'Sperrtag: ' + String(r.D || '').trim());
        if (p.id > 0) for (const a of all("SELECT s.date,s.kind,g.name gname FROM assignments a JOIN shifts s ON s.id=a.shift_id JOIN gewerke g ON g.id=a.gewerk_id WHERE a.person_id=? AND s.date=? AND a.status!='frei'", p.id, date))
          out.konflikte.push(`${p.name}: ${dm(date)} ${a.gname} (${{ tag: 'Tag', mitte: 'Mitte', abend: 'Abend' }[a.kind] || a.kind}) – ${String(r.D || 'Sperrtermin').trim()}`);
      }
      if (apply) { db.exec('COMMIT'); log(null, 'import.staff', `${out.updated.length} aktualisiert, ${out.created.length} neu, ${out.blocks} Sperrtage`); }
    } catch (e) { if (apply) db.exec('ROLLBACK'); throw e; }
    return out;
  }

  return { importPeopleText, importXlsx, importExact, importStaff, parsePeopleText };
};

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

  function newPerson(people, apply, fields) {
    const pin = (() => { let x; do x = String(Math.floor(1000 + Math.random() * 9000)); while (get('SELECT 1 FROM people WHERE pin=?', x) || people.some(p => p.pin === x)); return x; })();
    const row = { name: fields.name, phone: '', email: '', pin, role: 'staff', employment: EMP_DEFAULT, budget_month: 40, budget_week: 20, gw: [], main: [], fixed: 0, notes: '', active: 1, aliases: '', ...fields };
    if (apply) {
      const r = run('INSERT INTO people(name,phone,email,pin,token,role,employment,budget_month,budget_week,gewerke,main_gewerke,fixed,aliases,notes,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        row.name, '', '', pin, crypto.randomBytes(12).toString('hex'), 'staff', row.employment, row.budget_month, row.budget_week, JSON.stringify(row.gw), JSON.stringify(row.main), row.fixed, row.aliases, row.notes, now());
      row.id = Number(r.lastInsertRowid);
    } else row.id = -(people.length + 1);
    row.n = norm(row.name); row.virtual = !apply; people.push(row); return row;
  }
  function savePerson(p) {
    run('UPDATE people SET gewerke=?,main_gewerke=?,fixed=?,budget_month=?,budget_week=?,employment=?,aliases=?,notes=? WHERE id=?', JSON.stringify(p.gw), JSON.stringify(p.main), p.fixed || 0, p.budget_month, p.budget_week, p.employment, p.aliases || '', p.notes || '', p.id);
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
      rows.push({ name, week: hrs ? Number(hrs[1].replace(',', '.')) : null, plus: !!hrs?.[2], cap: cap ? Number(cap[1].replace(',', '.')) : null, capMonth: cap?.[2] || '', fixed, gw, main: vorw ? gewerkeIn(vorw[1]) : gw, line });
    }
    return rows;
  }
  function importPeopleText(text, apply) {
    const gws = Object.fromEntries(all('SELECT id,short FROM gewerke WHERE active=1').map(g => [g.short.toUpperCase(), g.id]));
    const rows = parsePeopleText(text), people = loadPeople(), out = { created: [], updated: [], rows: rows.length };
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
        p.employment = p.employment === 'leitung' ? 'leitung' : EMP_DEFAULT;
        p.notes = [p.notes, p.notes?.includes(r.line) ? '' : r.line].filter(Boolean).join('\n');
        if (apply) savePerson(p);
        (isNew ? out.created : out.updated).push({ name: p.name, week: r.week, plus: r.plus, cap: r.cap, fixed: r.fixed, gewerke: r.gw, main: r.main });
      }
      if (apply) { db.exec('COMMIT'); log(null, 'import.people', `${out.created.length} neu, ${out.updated.length} aktualisiert`); }
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
    const out = { people: { created: [], updated: [] }, blocks: 0, assignments: { added: 0, existing: 0, doppelt: 0 }, offen: 0, shiftsCreated: 0, unresolved: {}, blockedPeople: [], konflikte: [] };
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
      // Schichtplan: Einteilungen je Position
      const cutoff = toMin(ctx.setting('rules').day_cutoff || '13:00');
      const taken = new Set(); // shift:person (auch in der Vorschau)
      const needBy = {}, dates = []; // Besetzung je Schicht laut Schichtplan
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
        for (const e of ent) {
          const g = gws[e.g]; if (!g) continue;
          need[e.g] = (need[e.g] || 0) + 1;
          const names = String(e.nm ?? '').split(/[\/,]/).map(x => x.trim()).filter(x => x && x !== '?' && !/^technik$/i.test(x));
          if (!names.length) { out.offen++; continue; }
          for (const nm of names.slice(0, e.g === 'ADL' ? 1 : names.length)) {
            const p = resolve(people, nm, g.id);
            if (!p) { miss(nm); continue; }
            const key = best.id + ':' + p.id;
            if (taken.has(key) || (best.id > 0 && get("SELECT 1 FROM assignments WHERE shift_id=? AND person_id=? AND status!='frei'", best.id, p.id))) { out.assignments[taken.has(key) ? 'doppelt' : 'existing']++; continue; }
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

  return { importPeopleText, importXlsx, parsePeopleText };
};

'use strict';
// Dienstplan-Planer: verteilt offene Plätze auf Personen (Vorschlag, schreibt erst mit apply).
// Harte Regeln: Qualifikation (Gewerke), Sperrtage, keine Überschneidung, Ruhezeit, max. Stunden/Tag, Monatsbudget,
// Entweder-oder-Tage (24.12./31.12.), je Woche ein freier Tag, Schicht höchstens max_shift_min.
// Gerechtigkeit: Wochenstunden im Verhältnis zum Soll (Budget h/Woche); Spezialisten (nur ein Gewerk) zuerst, danach nach Auslastung.
// Nicht angefasst werden: bereits eingeteilte Plätze, Personen mit „Schichten fix“, Leitung.
module.exports = (ctx) => {
  const { all, get, run, setting, shiftView, gwWindow, log, now } = ctx;
  const toT = (m) => String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0') + ':' + String(Math.round(m) % 60).padStart(2, '0');
  const dayNum = (d) => Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000);
  const numDay = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
  const weekOf = (d) => { const n = dayNum(d); return numDay(n - ((n + 3) % 7)); }; // Montag der Woche
  const PRIO = { ADL: 0, K: 1, BA: 2, E: 3 };

  function propose(opt = {}) {
    const rules = setting('rules'), season = setting('season');
    const from = opt.from || season.start, to = opt.to || season.end;
    const restMin = (rules.rest_h ?? 11) * 60, maxDay = rules.max_day_h ?? 10, maxShift = (rules.max_shift_min || 0) / 60;
    const excl = new Set(rules.exclusive_days || ['12-24', '12-31']), freeDay = rules.free_day !== false;
    const gws = all('SELECT * FROM gewerke WHERE active=1'), gwById = Object.fromEntries(gws.map(g => [g.id, g]));

    // Personen
    const P = all('SELECT * FROM people WHERE active=1').map(p => ({ id: p.id, name: p.name, gw: new Set(JSON.parse(p.gewerke || '[]')), main: new Set(JSON.parse(p.main_gewerke || '[]')), fixed: !!p.fixed, leit: p.role === 'admin' || p.employment === 'leitung', target: p.budget_week || 0, cap: p.budget_month || 0, items: [], week: {}, month: {}, days: {}, wknd: 0 }));
    const byId = Object.fromEntries(P.map(p => [p.id, p]));
    const plannable = (p) => !p.fixed && !p.leit && p.gw.size && p.target > 0 && p.target < 90;
    const avail = {}; for (const a of all("SELECT * FROM availability WHERE status IN ('no','maybe')")) (avail[a.person_id] ||= {})[a.date] = a.status;

    const add = (p, date, a, e, shiftId) => {
      const h = (e - a) / 60, wk = weekOf(date), mo = date.slice(0, 7);
      p.items.push({ date, a, e, h, shift: shiftId }); p.week[wk] = (p.week[wk] || 0) + h; p.month[mo] = (p.month[mo] || 0) + h;
      (p.days[wk] ||= new Set()).add(date);
      const dw = (dayNum(date) + 4) % 7; if (dw === 0 || dw === 6) p.wknd++; // 0 = So, 6 = Sa
      return h;
    };
    // vorhandene Einteilungen (ganze Saison) zählen mit
    for (const r of all("SELECT a.person_id,a.gewerk_id,s.* FROM assignments a JOIN shifts s ON s.id=a.shift_id WHERE a.status!='frei' AND a.person_id IS NOT NULL")) {
      const p = byId[r.person_id], g = gwById[r.gewerk_id]; if (!p || !g) continue;
      const [a, e] = gwWindow(r, g); if (e > a) add(p, r.date, dayNum(r.date) * 1440 + a, dayNum(r.date) * 1440 + e, r.id);
    }

    // offene Plätze im Zeitraum
    const adlFix = rules.adl_fixed_until || ''; // ADL bis einschließlich diesem Datum bleibt wie eingetragen
    const slots = [];
    for (const s of all('SELECT * FROM shifts WHERE date>=? AND date<=? ORDER BY date,start', from, to)) {
      const v = shiftView(s);
      for (const g of v.gewerke) {
        const [a, e] = gwWindow(s, g.gewerk); if (e <= a) continue;
        if (g.gewerk.short === 'ADL' && adlFix && s.date <= adlFix) continue;
        for (let i = 0; i < g.missing; i++) slots.push({ s, g: g.gewerk, date: s.date, a: dayNum(s.date) * 1440 + a, e: dayNum(s.date) * 1440 + e, h: (e - a) / 60, taken: false });
      }
    }
    slots.sort((x, y) => x.date.localeCompare(y.date) || x.a - y.a || (PRIO[x.g.short] ?? 9) - (PRIO[y.g.short] ?? 9));

    const proposals = [], reasons = new Map();
    const inShift = (p, sid) => p.items.some(i => i.shift === sid);
    const wfrac = (wk) => { // Anteil der Woche im Planungszeitraum (für angeschnittene Wochen)
      const w0 = dayNum(wk), a = Math.max(w0, dayNum(from)), b = Math.min(w0 + 6, dayNum(to)); return Math.max(1 / 7, (b - a + 1) / 7);
    };
    function judge(p, sl, pass, why) {
      const no = (r) => { why?.set(r, (why.get(r) || 0) + 1); return null; };
      if (!p.gw.has(sl.g.id)) return no('nicht qualifiziert');
      const st = avail[p.id]?.[sl.date]; if (st === 'no') return no('gesperrt');
      if (inShift(p, sl.s.id)) return no('schon in der Schicht');
      let dayH = 0, sameDay = 0;
      for (const it of p.items) {
        if (sl.a < it.e && sl.e > it.a) return no('Überschneidung');
        if (it.date === sl.date) { dayH += it.h; sameDay++; } else { const gap = sl.a >= it.e ? sl.a - it.e : it.a - sl.e; if (gap < restMin) return no('Ruhezeit'); }
      }
      if (dayH + sl.h > maxDay + 0.01) return no('zu lang am Tag');
      if (pass < 3 && maxShift && sl.h > maxShift + 0.01) return no('Schicht zu lang');
      if ((p.month[sl.date.slice(0, 7)] || 0) + sl.h > p.cap + 0.01) return no('Monatsbudget');
      const md = sl.date.slice(5);
      if (excl.has(md) && p.items.some(i => i.date !== sl.date && excl.has(i.date.slice(5)) && i.date.slice(0, 4) === sl.date.slice(0, 4))) return no('24.12./31.12. nur einer');
      const wk = weekOf(sl.date), have = p.week[wk] || 0, limit = p.target * wfrac(wk);
      if (pass === 1 && have + sl.h > limit + 1.5) return no('Wochenstunden voll');
      if (pass === 2 && have + sl.h > limit * 1.25 + 2) return no('Wochenstunden voll');
      const days = p.days[wk]; if (freeDay && pass < 3 && !days?.has(sl.date) && (days?.size || 0) >= 6) return no('kein freier Tag');
      const tier = p.gw.size === 1 ? 0 : 1, secondary = p.main.size && !p.main.has(sl.g.id);
      let streak = 0; for (let d = dayNum(sl.date) - 1; d > dayNum(sl.date) - 7; d--) { if (p.items.some(i => dayNum(i.date) === d)) streak++; else break; }
      const dw = (dayNum(sl.date) + 4) % 7, weekend = dw === 0 || dw === 6;
      return tier * (sl.g.short === 'ADL' ? 50 : 12) + (secondary ? 30 : 0) + ((have + sl.h) / Math.max(1, limit)) * 40 + (st === 'maybe' ? 6 : 0) + (sameDay ? 15 : 0) + streak * 3 + (weekend ? p.wknd * 2 / Math.max(1, p.target / 10) : 0);
    }
    const pool = P.filter(plannable);
    for (const pass of [1, 2, 3]) {
      for (const sl of slots) {
        if (sl.taken) continue;
        let best = null, bs = Infinity;
        for (const p of pool) { const sc = judge(p, sl, pass); if (sc != null && sc < bs) { bs = sc; best = p; } }
        if (!best) continue;
        sl.taken = true; const h = add(best, sl.date, sl.a, sl.e, sl.s.id);
        proposals.push({ shift_id: sl.s.id, gewerk_id: sl.g.id, person_id: best.id, person: best.name, date: sl.date, gewerk: sl.g.short, start: toT(sl.a), end: toT(sl.e), hours: Math.round(h * 100) / 100, pass });
      }
    }
    const unfilled = slots.filter(s => !s.taken).map(sl => {
      const why = new Map(); for (const p of pool) judge(p, sl, 3, why);
      return { shift_id: sl.s.id, gewerk_id: sl.g.id, date: sl.date, gewerk: sl.g.short, start: toT(sl.a), end: toT(sl.e), grund: [...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`).join(', ') };
    });
    // Auswertung je Person und Woche (inkl. vorhandener Einteilungen)
    const wk0 = weekOf(from), wk1 = weekOf(to), weeks = []; for (let n = dayNum(wk0); n <= dayNum(wk1); n += 7) weeks.push(numDay(n));
    const neu = {}; for (const pr of proposals) neu[pr.person_id] = (neu[pr.person_id] || 0) + pr.hours;
    const stats = P.filter(p => plannable(p) || p.items.length).map(p => ({
      id: p.id, name: p.name, target: p.target, fixed: p.fixed, plannable: plannable(p), neu: Math.round((neu[p.id] || 0) * 10) / 10,
      weeks: weeks.map(w => ({ week: w, hours: Math.round((p.week[w] || 0) * 10) / 10, days: p.days[w]?.size || 0 })),
      total: Math.round(weeks.reduce((s, w) => s + (p.week[w] || 0), 0) * 10) / 10,
    })).filter(x => x.plannable || x.total).sort((a, b) => a.name.localeCompare(b.name));
    return { from, to, slots: slots.length, filled: proposals.length, proposals, unfilled, stats, weeks };
  }

  function apply(proposals, pid) {
    let ok = 0, skipped = 0;
    for (const p of proposals) {
      const s = get('SELECT * FROM shifts WHERE id=?', p.shift_id);
      if (!s || get("SELECT 1 FROM assignments WHERE shift_id=? AND person_id=? AND status!='frei'", p.shift_id, p.person_id)) { skipped++; continue; }
      const g = shiftView(s).gewerke.find(x => x.gewerk.id === p.gewerk_id);
      if (!g || g.missing < 1) { skipped++; continue; }
      run("INSERT INTO assignments(shift_id,gewerk_id,person_id,status,created) VALUES(?,?,?,'fest',?)", p.shift_id, p.gewerk_id, p.person_id, now()); ok++;
    }
    log(pid, 'plan.auto', `${ok} Einteilungen vom Planer übernommen${skipped ? `, ${skipped} übersprungen` : ''}`);
    return { ok, skipped };
  }
  return { propose, apply };
};

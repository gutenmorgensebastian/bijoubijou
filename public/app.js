/* Hüttenplan – Frontend (vanilla JS) */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (path, opt = {}) => {
  const r = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const toast = (t, bad) => { const d = document.createElement('div'); d.className = 'toast' + (bad ? ' bad' : ''); d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), bad ? 5000 : 2500); };
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const fmtD = (d) => { const x = new Date(d + 'T12:00:00'); return `${WD[x.getDay()]} ${x.getDate()}.${x.getMonth() + 1}.`; };
const fmtTs = (ts) => { const x = new Date(ts); return `${x.getDate()}.${x.getMonth() + 1}. ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };
const today = () => { const x = new Date(); return x.toISOString().slice(0, 10); };
const kindName = (k) => k === 'tag' ? 'Tagschicht' : 'Abendschicht';

const S = { me: null, people: [], gewerke: [], season: null, rules: null, checklist: [], shifts: [], availability: [], view: 'plan', month: null, drawer: null, chat: 'allgemein', hoursMonth: null, filterGw: '' };
const app = $('#app');
const gw = (id) => S.gewerke.find(g => g.id === id) || { name: '?', color: '#888', short: '?' };
const person = (id) => S.people.find(p => p.id === id);
const isAdmin = () => S.me?.role === 'admin';
const myGw = () => S.me?.gewerke || [];

// ---------- Boot ----------
async function boot() {
  const me = await fetch('/api/me').then(r => r.json()).catch(() => null);
  if (!me) return renderLogin();
  const b = await api('/bootstrap');
  Object.assign(S, b);
  S.month = S.month || (today() >= S.season.start && today() <= S.season.end ? today().slice(0, 7) : S.season.start.slice(0, 7));
  S.hoursMonth = S.hoursMonth || S.month;
  await loadShifts();
  render();
  const es = new EventSource('/api/events');
  es.onmessage = async (e) => { const m = JSON.parse(e.data); if (m.type === 'shifts') { await loadShifts(); render(); } else if (m.type === 'people' || m.type === 'settings') { Object.assign(S, await api('/bootstrap')); await loadShifts(); render(); } else if (m.type === 'chat' && S.view === 'chat') renderView(); };
}
async function loadShifts() { const r = await api('/shifts'); S.shifts = r.shifts; S.availability = r.availability; S.budget = r.budget || {}; }
const budgetOf = (pid, date) => S.budget[`${pid}:${date.slice(0, 7)}`] || { level: 'ok', hours: 0 };

function renderLogin() {
  app.innerHTML = `<div class="login card"><h2>Hüttenplan</h2><p class="mute">Märchenhütten im Monbijoupark – Schichtplan</p><input id="pin" inputmode="numeric" placeholder="PIN" autofocus><br><br><button class="primary" id="go">Anmelden</button><p class="mute" style="margin-top:20px">Deine PIN bekommst du von der Produktionsleitung.</p></div>`;
  const go = async () => { try { await api('/login', { method: 'POST', body: { pin: $('#pin').value } }); boot(); } catch (e) { toast(e.message, true); } };
  $('#go').onclick = go; $('#pin').onkeydown = e => { if (e.key === 'Enter') go(); };
}

// ---------- Layout ----------
const VIEWS = () => [['plan', 'Plan'], ['mine', 'Mein Plan'], ['open', 'Offen'], ['chat', 'Chat'], ['todos', 'Aufgaben'], ['hours', 'Stunden'], ['people', 'Leute'], ['spielplan', 'Spielplan'], ...(isAdmin() ? [['settings', 'Einstellungen'], ['log', 'Protokoll']] : [])];
function openCount() { let n = 0; for (const s of S.shifts) for (const g of s.gewerke) if (!myGw().length || myGw().includes(g.gewerk.id) || isAdmin()) n += g.missing + g.open; return n; }
function render() {
  app.innerHTML = `<header><h1>Hüttenplan</h1><span class="me">${esc(S.me.name)}${isAdmin() ? ' · Admin' : ''}</span><button class="small" id="logout" style="color:#fff;background:transparent;border-color:#555">Abmelden</button></header>
  <nav>${VIEWS().map(([k, n]) => `<button data-v="${k}" class="${S.view === k ? 'active' : ''}">${n}${k === 'open' && openCount() ? `<span class="badge">${openCount()}</span>` : ''}</button>`).join('')}</nav><main id="main"></main><div id="drawer"></div>`;
  app.querySelectorAll('nav button').forEach(b => b.onclick = () => { S.view = b.dataset.v; render(); });
  $('#logout').onclick = async () => { await api('/logout'); location.reload(); };
  renderView(); renderDrawer();
}
async function renderView() {
  const m = $('#main'); if (!m) return;
  const fn = { plan: viewPlan, mine: viewMine, open: viewOpen, chat: viewChat, todos: viewTodos, hours: viewHours, people: viewPeople, spielplan: viewSpielplan, settings: viewSettings, log: viewLog }[S.view];
  await fn(m);
}

// ---------- Plan ----------
function monthDays(ym) { const [y, mo] = ym.split('-').map(Number); const n = new Date(y, mo, 0).getDate(); return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`); }
function shiftCard(s) {
  const mine = s.gewerke.some(g => g.assignments.some(a => a.person_id === S.me.id && a.status !== 'frei'));
  const chips = s.gewerke.filter(g => g.demand || g.assignments.length).map(g => {
    const names = g.assignments.filter(a => a.status !== 'frei').map(a => { const b = budgetOf(a.person_id, s.date); const n = esc(a.person_name.split(' ')[0]); return b.level === 'ok' ? n : `<u class="bud-${b.level}" title="${b.hours} h im Monat – ${b.level === 'bad' ? 'Budget/Minijob-Grenze überschritten' : 'über 85 % des Budgets'}">${n}${b.level === 'bad' ? ' ⚠' : ''}</u>`; });
    const label = `${g.gewerk.short} ${g.filled}/${g.demand}${names.length ? ' ' + names.join(', ') : ''}`;
    return `<span class="chip ${g.missing ? 'miss' : ''}" style="background:${g.gewerk.color}">${label}</span>${g.open ? `<span class="chip frei">${g.gewerk.short} frei</span>` : ''}`;
  }).join('');
  const perf = s.performances.length ? `${s.performances.length} Vorst. · ${s.performances[0].time}–${s.performances[s.performances.length - 1].time}` : 'ohne Vorstellung';
  return `<div class="shift ${s.status} ${mine ? 'mine' : ''}" data-s="${s.id}"><div class="t">${kindName(s.kind)} ${s.start}–${s.end}${s.peak ? ' · ★' : ''}${s.note ? ' · ' + esc(s.note) : ''}</div><div class="perf">${esc(perf)}</div><div class="chips">${chips}</div></div>`;
}
function viewPlan(m) {
  const days = monthDays(S.month);
  const [y, mo] = S.month.split('-').map(Number);
  const prev = new Date(y, mo - 2, 1), next = new Date(y, mo, 1);
  const pm = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`, nm = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  const avail = {}; for (const a of S.availability) (avail[a.date] ||= []).push(a);
  const open = S.shifts.filter(s => s.date.startsWith(S.month)).reduce((n, s) => n + s.missing, 0);
  m.innerHTML = `<div class="plan-controls"><button id="pm">‹</button><h2 style="margin:0">${MON[mo - 1]} ${y}</h2><button id="nm">›</button>
    <span class="pill ${open ? 'bad' : 'ok'}">${open ? open + ' Plätze offen' : 'alles besetzt'}</span>${isAdmin() ? (() => { const over = S.people.filter(p => p.active && budgetOf(p.id, S.month + '-01').level === 'bad'); return over.length ? `<span class="pill bad" title="${esc(over.map(p => p.name).join(', '))}">⚠ ${over.length} über Budget</span>` : ''; })() : ''}
    ${isAdmin() ? `<button class="right small" id="addShift">+ Schicht</button><button class="small" id="regen" title="Schichten aus dem Spielplan nachziehen">Aus Spielplan aktualisieren</button><button class="small" onclick="window.print()">Drucken</button>` : ''}</div>
    <div class="legend"><span><i style="background:var(--ok)"></i>voll besetzt</span><span><i style="background:var(--bad)"></i>offen</span><span><i style="border:2px dashed var(--warn)"></i>freigegeben (Tausch)</span><span>★ Spitzentag (höhere Besetzung)</span><span>Rahmen = du bist eingeteilt</span><span><u class="bud-warn">Name</u> = über 85 % Budget</span><span><u class="bud-bad">Name ⚠</u> = Stunden/Minijob überschritten</span></div>
    <div class="card" style="margin-top:10px">${days.map(d => {
      const ss = S.shifts.filter(s => s.date === d); const tag = ss.find(s => s.kind === 'tag'), ab = ss.find(s => s.kind === 'abend');
      const hol = ['2026-12-24', '2026-12-25', '2026-12-26', '2026-12-31', '2027-01-01'].includes(d);
      const av = (avail[d] || []).filter(a => a.status === 'no').map(a => person(a.person_id)?.name.split(' ')[0]).filter(Boolean);
      if (!ss.length && (d < S.season.start || d > S.season.end)) return '';
      return `<div class="day ${d === today() ? 'today' : ''}"><div class="dh">${fmtD(d)}${hol ? '<span class="hol"> Feiertag</span>' : ''}<small>${ss.length ? '' : 'spielfrei'}${av.length ? `<span title="nicht verfügbar">⛔ ${esc(av.join(', '))}</span>` : ''}</small></div>
        ${tag ? shiftCard(tag) : '<div class="empty hide-m">–</div>'}${ab ? shiftCard(ab) : '<div class="empty">–</div>'}</div>`;
    }).join('')}</div>`;
  $('#pm').onclick = () => { S.month = pm; renderView(); }; $('#nm').onclick = () => { S.month = nm; renderView(); };
  m.querySelectorAll('.shift').forEach(el => el.onclick = () => openShift(Number(el.dataset.s)));
  if (isAdmin()) {
    $('#regen').onclick = async () => { const r = await api('/shifts/regenerate', { method: 'POST' }); toast(`${r.created} neue Schichten`); };
    $('#addShift').onclick = async () => { const date = prompt('Datum (JJJJ-MM-TT)', S.month + '-01'); if (!date) return; const kind = confirm('Abendschicht? (Abbrechen = Tagschicht)') ? 'abend' : 'tag'; const start = prompt('Beginn (HH:MM)', kind === 'tag' ? '09:30' : '17:00'); const end = prompt('Ende (HH:MM)', kind === 'tag' ? '13:00' : '23:00'); try { await api('/shifts', { method: 'POST', body: { date, kind, start, end } }); } catch (e) { toast(e.message, true); } };
  }
}

// ---------- Schicht-Drawer ----------
async function openShift(id) { S.drawer = id; renderDrawer(); }
function renderDrawer() {
  const d = $('#drawer'); if (!d) return;
  if (!S.drawer) { d.innerHTML = ''; return; }
  const s = S.shifts.find(x => x.id === S.drawer); if (!s) { S.drawer = null; d.innerHTML = ''; return; }
  const admin = isAdmin();
  const items = S.checklist.filter(c => s.gewerke.some(g => g.gewerk.id === c.gewerk_id && (admin || g.assignments.some(a => a.person_id === S.me.id))));
  const done = Object.fromEntries(s.checks.map(c => [c.item_id, c]));
  const mineHere = s.gewerke.flatMap(g => g.assignments).some(a => a.person_id === S.me.id);
  const isADL = s.gewerke.some(g => /abenddienst/i.test(g.gewerk.name) && g.assignments.some(a => a.person_id === S.me.id));
  d.innerHTML = `<div class="drawer-bg" id="dbg"></div><div class="drawer">
    <h2>${fmtD(s.date)} · ${kindName(s.kind)} <button class="x small" id="dclose">✕</button></h2>
    <div class="row mute">${s.start}–${s.end}${s.peak ? ' · ★ Spitzentag' : ''}${s.holiday ? ' · Sonn-/Feiertag' : ''}${admin ? `<button class="small right" id="editShift">Zeiten/Besetzung</button><button class="small danger" id="delShift">Löschen</button>` : ''}</div>
    ${s.note ? `<div class="card" style="margin-top:8px">${esc(s.note)}</div>` : ''}
    <div class="card" style="margin-top:10px"><h3>Vorstellungen</h3>${s.performances.length ? s.performances.map(p => `<div><b>${p.time}</b> ${esc(p.title)} <span class="mute">${esc(p.audience)}</span></div>`).join('') : '<span class="mute">keine</span>'}</div>
    <div class="card"><h3>Besetzung</h3>${s.gewerke.filter(g => g.demand || g.assignments.length || admin).map(g => {
      const rows = g.assignments.map(a => `<div class="slot ${a.status}"><div class="who">${a.status === 'frei' ? '<b>FREI – wer übernimmt?</b>' : `<b>${esc(a.person_name)}</b>${budgetOf(a.person_id, s.date).level !== 'ok' ? ` <span class="pill ${budgetOf(a.person_id, s.date).level}">${budgetOf(a.person_id, s.date).hours} h/Monat</span>` : ''}`}${a.status === 'angefragt' ? ' <span class="pill warn">wartet auf Freigabe</span>' : ''}<small>Kommzeit ${a.arrive_calc} · bis ${a.actual_end || s.end} · ${a.hours} h${a.note ? ' · ' + esc(a.note) : ''}</small></div>
        ${a.status === 'frei' && (admin || myGw().includes(g.gewerk.id)) ? `<button class="small primary" data-take="${a.id}" data-g="${g.gewerk.id}">Übernehmen</button>` : ''}
        ${a.status !== 'frei' && (a.person_id === S.me.id || admin) ? `<button class="small" data-release="${a.id}" title="Schicht zum Tausch freigeben">Freigeben</button><button class="small" data-times="${a.id}" title="Ist-Zeiten eintragen">Zeiten</button>` : ''}
        ${a.status === 'angefragt' && admin ? `<button class="small primary" data-approve="${a.id}">OK</button>` : ''}
        ${admin || a.person_id === S.me.id ? `<button class="small danger" data-del="${a.id}">✕</button>` : ''}</div>`).join('');
      const empties = Array.from({ length: g.missing }, () => `<div class="slot leer"><div class="who">offen</div>${myGw().includes(g.gewerk.id) ? `<button class="small primary" data-self="${g.gewerk.id}">Ich mache das</button>` : ''}${admin ? `<select data-assign="${g.gewerk.id}"><option value="">Person wählen…</option>${S.people.filter(p => p.active && p.gewerke.includes(g.gewerk.id)).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}<option value="-1">— andere —</option></select>` : ''}</div>`).join('');
      return `<div class="gwhead"><span class="dot" style="background:${g.gewerk.color}"></span><b>${esc(g.gewerk.name)}</b><span class="mute">${g.filled}/${g.demand}</span><span class="pill ${g.missing ? 'bad' : 'ok'}">${g.missing ? g.missing + ' fehlt' : 'ok'}</span></div>${rows}${empties}`;
    }).join('')}</div>
    ${items.length ? `<div class="card"><h3>Checkliste</h3>${['start', 'ende'].map(ph => { const it = items.filter(i => i.phase === ph); return it.length ? `<div class="mute">${ph === 'start' ? 'Vor der Vorstellung' : 'Nach der Vorstellung'}</div>` + it.map(i => `<label class="check ${done[i.id] ? 'done' : ''}"><input type="checkbox" data-check="${i.id}" ${done[i.id] ? 'checked' : ''}> <span style="color:${gw(i.gewerk_id).color}">${gw(i.gewerk_id).short}</span> ${esc(i.text)}${done[i.id] ? `<small class="mute"> ${person(done[i.id].person_id)?.name.split(' ')[0] || ''}</small>` : ''}</label>`).join('') : ''; }).join('')}</div>` : ''}
    <div class="card"><h3>Aufgaben für diese Schicht</h3>${s.todos.map(t => `<label class="check ${t.done ? 'done' : ''}"><input type="checkbox" data-todo="${t.id}" ${t.done ? 'checked' : ''}> ${t.gewerk_id ? `<span style="color:${gw(t.gewerk_id).color}">${gw(t.gewerk_id).short}</span>` : ''} ${esc(t.text)}${t.done ? `<small class="mute"> ${esc(t.done_name || '')}</small>` : ''}${admin ? `<button class="small danger" data-deltodo="${t.id}">✕</button>` : ''}</label>`).join('') || '<span class="mute">keine</span>'}
      <div class="row" style="margin-top:6px"><input id="todoText" placeholder="Neue Aufgabe…" class="grow"><select id="todoGw" style="width:auto"><option value="">alle</option>${S.gewerke.filter(g => g.active).map(g => `<option value="${g.id}">${g.short}</option>`).join('')}</select><button class="small" id="todoAdd">+</button></div></div>
    <div class="card"><h3>Schichtbericht ${s.report ? `<span class="pill ok">von ${esc(s.report.person_name)} · ${fmtTs(s.report.ts)}</span>` : ''}</h3>
      ${s.report || isADL || admin || mineHere ? `<label>Wie lief es?</label><textarea id="rText" rows="3">${esc(s.report?.text || '')}</textarea><div class="row"><div class="grow"><label>Besucher ca.</label><input id="rVis" type="number" value="${s.report?.visitors ?? ''}"></div><div class="grow"><label>Kasse €</label><input id="rCash" type="number" step="0.01" value="${s.report?.cash ?? ''}"></div></div><label>Vorkommnisse / Schäden / Fehlzeiten</label><textarea id="rInc" rows="2">${esc(s.report?.incidents || '')}</textarea><button class="primary" id="rSave" style="margin-top:8px">Bericht speichern</button>` : '<span class="mute">noch kein Bericht</span>'}</div>
    <div class="card"><h3>Chat zu dieser Schicht</h3><button class="small" id="toChat">Zum Tages-Chat ${fmtD(s.date)}</button></div>
  </div>`;
  const close = () => { S.drawer = null; renderDrawer(); };
  $('#dbg').onclick = close; $('#dclose').onclick = close;
  const act = async (fn) => { try { const r = await fn(); if (r?.warnings?.length) toast('⚠ ' + r.warnings.join(' · '), true); } catch (e) { toast(e.message, true); } };
  d.querySelectorAll('[data-self]').forEach(b => b.onclick = () => act(() => api('/assign', { method: 'POST', body: { shift_id: s.id, gewerk_id: Number(b.dataset.self) } })));
  d.querySelectorAll('[data-take]').forEach(b => b.onclick = () => act(() => api('/assign', { method: 'POST', body: { shift_id: s.id, gewerk_id: Number(b.dataset.g), take_id: Number(b.dataset.take) } })));
  d.querySelectorAll('[data-assign]').forEach(sel => sel.onchange = () => { let pid = Number(sel.value); if (pid === -1) { const n = prompt('Name der Person (muss in „Leute“ angelegt sein):'); const pp = S.people.find(p => p.name.toLowerCase().startsWith((n || '').toLowerCase())); if (!pp) return toast('nicht gefunden', true); pid = pp.id; } if (pid) act(() => api('/assign', { method: 'POST', body: { shift_id: s.id, gewerk_id: Number(sel.dataset.assign), person_id: pid } })); });
  d.querySelectorAll('[data-release]').forEach(b => b.onclick = () => { const note = prompt('Kurzer Grund / Hinweis für die anderen (optional):', ''); if (note === null) return; act(() => api('/assign/' + b.dataset.release, { method: 'PUT', body: { action: 'release', note } })); });
  d.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => act(() => api('/assign/' + b.dataset.approve, { method: 'PUT', body: { action: 'approve' } })));
  d.querySelectorAll('[data-times]').forEach(b => b.onclick = () => { const a = s.gewerke.flatMap(g => g.assignments).find(x => x.id === Number(b.dataset.times)); const actual_start = prompt('Tatsächlich gekommen um (HH:MM, leer = Plan)', a.actual_start || a.arrive_calc); if (actual_start === null) return; const actual_end = prompt('Tatsächlich gegangen um (HH:MM, leer = Plan)', a.actual_end || s.end); if (actual_end === null) return; act(() => api('/assign/' + a.id, { method: 'PUT', body: { action: 'times', actual_start: actual_start || null, actual_end: actual_end || null, arrive: a.arrive } })); });
  d.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirm('Eintrag entfernen?') && act(() => api('/assign/' + b.dataset.del, { method: 'DELETE' })));
  d.querySelectorAll('[data-check]').forEach(c => c.onchange = () => act(() => api('/check', { method: 'POST', body: { shift_id: s.id, item_id: Number(c.dataset.check), done: c.checked } })));
  d.querySelectorAll('[data-todo]').forEach(c => c.onchange = () => act(() => api('/todos/' + c.dataset.todo, { method: 'PUT', body: { done: c.checked } })));
  d.querySelectorAll('[data-deltodo]').forEach(b => b.onclick = (e) => { e.preventDefault(); act(() => api('/todos/' + b.dataset.deltodo, { method: 'DELETE' })); });
  $('#todoAdd').onclick = () => { const t = $('#todoText').value.trim(); if (t) act(() => api('/todos', { method: 'POST', body: { shift_id: s.id, gewerk_id: Number($('#todoGw').value) || null, text: t } })); };
  if ($('#rSave')) $('#rSave').onclick = () => act(async () => { await api('/report', { method: 'POST', body: { shift_id: s.id, text: $('#rText').value, visitors: Number($('#rVis').value) || null, cash: Number($('#rCash').value) || null, incidents: $('#rInc').value } }); toast('Bericht gespeichert'); });
  $('#toChat').onclick = () => { S.chat = s.date; S.view = 'chat'; S.drawer = null; render(); };
  if (admin) {
    $('#editShift').onclick = async () => {
      const start = prompt('Schichtbeginn = erste Vorstellung (HH:MM)', s.start); if (start === null) return;
      const end = prompt('Schichtende (HH:MM)', s.end); if (end === null) return;
      const note = prompt('Notiz (z.B. Sonderveranstaltung)', s.note || ''); if (note === null) return;
      const demand = {}; for (const g of S.gewerke.filter(x => x.active)) { const v = prompt(`Soll ${g.name}`, s.gewerke.find(x => x.gewerk.id === g.id)?.demand ?? 0); if (v === null) return; demand[g.id] = Number(v); }
      act(() => api('/shifts/' + s.id, { method: 'PUT', body: { start, end, note, demand } }));
    };
    $('#delShift').onclick = () => confirm('Schicht samt Einteilung löschen?') && act(async () => { await api('/shifts/' + s.id, { method: 'DELETE' }); S.drawer = null; });
  }
}

// ---------- Mein Plan ----------
async function viewMine(m) {
  const mine = S.shifts.flatMap(s => s.gewerke.flatMap(g => g.assignments.filter(a => a.person_id === S.me.id).map(a => ({ s, g, a })))).sort((x, y) => x.s.date.localeCompare(y.s.date) || x.s.start.localeCompare(y.s.start));
  const me = await api('/people/' + S.me.id);
  const av = Object.fromEntries((await api('/availability')).map(a => [a.date, a]));
  const months = []; let d = S.season.start.slice(0, 7); while (d <= S.season.end.slice(0, 7)) { months.push(d); const [y, mo] = d.split('-').map(Number); d = `${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}`; }
  const hrs = await api('/hours?month=' + S.hoursMonth);
  const h = hrs.find(x => x.id === S.me.id) || { hours: 0, pay: 0, warnings: [] };
  const icsUrl = `${location.origin}/ics/huettenplan.ics?token=${me.token}`;
  m.innerHTML = `<div class="card"><h2>Mein Plan</h2>
    <div class="row"><div class="grow">${hoursBar(h, S.me)}</div></div>
    <div class="mute">Gewerke: ${myGw().map(id => `<span class="chip" style="background:${gw(id).color}">${esc(gw(id).name)}</span>`).join(' ') || 'keine zugeordnet'}</div>
    <table style="margin-top:8px"><tr><th>Datum</th><th>Schicht</th><th>Gewerk</th><th>Kommzeit</th><th>Ende</th><th>Std</th><th></th></tr>
    ${mine.map(({ s, g, a }) => `<tr class="${a.status === 'frei' ? 'warn' : ''}"><td>${fmtD(s.date)}</td><td>${kindName(s.kind)}</td><td><span class="chip" style="background:${g.gewerk.color}">${esc(g.gewerk.name)}</span></td><td><b>${a.arrive_calc}</b>${a.arrive_calc !== s.start ? `<small class="mute"> (Beginn ${s.start})</small>` : ''}</td><td>${a.actual_end || s.end}</td><td>${a.hours}</td><td>${a.status === 'frei' ? '<span class="pill warn">freigegeben</span>' : a.status === 'angefragt' ? '<span class="pill warn">angefragt</span>' : ''}<button class="small" data-open="${s.id}">Details</button></td></tr>`).join('') || '<tr><td colspan="7" class="mute">Noch keine Schichten. Schau unter „Offen“.</td></tr>'}</table>
    <h3>Kalender-Abo</h3><p class="mute">Diesen Link in Apple/Google-Kalender als Abo einfügen, dann stehen deine Schichten mit Kommzeit automatisch im Handy:</p><input readonly value="${icsUrl}" onclick="this.select()"></div>
    <div class="card"><h3>Meine Verfügbarkeit</h3><p class="mute">Tage antippen: 1× = <b>kann nicht</b>, 2× = <b>unsicher</b>, 3× = wieder frei. Die Produktion sieht das bei der Planung.</p>
    ${months.map(ym => { const days = monthDays(ym); const first = new Date(ym + '-01T12:00:00').getDay(); return `<h3>${MON[Number(ym.slice(5)) - 1]}</h3><div class="cal">${WD.slice(1).concat(WD[0]).map(w => `<div class="off" style="border:none">${w}</div>`).join('')}${Array.from({ length: (first + 6) % 7 }, () => '<div class="off" style="border:none"></div>').join('')}${days.map(d => { const a = av[d]; const has = S.shifts.some(s => s.date === d); const mineDay = mine.some(x => x.s.date === d); return `<div data-av="${d}" class="${a?.status || ''} ${has ? '' : 'off'} ${mineDay ? 'has' : ''}" title="${esc(a?.note || '')}">${Number(d.slice(8))}</div>`; }).join('')}</div>`; }).join('')}</div>
    <div class="card"><h3>Meine Kontaktdaten</h3><label>Telefon</label><input id="mPhone" value="${esc(me.phone || '')}"><label>E-Mail</label><input id="mEmail" value="${esc(me.email || '')}"><label>PIN (4 Ziffern)</label><input id="mPin" value="${esc(me.pin)}"><button class="primary" id="mSave" style="margin-top:8px">Speichern</button></div>`;
  m.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openShift(Number(b.dataset.open)));
  m.querySelectorAll('[data-av]').forEach(el => el.onclick = async () => { if (el.classList.contains('off')) return; const d = el.dataset.av; const cur = av[d]?.status; const next = !cur ? 'no' : cur === 'no' ? 'maybe' : ''; let note = ''; if (next === 'no') note = prompt('Grund (optional)', '') ?? ''; await api('/availability', { method: 'POST', body: { date: d, status: next, note } }); renderView(); });
  $('#mSave').onclick = async () => { try { await api('/people/' + S.me.id, { method: 'PUT', body: { phone: $('#mPhone').value, email: $('#mEmail').value, pin: $('#mPin').value } }); toast('gespeichert'); } catch (e) { toast(e.message, true); } };
}
function hoursBar(h, p) {
  const budget = p.budget_month || 40; const pct = Math.min(100, Math.round(h.hours / budget * 100));
  const cls = h.hours > budget ? 'bad' : h.hours > budget * 0.85 ? 'warn' : '';
  return `<div class="row"><b>${MON[Number(S.hoursMonth.slice(5)) - 1]}</b><span class="${cls === 'bad' ? 'over' : cls === 'warn' ? 'near' : ''}">${h.hours} h von ${budget} h</span><span class="mute">≈ ${h.pay.toFixed(2)} €</span></div><div class="bar ${cls}"><i style="width:${pct}%"></i></div>${h.warnings?.length ? `<div class="pill bad" style="margin-top:4px">${esc(h.warnings.join(' · '))}</div>` : ''}`;
}

// ---------- Offen ----------
function viewOpen(m) {
  const rows = [];
  for (const s of S.shifts) if (s.date >= today()) for (const g of s.gewerke) {
    if (S.filterGw && g.gewerk.id !== Number(S.filterGw)) continue;
    for (const a of g.assignments.filter(a => a.status === 'frei')) rows.push({ s, g, a });
    for (let i = 0; i < g.missing; i++) rows.push({ s, g });
  }
  const mineOnly = !isAdmin() && myGw().length;
  const list = rows.filter(r => !mineOnly || myGw().includes(r.g.gewerk.id));
  m.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">Offene Schichten</h2><select id="fgw" style="width:auto" class="right"><option value="">alle Gewerke</option>${S.gewerke.filter(g => g.active).map(g => `<option value="${g.id}" ${S.filterGw == g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
    <p class="mute">${mineOnly ? 'Es werden nur Schichten deiner Gewerke gezeigt.' : ''} Gestrichelt = jemand hat die Schicht zum Tausch freigegeben.</p>
    <table><tr><th>Datum</th><th>Schicht</th><th>Gewerk</th><th>Kommzeit</th><th></th></tr>${list.map(({ s, g, a }) => `<tr><td>${fmtD(s.date)}</td><td>${kindName(s.kind)} ${s.start}–${s.end}</td><td><span class="chip ${a ? 'frei' : ''}" style="background:${g.gewerk.color}">${esc(g.gewerk.name)}</span>${a?.note ? `<small class="mute"> ${esc(a.note)}</small>` : ''}</td><td>${a ? a.arrive_calc : '–'}</td><td><button class="small primary" data-s="${s.id}" data-g="${g.gewerk.id}" data-a="${a?.id || ''}">${a ? 'Übernehmen' : 'Ich mache das'}</button> <button class="small" data-open="${s.id}">Details</button></td></tr>`).join('') || '<tr><td colspan="5" class="mute">Nichts offen 🎉</td></tr>'}</table></div>`;
  $('#fgw').onchange = (e) => { S.filterGw = e.target.value; renderView(); };
  m.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openShift(Number(b.dataset.open)));
  m.querySelectorAll('[data-s]').forEach(b => b.onclick = async () => { try { const r = await api('/assign', { method: 'POST', body: { shift_id: Number(b.dataset.s), gewerk_id: Number(b.dataset.g), take_id: b.dataset.a ? Number(b.dataset.a) : undefined } }); toast(r.warnings?.length ? '⚠ ' + r.warnings.join(' · ') : 'Eingetragen', !!r.warnings?.length); } catch (e) { toast(e.message, true); } });
}

// ---------- Chat ----------
async function viewChat(m) {
  const chans = await api('/channels');
  const msgs = await api('/messages?channel=' + encodeURIComponent(S.chat));
  const names = ['allgemein', ...chans.map(c => c.channel).filter(c => c !== 'allgemein')];
  const dayChans = S.shifts.filter(s => s.date >= today()).map(s => s.date).filter((d, i, a) => a.indexOf(d) === i).slice(0, 10);
  for (const d of dayChans) if (!names.includes(d)) names.push(d);
  m.innerHTML = `<div class="card chat"><div class="chlist">${names.map(c => `<button class="small ${S.chat === c ? 'active' : ''}" data-ch="${c}">${/^\d{4}/.test(c) ? fmtD(c) : c === 'allgemein' ? '📣 Allgemein' : esc(c)}</button>`).join('')}</div>
    <div class="msgs" id="msgs">${msgs.filter(x => x.pinned).map(renderMsg).join('')}${msgs.filter(x => !x.pinned).map(renderMsg).join('') || '<div class="mute">Noch keine Nachrichten.</div>'}</div>
    <div class="row" style="margin-top:8px"><textarea id="ctext" rows="2" class="grow" placeholder="Nachricht an ${/^\d{4}/.test(S.chat) ? 'alle am ' + fmtD(S.chat) : 'alle'}…"></textarea>${isAdmin() ? '<label style="margin:0"><input type="checkbox" id="cpin" style="width:auto"> anpinnen</label>' : ''}<button class="primary" id="csend">Senden</button></div></div>`;
  m.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => { S.chat = b.dataset.ch; renderView(); });
  const box = $('#msgs'); box.scrollTop = box.scrollHeight;
  const send = async () => { const t = $('#ctext').value.trim(); if (!t) return; await api('/messages', { method: 'POST', body: { channel: S.chat, text: t, pinned: $('#cpin')?.checked } }); $('#ctext').value = ''; renderView(); };
  $('#csend').onclick = send; $('#ctext').onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); };
  m.querySelectorAll('[data-mdel]').forEach(b => b.onclick = async () => { await api('/messages/' + b.dataset.mdel, { method: 'DELETE' }); renderView(); });
  m.querySelectorAll('[data-mpin]').forEach(b => b.onclick = async () => { await api('/messages/' + b.dataset.mpin, { method: 'PUT', body: { pinned: b.dataset.v === '1' } }); renderView(); });
}
const renderMsg = (x) => `<div class="msg ${x.pinned ? 'pinned' : ''}"><b>${esc(x.name || '?')}</b><span class="ts">${fmtTs(x.ts)}</span>${isAdmin() ? `<button class="small" data-mpin="${x.id}" data-v="${x.pinned ? 0 : 1}" style="float:right">${x.pinned ? 'lösen' : '📌'}</button>` : ''}${isAdmin() || x.person_id === S.me.id ? `<button class="small" data-mdel="${x.id}" style="float:right">✕</button>` : ''}<p>${esc(x.text)}</p></div>`;

// ---------- Aufgaben ----------
async function viewTodos(m) {
  const todos = await api('/todos');
  m.innerHTML = `<div class="card"><h2>Aufgaben</h2><p class="mute">Allgemeine Aufgaben je Gewerk (ohne Datum) und Aufgaben zu einzelnen Schichten. Wer abhakt, wird gespeichert.</p>
    <div class="row"><input id="tText" class="grow" placeholder="Neue allgemeine Aufgabe…"><select id="tGw" style="width:auto"><option value="">alle Gewerke</option>${S.gewerke.filter(g => g.active).map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select><button class="primary" id="tAdd">+</button></div>
    <table style="margin-top:10px"><tr><th></th><th>Aufgabe</th><th>Gewerk</th><th>Schicht</th><th>Erledigt</th><th></th></tr>${todos.map(t => `<tr class="${t.done ? 'ok' : ''}"><td><input type="checkbox" data-todo="${t.id}" ${t.done ? 'checked' : ''} style="width:auto"></td><td ${t.done ? 'style="text-decoration:line-through;color:var(--mute)"' : ''}>${esc(t.text)}</td><td>${t.gewerk_id ? `<span class="chip" style="background:${gw(t.gewerk_id).color}">${gw(t.gewerk_id).short}</span>` : '<span class="mute">alle</span>'}</td><td>${t.date ? `<a href="#" data-open="${t.shift_id}">${fmtD(t.date)} ${t.kind}</a>` : '<span class="mute">allgemein</span>'}</td><td class="mute">${t.done ? `${esc(t.done_name || '')} ${fmtTs(t.done_ts)}` : ''}</td><td>${isAdmin() ? `<button class="small danger" data-del="${t.id}">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="mute">keine</td></tr>'}</table></div>`;
  $('#tAdd').onclick = async () => { const t = $('#tText').value.trim(); if (!t) return; await api('/todos', { method: 'POST', body: { text: t, gewerk_id: Number($('#tGw').value) || null } }); renderView(); };
  m.querySelectorAll('[data-todo]').forEach(c => c.onchange = async () => { await api('/todos/' + c.dataset.todo, { method: 'PUT', body: { done: c.checked } }); renderView(); });
  m.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await api('/todos/' + b.dataset.del, { method: 'DELETE' }); renderView(); });
  m.querySelectorAll('[data-open]').forEach(b => b.onclick = (e) => { e.preventDefault(); openShift(Number(b.dataset.open)); });
}

// ---------- Stunden ----------
async function viewHours(m) {
  const rows = await api('/hours?month=' + S.hoursMonth);
  const months = []; let d = S.season.start.slice(0, 7); while (d <= S.season.end.slice(0, 7)) { months.push(d); const [y, mo] = d.split('-').map(Number); d = `${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}`; }
  const limit = S.hoursMonth.startsWith('2027') ? S.rules.minijob_2027 : S.rules.minijob_2026;
  m.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">Stunden</h2><select id="hm" style="width:auto">${months.map(x => `<option value="${x}" ${x === S.hoursMonth ? 'selected' : ''}>${MON[Number(x.slice(5)) - 1]} ${x.slice(0, 4)}</option>`).join('')}</select>${isAdmin() ? `<a class="right" href="/api/hours.csv?month=${S.hoursMonth}">CSV für Lohnabrechnung</a>` : ''}</div>
    <p class="mute">Grün = im Budget, Gelb = über 85 %, Rot = Budget oder Minijob-Grenze (${limit} €/Monat) überschritten. Stunden = Kommzeit bis Schichtende, bzw. eingetragene Ist-Zeiten.</p>
    <table><tr><th>Name</th><th>Form</th><th class="h">Stunden</th><th>Budget</th><th>Betrag</th><th>Hinweise</th></tr>${rows.map(r => { const pct = r.hours / (r.budget_month || 1); const cls = r.warnings.length || pct > 1 ? 'bad' : pct > .85 ? 'warn' : 'ok'; return `<tr class="${cls}" data-p="${r.id}"><td><b>${esc(r.name)}</b></td><td class="mute">${r.employment}</td><td class="h"><b>${r.hours} h</b></td><td>${r.budget_month} h<div class="bar ${cls === 'ok' ? '' : cls}"><i style="width:${Math.min(100, pct * 100)}%"></i></div></td><td>${r.pay.toFixed(2)} €</td><td class="mute">${esc(r.warnings.join(' · '))}</td></tr><tr class="detail" data-d="${r.id}" style="display:none"><td colspan="6"><table>${r.lines.map(l => `<tr><td>${fmtD(l.date)}</td><td>${l.kind}</td><td>${esc(l.gewerk)}</td><td>${l.arrive}–${l.end}</td><td>${l.hours} h</td><td>${l.pay.toFixed(2)} €</td><td>${l.holiday ? '<span class="pill warn">So/Feiertag</span>' : ''}</td></tr>`).join('') || '<tr><td class="mute">keine Schichten</td></tr>'}</table></td></tr>`; }).join('')}</table></div>`;
  $('#hm').onchange = e => { S.hoursMonth = e.target.value; renderView(); };
  m.querySelectorAll('tr[data-p]').forEach(tr => tr.onclick = () => { const d = m.querySelector(`tr[data-d="${tr.dataset.p}"]`); d.style.display = d.style.display === 'none' ? '' : 'none'; });
}

// ---------- Leute ----------
function viewPeople(m) {
  const admin = isAdmin();
  const EMP = { minijob: 'Minijob', midijob: 'Midijob', werkstudent: 'Werkstudent:in', kurzfristig: 'kurzfristig', leitung: 'Leitung', sonstige: 'sonstige' };
  m.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">Leute</h2>${admin ? '<button class="primary right" id="pAdd">+ Person</button>' : ''}</div>
    <table><tr><th>Name</th><th>Gewerke</th><th>Telefon</th><th class="hide-m">E-Mail</th>${admin ? '<th>Form</th><th>Budget</th><th>PIN</th><th></th>' : ''}</tr>${S.people.filter(p => p.active || admin).map(p => `<tr style="${p.active ? '' : 'opacity:.4'}"><td><b>${esc(p.name)}</b>${p.role === 'admin' ? ' <span class="pill ok">Admin</span>' : ''}</td><td>${p.gewerke.map(id => `<span class="chip" style="background:${gw(id).color}">${gw(id).short}</span>`).join(' ')}</td><td>${p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a> <a href="https://wa.me/${esc(p.phone.replace(/[^0-9]/g, '').replace(/^0/, '49'))}" target="_blank" title="WhatsApp">💬</a>` : ''}</td><td class="hide-m">${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}</td>${admin ? `<td class="mute">${EMP[p.employment] || p.employment}</td><td class="mute">${p.budget_month} h/M · ${p.budget_week} h/W</td><td class="mute" data-pin="${p.id}">•••• <button class="small">zeigen</button></td><td><button class="small" data-edit="${p.id}">Bearbeiten</button></td>` : ''}</tr>`).join('')}</table>
    ${admin ? '<p class="mute" style="margin-top:10px">Zugang: Link zur App + persönliche PIN weitergeben. Stundenbudget bei Minijob mit 15 €/h: 40 h (2026) bzw. 42 h (2027) im Monat.</p>' : ''}</div><div id="pForm"></div>`;
  if (!admin) return;
  $('#pAdd').onclick = () => personForm({ gewerke: [], employment: 'minijob', budget_month: 40, budget_week: 20, role: 'staff', active: 1 });
  m.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => personForm(await api('/people/' + b.dataset.edit)));
  m.querySelectorAll('[data-pin] button').forEach(b => b.onclick = async () => { const p = await api('/people/' + b.parentElement.dataset.pin); b.parentElement.innerHTML = `<b>${p.pin}</b>`; });
}
function personForm(p) {
  const EMP = ['minijob', 'midijob', 'werkstudent', 'kurzfristig', 'leitung', 'sonstige'];
  $('#pForm').innerHTML = `<div class="card"><h3>${p.id ? 'Bearbeiten' : 'Neue Person'}</h3>
    <label>Name</label><input id="fName" value="${esc(p.name || '')}"><div class="row"><div class="grow"><label>Telefon</label><input id="fPhone" value="${esc(p.phone || '')}"></div><div class="grow"><label>E-Mail</label><input id="fEmail" value="${esc(p.email || '')}"></div></div>
    <label>Gewerke</label><div class="row">${S.gewerke.filter(g => g.active).map(g => `<label style="margin:0"><input type="checkbox" data-g="${g.id}" ${p.gewerke.includes(g.id) ? 'checked' : ''} style="width:auto"> ${esc(g.name)}</label>`).join('')}</div>
    <div class="row"><div class="grow"><label>Beschäftigungsform</label><select id="fEmp">${EMP.map(e => `<option ${p.employment === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div><div class="grow"><label>Budget h/Monat</label><input id="fBm" type="number" value="${p.budget_month}"></div><div class="grow"><label>Budget h/Woche</label><input id="fBw" type="number" value="${p.budget_week}"></div></div>
    <div class="row"><div class="grow"><label>Rolle</label><select id="fRole"><option value="staff" ${p.role === 'staff' ? 'selected' : ''}>Mitarbeiter:in</option><option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Admin (Produktion/ADL)</option></select></div><div class="grow"><label>PIN (leer = automatisch)</label><input id="fPin" value="${esc(p.pin || '')}"></div><div class="grow"><label>Aktiv</label><select id="fAct"><option value="1" ${p.active ? 'selected' : ''}>ja</option><option value="0" ${!p.active ? 'selected' : ''}>nein</option></select></div></div>
    <label>Notizen (Vertrag, Verfügbarkeit, Semesterferien …)</label><textarea id="fNotes" rows="2">${esc(p.notes || '')}</textarea>
    <div class="row" style="margin-top:10px"><button class="primary" id="fSave">Speichern</button><button id="fCancel">Abbrechen</button></div></div>`;
  $('#fCancel').onclick = () => $('#pForm').innerHTML = '';
  $('#fSave').onclick = async () => {
    const body = { name: $('#fName').value.trim(), phone: $('#fPhone').value.trim(), email: $('#fEmail').value.trim(), gewerke: [...document.querySelectorAll('#pForm [data-g]:checked')].map(c => Number(c.dataset.g)), employment: $('#fEmp').value, budget_month: Number($('#fBm').value), budget_week: Number($('#fBw').value), role: $('#fRole').value, pin: $('#fPin').value.trim() || undefined, active: Number($('#fAct').value), notes: $('#fNotes').value };
    if (!body.name) return toast('Name fehlt', true);
    try { const r = p.id ? await api('/people/' + p.id, { method: 'PUT', body }) : await api('/people', { method: 'POST', body }); toast(r.pin ? `Angelegt. PIN: ${r.pin}` : 'gespeichert'); $('#pForm').innerHTML = ''; } catch (e) { toast(e.message, true); }
  };
}

// ---------- Spielplan ----------
async function viewSpielplan(m) {
  const perfs = await api('/performances');
  const byDate = {}; for (const p of perfs) (byDate[p.date] ||= []).push(p);
  m.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">Spielplan</h2><span class="mute">${perfs.length} Vorstellungen</span>${isAdmin() ? `<button class="right small" id="imp">Von maerchenhuetten.com einlesen</button><button class="small" id="csv">CSV einfügen</button><button class="small" id="addP">+ Vorstellung</button>` : ''}</div>
    <p class="mute">Aus dem Spielplan entstehen die Schichten automatisch: Vorstellungen vor ${S.rules.day_cutoff} Uhr → Tagschicht, danach → Abendschicht. Schichtbeginn = erste Vorstellung, Ende = letzte Vorstellung + ${S.rules.after_min} min.</p>
    ${Object.entries(byDate).map(([d, ps]) => `<div class="row" style="border-bottom:1px solid var(--line);padding:4px 0"><b style="width:90px">${fmtD(d)}</b><div class="grow">${ps.map(p => `<span class="mute" style="margin-right:10px;white-space:nowrap">${p.time} ${esc(p.title)}${isAdmin() ? ` <a href="#" data-delp="${p.id}" style="color:var(--bad)">✕</a>` : ''}</span>`).join('')}</div></div>`).join('')}</div>`;
  if (!isAdmin()) return;
  $('#imp').onclick = async () => { toast('Lese Spielplan…'); try { const r = await api('/performances/import', { method: 'POST' }); if (r.ok) toast(`${r.read} gelesen, ${r.added} neu, ${r.shifts} Schichten angelegt`); else toast(r.error, true); } catch (e) { toast(e.message, true); } };
  $('#csv').onclick = async () => { const csv = prompt('Zeilen im Format JJJJ-MM-TT;HH:MM;Titel;Zielgruppe (eine pro Zeile, mit Umbruch einfügen):'); if (!csv) return; const r = await api('/performances', { method: 'POST', body: { csv } }); toast(`${r.added} Termine, ${r.shifts} Schichten neu`); renderView(); };
  $('#addP').onclick = async () => { const date = prompt('Datum JJJJ-MM-TT'); if (!date) return; const time = prompt('Uhrzeit HH:MM'); const title = prompt('Titel'); const audience = prompt('Zielgruppe (Kinder/Familie/Erwachsene/Gastspiel)', 'Erwachsene'); await api('/performances', { method: 'POST', body: { date, time, title, audience } }); renderView(); };
  m.querySelectorAll('[data-delp]').forEach(a => a.onclick = async (e) => { e.preventDefault(); await api('/performances/' + a.dataset.delp, { method: 'DELETE' }); renderView(); });
}

// ---------- Einstellungen ----------
function viewSettings(m) {
  const r = S.rules, s = S.season;
  const sel = (ph) => `<select><option ${ph === 'start' ? 'selected' : ''}>start</option><option ${ph === 'ende' ? 'selected' : ''}>ende</option></select>`;
  function clRow(c) { return `<tr><td><select>${S.gewerke.map(g => `<option value="${g.id}" ${g.id === c.gewerk_id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></td><td>${sel(c.phase)}</td><td><input value="${esc(c.text)}"></td><td><button class="small danger" onclick="this.closest('tr').remove()">✕</button></td></tr>`; }
  m.innerHTML = `<div class="card"><h2>Gewerke / Positionen</h2><p class="mute">Neue Zeile = neues Gewerk. Vorlauf = Minuten vor Schichtbeginn (erste Vorstellung). Übergabe = Vorlauf, wenn in der Tagschicht desselben Tages dasselbe Gewerk schon besetzt war. Soll = Standardbesetzung je Schicht; ★ = Spitzentage.</p>
    <table id="gwt"><tr><th>Name</th><th>Kurz</th><th>€/h</th><th>Vorlauf</th><th>Übergabe</th><th>Soll Tag</th><th>Soll Abend</th><th>Soll ★</th><th>Farbe</th><th>Aktiv</th></tr>${S.gewerke.map(g => gwRow(g)).join('')}</table><button class="small" id="gwAdd" style="margin-top:6px">+ Gewerk</button> <button class="primary" id="gwSave">Gewerke speichern</button></div>
    <div class="card"><h2>Regeln</h2><div class="row">
      <div class="grow"><label>Saison von</label><input id="rS" type="date" value="${s.start}"></div><div class="grow"><label>bis</label><input id="rE" type="date" value="${s.end}"></div>
      <div class="grow"><label>Tag/Abend-Grenze</label><input id="rCut" value="${r.day_cutoff}"></div><div class="grow"><label>Nachlauf nach letzter Vorstellung (min)</label><input id="rAfter" type="number" value="${r.after_min}"></div></div>
      <div class="row"><div class="grow"><label>Minijob-Grenze 2026 €</label><input id="rM26" type="number" value="${r.minijob_2026}"></div><div class="grow"><label>Minijob-Grenze 2027 €</label><input id="rM27" type="number" value="${r.minijob_2027}"></div><div class="grow"><label>max. h/Tag</label><input id="rMax" type="number" value="${r.max_day_h}"></div></div>
      <div class="row"><div class="grow"><label>Spitzentage von</label><input id="rPf" type="date" value="${r.peak_from}"></div><div class="grow"><label>bis</label><input id="rPt" type="date" value="${r.peak_to}"></div><div class="grow"><label>Spitzen-Wochentage</label><div class="row">${WD.map((w, i) => `<label style="margin:0"><input type="checkbox" data-pd="${i}" ${r.peak_days.includes(i) ? 'checked' : ''} style="width:auto"> ${w}</label>`).join('')}</div></div></div>
      <label>Schichttausch</label><select id="rSwap"><option value="direct" ${r.swap_mode === 'direct' ? 'selected' : ''}>direkt – Übernahme gilt sofort, Admin wird im Protokoll informiert</option><option value="approve" ${r.swap_mode === 'approve' ? 'selected' : ''}>mit Freigabe – Übernahme bleibt „angefragt“, bis ein Admin bestätigt</option></select>
      <button class="primary" id="rSave" style="margin-top:10px">Regeln speichern</button> <span class="mute">Änderung an Tag/Abend-Grenze oder Nachlauf wirkt auf nicht manuell geänderte Schichten nach „Aus Spielplan aktualisieren“.</span></div>
    <div class="card"><h2>Checklisten je Gewerk</h2><p class="mute">Werden in jeder Schicht angezeigt und abgehakt. Phase: start = vor der Vorstellung, ende = danach.</p><table id="clt"><tr><th>Gewerk</th><th>Phase</th><th>Text</th><th></th></tr>${S.checklist.map(c => clRow(c)).join('')}</table><button class="small" id="clAdd">+ Punkt</button> <button class="primary" id="clSave">Checklisten speichern</button></div>
    <div class="card"><h2>Daten</h2><a href="/api/backup">Backup herunterladen (SQLite)</a> <span class="mute">– regelmäßig sichern, die Datei liegt im Ordner data/.</span></div>`;
  $('#clAdd').onclick = () => $('#clt').insertAdjacentHTML('beforeend', clRow({ gewerk_id: S.gewerke[0]?.id, phase: 'start', text: '' }));
  $('#clSave').onclick = async () => { const checklist = [...document.querySelectorAll('#clt tr')].slice(1).map(tr => { const [g, ph, t] = tr.querySelectorAll('select,input'); return { gewerk_id: Number(g.value), phase: ph.value, text: t.value.trim() }; }).filter(c => c.text); await api('/settings', { method: 'PUT', body: { checklist } }); toast('gespeichert'); };
  $('#gwAdd').onclick = () => $('#gwt').insertAdjacentHTML('beforeend', gwRow({ name: '', short: '', rate: 15, lead_min: 30, lead_handover_min: 30, demand_day: 0, demand_eve: 1, demand_eve_peak: 1, color: '#6b46c1', active: 1 }));
  $('#gwSave').onclick = async () => { const gewerke = [...document.querySelectorAll('#gwt tr')].slice(1).map((tr, i) => { const v = [...tr.querySelectorAll('input,select')].map(x => x.type === 'checkbox' ? (x.checked ? 1 : 0) : x.value); return { id: Number(tr.dataset.id) || undefined, name: v[0], short: v[1], rate: Number(v[2]), lead_min: Number(v[3]), lead_handover_min: Number(v[4]), demand_day: Number(v[5]), demand_eve: Number(v[6]), demand_eve_peak: Number(v[7]), color: v[8], active: v[9], sort: i }; }).filter(g => g.name); await api('/settings', { method: 'PUT', body: { gewerke } }); toast('gespeichert'); };
  $('#rSave').onclick = async () => { await api('/settings', { method: 'PUT', body: { season: { start: $('#rS').value, end: $('#rE').value }, rules: { day_cutoff: $('#rCut').value, after_min: Number($('#rAfter').value), minijob_2026: Number($('#rM26').value), minijob_2027: Number($('#rM27').value), max_day_h: Number($('#rMax').value), peak_from: $('#rPf').value, peak_to: $('#rPt').value, peak_days: [...document.querySelectorAll('[data-pd]:checked')].map(c => Number(c.dataset.pd)), swap_mode: $('#rSwap').value } } }); toast('gespeichert'); };
}
const gwRow = (g) => `<tr data-id="${g.id || ''}"><td><input value="${esc(g.name)}"></td><td><input value="${esc(g.short)}" style="width:50px"></td><td><input type="number" step="0.5" value="${g.rate}" style="width:65px"></td><td><input type="number" value="${g.lead_min}" style="width:65px"></td><td><input type="number" value="${g.lead_handover_min}" style="width:65px"></td><td><input type="number" value="${g.demand_day}" style="width:55px"></td><td><input type="number" value="${g.demand_eve}" style="width:55px"></td><td><input type="number" value="${g.demand_eve_peak}" style="width:55px"></td><td><input type="color" value="${g.color}" style="width:45px;padding:2px"></td><td><input type="checkbox" ${g.active ? 'checked' : ''} style="width:auto"></td></tr>`;

// ---------- Protokoll ----------
async function viewLog(m) {
  const rows = await api('/log'); const reps = await api('/reports');
  m.innerHTML = `<div class="card"><h2>Schichtberichte</h2><table><tr><th>Datum</th><th>Von</th><th>Besucher</th><th>Kasse</th><th>Bericht</th><th>Vorkommnisse</th></tr>${reps.map(r => `<tr><td>${fmtD(r.date)} ${r.kind}</td><td>${esc(r.name)}</td><td>${r.visitors ?? ''}</td><td>${r.cash != null ? r.cash.toFixed(2) + ' €' : ''}</td><td>${esc(r.text)}</td><td class="${r.incidents ? 'over' : ''}">${esc(r.incidents)}</td></tr>`).join('') || '<tr><td colspan="6" class="mute">noch keine</td></tr>'}</table></div>
  <div class="card"><h2>Protokoll</h2><p class="mute">Jede Änderung mit Person und Zeit – Tausch, Freigaben, Einteilungen, Einstellungen.</p><table><tr><th>Zeit</th><th>Wer</th><th>Aktion</th><th>Details</th></tr>${rows.map(l => `<tr><td class="mute">${fmtTs(l.ts)}</td><td>${esc(l.name || 'System')}</td><td>${esc(l.action)}</td><td>${esc(l.detail)}</td></tr>`).join('')}</table></div>`;
}

boot();

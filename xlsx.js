'use strict';
// Minimaler Excel-Leser (.xlsx) ohne Abhängigkeiten: Zip lesen, Blätter und gemeinsame Texte auslesen.
// Ergebnis: { Blattname: { Zeile: { Spalte: Wert } } }, z. B. sheets.Notizen[5].C === 'Martin (25)'.
// Zahlen bleiben Zahlen (Datum = Seriennummer, siehe serialToDate/serialToTime), Texte Texte.
const zlib = require('node:zlib');

function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Keine gültige Excel-Datei (.xlsx)');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  const files = {};
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28), start = off + 30 + lnl + lel;
    const data = buf.subarray(start, start + csize);
    files[name] = () => (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
    p += 46 + nl + el + cl;
  }
  return files;
}
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
const colNum = (c) => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

function readXlsx(buf) {
  const f = unzip(buf);
  const need = (n) => { if (!f[n]) throw new Error('Excel-Datei unvollständig: ' + n); return f[n](); };
  const shared = f['xl/sharedStrings.xml'] ? [...need('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''))) : [];
  const rels = Object.fromEntries([...need('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map(m => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  const out = {};
  for (const m of need('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = unxml(/name="([^"]*)"/.exec(m[0])[1]), rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
    let target = rels[rid]; if (!target) continue;
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    if (!f[target]) continue;
    const rows = {};
    for (const rm of f[target]().matchAll(/<row\b[^>]*?r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = {};
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+)\d+"/.exec(cm[1]); if (!ref || cm[2] == null) continue;
        const t = /t="([^"]+)"/.exec(cm[1])?.[1], v = /<v>([\s\S]*?)<\/v>/.exec(cm[2])?.[1];
        let val;
        if (t === 's') val = shared[+v];
        else if (t === 'inlineStr') val = unxml([...cm[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
        else if (t === 'str') val = v == null ? undefined : unxml(v);
        else if (t === 'b') val = v === '1';
        else if (t === 'e') val = undefined;
        else val = v == null || v === '' ? undefined : Number(v);
        if (val !== undefined && val !== '') row[ref[1]] = val;
      }
      if (Object.keys(row).length) rows[+rm[1]] = row;
    }
    out[name] = rows;
  }
  return out;
}
// Excel-Seriennummer → 'JJJJ-MM-TT' bzw. 'HH:MM'
const serialToDate = (n) => new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
const serialToTime = (n) => { const m = Math.round((n % 1) * 1440); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

module.exports = { readXlsx, serialToDate, serialToTime, colNum };

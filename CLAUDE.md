# CLAUDE.md – Hüttenplan

Schichtplanung für die Märchenhütten (Monbijoupark, Berlin). Bedienung und Betrieb stehen in `README.md`; diese Datei hält fest, was man zum Ändern des Codes wissen muss. Sprache im Projekt: **Deutsch** (UI, Commits, Kommentare, Bezeichner in der Fachlogik wie `gewerke`, `abend`, `tag`).

## Technik

- **Server:** eine Datei, `server.js` (~450 Zeilen), Node ≥ 22.5, nur Standardbibliothek (`node:http`, `node:sqlite`, `node:crypto`). **Keine npm-Pakete, kein Build, kein `package.json`-Dependency-Eintrag** – das ist Absicht (läuft auf einem Mac Mini ohne Installation). Neue Abhängigkeiten nicht ohne Rückfrage einführen.
- **Frontend:** Vanilla JS ohne Framework in `public/` (`app.js` rendert per Template-Strings in `#app`, `style.css`, PWA-Manifest). Eingaben immer mit `esc()` escapen.
- **Datenbank:** SQLite-Datei `data/huettenplan.sqlite` (WAL). Schema per `CREATE TABLE IF NOT EXISTS` in `server.js`; es gibt **keine Migrationen** – Schemaänderungen an bestehenden Tabellen brauchen einen eigenen `ALTER TABLE`-Schritt, sonst läuft eine vorhandene Produktiv-DB nicht mit.
- **Seed:** Beim ersten Start (`settings.seeded` fehlt) werden Gewerke, Checklisten, Spielplan aus `data/spielplan-seed.json` (342 Vorstellungen) und der Admin angelegt, danach 72 Schichten generiert.
- **Live-Updates:** Server-Sent Events über `/api/events`; `broadcast({type})` nach jeder Änderung, der Client lädt dann neu.
- **Auth:** PIN → Cookie `hp` mit Zufalls-Token (auch als `?token=` für den ICS-Kalender). PINs liegen im Klartext in der DB. Rolle `admin` oder `staff`. Keine Verschlüsselung/HTTPS im Server – Zugriff nur über Tailscale/Tunnel.
- **Konfiguration:** `PORT` (Standard 3080), `DATA_DIR` (Standard `./data`; für Tests ein Temp-Verzeichnis mit kopierter `spielplan-seed.json` nehmen).
- **Dateien:** `Huettenplan starten.command` (macOS-Doppelklick-Start), `de.huettenplan.plist` (launchd, Pfade `DEINNAME` anpassen).

### Start / Entwicklung

```bash
node server.js                                        # http://localhost:3080, Admin-PIN 1234
DATA_DIR=/tmp/hp-test PORT=3998 node server.js        # frische Wegwerf-DB (seed vorher nach /tmp/hp-test kopieren)
```

`data/*.sqlite*` ist in `.gitignore`; nie eine Produktiv-DB committen.

### Code-Konventionen

- API-Routen sind eine lange `if (p === ...)`-Kette in `http.createServer`; Admin-Rechte per `need(admin)` bzw. explizitem `if (!admin) return json(res, 403, …)`.
- Jede fachliche Änderung ruft `log(me.id, aktion, detail)` (Protokoll-Ansicht) und `broadcast(...)`.
- Zeiten sind Strings `HH:MM`, Daten `YYYY-MM-DD`; Rechnen über `toMin`/`toT`/`addDays`. Zeitzone ist implizit Europe/Berlin, Datumsarithmetik läuft in UTC mit 12:00-Anker.
- Antwortstil im Code: knapp, Einzeiler, wenig Kommentare – beim Ändern denselben Stil beibehalten.

## Fachregeln

Quelle der Wahrheit ist der Code; Standardwerte stehen im Seed-Block (`server.js`, Abschnitt „Seed“) und sind in den Einstellungen änderbar.

**Schichten**
- Je Spieltag höchstens eine **Tagschicht** (Vorstellungen vor `day_cutoff` = 13:00) und eine **Abendschicht** (ab 13:00); `UNIQUE(date, kind)`.
- Beginn = erste Vorstellung des Blocks, Ende = letzte Vorstellung + `after_min` (90 min).
- `regenerateShifts` legt nur fehlende Schichten an und aktualisiert Zeiten nicht-manueller Schichten. Von Hand bearbeitete Schichten (`manual=1`) werden nie überschrieben.
- Soll-Besetzung je Gewerk steht in `demand` (pro Schicht). Vorgabe aus dem Gewerk: Tag / Abend / Abend-Spitze.
- **Spitzentag** = Fr/Sa/So im Zeitraum 01.–31.12.2026 (`peak_days`, `peak_from`, `peak_to`).

**Gewerke (Seed)** – Stundensatz, Vorlauf / Übergabe-Vorlauf, Soll Tag / Abend / Spitze:

| Gewerk | Satz | Vorlauf | Übergabe | Tag | Abend | Spitze |
|---|---|---|---|---|---|---|
| Kasse | 15 € | 60 | 30 | 1 | 1 | 2 |
| Einlass | 15 € | 30 | 30 | 1 | 2 | 3 |
| Bühnenassistenz | 16 € | 60 | 30 | 0 | 1 | 2 |
| Abenddienstleitung (ADL) | 18 € | 120 | 0 | 0 | 1 | 1 |

**Kommzeit und Stunden**
- Kommzeit = Schichtbeginn − Vorlauf des Gewerks.
- **Übergabe** (kürzerer Vorlauf) gilt nur für Abendschichten, wenn die Tagschicht desselben Tages existiert, im selben Gewerk besetzt ist (`status != 'frei'`, Person gesetzt) **und** ihr Ende ≥ Abendbeginn − normaler Vorlauf ist. Endet die Tagschicht früher, gilt der normale Vorlauf (im Smoke-Test bestätigt: Tag 09:30–12:30, Abend 17:00 → Kommzeit 16:00).
- Stunden = Kommzeit bis Schichtende; eingetragene Ist-Zeiten (`actual_start`/`actual_end`) und eine manuelle `arrive` gehen vor. Über Mitternacht wird +24 h gerechnet, gerundet auf 0,1 h. Betrag = Stunden × Satz des Gewerks.

**Einteilung und Tausch**
- Admin teilt beliebig ein; Mitarbeitende nur in **ihre Gewerke** und nur in noch nicht volle Gewerke. Eine Person pro Schicht nur einmal.
- Mitarbeitende können ihre Schicht **freigeben** (`status='frei'`, Hinweis im Chat-Kanal „allgemein“) und freie Schichten **übernehmen**. `swap_mode`: `direct` (sofort fest) oder `approve` (Status `angefragt`, Admin bestätigt).
- Gelöschte Personen werden nur deaktiviert (`active=0`).

**Warnungen** (`personStats`, je Monat)
- Minijob: Verdienst > Grenze (603 € in 2026, 633 € ab 2027) – nur bei `employment = 'minijob'`.
- Stunden > `budget_month`.
- Mehr als `max_day_h` (10 h) an einem Tag.
- Ampel im Plan: `warn` ab 85 % des Monatsbudgets, `bad` bei Warnung oder > 100 %.
- Sonntage sowie 25.12., 26.12., 01.01. gelten als Feiertag (fest im Code in `isHoliday`, nicht konfigurierbar) und werden nur in der Stundenliste/CSV markiert, nicht anders vergütet.

**Gespeichert, aber (noch) nicht ausgewertet:** `rules.rest_h` (11 h Ruhezeit), `people.budget_week` (Werkstudent:innen), Verfügbarkeit (`availability`) beim Einteilen – sie wird im Plan nur angezeigt, nicht geprüft.

**Spielplan-Import:** `importSpielplan` liest `maerchenhuetten.com/spielplan/` per Textparsing (Wochentag+Datum, „HH:MM Uhr“, `<h2>` als Titel). Das ist fragil gegenüber Umbauten der Seite – bei „keine Termine erkannt“ CSV-Import nutzen (`YYYY-MM-DD;HH:MM;Titel;Publikum`). Bestehende Vorstellungen werden nicht überschrieben (`INSERT OR IGNORE`).

## Teststand

**Es gibt keine automatisierten Tests, keine CI und kein Lint** (`npm test` existiert nicht). Stand der manuellen Prüfung am 28.10.2026 mit frischer Wegwerf-DB (Node 22.22):

| Geprüft | Ergebnis |
|---|---|
| Start, Seed, Schichtgenerierung | OK – 342 Vorstellungen → 72 Schichten (17 Tag, 55 Abend) |
| Login, `/api/me`, `bootstrap`, `shifts`, `hours`, `hours.csv`, `performances`, `log`, `todos`, `reports`, `channels`, `/ics`, statische Auslieferung | alle 200; ohne Login 401 |
| Einteilen, Gewerk-Beschränkung für Mitarbeitende, Freigeben → Übernehmen | OK |
| Kommzeit mit/ohne Übergabe, Stundenberechnung | OK (ohne Übergabe 16:00 / 6,5 h) |
| Admin-Endpunkte als Mitarbeiter (403) | 403 wird gesendet, **aber Server stürzt ab** (siehe unten) |
| Spielplan-Import von maerchenhuetten.com | nicht geprüft (kein Netz-Test), Frontend im Browser ebenfalls nicht geprüft |

### Bekannter Fehler: Absturz bei Admin-Routen als Nicht-Admin

`need(admin)` schickt bei fehlendem Recht selbst die 403-Antwort und liefert `false`. Wird es – wie bei den 14 Stellen der Form `… && need(admin)` – in der `if`-Bedingung benutzt, läuft der Code danach weiter bis `return json(res, 404, …)` (`server.js:431`); das wirft `ERR_HTTP_HEADERS_SENT`, der `catch` (`server.js:442`) wirft erneut, und der **Node-Prozess beendet sich**. Reproduzierbar: als Mitarbeiter `GET /api/hours.csv` oder `GET /api/backup` aufrufen. Jede angemeldete Person kann den Server damit zum Absturz bringen; unter launchd (`KeepAlive`) startet er neu, laufende SSE-Verbindungen brechen ab. Noch nicht behoben. Naheliegende Korrektur: `need` die Antwort nicht selbst senden lassen, sondern in den Routen `if (!admin) return json(res, 403, …)` nutzen bzw. `need(...)` mit `return` aufrufen.

### Empfehlung für Tests

Ohne neue Abhängigkeiten reicht `node --test` (eingebaut): `server.js` mit `DATA_DIR` auf ein Temp-Verzeichnis und freiem `PORT` starten und per `fetch` gegen die API prüfen. Zuerst abdecken: Kommzeit/Übergabe (`arrival`), Stundenberechnung über Mitternacht, Minijob-/Budget-Warnungen, Tausch (`direct`/`approve`), Rechte für `staff` vs. `admin` (Regression für den Absturz oben), `regenerateShifts` mit `manual=1`.

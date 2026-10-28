# Hüttenplan – Schichtplanung Märchenhütten

Kleine Web-App für Kontakte, Schichtplan, Schichttausch, Chat, Checklisten, Stundenkonten und Schichtberichte. Läuft ohne Datenbank-Server und ohne npm-Pakete auf einem Mac Mini (oder jedem Rechner mit Node 22+).

## Start

```bash
node server.js            # läuft auf http://localhost:3080
PORT=8080 node server.js  # anderer Port
```

Erster Login: **PIN 1234** (Admin „Sebastian (Produktion)“). PIN danach unter „Mein Plan“ ändern.

Beim ersten Start werden angelegt: die vier Gewerke (Kasse 15 €, Einlass 15 €, Bühnenassistenz 16 €, Abenddienstleitung 18 €) mit Vorlaufzeiten, Checklisten, der Spielplan 13.11.2026–17.01.2027 (Stand 28.10.2026, aus `data/spielplan-seed.json`) und daraus 72 Schichten. Alle Daten liegen in `data/huettenplan.sqlite` – diese Datei regelmäßig sichern (Backup-Link in den Einstellungen).

## Dauerbetrieb auf dem Mac Mini

```bash
cp de.huettenplan.plist ~/Library/LaunchAgents/
# Pfad in der plist anpassen, dann:
launchctl load ~/Library/LaunchAgents/de.huettenplan.plist
```

Zugang von außen wie bei Pratomat über Tailscale (oder Cloudflare Tunnel). Die App hat keine Verschlüsselung eingebaut, deshalb nicht ohne Tunnel/HTTPS direkt ins Internet stellen.

## Ablauf

1. **Einstellungen** prüfen: Gewerke, Stundensätze, Vorlauf (Einlass −30, Kasse −60 / Übergabe −30, ADL −120 / Übergabe 0), Soll-Besetzung je Schicht, Spitzentage, Tauschmodus.
2. **Leute** anlegen: Name, Telefon, Gewerke, Beschäftigungsform, Stundenbudget. Jede Person bekommt eine PIN → Link + PIN per WhatsApp verschicken. Die App kann aufs Handy-Homescreen gelegt werden.
3. Mitarbeitende tragen unter **Mein Plan** ihre Nicht-Verfügbarkeit ein und unter **Offen** sich selbst in freie Plätze ihrer Gewerke.
4. Du teilst unter **Plan** per Klick auf eine Schicht ein (Person wählen). Namen mit gelber/roter Wellenlinie sind über 85 % bzw. über ihrem Monatsbudget oder der Minijob-Grenze.
5. **Tausch:** Wer nicht kann, klickt in seiner Schicht „Freigeben“ → die Schicht erscheint gestrichelt bei „Offen“ und als Nachricht im Chat; wer das Gewerk hat, übernimmt mit einem Klick. Alles steht im Protokoll.
6. Am Spieltag: **Checkliste** je Gewerk abhaken, **Aufgaben** erledigen, ADL schreibt den **Schichtbericht** (Besucher, Kasse, Vorkommnisse). Ist-Zeiten können pro Einsatz nachgetragen werden („Zeiten“).
7. Monatsende: **Stunden** → CSV für die Lohnabrechnung.

## Spielplan aktuell halten

- **Spielplan → „Von maerchenhuetten.com einlesen“** liest alle Seiten des Online-Spielplans und legt neue Vorstellungen und Schichten an (bestehende bleiben). Der Leser geht nach dem Textaufbau der Seite (Wochentag + Datum, „HH:MM Uhr“, Titel als Überschrift). Wenn die Seite umgebaut wird, meldet die App „keine Termine erkannt“ – dann CSV nutzen.
- **CSV einfügen:** Zeilen `2027-01-20;19:00;Rumpelstilzchen & Ayşenbrödel;Erwachsene`.
- Danach „Plan → Aus Spielplan aktualisieren“, falls Schichten noch fehlen. Von Hand geänderte Schichten (Zeiten/Besetzung) werden dabei nicht überschrieben.
- Saisonende in den Einstellungen verlängern, wenn über den 31.01. hinaus gespielt wird.

## Regeln in der App

- Tagschicht = Vorstellungen vor 13:00 Uhr, Abendschicht = ab 13:00 Uhr. Schichtbeginn = erste Vorstellung des Blocks, Ende = letzte Vorstellung + 90 min (einstellbar).
- Kommzeit = Schichtbeginn − Vorlauf des Gewerks. „Übergabe“ gilt, wenn die Tagschicht desselben Tages im selben Gewerk besetzt ist und noch läuft, wenn der normale Vorlauf beginnen würde.
- Stunden = Kommzeit bis Schichtende (oder eingetragene Ist-Zeiten). Betrag = Stunden × Stundensatz des Gewerks.
- Warnungen: Minijob-Grenze (603 € in 2026, 633 € ab 2027), Monatsbudget, mehr als 10 h an einem Tag. Sonn- und Feiertage werden in der Stundenliste markiert.
- Werkstudent:innen: Budget pro Woche in den Stammdaten pflegen (20 h in der Vorlesungszeit).

## Dateien

```
server.js                 Server + API (Node, SQLite eingebaut)
public/                   Oberfläche (index.html, app.js, style.css)
data/spielplan-seed.json  Spielplan für den ersten Start
data/huettenplan.sqlite   alle Daten (wird beim Start angelegt)
de.huettenplan.plist      launchd-Vorlage für den Mac Mini
```

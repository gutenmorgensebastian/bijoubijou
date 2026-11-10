# bijoubijou – Schichtplanung Märchenhütten

Kleine Web-App für Kontakte, Schichtplan, Schichttausch, Chat, Checklisten, Stundenkonten und Schichtberichte. Läuft ohne Datenbank-Server und ohne npm-Pakete auf einem Mac Mini (oder jedem Rechner mit Node 22+).

## Start

```bash
node server.js            # läuft auf http://localhost:3080
PORT=8080 node server.js  # anderer Port
```

Erster Login: **PIN 1234** (Admin „Sebastian (Produktion)“). PIN danach unter „Mein Plan“ ändern.

Beim ersten Start werden angelegt: die vier Gewerke (Kasse 15 €, Einlass 15 €, Bühnenassistenz 16 €, Abenddienstleitung 18 €) mit Vorlaufzeiten, Checklisten, der Spielplan 13.11.2026–17.01.2027 (Stand 28.10.2026, aus `data/spielplan-seed.json`) und daraus 72 Schichten. Alle Daten liegen in `data/huettenplan.sqlite` – diese Datei regelmäßig sichern (Backup-Link in den Einstellungen).

## Mehrere Macs, dieselben Daten

Die Daten liegen nur auf **einem** Rechner (Haupt-Mac). Dort `bijoubijou starten.command` doppelklicken; das Fenster zeigt die Adresse fürs WLAN (z. B. `http://Name.local:3080`). Auf dem zweiten Mac `bijoubijou im Netzwerk oeffnen.command` doppelklicken und beim ersten Mal diese Adresse eingeben. Beide Macs müssen im selben WLAN sein, und auf dem Haupt-Mac muss das Fenster offen bleiben. Handys im WLAN können dieselbe Adresse im Browser öffnen.

## Vorübergehend online zeigen

Doppelklick auf `bijoubijou online teilen.command`: lädt beim ersten Mal das Tunnel-Programm `cloudflared` (in den Ordner `.tools`), startet bijoubijou falls nötig und zeigt eine https-Adresse (`…trycloudflare.com`, schon in der Zwischenablage). Die Adresse gilt, solange das Fenster offen ist und der Mac wach bleibt; beim nächsten Start gibt es eine neue. Anmeldung mit der persönlichen PIN.

Schutz der Anmeldung: nach 5 falschen PINs von einer Adresse 15 min Pause, insgesamt höchstens 50 Fehlversuche in 15 min; das Login-Cookie ist HttpOnly (über https zusätzlich Secure). Solange die Admin-PIN noch 1234 ist, zeigt die App Admins einen roten Hinweis.

## Dauerbetrieb auf dem Mac Mini

```bash
cp de.huettenplan.plist ~/Library/LaunchAgents/
# Pfad in der plist anpassen, dann:
launchctl load ~/Library/LaunchAgents/de.huettenplan.plist
```

Zugang von außen wie bei Pratomat über Tailscale (oder Cloudflare Tunnel). Die App hat keine Verschlüsselung eingebaut, deshalb nicht ohne Tunnel/HTTPS direkt ins Internet stellen.

## Ablauf

1. **Einstellungen** prüfen: Gewerke, Stundensätze, Vorlauf (ADL −2:00, Einlass −1:00, BA −1:00, Kasse −1:15; Kasse endet 30 min nach dem letzten Stück), Soll-Besetzung je Schicht, Spitzentage, Tauschmodus.
2. **Leute** anlegen: Name, Telefon, Gewerke, Beschäftigungsform, Stundenbudget. Jede Person bekommt eine PIN → Link + PIN per WhatsApp verschicken. Die App kann aufs Handy-Homescreen gelegt werden.
3. Mitarbeitende tragen unter **Mein Plan** ihre Nicht-Verfügbarkeit ein und unter **Offen** sich selbst in freie Plätze ihrer Gewerke.
4. Du teilst unter **Plan** per Klick auf eine Schicht ein (Person wählen). Namen mit gelber/roter Wellenlinie sind über 85 % bzw. über ihrem Monatsbudget oder der Minijob-Grenze.
5. **Tausch:** Wer nicht kann, klickt in seiner Schicht „Tausch anbieten“. Die Person **bleibt eingeteilt** (Stunden, Kalender, Besetzung), bis jemand mit passender Qualifikation die Schicht unter „Offen“ übernimmt – ADL ↔ ADL, BA ↔ BA, Kasse ↔ Einlass. Wer übernimmt, bekommt dieselben Zeiten; Überschneidungen mit eigenen Schichten am selben Tag werden abgelehnt. Angebot und Übernahme erscheinen im Chat und im Protokoll; das Angebot lässt sich zurückziehen, solange niemand übernommen hat.
6. Am Spieltag: **Checkliste** je Gewerk abhaken, **Aufgaben** erledigen, ADL schreibt den **Schichtbericht** (Besucher, Kasse, Vorkommnisse). Ist-Zeiten können pro Einsatz nachgetragen werden („Zeiten“).
7. Monatsende: **Stunden** → CSV für die Lohnabrechnung.

## Spielplan aktuell halten

- **Spielplan → „Von maerchenhuetten.com einlesen“** liest alle Seiten des Online-Spielplans und legt neue Vorstellungen und Schichten an (bestehende bleiben). Der Leser geht nach dem Textaufbau der Seite (Wochentag + Datum, „HH:MM Uhr“, Titel als Überschrift). Wenn die Seite umgebaut wird, meldet die App „keine Termine erkannt“ – dann CSV nutzen.
- **CSV einfügen:** Zeilen `2027-01-20;19:00;Rumpelstilzchen & Ayşenbrödel;Erwachsene`.
- Danach „Plan → Aus Spielplan aktualisieren“, falls Schichten noch fehlen. Von Hand geänderte Schichten (Zeiten/Besetzung) werden dabei nicht überschrieben.
- Saisonende in den Einstellungen verlängern, wenn über den 31.01. hinaus gespielt wird.

## Regeln in der App

- Arbeitstag je Tag aus dem Spielplan: erstes Stück = frühester Beginn, letztes Stück = spätester Beginn. Beginn = erstes Stück − größter Vorlauf (ADL, 2:00 h), Ende = Ende des letzten Stücks (Beginn + Spieldauer, Standard 60 min) + Nachlauf (Standard 90 min).
- Feste Vorläufe vor dem ersten Stück: ADL 2:00 h, Einlass 1:00 h, BA 1:00 h, Kasse 1:15 h. Die Kasse endet 30 Minuten nach Beginn des letzten Stücks (Spalte „Ende nach letztem Stück“ je Gewerk, leer = Ende des Arbeitstags). Alles in den Einstellungen änderbar.
- Dauert der Arbeitstag mehr als 360 min (Einstellung), wird er geteilt (Tagschicht = erster Teil, Abendschicht = zweiter). Einstellung „Arbeitstag teilen“: *in zwei gleich lange Hälften* (Standard), *an einer langen Pause zwischen den Stücken* (ab 180 min zwischen zwei Stückbeginnen; jeder Block bekommt eigenen Beginn/Ende und eigene Vorläufe, sonst Hälften) oder *nie teilen*. Änderungen gelten sofort für alle nicht von Hand geänderten Schichten; einzelne Tage lassen sich unter „Zeiten/Besetzung“ von Hand anpassen. Gewerke, die in einer Schichthälfte nicht gebraucht werden, bekommen dort Soll 0. Kommzeit/Ende jedes Gewerks werden auf die Schicht zugeschnitten.
- Stunden = Kommzeit bis Ende des Gewerks in der Schicht (oder eingetragene Ist-Zeiten). Betrag = Stunden × Stundensatz des Gewerks.
- Warnungen: Minijob-Grenze (603 € in 2026, 633 € ab 2027), Monatsbudget, mehr als 10 h an einem Tag. Sonn- und Feiertage werden in der Stundenliste markiert.
- Werkstudent:innen: Budget pro Woche in den Stammdaten pflegen (20 h in der Vorlesungszeit).

## Team einlesen und Dienstplan vorschlagen

- **Einstellungen → „Team und Dienstplan einlesen“:** Personalliste als Text (Zeilen wie `Max Muster 25h/w ADL`, `Erika Beispiel 25h/w vorwiegend Kasse/BA`, `Tom Probe, Schichten sind fix`, `Lea Muster, kann noch 30h im Dezember. BA/Kasse`) und/oder die Excel-Datei (Blätter *Notizen* = Personal und Gewerke, *SPERRER* = gesperrte Tage, *Schichtplan* = Einteilung je Position; „?“ und leere Namen = offener Platz). Immer erst „Prüfen“, dann „Übernehmen“. Namen landen nur in der lokalen Datenbank (`data/`), nicht in Git.
- **Einstellungen → „Schichtplan 1:1 übernehmen“:** Blatt „Schichtplan“ (Datum, ADL, Kasse, Einlass/BA Wilhelm und Jakob, weitere Spalten mit einem Namen im Kopf). Jede Zeile wird eine Schicht (Zeit = ADL-Zeit), jede Person bekommt genau die Zeiten ihres Platzes. Im Zeitraum der Datei werden alle bisherigen Schichten ersetzt und danach nicht mehr automatisch erzeugt; fehlende Personen werden angelegt. Die Vorschau meldet unbesetzte Plätze, Vorstellungen ohne ADL, Vorstellungstage ohne Schicht, Doppelbelegungen, mehr als 10 h am Tag und zu kurze Ruhezeiten. Jede Einteilung speichert dafür ihr Ende laut Plan (`plan_end`) statt des berechneten.
- **Einstellungen → „Mitarbeiterliste“:** Blatt „Mitarbeiterliste“ (Name, Voller Name, Aufgabenbereiche, Stunden / Vertrag, E-Mail, Handy) und „Sperrtage einzeln“. Stunden: `20h` = pro Woche (Monat = × 4,45), `20h+`/`mehr als 20h` = 15 % mehr, `max. 60h` = pro Monat, `offen` = Budget bleibt; „Midijob“ setzt die Beschäftigungsform; „nur Dezember“, „ab 13.11.“, „13.11.–31.01.“ den Verfügbarkeitszeitraum. Voller Name wird übernommen (alter Name bleibt als Schreibweise für spätere Importe). Meldet Einteilungen an Sperrtagen oder außerhalb der Verfügbarkeit.
- **Plan → „Dienstplan vorschlagen“:** verteilt nur offene Plätze im gewählten Zeitraum und zeigt vorher Stunden je Person und Woche. Berücksichtigt Gewerke (Hauptgewerke zuerst, Spezialisten vor Allroundern), Sperrtage, Wochenstunden im Verhältnis zum Soll (Budget h/Woche) und Monatsbudget, Schichten höchstens 6 h, Ruhezeit 11 h, einen freien Tag pro Woche, „24.12./31.12. nur einer“ (einstellbar unter Regeln). Leute mit „Schichten fix“ und Leitung werden nie eingeteilt, bestehende Einteilungen nie verändert. Bei „Schichten fix“ besteht das Stundenkontingent genau aus den eingetragenen Schichten (aus der Excel): kein Budget, keine Budget-Warnung, die Stundenliste zeigt die Summe dieser Schichten. Gesperrte Tage (SPERRER) beachtet der Planer immer; liegt in der Excel selbst eine Einteilung auf einem gesperrten Tag, weist die Vorschau beim Einlesen darauf hin. Erst „Übernehmen“ schreibt in den Plan.
- Regelzeilen in der Personalliste werden erkannt: „Wenn Helena und Finn am gleichen Tag arbeiten, bitte so lassen.“ (Gruppen bleiben am Tag zusammen: wird ein zweiter Einlass nötig, wechselt die Person auf einen freien BA-Platz) und „ADL im November ist fix.“ (der Planer ändert ADL bis Monatsende nicht; auch unter Regeln einstellbar).
- Verfügbarkeitszeitraum je Person („Verfügbar ab/bis“ im Tab Leute): wird aus der Personalliste („ab Dezember“, „nur im Dezember“, „kann noch 30h im Dezember“) und aus dem Excel-Blatt *Bewerber* (Spalte Verfügbarkeit, z. B. „ab Dezember“, „ab 13.11.“) übernommen; außerhalb dieses Zeitraums plant der Planer die Person nie ein.
- Besetzung je Schicht nach Standard: Kasse 1, Einlass 1 (die Person wechselt zwischen den Hütten), BA 2, ADL 1. Einlass ist immer nur mit einer Person besetzt: steht in der Excel für Wilhelm und Jakob je jemand, übernimmt der Import nur eine Person (bevorzugt „Schichten fix“, sonst die erste); die zweite wird in der Vorschau gemeldet. Bestehende Daten werden einmalig auf Einlass 1 gestellt, wo nicht schon mehr Personen eingeteilt sind.

## Sprache

- Oben rechts schaltet „DE | EN“ die Oberfläche zwischen Deutsch und Englisch um (wird im Browser gemerkt). Die Übersetzung steht in `public/i18n.js`; neue deutsche Texte erscheinen in der englischen Ansicht deutsch, bis sie dort ergänzt werden. Namen, Titel und Chat-Nachrichten werden nie übersetzt.

## Dateien

```
server.js                 Server + API (Node, SQLite eingebaut)
importer.js, xlsx.js      Einlesen von Personalliste und Excel-Dienstplan
planer.js                 Dienstplan-Vorschlag
public/                   Oberfläche (index.html, app.js, i18n.js, style.css)
data/spielplan-seed.json  Spielplan für den ersten Start
data/huettenplan.sqlite   alle Daten (wird beim Start angelegt)
de.huettenplan.plist      launchd-Vorlage für den Mac Mini
```

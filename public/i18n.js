/* bijoubijou – Sprachumschalter Deutsch/English
   Die App ist auf Deutsch geschrieben. Dieses Skript übersetzt auf Wunsch (Knopf „DE | EN“ oben) die sichtbaren Texte,
   Platzhalter, Tooltips, Rückfragen und Meldungen ins Englische. Nicht übersetzte Texte (z. B. Namen, Titel, Chat) bleiben unverändert.
   Neue deutsche Texte in der App bleiben in der englischen Ansicht einfach deutsch, bis sie hier ergänzt werden. */
(() => {
  let lang = 'de';
  try { lang = localStorage.getItem('hp_lang') === 'en' ? 'en' : 'de'; } catch (e) { /* ohne Speicher: Deutsch */ }

  // ---- ganze Texte (Leerraum außen wird ignoriert) ----
  const EN = {
    // Anmeldung / Kopf
    'Märchenhütten im Monbijoupark – Schichtplan': 'Märchenhütten in Monbijoupark – shift schedule',
    'Anmelden': 'Log in', 'Abmelden': 'Log out', 'Deine PIN bekommst du von der Produktionsleitung.': 'You get your PIN from the production management.',
    'Plan': 'Schedule', 'Mein Plan': 'My schedule', 'Offen': 'Open', 'Chat': 'Chat', 'Aufgaben': 'Tasks', 'Stunden': 'Hours', 'Leute': 'People',
    'Spielplan': 'Programme', 'Einstellungen': 'Settings', 'Protokoll': 'Log',
    // Plan
    'alles besetzt': 'fully staffed', '+ Schicht': '+ Shift', 'Aus Spielplan aktualisieren': 'Update from programme', 'Drucken': 'Print',
    'Schichten aus dem Spielplan nachziehen': 'Create missing shifts from the programme',
    'voll besetzt': 'fully staffed', 'offen': 'open', 'freigegeben (Tausch)': 'released (swap)', '★ Spitzentag (höhere Besetzung)': '★ peak day (higher staffing)',
    'Rahmen = du bist eingeteilt': 'Frame = you are scheduled', '= über 85 % Budget': '= over 85 % of budget', '= Stunden/Minijob überschritten': '= hours/mini-job limit exceeded',
    'Name': 'Name', 'spielfrei': 'no performances', 'Feiertag': 'holiday', 'nicht verfügbar': 'not available', 'ohne Vorstellung': 'no performance',
    '+ Arbeitsplatz': '+ Workstation', 'Arbeitsplatz hinzufügen': 'Add workstation', 'Schicht löschen': 'Delete shift',
    // Drawer
    'Vorstellungen': 'Performances', 'keine': 'none', 'Besetzung': 'Staffing', 'Checkliste': 'Checklist', 'Vor der Vorstellung': 'Before the performance', 'Nach der Vorstellung': 'After the performance',
    'Aufgaben für diese Schicht': 'Tasks for this shift', 'alle': 'all', 'Schichtbericht': 'Shift report', 'Wie lief es?': 'How did it go?', 'Besucher ca.': 'Visitors approx.', 'Kasse €': 'Cash €',
    'Vorkommnisse / Schäden / Fehlzeiten': 'Incidents / damage / absences', 'Bericht speichern': 'Save report', 'Chat zu dieser Schicht': 'Chat for this shift',
    'Zeiten/Besetzung': 'Times/staffing', 'Löschen': 'Delete', 'Sonn-/Feiertag': 'Sunday/holiday', 'Spitzentag': 'peak day', '★ Spitzentag': '★ peak day',
    'FREI – wer übernimmt?': 'FREE – who takes it?', 'Übernehmen': 'Take over', 'Ich mache das': "I'll do it", 'Freigeben': 'Release', 'Tausch anbieten': 'Offer swap', 'Angebot zurückziehen': 'Withdraw offer', '🔄 Tausch angeboten': '🔄 Swap offered', '🔄 sucht Tausch – bleibt eingeteilt, bis jemand übernimmt': '🔄 looking for a swap – stays assigned until someone takes it', '🔄 Tausch gesucht': '🔄 Swap wanted', 'Zeiten': 'Times', 'OK': 'OK', 'wartet auf Freigabe': 'awaiting approval',
    'angefragt': 'requested', 'freigegeben': 'released', 'Person wählen…': 'Choose person…', '— andere —': '— other —', 'ok': 'ok',
    'Schicht zum Tausch freigeben': 'Release shift for swapping', 'Ist-Zeiten eintragen': 'Enter actual times',
    'Neue Aufgabe…': 'New task…', 'Details': 'Details',
    // Mein Plan
    'Noch keine Schichten. Schau unter „Offen“.': 'No shifts yet. Have a look under “Open”.', 'Datum': 'Date', 'Schicht': 'Shift', 'Gewerk': 'Trade', 'Kommzeit': 'Arrival', 'Ende': 'End', 'Std': 'Hrs',
    'Kalender-Abo': 'Calendar subscription', 'Diesen Link in Apple/Google-Kalender als Abo einfügen, dann stehen deine Schichten mit Kommzeit automatisch im Handy:': 'Add this link as a subscription in Apple/Google Calendar and your shifts with arrival times appear on your phone automatically:',
    'Meine Verfügbarkeit': 'My availability', 'Tage antippen: 1× =': 'Tap days: 1× =', 'kann nicht': 'cannot', ', 2× =': ', 2× =', 'unsicher': 'unsure', ', 3× = wieder frei. Die Produktion sieht das bei der Planung.': ', 3× = free again. Production sees this when planning.',
    'Meine Kontaktdaten': 'My contact details', 'Telefon': 'Phone', 'E-Mail': 'Email', 'Neue PIN (4 Ziffern, leer = unverändert)': 'New PIN (4 digits, empty = unchanged)', 'Speichern': 'Save', 'Gewerke:': 'Trades:', 'keine zugeordnet': 'none assigned',
    // Offen / Chat / Aufgaben
    'Offene Schichten': 'Open shifts', 'alle Gewerke': 'all trades', 'Gestrichelt = jemand hat die Schicht zum Tausch freigegeben.': 'Dashed = someone released the shift for swapping.',
    'Nichts offen 🎉': 'Nothing open 🎉', 'Senden': 'Send', 'anpinnen': 'pin', 'lösen': 'unpin', '📣 Allgemein': '📣 General', 'Noch keine Nachrichten.': 'No messages yet.', 'Nachricht an alle…': 'Message to everyone…',
    'Allgemeine Aufgaben je Gewerk (ohne Datum) und Aufgaben zu einzelnen Schichten. Wer abhakt, wird gespeichert.': 'General tasks per trade (without a date) and tasks for individual shifts. Whoever ticks a task off is recorded.',
    'Aufgabe': 'Task', 'Erledigt': 'Done', 'Neue allgemeine Aufgabe…': 'New general task…',
    // Stunden
    'CSV für Lohnabrechnung': 'CSV for payroll', 'Form': 'Type', 'Budget': 'Budget', 'Betrag': 'Amount', 'Hinweise': 'Notes', 'keine Schichten': 'no shifts',
    // Leute
    '+ Person': '+ Person', 'Gewerke': 'Trades', 'Beschäftigungsform': 'Employment type', 'Budget h/Monat': 'Budget h/month', 'Budget h/Woche': 'Budget h/week', 'Rolle': 'Role', 'Mitarbeiter:in': 'Staff member',
    'Admin (Produktion/ADL)': 'Admin (production/ADL)', 'PIN (leer = automatisch)': 'PIN (empty = automatic)', 'Aktiv': 'Active', 'ja': 'yes', 'nein': 'no', 'Notizen (Vertrag, Verfügbarkeit, Semesterferien …)': 'Notes (contract, availability, semester break …)',
    'Abbrechen': 'Cancel', 'zeigen': 'show', 'Bearbeiten': 'Edit', 'Admin': 'Admin', 'Leitung': 'Management', 'leitung': 'management', 'minijob': 'mini-job', 'werkstudent': 'working student',
    'Zugang: Link zur App + persönliche PIN weitergeben.': 'Access: pass on the link to the app plus a personal PIN.',
    // Spielplan
    'Von maerchenhuetten.com einlesen': 'Import from maerchenhuetten.com', 'CSV einfügen': 'Paste CSV', '+ Vorstellung': '+ Performance', 'Heute': 'Today', 'Löschen ': 'Delete',
    // Einstellungen
    'Gewerke / Positionen': 'Trades / positions', 'Kurz': 'Short', '€/h': '€/h', 'Vorlauf': 'Lead time', 'Ende nach letztem Stück': 'End after last show', 'Soll Tag': 'Target day', 'Soll Abend': 'Target evening', 'Soll ★': 'Target ★', 'Farbe': 'Colour',
    '+ Gewerk': '+ Trade', 'Gewerke speichern': 'Save trades', 'Regeln': 'Rules', 'Saison von': 'Season from', 'bis': 'to', 'Tag/Abend-Grenze': 'Day/evening cut-off', 'Spieldauer letztes Stück (min)': 'Running time of last show (min)', 'Nachlauf nach Ende des letzten Stücks (min)': 'Wrap-up after end of last show (min)',
    'Nachlauf mindestens (min)': 'Wrap-up minimum (min)', 'Teilung ab Arbeitstag über (min)': 'Split when working day exceeds (min)', 'Minijob-Grenze 2026 €': 'Mini-job limit 2026 €', 'Minijob-Grenze 2027 €': 'Mini-job limit 2027 €', 'max. h/Tag': 'max. h/day',
    'Spitzentage von': 'Peak days from', 'Spitzen-Wochentage': 'Peak weekdays', 'Schichttausch': 'Shift swapping', 'direkt – Übernahme gilt sofort, Admin wird im Protokoll informiert': 'direct – takeover applies immediately, admin is informed in the log',
    'mit Freigabe – Übernahme bleibt „angefragt“, bis ein Admin bestätigt': 'with approval – takeover stays “requested” until an admin confirms', 'Regeln speichern': 'Save rules',
    'Änderung an Tag/Abend-Grenze, Nachlauf oder Teilung wirkt auf nicht manuell geänderte Schichten nach „Aus Spielplan aktualisieren“.': 'Changes to the day/evening cut-off, wrap-up or split apply to shifts that were not edited by hand after “Update from programme”.',
    'Schicht höchstens (min)': 'Shift at most (min)',
    'Arbeitstag teilen': 'Split working day', 'in zwei gleich lange Hälften': 'into two halves of equal length', 'an einer langen Pause zwischen den Stücken (sonst Hälften)': 'at a long break between shows (otherwise halves)',
    'nie teilen (eine Schicht pro Tag)': 'never split (one shift per day)', 'Als lange Pause zählt ab (min zwischen zwei Stückbeginnen)': 'Counts as a long break from (min between two show start times)',
    'Beim Speichern werden alle nicht von Hand geänderten Schichten neu berechnet; von Hand geänderte Schichten (Zeiten/Besetzung) bleiben unverändert.': 'On saving, all shifts that were not edited by hand are recalculated; shifts edited by hand (times/staffing) stay unchanged.',
    'Checklisten je Gewerk': 'Checklists per trade', 'Werden in jeder Schicht angezeigt und abgehakt. Phase: start = vor der Vorstellung, ende = danach.': 'Shown and ticked off in every shift. Phase: start = before the performance, ende = after it.',
    'Phase': 'Phase', 'Text': 'Text', '+ Punkt': '+ Item', 'Checklisten speichern': 'Save checklists', 'Daten': 'Data', 'Backup herunterladen (SQLite)': 'Download backup (SQLite)', '– regelmäßig sichern, die Datei liegt im Ordner data/.': '– back up regularly, the file is in the data/ folder.',
    'Arbeitstag': 'Working day',
    // Protokoll
    'Schichtberichte': 'Shift reports', 'Von': 'From', 'Besucher': 'Visitors', 'Bericht': 'Report', 'Vorkommnisse': 'Incidents', 'noch keine': 'none yet',
    'Jede Änderung mit Person und Zeit – Tausch, Freigaben, Einteilungen, Einstellungen.': 'Every change with person and time – swaps, approvals, assignments, settings.', 'Zeit': 'Time', 'Wer': 'Who', 'Aktion': 'Action', 'System': 'System',
    // Gewerke und Standard-Checklisten
    'Kasse': 'Box office', 'Einlass': 'Admission', 'Bühnenassistenz': 'Stage assistant', 'Abenddienstleitung': 'Evening manager',
    'Kasse aufschließen, Wechselgeld zählen': 'Unlock the box office, count the change', 'Kassensystem/Billeto-Scanner starten': 'Start the till system/Billeto scanner', 'Kassenabschluss, Bericht ausdrucken': 'Cash-up, print the report',
    'Einnahmen übergeben an ADL': 'Hand over takings to ADL', 'Hütten heizen (alle Öfen an)': 'Heat the huts (all stoves on)', 'Wege und Eingänge prüfen, Licht an': 'Check paths and entrances, lights on', 'Einlasslisten/Scanner bereit': 'Admission lists/scanners ready',
    'Öfen aus, Hütten kontrollieren': 'Stoves off, check the huts', 'Bühne und Requisiten vorbereiten': 'Prepare stage and props', 'Absprache mit Darsteller:innen': 'Brief the performers', 'Bühne aufräumen, Requisiten verstauen': 'Tidy the stage, stow the props',
    'Aufschließen, Rundgang, Strom/Heizung': 'Unlock, walk-round, power/heating', 'Anwesenheit aller Gewerke und Darsteller:innen prüfen': 'Check that all trades and performers are present', 'Notausgänge und Feuerlöscher prüfen': 'Check emergency exits and fire extinguishers',
    'Kassenabrechnung entgegennehmen': 'Receive the cash-up', 'Abschließen, Rundgang, Schichtbericht ausfüllen': 'Lock up, walk-round, fill in the shift report',
    'Erwachsene': 'Adults', 'Familie': 'Family', 'Kinder': 'Children', 'Gastspiel': 'Guest performance',
    // Monate / Wochentage (einzeln)
    'Januar': 'January', 'Februar': 'February', 'März': 'March', 'Mai': 'May', 'Juni': 'June', 'Juli': 'July', 'Oktober': 'October', 'Dezember': 'December',
    'Mo': 'Mon', 'Di': 'Tue', 'Mi': 'Wed', 'Do': 'Thu', 'Fr': 'Fri', 'Sa': 'Sat', 'So': 'Sun',
    // Planer, Einlesen, Personen
    'Dienstplan vorschlagen': 'Suggest schedule', 'Offene Plätze nach Regeln verteilen (erst Vorschau)': 'Distribute open slots by the rules (preview first)',
    'Verteilt nur offene Plätze (bestehende Einteilungen, Leute mit „Schichten fix“ und Leitung bleiben unverändert) nach Qualifikation, Sperrtagen, Wochenstunden, 6-h-Schichten, einem freien Tag pro Woche und „24.12./31.12. nur einer“. Erst Vorschau, dann „Übernehmen“.':
      'Distributes open slots only (existing assignments, people with “fixed shifts” and management stay unchanged) by qualification, blocked days, weekly hours, 6-hour shifts, one day off per week and “24.12./31.12. only one”. Preview first, then “Apply”.',
    'Von': 'From', 'Bis': 'To', 'Vorschlag berechnen': 'Calculate suggestion', 'Berechne …': 'Calculating …', 'Übernehmen': 'Apply', 'Verwerfen': 'Discard', 'Person': 'Person', 'Soll h/W': 'Target h/w', 'neu h': 'new h', 'gesamt h': 'total h',
    'offenen Plätzen verteilt': 'open slots filled', 'offenen Plätzen verteilt,': 'open slots filled,', 'offenen Plätzen verteilt – alles besetzt': 'open slots filled – all staffed', ' – alles besetzt': ' – all staffed', 'Bleiben offen': 'Remain open', 'Warum': 'Why', 'Zeit': 'Time',
    'Team und Dienstplan einlesen': 'Import team and schedule', 'Erst „Prüfen“ (zeigt nur, was passieren würde), dann „Übernehmen“. Namen bleiben in deiner lokalen Datenbank.': 'First “Check” (only shows what would happen), then “Apply”. Names stay in your local database.',
    'Personalliste (Text)': 'Staff list (text)', 'Excel-Dienstplan (.xlsx)': 'Excel schedule (.xlsx)', 'Prüfen': 'Check', 'Name 20h/w Gewerke …': 'Name 20h/w trades …', 'Lese …': 'Reading …',
    'Hauptgewerke (bevorzugt; leer = alle gleich)': 'Main trades (preferred; empty = all equal)', 'Schichten fix (Planer teilt nicht ein)': 'Shifts fixed (planner does not schedule)', 'Teilzeit': 'Part-time', 'fix': 'fixed',
    'Der Planer teilt diese Person nicht ein': 'The planner does not schedule this person', 'Entweder-oder-Tage (MM-TT, mit Komma getrennt; wer an einem arbeitet, nicht an den anderen)': 'Either-or days (MM-DD, comma-separated; whoever works one does not work the others)',
    'Verfügbar ab (leer = ganze Saison)': 'Available from (empty = whole season)', 'Verfügbar bis': 'Available until',
    'Freier Tag pro Woche': 'Day off per week', 'ja, wenn möglich': 'yes, if possible', 'Bitte erst eine Excel-Datei wählen': 'Please choose an Excel file first', 'Datei nicht lesbar': 'File not readable', 'übernommen': 'applied',
    // Rückfragen und Meldungen
    'Datum (JJJJ-MM-TT)': 'Date (YYYY-MM-DD)', 'Abendschicht? (Abbrechen = Tagschicht)': 'Evening shift? (Cancel = day shift)', 'Beginn (HH:MM)': 'Start (HH:MM)', 'Ende (HH:MM)': 'End (HH:MM)',
    'Name der Person (muss in „Leute“ angelegt sein):': 'Name of the person (must exist under “People”):', 'nicht gefunden': 'not found', 'Kurzer Grund / Hinweis für die anderen (optional):': 'Short reason / note for the others (optional):',
    'Tatsächlich gekommen um (HH:MM, leer = Plan)': 'Actually arrived at (HH:MM, empty = plan)', 'Tatsächlich gegangen um (HH:MM, leer = Plan)': 'Actually left at (HH:MM, empty = plan)', 'Eintrag entfernen?': 'Remove entry?',
    'Bericht gespeichert': 'Report saved', 'Schichtbeginn = erste Vorstellung (HH:MM)': 'Shift start = first performance (HH:MM)', 'Schichtende (HH:MM)': 'Shift end (HH:MM)', 'Notiz (z.B. Sonderveranstaltung)': 'Note (e.g. special event)',
    'Schicht samt Einteilung löschen?': 'Delete shift including assignments?', 'Grund (optional)': 'Reason (optional)', 'gespeichert': 'saved', 'Name fehlt': 'Name missing', 'Lese Spielplan…': 'Reading programme…',
    'Zeilen im Format JJJJ-MM-TT;HH:MM;Titel;Zielgruppe (eine pro Zeile, mit Umbruch einfügen):': 'Lines in the format YYYY-MM-DD;HH:MM;title;audience (one per line, paste with line breaks):',
    'Datum JJJJ-MM-TT': 'Date YYYY-MM-DD', 'Uhrzeit HH:MM': 'Time HH:MM', 'Titel': 'Title', 'Zielgruppe (Kinder/Familie/Erwachsene/Gastspiel)': 'Audience (Kinder/Familie/Erwachsene/Gastspiel)',
    'Keine Termine erkannt. Seite nicht erreichbar oder Aufbau geändert. Bitte Spielplan per CSV einspielen.': 'No dates recognised. Page unreachable or layout changed. Please import the programme via CSV.',
    // Meldungen vom Server
    'Bitte anmelden': 'Please log in', 'Nicht erlaubt': 'Not allowed', 'unbekannt': 'unknown', 'PIN unbekannt': 'PIN unknown', 'PIN muss aus 4 Ziffern bestehen': 'PIN must consist of 4 digits', 'PIN schon vergeben': 'PIN already taken',
    'Datum fehlt (JJJJ-MM-TT)': 'Date missing (YYYY-MM-DD)', 'Diese Schicht gibt es an dem Tag schon': 'This shift already exists on that day', 'Dieses Gewerk ist dir nicht zugeordnet': 'This trade is not assigned to you',
    'Dieses Gewerk ist in der Schicht schon voll besetzt': 'This trade is already fully staffed in the shift', 'Nicht deine Schicht': 'Not your shift', 'Person ist in dieser Schicht schon eingeteilt': 'Person is already scheduled in this shift',
    'Schicht ist nicht mehr frei': 'Shift is no longer free', 'Schicht/Arbeitsplatz fehlt': 'Shift/workstation missing', 'Schicht/Gewerk fehlt': 'Shift/trade missing', 'Not Found': 'Not found',
  };

  // ---- Muster mit veränderlichen Teilen ($1 …); danach laufen noch die Wortersetzungen unten ----
  const PAT = [
    [/^(\d+) von (\d+)$/, '$1 of $2'], [/^(\d+) bleiben offen$/, '$1 remain open'], [/^(\d+) Einteilungen übernommen(.*)$/, '$1 assignments applied$2'], [/^, (\d+) übersprungen$/, ', $1 skipped'],
    [/^Übernommen: (\d+) neue Personen, (\d+) aktualisiert$/, 'Applied: $1 new people, $2 updated'], [/^Übernommen: (\d+) Einteilungen, (\d+) Sperrtage, (\d+) neue Personen$/, 'Applied: $1 assignments, $2 blocked days, $3 new people'],
    [/^fix: nur eingetragene Schichten$/, 'fixed: only the scheduled shifts'], [/^Keine Einteilung auf gesperrten Tagen\.$/, 'No assignment on blocked days.'],
    [/^Einlass nur eine Person je Schicht: (\d+) zweite Einlass-Einteilungen aus der Excel nicht übernommen \((.+)\)\.$/, 'Admission has one person per shift: $1 second admission assignments from the Excel not applied ($2).'],
    [/^ADL bis einschließlich \(Datum\) wie eingetragen lassen$/, 'Leave ADL as entered up to and including (date)'],
    [/^Zusammen lassen: (.+)\. (.*)$/, 'Keep together: $1. $2'], [/^ADL fix bis (.+)\. (.*)$/, 'ADL fixed until $1. $2'],
    [/^Paare zusammengehalten \(zweite Einlass-Person wechselt auf BA\): (\d+)\.$/, 'Pairs kept together (second admission person moves to stage assistant): $1.'],
    [/^Nicht zusammenzuhalten \(kein BA-Platz frei\): (\d+) \((.+)\)\.$/, 'Could not be kept together (no stage-assistant slot free): $1 ($2).'],
    [/^Verfügbarkeit aus „Bewerber“: (.+)\. $/, 'Availability from “Bewerber”: $1. '], [/^ab (.+)$/, 'from $1'], [/^bis (.+)$/, 'until $1'],
    [/^Woche ab (.+)$/, 'Week from $1'], [/^(\d+) Tage$/, '$1 days'], [/^Übernommen\.$/, 'Applied.'], [/^Vorschau:$/, 'Preview:'], [/^Alle (.+)-Plätze sind belegt/, 'All $1 slots are taken'],
    [/^(\d+) Einteilungen vom Planer übernommen(.*)$/, '$1 assignments applied from the planner$2'],
    [/^(\d+) Plätze? offen$/, '$1 open slots'], [/^⚠ (\d+) über Budget$/, '⚠ $1 over budget'], [/^(\d+) fehlt$/, '$1 missing'], [/^(\d+) Vorst\. · (.+)$/, '$1 perf. · $2'],
    [/^Einen (.+)-Platz entfernen$/, 'Remove one $1 slot'], [/^(.+) \((\d+) → (\d+)\)$/, '$1 ($2 → $3)'], [/^(.+) (\d+)\/(\d+) frei$/, '$1 $2/$3 free'], [/^(.+) frei$/, '$1 free'],
    [/^Kommzeit (\S+) · bis (\S+) · (.+?) h(.*)$/, 'Arrival $1 · until $2 · $3 h$4'], [/^Kommzeit (\S+)(.*)$/, 'Arrival $1$2'], [/^\(Beginn (\S+)\)$/, '(start $1)'], [/^ ?\(Beginn (\S+)\)$/, ' (start $1)'],
    [/^Zum Tages-Chat (.+)$/, 'To the day chat $1'], [/^von (.+) · (.+)$/, 'by $1 · $2'], [/^Nachricht an alle am (.+)…$/, 'Message to everyone on $1…'], [/^Nachricht an (.+)…$/, 'Message to $1…'],
    [/^(.+) h im Monat – (.+)$/, '$1 h in the month – $2'], [/^Budget\/Minijob-Grenze überschritten$/, 'budget/mini-job limit exceeded'], [/^über 85 % des Budgets$/, 'over 85 % of the budget'],
    [/^(.+) h von (.+) h$/, '$1 h of $2 h'], [/^(\d+) h\/M · (\d+) h\/W$/, '$1 h/M · $2 h/W'],
    [/^(\d+) Vorstellungen · (\d+) gesamt$/, '$1 performances · $2 total'], [/^(\d+) neue Schichten$/, '$1 new shifts'], [/^(\d+) gelesen, (\d+) neu, (\d+) Schichten angelegt$/, '$1 read, $2 new, $3 shifts created'],
    [/^(\d+) Termine, (\d+) Schichten neu$/, '$1 dates, $2 new shifts'], [/^(\d+) Schichten angelegt$/, '$1 shifts created'], [/^Soll (.+)$/, 'Target $1'], [/^Kein (.+)-Platz in dieser Schicht$/, 'No $1 slot in this shift'],
    [/^(.+) samt Einteilung löschen\?$/, 'Delete $1 including assignments?'], [/^Alle (.+)-Plätze sind belegt – Platz inkl\. Einteilung \((.+)\) entfernen\?$/, 'All $1 slots are taken – remove slot including assignment ($2)?'],
    [/^Aus dem Spielplan entstehen die Schichten automatisch: Arbeitsbeginn = erstes Stück − größter Vorlauf, Arbeitsende = Ende des letzten Stücks \(Beginn \+ (\d+) min\) \+ (\d+) min Nachlauf \(Kasse: eigene Regel je Gewerk\)\. Dauert der Arbeitstag mehr als (\S+) h, wird er geteilt \((.+); einstellbar unter „Einstellungen → Regeln“\)\.$/,
      'Shifts are created from the programme automatically: start of work = first show − longest lead time, end of work = end of the last show (start + $1 min) + $2 min wrap-up (box office: its own rule per trade). If the working day lasts more than $3 h it is split ($4; adjustable under “Settings → Rules”).'],
    [/^Neue Zeile = neues Gewerk\. Vorlauf = Minuten vor dem ersten Stück des Tages\. Ende = Minuten nach dem letzten Stück \(leer = Ende des Arbeitstags, z\. B\. Kasse 30\)\. Soll = Standardbesetzung je Schicht; ★ = Spitzentage\.$/,
      'New row = new trade. Lead time = minutes before the first show of the day. End = minutes after the last show (empty = end of the working day, e.g. box office 30). Target = standard staffing per shift; ★ = peak days.'],
    [/^Grün = im Budget, Gelb = über 85 %, Rot = Budget oder Minijob-Grenze \((.+) €\/Monat\) überschritten\. Stunden = Kommzeit bis (.+), bzw\. eingetragene Ist-Zeiten\.$/,
      'Green = within budget, yellow = over 85 %, red = budget or mini-job limit ($1 €/month) exceeded. Hours = arrival until $2, or the actual times entered.'],
    [/^Stundenbudget bei Minijob mit (.+) €\/h: (.+) h \(2026\) bzw\. (.+) h \(2027\) im Monat\.$/, 'Hours budget for a mini-job at $1 €/h: $2 h (2026) or $3 h (2027) per month.'],
    [/^Zugang: Link zur App \+ persönliche PIN weitergeben\. Stundenbudget bei Minijob mit (.+) €\/h: (.+) h \(2026\) bzw\. (.+) h \(2027\) im Monat\.$/, 'Access: pass on the link to the app plus a personal PIN. Hours budget for a mini-job at $1 €/h: $2 h (2026) or $3 h (2027) per month.'],
    [/^(.+) übernimmt (.+) am (.+)$/, '$1 takes over $2 on $3'], [/^(.+) gibt (.+) am (.+) frei$/, '$1 releases $2 on $3'], [/^(.+) entfernt$/, '$1 removed'], [/^(\d+) Termine$/, '$1 dates'],
    [/^Schichtbericht (\d+)$/, 'Shift report $1'],
    [/^Minijob-Grenze (.+) € überschritten \((.+) €\)$/, 'Mini-job limit $1 € exceeded ($2 €)'], [/^Monatsbudget (.+) h überschritten \((.+) h\)$/, 'Monthly budget $1 h exceeded ($2 h)'],
    [/^(.+): (.+) h am Tag \(max\. (.+)\)$/, '$1: $2 h in one day (max. $3)'],
    [/^⚠ (.+)$/, '⚠ $1'],
  ];

  // ---- einzelne Wörter, überall im Text ----
  const WORDS = [
    [/\bSchichtende\b/g, 'shift end'], [/\bin zwei gleich lange Hälften\b/g, 'into two halves of equal length'], [/\ban einer langen Pause, sonst in Hälften\b/g, 'at a long break, otherwise halves'], [/\bnie\b(?=; einstellbar)/g, 'never'], [/\bTagschicht\b/g, 'Day shift'], [/\bZwischenschicht\b/g, 'Middle shift'], [/\bAbendschicht\b/g, 'Evening shift'], [/\bSchicht\b/g, 'Shift'], [/\bSchichten\b/g, 'shifts'],
    [/\bBühnenassistenz\b/g, 'Stage assistant'], [/\bAbenddienstleitung\b/g, 'Evening manager'], [/\bEinlass\b/g, 'Admission'], [/\bKasse\b/g, 'Box office'],
    [/\b(Mo|Di|Mi|Do|Fr|Sa|So)(?= \d{1,2}\.\d)/g, (m) => ({ Mo: 'Mon', Di: 'Tue', Mi: 'Wed', Do: 'Thu', Fr: 'Fri', Sa: 'Sat', So: 'Sun' }[m])],
    [/\b(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)(?= \d{4}\b)/g, (m) => ({ Januar: 'January', Februar: 'February', März: 'March', April: 'April', Mai: 'May', Juni: 'June', Juli: 'July', August: 'August', September: 'September', Oktober: 'October', November: 'November', Dezember: 'December' }[m])],
  ];
  // Sonderfälle nach Elternelement: Spaltenköpfe
  const TH = { 'Kasse': 'Cash', 'Datum': 'Date', 'Schicht': 'Shift' };

  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  function tr(text, ctx) {
    if (lang !== 'en' || !text) return text;
    const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/); if (!m[2]) return text;
    const core = m[2];
    let out;
    if (ctx === 'TH' && TH[core]) out = TH[core];
    else if (Object.prototype.hasOwnProperty.call(EN, core)) out = EN[core];
    else if (Object.prototype.hasOwnProperty.call(EN, norm(core))) out = EN[norm(core)];
    else {
      out = core;
      for (const [re, rep] of PAT) if (re.test(core)) { out = core.replace(re, rep); break; }
      for (const [re, rep] of WORDS) out = out.replace(re, rep);
    }
    return m[1] + out + m[3];
  }

  // ---- DOM ----
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  function node(n) {
    if (n.nodeType === 3) {
      const p = n.parentNode && n.parentNode.nodeName;
      if (p === 'SCRIPT' || p === 'STYLE' || p === 'TEXTAREA') return;
      if (p === 'OPTION' && !n.parentNode.hasAttribute('value')) return; // Text ist hier zugleich der Wert
      const v = tr(n.nodeValue, p === 'TH' ? 'TH' : '');
      if (v !== n.nodeValue) n.nodeValue = v;
    } else if (n.nodeType === 1) {
      for (const a of ATTRS) if (n.hasAttribute(a)) { const v = tr(n.getAttribute(a)); if (v !== n.getAttribute(a)) n.setAttribute(a, v); }
      for (const c of n.childNodes) node(c);
    }
  }
  let queued = false;
  function ui() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const h = document.querySelector('header'), box = h || document.querySelector('.login');
      if (box && !box.querySelector('#langBtn')) {
        const b = document.createElement('button'); b.id = 'langBtn'; b.className = 'small'; b.type = 'button'; b.title = 'Sprache / Language';
        b.setAttribute('data-lang-ui', '1');
        b.onclick = () => setLang(lang === 'en' ? 'de' : 'en');
        if (h) h.insertBefore(b, h.querySelector('#logout')); else box.appendChild(b);
        b.style.cssText = h ? 'color:#fff;background:transparent;border-color:#555;margin-right:8px' : 'margin-top:10px';
      }
      const b = document.getElementById('langBtn'); if (b) b.textContent = lang === 'en' ? 'EN | DE' : 'DE | EN';
    });
  }
  function setLang(l) {
    lang = l === 'en' ? 'en' : 'de';
    try { localStorage.setItem('hp_lang', lang); } catch (e) { /* egal */ }
    document.documentElement.lang = lang;
    document.title = lang === 'en' ? 'bijoubijou – shift schedule' : 'bijoubijou';
    // Oberfläche aus dem deutschen Original neu aufbauen; der Beobachter übersetzt sie wieder
    try { if (typeof S !== 'undefined' && S.me) render(); else if (typeof renderLogin === 'function') renderLogin(); } catch (e) { /* noch nicht gestartet */ }
    ui();
  }
  const obs = new MutationObserver((muts) => {
    if (lang === 'en') for (const m of muts) {
      if (m.type === 'childList') m.addedNodes.forEach(node);
      else if (m.type === 'characterData') node(m.target);
      else if (m.type === 'attributes') node(m.target);
    }
    ui();
  });
  const start = () => { obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); if (lang === 'en') { document.documentElement.lang = 'en'; document.title = 'Hüttenplan – shift schedule'; node(document.body); } ui(); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  // Rückfragen und Meldungen des Browsers
  for (const f of ['prompt', 'confirm', 'alert']) { const orig = window[f].bind(window); window[f] = (msg, ...rest) => orig(tr(String(msg ?? '')), ...rest); }
  window.hpLang = { get: () => lang, set: setLang, tr };
})();

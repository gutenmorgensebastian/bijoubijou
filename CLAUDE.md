# Hüttenplan – Hinweise für Claude

Kleine Web-App (Node 22+, SQLite, kein npm). Server: `server.js`, Oberfläche: `public/app.js` + `public/style.css`. Sprache der App und der Antworten: Deutsch.

## Vor jeder Arbeit: auf den neuesten Stand
Mehrere Chats arbeiten parallel an verschiedenen Registerkarten. Bevor du Code änderst:

```bash
git fetch origin main && git merge origin/main
```

(Ein SessionStart-Hook in `.claude/sync-main.sh` macht das automatisch. Prüfe trotzdem mit `git log --oneline -3`, dass der Stand aktuell ist, und löse Konflikte vor dem Coden.)

## Zuständigkeit pro Registerkarte
Jeder Chat ändert nur „seine“ Funktion in `public/app.js` und den passenden Teil in `server.js`:

| Registerkarte | Funktion in app.js |
|---|---|
| Plan | `viewPlan`, `shiftCard` |
| Mein Plan | `viewMine` |
| Offen | `viewOpen` |
| Chat | `viewChat` |
| Aufgaben | `viewTodos` |
| Stunden | `viewHours` |
| Leute | `viewPeople` |
| Spielplan | `viewSpielplan` |
| Einstellungen / Protokoll | `viewSettings`, `viewLog` |

Gemeinsame Helfer (Kopf von `app.js`, Drawer, `api`) nur ändern, wenn es nötig ist, und dann klein halten. Neue CSS-Regeln mit eigenem Präfix (z. B. `.sp-` für Spielplan) in einen eigenen Abschnitt von `style.css`.

## Abschluss
Kleine, abgeschlossene Commits auf dem zugewiesenen Branch. Vor dem Push erneut `git fetch origin main && git merge origin/main`. Nach `main` wird nur auf Wunsch des Nutzers gemergt (Fast-Forward oder Merge-Commit). `data/*.sqlite` nie committen.

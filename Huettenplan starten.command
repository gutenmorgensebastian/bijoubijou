#!/bin/bash
# Doppelklick startet den Hüttenplan lokal und öffnet den Browser.
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  for p in /opt/homebrew/bin /usr/local/bin; do [ -x "$p/node" ] && export PATH="$p:$PATH"; done
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js ist nicht installiert."
  echo "Bitte von https://nodejs.org die LTS-Version (24.x) installieren und danach erneut doppelklicken."
  open "https://nodejs.org/de/download"
  read -n 1 -s -r -p "Taste drücken zum Schließen …"; exit 1
fi

MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 22 ]; then
  echo "Node $(node -v) ist zu alt, gebraucht wird mindestens 22.5 (empfohlen 24 LTS)."
  open "https://nodejs.org/de/download"
  read -n 1 -s -r -p "Taste drücken zum Schließen …"; exit 1
fi

# Neueste Version holen (nur wenn Git vorhanden, Ordner sauber und Internet da)
if [ -d .git ] && command -v git >/dev/null 2>&1; then
  if git fetch -q origin main 2>/dev/null; then
    if [ "$(git branch --show-current)" != "main" ]; then git checkout -q main 2>/dev/null; fi
    if git merge -q --ff-only origin/main 2>/dev/null; then echo "Version: $(git log --oneline -1)"; else echo "Hinweis: Update übersprungen (lokale Änderungen?)."; fi
  else echo "Hinweis: kein Internet, starte mit vorhandener Version."; fi
else
  echo "ACHTUNG: Dieser Ordner ist keine Git-Kopie (z. B. aus einer ZIP-Datei)."
  echo "         Er wird NICHT automatisch aktualisiert. Version: $(cat VERSION 2>/dev/null || echo unbekannt)"
fi

PORT=${PORT:-3080}
echo "Hüttenplan startet auf http://localhost:$PORT  (Admin-PIN: 1234)"
echo "Zum Beenden dieses Fenster schließen oder Ctrl+C drücken."
( sleep 2; open "http://localhost:$PORT" ) &
PORT=$PORT node server.js

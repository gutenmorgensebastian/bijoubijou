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

# Neueste Version holen (ohne Passwortabfrage; klappt ohne Anmeldung, solange das Repo öffentlich ist)
export GIT_TERMINAL_PROMPT=0
REPO="https://github.com/gutenmorgensebastian/bijoubijou.git"
# Auf dem Mac ist /usr/bin/git nur ein Platzhalter, bis die Entwicklerwerkzeuge installiert sind
HAVE_GIT=0; GITBIN=$(command -v git)
if [ -n "$GITBIN" ] && { [ "$GITBIN" != /usr/bin/git ] || [ "$(uname)" != Darwin ] || xcode-select -p >/dev/null 2>&1; }; then HAVE_GIT=1; fi
if [ $HAVE_GIT = 0 ]; then
  echo "Hinweis: Git fehlt, kein automatisches Update. Version: $(cat VERSION 2>/dev/null || echo unbekannt)"
  echo "         Einmalig nachinstallieren: im folgenden Fenster auf „Installieren“ klicken."
  xcode-select --install 2>/dev/null
elif [ ! -d .git ]; then
  # ZIP-Kopie: einmalig in eine Git-Kopie verwandeln (Daten in data/ bleiben erhalten)
  if git ls-remote -q "$REPO" main >/dev/null 2>&1; then
    git init -q && git remote add origin "$REPO" && git fetch -q origin main && git checkout -q -f -B main origin/main && git branch -q -u origin/main \
      && echo "Eingerichtet: Ab jetzt aktualisiert sich der Hüttenplan bei jedem Start. Version: $(git log --oneline -1)" \
      || { rm -rf .git; echo "Hinweis: Einrichtung fehlgeschlagen, starte mit vorhandener Version."; }
  else
    echo "Hinweis: Update nicht möglich (kein Internet oder Repo privat). Version: $(cat VERSION 2>/dev/null || echo unbekannt)"
  fi
elif git fetch -q origin main 2>/dev/null; then
  if [ "$(git branch --show-current)" != "main" ]; then git checkout -q main 2>/dev/null; fi
  if git merge -q --ff-only origin/main 2>/dev/null; then echo "Version: $(git log --oneline -1)"; else echo "Hinweis: Update übersprungen (lokale Änderungen?)."; fi
else
  echo "Hinweis: Update nicht abrufbar (kein Internet oder keine GitHub-Anmeldung im Terminal)."
  echo "         Mit GitHub Desktop: dort „Fetch origin“ und dann „Pull origin“ klicken, danach neu starten."
  echo "         Gestartet wird jetzt die vorhandene Version: $(git log --oneline -1)"
fi

PORT=${PORT:-3080}
echo "Hüttenplan startet auf http://localhost:$PORT  (Admin-PIN: 1234)"
# Adressen für andere Geräte im selben WLAN (anderer Mac, Handys)
HOST=$(scutil --get LocalHostName 2>/dev/null)
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo
echo "Von anderen Geräten im selben WLAN erreichbar unter:"
[ -n "$HOST" ] && echo "   http://$HOST.local:$PORT"
[ -n "$IP" ] && echo "   http://$IP:$PORT"
echo "(Fragt macOS nach eingehenden Verbindungen für „node“: bitte „Erlauben“ klicken.)"
echo
echo "Zum Beenden dieses Fenster schließen oder Ctrl+C drücken."
echo "Solange dieses Fenster offen ist, geht der Mac nicht in den Ruhezustand."
( sleep 2; open "http://localhost:$PORT" ) &
PORT=$PORT caffeinate -i node server.js

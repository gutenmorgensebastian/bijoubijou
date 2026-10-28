#!/bin/bash
# Doppelklick: holt die neuesten Änderungen von GitHub, beendet eine laufende Instanz,
# startet den Hüttenplan neu und öffnet den Browser. Die Daten (data/*.sqlite) bleiben unberührt.
# Ohne Update starten: HP_NO_UPDATE=1 ./"Huettenplan starten.command"
#
# Alles steht in einem { … }-Block: bash liest ihn komplett ein, bevor er läuft. So kann
# "git pull" diese Datei ersetzen, ohne dass das laufende Skript durcheinanderkommt.
{
cd "$(dirname "$0")" || exit 1

pause() { read -n 1 -s -r -p "Taste drücken zum Schließen …"; echo; }

if ! command -v node >/dev/null 2>&1; then
  for p in /opt/homebrew/bin /usr/local/bin; do [ -x "$p/node" ] && export PATH="$p:$PATH"; done
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js ist nicht installiert."
  echo "Bitte von https://nodejs.org die LTS-Version (24.x) installieren und danach erneut doppelklicken."
  open "https://nodejs.org/de/download"
  pause; exit 1
fi

MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 22 ]; then
  echo "Node $(node -v) ist zu alt, gebraucht wird mindestens 22.5 (empfohlen 24 LTS)."
  open "https://nodejs.org/de/download"
  pause; exit 1
fi

PORT=${PORT:-3080}

# 1. Neueste Änderungen holen (nur wenn der Ordner ein Git-Klon ist)
if [ -z "$HP_NO_UPDATE" ] && [ -d .git ] && command -v git >/dev/null 2>&1; then
  echo "Suche Updates …"
  VORHER=$(git rev-parse HEAD 2>/dev/null)
  if git pull --ff-only; then
    NACHHER=$(git rev-parse HEAD 2>/dev/null)
    if [ "$VORHER" = "$NACHHER" ]; then echo "Schon auf dem neuesten Stand."
    else echo "Aktualisiert auf: $(git log -1 --format='%h %s')"; fi
  else
    echo
    echo "⚠️  Update nicht möglich (siehe Meldung oben). Es startet die bisherige Version."
  fi
  echo
fi

# 2. Laufende Instanz auf dem Port beenden (nur wenn es unser server.js ist)
for PID in $(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null); do
  if ps -p "$PID" -o command= | grep -q "server.js"; then
    echo "Beende laufenden Hüttenplan (Prozess $PID) …"
    kill "$PID"
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
    kill -9 "$PID" 2>/dev/null
  else
    echo "Port $PORT wird von einem anderen Programm benutzt (Prozess $PID)."
    echo "Bitte anderen Port wählen:  PORT=3081 ./\"Huettenplan starten.command\""
    pause; exit 1
  fi
done

# 3. Starten
echo "Hüttenplan startet auf http://localhost:$PORT  (Admin-PIN beim ersten Start: 1234)"
echo "Neustart mit neuen Änderungen: diese Datei einfach erneut doppelklicken (die laufende Instanz wird beendet)."
( sleep 2; open "http://localhost:$PORT" ) &
PORT=$PORT node server.js
CODE=$?
echo
echo "Der Server wurde beendet (Code $CODE)."
pause
exit
}

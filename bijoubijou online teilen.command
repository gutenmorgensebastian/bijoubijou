#!/bin/bash
# Doppelklick: macht bijoubijou auf diesem Mac vorübergehend über eine https-Adresse aus dem Internet erreichbar
# (Cloudflare Quick Tunnel, kostenlos, ohne Konto). Die Adresse gilt, solange dieses Fenster offen ist; beim
# nächsten Start gibt es eine neue. Für den Dauerbetrieb gehört die App auf einen Server.
cd "$(dirname "$0")"
PORT=${PORT:-3080}; mkdir -p .tools
pause() { read -n 1 -s -r -p "Taste drücken zum Schließen …"; echo; }
if ! command -v node >/dev/null 2>&1; then for p in /opt/homebrew/bin /usr/local/bin; do [ -x "$p/node" ] && export PATH="$p:$PATH"; done; fi
command -v node >/dev/null 2>&1 || { echo "Node.js fehlt – bitte zuerst „bijoubijou starten“ einrichten."; pause; exit 1; }

# 1. cloudflared besorgen (einmalig, landet im Ordner .tools)
CF="$(command -v cloudflared || true)"
if [ -z "$CF" ]; then
  CF="$PWD/.tools/cloudflared"
  if [ ! -x "$CF" ]; then
    ARCH=$([ "$(uname -m)" = arm64 ] && echo arm64 || echo amd64)
    echo "Lade einmalig das Tunnel-Programm (cloudflared, $ARCH) …"
    mkdir -p .tools && curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$ARCH.tgz" | tar -xz -C .tools \
      && chmod +x "$CF" || { echo "Download fehlgeschlagen. Internetverbindung prüfen."; pause; exit 1; }
  fi
fi

# 2. bijoubijou starten, falls er noch nicht läuft (wird beim Schließen wieder beendet)
SERVER=""
if ! curl -s -o /dev/null -m 3 "http://localhost:$PORT/api/me"; then
  echo "Starte bijoubijou …"
  PORT=$PORT node server.js > .tools/server.log 2>&1 &
  SERVER=$!
  for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; curl -s -o /dev/null -m 2 "http://localhost:$PORT/api/me" && break; done
fi
cleanup() { [ -n "$TUN" ] && kill "$TUN" 2>/dev/null; [ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null; }
trap cleanup EXIT INT TERM

# 3. Tunnel öffnen und die Adresse anzeigen
echo "Öffne den Tunnel …"
LOG=.tools/tunnel.log; : > "$LOG"
"$CF" tunnel --no-autoupdate --url "http://localhost:$PORT" > "$LOG" 2>&1 &
TUN=$!
URL=""
for i in $(seq 1 30); do sleep 1; URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1); [ -n "$URL" ] && break; done
if [ -z "$URL" ]; then echo "Tunnel konnte nicht geöffnet werden:"; tail -5 "$LOG"; pause; exit 1; fi
echo "$URL" | pbcopy 2>/dev/null
echo
echo "=================================================================="
echo "  bijoubijou ist jetzt erreichbar unter:"
echo
echo "     $URL"
echo
echo "  (schon in die Zwischenablage kopiert – einfach per Nachricht schicken)"
echo "  Anmeldung mit der persönlichen PIN aus „Leute“."
echo "=================================================================="
echo
echo "Solange dieses Fenster offen ist und der Mac wach bleibt, funktioniert der Link."
echo "Zum Beenden: Fenster schließen oder Ctrl+C. Beim nächsten Mal gibt es eine neue Adresse."
caffeinate -i -w "$TUN"

#!/bin/bash
# Doppelklick auf dem ZWEITEN Mac: öffnet den Hüttenplan, der auf dem Haupt-Mac läuft.
# So sehen beide Macs dieselben Daten. Hier wird KEIN eigener Server gestartet.
cd "$(dirname "$0")"
F=".server-adresse"
ADDR=$(cat "$F" 2>/dev/null)
if [ -z "$ADDR" ]; then
  echo "Auf dem Haupt-Mac zeigt das Fenster von „Huettenplan starten“ die Adresse an,"
  echo "z. B. http://Sebastians-MacBook.local:3080"
  read -p "Adresse hier eingeben: " ADDR
  ADDR=$(echo "$ADDR" | tr -d '[:space:]')
  [ -z "$ADDR" ] && exit 1
  case "$ADDR" in http*) ;; *) ADDR="http://$ADDR" ;; esac
  echo "$ADDR" > "$F"
  echo "Gespeichert. Zum Ändern die Datei .server-adresse löschen."
fi
if curl -s -m 5 -o /dev/null "$ADDR/api/me"; then
  open "$ADDR"
else
  echo "Haupt-Mac unter $ADDR nicht erreichbar."
  echo "Läuft dort „Huettenplan starten“? Sind beide Macs im selben WLAN?"
  echo "Falsche Adresse? Dann .server-adresse löschen und neu starten."
  read -n 1 -s -r -p "Taste drücken zum Schließen …"
fi

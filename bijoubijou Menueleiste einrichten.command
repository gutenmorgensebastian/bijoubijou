#!/bin/bash
# Doppelklick: baut das kleine Menüleisten-Programm „bijoubijou Server“ (Servermodus/Normalmodus) und startet es.
# Einmalig nötig, danach nur noch das Programm „bijoubijou Server“ im Ordner öffnen (oder bei der Anmeldung starten lassen).
cd "$(dirname "$0")"
pause() { read -n 1 -s -r -p "Taste drücken zum Schließen …"; echo; }
APP="bijoubijou Server.app"

if ! xcode-select -p >/dev/null 2>&1 || ! command -v swiftc >/dev/null 2>&1; then
  echo "Zum Bauen werden einmalig die Apple-Entwicklerwerkzeuge gebraucht."
  echo "Im folgenden Fenster auf „Installieren“ klicken, warten, dann diese Datei noch einmal doppelklicken."
  xcode-select --install 2>/dev/null
  pause; exit 1
fi

# laufendes Programm beenden, damit es ersetzt werden kann
pkill -f "$APP/Contents/MacOS/bijoubijou-server" 2>/dev/null && sleep 1

echo "Baue „bijoubijou Server“ …"
TMP="$(mktemp -d)"
mkdir -p "$TMP/$APP/Contents/MacOS"
cat > "$TMP/$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>bijoubijou Server</string>
  <key>CFBundleIdentifier</key><string>de.bijoubijou.server</string>
  <key>CFBundleExecutable</key><string>bijoubijou-server</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
if ! swiftc -O -framework Cocoa "menueleiste/main.swift" -o "$TMP/$APP/Contents/MacOS/bijoubijou-server"; then
  echo; echo "Bauen fehlgeschlagen (siehe Meldung oben). Bitte Screenshot an Claude schicken."; pause; exit 1
fi
codesign --force --deep -s - "$TMP/$APP" >/dev/null 2>&1
rm -rf "./$APP" && mv "$TMP/$APP" "./$APP" && rmdir "$TMP"
echo "Fertig: „$APP“ liegt im bijoubijou-Ordner."

read -r -p "Beim Anmelden am Mac automatisch starten? (j/n) " A
if [ "$A" = "j" ] || [ "$A" = "J" ]; then
  osascript -e "tell application \"System Events\" to make login item at end with properties {path:\"$PWD/$APP\", hidden:true}" >/dev/null \
    && echo "Eingetragen (Systemeinstellungen → Allgemein → Anmeldeobjekte)." || echo "Nicht eingetragen – geht auch von Hand unter Systemeinstellungen → Allgemein → Anmeldeobjekte."
fi
open "./$APP"
echo "Oben rechts in der Menüleiste steht jetzt „○ bijou“. Dort Servermodus oder Normalmodus wählen."
pause

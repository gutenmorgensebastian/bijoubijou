#!/bin/bash
# Doppelklick: neue, noch nicht übernommene Version ausprobieren.
# Läuft getrennt von deinem Echtbetrieb: eigener Port (3081) und eine KOPIE der Daten.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then for p in /opt/homebrew/bin /usr/local/bin; do [ -x "$p/node" ] && export PATH="$p:$PATH"; done; fi
command -v node >/dev/null 2>&1 || { echo "Node.js fehlt."; read -n 1 -s -r -p "Taste drücken …"; exit 1; }

git fetch -q origin || { echo "Kein Internet / Git-Fehler."; read -n 1 -s -r -p "Taste drücken …"; exit 1; }
BR=(main)
while IFS= read -r b; do BR+=("$b"); done < <(git for-each-ref --sort=-committerdate --format='%(refname:short)' 'refs/remotes/origin/claude/*' | sed 's#^origin/##' | head -9)

echo "Welche Version möchtest du ausprobieren?"
for i in "${!BR[@]}"; do
  msg=$(git log -1 --format='%s (%cr)' "origin/${BR[$i]}")
  echo "  $((i+1))) ${BR[$i]}  –  $msg"
done
read -p "Nummer eingeben: " N
SEL="${BR[$((N-1))]}"
[ -z "$SEL" ] && { echo "Ungültige Auswahl."; read -n 1 -s -r -p "Taste drücken …"; exit 1; }

git worktree prune
rm -rf .versuch && git worktree add -q --detach .versuch "origin/$SEL" || { echo "Konnte Version nicht laden."; read -n 1 -s -r -p "Taste drücken …"; exit 1; }
rm -rf .versuch-data && mkdir .versuch-data
cp data/huettenplan.sqlite* data/spielplan-seed.json .versuch-data/ 2>/dev/null
cp data/spielplan-seed.json .versuch-data/ 2>/dev/null

echo
echo "Teste '$SEL' auf http://localhost:3081  (Kopie deiner Daten, Echtbetrieb bleibt unberührt)"
echo "Zum Beenden dieses Fenster schließen oder Ctrl+C drücken."
( sleep 2; open "http://localhost:3081" ) &
cd .versuch && PORT=3081 DATA_DIR="$(cd .. && pwd)/.versuch-data" node server.js

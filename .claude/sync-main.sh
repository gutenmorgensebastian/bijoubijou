#!/bin/bash
# SessionStart-Hook: holt origin/main und führt es in den aktuellen Branch ein,
# damit jede neue Sitzung auf dem neuesten Stand anfängt.
cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0
git fetch -q origin main 2>&1 || { echo "Hinweis: git fetch fehlgeschlagen, Stand evtl. veraltet."; exit 0; }
BR=$(git branch --show-current)
[ -z "$BR" ] && exit 0
if [ "$BR" = "main" ]; then
  git merge -q --ff-only origin/main 2>&1 || echo "Hinweis: main liess sich nicht per Fast-Forward aktualisieren."
elif [ -z "$(git status --porcelain)" ]; then
  git merge -q --no-edit origin/main 2>&1 || { git merge --abort 2>/dev/null; echo "Hinweis: Merge von origin/main in $BR hatte Konflikte, abgebrochen. Bitte vor dem Coden manuell lösen."; }
else
  echo "Hinweis: Arbeitsverzeichnis nicht sauber, origin/main wurde nicht eingemischt."
fi
echo "Stand: $(git log --oneline -1)"

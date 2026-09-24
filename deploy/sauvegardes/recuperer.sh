#!/usr/bin/env bash
# À lancer depuis ton PC (Git Bash) : rapatrie les nouvelles sauvegardes du
# serveur dans un dossier local, puis applique la même rotation qu'en prod.
#   usage : recuperer.sh [dossier-local]     (défaut : ~/sauvegardes-shadowrun)
set -euo pipefail

HOTE="${HOTE:-quarantaine}"
DISTANT="${DISTANT:-/var/backups/shadowrun}"
LOCAL="${1:-$HOME/sauvegardes-shadowrun}"
ICI="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$LOCAL"
nouvelles=0
for f in $(ssh "$HOTE" "ls -1 $DISTANT | grep '^shadowrun-.*\.tar\.gz$'"); do
  if [ ! -e "$LOCAL/$f" ]; then
    scp -q "$HOTE:$DISTANT/$f" "$LOCAL/$f.partiel" && mv "$LOCAL/$f.partiel" "$LOCAL/$f"
    nouvelles=$((nouvelles + 1))
  fi
done
"$ICI/rotation.sh" "$LOCAL"
echo "$nouvelles nouvelle(s) archive(s) dans $LOCAL ($(ls "$LOCAL" | wc -l) au total)"

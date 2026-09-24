#!/usr/bin/env bash
# À lancer toutes les heures par cron, sur le serveur.
# Archive le contenu (YAML, images de la carte) + la base SQLite + les uploads,
# puis applique la rotation (voir rotation.sh).
set -euo pipefail

DEST="${DEST:-/var/backups/shadowrun}"
CONTENU="${CONTENU:-/var/shadowrun}"
VOLUME="${VOLUME:-/var/lib/docker/volumes/quarantaineserver-apps_shadowrun_data/_data}"
CONTENEUR="${CONTENEUR:-shadowrun}"
ICI="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$DEST"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/data"

# Copie cohérente de la base (une copie de fichier brute pendant une écriture peut être corrompue).
docker exec "$CONTENEUR" python -c "import sqlite3;s=sqlite3.connect('/app/data/app.db');d=sqlite3.connect('/tmp/app.bak');s.backup(d);d.close()"
docker cp "$CONTENEUR:/tmp/app.bak" "$tmp/data/app.db"
docker exec "$CONTENEUR" rm -f /tmp/app.bak
[ -d "$VOLUME/uploads" ] && cp -a "$VOLUME/uploads" "$tmp/data/uploads"

nom="shadowrun-$(date +%Y%m%d-%H%M%S).tar.gz"
# carte/source (37 Mo) est déjà versionné dans git : inutile de le ré-archiver toutes les heures.
tar -czf "$DEST/$nom.partiel" --exclude=./carte/source -C "$CONTENU" . -C "$tmp" data
mv "$DEST/$nom.partiel" "$DEST/$nom"   # jamais d'archive à moitié écrite visible par la rotation / la récupération

"$ICI/rotation.sh" "$DEST"
echo "OK $nom"

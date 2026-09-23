#!/usr/bin/env bash
# Édite un fichier de contenu de campagne directement sur le serveur (hors
# interface MJ), et corrige les droits ensuite.
#
# Le bind mount /var/shadowrun appartient à l'UID 1000 (l'utilisateur du
# conteneur), pas à root. La connexion SSH se fait en root : tout fichier
# créé ou modifié cette façon devient root-owned, et le site (qui tourne en
# UID 1000) perd alors le droit d'écrire dessus. Ce script s'occupe de
# remettre les droits après coup, pour ne pas avoir à y penser.
#
# Usage :
#   ./scripts/edit_contenu.sh districts.yaml
#   ./scripts/edit_contenu.sh runs/2026-10-05_ma-nouvelle-run.yaml
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage : $0 <chemin relatif dans /var/shadowrun>" >&2
  echo "Exemples : carte.yaml, districts.yaml, runs/2026-10-05_ma-run.yaml" >&2
  exit 1
fi

fichier="$1"
dossier=$(dirname "$fichier")

ssh -t quarantaine "mkdir -p '/var/shadowrun/$dossier' && nano '/var/shadowrun/$fichier' && chown -R 1000:1000 '/var/shadowrun/$dossier'"

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
# Usage (en ligne de commande, avec argument) :
#   ./scripts/edit_contenu.sh districts.yaml
#   ./scripts/edit_contenu.sh runs/2026-10-05_ma-nouvelle-run.yaml
#
# Double-clic (sans argument) : demande le chemin à l'écran, et attend une
# touche avant de fermer la fenêtre pour laisser le temps de lire le
# résultat (un double-clic ne peut pas passer d'argument — sans cette
# pause, la fenêtre s'ouvre et se referme aussitôt).
set -euo pipefail

fermer() {
  echo
  read -n 1 -s -r -p "Terminé — appuie sur une touche pour fermer cette fenêtre..."
  echo
}
trap fermer EXIT

fichier="${1:-}"
if [ -z "$fichier" ]; then
  echo "Exemples : carte.yaml, districts.yaml, runs/2026-10-05_ma-run.yaml"
  read -rp "Chemin relatif dans /var/shadowrun à éditer : " fichier
fi
if [ -z "$fichier" ]; then
  echo "Aucun chemin donné, annulé." >&2
  exit 1
fi

dossier=$(dirname "$fichier")

ssh -t quarantaine "mkdir -p '/var/shadowrun/$dossier' && nano '/var/shadowrun/$fichier' && chown -R 1000:1000 '/var/shadowrun/$dossier'"

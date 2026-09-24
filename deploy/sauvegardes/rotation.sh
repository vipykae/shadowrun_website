#!/usr/bin/env bash
# Rotation "espacée logarithmiquement" : garde, dans chaque tranche de temps,
# la plus récente archive des N derniers créneaux non vides.
#   usage : rotation.sh <dossier> [--dry-run]
# Nombre de créneaux gardés (surchargeables par variables d'environnement) :
#   HORAIRES=7  JOURNALIERES=3  HEBDO=2  MENSUELLES=3  ANNUELLES=2
# Les archives s'appellent shadowrun-AAAAMMJJ-HHMMSS.tar.gz.
set -euo pipefail

DOSSIER="${1:?dossier requis}"
DRY="${2:-}"
HORAIRES="${HORAIRES:-7}"; JOURNALIERES="${JOURNALIERES:-3}"; HEBDO="${HEBDO:-2}"
MENSUELLES="${MENSUELLES:-3}"; ANNUELLES="${ANNUELLES:-2}"

mapfile -t FICHIERS < <(cd "$DOSSIER" && ls -1 shadowrun-*.tar.gz 2>/dev/null | sort -r)
[ "${#FICHIERS[@]}" -eq 0 ] && exit 0

declare -A GARDER

# $1 = nombre de créneaux, $2 = commande date pour la clé de créneau (depuis le nom)
garder_tranche() {
  local n="$1" fmt="$2" vus=0 derniere="" f ts cle
  for f in "${FICHIERS[@]}"; do  # du plus récent au plus ancien
    ts="${f#shadowrun-}"; ts="${ts%.tar.gz}"   # AAAAMMJJ-HHMMSS
    local j="${ts%-*}" h="${ts#*-}"
    case "$fmt" in
      h) cle="$j${h:0:2}" ;;
      d) cle="$j" ;;
      w) cle="$(date -d "${j:0:4}-${j:4:2}-${j:6:2}" +%G%V)" ;;
      m) cle="${j:0:6}" ;;
      y) cle="${j:0:4}" ;;
    esac
    if [ "$cle" != "$derniere" ]; then
      vus=$((vus + 1)); derniere="$cle"
      [ "$vus" -gt "$n" ] && break
      GARDER["$f"]=1
    fi
  done
}

garder_tranche "$HORAIRES" h
garder_tranche "$JOURNALIERES" d
garder_tranche "$HEBDO" w
garder_tranche "$MENSUELLES" m
garder_tranche "$ANNUELLES" y

for f in "${FICHIERS[@]}"; do
  if [ -z "${GARDER[$f]:-}" ]; then
    if [ "$DRY" = "--dry-run" ]; then echo "supprimerait $f"; else rm -f "$DOSSIER/$f"; fi
  fi
done

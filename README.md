# Seattle // 2080 — Tableau des runs

Site interactif de campagne West March pour Shadowrun Anarchy : une carte de
Seattle avec les districts, leurs gangs, et les runs proposées par la MJ,
sur lesquelles les joueuses s'inscrivent.

Voir [CADRAGE.md](CADRAGE.md) pour le périmètre, l'architecture et la roadmap.

## Structure

```
frontend/          Le site (HTML/CSS/JS + Leaflet)
content/
  carte/           carte_seattle_web.jpg — image affichée, RÉFÉRENCE des
                   coordonnées (2048x3974 px, origine en haut à gauche)
  carte/source/    carte_seattle.png — original haute résolution (36 Mo)
  runs/            (V1) une run = un fichier YAML
backend/           (V1) API FastAPI
deploy/            (V1) Docker Compose, Caddy
```

## Lancer la V0 en local

```
python -m http.server 8300
```

puis ouvrir http://localhost:8300/frontend/

## Districts : du tracé labelme au site

Les districts sont tracés dans labelme sur `content/carte/carte_seattle_web.jpg`
(un polygone par district, le label devient le nom affiché). Après un nouveau
tracé ou une retouche :

```
python scripts/labelme_vers_districts.py
```

Le script simplifie les polygones et régénère `content/districts.yaml`
(source de vérité, éditable : gangs, description, runs jouées — ces champs
sont préservés à la régénération) et `frontend/districts.generated.js`
(consommé par le site, à ne pas éditer). Dépendance : `pip install pyyaml`.

## Notes V0

- Les runs restent factices dans `frontend/data.js` (3 runs).
- L'inscription fonctionne mais reste en mémoire (perdue au rechargement).
- La barre de statut en bas affiche les coordonnées pixel sous le curseur —
  pratique pour relever la position d'un pin.

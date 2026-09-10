# Seattle // 2080 — Tableau des runs

Site interactif de campagne West March pour Shadowrun Anarchy : une carte de
Seattle avec les districts, leurs gangs, et les runs proposées par la MJ,
sur lesquelles les joueuses s'inscrivent.

Voir [CADRAGE.md](CADRAGE.md) pour le périmètre, l'architecture et la roadmap.

## Structure

```
frontend/          Le site (HTML/CSS/JS + Leaflet), servi par le backend
backend/           API FastAPI (app.py) + requirements.txt
content/           Contenu éditable par la MJ (versionné dans git)
  carte.yaml       Image de la carte + dimensions
  carte/           carte_seattle_web.jpg — image affichée, RÉFÉRENCE des
                   coordonnées (2048x3974 px, origine en haut à gauche)
  carte/source/    carte_seattle.png — original haute résolution (36 Mo)
  districts.yaml   Les districts (généré par le script, champs éditables)
  runs/            Une run = un fichier YAML
scripts/           genere_hash.py, labelme_vers_districts.py
deploy/            Docker Compose, Caddy, .env.example
data/              (non versionné) app.db — inscriptions SQLite
```

## Lancer en local (dev)

```bash
pip install -r backend/requirements.txt
python -m uvicorn backend.app:app --port 8300 --reload
```

puis ouvrir http://localhost:8300/

Sans variables d'environnement, l'app démarre en mode dev avec les mots de
passe **`joueuse`** et **`mj`** (à ne jamais utiliser en production).

## Contenu (côté MJ)

- **Créer une run** : ajouter un fichier dans `content/runs/` (voir les
  exemples). L'`id` doit être unique ; `position: [x, y]` en pixels de la carte
  (les coordonnées s'affichent en bas de l'écran au survol) ; `district` doit
  correspondre à un `id` de `content/districts.yaml`.
- **Cycle de vie d'une run** (`statut`) : `ouverte` (inscriptions possibles)
  → `complete` (tu fermes les inscriptions à la main) → `jouee` après la
  séance, en remplissant `compte_rendu`. Les runs `jouee` et `annulee`
  disparaissent de la carte par défaut ; le bouton « ○ RUNS JOUÉES » en haut
  les affiche (pins en pointillés), et elles restent listées dans la fiche
  de leur district, cliquables pour relire le compte rendu.
- Le champ `runs_jouees` de `districts.yaml` sert uniquement d'historique
  texte pour les runs d'avant le site (non cliquables).
- **Éditer les districts** : remplir gangs / description dans
  `content/districts.yaml`.
- **Prendre en compte les changements** : bouton « ⟳ CONTENU » en haut à
  droite (visible en accès MJ) — recharge les YAML sans redémarrer le serveur.

### Retracer les districts (labelme)

Les districts sont tracés dans labelme sur `content/carte/carte_seattle_web.jpg`
(un polygone par district, le label devient le nom affiché). Après retouche :

```bash
python scripts/labelme_vers_districts.py
```

Le script simplifie les polygones et régénère `content/districts.yaml` — les
champs édités à la main (gangs, description, runs jouées) sont préservés.

## Déploiement (Raspberry Pi)

Voir [CADRAGE.md](CADRAGE.md) section 5. En résumé :

```bash
cd deploy
cp .env.example .env
python ../scripts/genere_hash.py   # génère hashs + clé, à coller dans .env
# renseigner DOMAINE dans .env
docker compose up -d --build
```

Caddy obtient automatiquement le certificat HTTPS pour `DOMAINE` (ports 80/443
à ouvrir sur la box vers la Pi). L'API rejette toute requête sans session
valide (401) et limite les tentatives de login (5/min/IP).

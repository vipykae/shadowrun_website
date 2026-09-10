# Seattle // 2080 — Tableau des runs

Site interactif de campagne West March pour Shadowrun Anarchy : une carte de
Seattle avec les districts, leurs gangs, et les runs proposées par la MJ,
sur lesquelles les joueuses s'inscrivent.

Voir [CADRAGE.md](CADRAGE.md) pour le périmètre, l'architecture et la roadmap.

## Structure

```
frontend/          Le site (HTML/CSS/JS + Leaflet), servi par le backend
  app.js           Logique : login, carte, sidebar, inscriptions, calendrier
  mj.js            Interface MJ : formulaires run/district, placement du pin
  personnages.js   Onglet Personnages : galerie PJ/PNJ, formulaires
  fond.js          Fond réseau de particules réactif au curseur (canvas)
  effets.js        Effets : décodage des titres, glitch, secousse
backend/           API FastAPI (app.py)
pyproject.toml / uv.lock   Dépendances Python, gérées avec uv
content/           Contenu éditable par la MJ (versionné dans git)
  carte.yaml       Image de la carte + dimensions
  carte/           carte_seattle_web.jpg — image affichée, RÉFÉRENCE des
                   coordonnées (2048x3974 px, origine en haut à gauche)
  carte/source/    carte_seattle.png — original haute résolution (36 Mo)
  districts.yaml   Les districts (généré par le script, champs éditables)
  runs/            Une run = un fichier YAML
  personnages/      pj.yaml (PJ) et pnj.yaml (PNJ)
scripts/           genere_hash.py, labelme_vers_districts.py
deploy/            Docker Compose, Caddy, .env.example
data/              (non versionné) app.db — inscriptions SQLite
```

## Lancer en local (dev)

Gestion des dépendances Python avec [uv](https://docs.astral.sh/uv/) :

```bash
uv sync
uv run uvicorn backend.app:app --port 8300 --reload
```

puis ouvrir http://localhost:8300/. `uv sync` crée un `.venv/` local à partir
de `uv.lock` (dépendances figées) — rien à activer, `uv run` s'en charge.
Après avoir ajouté/modifié une dépendance dans `pyproject.toml` :
`uv lock` puis `uv sync`.

Sans variables d'environnement, l'app démarre en mode dev avec les mots de
passe **`joueuse`** et **`mj`** (à ne jamais utiliser en production).

## Contenu (côté MJ)

Deux façons équivalentes de gérer le contenu — les deux écrivent les mêmes
fichiers YAML dans `content/`, qui restent la source de vérité (à versionner
dans git) :

**Depuis le site, en accès MJ** : bouton « + RUN » en haut pour créer une run ;
dans la fiche d'une run, boutons « ✎ Modifier », « ✓ Marquer jouée » (ouvre le
formulaire avec le statut prérempli et le curseur sur le compte rendu) et
« ✕ Supprimer » ; dans la fiche d'un district, « ✎ Modifier le district »
(gangs, description, historique). Le pin se place en cliquant « ◎ Placer sur
la carte » puis sur la carte (Échap pour annuler). Le champ « Image » du
formulaire de run est un vrai envoi de fichier (même mécanisme que les
portraits de personnages, voir plus bas) : elle s'affiche dans la fiche de
la run et est jointe à la notification Discord de publication. Le fichier
YAML est écrit sous `content/runs/<date>_<id>.yaml`.

**À la main, dans les fichiers** :

- **Créer une run** : copier `content/runs/_modele.yaml` (commenté champ par
  champ ; les fichiers commençant par `_` sont ignorés par le site) sous un
  nouveau nom. Obligatoires : `id` (unique), `titre`, `district` (un `id` de
  `content/districts.yaml`) et `position: [x, y]` en pixels de la carte (les
  coordonnées s'affichent en bas de l'écran au survol). Le reste est
  optionnel : `mj`, `type`, `places`, `date`, `duree_estimee`, `lieu`,
  `paiement`, `difficulte` (1-5), `risques`, `themes`, `avertissements`
  (trigger warnings, affichés en orange), `notes` (archétypes recommandés),
  `brief`, `compte_rendu`.
- **Date** : `date: 2026-02-05T20:30` (fixe), `date: https://…` (lien vers un
  sondage, affiché « Voter pour la date »), ou texte libre / ligne absente
  (« À définir »).
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
uv run scripts/labelme_vers_districts.py
```

Le script simplifie les polygones et régénère `content/districts.yaml` — les
champs édités à la main (gangs, description, runs jouées) sont préservés.

## Personnages (PJ / PNJ)

Bouton « PERSONNAGES » en haut : bascule vers une galerie séparée de la
carte, avec deux sections. Permissions différentes des runs :

- **PJ (personnages joueuses)** : créés/modifiés/supprimés par n'importe qui
  de connecté — joueuse ou MJ (groupe de confiance, pas de notion de
  « propriétaire »). Bouton « + PERSO ».
- **PNJ** : réservés à la MJ (le bouton « + PERSO » propose un choix de type
  PJ/PNJ uniquement en accès MJ ; les boutons modifier/supprimer d'un PNJ ne
  s'affichent pas côté joueuse, et l'API refuse ces écritures avec 403).

Champs (tous optionnels sauf nom) : `nom`, `archetype`, `concept`, `notes`,
`image`, et selon le type `joueuse` (PJ) ou `faction` / `district` (PNJ).
Fichiers : `content/personnages/pj.yaml` et `pnj.yaml`, éditables à la main
de la même façon que `districts.yaml` (le champ `image` y est alors une URL
externe ou un chemin `/api/uploads/...`).

**Portrait / image de run** : le champ « Portrait » (personnages) ou
« Image » (runs) est un vrai envoi de fichier, pas un champ URL — cliquer
« Choisir un fichier… » téléverse une image, automatiquement redimensionnée
(800 px max) et recompressée en JPEG par le serveur (`backend/app.py`, via
Pillow) avant d'être stockée dans `data/uploads/` (comme la base SQLite :
ni versionné dans git, ni géré par la MJ — un nom de fichier aléatoire). La
lecture (`GET /api/uploads/<nom>`) est la **seule autre exception**, avec
le calendrier, à l'exigence de session sur l'API : Discord doit pouvoir
charger l'image lui-même pour l'aperçu du message, sans jamais présenter de
cookie ; le nom aléatoire (uuid4) rend le fichier impossible à deviner.
Remplacer une image ou supprimer la run/le personnage efface automatiquement
l'ancien fichier ; annuler le formulaire après un envoi non sauvegardé
l'efface aussi.

## Notifications Discord

Si `DISCORD_WEBHOOK_URL` est renseigné dans `.env`, le serveur poste
directement sur Discord (aucun relais tiers) lors de la publication d'une
run, d'une inscription, et du passage d'une run en « jouée ». Si la run
publiée a une image, elle est jointe au message (embed Discord) — l'URL
envoyée à Discord est complète (`https://ton-domaine/api/uploads/...`),
construite à partir de l'adresse à laquelle la requête est arrivée. Laisser
la variable vide désactive silencieusement la fonctionnalité. Une panne
Discord ne fait jamais échouer une requête de l'API (l'appel est fait en
tâche de fond, après la réponse).

## Export calendrier (.ics)

Bouton « CALENDRIER » (visible une fois connectée) : copie dans le
presse-papiers un lien à coller dans Google Calendar / Apple Calendar /
Outlook comme abonnement à une URL — le calendrier se met à jour tout seul
au fil des runs publiées. Nécessite `CALENDRIER_TOKEN` dans `.env` (généré
par `scripts/genere_hash.py`) : ce lien est protégé par ce jeton dédié plutôt
que par le mot de passe du site, puisque les applis calendrier ne savent pas
se connecter avec un mot de passe. Seules les runs à date fixe (pas les
sondages ni les dates « à définir ») apparaissent dans le flux.

## Déploiement (Raspberry Pi)

Voir [CADRAGE.md](CADRAGE.md) section 5. En résumé :

```bash
cd deploy
cp .env.example .env
uv run ../scripts/genere_hash.py   # génère hashs + clé + jeton calendrier, à coller dans .env
# renseigner DOMAINE (et DISCORD_WEBHOOK_URL si voulu) dans .env
docker compose up -d --build
```

Caddy obtient automatiquement le certificat HTTPS pour `DOMAINE` (ports 80/443
à ouvrir sur la box vers la Pi). L'API rejette toute requête sans session
valide (401) et limite les tentatives de login (5/min/IP).

# Cadrage — Site West March Shadowrun Anarchy

> Document de référence du projet. Mis à jour au fil des décisions.
> Dernière mise à jour : 2026-09-10

## 1. Vision

Un site web interactif servant de « tableau de missions » pour une campagne West March
dans l'univers de Shadowrun Anarchy. La MJ publie des runs (one-shots) localisées sur
une carte de la ville ; les joueuses consultent la carte, découvrent les districts et
les runs disponibles, et s'inscrivent aux séances.

Ambiance visuelle : futuriste / cyberpunk — fond noir, accents bleu néon,
motifs mesh / réseau de neurones en arrière-plan. À terme (post-V1) :
animations d'apparition (fade, slide, effet « glitch ») et arrière-plan
réactif au survol de la souris (réseau de particules en canvas).

## 2. Décisions actées

| Sujet | Décision |
|---|---|
| Hébergement | Raspberry Pi à domicile, conteneurs Docker |
| Exposition | Port 443 ouvert sur la box + reverse proxy (Caddy, HTTPS Let's Encrypt) |
| Authentification | Deux mots de passe partagés : un accès **joueuse** (lecture + inscription), un accès **MJ** (écriture) |
| Identité joueuse | Nom libre saisi à l'inscription à une run (groupe de confiance) |
| Contenu (runs, districts, gangs) | Fichiers YAML versionnés dans git, édités par la MJ (interface web d'admin reportée en V2) |
| Carte | Image finale déjà disponible, fournie par la MJ |
| Backend | Python — FastAPI (compétence existante de la MJ) |
| Frontend | HTML/CSS/JS vanilla + Leaflet.js (pas de framework, pas de toolchain npm) |
| Base de données | SQLite (uniquement pour les données dynamiques : inscriptions) |

## 3. Périmètre

### Dans le périmètre
- Carte interactive de la ville (image fournie) : zoom/pan, districts survolables, pins cliquables.
- Infobulle district : nom, gang dominant, gangs présents, runs déjà jouées.
- Sidebar run : titre, synopsis, date/heure, difficulté, tags, places, liste des inscrites.
- Inscription/désinscription par nom (accès joueuse).
- Deux niveaux d'accès par mot de passe partagé.
- Contenu géré en YAML par la MJ, rechargeable sans redéploiement.
- Déploiement Docker sur Raspberry Pi, HTTPS, sauvegardes.

### Envisagé pour plus tard (pas dans les premières versions)
- **Multi-cartes** : pouvoir présenter plusieurs cartes (autres villes, plans de
  lieux). Le modèle de données V1 gardera une notion de `carte_id` pour ne pas
  fermer la porte.
- **Onglet Ressources** : accès aux documents de la campagne (PDF de règles,
  aides de jeu) derrière l'accès joueuse.
- **Onglet Personnages** : galerie des PJ et PNJ avec leurs infos.
- **Polish visuel** : animations futuristes (fade/slide/glitch à l'apparition
  des panneaux), fond mesh réactif à la souris.

### Hors périmètre (définitif)
- Comptes individuels, mails, récupération de mot de passe.
- Application mobile native : le site sera responsive (utilisable sur mobile),
  sans interface dédiée mobile.
- Montée en charge : usage réel = 1 à 3 personnes simultanées maximum.
  Aucune architecture de scalabilité ; SQLite sérialise nativement les
  écritures (mode WAL activé), ce qui suffit largement — pas de queue à prévoir.

## 4. Architecture

```
Internet ──HTTPS:443──> Box (NAT) ──> Raspberry Pi
                                        │
                                 [ Docker Compose ]
                                        │
                        ┌───────────────┴───────────────┐
                        │ caddy                          │ app (FastAPI + uvicorn)
                        │ - TLS Let's Encrypt            │ - sert le frontend statique
                        │ - reverse proxy → app          │ - API JSON (runs, districts, inscriptions)
                        │ - rate limiting (login)        │ - sessions signées (cookie)
                        └───────────────┬───────────────┘
                                        │ volumes montés
                              ./content/   *.yaml  (runs, districts, gangs, carte)
                              ./data/      app.db  (SQLite : inscriptions)
```

### Choix techniques et justifications

- **FastAPI** : framework Python moderne, async, doc auto (Swagger), zéro
  dépaysement pour une dev Python. Uvicorn comme serveur ASGI.
- **Leaflet.js + `CRS.Simple` + `imageOverlay`** : Leaflet est une lib de carto
  légère qui sait afficher une image arbitraire comme fond de carte (pas besoin
  de tuiles GIS). Zoom/pan gratuits, marqueurs (pins) natifs, polygones GeoJSON
  pour les districts avec événements hover/click. C'est la pièce qui rend le
  projet « facile » côté web.
- **Pas de framework front (React, etc.)** : le site est essentiellement une
  page (la carte) + une sidebar. Vanilla JS + fetch suffit, et évite d'apprendre
  un écosystème entier. Ce choix ne bride PAS les ambitions visuelles :
  les animations (fade, slide, glitch) se font en CSS pur ou avec **GSAP**
  (lib d'animation utilisable en vanilla, un simple `<script>`), et le fond
  réactif à la souris avec **tsParticles** (réseau de particules canvas,
  vanilla aussi) ou un canvas maison. Un framework type React n'apporterait
  rien ici — il sert à gérer des interfaces à état complexe, pas à animer.
- **YAML pour le contenu, SQLite pour le dynamique** : séparation nette.
  Le contenu narratif (runs, districts, gangs) est de la donnée d'auteure —
  versionnée dans git, éditée dans un éditeur de texte, relisible en diff.
  Les inscriptions sont de la donnée utilisatrice — en base, avec contrainte
  d'unicité et horodatage.
- **Caddy** plutôt que Nginx/Traefik : configuration minimale (3 lignes),
  certificats Let's Encrypt entièrement automatiques, renouvellement inclus.

### Modèle de données

`content/districts.yaml`
```yaml
- id: redmond
  nom: Redmond Barrens
  gang_dominant: Les Crimson Crush
  gangs_presents: [Halloweeners, Rusted Stilettos]
  description: >
    Zone de non-droit, ruines et squats...
  polygone: [[120, 340], [180, 320], ...]   # coordonnées pixel sur l'image
```

`content/runs/2026-01-15_extraction-euphoria.yaml`
```yaml
id: extraction-euphoria
titre: "Extraction : Euphoria"
district: redmond
position: [152, 310]          # pixel sur l'image
date: 2026-01-15T20:30:00
duree_estimee: 3h30
difficulte: 2                 # 1-5
tags: [infiltration, matrice]
places: 4
statut: ouverte               # ouverte | complete | jouee | annulee
synopsis: >
  Un Johnson veut récupérer une chanteuse...
compte_rendu: null            # rempli après la séance (lien ou texte)
```

SQLite — table `inscriptions` :
`(id, run_id, nom_joueuse, cree_le)` avec unicité sur `(run_id, nom_joueuse)`.

### API (V1)

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| POST | `/api/login` | public | mdp partagé → cookie de session (rôle joueuse ou MJ) |
| GET | `/api/carte` | joueuse | métadonnées image + districts + runs (avec inscrites) |
| POST | `/api/runs/{id}/inscription` | joueuse | s'inscrire (body : nom) |
| DELETE | `/api/runs/{id}/inscription` | joueuse | se désinscrire (body : nom) |
| POST | `/api/reload` | MJ | recharger les YAML sans redémarrer |

## 5. Sécurité (port ouvert sur Internet)

**Principe clé : la protection est côté serveur, pas côté front.** Le mot de
passe ne « déverrouille » pas seulement l'affichage : chaque endpoint de l'API
(sauf `/api/login`) exige un cookie de session valide et renvoie 401 sinon.
Impossible d'appeler l'API directement (curl, script) sans s'être authentifié.
La seule surface attaquable en brute-force est donc `/api/login`, qui est
spécifiquement durcie :

- **Rate limiting** sur `/api/login` (middleware FastAPI type slowapi :
  ex. 5 tentatives/minute/IP) + délai croissant après échecs.
- Mots de passe = **phrases de passe longues**, comparées à un hash argon2 —
  un brute-force en ligne à 5 essais/minute est sans espoir.
- Option ceinture-bretelles : **fail2ban** qui lit les logs Caddy et bannit
  au niveau IP les adresses qui insistent.
- Cookie de session signé, expirant, `HttpOnly; Secure; SameSite=Lax` —
  non forgeable sans la clé secrète du serveur.

Autres mesures :

- **HTTPS obligatoire** (Caddy + Let's Encrypt), HTTP redirigé.
- Conteneurs **non-root**, seul le port 443 (et 80 pour le challenge ACME) exposé,
  pas de SSH exposé sur Internet.
- Mises à jour : `apt` automatique sur la Pi (unattended-upgrades), images Docker
  reconstruites régulièrement.
- **Sauvegardes** : `content/` est dans git (sauvegarde naturelle via remote) ;
  `data/app.db` copiée chaque nuit (cron) vers un second support ou le cloud.
- Validation stricte des entrées (le nom de joueuse est la seule entrée libre :
  longueur max, échappement à l'affichage).
- Monitoring : logs Caddy + app en volume, healthcheck Docker ;
  option Uptime Kuma en conteneur séparé.

## 6. Roadmap

### V0 — Maquette statique (validation UX/DA) ✅ FAIT
Objectif : voir la carte et le thème, valider l'ergonomie avant tout backend.
- Page unique servie en statique : thème cyberpunk (noir/bleu, fond mesh).
- Carte image dans Leaflet, 2–3 districts polygonés à la main, 3 pins factices.
- Infobulle district au survol, sidebar run au clic (données en dur dans un JS).
- **Livrable : une page qu'on ouvre en local et qu'on valide ensemble.**

### V1 — MVP jouable (mise en ligne) ✅ DÉVELOPPÉE (reste : déploiement Pi)
Objectif : les joueuses s'inscrivent réellement depuis chez elles.
- ✅ Backend FastAPI : login 2 rôles (cookie signé), chargement YAML, API carte,
  inscriptions SQLite (WAL), rate limiting login, échappement des entrées.
- ✅ Tous les districts polygonés, contenu réel des premières runs.
- ✅ Inscription/désinscription par nom, compteur de places, statut « complète ».
- ✅ Écran de login, bouton MJ « recharger le contenu », déconnexion.
- ✅ Docker Compose (app + Caddy) + Caddyfile + .env.example prêts.
- ⏳ Reste à faire par la MJ : déploiement sur la Pi, DNS/domaine, HTTPS réel,
  sauvegardes nocturnes de `data/app.db`.
- Cartographie des districts : tracé des polygones **à la main avec labelme**
  (outil Python d'annotation d'images : `pip install labelme`, polygones à la
  souris, export JSON en coordonnées pixel) + petit script de conversion
  labelme → `districts.yaml` fourni dans le repo. Alternative sans
  installation : makesense.ai (dans le navigateur). Pour relever la position
  d'un pin isolé : clic dans labelme (mode point) ou n'importe quel éditeur
  d'image affichant les coordonnées du curseur (GIMP, barre d'état).

### V2 — Confort MJ
- Interface web MJ : créer/modifier une run via formulaire, placer le pin en
  cliquant sur la carte, marquer une run « jouée » + compte rendu.
- Historique par district (runs jouées listées dans l'infobulle).
- Responsive mobile soigné.

### V2.5 — Polish visuel ✅ FAIT (avant la V2, à la demande de la MJ)
- ✅ Fond réseau de particules réactif au curseur — canvas maison
  (`frontend/fond.js`, sans dépendance), coupé sur mobile et si
  `prefers-reduced-motion`.
- ✅ Animations : apparition en cascade du contenu de la sidebar, « décodage »
  des titres, glitch périodique du logo et de l'écran de login, fondu de la
  carte au chargement, pins qui surgissent, secousse en cas de mauvais mot
  de passe, scanlines discrètes (`frontend/effets.js` + CSS).
- Finalement sans GSAP ni tsParticles : le CSS et ~150 lignes de canvas
  suffisaient.

### V3 — Vie de la campagne (idées, à prioriser plus tard)
- Notification Discord (webhook) à la publication d'une run ou inscription.
- Export calendrier (.ics) des séances.
- Onglet **Ressources** : PDF et aides de jeu téléchargeables (accès joueuse).
- Onglet **Personnages** : galerie PJ / PNJ avec portraits et infos.
- **Multi-cartes** : autres villes ou plans de lieux (le schéma prévoit
  `carte_id` dès la V1).
- Pages gangs / lore, fil d'actualité de la campagne.
- Statistiques : runs par district, présence des joueuses.

## 7. Risques et points d'attention

| Risque | Mitigation |
|---|---|
| Tracer les polygones des districts est fastidieux | Outil éditeur clic-à-clic prévu en V1 |
| Image de carte très lourde → chargement lent | Export en JPEG/WebP optimisé, ~2000px de large max ; tuilage seulement si nécessaire |
| IP domestique dynamique | DynDNS (ex. DuckDNS) ou domaine + API de mise à jour DNS |
| Box qui ne supporte pas le NAT loopback (accès depuis le LAN) | Entrée DNS locale ou /etc/hosts |
| Corruption / perte de la SQLite | Sauvegarde nocturne + `content/` dans git |
| Mot de passe partagé qui fuite | Rotation simple (variable d'env), impact limité (pas de données sensibles) |

## 8. Organisation

- Dépôt git (ce dossier) : `backend/`, `frontend/`, `content/`, `deploy/`, `CADRAGE.md`.
- Une branche par version, tags `v0`, `v1`, ...
- Prochaines étapes immédiates :
  1. `git init` + première structure de dossiers.
  2. Déposer l'image de la carte dans `content/carte/`.
  3. Développer la V0 et la valider ensemble.

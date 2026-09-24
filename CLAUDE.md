# CLAUDE.md — Seattle // 2080

Notes pour Claude sur *comment* travailler sur ce projet, pas sur *ce qu'il fait*.
Pour le fond, lire [README.md](README.md) (usage, structure, contenu) et
[CADRAGE.md](CADRAGE.md) (vision, architecture, roadmap, sécurité) — ne pas dupliquer
leur contenu ici, ils bougent vite et ce fichier doit rester correct sans entretien.
Historique des fonctionnalités : [frontend/changelog.md](frontend/changelog.md) (affiché
aussi dans le site, cliquable depuis le numéro de version en bas de page).

## Stack et lancement

Python géré avec **uv**, jamais pip/venv à la main :

```bash
uv sync
uv run uvicorn backend.app:app --port 8300 --reload   # site seul, avec rechargement
uv run python -m bot.main                              # bot Discord seul (test)
uv run python run.py                                   # les deux ensemble, comme en prod
```

`.env` à la racine est chargé automatiquement au démarrage (`load_dotenv()` dans
`backend/app.py`) — aussi bien en local qu'en Docker. Ne jamais supposer qu'une variable
absente de l'environnement shell est réellement absente : vérifier `.env` d'abord.

## Comment travailler ici

**Être autonome, ne pas renvoyer la balle.** Ce projet tourne en local (`uv run
uvicorn ...`) et le panneau de navigateur intégré permet de cliquer dedans comme une
vraie utilisatrice — les deux sont disponibles pour vérifier une fonctionnalité de bout
en bout sans demander à l'autre côté de la conversation de lancer une commande et de
coller le résultat. Si quelque chose manque pour tester (un serveur, une valeur de
`.env`, un accès), le dire clairement plutôt que de s'arrêter en silence.

**Ne jamais déclarer qu'une chose fonctionne sans l'avoir vue fonctionner pour de vrai.**
La relecture de code ne suffit pas : lancer un serveur jetable sur un port libre (jamais
8300, presque toujours occupé par une session de dev en cours — vérifier avec `netstat`
avant de choisir), l'appeler en curl ou depuis le navigateur, lire la réponse réelle.
Pour un webhook/API externe, un faux serveur HTTP local (voir historique : un script
Python de trois lignes avec `http.server`) donne une preuve bien plus fiable qu'un
« aucune erreur dans les logs ».

**Se méfier des logs bufferisés.** `print()` redirigé vers un fichier (`> log.txt 2>&1 &`)
peut ne jamais flusher avant la fin du process — l'absence d'erreur dans un tel fichier
n'est pas une preuve de succès. Pour un diagnostic fiable : `PYTHONUNBUFFERED=1`, ou un
script Python synchrone qui imprime directement dans la sortie qu'on lit.

**Nettoyer après un test.** Tuer les serveurs jetables et supprimer les runs/personnages/
images créés pour le test (l'API le permet directement : `DELETE /api/mj/runs/{id}`,
etc.). Ne jamais toucher aux données que l'utilisatrice a créées elle-même en testant de
son côté (des runs nommées « test », « run 2»… laissées dans `content/runs/` sont les
siennes, pas des scories à ranger).

## Secrets

`.env` n'est jamais committé (`.gitignore`) — mais si son contenu apparaît quand même en
clair dans la conversation (capture d'écran, copier-coller), le traiter comme compromis :
le signaler explicitement et recommander de régénérer la valeur (jeton Discord, mot de
passe…) avant de la remettre en place. C'est déjà arrivé une fois pour de vrai (URL de
webhook Discord collée dans le chat) — ne jamais supposer que « c'est juste du dev, ça
ne compte pas ».

## Modèle de contenu (déjà tranché, ne pas relitiger sans raison neuve)

`content/*.yaml` = donnée d'auteure (runs, districts, personnages) : versionnée dans
git (historique et sauvegarde gratuits), éditable à la main comme depuis l'interface MJ.
`data/` (SQLite + images téléversées) = donnée générée par l'usage (inscriptions,
uploads) : gitignorée, un seul rédacteur par fichier YAML donc pas de souci de
concurrence, alors qu'une base a du sens pour des écritures concurrentes (contrainte
d'unicité sur les inscriptions). Détail et raisonnement complet : CADRAGE.md.

## Sécurité de l'API

Chaque endpoint exige une session valide sauf trois exceptions volontaires et
documentées (CADRAGE.md §5) : `/api/login`, `/api/calendrier.ics` (jeton dédié,
applis calendrier obligent), `GET /api/uploads/<nom>` (public, Discord doit charger
l'image lui-même — nom de fichier uuid4 imprévisible en seule protection). Toute
nouvelle route publique doit être aussi délibérée et documentée que ces trois-là, pas
une fuite accidentelle.

## Git et versions

Une branche `feat/...` par fonctionnalité, mergée dans `main` ; le merge s'accompagne
d'un commit `chore: bump version to X.Y.Z` qui incrémente `version` dans
`pyproject.toml` et ajoute une entrée en tête de `frontend/changelog.md` (une ligne par
changement utilisateur, en français, datée). Le numéro de version s'affiche dans le
site lui-même (bas de page, changelog au clic) — c'est une fonctionnalité pour
l'utilisatrice, pas juste un artefact de dev.

## Déploiement réel

`deploy/` (Caddy, Raspberry Pi dédié) était le plan initial (CADRAGE.md) mais le
déploiement réel se fait sur un serveur communautaire partagé entre plusieurs
personnes, documenté dans un **projet Claude séparé** :
`D:\Data\01_Projects\2026_mutual_server` (dépôt `quarantaine-server`, PR
`feat/shadowrun-westmarch`) — nginx + certbot à la place de Caddy, image construite à
part et poussée sur un registry privé. Ce projet a son propre CLAUDE.md et ses propres
conventions ; ne pas les importer ici ni l'inverse.

Point de fragilité déjà rencontré : les variables d'environnement de ce site
(`DISCORD_BOT_TOKEN`, `DISCORD_FORUM_RUNS_ID`, etc. — voir `deploy/.env.example` pour
la liste à jour) sont dupliquées, préfixées `SHADOWRUN_`, dans le `docker-compose.apps.yml`
de ce serveur partagé. Une variable renommée ou ajoutée ici (comme quand
`DISCORD_WEBHOOK_URL` a été remplacée par le bot) doit être répercutée là-bas à la main
— rien ne les garde synchronisées automatiquement. Après un changement de variable
d'environnement, vérifier ce fichier dans l'autre projet.

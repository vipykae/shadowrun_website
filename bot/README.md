# Bot Discord — West March

Bot de modération, d'utilité et de notifications pour la campagne. Dans le même dépôt
et le même environnement Python (`uv`) que le site web (`backend/`) — et, **en
production, dans le même process** (voir `../run.py`) : c'est lui qui envoie les
notifications de nouvelle run/inscription/run jouée, à la place de l'ancien webhook.
En dev, on peut toujours le lancer seul (ci-dessous) pour tester `/roll` et
`/purge_between` sans site.

## Commandes

- **`/roll <expression>`** — lance des dés au format `XdY` avec modificateur optionnel :
  `2d6`, `1d20+5`, `4d8-2`, `10d10 - 5` (espaces autour du signe tolérés). Limité à
  100 dés et 1000 faces. Utilisable par tout le monde.
- **`/prochaine_run`** — affiche la prochaine run à venir (date, district, places
  restantes), en réponse éphémère (visible que de la personne qui a tapé la commande).
  Utilisable aussi bien dans un salon qu'en MP direct avec le bot (`allowed_contexts`).
- **`/help`** — mode d'emploi du bot et du site, en réponse éphémère. Le texte vit dans
  `content/aide_bot.md` (pas dans le code) : à compléter directement sur le serveur
  quand on ajoute une commande, sans redéployer.
- **`/purge_between <message_id_1> <message_id_2>`** — supprime tous les messages entre
  les deux ID donnés (bornes incluses), dans le salon ou fil où la commande est lancée.
  Peu importe l'ordre des deux ID. Demande confirmation (bouton, avec le nombre de
  messages concernés) avant toute suppression. Réservée aux personnes ayant la
  permission Discord **Gérer les messages** sur le salon.

  Pour récupérer un ID de message : mode développeur activé
  (Réglages Discord > Avancés > Mode développeur), puis clic droit sur le message >
  **Copier l'ID**.

  Les messages de plus de 14 jours sont supprimés un par un (limite de l'API Discord
  pour la suppression groupée) — plus lent, mais géré automatiquement.

## Setup (test en local, bot seul)

**1. Créer l'application Discord** (si ce n'est pas déjà fait) sur le
[Developer Portal](https://discord.com/developers/applications) :

- New Application, puis onglet **Bot** > Reset Token (à copier dans `bot/.env`).
- Toujours dans **Bot**, aucun intent privilégié à activer — les commandes utilisées
  ici passent par l'API REST, pas par le flux d'événements.

**2. Générer un lien d'invitation** — onglet **OAuth2 > URL Generator** :

- Scopes : `bot` et `applications.commands`
- Permissions bot : **Send Messages**, **Manage Messages**, **Read Message History**,
  **Use Slash Commands**
- Ouvrir l'URL générée, inviter le bot sur ton serveur de test.

**3. Configurer l'environnement local :**

```bash
cp bot/.env.example bot/.env
# éditer bot/.env : DISCORD_BOT_TOKEN (obligatoire), DISCORD_TEST_GUILD_ID (recommandé
# pour du test — sans lui, les commandes slash mettent jusqu'à 1h à apparaître)
uv sync
```

**4. Lancer le bot :**

```bash
uv run python -m bot.main
```

Les commandes doivent apparaître immédiatement dans ton serveur de test (grâce à
`DISCORD_TEST_GUILD_ID`). Tape `/` dans un salon pour les voir.

## Docker (site + bot ensemble)

En prod, pas de service `bot` séparé : `deploy/Dockerfile` construit une seule image
qui contient le site **et** le bot, lancée via `../run.py`. `deploy/docker-compose.yml`
n'a qu'un service `app`.

```bash
cd deploy
docker compose up -d --build app
docker compose logs -f app
```

Renseigner dans `deploy/.env` (voir `deploy/.env.example`) : `DISCORD_BOT_TOKEN`,
`DISCORD_NOTIFY_CHANNEL_ID` (salon des notifications). **Laisser
`DISCORD_TEST_GUILD_ID` vide en vrai déploiement** : ça synchronise les commandes
globalement sur tous les serveurs où le bot est invité, plutôt que sur un seul serveur
de test. Sans `DISCORD_BOT_TOKEN`, le site démarre quand même, seul (bot et
notifications désactivés, aucune erreur).

## Notes

- `/purge_between` vérifie que les deux messages existent bien dans le salon où la
  commande est lancée — un ID d'un autre salon est rejeté.
- Le bot doit lui-même avoir la permission **Gérer les messages** sur le salon pour que
  `/purge_between` fonctionne ; sinon il le signale clairement plutôt que d'échouer en
  silence.
- `WARNING: Privileged message content intent is missing` dans les logs est normal et
  sans conséquence : discord.py l'affiche par défaut, mais aucune de nos commandes n'a
  besoin de lire le contenu des messages (tout passe par l'API REST et les paramètres
  de commande slash).
- **Bot et site partagent le même process en prod** (`run.py`) : un plantage de l'un
  arrête l'autre. Assumé délibérément pour un outil de campagne à 1-3 joueuses — voir
  `run.py` pour le raisonnement complet.
- Déployé sur `quarantaine-server` (portrait de l'infra commune :
  `../../2026_mutual_server/etat_des_lieux.md`) via la PR `feat/shadowrun-westmarch`.

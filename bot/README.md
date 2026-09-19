# Bot Discord — West March

Bot de modération et d'utilité pour la campagne, séparé du site web (`backend/`) mais
dans le même dépôt et le même environnement Python (`uv`).

## Commandes

- **`/roll <expression>`** — lance des dés au format `XdY` avec modificateur optionnel :
  `2d6`, `1d20+5`, `4d8-2`, `10d10 - 5` (espaces autour du signe tolérés). Limité à
  100 dés et 1000 faces. Utilisable par tout le monde.
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

## Setup

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

## Docker

Le bot est packagé comme un service à part dans `deploy/docker-compose.yml` (même
`.env` que le site, aucun port ni volume nécessaire — le bot n'a aucun état à
persister) :

```bash
cd deploy
docker compose up -d --build bot
docker compose logs -f bot
```

Renseigner `DISCORD_BOT_TOKEN` dans `deploy/.env` (voir `deploy/.env.example`).
**Laisser `DISCORD_TEST_GUILD_ID` vide en vrai déploiement** : ça synchronise les
commandes globalement sur tous les serveurs où le bot est invité, plutôt que sur un
seul serveur de test.

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
- Pas encore déployé sur `quarantaine-server` — usage local / serveur de test pour
  l'instant. Le portrait de l'infra commune (`../../2026_mutual_server/etat_des_lieux.md`)
  documente comment déployer une app conteneurisée le moment venu.

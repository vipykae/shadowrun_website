"""Bot Discord pour la campagne West March — modération (purge) et jets de dés.

Usage :
    uv run python -m bot.main

Variables d'environnement (voir bot/.env.example) :
    DISCORD_BOT_TOKEN      Token du bot (Developer Portal > Bot > Reset Token)
    DISCORD_TEST_GUILD_ID  ID du serveur de test, pour une synchro instantanée des
                            commandes slash (optionnel : sans lui, la synchro est
                            globale et peut prendre jusqu'à 1h à apparaître partout)
"""

from __future__ import annotations

import logging
import os

import discord
from discord.ext import commands
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bot")

EXTENSIONS = ["bot.cogs.purge", "bot.cogs.roll", "bot.cogs.prochaine_run", "bot.cogs.aide"]


class BotCampagne(commands.Bot):
    def __init__(self) -> None:
        # Aucun intent privilégié nécessaire : les commandes slash et la suppression
        # de messages passent par l'API REST, pas par le flux d'événements gateway.
        intents = discord.Intents.default()
        super().__init__(command_prefix="!", intents=intents)

    async def setup_hook(self) -> None:
        for extension in EXTENSIONS:
            await self.load_extension(extension)
            logger.info("Extension chargée : %s", extension)

        guild_id = os.environ.get("DISCORD_TEST_GUILD_ID")
        if guild_id:
            guild = discord.Object(id=int(guild_id))
            self.tree.copy_global_to(guild=guild)
            synced = await self.tree.sync(guild=guild)
            logger.info(
                "Commandes synchronisées sur le serveur de test %s : %s",
                guild_id,
                [c.name for c in synced],
            )
        else:
            synced = await self.tree.sync()
            logger.info(
                "Commandes synchronisées globalement (jusqu'à 1h de propagation) : %s",
                [c.name for c in synced],
            )

    async def on_ready(self) -> None:
        logger.info("Connecté en tant que %s (id=%s)", self.user, self.user.id if self.user else "?")


def main() -> None:
    token = os.environ.get("DISCORD_BOT_TOKEN")
    if not token:
        raise SystemExit(
            "DISCORD_BOT_TOKEN manquant. Copie bot/.env.example vers bot/.env "
            "et renseigne ton token (Discord Developer Portal > Bot)."
        )

    bot = BotCampagne()
    bot.run(token, log_handler=None)  # logging déjà configuré ci-dessus


if __name__ == "__main__":
    main()

"""Message d'accueil envoyé en MP aux nouveaux membres du serveur.

Le texte vit dans content/message_bienvenue.md (comme l'aide : modifiable sur le
serveur sans redéployer). L'événement « membre rejoint » exige l'intent
privilégié « Server Members » : il n'est demandé que si DISCORD_MESSAGE_BIENVENUE=1
(voir bot/main.py), et doit alors être activé dans le Developer Portal
(Bot > Privileged Gateway Intents) — sans quoi Discord refuse la connexion du bot.
"""

from __future__ import annotations

import logging
import os

import discord
from discord import app_commands
from discord.ext import commands

from backend.app import CONTENU

logger = logging.getLogger("bot.bienvenue")

CHEMIN_MESSAGE = CONTENU / "message_bienvenue.md"
TEXTE_PAR_DEFAUT = "Bienvenue sur le serveur ! Tape /help pour découvrir le bot et le site de la campagne."


def texte_bienvenue() -> str:
    if not CHEMIN_MESSAGE.exists():
        return TEXTE_PAR_DEFAUT
    texte = CHEMIN_MESSAGE.read_text(encoding="utf-8").strip()
    return texte or TEXTE_PAR_DEFAUT


def embeds_bienvenue() -> list[discord.Embed]:
    """Le message est découpé en sections (séparées par une ligne « --- ») ;
    une ligne « # Titre » en tête de section devient le titre de son encart."""
    embeds = []
    for section in texte_bienvenue().split("\n---\n"):
        section = section.strip()
        if not section:
            continue
        titre = None
        if section.startswith("# "):
            titre, _, section = section[2:].partition("\n")
        embeds.append(discord.Embed(title=titre[:256] if titre else None,
                                    description=section.strip()[:4096] or None, colour=0x29B6FF))
    return embeds[:10]


class Bienvenue(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @commands.Cog.listener()
    async def on_member_join(self, membre: discord.Member) -> None:
        if membre.bot or os.environ.get("DISCORD_MESSAGE_BIENVENUE") != "1":
            return
        try:
            embeds = embeds_bienvenue()
            # Discord limite un message à 6000 caractères d'encarts au total : un message par encart.
            for embed in embeds:
                await membre.send(embed=embed)
        except discord.Forbidden:
            logger.info("MP de bienvenue impossible pour %s (messages privés fermés).", membre)
        except discord.HTTPException as erreur:
            logger.warning("MP de bienvenue à %s échoué : %s", membre, erreur)

    @app_commands.command(
        name="bienvenue",
        description="Relire le message d'accueil (serveur, bot, site) — visible de toi seule",
    )
    @app_commands.allowed_contexts(guilds=True, dms=True, private_channels=False)
    async def bienvenue(self, interaction: discord.Interaction) -> None:
        embeds = embeds_bienvenue()
        await interaction.response.send_message(embed=embeds[0], ephemeral=True)
        for embed in embeds[1:]:
            await interaction.followup.send(embed=embed, ephemeral=True)


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Bienvenue(bot))

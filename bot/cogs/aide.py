"""Commande /help : mode d'emploi du bot et du site.

Le texte vit dans content/aide_bot.md (pas dans le code) : modifiable directement sur
le serveur (voir scripts/edit_contenu.sh côté site) sans toucher au bot ni redéployer,
pour suivre l'ajout de nouvelles commandes au fil du temps.
"""

from __future__ import annotations

import discord
from discord import app_commands
from discord.ext import commands

from backend.app import CONTENU

CHEMIN_AIDE = CONTENU / "aide_bot.md"
TEXTE_PAR_DEFAUT = "Aide pas encore rédigée — dis-le à la MJ."


def texte_aide() -> str:
    if not CHEMIN_AIDE.exists():
        return TEXTE_PAR_DEFAUT
    texte = CHEMIN_AIDE.read_text(encoding="utf-8").strip()
    return texte[:4096] if texte else TEXTE_PAR_DEFAUT


class Aide(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(
        name="help",
        description="Comment utiliser le bot et le site — réponse visible de toi seule",
    )
    @app_commands.allowed_contexts(guilds=True, dms=True, private_channels=False)
    async def help(self, interaction: discord.Interaction) -> None:
        embed = discord.Embed(title="MissionManager — mode d'emploi", description=texte_aide())
        await interaction.response.send_message(embed=embed, ephemeral=True)


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Aide(bot))

"""Commande /prochaine_run : rappelle la prochaine run à venir, en réponse
éphémère (visible seulement de la personne qui a tapé la commande — pour ne
pas polluer le salon à chaque fois que quelqu'un veut vérifier)."""

from __future__ import annotations

import discord
from discord import app_commands
from discord.ext import commands

from backend.app import contenu, db, inscrites_par_run
from bot.formatage import embed_run


def _est_a_venir(run: dict) -> bool:
    return run.get("statut", "ouverte") in ("ouverte", "complete")


def _cle_tri(run: dict) -> tuple[int, str]:
    # (0, date) pour une date ISO connue et triable, (1, "") sinon — les
    # runs sans date fixée passent après celles qui en ont une.
    brut = run.get("date") or ""
    if len(brut) >= 10 and brut[:4].isdigit() and brut[4] == "-":
        return (0, brut)
    return (1, "")


def prochaine_run_a_venir() -> dict | None:
    a_venir = [r for r in contenu.runs if _est_a_venir(r)]
    if not a_venir:
        return None
    return sorted(a_venir, key=_cle_tri)[0]


class ProchaineRun(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(
        name="prochaine_run",
        description="La prochaine run à venir — réponse visible de toi seule",
    )
    # Utilisable aussi en MP avec le bot (pas seulement dans un salon du
    # serveur) : remplace l'ancien dm_permission=True, désormais exprimé via
    # les contextes d'interaction.
    @app_commands.allowed_contexts(guilds=True, dms=True, private_channels=False)
    async def prochaine_run(self, interaction: discord.Interaction) -> None:
        run = prochaine_run_a_venir()
        if run is None:
            await interaction.response.send_message("Aucune run à venir pour l'instant.", ephemeral=True)
            return

        with db() as con:
            inscrites = inscrites_par_run(con).get(run["id"], [])

        embed = embed_run(run, contenu.nom_district(run.get("district")), inscrites)
        await interaction.response.send_message(embed=embed, ephemeral=True)


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(ProchaineRun(bot))

"""Commande /prochaine_run : rappelle la prochaine run à venir, en réponse
éphémère (visible seulement de la personne qui a tapé la commande — pour ne
pas polluer le salon à chaque fois que quelqu'un veut vérifier)."""

from __future__ import annotations

from datetime import datetime

import discord
from discord import app_commands
from discord.ext import commands

from backend.app import contenu, db, inscrites_par_run

JOURS_FR = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS_FR = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]


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


def texte_date(brut: str | None) -> str:
    if not brut:
        return "à définir"
    if brut.startswith(("http://", "https://")):
        return "sondage en cours (date pas encore fixée)"
    if len(brut) >= 10 and brut[:4].isdigit() and brut[4] == "-":
        try:
            avec_heure = len(brut) > 10
            dt = datetime.fromisoformat(brut if avec_heure else f"{brut}T00:00")
        except ValueError:
            return brut
        texte = f"{JOURS_FR[dt.weekday()]} {dt.day} {MOIS_FR[dt.month - 1]} {dt.year}"
        if avec_heure:
            texte += f" à {dt.hour:02d}h{dt.minute:02d}"
        return texte
    return brut


class ProchaineRun(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(
        name="prochaine_run",
        description="La prochaine run à venir — réponse visible de toi seule",
    )
    async def prochaine_run(self, interaction: discord.Interaction) -> None:
        run = prochaine_run_a_venir()
        if run is None:
            await interaction.response.send_message("Aucune run à venir pour l'instant.", ephemeral=True)
            return

        with db() as con:
            inscrites = inscrites_par_run(con).get(run["id"], [])

        places = run.get("places", 4)
        brief = (run.get("brief") or "")[:4096] or None
        embed = discord.Embed(title=run["titre"][:256], description=brief)
        embed.add_field(name="District", value=contenu.nom_district(run.get("district")), inline=True)
        embed.add_field(name="Date", value=texte_date(run.get("date")), inline=True)
        embed.add_field(name="Places", value=f"{len(inscrites)}/{places}", inline=True)
        if run.get("difficulte"):
            d = run["difficulte"]
            embed.add_field(name="Difficulté", value="●" * d + "○" * (5 - d), inline=True)
        if run.get("duree_estimee"):
            embed.add_field(name="Durée estimée", value=run["duree_estimee"], inline=True)
        if run.get("mj"):
            embed.add_field(name="MJ", value=run["mj"], inline=True)

        await interaction.response.send_message(embed=embed, ephemeral=True)


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(ProchaineRun(bot))

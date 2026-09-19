"""Commande /roll : lance des dés au format `XdY +Z` (ex. 2d6+3, 1d20, 4d8 - 2)."""

from __future__ import annotations

import random
import re

import discord
from discord import app_commands
from discord.ext import commands

# Limites pour éviter les abus (un jet de 10 000 d1000 générerait un embed énorme).
MAX_DES = 100
MAX_FACES = 1000

# `2d6`, `2d6+3`, `2d6 + 3`, `2d6-3`, `1D20` ... espaces optionnels autour du signe.
MOTIF_JET = re.compile(
    r"^\s*(?P<nombre>\d+)\s*[dD]\s*(?P<faces>\d+)\s*"
    r"(?:(?P<signe>[+-])\s*(?P<modificateur>\d+))?\s*$"
)


class ErreurJet(ValueError):
    """Levée quand l'expression fournie ne peut pas être interprétée ou jouée."""


def parse_et_lance(expression: str) -> tuple[list[int], int, int]:
    """Parse une expression `XdY +Z` et lance les dés.

    Retourne (résultats_individuels, modificateur_signé, total).
    Lève ErreurJet si l'expression est invalide ou hors limites.
    """
    correspondance = MOTIF_JET.match(expression)
    if not correspondance:
        raise ErreurJet(
            f"Format non reconnu : `{expression}`. Attendu : `XdY` ou `XdY+Z` "
            "(ex. `2d6`, `1d20+5`, `4d8-2`)."
        )

    nombre = int(correspondance.group("nombre"))
    faces = int(correspondance.group("faces"))
    signe = correspondance.group("signe")
    valeur_modificateur = correspondance.group("modificateur")
    modificateur = int(valeur_modificateur) if valeur_modificateur else 0
    if signe == "-":
        modificateur = -modificateur

    if nombre < 1:
        raise ErreurJet("Il faut lancer au moins un dé.")
    if nombre > MAX_DES:
        raise ErreurJet(f"Trop de dés (max {MAX_DES}).")
    if faces < 2:
        raise ErreurJet("Un dé doit avoir au moins 2 faces.")
    if faces > MAX_FACES:
        raise ErreurJet(f"Trop de faces (max {MAX_FACES}).")

    resultats = [random.randint(1, faces) for _ in range(nombre)]
    total = sum(resultats) + modificateur
    return resultats, modificateur, total


def formate_resultat(expression: str, resultats: list[int], modificateur: int, total: int) -> str:
    detail = " + ".join(str(r) for r in resultats)
    if len(resultats) > 1:
        detail = f"[{detail}]"
    if modificateur:
        signe = "+" if modificateur > 0 else "-"
        detail += f" {signe} {abs(modificateur)}"
    return f"🎲 **{expression}** → {detail} = **{total}**"


class Roll(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="roll", description="Lance des dés (ex. 2d6+3, 1d20, 4d8-2)")
    @app_commands.describe(expression="Format XdY, avec modificateur optionnel : 2d6, 1d20+5, 4d8-2")
    async def roll(self, interaction: discord.Interaction, expression: str) -> None:
        try:
            resultats, modificateur, total = parse_et_lance(expression)
        except ErreurJet as erreur:
            await interaction.response.send_message(f"⚠️ {erreur}", ephemeral=True)
            return

        message = formate_resultat(expression, resultats, modificateur, total)
        await interaction.response.send_message(message)


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Roll(bot))

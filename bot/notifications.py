"""Envoi de notifications Discord par le bot lui-même (remplace l'ancien webhook).

Utilisé par `backend/app.py` (nouvelle run, inscription, run jouée). N'a d'effet que
si `configurer()` a été appelé au démarrage avec un bot connecté et un salon cible —
c'est `run.py` qui le fait pour le lancement combiné site + bot. En mode dev séparé
(`uvicorn` seul, sans bot), les appels sont des no-op silencieux, comme l'était
l'ancien webhook absent.
"""

from __future__ import annotations

import logging

import discord

logger = logging.getLogger("bot.notifications")

_bot: discord.Client | None = None
_channel_id: int | None = None


def configurer(bot: discord.Client, channel_id: int | None) -> None:
    global _bot, _channel_id
    _bot = bot
    _channel_id = channel_id


async def envoyer(message: str, image_url: str | None = None) -> None:
    if _bot is None or _channel_id is None:
        return

    canal = _bot.get_channel(_channel_id)
    if canal is None:
        try:
            canal = await _bot.fetch_channel(_channel_id)
        except discord.HTTPException as erreur:
            logger.warning("Salon Discord %s introuvable : %s", _channel_id, erreur)
            return

    embed = None
    if image_url:
        embed = discord.Embed()
        embed.set_image(url=image_url)

    try:
        await canal.send(content=message[:2000], embed=embed)  # type: ignore[union-attr]
    except discord.HTTPException as erreur:
        logger.warning("Notification Discord échouée : %s", erreur)

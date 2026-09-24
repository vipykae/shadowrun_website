"""Lance ensemble le site (FastAPI/uvicorn) et le bot Discord, dans le même process.

C'est le point d'entrée de prod (voir deploy/Dockerfile). Pour du dev avec rechargement
à chaud du site, garder les deux séparés reste préférable (voir README.md) :
    uv run uvicorn backend.app:app --port 8300 --reload   # terminal 1
    uv run python -m bot.main                              # terminal 2

Ici, les deux tournent dans la même boucle asyncio : si l'un plante, l'autre s'arrête
aussi. Assumé délibérément pour un outil de campagne à 1-3 joueuses (voir CADRAGE.md,
§ « pas d'architecture de scalabilité ») — la contrepartie est que
bot/notifications.py peut appeler directement le bot déjà connecté, sans passer par
un webhook HTTP intermédiaire.

Variables d'environnement : voir deploy/.env.example (site) et bot/.env.example (bot),
plus DISCORD_FORUM_RUNS_ID (salon forum : un post par run) et
DISCORD_FLASH_NEWS_CHANNEL_ID (salon textuel des flash news). Sans DISCORD_BOT_TOKEN,
le bot ne démarre pas et les annonces sont silencieusement désactivées ; le site
continue de fonctionner.
"""

from __future__ import annotations

import asyncio
import logging
import os

import uvicorn
from dotenv import load_dotenv

from backend.app import app as application_web
from bot.main import EXTENSIONS, BotCampagne  # noqa: F401 (EXTENSIONS chargé par setup_hook)
from bot.notifications import configurer as configurer_notifications

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("run")


def _id_depuis_env(nom: str) -> int | None:
    brut = (os.environ.get(nom) or "").strip()
    return int(brut) if brut else None


async def main() -> None:
    token = os.environ.get("DISCORD_BOT_TOKEN")
    forum_id = _id_depuis_env("DISCORD_FORUM_RUNS_ID")
    flash_id = _id_depuis_env("DISCORD_FLASH_NEWS_CHANNEL_ID")

    taches = []

    if token:
        bot = BotCampagne()
        configurer_notifications(bot, forum_id, flash_id)
        taches.append(bot.start(token))
        if not forum_id:
            logger.warning(
                "DISCORD_BOT_TOKEN défini mais DISCORD_FORUM_RUNS_ID absent : "
                "le bot tourne (commandes slash actives) mais les runs ne sont pas "
                "annoncées sur le forum."
            )
        if not flash_id:
            logger.warning("DISCORD_FLASH_NEWS_CHANNEL_ID absent : flash news non publiées.")
        if os.environ.get("DISCORD_NOTIFY_CHANNEL_ID"):
            logger.warning(
                "DISCORD_NOTIFY_CHANNEL_ID n'est plus utilisé : les annonces passent "
                "par le forum (DISCORD_FORUM_RUNS_ID)."
            )
    else:
        logger.warning(
            "DISCORD_BOT_TOKEN absent : bot Discord et notifications désactivés, "
            "le site tourne seul."
        )

    port = int(os.environ.get("PORT", "8000"))
    config = uvicorn.Config(application_web, host="0.0.0.0", port=port, log_level="info")
    serveur = uvicorn.Server(config)
    taches.append(serveur.serve())

    await asyncio.gather(*taches)


if __name__ == "__main__":
    asyncio.run(main())

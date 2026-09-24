"""Mise en forme partagée des runs côté Discord : dates lisibles, liens vers le
site, fiche de run en embed. Utilisé par les annonces (bot/notifications.py) et
par /prochaine_run — pour qu'une run ait la même allure partout.

N'importe rien de backend/ : backend/app.py importe bot/notifications.py, qui
importe ce module ; l'inverse créerait une importation circulaire.
"""

from __future__ import annotations

import os
from datetime import datetime

import discord

JOURS_FR = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS_FR = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]

COULEUR = 0x29B6FF  # le bleu néon des districts sur la carte


def texte_date(brut: str | None) -> str:
    if not brut:
        return "à définir"
    brut = str(brut)
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


def url_site() -> str | None:
    """Adresse publique du site : URL_SITE si définie, sinon https://DOMAINE
    (la variable que Caddy utilise déjà en prod). None en dev sans l'une ni
    l'autre : les annonces restent alors sans lien, plutôt qu'avec un lien faux."""
    url = os.environ.get("URL_SITE")
    if url:
        return url.rstrip("/")
    domaine = os.environ.get("DOMAINE")
    if domaine and domaine != "runs.example.org":
        return f"https://{domaine}"
    return None


def url_run(run_id: str) -> str | None:
    """Lien direct vers la fiche d'une run (le frontend lit l'ancre #run=…
    au chargement, après la connexion si besoin)."""
    base = url_site()
    return f"{base}/#run={run_id}" if base else None


def lien_run(run: dict) -> str:
    """Titre de la run en lien Markdown cliquable (ou en gras sans URL).
    Les chevrons autour de l'URL empêchent Discord d'ajouter un aperçu
    générique du site sous le message."""
    titre = (run.get("titre") or run.get("id") or "?").replace("[", "(").replace("]", ")")
    url = url_run(run["id"])
    return f"**[{titre}](<{url}>)**" if url else f"**{titre}**"


def url_absolue(chemin: str | None, base_secours: str | None = None) -> str | None:
    """Les images d'un embed doivent être une URL absolue : Discord les récupère
    lui-même depuis ses serveurs."""
    if not chemin:
        return None
    if chemin.startswith(("http://", "https://")):
        return chemin
    base = url_site() or (base_secours or "").rstrip("/")
    return f"{base}{chemin}" if base else None


def _couper(texte: str | None, limite: int) -> str | None:
    if not texte:
        return None
    texte = str(texte).strip()
    return texte if len(texte) <= limite else texte[: limite - 1] + "…"


def embed_run(run: dict, nom_district: str, inscrites: list[str], base_secours: str | None = None) -> discord.Embed:
    """La fiche d'une run : description, attributs, image, lien vers le site."""
    embed = discord.Embed(
        title=_couper(run.get("titre"), 256),
        url=url_run(run["id"]),
        description=_couper(run.get("brief"), 4000),
        colour=COULEUR,
    )
    places = run.get("places", 4)
    statut = run.get("statut", "ouverte")
    libelles_statut = {
        "ouverte": "inscriptions ouvertes" if len(inscrites) < places else "équipe complète",
        "complete": "inscriptions fermées",
        "jouee": "run jouée",
        "annulee": "run annulée",
    }

    def champ(nom: str, valeur, inline: bool = True):
        valeur = _couper(valeur, 1024)
        if valeur:
            embed.add_field(name=nom, value=valeur, inline=inline)

    champ("District", nom_district)
    champ("Date", texte_date(run.get("date")))
    champ("Statut", libelles_statut.get(statut, statut))
    champ("MJ", run.get("mj"))
    champ("Type", run.get("type"))
    champ("Durée estimée", run.get("duree_estimee"))
    champ("Fixer", run.get("fixer"))
    champ("Paiement", run.get("paiement"))
    if run.get("difficulte"):
        d = max(1, min(5, int(run["difficulte"])))
        champ("Difficulté", "◆" * d + "◇" * (5 - d))
    champ("Lieu", run.get("lieu"), inline=False)
    champ("Risques", run.get("risques"), inline=False)
    champ("Recommandé", run.get("notes"), inline=False)
    if run.get("autres_personnages_probables"):
        champ("Autres persos probables", ", ".join(run["autres_personnages_probables"]), inline=False)
    if run.get("themes"):
        champ("Thèmes", " · ".join(run["themes"]), inline=False)
    if run.get("avertissements"):
        champ("⚠ Avertissements", " · ".join(run["avertissements"]), inline=False)
    equipe = ", ".join(inscrites) if inscrites else "personne pour l'instant"
    champ(f"Équipe ({len(inscrites)}/{places})", equipe, inline=False)

    image = url_absolue(run.get("image"), base_secours)
    if image:
        embed.set_image(url=image)

    # Discord refuse un embed de plus de 6000 caractères au total : on
    # rogne le brief (le plus long, et lisible en entier sur le site).
    exces = len(embed) - 6000
    if exces > 0 and embed.description:
        embed.description = _couper(embed.description, max(100, len(embed.description) - exces - 10))
    return embed

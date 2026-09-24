"""Annonces Discord des runs, envoyées par le bot lui-même.

Chaque run a son propre post dans un salon **forum** : créé à la publication de
la run (fiche complète en embed, image comprise), puis tenu à jour au fil de sa
vie. Chaque changement (arrivée/départ d'une joueuse, nouvelle date,
modification, annulation) y est signalé par un message, et la fiche du premier
message est rééditée pour refléter l'état courant. Quand la run est jouée, son
compte rendu y est posté, et sa flash news part dans un salon textuel dédié.

L'association run -> post (et -> message de flash news, pour pouvoir le
corriger plutôt que le reposter) est gardée dans la base SQLite du site, table
`fils_discord`. Une run publiée avant la mise en place du forum reçoit son post
au premier changement qui la concerne, tant qu'elle n'est pas déjà jouée.

Utilisé par `backend/app.py`, toujours via BackgroundTasks (une panne Discord ne
doit jamais faire échouer une requête du site). N'a d'effet que si
`configurer()` a été appelé au démarrage avec un bot connecté — c'est `run.py`
qui le fait pour le lancement combiné site + bot. En dev (`uvicorn` seul, sans
bot), tous les appels sont des no-op silencieux.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from pathlib import Path

import discord

from bot.formatage import embed_run, lien_run, texte_date

logger = logging.getLogger("bot.notifications")

_bot: discord.Client | None = None
_forum_id: int | None = None
_flash_id: int | None = None
_chemin_db: Path | None = None

# Un seul envoi à la fois : garde l'ordre des messages dans un post, et évite
# de créer deux posts pour la même run si deux changements arrivent coup sur
# coup avant que le premier post n'existe.
_verrou = asyncio.Lock()


def configurer(bot: discord.Client, forum_id: int | None, flash_id: int | None) -> None:
    global _bot, _forum_id, _flash_id
    _bot, _forum_id, _flash_id = bot, forum_id, flash_id


def initialiser_stockage(chemin_db: Path) -> None:
    global _chemin_db
    _chemin_db = chemin_db
    with sqlite3.connect(chemin_db) as con:
        con.execute(
            """CREATE TABLE IF NOT EXISTS fils_discord (
                 run_id TEXT PRIMARY KEY,
                 fil_id INTEGER,
                 flash_id INTEGER)"""
        )


def _actif() -> bool:
    return _bot is not None and _chemin_db is not None


# ---------- Stockage run -> post / flash news ----------


def _lire(run_id: str) -> tuple[int | None, int | None]:
    with sqlite3.connect(_chemin_db) as con:
        ligne = con.execute("SELECT fil_id, flash_id FROM fils_discord WHERE run_id = ?", (run_id,)).fetchone()
    return ligne if ligne else (None, None)


def _ecrire(run_id: str, colonne: str, valeur: int) -> None:
    assert colonne in ("fil_id", "flash_id")
    with sqlite3.connect(_chemin_db) as con:
        con.execute("INSERT OR IGNORE INTO fils_discord (run_id) VALUES (?)", (run_id,))
        con.execute(f"UPDATE fils_discord SET {colonne} = ? WHERE run_id = ?", (valeur, run_id))


def _oublier(run_id: str) -> None:
    with sqlite3.connect(_chemin_db) as con:
        con.execute("DELETE FROM fils_discord WHERE run_id = ?", (run_id,))


# ---------- Accès Discord ----------


async def _salon(salon_id: int | None):
    if salon_id is None:
        return None
    salon = _bot.get_channel(salon_id)
    if salon is None:
        try:
            salon = await _bot.fetch_channel(salon_id)
        except discord.HTTPException as erreur:
            logger.warning("Salon Discord %s introuvable : %s", salon_id, erreur)
            return None
    return salon


async def _fil(fil_id: int | None) -> discord.Thread | None:
    """Le post d'une run, désarchivé si besoin (Discord archive les posts
    inactifs, et on ne peut plus en éditer les messages dans cet état)."""
    if fil_id is None:
        return None
    try:
        fil = await _bot.fetch_channel(fil_id)
    except discord.NotFound:
        return None  # post supprimé à la main sur Discord
    if not isinstance(fil, discord.Thread):
        return None
    if fil.archived:
        fil = await fil.edit(archived=False)
    return fil


def _nom_fil(run: dict) -> str:
    return (run.get("titre") or run["id"])[:100]


async def _creer_fil(run: dict, nom_district: str, inscrites: list[str], base: str | None):
    forum = await _salon(_forum_id)
    if not isinstance(forum, discord.ForumChannel):
        if forum is not None:
            logger.warning("DISCORD_FORUM_RUNS_ID (%s) ne désigne pas un salon forum.", _forum_id)
        return None
    resultat = await forum.create_thread(
        name=_nom_fil(run),
        content=f"📢 **Nouvelle run publiée** : {lien_run(run)}",
        embed=embed_run(run, nom_district, inscrites, base),
    )
    _ecrire(run["id"], "fil_id", resultat.thread.id)
    return resultat.thread


async def _assurer_fil(run: dict, nom_district: str, inscrites: list[str], base: str | None,
                       creer_si_absent: bool) -> tuple[discord.Thread | None, bool]:
    """(post, vient_d_etre_cree). Un post tout neuf contient déjà l'état
    courant de la run : inutile d'y ajouter un message de changement."""
    fil_id, _ = _lire(run["id"])
    fil = await _fil(fil_id)
    if fil is not None:
        return fil, False
    if not creer_si_absent:
        return None, False
    return await _creer_fil(run, nom_district, inscrites, base), True


async def _rafraichir_fiche(fil: discord.Thread, run: dict, nom_district: str, inscrites: list[str],
                            base: str | None) -> None:
    """Réédite la fiche (premier message du post, dont l'id est celui du post)
    et le titre du post, pour qu'ils reflètent toujours l'état courant."""
    try:
        premier = await fil.fetch_message(fil.id)
        if premier.author == _bot.user:
            await premier.edit(embed=embed_run(run, nom_district, inscrites, base))
    except discord.NotFound:
        pass
    if fil.name != _nom_fil(run):
        await fil.edit(name=_nom_fil(run))


def _morceaux(texte: str, taille: int = 4000) -> list[str]:
    morceaux = []
    while texte:
        if len(texte) <= taille:
            morceaux.append(texte)
            break
        coupe = texte.rfind("\n", 0, taille)
        if coupe < taille // 2:
            coupe = taille
        morceaux.append(texte[:coupe])
        texte = texte[coupe:].lstrip("\n")
    return morceaux


async def _poster_compte_rendu(fil: discord.Thread, run: dict) -> None:
    for i, morceau in enumerate(_morceaux(run["compte_rendu"].strip())):
        embed = discord.Embed(description=morceau, colour=0xB388FF)
        if i == 0:
            embed.title = "📜 Compte rendu"
        await fil.send(embed=embed)


async def _publier_flash(run: dict) -> None:
    """Poste la flash news, ou corrige celle déjà postée pour cette run."""
    salon = await _salon(_flash_id)
    if salon is None:
        return
    texte = "\n".join(f"> {ligne}" for ligne in run["flash_news"].strip().splitlines())
    contenu = f"📰 **FLASH NEWS**\n{texte}\n\n— {lien_run(run)}"[:2000]
    _, flash_id = _lire(run["id"])
    if flash_id:
        try:
            message = await salon.fetch_message(flash_id)
            await message.edit(content=contenu)
            return
        except discord.NotFound:
            pass  # supprimée à la main : on la reposte
    message = await salon.send(contenu)
    _ecrire(run["id"], "flash_id", message.id)


async def _proteger(nom: str, coroutine) -> None:
    """Une panne ou un droit manquant côté Discord ne doit jamais remonter :
    on journalise et on passe."""
    if not _actif():
        coroutine.close()
        return
    async with _verrou:
        try:
            await coroutine
        except discord.HTTPException as erreur:
            logger.warning("Annonce Discord « %s » échouée : %s", nom, erreur)
        except Exception:
            logger.exception("Annonce Discord « %s » : erreur inattendue", nom)


# ---------- API appelée par le site ----------


async def annoncer_nouvelle_run(run: dict, nom_district: str, inscrites: list[str],
                                base: str | None = None) -> None:
    async def _faire():
        await _assurer_fil(run, nom_district, inscrites, base, creer_si_absent=True)

    await _proteger("nouvelle run", _faire())


async def annoncer_equipe(run: dict, nom_district: str, inscrites: list[str], nom: str,
                          arrivee: bool, base: str | None = None) -> None:
    async def _faire():
        fil, cree = await _assurer_fil(run, nom_district, inscrites, base, creer_si_absent=True)
        if fil is None or cree:
            return
        places = run.get("places", 4)
        if arrivee:
            suffixe = " — **équipe complète !**" if len(inscrites) >= places else ""
            texte = f"✅ **{nom}** rejoint l'équipe de {lien_run(run)} ({len(inscrites)}/{places}){suffixe}"
        else:
            texte = f"👋 **{nom}** quitte l'équipe de {lien_run(run)} ({len(inscrites)}/{places})"
        await fil.send(texte)
        await _rafraichir_fiche(fil, run, nom_district, inscrites, base)

    await _proteger("équipe", _faire())


LIBELLES_CHAMPS = {
    "titre": "titre", "district": "district", "position": "emplacement sur la carte", "mj": "MJ",
    "type": "type", "places": "nombre de places", "duree_estimee": "durée", "lieu": "lieu",
    "paiement": "paiement", "difficulte": "difficulté", "risques": "risques", "fixer": "fixer",
    "autres_personnages_probables": "autres persos probables", "themes": "thèmes",
    "avertissements": "avertissements", "notes": "recommandations", "brief": "brief", "image": "image",
}

MESSAGES_STATUT = {
    "annulee": "🚫 **Run annulée.**",
    "complete": "🔒 **Inscriptions fermées.**",
    "ouverte": "🔓 **Inscriptions rouvertes.**",
    "jouee": "🏁 **Run jouée !**",
}


def _norm(valeur):
    if isinstance(valeur, tuple):
        valeur = list(valeur)
    return None if valeur in ("", [], None) else valeur


async def annoncer_modification(ancienne: dict, run: dict, nom_district: str, inscrites: list[str],
                                base: str | None = None) -> None:
    async def _faire():
        avant, apres = ancienne.get("statut", "ouverte"), run.get("statut", "ouverte")
        devient_jouee = apres == "jouee" and avant != "jouee"
        cr, ancien_cr = _norm(run.get("compte_rendu")), _norm(ancienne.get("compte_rendu"))
        cr_nouveau = apres == "jouee" and cr is not None and (devient_jouee or ancien_cr is None)
        cr_modifie = apres == "jouee" and cr is not None and not cr_nouveau and cr != ancien_cr
        flash = _norm(run.get("flash_news"))
        flash_a_publier = apres == "jouee" and flash is not None and (
            devient_jouee or flash != _norm(ancienne.get("flash_news")))

        # Une run déjà jouée avant la mise en place du forum n'a pas de post :
        # on n'en crée pas un a posteriori pour une simple retouche.
        creer = apres in ("ouverte", "complete") or cr_nouveau or devient_jouee
        fil, cree = await _assurer_fil(run, nom_district, inscrites, base, creer_si_absent=creer)

        if fil is not None:
            lignes = []
            if not cree:
                if avant != apres and apres in MESSAGES_STATUT:
                    lignes.append(MESSAGES_STATUT[apres])
                if _norm(ancienne.get("date")) != _norm(run.get("date")):
                    lignes.append(f"📅 **Nouvelle date** : {texte_date(run.get('date'))}")
                modifies = [libelle for cle, libelle in LIBELLES_CHAMPS.items()
                            if _norm(ancienne.get(cle)) != _norm(run.get(cle))]
                if modifies:
                    lignes.append("✏️ **Run modifiée** : " + ", ".join(modifies))
                if cr_modifie:
                    lignes.append("✏️ **Compte rendu mis à jour** (à relire sur le site)")
            if lignes:
                await fil.send("\n".join(lignes) + f"\n→ {lien_run(run)}")
            if cr_nouveau:
                await _poster_compte_rendu(fil, run)
            if not cree:
                await _rafraichir_fiche(fil, run, nom_district, inscrites, base)

        if flash_a_publier:
            await _publier_flash(run)

    await _proteger("modification", _faire())


async def annoncer_suppression(run: dict) -> None:
    async def _faire():
        fil_id, _ = _lire(run["id"])
        fil = await _fil(fil_id)
        if fil is not None:
            await fil.send(f"🗑️ La run **{run.get('titre') or run['id']}** a été retirée du site.")
        _oublier(run["id"])

    await _proteger("suppression", _faire())

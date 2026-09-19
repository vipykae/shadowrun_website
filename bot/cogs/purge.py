"""Commande /purge_between : supprime tous les messages entre deux ID donnés (inclus),
dans le même salon ou fil que celui où la commande est lancée.
"""

from __future__ import annotations

import datetime

import discord
from discord import app_commands
from discord.ext import commands

# L'API Discord ne permet la suppression groupée ("bulk delete") que pour les
# messages de moins de 14 jours. Au-delà, il faut les supprimer un par un.
AGE_LIMITE_SUPPRESSION_GROUPEE = datetime.timedelta(days=14)

# Suppression groupée : 100 messages max par appel (limite de l'API Discord).
TAILLE_LOT_GROUPE = 100


class ErreurPurge(ValueError):
    """Levée quand la commande ne peut pas être exécutée telle quelle."""


def parse_id_message(valeur: str, libelle: str) -> int:
    valeur = valeur.strip()
    if not valeur.isdigit():
        raise ErreurPurge(
            f"« {valeur} » ne ressemble pas à un ID de message valide pour {libelle} "
            "(clic droit sur le message > Copier l'ID — le mode développeur doit être "
            "activé dans Discord)."
        )
    return int(valeur)


class VueConfirmationPurge(discord.ui.View):
    """Boutons Confirmer/Annuler, utilisables uniquement par qui a lancé la commande."""

    def __init__(
        self,
        auteur_id: int,
        canal: discord.abc.Messageable,
        messages: list[discord.Message],
    ) -> None:
        super().__init__(timeout=30)
        self.auteur_id = auteur_id
        self.canal = canal
        self.messages = messages
        self.resultat: bool | None = None

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.auteur_id:
            await interaction.response.send_message(
                "Seule la personne ayant lancé la commande peut confirmer.",
                ephemeral=True,
            )
            return False
        return True

    async def on_timeout(self) -> None:
        for enfant in self.children:
            enfant.disabled = True  # type: ignore[attr-defined]

    @discord.ui.button(label="Confirmer la suppression", style=discord.ButtonStyle.danger)
    async def confirmer(
        self, interaction: discord.Interaction, bouton: discord.ui.Button
    ) -> None:
        self.resultat = True
        for enfant in self.children:
            enfant.disabled = True  # type: ignore[attr-defined]
        await interaction.response.edit_message(
            content="⏳ Suppression en cours...", view=self
        )
        self.stop()

    @discord.ui.button(label="Annuler", style=discord.ButtonStyle.secondary)
    async def annuler(
        self, interaction: discord.Interaction, bouton: discord.ui.Button
    ) -> None:
        self.resultat = False
        for enfant in self.children:
            enfant.disabled = True  # type: ignore[attr-defined]
        await interaction.response.edit_message(content="❌ Suppression annulée.", view=self)
        self.stop()


async def supprime_messages(
    canal: discord.abc.Messageable, messages: list[discord.Message]
) -> tuple[int, int]:
    """Supprime les messages donnés, en groupé quand possible, un par un sinon.

    Retourne (nombre_supprimés_en_groupe, nombre_supprimés_individuellement).
    """
    maintenant = discord.utils.utcnow()
    recents = [
        m for m in messages if maintenant - m.created_at < AGE_LIMITE_SUPPRESSION_GROUPEE
    ]
    anciens = [
        m for m in messages if maintenant - m.created_at >= AGE_LIMITE_SUPPRESSION_GROUPEE
    ]

    nb_groupe = 0
    for debut in range(0, len(recents), TAILLE_LOT_GROUPE):
        lot = recents[debut : debut + TAILLE_LOT_GROUPE]
        await canal.delete_messages(lot)  # type: ignore[attr-defined]
        nb_groupe += len(lot)

    nb_individuel = 0
    for message in anciens:
        await message.delete()
        nb_individuel += 1

    return nb_groupe, nb_individuel


class Purge(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(
        name="purge_between",
        description="Supprime tous les messages entre deux ID donnés (inclus), dans ce salon",
    )
    @app_commands.describe(
        message_id_1="ID du premier message (bornes incluses)",
        message_id_2="ID du second message (bornes incluses, peu importe l'ordre)",
    )
    @app_commands.default_permissions(manage_messages=True)
    @app_commands.checks.has_permissions(manage_messages=True)
    async def purge_between(
        self,
        interaction: discord.Interaction,
        message_id_1: str,
        message_id_2: str,
    ) -> None:
        canal = interaction.channel
        if canal is None or not isinstance(canal, (discord.TextChannel, discord.Thread)):
            await interaction.response.send_message(
                "⚠️ Cette commande ne fonctionne que dans un salon textuel ou un fil.",
                ephemeral=True,
            )
            return

        if interaction.guild is not None:
            moi = interaction.guild.me
            permissions_bot = canal.permissions_for(moi)
            if not permissions_bot.manage_messages:
                await interaction.response.send_message(
                    "⚠️ Je n'ai pas la permission « Gérer les messages » dans ce salon — "
                    "je ne peux rien supprimer ici.",
                    ephemeral=True,
                )
                return

        try:
            id_1 = parse_id_message(message_id_1, "message_id_1")
            id_2 = parse_id_message(message_id_2, "message_id_2")
        except ErreurPurge as erreur:
            await interaction.response.send_message(f"⚠️ {erreur}", ephemeral=True)
            return

        borne_basse, borne_haute = sorted((id_1, id_2))

        await interaction.response.defer(ephemeral=True, thinking=True)

        # Vérifie que les deux messages existent bien dans CE salon.
        for id_message in (borne_basse, borne_haute):
            try:
                await canal.fetch_message(id_message)
            except discord.NotFound:
                await interaction.followup.send(
                    f"⚠️ Message `{id_message}` introuvable dans ce salon. Vérifie que "
                    "les deux ID viennent bien d'ici (et pas d'un autre salon/fil).",
                    ephemeral=True,
                )
                return

        # after/before sont exclusifs : on élargit d'1 de chaque côté pour inclure
        # les deux bornes elles-mêmes dans l'historique.
        messages = [
            message
            async for message in canal.history(
                after=discord.Object(id=borne_basse - 1),
                before=discord.Object(id=borne_haute + 1),
                limit=None,
                oldest_first=True,
            )
        ]

        if not messages:
            await interaction.followup.send(
                "Aucun message trouvé dans cet intervalle (chelou, mais bon).",
                ephemeral=True,
            )
            return

        premier, dernier = messages[0], messages[-1]
        vue = VueConfirmationPurge(interaction.user.id, canal, messages)
        await interaction.followup.send(
            f"⚠️ **{len(messages)} message(s)** vont être supprimés dans {canal.mention}, "
            f"de {premier.jump_url} à {dernier.jump_url}.\n"
            "Cette action est **irréversible**. Confirmer ?",
            view=vue,
            ephemeral=True,
        )

        await vue.wait()

        if not vue.resultat:
            return

        nb_groupe, nb_individuel = await supprime_messages(canal, messages)
        total = nb_groupe + nb_individuel
        detail = ""
        if nb_individuel:
            detail = (
                f" ({nb_groupe} en groupé, {nb_individuel} un par un — "
                "plus de 14 jours, limite de l'API Discord)"
            )
        await interaction.edit_original_response(
            content=f"✅ {total} message(s) supprimé(s){detail}.", view=None
        )


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Purge(bot))

"""Génère les valeurs à mettre dans deploy/.env :
hashs argon2 des mots de passe + clé secrète de session + jeton calendrier.

Usage : python scripts/genere_hash.py
"""

import getpass
import secrets

from argon2 import PasswordHasher

hasher = PasswordHasher()

for nom_var, libelle in (("MDP_JOUEUSE_HASH", "joueuse"), ("MDP_MJ_HASH", "MJ")):
    mdp = getpass.getpass(f"Phrase de passe {libelle} : ")
    if not mdp:
        print(f"(vide, {nom_var} ignoré)")
        continue
    print(f"{nom_var}={hasher.hash(mdp)}")

print(f"CLE_SECRETE={secrets.token_hex(32)}")
print(f"CALENDRIER_TOKEN={secrets.token_hex(24)}")
print("\n(DISCORD_WEBHOOK_URL n'est pas généré : colle l'URL fournie par Discord.)")

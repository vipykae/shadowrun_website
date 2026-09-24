"""API du tableau des runs — V1.

Lancement (dev, depuis la racine du projet) :
    python -m uvicorn backend.app:app --port 8300 --reload

En prod, ce module est servi conjointement avec le bot Discord par `run.py`
(les deux tournent dans le même process) — voir ce fichier pour le détail.

Configuration par variables d'environnement (voir deploy/.env.example) :
    MDP_JOUEUSE_HASH / MDP_MJ_HASH : hashs argon2 (scripts/genere_hash.py)
    CLE_SECRETE                    : signe les cookies de session
    SECURE_COOKIES=1               : cookies Secure (derrière HTTPS)
    CALENDRIER_TOKEN               : jeton d'accès au flux .ics (indépendant du login)
Sans ces variables, l'app démarre en mode dev avec les mots de passe
« joueuse » et « mj » et une clé aléatoire (sessions perdues au redémarrage).
Les notifications Discord passent par le bot (bot/notifications.py) : absentes
si celui-ci n'est pas configuré/lancé (ex. en dev avec uvicorn seul), sans erreur.
Le calendrier est simplement absent si non configuré.
"""

from __future__ import annotations

import hmac
import os
import re
import secrets
import sqlite3
import time
import uuid
from collections import defaultdict, deque
from datetime import date as date_type
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Literal

import yaml
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from dotenv import load_dotenv
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from bot.notifications import envoyer as notifier_discord
from itsdangerous import BadSignature, SignatureExpired, TimestampSigner
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, field_validator

RACINE = Path(__file__).resolve().parent.parent

# En local (uv run uvicorn ...), rien ne lit .env sans ça — seul Docker
# Compose le fait automatiquement (env_file: .env). Ne modifie jamais une
# variable déjà définie dans l'environnement (override=False, le défaut) :
# ce que la vraie prod exporte prime toujours sur le fichier.
load_dotenv(RACINE / ".env")

CONTENU = Path(os.environ.get("DOSSIER_CONTENU", RACINE / "content"))
DONNEES = Path(os.environ.get("DOSSIER_DONNEES", RACINE / "data"))
DB = DONNEES / "app.db"
DOSSIER_UPLOADS = DONNEES / "uploads"  # images téléversées (portraits) — pas dans content/, pas versionné

DUREE_SESSION = 60 * 60 * 24 * 30  # 30 jours
SECURE_COOKIES = os.environ.get("SECURE_COOKIES") == "1"

hasher = PasswordHasher()


def _hash_depuis_env(nom_var: str, defaut: str) -> str:
    h = os.environ.get(nom_var)
    if h:
        return h
    print(f"ATTENTION : {nom_var} non défini — mot de passe de dev « {defaut} »")
    return hasher.hash(defaut)


HASH_JOUEUSE = _hash_depuis_env("MDP_JOUEUSE_HASH", "joueuse")
HASH_MJ = _hash_depuis_env("MDP_MJ_HASH", "mj")

CLE_SECRETE = os.environ.get("CLE_SECRETE")
if not CLE_SECRETE:
    print("ATTENTION : CLE_SECRETE non définie — clé aléatoire (sessions perdues au redémarrage)")
    CLE_SECRETE = secrets.token_hex(32)

signer = TimestampSigner(CLE_SECRETE)

CALENDRIER_TOKEN = os.environ.get("CALENDRIER_TOKEN")


# ---------- Contenu (YAML, édité par la MJ) ----------


class Contenu:
    def __init__(self):
        self.carte: dict = {}
        self.districts: list = []
        self.runs: list = []
        self.pj: list = []
        self.pnj: list = []
        self.fichiers: dict[str, Path] = {}  # id de run -> fichier YAML

    def _charger_liste(self, chemin_relatif: str) -> list:
        chemin = CONTENU / chemin_relatif
        if not chemin.exists():
            return []
        return yaml.safe_load(chemin.read_text(encoding="utf-8")) or []

    def charger(self):
        self.carte = yaml.safe_load((CONTENU / "carte.yaml").read_text(encoding="utf-8"))
        self.districts = yaml.safe_load((CONTENU / "districts.yaml").read_text(encoding="utf-8")) or []
        runs = []
        fichiers = {}
        for fichier in sorted((CONTENU / "runs").glob("*.yaml")):
            if fichier.name.startswith("_"):  # modèle, brouillons
                continue
            run = yaml.safe_load(fichier.read_text(encoding="utf-8"))
            run.setdefault("id", fichier.stem)
            runs.append(run)
            fichiers[run["id"]] = fichier
        self.fichiers = fichiers
        ids = [r["id"] for r in runs]
        doublons = {i for i in ids if ids.count(i) > 1}
        if doublons:
            raise ValueError(f"Ids de runs en doublon : {doublons}")
        districts_connus = {d["id"] for d in self.districts}
        for r in runs:
            if r.get("district") not in districts_connus:
                print(f"ATTENTION : la run {r['id']!r} référence un district inconnu : {r.get('district')!r}")
        self.runs = runs
        self.pj = self._charger_liste("personnages/pj.yaml")
        self.pnj = self._charger_liste("personnages/pnj.yaml")

    def nom_district(self, district_id: str | None) -> str:
        d = next((d for d in self.districts if d["id"] == district_id), None)
        return d["nom"] if d else (district_id or "district inconnu")


contenu = Contenu()
contenu.charger()


# ---------- Notification Discord ----------
# `notifier_discord` est importée depuis bot/notifications.py (voir les imports en
# tête de fichier) : elle envoie directement via le bot connecté, plutôt que par un
# webhook HTTP. No-op silencieux si le bot n'est pas configuré (ex. dev avec uvicorn
# seul) ; une panne Discord ne doit jamais faire échouer une requête de l'API, donc
# toujours invoquée via BackgroundTasks après la réponse.


# ---------- Écriture YAML lisible (interface MJ) ----------

ORDRE_RUN = [
    "id", "titre", "district", "position", "mj", "type", "places", "statut",
    "date", "duree_estimee", "lieu", "paiement", "difficulte", "risques",
    "fixer", "autres_personnages_probables",
    "themes", "avertissements", "notes", "brief", "image", "compte_rendu",
]
ORDRE_DISTRICT = [
    "id", "nom",
    "gang_dominant", "gangs_presents",
    "megacorp_dominante", "megacorps_presentes",
    "autre_faction_dominante", "autres_factions_presentes",
    "description", "fiche", "runs_jouees", "polygone",
]
ENTETE_DISTRICTS = (
    "# Généré par scripts/labelme_vers_districts.py — les champs autres que\n"
    "# 'polygone' sont éditables à la main et préservés à la régénération.\n"
)

ORDRE_PJ = ["id", "nom", "joueuse", "archetype", "tags", "concept", "notes", "image"]
ORDRE_PNJ = ["id", "nom", "faction", "district", "archetype", "tags", "concept", "notes", "image"]
ENTETE_PJ = "# Personnages joueuses — modifiable par n'importe qui de connecté (joueuse ou MJ).\n"
ENTETE_PNJ = "# PNJ notables — modifiable uniquement par la MJ.\n"


class DumperLisible(yaml.SafeDumper):
    """Textes longs en bloc littéral, petites listes sur une ligne."""


def _representer_str(dumper, valeur):
    style = "|" if ("\n" in valeur or len(valeur) > 70) else None
    return dumper.represent_scalar("tag:yaml.org,2002:str", valeur, style=style)


def _representer_liste(dumper, valeur):
    courte = all(isinstance(v, (int, float, str)) for v in valeur) and len(str(valeur)) < 60
    return dumper.represent_sequence("tag:yaml.org,2002:seq", valeur, flow_style=courte)


DumperLisible.add_representer(str, _representer_str)
DumperLisible.add_representer(list, _representer_liste)


def dump_yaml(donnees) -> str:
    return yaml.dump(donnees, Dumper=DumperLisible, allow_unicode=True, sort_keys=False, width=100)


def ordonner(donnees: dict, ordre: list[str]) -> dict:
    return {**{k: donnees[k] for k in ordre if k in donnees},
            **{k: v for k, v in donnees.items() if k not in ordre}}


def _sauver_personnages(type_: str, liste: list[dict], ordre: list[str], entete: str):
    dossier = CONTENU / "personnages"
    dossier.mkdir(exist_ok=True)
    (dossier / f"{type_}.yaml").write_text(
        entete + dump_yaml([ordonner(p, ordre) for p in liste]), encoding="utf-8"
    )


# ---------- Base (inscriptions) ----------


def initialiser_db():
    DONNEES.mkdir(exist_ok=True)
    with sqlite3.connect(DB) as con:
        con.execute("PRAGMA journal_mode=WAL")
        con.execute(
            """CREATE TABLE IF NOT EXISTS inscriptions (
                 id INTEGER PRIMARY KEY,
                 run_id TEXT NOT NULL,
                 nom TEXT NOT NULL,
                 cree_le TEXT NOT NULL DEFAULT (datetime('now')),
                 UNIQUE (run_id, nom))"""
        )


initialiser_db()


def db() -> sqlite3.Connection:
    return sqlite3.connect(DB)


def inscrites_par_run(con: sqlite3.Connection) -> dict[str, list[str]]:
    resultat: dict[str, list[str]] = defaultdict(list)
    for run_id, nom in con.execute("SELECT run_id, nom FROM inscriptions ORDER BY id"):
        resultat[run_id].append(nom)
    return resultat


# ---------- Limitation du brute-force sur le login ----------

MAX_ESSAIS, FENETRE_S = 5, 60.0
_essais: dict[str, deque] = defaultdict(deque)


def ip_cliente(request: Request) -> str:
    # Derrière Caddy, l'IP réelle est dans X-Forwarded-For.
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "?"


def verifier_limite(ip: str):
    file = _essais[ip]
    maintenant = time.monotonic()
    while file and maintenant - file[0] > FENETRE_S:
        file.popleft()
    if len(file) >= MAX_ESSAIS:
        raise HTTPException(429, "Trop de tentatives — réessaie dans une minute.")
    file.append(maintenant)


# ---------- Sessions ----------


def role_courant(request: Request) -> str:
    jeton = request.cookies.get("session")
    if not jeton:
        raise HTTPException(401, "Non connectée")
    try:
        role = signer.unsign(jeton, max_age=DUREE_SESSION).decode()
    except (BadSignature, SignatureExpired):
        raise HTTPException(401, "Session invalide ou expirée")
    if role not in ("joueuse", "mj"):
        raise HTTPException(401, "Session invalide")
    return role


def role_mj(role: str = Depends(role_courant)) -> str:
    if role != "mj":
        raise HTTPException(403, "Accès MJ requis")
    return role


# ---------- API ----------

app = FastAPI(title="Seattle // 2080", docs_url=None, redoc_url=None, openapi_url=None)


class Identifiants(BaseModel):
    mdp: str = Field(min_length=1, max_length=200)


class Joueuse(BaseModel):
    nom: str = Field(min_length=1, max_length=30)


@app.post("/api/login")
def login(ident: Identifiants, request: Request, response: Response):
    verifier_limite(ip_cliente(request))
    role = None
    for candidat, h in (("mj", HASH_MJ), ("joueuse", HASH_JOUEUSE)):
        try:
            hasher.verify(h, ident.mdp)
            role = candidat
            break
        except VerifyMismatchError:
            continue
    if role is None:
        raise HTTPException(401, "Mot de passe incorrect")
    jeton = signer.sign(role.encode()).decode()
    response.set_cookie(
        "session", jeton,
        max_age=DUREE_SESSION, httponly=True, samesite="lax", secure=SECURE_COOKIES,
    )
    return {"role": role}


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie("session")
    return {"ok": True}


@app.get("/api/session")
def session(role: str = Depends(role_courant)):
    return {"role": role}


@app.get("/api/carte")
def carte(role: str = Depends(role_courant)):
    with db() as con:
        inscriptions = inscrites_par_run(con)
    runs = []
    for r in contenu.runs:
        r = dict(r)
        r["inscrites"] = inscriptions.get(r["id"], [])
        runs.append(r)
    carte = {k: v for k, v in contenu.carte.items() if k not in ("image", "image_underground")}
    carte["a_carte_underground"] = bool(
        contenu.carte.get("image_underground")
        and (CONTENU / "carte" / contenu.carte["image_underground"]).exists()
    )
    return {"role": role, "carte": carte, "districts": contenu.districts, "runs": runs}


@app.get("/api/carte/image")
def image_carte(role: str = Depends(role_courant)):
    return FileResponse(CONTENU / "carte" / contenu.carte["image"])


@app.get("/api/carte/image-underground")
def image_carte_underground(role: str = Depends(role_courant)):
    # Retombe sur la carte de surface tant que la carte souterraine n'est
    # pas fournie, pour que le mode "sous-sol" reste testable sans elle.
    nom = contenu.carte.get("image_underground")
    chemin = CONTENU / "carte" / nom if nom else None
    if not chemin or not chemin.exists():
        chemin = CONTENU / "carte" / contenu.carte["image"]
    return FileResponse(chemin)


def _run_ou_404(run_id: str) -> dict:
    for r in contenu.runs:
        if r["id"] == run_id:
            return r
    raise HTTPException(404, "Run inconnue")


def _liste_inscrites(con: sqlite3.Connection, run_id: str) -> list[str]:
    return [nom for (nom,) in con.execute(
        "SELECT nom FROM inscriptions WHERE run_id = ? ORDER BY id", (run_id,))]


@app.post("/api/runs/{run_id}/inscription")
def inscription(run_id: str, joueuse: Joueuse, arriere_plan: BackgroundTasks, role: str = Depends(role_courant)):
    run = _run_ou_404(run_id)
    nom = joueuse.nom.strip()
    if not nom:
        raise HTTPException(422, "Nom vide")
    if run.get("statut", "ouverte") != "ouverte":
        raise HTTPException(409, "Cette run n'est pas ouverte aux inscriptions.")
    with db() as con:
        avant = _liste_inscrites(con, run_id)
        if nom not in avant and len(avant) >= run.get("places", 4):
            raise HTTPException(409, "L'équipe est déjà complète.")
        con.execute("INSERT OR IGNORE INTO inscriptions (run_id, nom) VALUES (?, ?)", (run_id, nom))
        apres = _liste_inscrites(con, run_id)
    if nom not in avant:
        places = run.get("places", 4)
        suffixe = " — équipe complète !" if len(apres) >= places else f" ({len(apres)}/{places})"
        arriere_plan.add_task(notifier_discord, f"✅ **{nom}** s'inscrit à *{run['titre']}*{suffixe}")
    return {"inscrites": apres}


@app.post("/api/runs/{run_id}/desinscription")
def desinscription(run_id: str, joueuse: Joueuse, role: str = Depends(role_courant)):
    _run_ou_404(run_id)
    with db() as con:
        con.execute("DELETE FROM inscriptions WHERE run_id = ? AND nom = ?",
                    (run_id, joueuse.nom.strip()))
        return {"inscrites": _liste_inscrites(con, run_id)}


@app.post("/api/reload")
def recharger(role: str = Depends(role_mj)):
    contenu.charger()
    return {
        "districts": len(contenu.districts), "runs": len(contenu.runs),
        "pj": len(contenu.pj), "pnj": len(contenu.pnj),
    }


# ---------- Interface MJ : écriture des YAML ----------


def _vide_vers_none(valeur):
    if isinstance(valeur, str):
        valeur = valeur.strip()
        return valeur or None
    return valeur


class RunEntree(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,60}$")
    titre: str = Field(min_length=1, max_length=120)
    district: str
    position: tuple[int, int]
    mj: str | None = Field(None, max_length=60)
    type: str | None = Field(None, max_length=60)
    places: int = Field(4, ge=1, le=12)
    statut: Literal["ouverte", "complete", "jouee", "annulee"] = "ouverte"
    date: str | None = Field(None, max_length=300)
    duree_estimee: str | None = Field(None, max_length=40)
    lieu: str | None = Field(None, max_length=300)
    paiement: str | None = Field(None, max_length=300)
    difficulte: int = Field(3, ge=1, le=5)
    risques: str | None = Field(None, max_length=5000)
    themes: list[str] = []
    avertissements: list[str] = []
    notes: str | None = Field(None, max_length=5000)
    brief: str | None = Field(None, max_length=10000)
    image: str | None = Field(None, max_length=500)
    compte_rendu: str | None = Field(None, max_length=20000)
    # Nom du fixer et des autres persos probables : texte libre, mais rendu
    # cliquable côté frontend quand ça correspond au nom d'un PJ/PNJ existant
    # (comme les inscrites) — pas de référence d'id stockée, juste le nom.
    fixer: str | None = Field(None, max_length=200)
    autres_personnages_probables: list[str] = []

    @field_validator("mj", "type", "date", "duree_estimee", "lieu", "paiement", "risques",
                     "notes", "brief", "image", "compte_rendu", "titre", "fixer", mode="before")
    @classmethod
    def _nettoyer(cls, v):
        return _vide_vers_none(v)

    @field_validator("themes", "avertissements", "autres_personnages_probables", mode="before")
    @classmethod
    def _nettoyer_liste(cls, v):
        return [s.strip()[:60] for s in (v or []) if isinstance(s, str) and s.strip()]

    def verifier(self):
        if self.district not in {d["id"] for d in contenu.districts}:
            raise HTTPException(422, f"District inconnu : {self.district}")
        x, y = self.position
        if not (0 <= x <= contenu.carte["largeur"] and 0 <= y <= contenu.carte["hauteur"]):
            raise HTTPException(422, "Position hors de la carte")

    def vers_yaml(self) -> dict:
        donnees = self.model_dump()
        donnees["position"] = list(self.position)
        return ordonner(donnees, ORDRE_RUN)


class FicheDistrict(BaseModel):
    population: str | None = Field(None, max_length=300)
    indice_surete: str | None = Field(None, max_length=20)
    ambiance: str | None = Field(None, max_length=2000)
    a_voir: str | None = Field(None, max_length=2000)
    lieux_sensibles: str | None = Field(None, max_length=2000)
    faire_attention_a: str | None = Field(None, max_length=2000)

    @field_validator(
        "population", "indice_surete", "ambiance", "a_voir", "lieux_sensibles", "faire_attention_a",
        mode="before",
    )
    @classmethod
    def _nettoyer(cls, v):
        return _vide_vers_none(v)


class DistrictEntree(BaseModel):
    nom: str = Field(min_length=1, max_length=80)
    gang_dominant: str | None = Field(None, max_length=120)
    gangs_presents: list[str] = []
    megacorp_dominante: str | None = Field(None, max_length=120)
    megacorps_presentes: list[str] = []
    autre_faction_dominante: str | None = Field(None, max_length=120)
    autres_factions_presentes: list[str] = []
    description: str | None = Field(None, max_length=5000)
    fiche: FicheDistrict | None = None
    runs_jouees: list[str] = []

    @field_validator("gang_dominant", "megacorp_dominante", "autre_faction_dominante", "description", "nom", mode="before")
    @classmethod
    def _nettoyer(cls, v):
        return _vide_vers_none(v)

    @field_validator("gangs_presents", "megacorps_presentes", "autres_factions_presentes", "runs_jouees", mode="before")
    @classmethod
    def _nettoyer_liste(cls, v):
        return [s.strip()[:120] for s in (v or []) if isinstance(s, str) and s.strip()]


def _run_avec_inscrites(run_id: str) -> dict:
    run = dict(_run_ou_404(run_id))
    with db() as con:
        run["inscrites"] = _liste_inscrites(con, run_id)
    return run


def _url_absolue(request: Request, chemin: str | None) -> str | None:
    """Les images doivent être une URL absolue pour Discord, qui les
    récupère lui-même depuis ses propres serveurs (pas relatif à une page)."""
    if not chemin:
        return None
    if chemin.startswith("http://") or chemin.startswith("https://"):
        return chemin
    return f"{str(request.base_url).rstrip('/')}{chemin}"


@app.post("/api/mj/runs", status_code=201)
def creer_run(entree: RunEntree, request: Request, arriere_plan: BackgroundTasks, role: str = Depends(role_mj)):
    entree.verifier()
    if entree.id in contenu.fichiers:
        raise HTTPException(409, f"Une run avec l'id « {entree.id} » existe déjà.")
    prefixe = (entree.date or "")[:10] if (entree.date or "")[:4].isdigit() else date_type.today().isoformat()
    chemin = CONTENU / "runs" / f"{prefixe}_{entree.id}.yaml"
    if chemin.exists():
        chemin = CONTENU / "runs" / f"{entree.id}.yaml"
    chemin.write_text(dump_yaml(entree.vers_yaml()), encoding="utf-8")
    contenu.charger()
    arriere_plan.add_task(
        notifier_discord,
        f"📢 **Nouvelle run publiée** : *{entree.titre}* — "
        f"{contenu.nom_district(entree.district)} · {entree.date or 'date à définir'}",
        _url_absolue(request, entree.image),
    )
    return _run_avec_inscrites(entree.id)


@app.put("/api/mj/runs/{run_id}")
def modifier_run(run_id: str, entree: RunEntree, arriere_plan: BackgroundTasks, role: str = Depends(role_mj)):
    chemin = contenu.fichiers.get(run_id)
    if chemin is None:
        raise HTTPException(404, "Run inconnue")
    if entree.id != run_id:
        raise HTTPException(422, "L'id d'une run ne se modifie pas.")
    entree.verifier()
    ancienne = _run_ou_404(run_id)
    ancien_statut, ancienne_image = ancienne.get("statut"), ancienne.get("image")
    chemin.write_text(dump_yaml(entree.vers_yaml()), encoding="utf-8")
    contenu.charger()
    if ancienne_image != entree.image:
        _supprimer_upload_si_interne(ancienne_image)
    if ancien_statut != "jouee" and entree.statut == "jouee":
        arriere_plan.add_task(
            notifier_discord, f"📜 **Run jouée** : *{entree.titre}* — compte-rendu disponible sur le site"
        )
    return _run_avec_inscrites(run_id)


@app.delete("/api/mj/runs/{run_id}")
def supprimer_run(run_id: str, role: str = Depends(role_mj)):
    chemin = contenu.fichiers.get(run_id)
    if chemin is None:
        raise HTTPException(404, "Run inconnue")
    ancienne_image = _run_ou_404(run_id).get("image")
    chemin.unlink()
    with db() as con:
        con.execute("DELETE FROM inscriptions WHERE run_id = ?", (run_id,))
    contenu.charger()
    _supprimer_upload_si_interne(ancienne_image)
    return {"ok": True}


@app.put("/api/mj/districts/{district_id}")
def modifier_district(district_id: str, entree: DistrictEntree, role: str = Depends(role_mj)):
    districts = [dict(d) for d in contenu.districts]
    cible = next((d for d in districts if d["id"] == district_id), None)
    if cible is None:
        raise HTTPException(404, "District inconnu")
    cible.update(entree.model_dump())
    (CONTENU / "districts.yaml").write_text(
        ENTETE_DISTRICTS + dump_yaml([ordonner(d, ORDRE_DISTRICT) for d in districts]),
        encoding="utf-8",
    )
    contenu.charger()
    return next(d for d in contenu.districts if d["id"] == district_id)


# ---------- Téléversement d'images (portraits) ----------
# Compression systématique côté serveur : quelle que soit la photo envoyée,
# on ne garde jamais qu'un JPEG raisonnable. Stocké dans data/ (comme la
# base SQLite) et non dans content/ : ce n'est pas du contenu d'auteure à
# versionner, mais un fichier binaire dépendant de la base de données
# d'inscriptions au même titre que le reste de data/.

NOM_UPLOAD_RE = re.compile(r"^[a-f0-9]{32}\.jpg$")
TAILLE_MAX_UPLOAD = 8 * 1024 * 1024  # 8 Mo, avant compression
DIMENSION_MAX_UPLOAD = 800  # px, plus long côté après redimensionnement


def _chemin_upload(nom: str) -> Path:
    return DOSSIER_UPLOADS / nom


def _supprimer_upload_si_interne(url: str | None):
    """Efface le fichier d'une ancienne image, seulement si c'est bien un de
    nos uploads (jamais une URL externe qu'on ne possède pas)."""
    if url and url.startswith("/api/uploads/") and NOM_UPLOAD_RE.match(url.rsplit("/", 1)[-1]):
        _chemin_upload(url.rsplit("/", 1)[-1]).unlink(missing_ok=True)


@app.post("/api/uploads/image")
async def televerser_image(fichier: UploadFile = File(...), role: str = Depends(role_courant)):
    brut = await fichier.read(TAILLE_MAX_UPLOAD + 1)
    if len(brut) > TAILLE_MAX_UPLOAD:
        raise HTTPException(413, "Image trop lourde (8 Mo maximum).")
    try:
        Image.open(BytesIO(brut)).verify()
        image = Image.open(BytesIO(brut))  # verify() épuise le flux : on rouvre pour l'utiliser
    except Image.DecompressionBombError:
        raise HTTPException(422, "Image refusée (dimensions déraisonnables).")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(422, "Fichier non reconnu comme une image.")

    image = image.convert("RGB")
    image.thumbnail((DIMENSION_MAX_UPLOAD, DIMENSION_MAX_UPLOAD), Image.LANCZOS)
    DOSSIER_UPLOADS.mkdir(parents=True, exist_ok=True)
    nom = f"{uuid.uuid4().hex}.jpg"
    image.save(_chemin_upload(nom), "JPEG", quality=82, optimize=True)
    return {"url": f"/api/uploads/{nom}"}


@app.delete("/api/uploads/{nom}")
def supprimer_upload(nom: str, role: str = Depends(role_courant)):
    # Utilisé par le frontend pour nettoyer un envoi qui vient d'être
    # remplacé ou abandonné avant même d'avoir été rattaché à un personnage.
    if NOM_UPLOAD_RE.match(nom):
        _chemin_upload(nom).unlink(missing_ok=True)
    return {"ok": True}


@app.get("/api/uploads/{nom}")
def upload_image(nom: str):
    # Volontairement public (pas de Depends(role_courant)), contrairement au
    # reste de l'API : Discord doit pouvoir charger l'image lui-même pour
    # l'aperçu du message publié, sans jamais avoir de cookie de session.
    # Le nom du fichier est un uuid4 aléatoire — impossible à deviner — donc
    # ça ne révèle jamais que l'existence d'une image déjà connue de qui la
    # partage. Aucune autre route de l'API n'a cette exception.
    if not NOM_UPLOAD_RE.match(nom) or not _chemin_upload(nom).exists():
        raise HTTPException(404)
    return FileResponse(_chemin_upload(nom))


# ---------- Personnages : PJ (tout le monde) et PNJ (MJ uniquement) ----------


class PersonnageEntree(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,60}$")
    nom: str = Field(min_length=1, max_length=80)
    archetype: str | None = Field(None, max_length=80)
    tags: list[str] = []
    concept: str | None = Field(None, max_length=20000)
    notes: str | None = Field(None, max_length=20000)
    image: str | None = Field(None, max_length=500)

    @field_validator("nom", "archetype", "concept", "notes", "image", mode="before")
    @classmethod
    def _nettoyer(cls, v):
        return _vide_vers_none(v)

    @field_validator("tags", mode="before")
    @classmethod
    def _nettoyer_tags(cls, v):
        return [s.strip()[:60] for s in (v or []) if isinstance(s, str) and s.strip()]


class PJEntree(PersonnageEntree):
    joueuse: str | None = Field(None, max_length=60)

    @field_validator("joueuse", mode="before")
    @classmethod
    def _nettoyer_joueuse(cls, v):
        return _vide_vers_none(v)


class PNJEntree(PersonnageEntree):
    faction: str | None = Field(None, max_length=120)
    district: str | None = None

    @field_validator("faction", mode="before")
    @classmethod
    def _nettoyer_faction(cls, v):
        return _vide_vers_none(v)

    @field_validator("district", mode="before")
    @classmethod
    def _nettoyer_district(cls, v):
        return _vide_vers_none(v)


@app.get("/api/personnages")
def personnages(role: str = Depends(role_courant)):
    return {"pj": contenu.pj, "pnj": contenu.pnj}


def _personnage_ou_404(liste: list[dict], perso_id: str) -> dict:
    p = next((p for p in liste if p["id"] == perso_id), None)
    if p is None:
        raise HTTPException(404, "Personnage inconnu")
    return p


@app.post("/api/personnages/pj", status_code=201)
def creer_pj(entree: PJEntree, role: str = Depends(role_courant)):
    if any(p["id"] == entree.id for p in contenu.pj):
        raise HTTPException(409, f"Un PJ avec l'id « {entree.id} » existe déjà.")
    liste = [*[dict(p) for p in contenu.pj], entree.model_dump()]
    _sauver_personnages("pj", liste, ORDRE_PJ, ENTETE_PJ)
    contenu.charger()
    return _personnage_ou_404(contenu.pj, entree.id)


@app.put("/api/personnages/pj/{pj_id}")
def modifier_pj(pj_id: str, entree: PJEntree, role: str = Depends(role_courant)):
    if entree.id != pj_id:
        raise HTTPException(422, "L'id d'un personnage ne se modifie pas.")
    liste = [dict(p) for p in contenu.pj]
    idx = next((i for i, p in enumerate(liste) if p["id"] == pj_id), None)
    if idx is None:
        raise HTTPException(404, "PJ inconnu")
    ancienne_image = liste[idx].get("image")
    liste[idx] = entree.model_dump()
    _sauver_personnages("pj", liste, ORDRE_PJ, ENTETE_PJ)
    contenu.charger()
    if ancienne_image != entree.image:
        _supprimer_upload_si_interne(ancienne_image)
    return _personnage_ou_404(contenu.pj, pj_id)


@app.delete("/api/personnages/pj/{pj_id}")
def supprimer_pj(pj_id: str, role: str = Depends(role_courant)):
    cible = next((p for p in contenu.pj if p["id"] == pj_id), None)
    if cible is None:
        raise HTTPException(404, "PJ inconnu")
    _sauver_personnages("pj", [dict(p) for p in contenu.pj if p["id"] != pj_id], ORDRE_PJ, ENTETE_PJ)
    contenu.charger()
    _supprimer_upload_si_interne(cible.get("image"))
    return {"ok": True}


def _verifier_district_optionnel(district_id: str | None):
    if district_id and district_id not in {d["id"] for d in contenu.districts}:
        raise HTTPException(422, f"District inconnu : {district_id}")


@app.post("/api/personnages/pnj", status_code=201)
def creer_pnj(entree: PNJEntree, role: str = Depends(role_mj)):
    _verifier_district_optionnel(entree.district)
    if any(p["id"] == entree.id for p in contenu.pnj):
        raise HTTPException(409, f"Un PNJ avec l'id « {entree.id} » existe déjà.")
    liste = [*[dict(p) for p in contenu.pnj], entree.model_dump()]
    _sauver_personnages("pnj", liste, ORDRE_PNJ, ENTETE_PNJ)
    contenu.charger()
    return _personnage_ou_404(contenu.pnj, entree.id)


@app.put("/api/personnages/pnj/{pnj_id}")
def modifier_pnj(pnj_id: str, entree: PNJEntree, role: str = Depends(role_mj)):
    if entree.id != pnj_id:
        raise HTTPException(422, "L'id d'un personnage ne se modifie pas.")
    _verifier_district_optionnel(entree.district)
    liste = [dict(p) for p in contenu.pnj]
    idx = next((i for i, p in enumerate(liste) if p["id"] == pnj_id), None)
    if idx is None:
        raise HTTPException(404, "PNJ inconnu")
    ancienne_image = liste[idx].get("image")
    liste[idx] = entree.model_dump()
    _sauver_personnages("pnj", liste, ORDRE_PNJ, ENTETE_PNJ)
    contenu.charger()
    if ancienne_image != entree.image:
        _supprimer_upload_si_interne(ancienne_image)
    return _personnage_ou_404(contenu.pnj, pnj_id)


@app.delete("/api/personnages/pnj/{pnj_id}")
def supprimer_pnj(pnj_id: str, role: str = Depends(role_mj)):
    cible = next((p for p in contenu.pnj if p["id"] == pnj_id), None)
    if cible is None:
        raise HTTPException(404, "PNJ inconnu")
    _sauver_personnages("pnj", [dict(p) for p in contenu.pnj if p["id"] != pnj_id], ORDRE_PNJ, ENTETE_PNJ)
    contenu.charger()
    _supprimer_upload_si_interne(cible.get("image"))
    return {"ok": True}


# ---------- Export calendrier (.ics) ----------
# Les applis calendrier (Google/Apple/Outlook) interrogent périodiquement
# une URL sans jamais se connecter comme une joueuse : cet unique endpoint
# est donc protégé par un jeton dédié (?cle=...), indépendant du login,
# plutôt que par le cookie de session.


def _date_run_ics(valeur) -> datetime | None:
    """Ne renvoie une date que si `date` est une date fixe (pas un lien de
    sondage ni un texte libre) — cohérent avec infoDate() côté frontend."""
    if not valeur:
        return None
    s = str(valeur)
    if not re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return None
    try:
        return datetime.fromisoformat(s if len(s) > 10 else f"{s}T20:00:00")
    except ValueError:
        return None


def _duree_minutes(texte) -> int | None:
    if not texte:
        return None
    m = re.match(r"^(\d+)\s*h\s*(\d+)?", str(texte).strip(), re.IGNORECASE)
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2) or 0)


def _echapper_ics(texte: str) -> str:
    return (texte or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


# Les dates des runs sont saisies à l'heure de Paris : sans TZID, les clients
# calendrier les liraient dans leur fuseau local. Bloc statique (règles UE)
# pour ne pas dépendre de tzdata dans l'image.
VTIMEZONE_PARIS = [
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Paris",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
]


@app.get("/api/calendrier/url")
def calendrier_url(request: Request, role: str = Depends(role_courant)):
    if not CALENDRIER_TOKEN:
        raise HTTPException(503, "Calendrier non configuré (CALENDRIER_TOKEN absent côté serveur).")
    base = str(request.base_url).rstrip("/")
    return {"url": f"{base}/api/calendrier.ics?cle={CALENDRIER_TOKEN}"}


@app.get("/api/calendrier.ics")
def calendrier_ics(cle: str = ""):
    if not CALENDRIER_TOKEN or not hmac.compare_digest(cle, CALENDRIER_TOKEN):
        raise HTTPException(404)  # pas 401 : ne pas laisser deviner que l'endpoint existe
    lignes = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Seattle2080//FR", "CALSCALE:GREGORIAN",
              "X-WR-TIMEZONE:Europe/Paris", *VTIMEZONE_PARIS]
    for run in contenu.runs:
        if run.get("statut") == "annulee":
            continue
        debut = _date_run_ics(run.get("date"))
        if debut is None:
            continue
        fin = debut + timedelta(minutes=_duree_minutes(run.get("duree_estimee")) or 180)
        lignes += [
            "BEGIN:VEVENT",
            f"UID:{run['id']}@seattle2080",
            f"DTSTAMP:{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}",
            f"DTSTART;TZID=Europe/Paris:{debut.strftime('%Y%m%dT%H%M%S')}",
            f"DTEND;TZID=Europe/Paris:{fin.strftime('%Y%m%dT%H%M%S')}",
            f"SUMMARY:{_echapper_ics(run['titre'])}",
            f"LOCATION:{_echapper_ics(run.get('lieu') or contenu.nom_district(run.get('district')))}",
            f"DESCRIPTION:{_echapper_ics(run.get('brief') or '')}",
            "END:VEVENT",
        ]
    lignes.append("END:VCALENDAR")
    return Response(content="\r\n".join(lignes) + "\r\n", media_type="text/calendar; charset=utf-8")


def _lire_version() -> str:
    import tomllib
    try:
        with open(RACINE / "pyproject.toml", "rb") as f:
            return tomllib.load(f)["project"]["version"]
    except (OSError, KeyError, ValueError):
        return "?"


VERSION = _lire_version()


@app.get("/api/version")
def version():
    return {"version": VERSION}


# Le frontend (la sidebar, la page de login…) est public ; toutes les
# données passent par l'API, protégée par session.
app.mount("/", StaticFiles(directory=RACINE / "frontend", html=True), name="frontend")

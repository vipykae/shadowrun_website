"""API du tableau des runs — V1.

Lancement (dev, depuis la racine du projet) :
    python -m uvicorn backend.app:app --port 8300 --reload

Configuration par variables d'environnement (voir deploy/.env.example) :
    MDP_JOUEUSE_HASH / MDP_MJ_HASH : hashs argon2 (scripts/genere_hash.py)
    CLE_SECRETE                    : signe les cookies de session
    SECURE_COOKIES=1               : cookies Secure (derrière HTTPS)
Sans ces variables, l'app démarre en mode dev avec les mots de passe
« joueuse » et « mj » et une clé aléatoire (sessions perdues au redémarrage).
"""

from __future__ import annotations

import os
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from datetime import date as date_type
from pathlib import Path
from typing import Literal

import yaml
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from itsdangerous import BadSignature, SignatureExpired, TimestampSigner
from pydantic import BaseModel, Field, field_validator

RACINE = Path(__file__).resolve().parent.parent
CONTENU = Path(os.environ.get("DOSSIER_CONTENU", RACINE / "content"))
DONNEES = Path(os.environ.get("DOSSIER_DONNEES", RACINE / "data"))
DB = DONNEES / "app.db"

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


# ---------- Contenu (YAML, édité par la MJ) ----------


class Contenu:
    def __init__(self):
        self.carte: dict = {}
        self.districts: list = []
        self.runs: list = []
        self.fichiers: dict[str, Path] = {}  # id de run -> fichier YAML

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


contenu = Contenu()
contenu.charger()


# ---------- Écriture YAML lisible (interface MJ) ----------

ORDRE_RUN = [
    "id", "titre", "district", "position", "mj", "type", "places", "statut",
    "date", "duree_estimee", "lieu", "paiement", "difficulte", "risques",
    "themes", "avertissements", "notes", "brief", "compte_rendu",
]
ORDRE_DISTRICT = ["id", "nom", "gang_dominant", "gangs_presents", "description", "runs_jouees", "polygone"]
ENTETE_DISTRICTS = (
    "# Généré par scripts/labelme_vers_districts.py — les champs autres que\n"
    "# 'polygone' sont éditables à la main et préservés à la régénération.\n"
)


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
    return {"role": role, "carte": {k: v for k, v in contenu.carte.items() if k != "image"},
            "districts": contenu.districts, "runs": runs}


@app.get("/api/carte/image")
def image_carte(role: str = Depends(role_courant)):
    return FileResponse(CONTENU / "carte" / contenu.carte["image"])


def _run_ou_404(run_id: str) -> dict:
    for r in contenu.runs:
        if r["id"] == run_id:
            return r
    raise HTTPException(404, "Run inconnue")


def _liste_inscrites(con: sqlite3.Connection, run_id: str) -> list[str]:
    return [nom for (nom,) in con.execute(
        "SELECT nom FROM inscriptions WHERE run_id = ? ORDER BY id", (run_id,))]


@app.post("/api/runs/{run_id}/inscription")
def inscription(run_id: str, joueuse: Joueuse, role: str = Depends(role_courant)):
    run = _run_ou_404(run_id)
    nom = joueuse.nom.strip()
    if not nom:
        raise HTTPException(422, "Nom vide")
    if run.get("statut", "ouverte") != "ouverte":
        raise HTTPException(409, "Cette run n'est pas ouverte aux inscriptions.")
    with db() as con:
        inscrites = _liste_inscrites(con, run_id)
        if nom not in inscrites and len(inscrites) >= run.get("places", 4):
            raise HTTPException(409, "L'équipe est déjà complète.")
        con.execute("INSERT OR IGNORE INTO inscriptions (run_id, nom) VALUES (?, ?)", (run_id, nom))
        return {"inscrites": _liste_inscrites(con, run_id)}


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
    return {"districts": len(contenu.districts), "runs": len(contenu.runs)}


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
    compte_rendu: str | None = Field(None, max_length=20000)

    @field_validator("mj", "type", "date", "duree_estimee", "lieu", "paiement", "risques",
                     "notes", "brief", "compte_rendu", "titre", mode="before")
    @classmethod
    def _nettoyer(cls, v):
        return _vide_vers_none(v)

    @field_validator("themes", "avertissements", mode="before")
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


class DistrictEntree(BaseModel):
    nom: str = Field(min_length=1, max_length=80)
    gang_dominant: str | None = Field(None, max_length=120)
    gangs_presents: list[str] = []
    description: str | None = Field(None, max_length=5000)
    runs_jouees: list[str] = []

    @field_validator("gang_dominant", "description", "nom", mode="before")
    @classmethod
    def _nettoyer(cls, v):
        return _vide_vers_none(v)

    @field_validator("gangs_presents", "runs_jouees", mode="before")
    @classmethod
    def _nettoyer_liste(cls, v):
        return [s.strip()[:120] for s in (v or []) if isinstance(s, str) and s.strip()]


def _run_avec_inscrites(run_id: str) -> dict:
    run = dict(_run_ou_404(run_id))
    with db() as con:
        run["inscrites"] = _liste_inscrites(con, run_id)
    return run


@app.post("/api/mj/runs", status_code=201)
def creer_run(entree: RunEntree, role: str = Depends(role_mj)):
    entree.verifier()
    if entree.id in contenu.fichiers:
        raise HTTPException(409, f"Une run avec l'id « {entree.id} » existe déjà.")
    prefixe = (entree.date or "")[:10] if (entree.date or "")[:4].isdigit() else date_type.today().isoformat()
    chemin = CONTENU / "runs" / f"{prefixe}_{entree.id}.yaml"
    if chemin.exists():
        chemin = CONTENU / "runs" / f"{entree.id}.yaml"
    chemin.write_text(dump_yaml(entree.vers_yaml()), encoding="utf-8")
    contenu.charger()
    return _run_avec_inscrites(entree.id)


@app.put("/api/mj/runs/{run_id}")
def modifier_run(run_id: str, entree: RunEntree, role: str = Depends(role_mj)):
    chemin = contenu.fichiers.get(run_id)
    if chemin is None:
        raise HTTPException(404, "Run inconnue")
    if entree.id != run_id:
        raise HTTPException(422, "L'id d'une run ne se modifie pas.")
    entree.verifier()
    chemin.write_text(dump_yaml(entree.vers_yaml()), encoding="utf-8")
    contenu.charger()
    return _run_avec_inscrites(run_id)


@app.delete("/api/mj/runs/{run_id}")
def supprimer_run(run_id: str, role: str = Depends(role_mj)):
    chemin = contenu.fichiers.get(run_id)
    if chemin is None:
        raise HTTPException(404, "Run inconnue")
    chemin.unlink()
    with db() as con:
        con.execute("DELETE FROM inscriptions WHERE run_id = ?", (run_id,))
    contenu.charger()
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


# Le frontend (la sidebar, la page de login…) est public ; toutes les
# données passent par l'API, protégée par session.
app.mount("/", StaticFiles(directory=RACINE / "frontend", html=True), name="frontend")

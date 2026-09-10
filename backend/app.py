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
from pathlib import Path

import yaml
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from itsdangerous import BadSignature, SignatureExpired, TimestampSigner
from pydantic import BaseModel, Field

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

    def charger(self):
        self.carte = yaml.safe_load((CONTENU / "carte.yaml").read_text(encoding="utf-8"))
        self.districts = yaml.safe_load((CONTENU / "districts.yaml").read_text(encoding="utf-8")) or []
        runs = []
        for fichier in sorted((CONTENU / "runs").glob("*.yaml")):
            if fichier.name.startswith("_"):  # modèle, brouillons
                continue
            run = yaml.safe_load(fichier.read_text(encoding="utf-8"))
            run.setdefault("id", fichier.stem)
            runs.append(run)
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


# Le frontend (la sidebar, la page de login…) est public ; toutes les
# données passent par l'API, protégée par session.
app.mount("/", StaticFiles(directory=RACINE / "frontend", html=True), name="frontend")

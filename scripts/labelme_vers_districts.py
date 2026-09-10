"""Convertit l'export labelme en content/districts.yaml.

Usage :
    python scripts/labelme_vers_districts.py

- Lit content/carte/carte_seattle_web.json (export labelme).
- Simplifie les polygones (Douglas-Peucker) pour un rendu web fluide.
- Fusionne avec l'existant : si un district est déjà dans districts.yaml,
  seul son polygone est mis à jour — les infos éditées à la main
  (gangs, description, runs jouées) sont conservées.
- Le site lit ce YAML via l'API (GET /api/carte).
"""

import json
import unicodedata
from pathlib import Path

import yaml

RACINE = Path(__file__).resolve().parent.parent
LABELME = RACINE / "content" / "carte" / "carte_seattle_web.json"
YAML_OUT = RACINE / "content" / "districts.yaml"

TOLERANCE_PX = 2.5  # simplification : écart max entre tracé original et simplifié


class DumperLisible(yaml.SafeDumper):
    """Même mise en forme que l'interface MJ (backend/app.py) : points [x, y] sur une ligne."""


def _representer_liste(dumper, valeur):
    courte = all(isinstance(v, (int, float, str)) for v in valeur) and len(str(valeur)) < 60
    return dumper.represent_sequence("tag:yaml.org,2002:seq", valeur, flow_style=courte)


DumperLisible.add_representer(list, _representer_liste)


def slug(texte: str) -> str:
    s = unicodedata.normalize("NFKD", texte).encode("ascii", "ignore").decode()
    return s.lower().strip().replace(" ", "-")


def douglas_peucker(points, tolerance):
    """Simplifie une polyligne (liste de (x, y)) en gardant la forme."""
    if len(points) < 3:
        return points

    def dist_perp(p, a, b):
        (px, py), (ax, ay), (bx, by) = p, a, b
        dx, dy = bx - ax, by - ay
        norme2 = dx * dx + dy * dy
        if norme2 == 0:
            return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / norme2))
        cx, cy = ax + t * dx, ay + t * dy
        return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5

    d_max, i_max = 0.0, 0
    for i in range(1, len(points) - 1):
        d = dist_perp(points[i], points[0], points[-1])
        if d > d_max:
            d_max, i_max = d, i

    if d_max <= tolerance:
        return [points[0], points[-1]]

    gauche = douglas_peucker(points[: i_max + 1], tolerance)
    droite = douglas_peucker(points[i_max:], tolerance)
    return gauche[:-1] + droite


def main():
    export = json.loads(LABELME.read_text(encoding="utf-8"))

    existants = {}
    if YAML_OUT.exists():
        for d in yaml.safe_load(YAML_OUT.read_text(encoding="utf-8")) or []:
            existants[d["id"]] = d

    districts = []
    for forme in export["shapes"]:
        if forme.get("shape_type") != "polygon":
            continue
        brut = [(round(x, 1), round(y, 1)) for x, y in forme["points"]]
        simplifie = douglas_peucker(brut, TOLERANCE_PX)
        poly = [[round(x), round(y)] for x, y in simplifie]

        ident = slug(forme["label"])
        d = existants.get(
            ident,
            {
                "id": ident,
                "nom": forme["label"],
                "gang_dominant": "À COMPLÉTER",
                "gangs_presents": [],
                "description": "",
                "runs_jouees": [],
            },
        )
        d["polygone"] = poly
        districts.append(d)
        print(f"  {ident:20s} {len(brut):4d} pts -> {len(poly):3d} pts")

    # Ordre des clés stable et lisible dans le YAML
    ordre = ["id", "nom", "gang_dominant", "gangs_presents", "description", "runs_jouees", "polygone"]
    districts = [{k: d[k] for k in ordre if k in d} for d in districts]

    YAML_OUT.write_text(
        "# Généré par scripts/labelme_vers_districts.py — les champs autres que\n"
        "# 'polygone' sont éditables à la main et préservés à la régénération.\n"
        + yaml.dump(districts, Dumper=DumperLisible, allow_unicode=True, sort_keys=False, width=100),
        encoding="utf-8",
    )

    print(f"\n{len(districts)} districts -> {YAML_OUT.relative_to(RACINE)}")


if __name__ == "__main__":
    main()

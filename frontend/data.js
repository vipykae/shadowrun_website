// ============================================================
// V0 — Données factices, en dur.
// En V1 ces données viendront de l'API (/api/carte), elles-mêmes
// chargées depuis les fichiers YAML de content/.
// Toutes les coordonnées sont en PIXELS de l'image web
// (content/carte/carte_seattle_web.jpg — 2048 x 3974).
// ============================================================

const CARTE = {
  image: "../content/carte/carte_seattle_web.jpg",
  largeur: 2048,
  hauteur: 3974,
};

// Les districts (avec leurs polygones tracés dans labelme) sont dans
// districts.generated.js — régénéré par scripts/labelme_vers_districts.py.

const RUNS = [
  {
    id: "extraction-euphoria",
    titre: "Extraction : Euphoria",
    district: "redmond",
    position: [1629, 993],
    date: "2026-01-15T20:30",
    duree_estimee: "3h30",
    difficulte: 2,
    tags: ["infiltration", "matrice"],
    places: 4,
    statut: "ouverte",
    synopsis:
      "Un Johnson au costume trop propre veut récupérer Euphoria, chanteuse " +
      "de synth-rock retenue dans un squat fortifié des Barrens. Discrétion " +
      "exigée — les Crimson Crush n'aiment pas les visites.",
    inscrites: ["Nadja"],
  },
  {
    id: "data-heist-mitsuhama",
    titre: "Data heist : tour Mitsuhama",
    district: "downtown-seattle",
    position: [993, 1390],
    date: "2026-01-22T20:30",
    duree_estimee: "4h",
    difficulte: 4,
    tags: ["corpo", "matrice", "haute sécurité"],
    places: 5,
    statut: "ouverte",
    synopsis:
      "Une puce de recherche dort au 47e étage de la tour Mitsuhama. " +
      "Le commanditaire paie triple tarif. Personne ne paie triple tarif " +
      "sans une bonne raison.",
    inscrites: ["Vex", "Oracle", "Patch"],
  },
  {
    id: "convoi-fantome",
    titre: "Le convoi fantôme",
    district: "tacoma",
    position: [854, 2482],
    date: "2026-01-29T20:30",
    duree_estimee: "3h",
    difficulte: 3,
    tags: ["escorte", "combat", "docks"],
    places: 4,
    statut: "complete",
    synopsis:
      "Trois camions quittent les docks de Tacoma à minuit. Cargaison " +
      "inconnue, itinéraire secret, et déjà deux équipes d'interception " +
      "signalées sur le trajet.",
    inscrites: ["Nadja", "Vex", "Silence", "Brick"],
  },
];

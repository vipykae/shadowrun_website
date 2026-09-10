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

// Polygones tracés grossièrement pour la maquette.
// Les vrais tracés seront faits avec labelme sur l'image web.
const DISTRICTS = [
  {
    id: "redmond",
    nom: "Redmond Barrens",
    gang_dominant: "Crimson Crush",
    gangs_presents: ["Halloweeners", "Rusted Stilettos"],
    runs_jouees: ["Blackout au Glow City"],
    polygone: [
      [1390, 655], [1649, 596], [1787, 655], [1907, 854], [1927, 1112],
      [1847, 1370], [1708, 1648], [1589, 1549], [1470, 1390], [1390, 1231],
      [1430, 1072], [1351, 933], [1370, 794],
    ],
  },
  {
    id: "seattle",
    nom: "Seattle Downtown",
    gang_dominant: "First Nations",
    gangs_presents: ["Troll Killers", "Disassemblers"],
    runs_jouees: [],
    polygone: [
      [884, 834], [1053, 854], [1112, 993], [1192, 1112], [1211, 1271],
      [1192, 1450], [1152, 1628], [1192, 1787], [1172, 1986], [1112, 2105],
      [1033, 2046], [953, 1887], [913, 1708], [894, 1509], [874, 1291],
      [854, 1072], [844, 933],
    ],
  },
  {
    id: "tacoma",
    nom: "Tacoma",
    gang_dominant: "Kabuki Ronin",
    gangs_presents: ["Eye-Fivers"],
    runs_jouees: [],
    polygone: [
      [655, 2383], [854, 2244], [1033, 2145], [1112, 2224], [1152, 2343],
      [1132, 2502], [1072, 2641], [953, 2760], [794, 2820], [655, 2780],
      [576, 2641], [596, 2502],
    ],
  },
];

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
    district: "seattle",
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

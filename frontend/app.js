// ============================================================
// V1 — Frontend branché sur l'API.
// Toutes les données viennent de GET /api/carte ; les coordonnées
// sont en pixels image (origine en haut à gauche, comme labelme).
// ============================================================

let ROLE = null;
let DONNEES = null;   // { carte, districts, runs }
let map = null;
const marqueurs = {}; // run.id -> marker Leaflet

// Pins plus gros au doigt (doit correspondre à --pin dans style.css)
const TAILLE_PIN = matchMedia("(pointer: coarse)").matches ? 30 : 22;

function iconeDivPin(classe) {
  return L.divIcon({
    className: "",
    html: `<div class="pin ${classe}"><div class="pin-ring"></div><div class="pin-core"></div></div>`,
    iconSize: [TAILLE_PIN, TAILLE_PIN],
    iconAnchor: [TAILLE_PIN / 2, TAILLE_PIN / 2],
  });
}

// Filtre : par défaut on ne montre que les runs à venir.
let afficherJouees = false;
try { afficherJouees = localStorage.getItem("afficherJouees") === "1"; } catch {}

// "ville" (surface) ou "underground" — bascule via le bouton dédié
// (voir construireControleHorsCarte). Détermine l'image de fond, les
// districts cliquables et les runs visibles sur la carte.
let modeCarte = "ville";

// ---------- Statuts ----------
// ouverte | complete  -> run à venir (inscriptions possibles ou équipe pleine)
// jouee               -> run passée, visible avec le filtre « runs jouées »
// annulee             -> visible avec le filtre aussi, grisée

const statutDe = (run) => run.statut || "ouverte";
const estAVenir = (run) => ["ouverte", "complete"].includes(statutDe(run));
const estJouee = (run) => statutDe(run) === "jouee";
const estComplete = (run) => statutDe(run) === "complete" || run.inscrites.length >= run.places;
const estDuNiveauAffiche = (run) => (modeCarte === "underground") === (run.district === "underground");
const estVisible = (run) => (estAVenir(run) || afficherJouees) && estDuNiveauAffiche(run);

// ---------- Appels API ----------

async function api(chemin, corps, methode) {
  const options = { method: methode || (corps ? "POST" : "GET"), headers: {} };
  if (corps) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(corps);
  }
  const reponse = await fetch(chemin, options);
  if (!reponse.ok) {
    let message = `Erreur ${reponse.status}`;
    try {
      const detail = (await reponse.json()).detail;
      // Erreurs de validation Pydantic : liste de { loc, msg }
      message = Array.isArray(detail)
        ? detail.map((e) => `${(e.loc || []).slice(1).join(".")} : ${e.msg}`).join(" · ")
        : (detail || message);
    } catch {}
    const erreur = new Error(message);
    erreur.status = reponse.status;
    throw erreur;
  }
  return reponse.json();
}

// ---------- Démarrage ----------

async function demarrer() {
  try {
    await api("/api/session");
    await chargerEtAfficher();
  } catch {
    afficherLogin();
  }
}

function afficherLogin() {
  document.getElementById("login").hidden = false;
  document.getElementById("login-mdp").focus();
  effets.glitcher(document.querySelector(".login-panel h2"));
}

document.getElementById("login-form").addEventListener("submit", async (evt) => {
  evt.preventDefault();
  const champ = document.getElementById("login-mdp");
  const erreur = document.getElementById("login-erreur");
  erreur.textContent = "";
  try {
    await api("/api/login", { mdp: champ.value });
    champ.value = "";
    document.getElementById("login").hidden = true;
    await chargerEtAfficher();
  } catch (e) {
    erreur.textContent = e.message;
    effets.secouer(document.querySelector(".login-panel"));
    champ.select();
  }
});

async function chargerEtAfficher() {
  DONNEES = await api("/api/carte");
  ROLE = DONNEES.role;

  document.getElementById("badge-role-nom").textContent = ROLE === "mj" ? "MJ" : "JOUEUSE";
  document.getElementById("badge-role").hidden = false;
  document.getElementById("btn-reload").hidden = ROLE !== "mj";
  document.getElementById("btn-nouvelle-run").hidden = ROLE !== "mj";
  document.getElementById("btn-logout").hidden = false;
  document.getElementById("btn-filtre").hidden = false;
  document.getElementById("btn-vue").hidden = false;
  document.getElementById("btn-historique").hidden = false;
  document.getElementById("btn-calendrier").hidden = false;

  if (!map) creerCarte();
  construireCouches();
  appliquerFiltre();

  // Chargé maintenant (pas seulement à l'ouverture de l'onglet Personnages)
  // pour que les noms de fixer/persos probables/inscrites soient déjà
  // reconnaissables dès l'ouverture d'une run — voir lienPersoOuTexte.
  personnages.charger();
}

// Recharge les données sans toucher au zoom / cadrage de la carte.
async function rafraichir() {
  DONNEES = await api("/api/carte");
  construireCouches();
  appliquerFiltre();
}

document.getElementById("btn-nouvelle-run").addEventListener("click", () => mj.formulaireRun(null));

document.getElementById("btn-logout").addEventListener("click", async () => {
  try { await api("/api/logout", {}); } catch {}
  location.reload();
});

document.getElementById("btn-reload").addEventListener("click", async () => {
  try {
    await api("/api/reload", {});
    location.reload();
  } catch (e) {
    alert(e.message);
  }
});

document.getElementById("btn-filtre").addEventListener("click", () => {
  afficherJouees = !afficherJouees;
  try { localStorage.setItem("afficherJouees", afficherJouees ? "1" : "0"); } catch {}
  appliquerFiltre();
});

document.getElementById("btn-calendrier").addEventListener("click", async () => {
  try {
    const { url } = await api("/api/calendrier/url");
    try {
      await navigator.clipboard.writeText(url);
      toast("Lien du calendrier copié — colle-le dans Google Calendar, Apple Calendar ou Outlook.");
    } catch {
      window.prompt("Copie ce lien dans ton appli calendrier (abonnement à une URL) :", url);
    }
  } catch (e) {
    toast(e.message);
  }
});

// ---------- Toast (petite confirmation en bas d'écran) ----------

let toastTimer = null;
function toast(message) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 3200);
}

// ---------- Filtre ----------

function appliquerFiltre() {
  DONNEES.runs.forEach((run) => {
    const marqueur = marqueurs[run.id];
    if (estVisible(run)) marqueur.addTo(map);
    else marqueur.remove();
  });

  const bouton = document.getElementById("btn-filtre");
  bouton.querySelector(".ico").textContent = afficherJouees ? "◉" : "○";
  bouton.classList.toggle("badge-actif", afficherJouees);
  bouton.title = afficherJouees ? "Masquer les runs jouées" : "Afficher les runs jouées";

  const aVenir = DONNEES.runs.filter(estAVenir).length;
  const jouees = DONNEES.runs.filter(estJouee).length;
  document.getElementById("status-runs").textContent =
    `${aVenir} run${aVenir > 1 ? "s" : ""} à venir · ${jouees} jouée${jouees > 1 ? "s" : ""} · ${DONNEES.districts.length} districts`;
}

// ---------- Carte ----------

function px(x, y) {
  return [DONNEES.carte.hauteur - y, x];
}

function iconePour(run) {
  let classe = "";
  if (estJouee(run)) classe = "pin-jouee";
  else if (statutDe(run) === "annulee") classe = "pin-annulee";
  else if (estComplete(run)) classe = "pin-complete";
  return iconeDivPin(classe);
}

let couches = []; // polygones des districts, pour les reconstruire au rafraîchissement
let controleHorsCarte = null; // districts sans tracé (ex. Underground), bouton dédié
let imageCarte = null; // référence à l'overlay Leaflet, pour changer son URL au bascule de mode

function creerCarte() {
  const H = DONNEES.carte.hauteur;
  const W = DONNEES.carte.largeur;

  map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: -2.5,
    maxZoom: 1.5,
    zoomSnap: 0.25,
    attributionControl: false,
  });

  const bornes = [[0, 0], [H, W]];
  const conteneur = document.getElementById("map");
  conteneur.classList.remove("pret");
  imageCarte = L.imageOverlay("/api/carte/image", bornes);
  imageCarte.on("load", () => conteneur.classList.add("pret"));
  setTimeout(() => conteneur.classList.add("pret"), 2500); // filet de sécurité
  imageCarte.addTo(map);
  map.fitBounds(bornes);
  map.setMaxBounds([[-H * 0.1, -W * 0.1], [H * 1.1, W * 1.1]]);

  map.on("click", (evt) => {
    if (mj.clicCarte(evt)) return;
    fermerSidebar();
  });

  map.on("mousemove", (evt) => {
    const x = Math.round(evt.latlng.lng);
    const y = Math.round(H - evt.latlng.lat);
    document.getElementById("status-coords").textContent = `x:${x} y:${y}`;
  });
}

function construireCouches() {
  couches.forEach((c) => c.remove());
  couches = [];
  Object.values(marqueurs).forEach((m) => m.remove());
  for (const id in marqueurs) delete marqueurs[id];

  DONNEES.districts.forEach((d) => {
    // Districts sans tracé sur la carte (ex. Underground) : pas de polygone
    // Leaflet à construire, ils passent par construireControleHorsCarte().
    if (!d.polygone || d.polygone.length < 3) return;
    const poly = L.polygon(d.polygone.map(([x, y]) => px(x, y)), {
      color: "#29b6ff",
      weight: 1.5,
      opacity: 0.35,
      fillColor: "#29b6ff",
      fillOpacity: 0.03,
      // Le clic sur un district ne doit pas remonter jusqu'à la carte
      // (qui, elle, ferme la sidebar).
      bubblingMouseEvents: false,
    }).addTo(map);

    poly.bindTooltip(d.nom, { className: "district-label", sticky: true, direction: "top" });
    poly.on("mouseover", () => poly.setStyle({ opacity: 0.9, fillOpacity: 0.12, weight: 2 }));
    poly.on("mouseout", () => poly.setStyle({ opacity: 0.35, fillOpacity: 0.03, weight: 1.5 }));
    // bubblingMouseEvents: false empêche ce clic de remonter jusqu'à
    // map.on("click", ...) : sans ce garde-fou, cliquer sur la carte en
    // mode placement (pin d'une run) rouvre systématiquement la fiche du
    // district au lieu d'enregistrer les coordonnées. mj.enPlacement() (et
    // pas mj.clicCarte() ici) : ce dernier renvoie aussi true dès qu'un
    // formulaire est ouvert, hors placement, ce qui bloquerait à tort le
    // changement de district pendant l'édition d'une run.
    poly.on("click", (evt) => {
      if (mj.enPlacement()) { mj.clicCarte(evt); return; }
      ouvrirSidebarDistrict(d);
    });
    couches.push(poly);
  });

  DONNEES.runs.forEach((run) => {
    marqueurs[run.id] = L.marker(px(run.position[0], run.position[1]), { icon: iconePour(run) })
      .on("click", (evt) => {
        if (mj.enPlacement()) { mj.clicCarte(evt); return; }
        ouvrirSidebarRun(run);
      });
  });

  appliquerVisibiliteDistricts();
  construireControleHorsCarte();
}

// Ajoute/retire les polygones de districts de surface selon le mode
// courant : masqués en mode souterrain (un seul "district" y a cours,
// Underground, qui n'a de toute façon pas de tracé).
function appliquerVisibiliteDistricts() {
  couches.forEach((c) => {
    if (modeCarte === "underground") map.removeLayer(c);
    else if (!map.hasLayer(c)) c.addTo(map);
  });
}

// Districts sans tracé sur la carte (ex. Underground) : un petit contrôle
// Leaflet flottant, un bouton par district, plutôt qu'un polygone invisible.
// Underground est spécial : son bouton ne montre pas juste sa fiche, il
// bascule toute la carte en mode "sous-sol" (voir basculerModeCarte).
let boutonSousSol = null; // <a> du bouton Underground, pour mettre à jour son libellé

function construireControleHorsCarte() {
  if (controleHorsCarte) {
    controleHorsCarte.remove();
    controleHorsCarte = null;
  }
  boutonSousSol = null;
  const horsCarte = DONNEES.districts.filter((d) => !d.polygone || d.polygone.length < 3);
  if (horsCarte.length === 0) return;

  const Controle = L.Control.extend({
    options: { position: "bottomleft" },
    onAdd() {
      const conteneur = L.DomUtil.create("div", "leaflet-control districts-hors-carte");
      L.DomEvent.disableClickPropagation(conteneur);
      horsCarte.forEach((d) => {
        const bouton = L.DomUtil.create("a", "", conteneur);
        bouton.href = "#";
        if (d.id === "underground") {
          boutonSousSol = bouton;
          bouton.classList.add("bouton-sous-sol");
          effets.glitchPeriodique(bouton); // clignote de temps en temps, comme le titre du site
          L.DomEvent.on(bouton, "click", (evt) => {
            L.DomEvent.preventDefault(evt);
            basculerModeCarte();
          });
        } else {
          bouton.textContent = d.nom;
          bouton.title = `${d.nom} (hors carte)`;
          L.DomEvent.on(bouton, "click", (evt) => {
            L.DomEvent.preventDefault(evt);
            ouvrirSidebarDistrict(d);
          });
        }
      });
      return conteneur;
    },
  });

  controleHorsCarte = new Controle();
  controleHorsCarte.addTo(map);
  mettreAJourBoutonSousSol();
}

function mettreAJourBoutonSousSol() {
  if (!boutonSousSol) return;
  const enSousSol = modeCarte === "underground";
  boutonSousSol.textContent = enSousSol ? "↑ Retour en surface" : "Underground";
  boutonSousSol.title = enSousSol ? "Revenir à la carte de surface" : "Passer en vue souterraine";
  boutonSousSol.classList.toggle("actif", enSousSol);
}

// Bascule toute la carte entre la surface ("ville") et le sous-sol
// ("underground") : image de fond, districts cliquables (aucun en
// sous-sol, ce niveau n'en a qu'un, sans tracé) et runs visibles
// (estVisible, dans le bloc "Statuts" plus haut, filtre déjà par
// run.district vs modeCarte).
function basculerModeCarte() {
  modeCarte = modeCarte === "ville" ? "underground" : "ville";

  const conteneur = document.getElementById("map");
  const enSousSol = modeCarte === "underground";
  conteneur.classList.toggle("mode-underground", enSousSol);
  // Tant que la vraie carte souterraine n'existe pas, l'API retombe sur
  // l'image de surface : ce filtre visuel évite de laisser croire que
  // c'est la carte définitive.
  conteneur.classList.toggle("carte-sans-image-dediee", enSousSol && !DONNEES.carte.a_carte_underground);

  conteneur.classList.remove("pret");
  imageCarte.setUrl(enSousSol ? "/api/carte/image-underground" : "/api/carte/image");
  setTimeout(() => conteneur.classList.add("pret"), 2500); // filet de sécurité, comme au chargement initial

  appliquerVisibiliteDistricts();
  appliquerFiltre();
  mettreAJourBoutonSousSol();

  if (enSousSol) {
    ouvrirSidebarDistrict(DONNEES.districts.find((d) => d.id === "underground"));
  } else {
    fermerSidebar();
  }
}

// ---------- Sidebar ----------

const sidebar = document.getElementById("sidebar");
const sidebarContent = document.getElementById("sidebar-content");
document.getElementById("sidebar-close").addEventListener("click", fermerSidebar);

function fermerSidebar() {
  mj.nettoyer();
  personnages.nettoyerUpload();
  sidebar.classList.remove("open");
  sidebar.setAttribute("aria-hidden", "true");
}

function ouvrirSidebar() {
  if (!sidebarContent.querySelector("form")) mj.nettoyer();
  sidebar.classList.add("open");
  sidebar.setAttribute("aria-hidden", "false");
  sidebar.scrollTop = 0;
  effets.cascade(sidebarContent);
}

const runsParDistrict = (id) => DONNEES.runs.filter((r) => r.district === id);

// Le champ date d'une run accepte : une date ISO (fixe), une URL (sondage)
// ou un texte libre (« à définir »).
function infoDate(run) {
  const brut = run.date;
  if (brut == null || brut === "") return { type: "libre", texte: "À définir" };
  const s = String(brut);
  if (/^https?:\/\//i.test(s)) return { type: "sondage", texte: "Sondage en cours", url: s };
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const avecHeure = s.length > 10;
    const date = new Date(avecHeure ? s : `${s}T00:00`);
    if (!isNaN(date)) {
      const options = { weekday: "long", day: "numeric", month: "long" };
      if (avecHeure) Object.assign(options, { hour: "2-digit", minute: "2-digit" });
      return {
        type: "fixe",
        texte: date.toLocaleString("fr-FR", options),
        court: date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }),
      };
    }
  }
  return { type: "libre", texte: s };
}

function blocDate(run) {
  const info = infoDate(run);
  if (info.type === "sondage") {
    return `<a class="lien-sondage" href="${echapper(info.url)}" target="_blank" rel="noopener">Voter pour la date ↗</a>`;
  }
  return `<span class="${info.type === "libre" ? "date-libre" : ""}">${echapper(info.texte)}</span>`;
}

function section(titre, contenu, classe = "run-texte") {
  if (!contenu) return "";
  return `<div class="section-title">${titre}</div><p class="${classe}">${echapper(contenu)}</p>`;
}

// Fixer / autres persos probables / inscrites : texte libre, mais rendu
// cliquable (ouvre la fiche) quand ça correspond au nom d'un PJ/PNJ
// existant. Pas de référence stockée : juste une comparaison de nom au
// moment de l'affichage (voir personnages.trouverParNom).
function lienPersoOuTexte(nom) {
  if (!nom) return "";
  const trouve = typeof personnages !== "undefined" ? personnages.trouverParNom(nom) : null;
  return trouve
    ? `<span class="lien-perso" data-id="${echapper(trouve.perso.id)}" data-type="${trouve.type}">${echapper(nom)}</span>`
    : echapper(nom);
}

function libelleStatut(run) {
  switch (statutDe(run)) {
    case "jouee": return "RUN JOUÉE";
    case "annulee": return "RUN ANNULÉE";
    case "complete": return "INSCRIPTIONS FERMÉES";
    default: return run.inscrites.length >= run.places ? "ÉQUIPE COMPLÈTE" : "";
  }
}

function ouvrirSidebarRun(run) {
  const district = DONNEES.districts.find((d) => d.id === run.district);
  const aVenir = estAVenir(run);
  const inscriptionsOuvertes = statutDe(run) === "ouverte" && run.inscrites.length < run.places;
  const difficulte = Math.max(1, Math.min(5, run.difficulte || 1));

  const lignes = run.inscrites.map((nom) =>
    `<li><span class="ins-nom">${lienPersoOuTexte(nom)}</span>
     ${aVenir ? `<button class="ins-suppr" data-nom="${echapper(nom)}" title="Désinscrire">✕</button>` : ""}</li>`
  );
  if (aVenir) {
    for (let i = run.inscrites.length; i < run.places; i++) {
      lignes.push(`<li class="slot-libre">— place libre —</li>`);
    }
  } else if (!run.inscrites.length) {
    lignes.push(`<li class="slot-libre">Équipe non renseignée.</li>`);
  }

  let pied;
  if (inscriptionsOuvertes) {
    pied = `<div class="inscription-form">
              <input id="nom-joueuse" type="text" maxlength="30" placeholder="Ton nom de runneuse…">
              <button class="btn" id="btn-inscription">S'inscrire</button>
            </div>`;
  } else {
    pied = `<div class="statut-complete ${estJouee(run) ? "statut-jouee" : ""}">▮ ${libelleStatut(run)}</div>`;
  }

  const themes = run.themes || run.tags || [];
  const avertissements = run.avertissements || [];
  const tags = [
    ...themes.map((t) => `<span class="tag">${echapper(t)}</span>`),
    ...avertissements.map((t) => `<span class="tag tag-tw" title="Avertissement de contenu">⚠ ${echapper(t)}</span>`),
  ].join("");

  const meta = [
    run.mj ? `<div class="meta-item"><div class="meta-label">MJ</div><div class="meta-value">${echapper(run.mj)}</div></div>` : "",
    run.fixer ? `<div class="meta-item"><div class="meta-label">Fixer</div><div class="meta-value">${lienPersoOuTexte(run.fixer)}</div></div>` : "",
    `<div class="meta-item"><div class="meta-label">Date</div><div class="meta-value meta-value-small">${blocDate(run)}</div></div>`,
    run.duree_estimee ? `<div class="meta-item"><div class="meta-label">Durée</div><div class="meta-value">${echapper(run.duree_estimee)}</div></div>` : "",
    run.paiement ? `<div class="meta-item"><div class="meta-label">Paiement</div><div class="meta-value meta-value-small paiement">${echapper(run.paiement)}</div></div>` : "",
    run.lieu ? `<div class="meta-item meta-large"><div class="meta-label">Lieu</div><div class="meta-value meta-value-small">◎ ${echapper(run.lieu)}</div></div>` : "",
    (run.autres_personnages_probables || []).length
      ? `<div class="meta-item meta-large"><div class="meta-label">Autres persos probables</div>
          <div class="meta-value meta-value-small">${run.autres_personnages_probables.map(lienPersoOuTexte).join(", ")}</div></div>`
      : "",
  ].join("");

  const kicker = [
    district ? `<span class="kicker-lien" id="lien-district">${echapper(district.nom)}</span>` : "",
    run.type ? echapper(run.type) : "",
  ].filter(Boolean).join(" · ");

  sidebarContent.innerHTML = `
    <div class="run-kicker">${kicker}</div>
    <div class="run-titre ${estJouee(run) ? "run-titre-jouee" : ""}">${echapper(run.titre)}</div>
    ${run.image ? `<img class="perso-portrait" src="${echapper(run.image)}" alt="">` : ""}
    <div class="run-meta">${meta}</div>
    ${tags ? `<div class="run-tags">${tags}</div>` : ""}
    ${section("Brief", run.brief || run.synopsis, "run-synopsis")}
    <div class="section-title">Difficulté / risques</div>
    <div class="difficulte-ligne"><span class="difficulte">${"◆".repeat(difficulte)}${"◇".repeat(5 - difficulte)}</span></div>
    ${run.risques ? `<p class="run-texte">${echapper(run.risques)}</p>` : ""}
    ${section("Recommandé", run.notes)}
    ${estJouee(run) ? section("Compte rendu", run.compte_rendu, "run-synopsis compte-rendu") : ""}
    <div class="section-title">Équipe${aVenir ? ` (${run.inscrites.length}/${run.places})` : ""}</div>
    <ul class="inscrites">${lignes.join("")}</ul>
    ${pied}
    <div class="sidebar-erreur" id="sidebar-erreur"></div>
    ${ROLE === "mj" ? mj.actionsRun(run) : ""}
  `;

  const lienDistrict = document.getElementById("lien-district");
  if (lienDistrict && district) {
    lienDistrict.addEventListener("click", () => ouvrirSidebarDistrict(district));
  }

  sidebarContent.querySelectorAll(".lien-perso").forEach((el) => {
    el.addEventListener("click", () => {
      const perso = personnages.trouver(el.dataset.id, el.dataset.type);
      if (perso) personnages.ouvrirFiche(perso, el.dataset.type);
    });
  });

  const bouton = document.getElementById("btn-inscription");
  if (bouton) {
    const champ = document.getElementById("nom-joueuse");
    const valider = () => {
      const nom = champ.value.trim();
      if (!nom) { champ.focus(); return; }
      modifierInscription(run, "inscription", nom);
    };
    bouton.addEventListener("click", valider);
    champ.addEventListener("keydown", (evt) => { if (evt.key === "Enter") valider(); });
  }

  sidebarContent.querySelectorAll(".ins-suppr").forEach((btn) => {
    btn.addEventListener("click", () => modifierInscription(run, "desinscription", btn.dataset.nom));
  });

  ouvrirSidebar();
}

async function modifierInscription(run, action, nom) {
  try {
    const resultat = await api(`/api/runs/${run.id}/${action}`, { nom });
    run.inscrites = resultat.inscrites;
    marqueurs[run.id].setIcon(iconePour(run));
    ouvrirSidebarRun(run);
  } catch (e) {
    const zone = document.getElementById("sidebar-erreur");
    if (zone) zone.textContent = e.message;
    if (e.status === 401) location.reload();
  }
}

function ligneRun(run) {
  const jouee = estJouee(run);
  const complete = !jouee && estComplete(run);
  const droite = jouee
    ? (infoDate(run).court || "")
    : complete ? "COMPLÈTE" : `${run.inscrites.length}/${run.places}`;
  return `<li class="run-lien ${complete ? "run-lien-complete" : ""} ${jouee ? "run-lien-jouee" : ""}" data-run="${run.id}">
            <span class="run-lien-titre">${echapper(run.titre)}</span>
            <span class="run-lien-places">${echapper(droite)}</span>
          </li>`;
}

function ouvrirSidebarDistrict(d) {
  const runs = runsParDistrict(d.id);
  const disponibles = runs.filter(estAVenir);
  const jouees = runs.filter(estJouee);

  const listeDisponibles = disponibles.length
    ? disponibles.map(ligneRun).join("")
    : `<li class="slot-libre">Aucune run proposée ici pour le moment.</li>`;

  // Runs jouées via le site (cliquables) + historique saisi à la main dans
  // districts.yaml (simples libellés, pour les runs d'avant le site).
  const historique = (d.runs_jouees || []).map((r) => `<li class="run-lien run-lien-histo">
      <span class="run-lien-titre">${echapper(r)}</span></li>`);
  const listeJouees = jouees.length || historique.length
    ? jouees.map(ligneRun).join("") + historique.join("")
    : `<li class="slot-libre">Aucune run jouée ici… pour l'instant.</li>`;

  sidebarContent.innerHTML = `
    <div class="run-kicker">District</div>
    <div class="run-titre">${echapper(d.nom)}</div>
    ${d.fiche?.indice_surete ? `<div class="run-tags"><span class="tag">Indice de sûreté ${echapper(d.fiche.indice_surete)}</span></div>` : ""}
    ${blocFaction("Gang dominant", "Autres gangs présents", d.gang_dominant, d.gangs_presents)}
    ${blocFaction("Mégacorp dominante", "Autres mégacorps présentes", d.megacorp_dominante, d.megacorps_presentes)}
    ${blocFaction("Autre faction dominante", "Autres factions présentes", d.autre_faction_dominante, d.autres_factions_presentes)}
    ${d.description ? `<p class="run-synopsis">${echapper(d.description)}</p>` : ""}
    ${blocFicheComplete(d.fiche)}
    <div class="section-title">Runs disponibles</div>
    <ul class="runs-district">${listeDisponibles}</ul>
    <div class="section-title">Runs jouées</div>
    <ul class="runs-district">${listeJouees}</ul>
    ${ROLE === "mj" ? mj.actionsDistrict(d) : ""}
  `;

  sidebarContent.querySelectorAll(".run-lien[data-run]").forEach((li) => {
    li.addEventListener("click", () => {
      const run = DONNEES.runs.find((r) => r.id === li.dataset.run);
      if (run) ouvrirSidebarRun(run);
    });
  });

  const toggle = sidebarContent.querySelector(".fiche-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const ouvert = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!ouvert));
      toggle.nextElementSibling.classList.toggle("ouvert", !ouvert);
    });
  }

  ouvrirSidebar();
}

// Un des trois blocs de contrôle d'un district (gang / mégacorp / autre
// faction). Masqué entièrement si rien n'est renseigné pour ce niveau-là,
// plutôt que d'afficher un encart vide.
function blocFaction(labelDominant, labelPresents, dominant, presents) {
  if (!dominant && !(presents && presents.length)) return "";
  return `
    <div class="run-meta">
      <div class="meta-item"><div class="meta-label">${echapper(labelDominant)}</div>
        <div class="meta-value">${dominant ? echapper(dominant) : "—"}</div></div>
      <div class="meta-item"><div class="meta-label">${echapper(labelPresents)}</div>
        <div class="meta-value meta-value-small">${(presents || []).map(echapper).join(", ") || "—"}</div></div>
    </div>`;
}

// Fiche complète d'un district (population, indice, ambiance...), dépliable.
// Absente pour les districts qui n'ont pas encore été renseignés.
function blocFicheComplete(fiche) {
  if (!fiche) return "";
  const champs = [
    ["Population", fiche.population],
    ["Ambiance", fiche.ambiance],
    ["À voir", fiche.a_voir],
    ["Lieux sensibles", fiche.lieux_sensibles],
    ["Faire attention à", fiche.faire_attention_a],
  ].filter(([, texte]) => texte);
  if (!champs.length) return "";
  return `
    <button type="button" class="fiche-toggle" aria-expanded="false">
      Fiche complète <span class="fiche-toggle-icone">▾</span>
    </button>
    <div class="fiche-complete-wrap">
      <div class="fiche-complete-inner">
        ${champs.map(([label, texte]) => `
          <div class="fiche-champ">
            <div class="fiche-champ-label">${echapper(label)}</div>
            <div class="fiche-champ-texte">${echapper(texte)}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

// ---------- Utilitaires ----------

function echapper(texte) {
  return String(texte)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

effets.glitchPeriodique(document.querySelector(".topbar h1"));
demarrer();

// ---------- Image en plein écran (portrait de perso / image de run) ----------

function fermerImagePleinEcran() {
  const el = document.getElementById("lightbox");
  if (el) el.remove();
}

document.addEventListener("click", (evt) => {
  const img = evt.target.closest("img.perso-portrait");
  if (!img) return;
  fermerImagePleinEcran();
  const overlay = document.createElement("div");
  overlay.id = "lightbox";
  overlay.className = "lightbox";
  overlay.innerHTML = `<button type="button" class="lightbox-close" aria-label="Fermer">✕</button><img src="${echapper(img.getAttribute("src"))}" alt="">`;
  overlay.addEventListener("click", fermerImagePleinEcran);
  document.body.appendChild(overlay);
});

document.addEventListener("keydown", (evt) => {
  if (evt.key === "Escape" && document.getElementById("lightbox")) {
    evt.stopPropagation();
    fermerImagePleinEcran();
  }
}, true);

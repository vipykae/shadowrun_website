// ============================================================
// V1 — Frontend branché sur l'API.
// Toutes les données viennent de GET /api/carte ; les coordonnées
// sont en pixels image (origine en haut à gauche, comme labelme).
// ============================================================

let ROLE = null;
let DONNEES = null;   // { carte, districts, runs }
let map = null;
const marqueurs = {}; // run.id -> marker Leaflet

// Filtre : par défaut on ne montre que les runs à venir.
let afficherJouees = false;
try { afficherJouees = localStorage.getItem("afficherJouees") === "1"; } catch {}

// ---------- Statuts ----------
// ouverte | complete  -> run à venir (inscriptions possibles ou équipe pleine)
// jouee               -> run passée, visible avec le filtre « runs jouées »
// annulee             -> visible avec le filtre aussi, grisée

const statutDe = (run) => run.statut || "ouverte";
const estAVenir = (run) => ["ouverte", "complete"].includes(statutDe(run));
const estJouee = (run) => statutDe(run) === "jouee";
const estComplete = (run) => statutDe(run) === "complete" || run.inscrites.length >= run.places;
const estVisible = (run) => estAVenir(run) || afficherJouees;

// ---------- Appels API ----------

async function api(chemin, corps) {
  const options = corps
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) }
    : {};
  const reponse = await fetch(chemin, options);
  if (!reponse.ok) {
    let message = `Erreur ${reponse.status}`;
    try { message = (await reponse.json()).detail || message; } catch {}
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
    champ.select();
  }
});

async function chargerEtAfficher() {
  DONNEES = await api("/api/carte");
  ROLE = DONNEES.role;

  document.getElementById("badge-role").textContent = `ACCÈS : ${ROLE === "mj" ? "MJ" : "JOUEUSE"}`;
  document.getElementById("btn-reload").hidden = ROLE !== "mj";
  document.getElementById("btn-logout").hidden = false;
  document.getElementById("btn-filtre").hidden = false;

  initCarte();
  appliquerFiltre();
}

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

// ---------- Filtre ----------

function appliquerFiltre() {
  DONNEES.runs.forEach((run) => {
    const marqueur = marqueurs[run.id];
    if (estVisible(run)) marqueur.addTo(map);
    else marqueur.remove();
  });

  const bouton = document.getElementById("btn-filtre");
  bouton.textContent = afficherJouees ? "◉ RUNS JOUÉES" : "○ RUNS JOUÉES";
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
  return L.divIcon({
    className: "",
    html: `<div class="pin ${classe}"><div class="pin-ring"></div><div class="pin-core"></div></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function initCarte() {
  const H = DONNEES.carte.hauteur;
  const W = DONNEES.carte.largeur;

  if (map) { map.remove(); map = null; }
  for (const id in marqueurs) delete marqueurs[id];

  map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: -2.5,
    maxZoom: 1.5,
    zoomSnap: 0.25,
    attributionControl: false,
  });

  const bornes = [[0, 0], [H, W]];
  L.imageOverlay("/api/carte/image", bornes).addTo(map);
  map.fitBounds(bornes);
  map.setMaxBounds([[-H * 0.1, -W * 0.1], [H * 1.1, W * 1.1]]);

  DONNEES.districts.forEach((d) => {
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
    poly.on("click", () => ouvrirSidebarDistrict(d));
  });

  DONNEES.runs.forEach((run) => {
    marqueurs[run.id] = L.marker(px(run.position[0], run.position[1]), { icon: iconePour(run) })
      .on("click", () => ouvrirSidebarRun(run));
  });

  map.on("click", fermerSidebar);

  map.on("mousemove", (evt) => {
    const x = Math.round(evt.latlng.lng);
    const y = Math.round(H - evt.latlng.lat);
    document.getElementById("status-coords").textContent = `x:${x} y:${y}`;
  });
}

// ---------- Sidebar ----------

const sidebar = document.getElementById("sidebar");
const sidebarContent = document.getElementById("sidebar-content");
document.getElementById("sidebar-close").addEventListener("click", fermerSidebar);

function fermerSidebar() {
  sidebar.classList.remove("open");
  sidebar.setAttribute("aria-hidden", "true");
}

function ouvrirSidebar() {
  sidebar.classList.add("open");
  sidebar.setAttribute("aria-hidden", "false");
  sidebar.scrollTop = 0;
}

const runsParDistrict = (id) => DONNEES.runs.filter((r) => r.district === id);

function formaterDate(valeur) {
  const date = new Date(valeur);
  if (isNaN(date)) return String(valeur ?? "date à venir");
  return date.toLocaleString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
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
    `<li><span class="ins-nom">${echapper(nom)}</span>
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

  const compteRendu = estJouee(run) && run.compte_rendu
    ? `<div class="section-title">Compte rendu</div>
       <p class="run-synopsis compte-rendu">${echapper(run.compte_rendu)}</p>`
    : "";

  sidebarContent.innerHTML = `
    <div class="run-kicker">${district ? `<span class="kicker-lien" id="lien-district">${echapper(district.nom)}</span> · ` : ""}${formaterDate(run.date)}</div>
    <div class="run-titre ${estJouee(run) ? "run-titre-jouee" : ""}">${echapper(run.titre)}</div>
    <div class="run-meta">
      <div class="meta-item"><div class="meta-label">Difficulté</div>
        <div class="meta-value difficulte">${"◆".repeat(difficulte)}${"◇".repeat(5 - difficulte)}</div></div>
      <div class="meta-item"><div class="meta-label">Durée estimée</div>
        <div class="meta-value">${echapper(run.duree_estimee || "?")}</div></div>
    </div>
    <div class="run-tags">${(run.tags || []).map((t) => `<span class="tag">${echapper(t)}</span>`).join("")}</div>
    <p class="run-synopsis">${echapper(run.synopsis || "")}</p>
    ${compteRendu}
    <div class="section-title">Équipe${aVenir ? ` (${run.inscrites.length}/${run.places})` : ""}</div>
    <ul class="inscrites">${lignes.join("")}</ul>
    ${pied}
    <div class="sidebar-erreur" id="sidebar-erreur"></div>
  `;

  const lienDistrict = document.getElementById("lien-district");
  if (lienDistrict && district) {
    lienDistrict.addEventListener("click", () => ouvrirSidebarDistrict(district));
  }

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
    ? formaterDate(run.date).split(" à ")[0]
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
    <div class="run-meta">
      <div class="meta-item"><div class="meta-label">Contrôlé par</div>
        <div class="meta-value">${echapper(d.gang_dominant || "?")}</div></div>
      <div class="meta-item"><div class="meta-label">Aussi présents</div>
        <div class="meta-value meta-value-small">${(d.gangs_presents || []).map(echapper).join(", ") || "—"}</div></div>
    </div>
    ${d.description ? `<p class="run-synopsis">${echapper(d.description)}</p>` : ""}
    <div class="section-title">Runs disponibles</div>
    <ul class="runs-district">${listeDisponibles}</ul>
    <div class="section-title">Runs jouées</div>
    <ul class="runs-district">${listeJouees}</ul>
  `;

  sidebarContent.querySelectorAll(".run-lien[data-run]").forEach((li) => {
    li.addEventListener("click", () => {
      const run = DONNEES.runs.find((r) => r.id === li.dataset.run);
      if (run) ouvrirSidebarRun(run);
    });
  });

  ouvrirSidebar();
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

demarrer();

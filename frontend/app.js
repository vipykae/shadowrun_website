// ============================================================
// V0 — Carte interactive (Leaflet, CRS.Simple)
// Les coordonnées de data.js sont en pixels image (origine en
// haut à gauche, comme labelme) ; px() les convertit en latlng.
// ============================================================

const H = CARTE.hauteur;
const W = CARTE.largeur;

function px(x, y) {
  return [H - y, x];
}

const map = L.map("map", {
  crs: L.CRS.Simple,
  minZoom: -2.5,
  maxZoom: 1.5,
  zoomSnap: 0.25,
  attributionControl: false,
});

const bounds = [[0, 0], [H, W]];
L.imageOverlay(CARTE.image, bounds).addTo(map);
map.fitBounds(bounds);
map.setMaxBounds([[-H * 0.1, -W * 0.1], [H * 1.1, W * 1.1]]);

// ---------- Districts ----------

const runsParDistrict = (id) => RUNS.filter((r) => r.district === id);

DISTRICTS.forEach((d) => {
  const latlngs = d.polygone.map(([x, y]) => px(x, y));

  const poly = L.polygon(latlngs, {
    color: "#29b6ff",
    weight: 1.5,
    opacity: 0.35,
    fillColor: "#29b6ff",
    fillOpacity: 0.03,
  }).addTo(map);

  // Au survol : simple surlignage + nom du district. Le détail est
  // dans la sidebar (au clic) — plus lisible, et compatible mobile.
  poly.bindTooltip(d.nom, { className: "district-label", sticky: true, direction: "top" });

  poly.on("mouseover", () => poly.setStyle({ opacity: 0.9, fillOpacity: 0.12, weight: 2 }));
  poly.on("mouseout", () => poly.setStyle({ opacity: 0.35, fillOpacity: 0.03, weight: 1.5 }));
  poly.on("click", () => {
    clicSurCouche = true;
    ouvrirSidebarDistrict(d);
  });
});

// ---------- Pins des runs ----------

RUNS.forEach((run) => {
  const complete = run.statut === "complete";
  const icon = L.divIcon({
    className: "",
    html: `<div class="pin ${complete ? "pin-complete" : ""}">
             <div class="pin-ring"></div><div class="pin-core"></div>
           </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

  L.marker(px(run.position[0], run.position[1]), { icon })
    .addTo(map)
    .on("click", () => ouvrirSidebar(run));
});

// ---------- Sidebar ----------

const sidebar = document.getElementById("sidebar");
const sidebarContent = document.getElementById("sidebar-content");
document.getElementById("sidebar-close").addEventListener("click", fermerSidebar);

// Un clic sur un polygone déclenche aussi le clic carte : ce drapeau
// évite que la sidebar se referme aussitôt ouverte.
let clicSurCouche = false;
map.on("click", () => {
  if (clicSurCouche) { clicSurCouche = false; return; }
  fermerSidebar();
});

function fermerSidebar() {
  sidebar.classList.remove("open");
  sidebar.setAttribute("aria-hidden", "true");
}

function ouvrirSidebar(run) {
  const district = DISTRICTS.find((d) => d.id === run.district);
  const complete = run.statut === "complete" || run.inscrites.length >= run.places;

  const dateFmt = new Date(run.date).toLocaleString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });

  const slots = [];
  run.inscrites.forEach((nom) => slots.push(`<li>${nom}</li>`));
  for (let i = run.inscrites.length; i < run.places; i++) {
    slots.push(`<li class="slot-libre">— place libre —</li>`);
  }

  const formulaire = complete
    ? `<div class="statut-complete">▮ ÉQUIPE COMPLÈTE</div>`
    : `<div class="inscription-form">
         <input id="nom-joueuse" type="text" maxlength="30" placeholder="Ton nom de runneuse…">
         <button class="btn" id="btn-inscription">S'inscrire</button>
       </div>`;

  sidebarContent.innerHTML = `
    <div class="run-kicker">${district ? `<span class="kicker-lien" id="lien-district">${district.nom}</span> · ` : ""}${dateFmt}</div>
    <div class="run-titre">${run.titre}</div>
    <div class="run-meta">
      <div class="meta-item"><div class="meta-label">Difficulté</div>
        <div class="meta-value difficulte">${"◆".repeat(run.difficulte)}${"◇".repeat(5 - run.difficulte)}</div></div>
      <div class="meta-item"><div class="meta-label">Durée estimée</div>
        <div class="meta-value">${run.duree_estimee}</div></div>
    </div>
    <div class="run-tags">${run.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>
    <p class="run-synopsis">${run.synopsis}</p>
    <div class="section-title">Équipe (${run.inscrites.length}/${run.places})</div>
    <ul class="inscrites">${slots.join("")}</ul>
    ${formulaire}
  `;

  const lienDistrict = document.getElementById("lien-district");
  if (lienDistrict && district) {
    lienDistrict.addEventListener("click", () => ouvrirSidebarDistrict(district));
  }

  const btn = document.getElementById("btn-inscription");
  if (btn) {
    btn.addEventListener("click", () => {
      const input = document.getElementById("nom-joueuse");
      const nom = input.value.trim();
      if (!nom) { input.focus(); return; }
      // V0 : inscription en mémoire seulement (perdue au rechargement).
      // En V1 : POST /api/runs/{id}/inscription
      if (!run.inscrites.includes(nom)) run.inscrites.push(nom);
      ouvrirSidebar(run);
    });
  }

  sidebar.classList.add("open");
  sidebar.setAttribute("aria-hidden", "false");
}

function ouvrirSidebarDistrict(d) {
  const runs = runsParDistrict(d.id);

  const listeRuns = runs.length
    ? runs
        .map((r) => {
          const complete = r.statut === "complete" || r.inscrites.length >= r.places;
          return `<li class="run-lien ${complete ? "run-lien-complete" : ""}" data-run="${r.id}">
                    <span class="run-lien-titre">${r.titre}</span>
                    <span class="run-lien-places">${complete ? "COMPLÈTE" : `${r.inscrites.length}/${r.places}`}</span>
                  </li>`;
        })
        .join("")
    : `<li class="slot-libre">Aucune run proposée ici pour le moment.</li>`;

  const runsJouees = d.runs_jouees.length
    ? `<ul class="inscrites">${d.runs_jouees.map((r) => `<li>${r}</li>`).join("")}</ul>`
    : `<p class="slot-libre">Aucune run jouée ici… pour l'instant.</p>`;

  sidebarContent.innerHTML = `
    <div class="run-kicker">District</div>
    <div class="run-titre">${d.nom}</div>
    <div class="run-meta">
      <div class="meta-item"><div class="meta-label">Contrôlé par</div>
        <div class="meta-value">${d.gang_dominant}</div></div>
      <div class="meta-item"><div class="meta-label">Aussi présents</div>
        <div class="meta-value meta-value-small">${d.gangs_presents.join(", ")}</div></div>
    </div>
    <div class="section-title">Runs disponibles</div>
    <ul class="runs-district">${listeRuns}</ul>
    <div class="section-title">Runs jouées</div>
    ${runsJouees}
  `;

  sidebarContent.querySelectorAll(".run-lien[data-run]").forEach((li) => {
    li.addEventListener("click", () => {
      const run = RUNS.find((r) => r.id === li.dataset.run);
      if (run) ouvrirSidebar(run);
    });
  });

  sidebar.classList.add("open");
  sidebar.setAttribute("aria-hidden", "false");
}

// ---------- Barre de statut : coordonnées pixel sous le curseur ----------
// (pratique pour relever des positions de pins à la main)

const statusCoords = document.getElementById("status-coords");
map.on("mousemove", (e) => {
  const x = Math.round(e.latlng.lng);
  const y = Math.round(H - e.latlng.lat);
  statusCoords.textContent = `x:${x} y:${y}`;
});

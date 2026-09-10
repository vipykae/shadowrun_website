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

  const runsJouees = d.runs_jouees.length
    ? `<div class="tip-runs">Runs jouées : ${d.runs_jouees.join(", ")}</div>`
    : `<div class="tip-runs">Aucune run jouée ici… pour l'instant.</div>`;

  poly.bindTooltip(
    `<h3>${d.nom}</h3>
     <div class="tip-row"><span class="tip-label">Contrôlé par</span><br>${d.gang_dominant}</div>
     <div class="tip-row"><span class="tip-label">Aussi présents</span><br>${d.gangs_presents.join(", ")}</div>
     ${runsJouees}`,
    { className: "district-tip", sticky: true }
  );

  poly.on("mouseover", () => poly.setStyle({ opacity: 0.9, fillOpacity: 0.12, weight: 2 }));
  poly.on("mouseout", () => poly.setStyle({ opacity: 0.35, fillOpacity: 0.03, weight: 1.5 }));
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
map.on("click", fermerSidebar);

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
    <div class="run-kicker">${district ? district.nom : ""} · ${dateFmt}</div>
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

// ---------- Barre de statut : coordonnées pixel sous le curseur ----------
// (pratique pour relever des positions de pins à la main)

const statusCoords = document.getElementById("status-coords");
map.on("mousemove", (e) => {
  const x = Math.round(e.latlng.lng);
  const y = Math.round(H - e.latlng.lat);
  statusCoords.textContent = `x:${x} y:${y}`;
});

// ============================================================
// Onglet Historique : tableau de toutes les runs, avec filtres (district,
// statut, recherche texte). Lit DONNEES.runs / DONNEES.districts, déjà
// chargées par app.js — pas d'appel API séparé, pas de rafraîchissement
// automatique (même logique que l'onglet Personnages : on relit au moment
// d'ouvrir l'onglet, pas en continu).
// ============================================================

const historique = (() => {
  let vueActive = false;

  const corps = () => document.getElementById("corps-tableau-runs");
  const vide = () => document.getElementById("historique-vide");
  const selectDistrict = () => document.getElementById("filtre-district");
  const selectStatut = () => document.getElementById("filtre-statut");
  const champRecherche = () => document.getElementById("filtre-recherche");

  // ---------- Vue (bascule carte / historique) ----------

  function estActive() {
    return vueActive;
  }

  function afficherVue() {
    if (typeof personnages !== "undefined" && personnages.estActive()) personnages.masquerVue();
    vueActive = true;
    document.getElementById("map").hidden = true;
    document.getElementById("historique").hidden = false;
    document.getElementById("btn-historique").querySelector(".txt").textContent = "CARTE";
    document.getElementById("btn-historique").querySelector(".ico").textContent = "🗺";
    document.getElementById("btn-nouvelle-run").hidden = true;
    document.getElementById("btn-filtre").hidden = true;
    document.getElementById("btn-vue").hidden = true;
    fermerSidebar();
    remplirDistricts();
    rafraichirTableau();
  }

  function masquerVue() {
    vueActive = false;
    document.getElementById("map").hidden = false;
    document.getElementById("historique").hidden = true;
    document.getElementById("btn-historique").querySelector(".txt").textContent = "HISTORIQUE";
    document.getElementById("btn-historique").querySelector(".ico").textContent = "🗒";
    document.getElementById("btn-nouvelle-run").hidden = ROLE !== "mj";
    document.getElementById("btn-filtre").hidden = false;
    document.getElementById("btn-vue").hidden = false;
    fermerSidebar();
  }

  // ---------- Tableau ----------

  function remplirDistricts() {
    const select = selectDistrict();
    const valeurActuelle = select.value;
    select.innerHTML = '<option value="">Tous les districts</option>' +
      DONNEES.districts.map((d) => `<option value="${d.id}">${echapper(d.nom)}</option>`).join("");
    select.value = valeurActuelle;
  }

  function correspondStatut(run, filtre) {
    if (filtre === "toutes") return true;
    if (filtre === "jouee") return estJouee(run);
    if (filtre === "annulee") return statutDe(run) === "annulee";
    return estAVenir(run); // "a-venir", valeur par défaut du filtre
  }

  const LIBELLES_STATUT = { ouverte: "Ouverte", complete: "Complète", jouee: "Jouée", annulee: "Annulée" };

  function ligneRun(run) {
    const info = infoDate(run);
    const district = DONNEES.districts.find((d) => d.id === run.district);
    const statut = statutDe(run);
    const difficulte = run.difficulte ? "●".repeat(run.difficulte) + "○".repeat(5 - run.difficulte) : "—";
    return `<tr data-run="${echapper(run.id)}" class="ligne-run ligne-run-${statut}">
      <td>${echapper(run.titre)}</td>
      <td>${echapper(district ? district.nom : run.district)}</td>
      <td>${echapper(info.texte)}</td>
      <td>${echapper(LIBELLES_STATUT[statut] || statut)}</td>
      <td>${run.inscrites.length}/${run.places}</td>
      <td>${difficulte}</td>
    </tr>`;
  }

  function rafraichirTableau() {
    const filtreDistrict = selectDistrict().value;
    const filtreStatut = selectStatut().value;
    const recherche = champRecherche().value.trim().toLowerCase();

    const runs = DONNEES.runs
      .filter((run) => !filtreDistrict || run.district === filtreDistrict)
      .filter((run) => correspondStatut(run, filtreStatut))
      .filter((run) => !recherche || run.titre.toLowerCase().includes(recherche));

    corps().innerHTML = runs.map(ligneRun).join("");
    vide().hidden = runs.length > 0;
  }

  // ---------- Événements ----------

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btn-historique").addEventListener("click", () => {
      estActive() ? masquerVue() : afficherVue();
    });

    [selectDistrict(), selectStatut()].forEach((el) => el.addEventListener("change", rafraichirTableau));
    champRecherche().addEventListener("input", rafraichirTableau);

    corps().addEventListener("click", (evt) => {
      const tr = evt.target.closest("tr[data-run]");
      if (!tr) return;
      const run = DONNEES.runs.find((r) => r.id === tr.dataset.run);
      if (run) ouvrirSidebarRun(run);
    });

    // Clic sur le fond de l'onglet (hors ligne du tableau) : referme la
    // sidebar, même logique que pour la carte et l'onglet Personnages.
    document.getElementById("historique").addEventListener("click", (evt) => {
      if (!evt.target.closest("tr[data-run]")) fermerSidebar();
    });
  });

  return { estActive, afficherVue, masquerVue };
})();

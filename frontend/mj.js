// ============================================================
// Interface MJ : création / modification / suppression de runs,
// placement du pin au clic sur la carte, édition des districts.
// Les fichiers YAML restent la source de vérité : l'API les écrit.
// ============================================================

const mj = (() => {
  const STATUTS = [
    ["ouverte", "Ouverte aux inscriptions"],
    ["complete", "Complète (inscriptions fermées)"],
    ["jouee", "Jouée"],
    ["annulee", "Annulée"],
  ];

  let placement = null;     // formulaire en attente d'un clic sur la carte
  let marqueurTemp = null;  // pin blanc pendant l'édition
  let idModifieALaMain = false;

  const contenu = () => document.getElementById("sidebar-content");
  const val = (v) => echapper(v ?? "");

  function slug(texte) {
    return String(texte).normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }

  function champ(label, html, aide) {
    return `<label class="champ"><span class="champ-label">${label}</span>${html}
            ${aide ? `<span class="champ-aide">${aide}</span>` : ""}</label>`;
  }

  // ---------- Barres d'actions dans les fiches ----------

  function actionsRun(run) {
    return `<div class="mj-actions">
      <span class="mj-label">MJ</span>
      <button class="btn btn-secondaire" data-mj-action="modifier" data-run="${val(run.id)}">✎ Modifier</button>
      ${estJouee(run) ? "" : `<button class="btn btn-secondaire" data-mj-action="jouee" data-run="${val(run.id)}">✓ Marquer jouée</button>`}
      <button class="btn btn-danger" data-mj-action="supprimer" data-run="${val(run.id)}">✕ Supprimer</button>
    </div>`;
  }

  function actionsDistrict(d) {
    return `<div class="mj-actions">
      <span class="mj-label">MJ</span>
      <button class="btn btn-secondaire" data-mj-action="modifier-district" data-district="${val(d.id)}">✎ Modifier le district</button>
    </div>`;
  }

  // ---------- Formulaire run ----------

  function formulaireRun(run, options = {}) {
    const creation = !run;
    const r = run || {
      statut: "ouverte", places: 4, difficulte: 3, themes: [], avertissements: [],
      position: [Math.round(DONNEES.carte.largeur / 2), Math.round(DONNEES.carte.hauteur / 2)],
    };
    const statut = options.statut || r.statut || "ouverte";
    idModifieALaMain = false;

    const optionsDistricts = DONNEES.districts
      .map((d) => `<option value="${val(d.id)}" ${d.id === r.district ? "selected" : ""}>${val(d.nom)}</option>`).join("");
    const optionsStatuts = STATUTS
      .map(([v, l]) => `<option value="${v}" ${v === statut ? "selected" : ""}>${l}</option>`).join("");

    contenu().innerHTML = `
      <div class="run-kicker">${creation ? "Nouvelle run" : "Modification"}</div>
      <div class="run-titre">${creation ? "Nouvelle run" : val(r.titre)}</div>
      <form id="form-run" class="formulaire" autocomplete="off" ${creation ? 'data-creation="1"' : ""}>
        ${champ("Titre", `<input name="titre" required maxlength="120" value="${val(r.titre)}">`)}
        ${champ("Identifiant", `<input name="id" required pattern="[a-z0-9][a-z0-9\\-]*" ${creation ? "" : "readonly"} value="${val(r.id)}">`,
                creation ? "minuscules, chiffres, tirets — proposé depuis le titre" : "non modifiable")}
        <div class="champ-ligne">
          ${champ("District", `<select name="district">${optionsDistricts}</select>`)}
          ${champ("Statut", `<select name="statut">${optionsStatuts}</select>`)}
        </div>
        <div class="champ-ligne">
          ${champ("MJ", `<input name="mj" maxlength="60" value="${val(r.mj)}">`)}
          ${champ("Type", `<input name="type" maxlength="60" value="${val(r.type)}" placeholder="One-shot, Run avec suite…">`)}
        </div>
        <div class="champ-ligne">
          ${champ("Places", `<input name="places" type="number" min="1" max="12" value="${r.places ?? 4}">`)}
          ${champ("Difficulté", `<input name="difficulte" type="number" min="1" max="5" value="${r.difficulte ?? 3}">`)}
          ${champ("Durée", `<input name="duree_estimee" maxlength="40" value="${val(r.duree_estimee)}" placeholder="3h30">`)}
        </div>
        ${champ("Date", `<div class="champ-date">
            <input name="date" maxlength="300" value="${val(r.date)}" placeholder="2026-02-05T20:30 · lien de sondage · texte libre">
            <input type="datetime-local" id="date-picker" class="cache" tabindex="-1">
            <button type="button" class="btn btn-secondaire" data-mj-action="choisir-date" title="Choisir une date fixe">▦</button>
          </div>`)}
        ${champ("Position du pin", `<div class="champ-position">
            <input name="x" type="number" min="0" value="${r.position[0]}"> <input name="y" type="number" min="0" value="${r.position[1]}">
            <button type="button" class="btn btn-secondaire" data-mj-action="placer">◎ Placer sur la carte</button>
          </div>`)}
        ${champ("Lieu", `<input name="lieu" maxlength="300" value="${val(r.lieu)}">`)}
        ${champ("Paiement", `<input name="paiement" maxlength="300" value="${val(r.paiement)}">`)}
        ${champ("Thèmes", `<input name="themes" value="${val((r.themes || r.tags || []).join(", "))}">`, "séparés par des virgules")}
        ${champ("Avertissements de contenu", `<input name="avertissements" value="${val((r.avertissements || []).join(", "))}">`, "séparés par des virgules")}
        ${champ("Brief", `<textarea name="brief" rows="5">${val(r.brief || r.synopsis)}</textarea>`)}
        ${champ("Risques", `<textarea name="risques" rows="3">${val(r.risques)}</textarea>`)}
        ${champ("Recommandé", `<textarea name="notes" rows="3">${val(r.notes)}</textarea>`)}
        ${champ("Compte rendu", `<textarea name="compte_rendu" rows="4">${val(r.compte_rendu)}</textarea>`, "à remplir quand la run est jouée")}
        <div class="formulaire-actions">
          <button type="submit" class="btn">${creation ? "Créer la run" : "Enregistrer"}</button>
          <button type="button" class="btn btn-secondaire" data-mj-action="annuler" data-run="${val(r.id)}">Annuler</button>
        </div>
        <div class="sidebar-erreur" id="sidebar-erreur"></div>
      </form>`;

    ouvrirSidebar();
    afficherMarqueurTemp(r.position[0], r.position[1]);
    if (options.focus) {
      const cible = contenu().querySelector(`[name="${options.focus}"]`);
      if (cible) setTimeout(() => { cible.focus(); cible.scrollIntoView({ block: "center" }); }, 350);
    }
  }

  function lireFormulaireRun(form) {
    const f = new FormData(form);
    const texte = (nom) => String(f.get(nom) ?? "");
    const liste = (nom) => texte(nom).split(",").map((s) => s.trim()).filter(Boolean);
    return {
      id: texte("id").trim(), titre: texte("titre"), district: texte("district"),
      position: [Number(f.get("x")), Number(f.get("y"))],
      mj: texte("mj"), type: texte("type"), places: Number(f.get("places")), statut: texte("statut"),
      date: texte("date"), duree_estimee: texte("duree_estimee"), lieu: texte("lieu"), paiement: texte("paiement"),
      difficulte: Number(f.get("difficulte")), risques: texte("risques"),
      themes: liste("themes"), avertissements: liste("avertissements"),
      notes: texte("notes"), brief: texte("brief"), compte_rendu: texte("compte_rendu"),
    };
  }

  async function enregistrerRun(form) {
    const creation = !!form.dataset.creation;
    const donnees = lireFormulaireRun(form);
    try {
      const run = creation
        ? await api("/api/mj/runs", donnees)
        : await api(`/api/mj/runs/${donnees.id}`, donnees, "PUT");
      nettoyer();
      await rafraichir();
      ouvrirSidebarRun(DONNEES.runs.find((r) => r.id === run.id));
    } catch (e) {
      afficherErreur(e.message);
    }
  }

  async function supprimerRun(run) {
    if (!confirm(`Supprimer définitivement « ${run.titre} » ?\nLe fichier YAML et les inscriptions seront effacés.`)) return;
    try {
      await api(`/api/mj/runs/${run.id}`, null, "DELETE");
      nettoyer();
      await rafraichir();
      fermerSidebar();
    } catch (e) {
      afficherErreur(e.message);
    }
  }

  // ---------- Formulaire district ----------

  function formulaireDistrict(d) {
    contenu().innerHTML = `
      <div class="run-kicker">Modification du district</div>
      <div class="run-titre">${val(d.nom)}</div>
      <form id="form-district" class="formulaire" autocomplete="off" data-district="${val(d.id)}">
        ${champ("Nom", `<input name="nom" required maxlength="80" value="${val(d.nom)}">`)}
        ${champ("Gang dominant", `<input name="gang_dominant" maxlength="120" value="${val(d.gang_dominant)}">`)}
        ${champ("Autres gangs présents", `<input name="gangs_presents" value="${val((d.gangs_presents || []).join(", "))}">`, "séparés par des virgules")}
        ${champ("Description", `<textarea name="description" rows="4">${val(d.description)}</textarea>`)}
        ${champ("Historique", `<textarea name="runs_jouees" rows="3">${val((d.runs_jouees || []).join("\n"))}</textarea>`,
                "runs jouées avant le site, une par ligne")}
        <div class="formulaire-actions">
          <button type="submit" class="btn">Enregistrer</button>
          <button type="button" class="btn btn-secondaire" data-mj-action="annuler-district" data-district="${val(d.id)}">Annuler</button>
        </div>
        <div class="sidebar-erreur" id="sidebar-erreur"></div>
      </form>`;
    ouvrirSidebar();
  }

  async function enregistrerDistrict(form) {
    const f = new FormData(form);
    const id = form.dataset.district;
    const donnees = {
      nom: f.get("nom"),
      gang_dominant: f.get("gang_dominant"),
      gangs_presents: String(f.get("gangs_presents") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      description: f.get("description"),
      runs_jouees: String(f.get("runs_jouees") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    };
    try {
      await api(`/api/mj/districts/${id}`, donnees, "PUT");
      await rafraichir();
      ouvrirSidebarDistrict(DONNEES.districts.find((x) => x.id === id));
    } catch (e) {
      afficherErreur(e.message);
    }
  }

  // ---------- Placement du pin ----------

  function afficherMarqueurTemp(x, y) {
    if (marqueurTemp) marqueurTemp.remove();
    marqueurTemp = L.marker(px(x, y), {
      interactive: false,
      icon: L.divIcon({
        className: "",
        html: `<div class="pin pin-temp"><div class="pin-ring"></div><div class="pin-core"></div></div>`,
        iconSize: [22, 22], iconAnchor: [11, 11],
      }),
    }).addTo(map);
  }

  function commencerPlacement() {
    const form = document.getElementById("form-run");
    if (!form) return;
    placement = form;
    document.getElementById("map").classList.add("placement");
    document.getElementById("status-runs").textContent = "Clique sur la carte pour placer le pin — Échap pour annuler";
  }

  function finPlacement() {
    placement = null;
    document.getElementById("map").classList.remove("placement");
    if (DONNEES) appliquerFiltre(); // restaure le texte de la barre de statut
  }

  // Appelé par app.js sur chaque clic carte. Renvoie true si le clic est consommé.
  function clicCarte(evt) {
    if (placement) {
      const x = Math.round(evt.latlng.lng);
      const y = Math.round(DONNEES.carte.hauteur - evt.latlng.lat);
      placement.elements.x.value = x;
      placement.elements.y.value = y;
      afficherMarqueurTemp(x, y);
      finPlacement();
      return true;
    }
    // Un formulaire ouvert ne se ferme pas sur un clic carte accidentel.
    return !!document.getElementById("form-run") || !!document.getElementById("form-district");
  }

  // Retire le pin temporaire et sort du mode placement (changement de panneau).
  function nettoyer() {
    finPlacement();
    if (marqueurTemp) { marqueurTemp.remove(); marqueurTemp = null; }
  }

  // ---------- Événements (délégation sur la sidebar) ----------

  function afficherErreur(message) {
    const zone = document.getElementById("sidebar-erreur");
    if (zone) { zone.textContent = message; zone.scrollIntoView({ block: "nearest" }); }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const zone = contenu();

    zone.addEventListener("click", (evt) => {
      const cible = evt.target.closest("[data-mj-action]");
      if (!cible) return;
      const run = DONNEES.runs.find((r) => r.id === cible.dataset.run);
      const district = DONNEES.districts.find((d) => d.id === cible.dataset.district);
      switch (cible.dataset.mjAction) {
        case "modifier": formulaireRun(run); break;
        case "jouee": formulaireRun(run, { statut: "jouee", focus: "compte_rendu" }); break;
        case "supprimer": supprimerRun(run); break;
        case "placer": commencerPlacement(); break;
        case "choisir-date": {
          const picker = document.getElementById("date-picker");
          try { picker.showPicker(); } catch { picker.classList.remove("cache"); picker.focus(); }
          break;
        }
        case "annuler": nettoyer(); run ? ouvrirSidebarRun(run) : fermerSidebar(); break;
        case "modifier-district": formulaireDistrict(district); break;
        case "annuler-district": ouvrirSidebarDistrict(district); break;
      }
    });

    // NB : l'input nommé « id » masque la propriété form.id — on lit l'attribut.
    zone.addEventListener("submit", (evt) => {
      evt.preventDefault();
      const quel = evt.target.getAttribute("id");
      if (quel === "form-run") enregistrerRun(evt.target);
      if (quel === "form-district") enregistrerDistrict(evt.target);
    });

    zone.addEventListener("input", (evt) => {
      const form = evt.target.form;
      if (!form || form.getAttribute("id") !== "form-run" || !form.dataset.creation) return;
      if (evt.target.name === "id") idModifieALaMain = true;
      if (evt.target.name === "titre" && !idModifieALaMain) form.elements.id.value = slug(evt.target.value);
    });

    zone.addEventListener("change", (evt) => {
      if (evt.target.id === "date-picker" && evt.target.value) {
        evt.target.form.elements.date.value = evt.target.value;
      }
    });

    document.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape" && placement) finPlacement();
    });
  });

  return { actionsRun, actionsDistrict, formulaireRun, clicCarte, nettoyer };
})();

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

  // Nom (pas l'URL complète) d'une image de run envoyée pendant l'édition
  // en cours et pas encore confirmée par un enregistrement — voir
  // personnages.js, même logique.
  let uploadEnAttente = null;

  const contenu = () => document.getElementById("sidebar-content");
  const val = (v) => echapper(v ?? "");

  function nomUpload(url) {
    return url && url.startsWith("/api/uploads/") ? url.slice("/api/uploads/".length) : null;
  }

  function nettoyerUploadEnAttente() {
    if (!uploadEnAttente) return;
    const nom = uploadEnAttente;
    uploadEnAttente = null;
    fetch(`/api/uploads/${nom}`, { method: "DELETE" }).catch(() => {});
  }

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
    nettoyerUploadEnAttente(); // un formulaire déjà ouvert (autre run) est abandonné
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
        ${champ("Fixer", `<input name="fixer" list="datalist-noms-persos" maxlength="200" value="${val(r.fixer)}">`,
                "un PJ/PNJ existant (suggestions) ou texte libre — devient cliquable si le nom correspond")}
        ${champ("Autres persos probables", `<input name="autres_personnages_probables" value="${val((r.autres_personnages_probables || []).join(", "))}">`,
                "séparés par des virgules — mêmes règles que Fixer")}
        <datalist id="datalist-noms-persos">${personnages.tousLesNoms().map((n) => `<option value="${val(n)}">`).join("")}</datalist>
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
        ${champ("Image (optionnelle)", `<div class="champ-image">
              <div class="champ-image-apercu" id="run-apercu-image">${r.image ? `<img src="${val(r.image)}" alt="">` : `<span class="champ-image-vide">Aucune image</span>`}</div>
              <div class="champ-image-boutons">
                <label class="btn btn-secondaire champ-image-parcourir">
                  Choisir un fichier…
                  <input type="file" id="run-image-fichier" accept="image/*" class="cache">
                </label>
                <button type="button" class="btn btn-secondaire" id="run-btn-retirer-image" data-mj-action="retirer-image" ${r.image ? "" : "hidden"}>✕ Retirer</button>
              </div>
              <input type="hidden" name="image" value="${val(r.image)}">
            </div>`, "compressée automatiquement à l'envoi ; publiée avec la run sur Discord")}
        ${champ("Thèmes", `<input name="themes" value="${val((r.themes || r.tags || []).join(", "))}">`, "séparés par des virgules")}
        ${champ("Avertissements de contenu", `<input name="avertissements" value="${val((r.avertissements || []).join(", "))}">`, "séparés par des virgules")}
        ${champ("Brief", `<textarea name="brief" rows="5">${val(r.brief || r.synopsis)}</textarea>`)}
        ${champ("Risques", `<textarea name="risques" rows="3">${val(r.risques)}</textarea>`)}
        ${champ("Recommandé", `<textarea name="notes" rows="3">${val(r.notes)}</textarea>`)}
        ${champ("Compte rendu", `<textarea name="compte_rendu" rows="4">${val(r.compte_rendu)}</textarea>`, "à remplir quand la run est jouée ; posté dans le post Discord de la run")}
        ${champ("Flash news", `<textarea name="flash_news" rows="2" maxlength="1000">${val(r.flash_news)}</textarea>`, "une ou deux phrases sur ce que la run a changé dans le monde ; postée dans le salon Discord flash news quand la run passe en jouée")}
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
      fixer: texte("fixer"), autres_personnages_probables: liste("autres_personnages_probables"),
      themes: liste("themes"), avertissements: liste("avertissements"),
      notes: texte("notes"), brief: texte("brief"), image: texte("image"),
      compte_rendu: texte("compte_rendu"), flash_news: texte("flash_news"),
    };
  }

  async function enregistrerRun(form) {
    const creation = !!form.dataset.creation;
    const donnees = lireFormulaireRun(form);
    try {
      const run = creation
        ? await api("/api/mj/runs", donnees)
        : await api(`/api/mj/runs/${donnees.id}`, donnees, "PUT");
      uploadEnAttente = null; // enregistré avec succès : on ne l'efface plus
      nettoyer();
      await rafraichir();
      ouvrirSidebarRun(DONNEES.runs.find((r) => r.id === run.id));
    } catch (e) {
      afficherErreur(e.message);
    }
  }

  // ---------- Envoi d'image (compressée côté serveur) ----------

  async function televerserFichier(fichier) {
    const donnees = new FormData();
    donnees.append("fichier", fichier, "image.jpg");
    const reponse = await fetch("/api/uploads/image", { method: "POST", body: donnees });
    if (!reponse.ok) {
      let message = `Erreur ${reponse.status}`;
      try { message = (await reponse.json()).detail || message; } catch {}
      throw new Error(message);
    }
    return reponse.json(); // { url }
  }

  async function surChoixFichierRun(input) {
    const fichier = input.files[0];
    if (!fichier) return;
    const form = input.closest("form");
    const apercu = form.querySelector("#run-apercu-image");

    // Même cadrage manuel que pour les portraits de personnages (voir crop.js).
    const recadre = await crop.ouvrir(fichier);
    input.value = "";
    if (!recadre) return; // annulé depuis le recadrage

    apercu.innerHTML = `<span class="champ-image-vide">Envoi…</span>`;
    try {
      const { url } = await televerserFichier(recadre);
      nettoyerUploadEnAttente();
      uploadEnAttente = nomUpload(url);
      form.elements.image.value = url;
      apercu.innerHTML = `<img src="${val(url)}" alt="">`;
      form.querySelector("#run-btn-retirer-image").hidden = false;
    } catch (e) {
      apercu.innerHTML = `<span class="champ-image-vide">Échec : ${val(e.message)}</span>`;
    }
  }

  function retirerImageRun(bouton) {
    const form = bouton.closest("form");
    if (nomUpload(form.elements.image.value) === uploadEnAttente) {
      nettoyerUploadEnAttente();
    }
    form.elements.image.value = "";
    form.querySelector("#run-apercu-image").innerHTML = `<span class="champ-image-vide">Aucune image</span>`;
    bouton.hidden = true;
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
    const fiche = d.fiche || {};
    contenu().innerHTML = `
      <div class="run-kicker">Modification du district</div>
      <div class="run-titre">${val(d.nom)}</div>
      <form id="form-district" class="formulaire" autocomplete="off" data-district="${val(d.id)}">
        ${champ("Nom", `<input name="nom" required maxlength="80" value="${val(d.nom)}">`)}
        ${champ("Gang dominant", `<input name="gang_dominant" maxlength="120" value="${val(d.gang_dominant)}">`)}
        ${champ("Autres gangs présents", `<input name="gangs_presents" value="${val((d.gangs_presents || []).join(", "))}">`, "séparés par des virgules")}
        ${champ("Mégacorp dominante", `<input name="megacorp_dominante" maxlength="120" value="${val(d.megacorp_dominante)}">`)}
        ${champ("Autres mégacorps présentes", `<input name="megacorps_presentes" value="${val((d.megacorps_presentes || []).join(", "))}">`, "séparées par des virgules")}
        ${champ("Autre faction dominante", `<input name="autre_faction_dominante" maxlength="120" value="${val(d.autre_faction_dominante)}">`, "syndicat, politigroupe, organisation gouvernementale...")}
        ${champ("Autres factions présentes", `<input name="autres_factions_presentes" value="${val((d.autres_factions_presentes || []).join(", "))}">`, "séparées par des virgules")}
        ${champ("Description", `<textarea name="description" rows="4">${val(d.description)}</textarea>`)}
        <div class="section-title">Fiche complète</div>
        ${champ("Population", `<input name="fiche_population" maxlength="300" value="${val(fiche.population)}">`)}
        ${champ("Indice de sûreté", `<input name="fiche_indice_surete" maxlength="20" value="${val(fiche.indice_surete)}">`, "ex. A, AA, B, Z")}
        ${champ("Ambiance", `<textarea name="fiche_ambiance" rows="2">${val(fiche.ambiance)}</textarea>`)}
        ${champ("À voir", `<textarea name="fiche_a_voir" rows="3">${val(fiche.a_voir)}</textarea>`)}
        ${champ("Lieux sensibles", `<textarea name="fiche_lieux_sensibles" rows="3">${val(fiche.lieux_sensibles)}</textarea>`)}
        ${champ("Faire attention à", `<textarea name="fiche_faire_attention_a" rows="3">${val(fiche.faire_attention_a)}</textarea>`)}
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
    const listeVirgules = (nom) => String(f.get(nom) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const donnees = {
      nom: f.get("nom"),
      gang_dominant: f.get("gang_dominant"),
      gangs_presents: listeVirgules("gangs_presents"),
      megacorp_dominante: f.get("megacorp_dominante"),
      megacorps_presentes: listeVirgules("megacorps_presentes"),
      autre_faction_dominante: f.get("autre_faction_dominante"),
      autres_factions_presentes: listeVirgules("autres_factions_presentes"),
      description: f.get("description"),
      fiche: {
        population: f.get("fiche_population"),
        indice_surete: f.get("fiche_indice_surete"),
        ambiance: f.get("fiche_ambiance"),
        a_voir: f.get("fiche_a_voir"),
        lieux_sensibles: f.get("fiche_lieux_sensibles"),
        faire_attention_a: f.get("fiche_faire_attention_a"),
      },
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
    marqueurTemp = L.marker(px(x, y), { interactive: false, icon: iconeDivPin("pin-temp") }).addTo(map);
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
      const H = DONNEES.carte.hauteur;
      const W = DONNEES.carte.largeur;
      // Bornage : impossible de placer un pin hors de l'image de la carte,
      // même en cliquant dans la marge morte autour (map.setMaxBounds).
      const x = Math.round(Math.min(Math.max(evt.latlng.lng, 0), W));
      const y = Math.round(Math.min(Math.max(H - evt.latlng.lat, 0), H));
      placement.elements.x.value = x;
      placement.elements.y.value = y;
      afficherMarqueurTemp(x, y);
      finPlacement();
      return true;
    }
    // Un formulaire ouvert ne se ferme pas sur un clic carte accidentel.
    return !!document.getElementById("form-run") || !!document.getElementById("form-district");
  }

  // Distinct de clicCarte() : sert à app.js pour savoir, sur un clic
  // district/pin, s'il faut capturer la position (placement actif) ou
  // ouvrir la fiche normalement. clicCarte() seul ne suffit pas ici — son
  // "un formulaire est ouvert" (hors placement) doit bloquer un clic carte
  // accidentel, pas un clic district volontaire.
  function enPlacement() {
    return !!placement;
  }

  // Retire le pin temporaire, sort du mode placement et efface un envoi
  // d'image non sauvegardé — appelé à chaque fois qu'on quitte un formulaire.
  function nettoyer() {
    finPlacement();
    if (marqueurTemp) { marqueurTemp.remove(); marqueurTemp = null; }
    nettoyerUploadEnAttente();
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
      if (cible.dataset.mjAction === "retirer-image") { retirerImageRun(cible); return; }
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
      if (evt.target.id === "run-image-fichier") {
        surChoixFichierRun(evt.target);
      }
    });

    document.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape" && placement) finPlacement();
    });
  });

  return { actionsRun, actionsDistrict, formulaireRun, clicCarte, enPlacement, nettoyer };
})();

// ============================================================
// Onglet Personnages : galerie des PJ et PNJ.
// Permissions (différentes de mj.js) : un PJ se modifie par n'importe
// qui de connecté (joueuse ou MJ) ; un PNJ ne se modifie que par la MJ.
// Les fichiers YAML restent la source de vérité, comme pour les runs.
// ============================================================

const personnages = (() => {
  let donnees = { pj: [], pnj: [] };
  let vueActive = false;
  let idModifieALaMain = false;

  // Nom (pas l'URL complète) d'une image envoyée pendant la session
  // d'édition en cours et pas encore confirmée par un enregistrement —
  // permet de l'effacer du serveur si elle est remplacée ou abandonnée.
  let uploadEnAttente = null;

  const grillePJ = () => document.getElementById("grille-pj");
  const grillePNJ = () => document.getElementById("grille-pnj");
  const zone = () => document.getElementById("sidebar-content");
  const val = (v) => echapper(v ?? "");

  function nomUpload(url) {
    return url && url.startsWith("/api/uploads/") ? url.slice("/api/uploads/".length) : null;
  }

  // Best-effort : n'empêche jamais la suite du travail si ça échoue.
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

  function peutEditer(type) {
    return type === "pj" || ROLE === "mj";
  }

  // ---------- Vue (bascule carte / personnages) ----------

  function estActive() {
    return vueActive;
  }

  async function afficherVue() {
    if (typeof historique !== "undefined" && historique.estActive()) historique.masquerVue();
    vueActive = true;
    document.getElementById("map").hidden = true;
    document.getElementById("personnages").hidden = false;
    document.getElementById("btn-vue").querySelector(".txt").textContent = "CARTE";
    document.getElementById("btn-vue").querySelector(".ico").textContent = "🗺";
    document.getElementById("btn-nouvelle-run").hidden = true;
    document.getElementById("btn-filtre").hidden = true;
    document.getElementById("btn-historique").hidden = true;
    document.getElementById("btn-nouveau-perso").hidden = false;
    fermerSidebar();
    await charger();
  }

  function masquerVue() {
    vueActive = false;
    document.getElementById("map").hidden = false;
    document.getElementById("personnages").hidden = true;
    document.getElementById("btn-vue").querySelector(".txt").textContent = "PERSONNAGES";
    document.getElementById("btn-vue").querySelector(".ico").textContent = "▣";
    document.getElementById("btn-nouvelle-run").hidden = ROLE !== "mj";
    document.getElementById("btn-filtre").hidden = false;
    document.getElementById("btn-historique").hidden = false;
    document.getElementById("btn-nouveau-perso").hidden = true;
    fermerSidebar();
  }

  // ---------- Galerie ----------

  function carteHtml(perso, type) {
    const sousTitre = type === "pj"
      ? [perso.archetype, perso.joueuse ? `jouée par ${perso.joueuse}` : null].filter(Boolean).join(" · ")
      : [perso.archetype, perso.faction].filter(Boolean).join(" · ");
    const vignette = perso.image
      ? `<div class="perso-card-img" style="background-image:url('${val(perso.image)}')"></div>`
      : `<div class="perso-card-img perso-card-img-vide">${val((perso.nom || "?")[0].toUpperCase())}</div>`;
    return `<div class="perso-card" data-id="${val(perso.id)}" data-type="${type}">
      ${vignette}
      <div class="perso-card-nom">${val(perso.nom)}</div>
      ${sousTitre ? `<div class="perso-card-sub">${val(sousTitre)}</div>` : ""}
    </div>`;
  }

  async function charger() {
    donnees = await api("/api/personnages");
    grillePJ().innerHTML = donnees.pj.length
      ? donnees.pj.map((p) => carteHtml(p, "pj")).join("")
      : `<p class="perso-vide">Aucun personnage joueuse pour l'instant.</p>`;
    grillePNJ().innerHTML = donnees.pnj.length
      ? donnees.pnj.map((p) => carteHtml(p, "pnj")).join("")
      : `<p class="perso-vide">Aucun PNJ notable pour l'instant.</p>`;
  }

  function trouver(id, type) {
    return (type === "pj" ? donnees.pj : donnees.pnj).find((p) => p.id === id);
  }

  // Recherche par nom (insensible à la casse/espaces) plutôt que par id : les
  // champs "fixer", "autres persos probables" et "inscrites" d'une run sont
  // du texte libre, pas des références — un nom qui correspond à un PJ/PNJ
  // existant devient cliquable (voir lienPersoOuTexte dans app.js).
  function trouverParNom(nom) {
    if (!nom) return null;
    const cible = String(nom).trim().toLowerCase();
    if (!cible) return null;
    const pj = donnees.pj.find((p) => p.nom.trim().toLowerCase() === cible);
    if (pj) return { perso: pj, type: "pj" };
    const pnj = donnees.pnj.find((p) => p.nom.trim().toLowerCase() === cible);
    if (pnj) return { perso: pnj, type: "pnj" };
    return null;
  }

  // Tous les noms existants (PJ + PNJ), pour peupler un <datalist> de
  // suggestion dans les formulaires (sélection ou texte libre).
  function tousLesNoms() {
    return [...donnees.pj, ...donnees.pnj].map((p) => p.nom);
  }

  // ---------- Fiche (sidebar, lecture) ----------

  function ouvrirFiche(perso, type) {
    nettoyerUploadEnAttente(); // on quitte un éventuel formulaire : abandon de son envoi non sauvegardé
    const nomDistrict = perso.district && typeof DONNEES !== "undefined"
      ? (DONNEES.districts.find((d) => d.id === perso.district)?.nom || perso.district)
      : null;

    const lignesMeta = type === "pj"
      ? [["Jouée par", perso.joueuse], ["Archétype", perso.archetype]]
      : [["Faction", perso.faction], ["Archétype", perso.archetype], ["District", nomDistrict]];
    const metaHtml = lignesMeta
      .filter(([, v]) => v)
      .map(([label, v]) => `<div class="meta-item"><div class="meta-label">${label}</div><div class="meta-value">${val(v)}</div></div>`)
      .join("");

    zone().innerHTML = `
      <div class="run-kicker">${type === "pj" ? "Personnage joueuse" : "PNJ"}</div>
      <div class="run-titre">${val(perso.nom)}</div>
      ${perso.image ? `<img class="perso-portrait" src="${val(perso.image)}" alt="">` : ""}
      ${metaHtml ? `<div class="run-meta">${metaHtml}</div>` : ""}
      ${perso.concept ? `<div class="section-title">Concept</div><p class="run-synopsis">${val(perso.concept)}</p>` : ""}
      ${perso.notes ? `<div class="section-title">Notes</div><p class="run-texte">${val(perso.notes)}</p>` : ""}
      ${peutEditer(type) ? `<div class="mj-actions">
          ${type === "pnj" ? '<span class="mj-label">MJ</span>' : ""}
          <button class="btn btn-secondaire" data-perso-action="modifier" data-id="${val(perso.id)}" data-type="${type}">✎ Modifier</button>
          <button class="btn btn-danger" data-perso-action="supprimer" data-id="${val(perso.id)}" data-type="${type}">✕ Supprimer</button>
        </div>` : ""}
    `;
    ouvrirSidebar();
  }

  // ---------- Formulaire (création / édition) ----------

  function champ(label, html, aide) {
    return `<label class="champ"><span class="champ-label">${label}</span>${html}
            ${aide ? `<span class="champ-aide">${aide}</span>` : ""}</label>`;
  }

  function formulaire(perso, typeImpose) {
    nettoyerUploadEnAttente(); // un formulaire déjà ouvert (autre personnage) est abandonné
    const creation = !perso;
    const p = perso || { id: "", nom: "", archetype: "", concept: "", notes: "", image: "" };
    const type = typeImpose || (perso && donnees.pnj.includes(perso) ? "pnj" : "pj");
    idModifieALaMain = false;

    const choixType = creation && ROLE === "mj"
      ? champ("Type", `<select name="type">
            <option value="pj" ${type === "pj" ? "selected" : ""}>Personnage joueuse (PJ)</option>
            <option value="pnj" ${type === "pnj" ? "selected" : ""}>PNJ</option>
          </select>`)
      : `<input type="hidden" name="type" value="${type}">`;

    const optionsDistricts = typeof DONNEES !== "undefined"
      ? DONNEES.districts.map((d) => `<option value="${val(d.id)}" ${d.id === p.district ? "selected" : ""}>${val(d.nom)}</option>`).join("")
      : "";

    zone().innerHTML = `
      <div class="run-kicker">${creation ? "Nouveau personnage" : "Modification"}</div>
      <div class="run-titre">${creation ? "Nouveau personnage" : val(p.nom)}</div>
      <form id="form-perso" class="formulaire" autocomplete="off" ${creation ? 'data-creation="1"' : ""}>
        ${choixType}
        ${champ("Nom", `<input name="nom" required maxlength="80" value="${val(p.nom)}">`)}
        ${champ("Identifiant", `<input name="id" required pattern="[a-z0-9][a-z0-9\\-]*" ${creation ? "" : "readonly"} value="${val(p.id)}">`,
                creation ? "minuscules, chiffres, tirets — proposé depuis le nom" : "non modifiable")}
        <div class="champ-perso-pj" ${type === "pnj" ? "hidden" : ""}>
          ${champ("Jouée par", `<input name="joueuse" maxlength="60" value="${val(p.joueuse)}">`)}
        </div>
        <div class="champ-perso-pnj" ${type === "pj" ? "hidden" : ""}>
          <div class="champ-ligne">
            ${champ("Faction / gang", `<input name="faction" maxlength="120" value="${val(p.faction)}">`)}
            ${champ("District", `<select name="district"><option value="">—</option>${optionsDistricts}</select>`)}
          </div>
        </div>
        ${champ("Archétype", `<input name="archetype" maxlength="80" value="${val(p.archetype)}" placeholder="Decker, infiltratrice, chef de gang…">`)}
        ${champ("Portrait", `<div class="champ-image">
              <div class="champ-image-apercu" id="apercu-image">${p.image ? `<img src="${val(p.image)}" alt="">` : `<span class="champ-image-vide">Aucune image</span>`}</div>
              <div class="champ-image-boutons">
                <label class="btn btn-secondaire champ-image-parcourir">
                  Choisir un fichier…
                  <input type="file" id="champ-image-fichier" accept="image/*" class="cache">
                </label>
                <button type="button" class="btn btn-secondaire" id="btn-retirer-image" data-perso-action="retirer-image" ${p.image ? "" : "hidden"}>✕ Retirer</button>
              </div>
              <input type="hidden" name="image" value="${val(p.image)}">
            </div>`, "compressée automatiquement à l'envoi")}
        ${champ("Concept", `<textarea name="concept" rows="4">${val(p.concept)}</textarea>`)}
        ${champ("Notes", `<textarea name="notes" rows="3">${val(p.notes)}</textarea>`, "fluff, quirks, infos de jeu")}
        <div class="formulaire-actions">
          <button type="submit" class="btn">${creation ? "Créer" : "Enregistrer"}</button>
          <button type="button" class="btn btn-secondaire" data-perso-action="annuler" data-id="${val(p.id)}" data-type="${type}">Annuler</button>
        </div>
        <div class="sidebar-erreur" id="sidebar-erreur"></div>
      </form>`;
    ouvrirSidebar();
  }

  function lireFormulaire(form) {
    const f = new FormData(form);
    const texte = (nom) => String(f.get(nom) ?? "").trim();
    return {
      id: texte("id"), nom: texte("nom"), archetype: texte("archetype"),
      concept: texte("concept"), notes: texte("notes"), image: texte("image"),
      joueuse: texte("joueuse"), faction: texte("faction"), district: texte("district"),
    };
  }

  async function enregistrer(form) {
    const type = form.elements.type.value;
    const creation = !!form.dataset.creation;
    const d = lireFormulaire(form);
    const corps = type === "pj"
      ? { id: d.id, nom: d.nom, archetype: d.archetype, concept: d.concept, notes: d.notes, image: d.image, joueuse: d.joueuse }
      : { id: d.id, nom: d.nom, archetype: d.archetype, concept: d.concept, notes: d.notes, image: d.image, faction: d.faction, district: d.district };
    try {
      const p = creation
        ? await api(`/api/personnages/${type}`, corps)
        : await api(`/api/personnages/${type}/${corps.id}`, corps, "PUT");
      uploadEnAttente = null; // enregistré avec succès : ce n'est plus « en attente », on ne l'efface pas
      await charger();
      ouvrirFiche(p, type);
    } catch (e) {
      const erreur = document.getElementById("sidebar-erreur");
      if (erreur) erreur.textContent = e.message;
    }
  }

  // ---------- Envoi d'image (compressée côté serveur) ----------

  async function televerserFichier(fichier) {
    const donnees = new FormData();
    donnees.append("fichier", fichier);
    const reponse = await fetch("/api/uploads/image", { method: "POST", body: donnees });
    if (!reponse.ok) {
      let message = `Erreur ${reponse.status}`;
      try { message = (await reponse.json()).detail || message; } catch {}
      throw new Error(message);
    }
    return reponse.json(); // { url }
  }

  async function surChoixFichier(input) {
    const fichier = input.files[0];
    if (!fichier) return;
    const form = input.closest("form");
    const apercu = form.querySelector("#apercu-image");
    apercu.innerHTML = `<span class="champ-image-vide">Envoi…</span>`;
    try {
      const { url } = await televerserFichier(fichier);
      nettoyerUploadEnAttente(); // un essai précédent de CETTE session, jamais sauvegardé, est remplacé
      uploadEnAttente = nomUpload(url);
      form.elements.image.value = url;
      apercu.innerHTML = `<img src="${val(url)}" alt="">`;
      form.querySelector("#btn-retirer-image").hidden = false;
    } catch (e) {
      apercu.innerHTML = `<span class="champ-image-vide">Échec : ${val(e.message)}</span>`;
    } finally {
      input.value = ""; // permet de resélectionner le même fichier au besoin
    }
  }

  function retirerImage(bouton) {
    const form = bouton.closest("form");
    if (nomUpload(form.elements.image.value) === uploadEnAttente) {
      nettoyerUploadEnAttente(); // envoyée cette session, jamais sauvegardée : autant l'effacer tout de suite
    }
    form.elements.image.value = "";
    form.querySelector("#apercu-image").innerHTML = `<span class="champ-image-vide">Aucune image</span>`;
    bouton.hidden = true;
  }

  async function supprimer(perso, type) {
    if (!confirm(`Supprimer définitivement « ${perso.nom} » ?`)) return;
    try {
      await api(`/api/personnages/${type}/${perso.id}`, null, "DELETE");
      await charger();
      fermerSidebar();
    } catch (e) {
      const erreur = document.getElementById("sidebar-erreur");
      if (erreur) erreur.textContent = e.message;
    }
  }

  // ---------- Événements ----------

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btn-vue").addEventListener("click", () => {
      estActive() ? masquerVue() : afficherVue();
    });

    document.getElementById("btn-nouveau-perso").addEventListener("click", () => formulaire(null));

    [grillePJ(), grillePNJ()].forEach((grille) => {
      grille.addEventListener("click", (evt) => {
        const carte = evt.target.closest(".perso-card");
        if (!carte) return;
        const p = trouver(carte.dataset.id, carte.dataset.type);
        if (p) ouvrirFiche(p, carte.dataset.type);
      });
    });

    // Clic sur le fond de la vue (hors carte) : referme la sidebar,
    // comme un clic sur la carte le fait dans la vue « carte ».
    document.getElementById("personnages").addEventListener("click", (evt) => {
      if (!evt.target.closest(".perso-card")) fermerSidebar();
    });

    const sidebar = zone();
    sidebar.addEventListener("click", (evt) => {
      const cible = evt.target.closest("[data-perso-action]");
      if (!cible) return;
      if (cible.dataset.persoAction === "retirer-image") { retirerImage(cible); return; }
      const { persoAction, id, type } = cible.dataset;
      const p = trouver(id, type);
      switch (persoAction) {
        case "modifier": formulaire(p, type); break;
        case "supprimer": supprimer(p, type); break;
        case "annuler": p ? ouvrirFiche(p, type) : fermerSidebar(); break;
      }
    });

    sidebar.addEventListener("submit", (evt) => {
      if (evt.target.getAttribute("id") !== "form-perso") return;
      evt.preventDefault();
      enregistrer(evt.target);
    });

    sidebar.addEventListener("input", (evt) => {
      const form = evt.target.form;
      if (!form || form.getAttribute("id") !== "form-perso" || !form.dataset.creation) return;
      if (evt.target.name === "id") idModifieALaMain = true;
      if (evt.target.name === "nom" && !idModifieALaMain) form.elements.id.value = slug(evt.target.value);
    });

    sidebar.addEventListener("change", (evt) => {
      if (evt.target.name === "type" && evt.target.form?.getAttribute("id") === "form-perso") {
        const form = evt.target.form;
        const pj = evt.target.value === "pj";
        form.querySelector(".champ-perso-pj").hidden = !pj;
        form.querySelector(".champ-perso-pnj").hidden = pj;
      }
      if (evt.target.id === "champ-image-fichier") {
        surChoixFichier(evt.target);
      }
    });
  });

  return {
    estActive, afficherVue, masquerVue, nettoyerUpload: nettoyerUploadEnAttente,
    charger, trouver, trouverParNom, tousLesNoms, ouvrirFiche,
  };
})();

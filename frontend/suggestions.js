// ============================================================
// Liste déroulante de noms de personnages sur les champs à entrée libre.
// Un champ s'y abonne par attributs (délégation : survit aux ré-affichages) :
//   data-suggest="tous"  PJ + PNJ        data-suggest="pj"  PJ seulement
//   data-suggest-multi   liste séparée par des virgules (suggère pour le
//                        morceau sous le curseur)
// Au clic : tous les noms ; chaque caractère tapé filtre sur « contient
// cette suite de caractères » (sans tenir compte de la casse ni des accents).
// ============================================================

const suggestions = (() => {
  const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  let menu = null;
  let champ = null;
  let items = [];
  let actif = -1;
  let borne = null; // { debut, fin } du morceau remplacé dans la valeur du champ

  const multi = (el) => el.hasAttribute("data-suggest-multi");

  function noms(el) {
    const types = el.dataset.suggest === "pj" ? ["pj"] : ["pj", "pnj"];
    return types.flatMap((t) => personnages.liste(t).map((p) => p.nom));
  }

  // Morceau de la valeur qu'on est en train d'écrire.
  function morceau(el) {
    const v = el.value;
    if (!multi(el)) return { debut: 0, fin: v.length, texte: v };
    const curseur = el.selectionStart ?? v.length;
    const debut = v.lastIndexOf(",", curseur - 1) + 1;
    let fin = v.indexOf(",", curseur);
    if (fin === -1) fin = v.length;
    return { debut, fin, texte: v.slice(debut, fin) };
  }

  function creerMenu() {
    menu = document.createElement("ul");
    menu.className = "suggestions";
    menu.hidden = true;
    menu.setAttribute("role", "listbox");
    // Garde le focus dans le champ pendant le clic sur une suggestion.
    menu.addEventListener("mousedown", (evt) => evt.preventDefault());
    menu.addEventListener("click", (evt) => {
      const li = evt.target.closest("li[data-i]");
      if (li) choisir(Number(li.dataset.i));
    });
    document.body.appendChild(menu);
  }

  function fermer() {
    if (menu) menu.hidden = true;
    items = [];
    actif = -1;
  }

  function placer() {
    const r = champ.getBoundingClientRect();
    menu.style.left = `${r.left}px`;
    menu.style.minWidth = `${r.width}px`;
    const enBas = window.innerHeight - r.bottom;
    menu.style.maxHeight = `${Math.max(120, Math.min(260, Math.max(enBas, r.top) - 12))}px`;
    if (enBas < 160 && r.top > enBas) {
      menu.style.top = "auto";
      menu.style.bottom = `${window.innerHeight - r.top + 2}px`;
    } else {
      menu.style.bottom = "auto";
      menu.style.top = `${r.bottom + 2}px`;
    }
  }

  function afficher(el) {
    if (typeof personnages === "undefined") return;
    champ = el;
    const m = morceau(el);
    borne = { debut: m.debut, fin: m.fin };
    const q = norm(m.texte.trim());
    const dejaPresents = multi(el)
      ? new Set(el.value.split(",").map((s) => norm(s.trim())).filter(Boolean))
      : new Set();
    items = [...new Set(noms(el))].filter((n) => {
      const nn = norm(n);
      return nn.includes(q) && !(dejaPresents.has(nn) && nn !== q);
    });
    if (!items.length) { fermer(); return; }
    if (!menu) creerMenu();
    menu.innerHTML = items.map((n, i) => `<li role="option" data-i="${i}">${echapper(n)}</li>`).join("");
    actif = -1;
    menu.hidden = false;
    placer();
  }

  function surligner(i) {
    actif = (i + items.length) % items.length;
    [...menu.children].forEach((li, k) => li.classList.toggle("actif", k === actif));
    menu.children[actif].scrollIntoView({ block: "nearest" });
  }

  function choisir(i) {
    const nom = items[i];
    if (nom == null || !champ) return;
    const el = champ;
    const v = el.value;
    let avant = v.slice(0, borne.debut);
    let apres = v.slice(borne.fin);
    let ajout = nom;
    if (multi(el)) {
      if (avant && !/\s$/.test(avant)) avant += " ";
      if (avant.trim() === "") avant = "";
      ajout = nom + (apres.trim() ? "" : ", ");
      apres = apres.replace(/^\s+/, "");
      if (apres && !/^,/.test(apres)) apres = ", " + apres;
    } else {
      apres = "";
    }
    el.value = avant + ajout + apres;
    const pos = (avant + ajout).length;
    el.setSelectionRange(pos, pos);
    fermer();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  }

  const cible = (evt) => (evt.target instanceof Element ? evt.target.closest("input[data-suggest]") : null);

  document.addEventListener("focusin", (evt) => { const el = cible(evt); if (el) afficher(el); });
  document.addEventListener("click", (evt) => {
    const el = cible(evt);
    if (el) afficher(el);
    else if (!evt.target.closest?.(".suggestions")) fermer();
  });
  document.addEventListener("input", (evt) => { const el = cible(evt); if (el) afficher(el); });
  document.addEventListener("focusout", (evt) => { if (cible(evt)) fermer(); });

  document.addEventListener("keydown", (evt) => {
    const el = cible(evt);
    if (!el) return;
    if (menu?.hidden !== false) {
      if (evt.key === "ArrowDown") { afficher(el); if (items.length) { evt.preventDefault(); surligner(0); } }
      return;
    }
    switch (evt.key) {
      case "ArrowDown": evt.preventDefault(); surligner(actif + 1); break;
      case "ArrowUp": evt.preventDefault(); surligner(actif < 0 ? -1 : actif - 1); break;
      case "Enter": if (actif >= 0) { evt.preventDefault(); choisir(actif); } else fermer(); break;
      case "Escape": evt.stopPropagation(); fermer(); break;
      case "Tab": fermer(); break;
    }
  }, true);

  // Les touches de déplacement du curseur changent le morceau visé.
  document.addEventListener("keyup", (evt) => {
    const el = cible(evt);
    if (el && multi(el) && (evt.key === "ArrowLeft" || evt.key === "ArrowRight")) afficher(el);
  });

  window.addEventListener("resize", () => { if (menu && !menu.hidden) placer(); });
  document.addEventListener("scroll", () => { if (menu && !menu.hidden) placer(); }, true);

  return { fermer };
})();

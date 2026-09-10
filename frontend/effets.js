// ============================================================
// Effets visuels : décodage des titres, glitch, secousse.
// Tous no-op si l'utilisatrice préfère moins d'animations.
// ============================================================

const effets = (() => {
  const moinsAnime = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const GLYPHES = "▓▒░█#%&@01<>/\\|";

  // Révèle un texte caractère par caractère, les suivants brouillés.
  // Renvoie une promesse résolue quand le texte est entièrement lisible.
  function decoder(element, duree = 380) {
    const texte = element.textContent;
    if (moinsAnime || !texte.trim()) return Promise.resolve();
    return new Promise((resoudre) => {
      const debut = performance.now();
      const etape = (t) => {
        const avancement = Math.min(1, (t - debut) / duree);
        const reveles = Math.floor(avancement * texte.length);
        let sortie = texte.slice(0, reveles);
        for (let i = reveles; i < texte.length; i++) {
          sortie += texte[i] === " " ? " " : GLYPHES[Math.floor(Math.random() * GLYPHES.length)];
        }
        element.textContent = sortie;
        if (avancement < 1) {
          requestAnimationFrame(etape);
        } else {
          element.textContent = texte;
          resoudre();
        }
      };
      requestAnimationFrame(etape);
    });
  }

  // Décode en cascade tout le contenu textuel d'un panneau : titre,
  // intertitres et paragraphes, chacun légèrement après le précédent.
  // Le titre glitche quand il finit de se décoder.
  function cascade(racine) {
    if (moinsAnime) return;
    const titre = racine.querySelector(".run-titre");
    const cibles = racine.querySelectorAll(".run-titre, .section-title, p");
    cibles.forEach((element, i) => {
      const duree = Math.min(800, 250 + element.textContent.length * 2.5);
      setTimeout(() => {
        decoder(element, duree).then(() => { if (element === titre) glitcher(element); });
      }, 80 + i * 70);
    });
  }

  // Déclenche l'animation CSS .glitch-actif (pseudo-éléments décalés).
  function glitcher(element) {
    if (moinsAnime || !element) return;
    element.dataset.text = element.textContent;
    element.classList.add("glitch", "glitch-actif");
    setTimeout(() => element.classList.remove("glitch-actif"), 500);
  }

  function secouer(element) {
    if (moinsAnime || !element) return;
    element.classList.remove("secousse");
    void element.offsetWidth; // relance l'animation
    element.classList.add("secousse");
  }

  // Glitch aléatoire et discret du logo, toutes les 6 à 14 s.
  function glitchPeriodique(element) {
    if (moinsAnime || !element) return;
    const planifier = () => setTimeout(() => {
      if (!document.hidden) glitcher(element);
      planifier();
    }, 6000 + Math.random() * 8000);
    planifier();
  }

  return { decoder, cascade, glitcher, secouer, glitchPeriodique };
})();

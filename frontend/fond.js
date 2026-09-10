// ============================================================
// Fond réactif : réseau de particules reliées entre elles, qui
// s'attirent vers le curseur et s'y connectent.
// Désactivé sur mobile et si l'utilisatrice préfère moins d'animations.
// ============================================================

(function () {
  const canvas = document.getElementById("fond");
  if (!canvas) return;

  const moinsAnime = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tactile = matchMedia("(pointer: coarse)").matches || innerWidth < 768;
  if (moinsAnime || tactile) { canvas.remove(); return; }

  const ctx = canvas.getContext("2d");
  const COULEUR = "41, 182, 255";
  const DIST_LIEN = 140;
  const RAYON_SOURIS = 190;

  let W = 0, H = 0;
  let particules = [];
  const souris = { x: -9999, y: -9999, actif: false };

  function nouvelle() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.25,   // dérive de base
      vy: (Math.random() - 0.5) * 0.25,
      ix: 0, iy: 0,                        // impulsion due au curseur (s'amortit)
      r: 1 + Math.random() * 1.4,
    };
  }

  function redimensionner() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    W = innerWidth;
    H = innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cible = Math.min(120, Math.round((W * H) / 13000));
    while (particules.length < cible) particules.push(nouvelle());
    particules.length = cible;
  }

  addEventListener("resize", redimensionner);
  addEventListener("pointermove", (e) => {
    souris.x = e.clientX;
    souris.y = e.clientY;
    souris.actif = true;
  });
  document.addEventListener("mouseleave", () => { souris.actif = false; });

  let precedent = performance.now();

  function dessiner(maintenant) {
    requestAnimationFrame(dessiner);
    if (document.hidden) return;

    const dt = Math.min(3, (maintenant - precedent) / 16.67);
    precedent = maintenant;

    ctx.clearRect(0, 0, W, H);

    for (const p of particules) {
      if (souris.actif) {
        const dx = souris.x - p.x;
        const dy = souris.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < RAYON_SOURIS * RAYON_SOURIS && d2 > 1) {
          const d = Math.sqrt(d2);
          const force = (1 - d / RAYON_SOURIS) * 0.035;
          p.ix += (dx / d) * force * dt;
          p.iy += (dy / d) * force * dt;
        }
      }
      p.ix *= 0.96;
      p.iy *= 0.96;
      p.x += (p.vx + p.ix) * dt;
      p.y += (p.vy + p.iy) * dt;

      if (p.x < -20) p.x = W + 20;
      else if (p.x > W + 20) p.x = -20;
      if (p.y < -20) p.y = H + 20;
      else if (p.y > H + 20) p.y = -20;
    }

    // Liens entre particules proches
    ctx.lineWidth = 1;
    for (let i = 0; i < particules.length; i++) {
      const a = particules[i];
      for (let j = i + 1; j < particules.length; j++) {
        const b = particules[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > DIST_LIEN * DIST_LIEN) continue;
        const alpha = (1 - Math.sqrt(d2) / DIST_LIEN) * 0.28;
        ctx.strokeStyle = `rgba(${COULEUR}, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Liens curseur -> particules voisines
    if (souris.actif) {
      for (const p of particules) {
        const dx = souris.x - p.x;
        const dy = souris.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > RAYON_SOURIS * RAYON_SOURIS) continue;
        const alpha = (1 - Math.sqrt(d2) / RAYON_SOURIS) * 0.6;
        ctx.strokeStyle = `rgba(${COULEUR}, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(souris.x, souris.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }

    // Points
    for (const p of particules) {
      const dx = souris.x - p.x;
      const dy = souris.y - p.y;
      const proche = souris.actif && dx * dx + dy * dy < RAYON_SOURIS * RAYON_SOURIS;
      ctx.fillStyle = proche ? "#9fdcff" : `rgba(${COULEUR}, 0.75)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, proche ? p.r + 0.8 : p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  redimensionner();
  requestAnimationFrame(dessiner);
})();

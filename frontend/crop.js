// ============================================================
// Recadrage d'image avant envoi : un carré déplaçable/redimensionnable
// posé sur la photo choisie, pour contrôler ce qui finit dans le portrait
// carré (voir .perso-card-img) plutôt que subir le centrage automatique
// du CSS (cover/center), qui peut couper n'importe où.
//
// Usage : const blob = await crop.ouvrir(fichier); // null si annulé
// ============================================================

const crop = (() => {
  const TAILLE_AFFICHAGE_MAX = 480;
  const TAILLE_SORTIE = 640; // portrait carré exporté, en pixels
  const POIGNEE_MARGE = 18; // zone cliquable autour du coin de redimensionnement

  function ouvrir(fichier) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(fichier);
      const img = new Image();

      img.onload = () => {
        const overlay = document.createElement("div");
        overlay.className = "crop-overlay";
        overlay.innerHTML = `
          <div class="crop-panel">
            <div class="crop-titre">Cadrer le portrait</div>
            <div class="crop-zone"><canvas id="crop-canvas"></canvas></div>
            <div class="crop-aide">Glisse le carré pour le déplacer, tire son coin bas-droit pour l'agrandir ou le réduire.</div>
            <div class="crop-actions">
              <button type="button" class="btn btn-secondaire" id="crop-annuler">Annuler</button>
              <button type="button" class="btn" id="crop-valider">Valider le cadrage</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);

        const canvas = overlay.querySelector("#crop-canvas");
        const ctx = canvas.getContext("2d");

        const echelle = Math.min(1, TAILLE_AFFICHAGE_MAX / img.naturalWidth, TAILLE_AFFICHAGE_MAX / img.naturalHeight);
        const largeur = Math.round(img.naturalWidth * echelle);
        const hauteur = Math.round(img.naturalHeight * echelle);
        canvas.width = largeur;
        canvas.height = hauteur;

        const taille = Math.round(Math.min(largeur, hauteur) * 0.9);
        const boite = { x: (largeur - taille) / 2, y: (hauteur - taille) / 2, taille };

        function dessiner() {
          ctx.clearRect(0, 0, largeur, hauteur);
          ctx.drawImage(img, 0, 0, largeur, hauteur);
          ctx.fillStyle = "rgba(6, 8, 15, 0.72)";
          ctx.fillRect(0, 0, largeur, hauteur);
          ctx.save();
          ctx.beginPath();
          ctx.rect(boite.x, boite.y, boite.taille, boite.taille);
          ctx.clip();
          ctx.drawImage(img, 0, 0, largeur, hauteur);
          ctx.restore();
          ctx.strokeStyle = "#29b6ff";
          ctx.lineWidth = 2;
          ctx.strokeRect(boite.x, boite.y, boite.taille, boite.taille);
          ctx.fillStyle = "#29b6ff";
          ctx.fillRect(boite.x + boite.taille - 10, boite.y + boite.taille - 10, 10, 10);
        }

        const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
        const surLaPoignee = (x, y) =>
          Math.abs(x - (boite.x + boite.taille)) < POIGNEE_MARGE && Math.abs(y - (boite.y + boite.taille)) < POIGNEE_MARGE;
        const dansLaBoite = (x, y) =>
          x >= boite.x && x <= boite.x + boite.taille && y >= boite.y && y <= boite.y + boite.taille;

        let mode = null; // "deplacer" | "redimensionner" | null
        let depart = null;

        canvas.addEventListener("pointerdown", (evt) => {
          const rect = canvas.getBoundingClientRect();
          const x = evt.clientX - rect.left;
          const y = evt.clientY - rect.top;
          if (surLaPoignee(x, y)) mode = "redimensionner";
          else if (dansLaBoite(x, y)) mode = "deplacer";
          else return;
          depart = { x, y, boite: { ...boite } };
          canvas.setPointerCapture(evt.pointerId);
        });

        canvas.addEventListener("pointermove", (evt) => {
          const rect = canvas.getBoundingClientRect();
          const x = evt.clientX - rect.left;
          const y = evt.clientY - rect.top;
          if (!mode) {
            canvas.style.cursor = surLaPoignee(x, y) ? "nwse-resize" : dansLaBoite(x, y) ? "move" : "default";
            return;
          }
          const dx = x - depart.x;
          const dy = y - depart.y;
          if (mode === "deplacer") {
            boite.x = clamp(depart.boite.x + dx, 0, largeur - boite.taille);
            boite.y = clamp(depart.boite.y + dy, 0, hauteur - boite.taille);
          } else {
            const delta = Math.max(dx, dy);
            boite.taille = clamp(depart.boite.taille + delta, 40, Math.min(largeur - depart.boite.x, hauteur - depart.boite.y));
          }
          dessiner();
        });

        const finPointer = () => { mode = null; };
        canvas.addEventListener("pointerup", finPointer);
        canvas.addEventListener("pointercancel", finPointer);

        function fermer(resultat) {
          URL.revokeObjectURL(url);
          overlay.remove();
          resolve(resultat);
        }

        overlay.querySelector("#crop-annuler").addEventListener("click", () => fermer(null));
        overlay.addEventListener("click", (evt) => { if (evt.target === overlay) fermer(null); });

        overlay.querySelector("#crop-valider").addEventListener("click", () => {
          const echelleSource = img.naturalWidth / largeur;
          const sortie = document.createElement("canvas");
          sortie.width = TAILLE_SORTIE;
          sortie.height = TAILLE_SORTIE;
          sortie.getContext("2d").drawImage(
            img,
            boite.x * echelleSource, boite.y * echelleSource, boite.taille * echelleSource, boite.taille * echelleSource,
            0, 0, TAILLE_SORTIE, TAILLE_SORTIE,
          );
          sortie.toBlob((blob) => fermer(blob), "image/jpeg", 0.92);
        });

        dessiner();
      };

      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  return { ouvrir };
})();

# Journal de développement

Notes techniques par version, pour Claude et pour le futur de ce projet — **pas affichées
sur le site** (le public lit `frontend/changelog.md`, volontairement court et sans jargon).
Une section par version, la plus récente en tête : ce qui a été touché, pourquoi, les
pièges. Voir CLAUDE.md pour la règle.

## 0.27.0 - 2026-10-12
- Fiche de personnage (PDF ou image) : champs `fiche` (URL `/api/fiches/<uuid>.pdf|jpg`) et
  `fiche_nom` (nom d'origine, affichage) sur PJ et PNJ, dans les YAML. Fichiers dans
  `data/uploads/fiches/` (couvert par la sauvegarde horaire, qui copie `uploads/` en entier).
- Routes : `POST /api/uploads/fiche` (PDF reconnu par `%PDF-`, sinon image Pillow → JPEG 2400 px
  max ; 15 Mo), `GET`/`DELETE /api/fiches/<nom>` — **avec session** (pas une nouvelle route
  publique, contrairement aux portraits qui doivent être lisibles par Discord).
- Remplacement : même mécanique que le portrait — le serveur supprime l'ancien fichier à
  l'enregistrement si `fiche` change ; côté front `ficheEnAttente` efface un envoi jamais
  enregistré (remplacé/abandonné), nettoyé par `nettoyerUploadEnAttente`.
- Piège de test sous Windows/Git Bash : `/tmp/...` n'est pas résolu pareil par Python et curl ;
  utiliser `cygpath -m $TMPDIR`.

## 0.26.0 - 2026-10-12
- Retour à un seul niveau depuis une fiche personnage : `personnages.ouvrirFiche(perso, type, retour)`
  reçoit un callback optionnel (`app.js`, clic sur `.lien-perso` dans la fiche de run → rouvre
  `ouvrirSidebarRun`, run relue dans `DONNEES` pour avoir les inscrites à jour). `undefined` =
  on garde le retour si c'est le même personnage (modifier → annuler/enregistrer repassent par
  `ouvrirFiche`) ; `null` = aucun (clic dans la galerie). Effacé par `fermerSidebar` via
  `personnages.oublierRetour()`. Pas de retour depuis la fiche de district (seulement les runs
  ont des liens vers des personnages).

## 0.25.1 - 2026-10-12
- Le changelog (`fetch("changelog.md")`) restait en cache navigateur après un déploiement :
  nginx/uvicorn n'envoient ni `Cache-Control` ni validité explicite, le navigateur applique
  un cache heuristique à partir de `last-modified`. Corrigé avec `{ cache: "no-cache" }`
  (revalidation par etag, 304 si inchangé). Même piège possible pour tout fichier statique
  lu en `fetch` : poser `no-cache`.

## 0.25.0 - 2026-10-12
- Nouveau `frontend/suggestions.js` : liste déroulante maison (pas `<datalist>`, qui ne
  s'ouvre pas au clic partout). Abonnement par attributs et délégation d'événements, donc
  rien à rebrancher quand une sidebar est ré-affichée : `data-suggest="tous|pj"`,
  `data-suggest-multi` pour les listes séparées par des virgules (suggère sur le morceau
  sous le curseur, masque les noms déjà saisis).
- Branché sur : Fixer et Autres persos probables (`mj.js`, `datalist` supprimée) et
  `#nom-joueuse` (`app.js`, PJ seulement). Pour ajouter un champ : mettre les attributs.
- Piège de test : le navigateur garde l'ancien JS en cache, recharger avec
  `fetch(f, {cache: "reload"})` avant de conclure que ça ne marche pas.

## 0.24.1 - 2026-10-12
- Bouton « + PERSONNAGE » inopérant : il est dans `#personnages`, dont le handler de clic
  « clic hors carte = fermer la sidebar » refermait le formulaire juste après son
  ouverture (même événement, qui remonte). Exclu via `closest(".perso-card, #btn-nouveau-perso")`.

## 0.24.0 - 2026-10-10
- Date de la séance dans le titre des posts de forum Discord, avec resynchronisation des
  posts existants au démarrage du bot.

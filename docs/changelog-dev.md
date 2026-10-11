# Journal de développement

Notes techniques par version, pour Claude et pour le futur de ce projet — **pas affichées
sur le site** (le public lit `frontend/changelog.md`, volontairement court et sans jargon).
Une section par version, la plus récente en tête : ce qui a été touché, pourquoi, les
pièges. Voir CLAUDE.md pour la règle.

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

# Synchronisation bidirectionnelle — cadrage de la branche

Branche de travail : `feature/ds-bidirectional-sync`. Ne pas fusionner sans validation.

## Périmètre
- Synchroniser les tokens entre Figma, DS Studio et le dépôt du projet connecté.
- Réutiliser le plugin Figma existant ; préserver la preview, le chat et la génération de code.
- Toute écriture vers Figma nécessite confirmation des capacités du plugin et du contexte d'exécution.
- Ne pas écrire automatiquement sur `main`.

## Éléments constatés dans les sources locales fournies
- `figma-plugin/code.js` implémente déjà une correspondance de noms et les opérations d'import/synchronisation de variables.
- `app/server/http.ts` expose `/api/plugin/sync`, `/api/plugin/import`, `/api/plugin/report`, ainsi que les endpoints de lecture Figma.
- `app/server/gitops.ts` publie sur une branche dédiée après validation et utilise actuellement un seuil `BATCH = 10`.
- `new-project/design-system/tokens.json` contient des tokens DTCG et `build-tokens.mjs` les transforme pour l'application.

## Étapes d'implémentation sécurisées
1. Tests de non-régression des imports/exports et du builder.
2. Modèle de changement avec identifiant, origine, empreinte et révision de base.
3. Diff normalisé et gestion des conflits sans écrasement silencieux.
4. Publication sur branche et proposition de Pull Request ; pas de push direct sur main.
5. Synchronisation Figma via le plugin existant et confirmation de l'application effective.
6. Tests des deux sens et des boucles de synchronisation.

## Hors périmètre de cette étape
Aucune refonte de PreviewBuild, Chat, PreviewPage ou du moteur de génération de code.

## Points à confirmer avant automatisation
- Les droits et la connexion du fichier Figma réel.
- Le mode de lancement du plugin Figma et ses limitations hors éditeur.
- Le mapping des modes, alias et variantes avant toute écriture.

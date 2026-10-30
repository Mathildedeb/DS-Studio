# Refonte visuelle de DS-Studio

30 octobre 2026 · branche locale `design/refonte-ux` · aucun push.

## Projet inspecté

Projet existant conservé : React 19.3.1, TypeScript 7, Vite 8.3.5 et serveur Node local. Aucune installation Next.js et aucune recréation du projet. Tailwind et shadcn/ui étaient absents.

## Configuration et dépendances

Configuration suivant la documentation officielle pour un projet Vite existant : https://ui.shadcn.com/docs/installation/vite.

- Tailwind CSS 4 et son plugin Vite ; alias `@/` vers le client dans TypeScript et Vite.
- `components.json` : style shadcn new-york, TypeScript, variables CSS et icônes Lucide.
- Composants officiels ajoutés avec la CLI shadcn : Card, Button, Input, Textarea, Avatar, Tooltip, Badge, Chart.
- Le composant Chart utilise Recharts. Les autres dépendances sont les primitives Radix utilisées par shadcn et ses utilitaires de classes (`clsx`, `tailwind-merge`, `class-variance-authority`). Aucune autre librairie UI ajoutée.
- Adaptation des imports de l’utilitaire `cn` vers notre fonction locale. Le paquet `cn` ajouté automatiquement par la CLI a été retiré, car inutile ici.
- Les styles Tailwind sont séparés du thème personnalisé. Le reset global Tailwind n’est pas importé pour préserver le rendu du DS existant.

## Résultat

Mosaïque de sept cartes de tailles différentes : texte clair, palette gris clair, données orange avec graphique, illustration citron, code orange, note textuelle et checklist interactive. Le personnage rose fourni est réutilisé comme illustration.

Le thème anthracite `#262626`, orange `#FF9450`, citron `#D9FF69`, les rayons et les couleurs récurrentes sont centralisés dans `app/client/atelier.css`. L’identité est également appliquée aux écrans DS, Preview, Plugin et au chat existant. Le suivi réel du projet reste accessible dans la section repliable « Mon projet · suivi et Design System ».

Les contenus de la mosaïque et les chiffres du graphique sont explicitement fictifs ; aucune valeur n’a été écrite dans les tokens ou les pages du projet de design.

Dernier ajustement demandé : suppression de la barre de prompt flottante et de tous les bandeaux de questions avec crayon/avatar. Le composant PromptBar et sa logique locale ont été retirés. Les cartes conservent leur contenu et les actions Copier/Favori. Les favoris et la checklist sont locaux à la session d’affichage.

Aucune nouvelle API IA, vocale ou de synthèse vocale n’a été branchée. Les connecteurs préexistants ne sont pas utilisés par les cartes de démonstration.

## Fichiers de cette refonte

Créés :

- `components.json`
- `app/client/lib/utils.ts`
- `app/client/components/ui/{card,button,input,textarea,avatar,tooltip,badge,chart}.tsx`
- `app/client/components/assistant/{AssistantDashboard,ResponseCard,MessageActions}.tsx`
- `app/client/visual-theme.css` : intégration Tailwind et correspondance des variables shadcn.
- `app/client/atelier.css` : tokens de thème, mosaïque et styles adaptatifs de l’application.
- `docs/VISUAL_REDESIGN.md`

Modifiés : `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `app/client/main.tsx`, `app/client/Dashboard.tsx`, `app/client/Chat.tsx`, `tests/e2e/studio.spec.ts`.

La branche contient aussi les modifications UX précédentes. Le fichier PASSATION.md préexistant reste hors commit.

## Commandes exécutées

- `npm install -D tailwindcss @tailwindcss/vite`
- `npm install clsx tailwind-merge class-variance-authority lucide-react`
- `npx shadcn@latest add card button input textarea avatar tooltip badge --yes`
- `npx shadcn@latest add chart --yes`
- `npm uninstall cn`
- Formatage ciblé avec `npx prettier --write …`
- `npm run check`
- `npm test`
- `npm run build`
- `npm run test:e2e -- --max-failures=1`
- `npm run dev`
- `git diff --check`

Les installations ont utilisé un cache npm temporaire. Aucun commit ni envoi de cette étape visuelle n’a été effectué.

## Vérifications et limites

- Typage et compilation : réussis.
- 102 tests unitaires : réussis.
- Contrôle visuel dans le navigateur intégré à 1440 px, 900 px et 375 px. Débordement décoratif corrigé sur tablette ; largeur du contenu égale à celle de la fenêtre aux trois tailles contrôlées.
- Avant son retrait demandé, le prompt de démonstration a été vérifié : ajout d’une carte locale, sans appel IA.
- Après retrait : absence de barre de prompt et de bandeaux de cartes vérifiée dans le DOM et dans le rendu.
- Les tests de parcours ont été adaptés et enrichis. Leur exécution reste bloquée au lancement de Chromium par macOS (`MachPortRendezvousServer`, permission refusée) : aucune assertion de cette exécution n’a été validée.
- Les autres vues DS et Preview ont été inspectées visuellement avec le thème. Leur logique préexistante n’a pas été requalifiée de bout en bout.
- Le contrôle automatique a refusé l’ouverture du panneau Clodo, en appliquant la consigne d’accord préalable. Le thème du chat est implémenté mais sa vérification visuelle reste en attente d’autorisation. Aucun message IA envoyé.
- La compilation signale des directives `use client` ignorées dans Vite et un bloc JavaScript principal de plus de 500 Ko. L’écran mosaïque et son graphique sont déjà chargés séparément ; une optimisation supplémentaire du bloc historique peut être faite ultérieurement.

Étapes restantes : revue visuelle par Mathilde, exécution des parcours automatisés dans un environnement où Chromium démarre, puis commit/push uniquement après demande explicite. Les API IA/vocales restent hors périmètre de cette version.

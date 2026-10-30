# Passation DS-Studio : audit, état au 29 octobre 2026, suite

Document pour reprendre le travail sans contexte préalable. Il décrit le
produit, l'environnement, ce qui a été fait, ce qui est vérifié ou non, les
problèmes connus et la suite.

---

## 1. Qui et quoi

- **Utilisatrice :** Mathilde, UI designer, non développeuse. Elle écrit en
  français, souvent vite, avec des fautes de frappe. Réponds en français.
- **Comment lui répondre :** des réponses courtes et claires, compréhensibles
  en un coup d'œil. Pas de jargon technique dans l'interface.
- **Les tokens comptent :** elle ne veut pas qu'on lance Clodo ou un Build
  sans raison.
- **DS-Studio** est son outil de Design System, local, en React et Node. Il
  relie trois choses :
  - son **projet de code** : `new-project-main`, React + Vite ;
  - son **fichier Figma** : `5-design_system.extension` ;
  - **GitHub**.
- **Clodo** est le chat intégré à DS-Studio. Il appelle Claude Code sans
  outils (`connectors/agents/`, son expertise dans `CLODO.md`).

### Principes qu'elle a fixés (à respecter)

1. **Le chat décide et pose les questions**, étape par étape, avec une
   checklist dans la conversation : « Je code… ? », « Je publie sur Git ? ».
   Rien ne part sans son oui. Elle a refusé un générateur de code
   automatique : c'est le chat qui code.
2. **Chaque écriture de code passe par un diff validé** dans DS-Studio.
3. **GitHub :** la publication part sur une nouvelle branche `design/…`, et
   la PR s'ouvre automatiquement avec `gh`. **Rien ne part avant 10
   modifications validées.** Cette règle est appliquée par le serveur.
4. **Vocabulaire designer dans l'interface :** Calques, Groupe, Auto Layout,
   Éléments, Propriétés, Espacements, Alignement, Dimensions, Styles,
   Composants. Pas de « cadre », « widget », « instance » ni « relais ».
5. **Ne jamais inventer de valeur dans son DS sans le dire.** Une valeur de
   test, « rêveur lucide », l'a perturbée. Elle a finalement voulu la garder.

---

## 2. Dépôts, chemins, comptes

| Élément | Chemin / lien |
|---|---|
| DS-Studio (cet outil) | `/Users/mathildedebeure/Downloads/DS-Studio-main` → GitHub `Mathildedeb/DS-Studio` |
| Projet design | `/Users/mathildedebeure/Downloads/new-project-main` → GitHub `Mathildedeb/design-system-extension` |
| Données DS-Studio du projet | `.ds-studio/projects/5a8ebb4c0f41999a/` : `pages/*.json` (plans de page), `component-sync.json`, `preview.json`… Ne pas éditer `state.json` à la main. |
| Figma | Fichier `5-design_system.extension`. Clé `FIGMA_TOKEN` en lecture seule dans `.env`. Le plugin est dans `figma-plugin/`. |
| GitHub CLI | `gh` connecté au compte `Mathildedeb`. Le **merge automatique est désactivé** sur le dépôt DS-Studio. |

Instructions du dépôt à lire : `CLAUDE.md`, `START_HERE.md`, `AGENTS.md`, et
`.agents/skills/token-change/SKILL.md` pour toute modification de token.

---

## 3. Lancer et tester

- **DS-Studio :** `npm run dev`, sur `http://127.0.0.1:4310`. La config
  `.claude/launch.json` s'appelle `dev`.
- **Le proto :** DS-Studio → Preview → **« Lancer le projet »**, sur
  `http://localhost:5173`. Pages : `/` (Découvrir) et `/profil`.
- **Vérifications :** `npx tsc --noEmit -p .`, `npm test` (node:test,
  **102 tests**, tous verts) et `npm run build`.
- **Pièges connus :**
  - **Redémarrer DS-Studio arrête le proto** et efface la conversation du
    chat, y compris un diff pas encore validé. Vérifie avant que Clodo ne
    travaille pas : `GET /api/code/progress` doit renvoyer `busy:false`.
  - **Un serveur lancé par Mathilde** (DS-Studio.app) ne s'arrête pas sans
    son accord.
  - **« 504 Outdated Optimize Dep »** dans le navigateur : il faut
    redémarrer le serveur de dev.
  - **Le relais du projet** (`ds-studio.html` + `src/ds-studio/canvas.tsx`)
    est généré par `app/server/bridge.ts`. Chaque nouvelle version
    (`bridgeMark`) demande de valider un diff dans la Preview. Avant de le
    proposer, vérifie qu'il compile dans le projet : génère-le dans un
    fichier temporaire, puis lance `npx tsc -b --noEmit`.
  - **Avant un test qui modifie une page,** sauvegarde
    `.ds-studio/projects/5a8ebb4c0f41999a/pages/cards.json`, puis restaure-le
    après.
  - **Les gestes dans l'iframe du relais** ne sont pas transmis par l'outil
    de navigateur quand le cadre est réduit. Pour les tester, ouvre
    `localhost:5173/ds-studio.html` seul, envoie un message
    `ds-studio:page`, puis écoute les messages sortants.

---

## 4. Architecture utile

| Fichier | Rôle |
|---|---|
| `app/shared/pagePlan.ts` | Le **modèle de page en arbre de calques** : composant, Groupe ou Auto Layout, avec `layout`, `adapt` (mobile < 600 / tablette < 1024 / desktop), `size`, `style` (fond = variable CSS d'un token, arrondi) et `link` (au clic, aller à une page). Contient aussi les opérations (wrap, unwrap, move…), les opérations du chat (`applyOps`) et la vérification du Build (`checkBuild`). |
| `app/client/PreviewBuild.tsx` | Le mode **Construire** : onglets Calques / Composants, canvas (iPhone), panneau Propriétés en sections, Annuler / Rétablir, raccourcis (⌘G, ⇧A, ⇧⌘G, ⌘D, ⌫, ⌥↑↓, /), gestes reçus du relais. |
| `app/client/DeviceFrame.tsx` | Le cadre d'iPhone (7 modèles, safe areas, zoom affiché). |
| `app/client/PreviewPage.tsx` | La page Preview : formats, pages, Aperçu / Construire, lien en ligne (Vercel), mode compact. |
| `app/server/bridge.ts` | Le **relais v7** dans le projet : rend l'arbre avec les vrais composants et les maquettes Figma (PNG), avec survol, poignées d'espacement, de taille et de déplacement, mode Tester et navigation au clic. |
| `app/client/App.tsx` + `Chat.tsx` | Le chat, la **carte Build** (checklist, questions), la carte « Je publie ? » et les étapes de Clodo en direct (`/api/code/progress`). |
| `connectors/agents/coder.ts` | Clodo en mode code (choix des fichiers, puis diff), étapes et messages d'erreur précis. |
| `connectors/agents/pageBuilder.ts` | Clodo en mode Construire : opérations sur l'arbre. |
| `app/server/http.ts` | Les routes : page-plan, figma/*, component-sync, page-build/check, plugin/*, git… |
| `app/shared/componentSync.ts`, `app/client/SyncPanel.tsx`, `figma-plugin/` | La **synchro des composants Figma ↔ code** (variantes). |
| `app/server/gitops.ts` | Publication : branche, push et PR automatique avec `gh`, lecture de la PR ouverte du projet. |

---

## 5. Ce qui a été fait (chronologie)

1. **Preview, maquettes et iPhone.** PR [DS-Studio#2](https://github.com/Mathildedeb/DS-Studio/pull/2), **fusionnée** :
   - les composants pas encore codés sont utilisables en maquette Figma ;
   - cadre iPhone réel ;
   - fiche du composant ;
   - Build en deux temps (composants, puis page) ;
   - pages et liens « au clic » créés par le chat ;
   - étapes de Clodo visibles ;
   - lien en ligne (Vercel) enregistrable ;
   - synchro des variantes de composants Figma ↔ code ;
   - PR automatique, et PR du projet affichée dans la Synchro.
2. **Projet.** PR [design-system-extension#1](https://github.com/Mathildedeb/design-system-extension/pull/1), **fusionnée** :
   - tokens et composants ;
   - page Profil et navigation depuis l'avatar ;
   - variantes `lucide` (ajoutée dans Figma) et `rêveur lucide` (ajoutée dans le code, puis créée dans Figma par le plugin).
3. **Refonte designer-first, étapes A à F.** PR [DS-Studio#3](https://github.com/Mathildedeb/DS-Studio/pull/3), **fusionnée** :
   - **A.** Calques en arbre, Groupe et Auto Layout ;
   - **B.** Panneau Calques : onglets, recherche, menu contextuel, actions au survol ;
   - **C.** Propriétés en sections : alignement en grille, styles en tokens, Adaptation ;
   - **D.** Gestes sur le canvas : écart, intérieurs, taille, déplacement ;
   - **E.** Build piloté par le chat : carte, questions, vérification du code ;
   - **F.** Page de travail compacte : canvas à 253 px au lieu de 426 px, paliers ≥ 1280 / 900-1279 / < 900 px.

---

## 6. État exact au moment de la passation

- **PR DS-Studio#3 : fusionnée dans `main`** le 29 octobre à 15 h 48, avec
  Ubuntu et macOS verts.
  - **Windows ne termine jamais :** l'étape `npm test` reste bloquée jusqu'à
    ce que GitHub l'arrête au bout de 6 heures. C'était déjà le cas avant la
    refonte, dès les vérifications de 9 h 23.
  - Cause probable : un test qui laisse un serveur ou un processus ouvert
    sous Windows. **À régler à part.**
  - Le blocage précédent venait de la facturation GitHub Actions. Mathilde l'a
    réglé.
- **Dossier DS-Studio :** sur `main`, à jour. Seul changement en cours : ce
  document, `docs/PASSATION.md`, pas encore commité.
- **Dossier projet :** sur `main`, avec **une seule modification en cours :
  `src/ds-studio/canvas.tsx`** (le relais v7, réservé au développement). Elle
  partira à la prochaine publication.
- **Compteur de publication du projet : 6/10.**
- **Plugin Figma :** il doit être ouvert dans Figma desktop, en mode
  automatique, pour toute écriture dans Figma.

---

## 7. Audit : vérifié, non vérifié, problèmes connus

### Vérifié dans l'app, sur le vrai projet

- Arbre de calques : Auto Layout (⇧A), Groupe (⌘G), renommage, dépôt dedans, ⌘Z, persistance sur le disque.
- Propriétés : fond, arrondi, alignement et intérieurs, rendus sur le canvas et enregistrés.
- Adaptation : un réglage pour mobile seulement, et la tablette garde la base.
- Calques : recherche, menu contextuel, dupliquer puis ⌘Z, fiche dans le panneau.
- Pas de débordement horizontal à 375, 768, 1100 et 1440 px.
- Relais v7 seul : gestes simulés, valeurs affichées en direct, bons messages envoyés.
- Les mêmes messages côté DS-Studio : appliqués et annulables.
- Carte Build affichée.
- `checkBuild` sur le vrai code de Découvrir : 12 composants dans l'ordre, liens vers `/profil`, et signalement correct des 3 maquettes et des 2 Auto Layout ajoutés depuis.
- Synchro Figma ↔ code, dans les deux sens, sur le vrai fichier : 82 composants lus, avatar à 4 valeurs, aucune boucle.

### Non vérifié

- **Un Build complet avec Clodo** passant par la nouvelle carte du chat.
- **Un vrai glisser à la souris** dans le cadre iPhone (limite de l'outil de
  test).
- Le chat avec les nouvelles opérations : `wrap`, `layout` avec `device`,
  `size` et `style`.
- La publication automatique avec PR du projet à 10/10 (seulement testée
  via une PR ouverte à la main).

### Problèmes connus et limites

- **Titre « Mon profil » presque invisible** dans `src/pages/Profil/Profil.css`.
  Le `h1` hérite de la couleur sombre de `index.css` (styles de départ de
  Vite).
- **Tokens de typographie cassés :** dans le projet, ils pointent vers
  `--font-family-title` et `--font-family-body`, qui n'existent pas. Les
  vraies variables sont `--font-titleFont` et `--font-bodyFont`.
  - À corriger dans `design-system/tokens.json`, puis lancer `npm run tokens`.
  - **Mathilde a dit « on laisse » pour l'instant.**
  - Clodo a aussi signalé que `--color-neutral-100` vaut `#D51E1E` (un rouge).
- **`rêveur lucide`** (valeur de test) est gris dans Figma et violet clair
  dans le code.
- **`checkBuild` lit le code, pas le rendu :** un écart écrit avec une
  variable CSS est signalé à tort comme manquant.
- **Synchro Figma :**
  - seules les propriétés de **variante** sont synchronisées ;
  - les propriétés texte, booléennes et de remplacement d'instance sont listées « non prises en charge » ;
  - le plugin ne supprime jamais rien ;
  - la correspondance code ↔ Figma passe par le commentaire `Variante Figma « … »` des Props, ou par le même nom.
- **L'API REST Figma Variables est réservée à Enterprise :** ce compte n'y a
  pas accès. Toute écriture dans Figma passe donc par le plugin.
- **Le zoom de l'iPhone** reste autour de 69 % sur un portable : le cadre
  fait 876 px de haut.
- **Le lien en ligne (Vercel)** s'enregistre seulement : rien n'est connecté
  à Vercel.

---

## 8. Suite proposée (dans l'ordre)

1. **Débloquer les tests Windows de la CI :** `npm test` ne se termine pas
   sur `windows-latest`. Il faut chercher le test qui garde un processus ou
   un serveur ouvert.
2. **Tester un vrai Build** de Découvrir avec la carte du chat, de bout en
   bout. Demande d'abord : ça coûte des tokens.
3. **Synchro Figma, étape 2 :** les styles des composants (couleurs,
   espacements, arrondis, typo, liés aux variables), dans les deux sens.
4. **Synchro Figma, étape 3 :** créer un composant Figma à partir du code
   (rendu React → calques Figma par le plugin).
5. **Animations et interactions** : apparition, transitions de page, survol.
   Elles sont codées par le chat. Mathilde a validé l'idée, et le chat les
   code à sa demande.
6. **Connecter Vercel** quand elle le demandera : elle a dit « on attend ».
7. **Corriger le titre invisible et les tokens de typographie,** seulement
   quand elle le demandera.

---

## 9. Façon de travailler qui a marché

- **Audit et plan avant de coder,** quand elle le demande, puis une étape à
  la fois, avec un commit par étape sur une branche. Ne pousse et n'ouvre
  de PR que quand elle le demande.
- **Vérifier dans l'app avant de dire « fait »,** et dire clairement ce qui
  n'a pas été vérifié.
- **Commits en français,** terminés par
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Écrire aux modifications de son projet** (Figma, code) seulement avec
  son accord explicite. Sauvegarder et restaurer ses pages après les tests.

# DS-Studio

Un atelier **web local** pour faire évoluer le Design System d'un projet de code,
avec Figma et GitHub. Il tourne sur votre ordinateur, à l'adresse
`http://127.0.0.1:4310`. Trois écrans : **Tableau de bord**, **Design System** et
**Preview**, plus **Clodo**, un assistant branché sur Claude Code.

**Principe : rien n'est écrit sans votre validation.** Chaque changement de token
ou de code est d'abord montré en diff ; il n'est écrit sur le disque qu'après
**Valider**. Le mode manuel fonctionne sans IA, sans Figma et sans Internet une
fois installé.

## Le workflow

| Étape | Où | Automatique ? |
| --- | --- | --- |
| 1. Ouvrir le projet (dossier Git + lien Figma) | DS-Studio, **Ouvrir un projet** | Une fois, puis mémorisé |
| 2. Modifier tokens ou code, à la main ou avec Clodo | Design System, Clodo | — |
| 3. Relire le diff | Fenêtre de diff | — |
| 4. Valider | Fenêtre de diff | Écrit dans DS-Studio **et** dans le fichier de tokens du projet |
| 5. Synchroniser les variables Figma | Plugin DS-Studio ouvert dans Figma | Oui, en mode automatique, pour les variables existantes |
| 6. Vérifier dans Figma | Figma | **Manuel** |
| 7. Publier sur GitHub | Carte « Je publie ? » de Clodo, à 10 modifications | Branche + commit + push après votre clic |
| 8. Pull Request | GitHub | **Manuel** |
| 9. Fusionner dans `main` | GitHub | **Manuel** |
| 10. Revenir sur `main` à jour | Terminal | **Manuel** (`git switch main && git pull`) |

Règles détaillées de publication : [workspace/PROCESS_GITHUB.md](workspace/PROCESS_GITHUB.md).

## Prérequis

| Outil | Pour quoi | Obligatoire ? |
| --- | --- | --- |
| **Node.js 22.12+** avec npm ([site officiel](https://nodejs.org/en/download)) ; 22.23.4 testé, fixé par [.nvmrc](.nvmrc) | Faire tourner DS-Studio | Oui |
| Un navigateur récent | Utiliser l'atelier | Oui |
| **Git**, avec un accès à GitHub depuis le terminal (par exemple `gh auth login`) | Ouvrir un projet, publier | Pour le workflow projet |
| **Claude Code** (CLI), connecté avec votre compte (`claude` puis `/login`) | Clodo | Pour Clodo |
| **Clé Figma personnelle** `FIGMA_TOKEN`, en lecture seule | Lire le fichier Figma du projet | Pour la lecture Figma |
| **Figma desktop** | Plugin DS-Studio (écriture des variables) | Pour la synchronisation Figma |

Ni Python, ni Docker, ni Electron.

## Installer et lancer

1. Gardez **tout le dossier**, puis double-cliquez sur le lanceur :

   | Système | Fichier |
   | ------- | ------- |
   | macOS   | **DS-Studio.app**, à laisser dans le dossier du projet |
   | Windows | **DS-Studio.vbs** |
   | Linux   | **DS-Studio.desktop** (autoriser l'exécution si demandé) |

2. Si Node manque, un guide local s'ouvre. Le lanceur ne télécharge pas Node et ne
   lance aucune commande administrateur.
3. Au premier lancement : **Installer / compiler…**, puis confirmez. Internet est
   nécessaire pour cette étape seulement.
4. **Démarrer DS-Studio**, puis **Ouvrir DS-Studio**. Aux lancements suivants, un
   double-clic ouvre directement l'atelier.
5. **Arrêter DS-Studio** arrête le serveur ; fermer l'onglet ne l'arrête pas.
   **Redémarrer** conserve les données.

Utilisez l'adresse `http://127.0.0.1:4310` : `localhost` est refusé (erreur 403),
le contrôle d'adresse est strict. [Guide hors ligne](launcher/INSTALLATION.html) ·
[dépannage](docs/LAUNCHER.md). L'application Mac n'est pas signée ; ne désactivez
pas les protections de votre poste pour la lancer.

### Depuis le terminal

```sh
npm ci
npm run build
npm start
```

Ouvrez **http://127.0.0.1:4310** (pas `localhost`). **Ctrl+C** arrête le serveur.
`npm run doctor` vérifie les prérequis sans lire d'identifiants.

## Ouvrir un projet

**Ouvrir un projet** (en-tête) demande :

- le **dossier Git local** du projet (sélecteur de dossier sur macOS, chemin collé
  ailleurs) ;
- le **lien du fichier Figma** (`https://www.figma.com/design/…`).

**Vérifier**, puis **Ouvrir le projet**. Chaque projet a son propre Design System,
son historique et sa Preview. Le premier projet ouvert reprend le DS déjà présent
dans DS-Studio.

## Design System : tokens, diff, historique

- Les tokens forment une **liste libre, vide au départ**. Types : couleur
  (`#RRGGBB`), dimension (pixels) et police.
- **+ Token** → nom (`color.brand`), type, valeur → **Proposer l'ajout** → diff →
  **Valider et enregistrer**. Modifier ou **Supprimer ce token** suit le même chemin.
- **Historique** : chaque révision peut être annulée seule, elle aussi par un diff.
- Projet ouvert : chaque token validé est aussi écrit dans le fichier de tokens du
  projet (`design-system/tokens.json` au format W3C DTCG, sinon le premier
  `*tokens*.json` trouvé), en gardant sa structure, ses unités et ses alias. Un
  fichier qui n'est pas au format DTCG n'est jamais réécrit.
- Les tokens du projet peuvent être importés dans DS-Studio, toujours par le diff.
- **Exporter les tokens** / **Importer un JSON** : format local à clés plates
  ([TOKENS](docs/TOKENS.md)), pas un convertisseur universel.
- Onglets **Atomes, Molécules, Organismes, Templates** : les composants du code
  décrits dans le registre (`app/client/dsRegistry.ts`, presque vide aujourd'hui)
  et les composants du fichier Figma, rangés d'après leur page Figma. Les
  composants Figma y sont **en lecture seule**.

## Clodo, l'assistant

Clodo utilise le **Claude Code installé sur votre poste**, avec votre compte et
votre quota (cherché dans `~/.local/bin`, puis dans le PATH).

- **Un seul chat.** Pour chaque demande, Clodo choisit : des **tokens** (le DS dans
  son ensemble) ou du **code** (un composant, un élément sélectionné, une page de
  la Preview, un écran).
- **Code :** il choisit jusqu'à 10 fichiers du projet, peut lire jusqu'à 6
  composants Figma (si la clé Figma est configurée), puis propose jusqu'à 40
  remplacements ou fichiers à créer, en un seul diff. Après validation, la
  dernière modification de code peut être annulée.
- **Son expertise** est décrite dans [connectors/agents/CLODO.md](connectors/agents/CLODO.md)
  (directeur artistique, tokens, fidélité Figma, UX, accessibilité WCAG AA,
  écrans complets). Ce fichier est relu à chaque demande : modifiez-le librement.
- **Ses limites, volontaires :** aucun outil, aucun MCP, aucun accès disque ni
  terminal. Il est lancé dans un dossier temporaire vide : il ne lit donc **aucun
  CLAUDE.md** de vos projets. Il ne voit que ce que DS-Studio lui envoie et ne
  peut rien écrire lui-même.
- Périmètre du code : dans un projet, ses fichiers source seulement (jamais
  `node_modules`, la configuration, `package.json`, les fichiers cachés ni `.env`).
  Sans projet ouvert, l'interface de DS-Studio (`app/client/`) et le workspace.
- Le chat n'est pas conservé après rechargement de la page.

## Preview

La Preview installe les dépendances du projet et lance son serveur de
développement **au clic**, puis affiche ses pages (routes) dans plusieurs largeurs.
Sélectionner une page l'envoie à Clodo comme contexte (« ici », « cette page »).

## Figma

### Lecture (API Figma, clé personnelle)

Ajoutez dans un fichier `.env` à la racine de DS-Studio :

```sh
FIGMA_TOKEN=votre-clé
```

Créez la clé dans les paramètres de votre compte Figma, avec la seule portée
**File content : Read-only**. Elle reste côté serveur, n'est jamais envoyée au
navigateur et n'est pas versionnée. DS-Studio lit alors le fichier du projet :
pages, composants, structure d'un composant, aperçus, et les variables (API
réservée aux offres Enterprise ; à défaut, les styles couleur et texte).

### Écriture (plugin DS-Studio)

Le plugin, dans [figma-plugin/](figma-plugin/), applique les **tokens validés
dans DS-Studio** aux **variables** du fichier Figma.

1. Figma desktop → **Plugins → Développement → Importer un plugin depuis un
   manifeste…** → `figma-plugin/manifest.json`.
2. Ouvrez le fichier Figma **lié au projet**, puis lancez le plugin.
3. Collez le **code d'appairage** affiché dans DS-Studio (Design System → onglet
   Figma → « Plugin Figma DS-Studio »).
   **Renouveler** le code coupe l'accès de l'ancien.
4. Cochez **Mode automatique** : tant que le plugin reste ouvert, il relit
   DS-Studio toutes les 4 s et applique chaque nouvelle révision validée.

Ce que fait le plugin aujourd'hui, d'après son code :

- **met à jour** les variables existantes dont le nom correspond au token
  (`color.primary.700` ↔ `primary/700`), dans le **mode par défaut** seulement,
  puis relit chaque valeur écrite ;
- **crée** les variables manquantes, dans une collection « DS-Studio », après un
  clic seulement ;
- **ne supprime pas** de variable ;
- **n'écrit pas** une variable qui est un alias d'une autre ;
- **ne touche pas** aux composants, organismes ou styles. Un composant ne change
  dans Figma que si ses calques sont liés aux variables modifiées ;
- **ne renvoie pas** son résultat à DS-Studio : vérifiez le résultat dans Figma.

Le plugin ne communique qu'avec DS-Studio sur cet ordinateur (`localhost:4310`).
Contrat et règles de sécurité : [docs/FIGMA.md](docs/FIGMA.md).

## GitHub

Avec un projet ouvert, DS-Studio compte les modifications validées (tokens,
annulations, code). **Rien ne part avant 10.** À la dixième, Clodo affiche
« Je publie sur Git ? ». Après votre clic :

1. création d'une **nouvelle branche** `design/AAAA-MM-JJ-message`, jamais `main` ;
2. `npm run tokens` si le projet définit ce script ;
3. commit de **tous** les fichiers modifiés du projet, puis push vers `origin`.

La publication est refusée si un fichier sensible a changé (`.env`, clés,
`node_modules/`, `.ds-studio/`). Sans dépôt distant, le commit reste local. Un push
refusé garde le commit et permet de réessayer. L'authentification est celle de Git
sur votre poste : DS-Studio ne lit aucun identifiant.

Restent manuels : ouvrir la Pull Request, la fusionner et revenir sur `main`. Voir
[workspace/PROCESS_GITHUB.md](workspace/PROCESS_GITHUB.md).

## Où sont mes données ?

| Emplacement | Contenu |
| --- | --- |
| `.ds-studio/state.json` | DS hors projet : tokens et historique |
| `.ds-studio/projects/<identifiant>/` | DS, historique et Preview de chaque projet ouvert |
| `.ds-studio/state.previous.json` | Copie de la révision précédente |
| `.ds-studio/connection.json` | Projet ouvert et lien Figma |
| `.ds-studio/project.json` | Brief PFE privé |
| `.ds-studio/plugin.json` | Code d'appairage du plugin Figma |
| `.ds-studio/publish-counter.json` | Compteur de modifications avant publication |
| `.env` | Clé Figma (`FIGMA_TOKEN`) |
| `workspace/PFE.md`, `DESIGN_RULES.md`, `DECISIONS.md` | Votre sujet, vos règles, vos décisions |

`.ds-studio/` et `.env` sont ignorés par Git : sauvegardez-les vous-même, serveur
arrêté. Ne modifiez pas `state.json` à la main. Après un incident : lanceur →
**Journal et réparation** → **Restaurer la copie précédente…** ; l'original est
conservé. Aucune remise à zéro silencieuse.

## État réel

| Fonction | État | Portée de la preuve |
| --- | --- | --- |
| Tokens : ajout, modification, suppression, diff, historique, annulation | **VÉRIFIÉ** | Tests unitaires et navigateur, macOS |
| Import / export JSON local | **VÉRIFIÉ** | Tests navigateur |
| Ouvrir un projet, un DS par projet | **VÉRIFIÉ** | Tests navigateur et API |
| Tokens validés écrits dans le fichier DTCG du projet | **VÉRIFIÉ** | Tests unitaires |
| Clodo : choix tokens ou code, diff, annulation du code | **VÉRIFIÉ** avec un faux Claude | Tests unitaires ; une vraie question de tokens a déjà été posée au vrai CLI (2.1.311, macOS) |
| Clodo : écran complet, expertise `CLODO.md` | **À TESTER** | Jamais lancé avec le vrai Claude |
| Preview : serveur de dev du projet | **PARTIEL** | Tests unitaires macOS et Linux ; échoue en CI Windows |
| Lecture Figma (clé personnelle) | **PARTIEL** | Testée avec un faux Figma |
| Plugin Figma : variables | **À TESTER** | Seule la correspondance tokens ↔ variables est testée, hors Figma |
| Synchronisation des composants et organismes vers Figma | **NON DISPONIBLE** | — |
| Publication GitHub par lots de 10 | **VÉRIFIÉ** | Tests avec un dépôt distant local |
| Pull Request, fusion, retour sur `main` | **NON DISPONIBLE** | Manuel |
| Lanceur : démarrage, arrêt, reprise après crash | **PARTIEL** | 8 tests sur 22 passent ; les 12 autres viennent d'un test devenu obsolète avec le DS vide (correction en cours) |
| Intégration continue GitHub | **ÉCHOUE** | Tests du lanceur (macOS, Ubuntu) et Preview (Windows) |

Rapport de la V2 initiale : [DELIVERY_REPORT.md](DELIVERY_REPORT.md).

## Travailler avec un agent dans le terminal

Le chat Clodo et un agent lancé dans votre terminal (Claude Code, Codex…) sont
**deux choses différentes** : l'agent du terminal a ses propres permissions, que
DS-Studio ne contrôle pas. Depuis le dossier de DS-Studio :

> Lis START_HERE.md et les instructions de ton agent. Examine le dépôt et mon
> workspace. Aide-moi à définir puis réaliser une amélioration bornée. Préserve
> mes données et vérifie le résultat. Distingue ce qui est testé de ce qui est proposé.

`AGENTS.md` et `CLAUDE.md` partagent le même point d'entrée. Les skills sont dans
`.agents/skills/` (`token-change`, `component-audit`, `safe-recovery`) ; un agent
peut lire un `SKILL.md` explicitement.

L'adaptateur Codex (`connectors/agents/codex.ts`) existe toujours, mais le chat
de l'atelier n'utilise que Claude Code. Détails : [docs/AGENT_ADAPTERS.md](docs/AGENT_ADAPTERS.md).

## Vérifier et développer

```sh
npm run check            # typage
npm test                 # tests unitaires
npm run build
npx playwright install chromium
npm run test:e2e         # parcours dans le navigateur
npm run test:launcher    # lanceur, vrais processus
npm run qualify
npm run scan             # aucun secret dans les fichiers suivis par Git
```

`npm run dev` lance le serveur avec Vite. `npm start` sert `dist/` : reconstruisez
après un changement du frontend. Les tests utilisent des dossiers temporaires et
ne touchent pas vos données ; aucun n'appelle Claude ni Figma.
`npm run test:live` et `npm run qualify:live` appellent Codex et peuvent
consommer du quota.

## Créer votre dépôt privé

1. Créez un dépôt **privé** sur GitHub et ajoutez-le comme `origin`.
2. Vérifiez les fichiers suivis et lancez `npm run scan` avant le premier envoi.
3. Gardez `.ds-studio/`, `.env` et tout identifiant hors Git. `.gitignore` ne
   retire pas un secret déjà commité.

Code original sous [licence MIT](LICENSE) ; les dépendances gardent leurs licences.

## Pour aller plus loin

[Process GitHub](workspace/PROCESS_GITHUB.md) · [Figma](docs/FIGMA.md) ·
[Architecture](docs/ARCHITECTURE.md) · [Sécurité](docs/SECURITY.md) ·
[Guide étudiant](docs/STUDENT_GUIDE.md) · [Guide enseignant](docs/TEACHER_GUIDE.md) ·
[Backlog](docs/ROADMAP.md)

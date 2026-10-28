# Figma : lecture par l'API, écriture des variables par le plugin

Figma reste la source de vérité visuelle du Design System. DS-Studio le lit par
l'API REST officielle et écrit **uniquement des variables** par son plugin.

## Lecture — PARTIEL (testée avec un faux Figma)

`connectors/figma/reader.ts` et `connectors/figma/library.ts` lisent le fichier
lié au projet ouvert, avec la clé personnelle de l'étudiante (`FIGMA_TOKEN` dans
`.env`, ou variable d'environnement ; portée _File content : Read-only_) :

- nom, date de modification et pages du fichier ;
- composants, rangés d'après leur page (Atoms, Molécules, Organism…) ;
- structure d'un composant, transmise à Clodo pour coder ;
- aperçus (images) ;
- variables locales, par l'API des variables réservée aux offres Enterprise ; à
  défaut, les styles couleur et texte.

La clé reste côté serveur, n'est jamais envoyée au navigateur, et les erreurs
Figma sont réécrites sans leur corps. Écart assumé : la clé personnelle remplace
l'OAuth, plus lourd à déclarer ; elle est limitée à la lecture et révocable dans
les paramètres Figma.

## Écriture — À TESTER dans Figma (plugin `figma-plugin/`)

### Fonctionnement

1. DS-Studio expose `GET /api/plugin/sync`, accepté seulement depuis
   `localhost:4310` / `127.0.0.1:4310` et avec le **code d'appairage**
   (`.ds-studio/plugin.json`, renouvelable depuis l'onglet Figma). Réponse : nom
   du projet, clé du fichier Figma lié, révision et tokens **validés**.
2. Le plugin (`code.js` + `ui.html`) rapproche chaque token d'une variable locale
   de même type (couleur ↔ COLOR, dimension ↔ FLOAT, police ↔ STRING) : nom
   identique, ou suffixe unique (`color.primary.700` ↔ `primary/700`).
3. Il affiche le plan : à mettre à jour, identiques, alias, absentes (avec les
   variables au nom proche, pour comprendre l'échec).
4. **Appliquer** écrit les valeurs dans le **mode par défaut** de chaque
   collection, crée les variables absentes cochées dans une collection
   « DS-Studio », puis **relit** chaque valeur avant d'annoncer le résultat.
5. **Mode automatique** : tant que le plugin est ouvert, il interroge DS-Studio
   toutes les 4 s et applique toute nouvelle révision aux variables existantes.
   Créations : toujours sur clic.

Le plugin refuse d'appliquer si la clé du fichier ouvert diffère de celle du
projet. Ce contrôle repose sur `figma.fileKey` : s'il est indisponible, il est
sauté.

### Limites connues (d'après le code)

| Cas | Comportement actuel |
| --- | --- |
| Suppression d'un token | Aucune suppression de variable |
| Variable alias (ex. couleurs d'usage) | Ignorée, signalée dans le plan seulement |
| Autres modes (sombre…) | Non écrits |
| Composants, organismes, styles | Aucune lecture ni écriture |
| Résultat de la synchronisation | Non transmis à DS-Studio |
| Plugin fermé | Rien n'est synchronisé ; il rattrape la dernière révision à la réouverture |

Un composant ne change dans Figma que si ses calques sont **liés** aux variables
modifiées. Les valeurs en dur, la structure, les propriétés et les variantes ne
sont pas synchronisées.

Tests existants : `tests/figmaPlugin.test.ts` couvre la correspondance tokens ↔
variables et le plan, hors Figma. Aucune exécution dans Figma n'est prouvée.

## Règles pour toute écriture Figma

Elles valent pour le plugin et pour toute évolution :

- Cible explicite : refuser si le fichier ouvert n'est pas celui du projet.
- N'écrire que ce qui a été **validé** dans DS-Studio, par le diff.
- Relire les valeurs après écriture avant de dire « fait » ; en cas d'échec ou
  de délai, relire avant toute nouvelle tentative pour ne pas doubler une écriture.
- Tester d'abord sur un **fichier de test ou une copie**, jamais sur le fichier de
  référence.
- Pas de suppression ni de création sans clic.
- L'assistant de discussion ne dispose jamais d'un accès Figma libre : il ne
  voit que ce que le serveur lui transmet.
- Ne jamais réutiliser une session, extraire un jeton ou recopier des cookies.

Le serveur MCP officiel de Figma n'admet que les clients de son catalogue
([documentation](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)) :
DS-Studio n'en est pas un et ne l'utilise pas. Ses [outils](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
incluent des écritures : ne jamais supposer qu'un accès MCP est en lecture seule.
`connectors/figma/contract.ts` décrit le contrat lecture / proposition / application
validée ; ce n'est pas le code du plugin.

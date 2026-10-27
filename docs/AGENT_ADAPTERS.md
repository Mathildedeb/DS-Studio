# Adaptateurs d’agents

## Contrat commun

`connectors/agents/types.ts` définit `status()` et `reply(message, context, signal)`.
Entrée : tokens structurés, contexte PFE, règles et dix messages précédents maximum.
Sortie : `{message, changes:[{key,value}]}` validée par Zod. L’adaptateur ne reçoit
pas de Store et ne peut pas accepter une proposition. Le contrôleur HTTP prépare
le diff avec la révision de départ ; l’UI décide de sa validation humaine.

Les conversations de fournisseurs ne sont pas reprises ni mélangées. Le chat embarqué
est en mémoire dans le navigateur ; après recharge l’historique affiché est vide.
Les refus, délais et interruptions n’entraînent aucun renvoi automatique ni commit.
Pas d’orchestration parallèle de plusieurs agents dans la V2 : architecture multi-fournisseurs,
un fournisseur intégré et qualifié, deux points d’extension indisponibles.

## Codex — TESTED sous Linux avec 0.164.0

Le CLI officiel fournit `exec --json`, `--ephemeral` et `--ignore-user-config`.
Ce dernier ignore la configuration globale mais conserve la gestion officielle de
l’authentification. Référence : [official OpenAI documentation — CLI](https://learn.chatgpt.com/docs/cli/reference).
L’activation des outils shell est une option documentée ; le profil du starter la
désactive ainsi que les plugins, apps, MCP et la recherche web.
[Configuration officielle](https://learn.chatgpt.com/docs/config-file/config-reference).

Le processus n’est pas lancé dans le dépôt : un dossier temporaire vide évite de
charger la configuration du projet. Pas de shell interpolé : arguments en liste,
prompt via stdin. Authentification par `codex login`, effectuée par l’utilisateur.
Le starter ne déduit pas la validité d’une session de l’existence d’un fichier.
La disponibilité initiale signifie seulement binaire/version détectés ; le compte,
le réseau et le quota sont réellement sollicités à l’envoi. Délai maximum 120 s.

Choix : `exec` plutôt qu’app-server réduit les RPC, sessions et approbations à
maintenir pour ce profil à propositions seules. Le flux manuel reste indépendant.
Le protocole et la version ont été exécutés, pas seulement décrits. Pour changer
la version acceptée, refaire le smoke test, le test hostile, le refus sans auth,
la proposition/validation via API et les essais sur chaque OS cible.

## Claude Code — TESTED sous macOS avec 2.1.311 (affiché « Clodo »)

`connectors/agents/claude.ts` lance `claude -p` selon la
[documentation officielle headless](https://code.claude.com/docs/en/headless) :
`--tools ""` (aucun outil intégré), `--strict-mcp-config` sans `--mcp-config`
(aucun MCP), `--setting-sources ""`, `--disable-slash-commands`,
`--no-session-persistence`, `--output-format json`, consigne commune passée en
`--system-prompt`. Même confinement que Codex : dossier temporaire vide, variables
d’environnement filtrées, contexte via stdin, stderr jamais renvoyé, délai 120 s.
Une réponse en plus d’un tour ou avec `permission_denials` est refusée : sans outil,
le modèle répond en un tour. Authentification par `claude` puis `/login`, faite
par l’utilisateur ; DS-Studio ne lit pas le trousseau ni les fichiers du compte.

Testé avec un faux CLI lancé par Node : réponse convertie en proposition, tentative
d’outil refusée, échec de compte sans fuite de stderr, CLI absent. Testé avec le vrai
CLI 2.1.311 sous macOS (connexion par abonnement claude.ai, usage personnel local) :
options reconnues par `--help`, une question réelle depuis l’atelier, réponse JSON
valide. Le CLI est cherché dans `~/.local/bin` (installateur officiel) puis dans le
PATH. Les tests automatisés injectent un faux adaptateur : ils ne consomment aucun
quota. **Non testé** : quota épuisé, arrêt d’un vrai processus en cours, Windows et
Linux, et l’effet des hooks utilisateur malgré `--setting-sources ""`. Ne pas remplacer
cette qualification par `--dangerously-skip-permissions`.

## Gemini CLI — NOT IMPLEMENTED

Point d’extension : `unvalidatedAdapter('gemini')`. La [référence headless officielle](https://geminicli.com/docs/cli/headless/)
présente JSON/stream-json. L’authentification et les callbacks de permissions restent
à éprouver dans un vrai processus embarqué. Ne pas utiliser de mode yolo ou
supposer qu’un login étudiant permet un usage gratuit sans quota. Même série de
tests que Claude avant d’exposer un bouton actif.

## Clodo en mode Code — TESTED sous macOS (CLI 2.1.311)

Même confinement que le mode Tokens : Clodo n’a aucun outil et ne touche jamais au disque.
`connectors/agents/coder.ts` fait deux appels sans outil. Le premier montre la demande
et la liste des fichiers modifiables, et Clodo en choisit cinq au plus. Le second envoie
ces fichiers, et Clodo répond par des remplacements exacts `{file, search, replace}`.
`app/server/code.ts` est le seul auteur des écritures :

- liste blanche : `app/client/*.tsx|ts|css`, `workspace/PFE.md`, `DESIGN_RULES.md`,
  `DECISIONS.md`, `roadmap.json`. Jamais le serveur, les connecteurs, les tests, les
  scripts, `package.json`, `.env` ni `.ds-studio/` ; liens symboliques refusés ;
- chaque passage `search` doit exister une seule fois, sinon rien n’est préparé ;
- le diff est affiché, et rien n’est écrit avant « Appliquer » (usage unique, 30 min) ;
- l’écriture est refusée si un fichier a changé depuis la proposition ;
- avant chaque écriture, l’original est copié dans `.ds-studio/code-history/`, et
  l’annulation est refusée si le fichier a été retouché depuis.

Testé : liste blanche, chemins détournés, lien symbolique, passage absent ou ambigu,
fichier changé, usage unique, annulation, session exigée, faux Clodo de bout en bout
(sans quota). Essai réel : renommage d’un titre de widget, proposé puis appliqué depuis
l’atelier. **Non testé** : demandes longues sur plusieurs fichiers, Windows et Linux.
Limites : aucune vérification TypeScript après application (l’erreur s’affiche dans
l’atelier), et l’historique du chat est perdu quand l’atelier se recharge.

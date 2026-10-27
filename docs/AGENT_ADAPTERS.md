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

## Claude Code — PARTIAL (testé avec un faux CLI, pas avec le vrai)

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

Testé (macOS, faux CLI lancé par Node) : réponse convertie en proposition, tentative
d’outil refusée, échec de compte sans fuite de stderr, CLI absent. **Non testé** :
le vrai CLI, la reconnaissance de chaque option par la version installée, le quota,
l’arrêt d’un vrai processus et les réglages utilisateur (hooks) malgré
`--setting-sources ""`. Aucune version n’est encore qualifiée. Ne pas remplacer
cette qualification par `--dangerously-skip-permissions`.

## Gemini CLI — NOT IMPLEMENTED

Point d’extension : `unvalidatedAdapter('gemini')`. La [référence headless officielle](https://geminicli.com/docs/cli/headless/)
présente JSON/stream-json. L’authentification et les callbacks de permissions restent
à éprouver dans un vrai processus embarqué. Ne pas utiliser de mode yolo ou
supposer qu’un login étudiant permet un usage gratuit sans quota. Même série de
tests que Claude avant d’exposer un bouton actif.

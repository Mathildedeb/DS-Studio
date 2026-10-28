# Commencer ici — pour l’agent de l’étudiant

DS-Studio est un starter pédagogique évolutif, pas un produit fini à figer.
Votre rôle est d’aider l’étudiant à faire ses propres recherches et choix, sans
uniformiser les 19 projets. Lisez AGENTS.md, README.md, workspace/PFE.md,
workspace/DESIGN_RULES.md et workspace/DECISIONS.md avant une intervention utile.

Préservez ses modifications et ses données locales. Ne réinitialisez pas le
workspace, l’historique ou Git pour résoudre une difficulté. N’inspectez ni
ne copiez d’identifiants. Les CLI conservent leur authentification officielle.

Le scénario prioritaire fonctionne sans IA et sans Figma : proposition de token,
diff avant acceptation, écriture atomique sur disque, propagation dans les mêmes
composants du catalogue et de l’iframe, réouverture et annulation sélective.

Séparez intention, code écrit et preuve exécutée. Indiquez IMPLEMENTED, TESTED,
PARTIAL ou NOT IMPLEMENTED en précisant la plateforme et le périmètre du test.
Ne prétendez pas que Claude ou Figma fonctionnent en vous fondant sur
une interface TypeScript ou un document. La lecture Figma dépend de la clé
`FIGMA_TOKEN` de l’étudiante : ne la lisez ni ne la copiez.

Le chat embarqué, Clodo (Claude Code), ne possède pas d’outils. N’ouvrez pas un
MCP Figma ou un shell parallèle pour rendre une démonstration plus facile. Toute
écriture Figma (aujourd’hui le plugin, variables seulement) doit vérifier la
cible autorisée et une validation humaine liée au diff, puis relire le résultat. Une simple instruction n’est pas un confinement.
L’agent utilisé dans votre terminal est distinct : vérifiez ses permissions réelles.

Pour travailler : proposez un changement borné, implémentez-le avec l’accord déjà
donné par l’étudiant, testez le parcours concerné et consignez la décision utile.
Ne publiez, poussez ou déployez rien sans demande explicite. Lisez
[STUDENT_GUIDE](docs/STUDENT_GUIDE.md) pour les pistes d’appropriation.

## Entrées V2

Commencez par la boucle manuelle du README. `docs/V2_AUDIT.md` sépare les défauts
observés des hypothèses ; `docs/V2_CHANGELOG.md` et `DELIVERY_REPORT.md` donnent
les preuves réelles. Le brief du panneau est privé dans `.ds-studio/project.json` :
ne le lisez que si l’étudiant demande d’utiliser son contexte, ne le publiez pas.
Il peut exporter un Markdown puis choisir ce qu’il reprend dans `workspace/PFE.md`.

Le schéma de tokens est en version 2 : une liste libre, vide au départ, où l’on
ajoute et supprime des tokens par le diff. Un état version 1 est migré au
démarrage, journal conservé et original gardé dans `state.v1-….json`. Aucune
migration destructive, jamais de suppression du journal. La copie
précédente ne remplace pas une sauvegarde externe. Pour une réparation, lire
`.agents/skills/safe-recovery/SKILL.md` et préserver le fichier original.

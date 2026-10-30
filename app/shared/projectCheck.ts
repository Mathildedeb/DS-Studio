// Contrôle d'un projet ouvert dans DS-Studio : ce qu'il faut pour que tout
// marche (Git, application React + Vite, composants, tokens, Figma, Preview),
// ce qui manque et comment le régler. Le chat présente cette checklist et
// propose, pour chaque manque, l'action qu'il sait faire ; ce qui ne dépend
// que de l'utilisatrice est expliqué, jamais fait à sa place.

export type ProjectFacts = {
  name: string;
  git: { branch: string | null; remote: string | null } | null;
  packageJson: boolean;
  devScript: string | null;
  react: boolean;
  vite: boolean;
  nodeModules: boolean;
  components: number;
  tokens: { file: string; count: number } | null;
  figma: { linked: boolean; hasToken: boolean; connected: boolean; label: string };
  figmaComponents: number;
  coded: number;
  relay: { installed: boolean; current: boolean };
  pluginSeen: boolean;
  // Lancement réel du projet (npm run dev) et compilation TypeScript ;
  // absents si le contrôle ne pouvait pas les faire (pas d'application…).
  start?: { ok: boolean; url?: string; log?: string };
  compile?: { ok: boolean; errors?: number; log?: string };
};

// Ce que le chat peut faire pour régler un manque.
export type Fix =
  | { kind: 'action'; action: 'install' | 'relay' | 'open-project' | 'import-tokens'; label: string }
  | { kind: 'chat'; label: string; message: string }
  | { kind: 'manual'; label: string };

export type CheckItem = {
  id: string;
  label: string;
  state: 'ok' | 'warn' | 'missing';
  detail: string;
  fix?: Fix;
};

export function checkProject(f: ProjectFacts): CheckItem[] {
  const items: CheckItem[] = [];
  items.push(
    !f.git
      ? {
          id: 'git',
          label: 'Dépôt Git',
          state: 'missing',
          detail: 'Ce dossier n’est pas un dépôt Git : rien ne pourra partir sur GitHub.',
          fix: { kind: 'manual', label: 'Clone le projet avec GitHub Desktop (Clone repository), puis rouvre ce dossier.' },
        }
      : !f.git.remote
        ? {
            id: 'git',
            label: 'Dépôt Git',
            state: 'warn',
            detail: `Branche ${f.git.branch ?? '?'}, mais pas reliée à GitHub : la publication restera locale.`,
            fix: { kind: 'manual', label: 'Publie le dépôt sur GitHub (GitHub Desktop → Publish repository).' },
          }
        : { id: 'git', label: 'Dépôt Git', state: 'ok', detail: `Branche ${f.git.branch ?? '?'}, relié à GitHub.` },
  );
  items.push(
    !f.packageJson
      ? {
          id: 'app',
          label: 'Application',
          state: 'missing',
          detail: 'Pas de package.json : ce n’est pas un projet web que DS-Studio sait lancer.',
          fix: { kind: 'chat', label: 'Créer le projet React + Vite', message: 'Crée dans mon projet une application React + Vite + TypeScript minimale (package.json avec un script dev, src/main.tsx, src/App.tsx), sans toucher à l’existant.' },
        }
      : !f.devScript
        ? {
            id: 'app',
            label: 'Application',
            state: 'missing',
            detail: 'Aucun script « dev » ni « start » : la Preview ne peut pas lancer le projet.',
            fix: { kind: 'chat', label: 'Ajouter le script dev', message: 'Ajoute un script « dev » au package.json de mon projet pour lancer son serveur de développement.' },
          }
        : !f.react || !f.vite
          ? {
              id: 'app',
              label: 'Application',
              state: 'warn',
              detail: `${f.devScript} existe, mais le projet n’est pas en ${[!f.react && 'React', !f.vite && 'Vite'].filter(Boolean).join(' + ')} : l’Aperçu marche, pas le mode Composer.`,
              fix: { kind: 'manual', label: 'Le mode Composer est fait pour React + Vite ; l’Aperçu reste utilisable.' },
            }
          : { id: 'app', label: 'Application', state: 'ok', detail: `React + Vite, lancé par ${f.devScript}.` },
  );
  if (f.packageJson)
    items.push(
      f.nodeModules
        ? { id: 'deps', label: 'Dépendances', state: 'ok', detail: 'Installées.' }
        : {
            id: 'deps',
            label: 'Dépendances',
            state: 'missing',
            detail: 'Pas encore installées : le projet ne peut pas se lancer.',
            fix: { kind: 'action', action: 'install', label: 'Installer (npm install)' },
          },
    );
  if (f.start)
    items.push(
      f.start.ok
        ? { id: 'start', label: 'Démarrage', state: 'ok', detail: `Le projet démarre (${f.start.url ?? 'en ligne'}).` }
        : (() => {
            const d = diagnose(f.start!.log ?? '', 'start');
            return { id: 'start', label: 'Démarrage', state: 'missing' as const, detail: d.cause, fix: d.fix };
          })(),
    );
  if (f.compile)
    items.push(
      f.compile.ok
        ? { id: 'compile', label: 'Compilation', state: 'ok', detail: 'Aucune erreur TypeScript.' }
        : (() => {
            const d = diagnose(f.compile!.log ?? '', 'compile');
            return {
              id: 'compile',
              label: 'Compilation',
              state: 'warn' as const,
              detail: `${f.compile!.errors ?? 'Des'} erreur(s) TypeScript : le projet peut tourner, mais le Build et la publication risquent d’échouer.`,
              fix: d.fix,
            };
          })(),
    );
  items.push(
    f.components
      ? { id: 'components', label: 'Composants codés', state: 'ok', detail: `${f.components} dans src/components.` }
      : {
          id: 'components',
          label: 'Composants codés',
          state: 'warn',
          detail: 'Aucun composant dans src/components : DS-Studio ne reconnaît pas encore de composant codé.',
          fix: f.figmaComponents
            ? { kind: 'chat', label: 'Ranger ou coder les composants', message: 'Mes composants doivent être dans src/components/<atoms|molecules|organisms>/<Nom>/<Nom>.tsx avec une interface <Nom>Props. Range ceux qui existent déjà à cet endroit sans les recoder ; s’il n’y en a aucun, code le premier atome de mon fichier Figma, fidèle à Figma, avec mes tokens.' }
            : { kind: 'manual', label: 'Range les composants dans src/components/<atoms|molecules|organisms>/<Nom>/.' },
        },
  );
  items.push(
    f.tokens
      ? { id: 'tokens', label: 'Tokens du code', state: 'ok', detail: `${f.tokens.count} tokens lus dans ${f.tokens.file}.` }
      : {
          id: 'tokens',
          label: 'Tokens du code',
          state: 'missing',
          detail: 'Aucun fichier de tokens (format DTCG, design-system/tokens.json) : le DS ne peut pas être relié au code.',
          fix: { kind: 'chat', label: 'Créer le fichier de tokens', message: 'Crée design-system/tokens.json au format DTCG avec les tokens de mon DS, et un script « npm run tokens » qui génère src/design-system/tokens.css (variables CSS) à partir de ce fichier. N’invente aucune valeur : uniquement mes tokens.' },
        },
  );
  items.push(
    !f.figma.linked
      ? {
          id: 'figma',
          label: 'Fichier Figma',
          state: 'missing',
          detail: 'Aucun lien Figma pour ce projet.',
          fix: { kind: 'action', action: 'open-project', label: 'Ajouter le lien Figma' },
        }
      : !f.figma.hasToken
        ? {
            id: 'figma',
            label: 'Fichier Figma',
            state: 'missing',
            detail: 'Lien enregistré, mais pas de clé Figma : DS-Studio ne peut pas lire le fichier.',
            fix: { kind: 'manual', label: 'Ajoute FIGMA_TOKEN=ta-clé dans le fichier .env de DS-Studio (portée « File content : Read-only »), puis relance DS-Studio.' },
          }
        : !f.figma.connected
          ? {
              id: 'figma',
              label: 'Fichier Figma',
              state: 'missing',
              detail: f.figma.label,
              fix: { kind: 'manual', label: 'Vérifie que ta clé Figma a accès à ce fichier et que le lien est le bon.' },
            }
          : {
              id: 'figma',
              label: 'Fichier Figma',
              state: 'ok',
              detail: `${f.figmaComponents} composants lus, dont ${f.coded} déjà codés ; les autres s’utilisent en maquette.`,
            },
  );
  if (f.react && f.vite && f.devScript)
    items.push(
      f.relay.current
        ? { id: 'relay', label: 'Preview (mode Composer)', state: 'ok', detail: 'Relais installé et à jour.' }
        : {
            id: 'relay',
            label: 'Preview (mode Composer)',
            state: 'missing',
            detail: f.relay.installed ? 'Relais à mettre à jour.' : 'Relais pas encore installé (2 fichiers, développement seulement).',
            fix: { kind: 'action', action: 'relay', label: 'Voir le diff du relais' },
          },
    );
  if (f.figma.linked)
    items.push(
      f.pluginSeen
        ? { id: 'plugin', label: 'Plugin Figma', state: 'ok', detail: 'Ouvert : la synchro Figma ↔ code fonctionne.' }
        : {
            id: 'plugin',
            label: 'Plugin Figma',
            state: 'warn',
            detail: 'Pas ouvert : rien ne peut être écrit dans Figma, ni les variables récupérées.',
            fix: { kind: 'manual', label: 'Dans Figma desktop, ouvre le plugin DS-Studio sur ce fichier et coche Mode automatique.' },
          },
    );
  return items;
}

// Une erreur (journal npm, Vite, compilation) traduite en clair : la cause,
// et la suite proposée. Les cas inconnus vont à Clodo avec le journal.
export function diagnose(log: string, step: 'install' | 'start' | 'compile'): { cause: string; fix: Fix } {
  const text = log.slice(-4000);
  const has = (re: RegExp) => re.test(text);
  if (has(/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|network|getaddrinfo/i))
    return {
      cause: 'Pas d’accès à Internet (le registre npm est injoignable).',
      fix: { kind: 'manual', label: 'Vérifie ta connexion, puis clique « Revérifier ».' },
    };
  if (has(/EPERM|EACCES|operation not permitted|permission denied/i))
    return {
      cause:
        'Écriture refusée dans le dossier du projet : DS-Studio est sans doute lancé par un autre outil (Codex, un bac à sable) qui n’a pas le droit d’écrire ici.',
      fix: { kind: 'manual', label: 'Relance DS-Studio toi-même (DS-Studio.app ou npm run dev), hors de cet outil.' },
    };
  if (has(/EADDRINUSE|address already in use|port \d+ is in use/i))
    return {
      cause: 'Le port du projet est déjà occupé par un autre serveur.',
      fix: { kind: 'manual', label: 'Arrête l’autre serveur du projet (ou ferme l’outil qui l’a lancé), puis « Revérifier ».' },
    };
  if (has(/ERESOLVE|peer dep|could not resolve dependency/i))
    return {
      cause: 'Des dépendances du projet sont incompatibles entre elles.',
      fix: {
        kind: 'chat',
        label: 'Demander à Clodo de corriger',
        message: `npm install échoue sur un conflit de dépendances. Propose la correction minimale du package.json, sans changer de version majeure sans le dire. Journal :\n${text.slice(-1500)}`,
      },
    };
  if (has(/Cannot find module|Failed to resolve import|Could not resolve|ERR_MODULE_NOT_FOUND/i))
    return step === 'install'
      ? { cause: 'Un module est introuvable pendant l’installation.', fix: { kind: 'action', action: 'install', label: 'Réinstaller (npm install)' } }
      : {
          cause: 'Le projet importe un fichier ou un module introuvable.',
          fix: {
            kind: 'chat',
            label: 'Demander à Clodo de corriger',
            message: `Mon projet ne ${step === 'start' ? 'démarre' : 'compile'} pas : un import est introuvable. Trouve la cause et propose la correction minimale. Journal :\n${text.slice(-1500)}`,
          },
        };
  return {
    cause:
      step === 'install'
        ? 'npm install a échoué.'
        : step === 'start'
          ? 'Le projet ne démarre pas.'
          : 'Le projet a des erreurs de compilation.',
    fix: {
      kind: 'chat',
      label: 'Demander à Clodo de corriger',
      message: `Mon projet ${step === 'install' ? 'ne s’installe pas (npm install)' : step === 'start' ? 'ne démarre pas (npm run dev)' : 'ne compile pas (TypeScript)'}. Trouve la cause dans ce journal et propose la correction minimale, sans casser l’existant :\n${text.slice(-1500)}`,
    },
  };
}

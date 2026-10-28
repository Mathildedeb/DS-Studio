// Checklist affichée dans le chat après une validation : chaque ligne dit ce
// qui s'est réellement passé (jamais « fait » par défaut) et, en cas d'échec,
// la solution la plus simple. Calculée à partir de /api/circuit.
export interface CircuitData {
  revision: number;
  step: {
    revision: number;
    code: { state: 'ok' | 'error' | 'absent'; detail?: string };
    interface: { state: 'ok' | 'error' | 'absent'; detail?: string };
  } | null;
  figmaLinked: boolean;
  figma: {
    report: {
      revision: number;
      updated: number;
      created: number;
      failed: { key: string; reason: string }[];
      warning?: string | null;
    } | null;
    pluginOpen: boolean;
  };
  git: { pending: number; batch: number; branch: string | null } | null;
}
export type StepState = 'ok' | 'pending' | 'warn' | 'todo';
export interface CircuitStep {
  id: 'ds' | 'code' | 'interface' | 'figma' | 'github';
  label: string;
  state: StepState;
  detail: string;
  fix?: string;
}

// Solution pour une variable que le plugin n'a pas pu mettre à jour.
function figmaFix(reason: string) {
  if (reason.startsWith('aucune variable de ce nom'))
    return 'Aucune variable voisine ne dit où la créer : crée-la dans Figma (bonne collection, même nom), puis clique « Récupérer depuis Figma » dans le plugin.';
  if (reason.startsWith('alias'))
    return 'Dans Figma, rebranche cet alias sur la bonne variable de base, ou choisis dans DS-Studio une couleur qui existe déjà dans Master.';
  if (reason.startsWith('variable transparente'))
    return 'DS-Studio ne gère pas la transparence : modifie cette variable directement dans Figma.';
  if (reason.startsWith('type différent'))
    return 'Le token et la variable n’ont pas le même type : renomme l’un des deux.';
  return 'Ouvre « Voir les changements » dans le plugin pour le détail, ou demande à Clodo.';
}

export function circuitSteps(data: CircuitData, revision: number): CircuitStep[] {
  const steps: CircuitStep[] = [
    { id: 'ds', label: 'Enregistrer la modification', state: 'ok', detail: `révision ${revision}` },
  ];
  const step = data.step?.revision === revision ? data.step : null;
  if (data.git) {
    if (!step)
      steps.push({ id: 'code', label: 'Mettre à jour le code du projet', state: 'pending', detail: '' });
    else if (step.code.state === 'ok')
      steps.push({ id: 'code', label: 'Mettre à jour le code du projet', state: 'ok', detail: step.code.detail ?? 'tokens.json' });
    else
      steps.push({
        id: 'code',
        label: 'Mettre à jour le code du projet',
        state: 'warn',
        detail: step.code.detail ?? 'fichier de tokens non écrit',
        fix: 'Vérifie que le fichier de tokens du projet est bien au format DTCG ($type / $value), puis valide à nouveau.',
      });
    if (step?.code.state === 'ok') {
      if (step.interface.state === 'ok')
        steps.push({ id: 'interface', label: 'Régénérer l’interface', state: 'ok', detail: 'npm run tokens' });
      else if (step.interface.state === 'absent')
        steps.push({ id: 'interface', label: 'Régénérer l’interface', state: 'ok', detail: 'rien à régénérer (pas de script « tokens »)' });
      else
        steps.push({
          id: 'interface',
          label: 'Régénérer l’interface',
          state: 'warn',
          detail: step.interface.detail ?? 'npm run tokens a échoué',
          fix: 'Lance « npm run tokens » dans le dossier du projet pour voir l’erreur complète, ou demande à Clodo.',
        });
    }
  }
  const report = data.figma.report;
  let figmaBehind = false;
  if (!data.figmaLinked)
    steps.push({ id: 'figma', label: 'Mettre à jour Figma', state: 'todo', detail: 'projet sans fichier Figma relié' });
  else if (report && report.revision >= revision) {
    const warning = report.warning ? ` · ${report.warning}` : '';
    if (report.failed.length)
      steps.push({
        id: 'figma',
        label: 'Mettre à jour Figma',
        state: 'warn',
        detail: `${report.updated} variable(s) mise(s) à jour, ${report.failed.length} non appliquée(s) : ${report.failed
          .slice(0, 3)
          .map((f) => `${f.key} (${f.reason})`)
          .join(', ')}${report.failed.length > 3 ? '…' : ''}${warning}`,
        fix: figmaFix(report.failed[0].reason),
      });
    else
      steps.push({
        id: 'figma',
        label: 'Mettre à jour Figma',
        state: 'ok',
        detail: `${report.updated} variable(s) mise(s) à jour et relue(s)${warning}`,
      });
  } else {
    figmaBehind = true;
    steps.push(
      data.figma.pluginOpen
        ? { id: 'figma', label: 'Mettre à jour Figma', state: 'pending', detail: 'le plugin applique…' }
        : {
            id: 'figma',
            label: 'Mettre à jour Figma',
            state: 'warn',
            detail: 'pas à jour : le plugin DS-Studio n’est pas ouvert dans Figma',
            fix: `Ouvre le plugin DS-Studio dans ton fichier Figma, synchronisation automatique cochée : il rattrapera la révision ${revision}.`,
          },
    );
  }
  if (data.git)
    steps.push({
      id: 'github',
      label: 'Publier sur GitHub',
      state: 'todo',
      detail:
        data.git.pending >= data.git.batch
          ? `${data.git.pending}/${data.git.batch} : publication proposée dans le chat`
          : `${data.git.pending}/${data.git.batch} avant publication${figmaBehind ? ' · bloquée tant que Figma n’est pas à jour' : ''}`,
    });
  return steps;
}

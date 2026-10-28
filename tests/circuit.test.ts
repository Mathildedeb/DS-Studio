import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circuitSteps, type CircuitData } from '../app/shared/circuit.js';

const base: CircuitData = {
  revision: 8,
  step: {
    revision: 8,
    code: { state: 'ok', detail: 'design-system/tokens.json' },
    interface: { state: 'ok' },
  },
  figmaLinked: true,
  figma: { report: null, pluginOpen: false },
  git: { pending: 4, batch: 10, branch: 'main' },
};
const states = (data: CircuitData) =>
  circuitSteps(data, 8).map((s) => `${s.id}:${s.state}`);

test('checklist : rien n’est coché par défaut, Figma fermé signalé avec sa solution', () => {
  assert.deepEqual(states(base), [
    'ds:ok',
    'code:ok',
    'interface:ok',
    'figma:warn',
    'github:todo',
  ]);
  const figma = circuitSteps(base, 8)[3];
  assert.match(figma.fix ?? '', /Ouvre le plugin DS-Studio/);
  assert.match(circuitSteps(base, 8)[4].detail, /4\/10.*bloquée tant que Figma/);
  // Plugin ouvert : en cours ; compte rendu de la révision : à jour.
  assert.equal(circuitSteps({ ...base, figma: { report: null, pluginOpen: true } }, 8)[3].state, 'pending');
  const done = { ...base, figma: { pluginOpen: true, report: { revision: 8, updated: 1, created: 0, failed: [] } } };
  assert.deepEqual(states(done).slice(3), ['figma:ok', 'github:todo']);
  assert.doesNotMatch(circuitSteps(done, 8)[4].detail, /bloquée/);
});

test('checklist : un échec donne sa raison et une solution, jamais un ✅', () => {
  const failed: CircuitData = {
    ...base,
    step: { revision: 8, code: { state: 'ok' }, interface: { state: 'error', detail: 'npm run tokens a échoué (code 1)' } },
    figma: {
      pluginOpen: true,
      report: { revision: 8, updated: 0, created: 0, failed: [{ key: 'state.hoverText', reason: 'aucune variable de ce nom dans Figma' }] },
    },
  };
  const steps = circuitSteps(failed, 8);
  assert.deepEqual(steps.map((s) => s.state), ['ok', 'ok', 'warn', 'warn', 'todo']);
  assert.match(steps[2].fix ?? '', /npm run tokens/);
  assert.match(steps[3].fix ?? '', /Récupérer depuis Figma/);
  // Ancienne révision : l'étape de code n'est pas celle de cette validation.
  assert.equal(circuitSteps({ ...base, step: { ...base.step!, revision: 7 } }, 8)[1].state, 'pending');
  // Sans projet ni Figma : seules les lignes utiles.
  assert.deepEqual(states({ ...base, git: null, figmaLinked: false }), ['ds:ok', 'figma:todo']);
});

test('checklist : Clodo conclut une fois rien en cours, avec la solution en cas d’échec', async () => {
  const { circuitConclusion } = await import('../app/shared/circuit.js');
  // Plugin ouvert, Figma en cours : pas encore de conclusion.
  assert.equal(circuitConclusion(circuitSteps({ ...base, figma: { report: null, pluginOpen: true } }, 8)), null);
  const closed = circuitConclusion(circuitSteps(base, 8));
  assert.match(closed?.text ?? '', /^⚠ Pas encore à jour partout\nMettre à jour Figma : .*\n→ Ouvre le plugin DS-Studio/);
  const done = circuitConclusion(
    circuitSteps({ ...base, figma: { pluginOpen: true, report: { revision: 8, updated: 1, created: 0, failed: [] } } }, 8),
  );
  assert.equal(done?.key, 'ok');
  assert.equal(
    done?.text,
    'C’est bon ✓ À jour : ton code, ton interface et Figma\nGitHub : 4/10 avant publication',
  );
});

test('checklist : Clodo liste les composants Figma et les fichiers du code touchés', async () => {
  const { circuitImpact, circuitConclusion } = await import('../app/shared/circuit.js');
  const data: CircuitData = {
    ...base,
    step: { ...base.step!, keys: ['background.composant.dark'], usedIn: ['src/App.css'] },
    figma: {
      pluginOpen: true,
      report: {
        revision: 8,
        updated: 1,
        created: 0,
        failed: [],
        impacted: [
          { name: 'Card', page: 'Molécules' },
          { name: 'Menu', page: 'Organism' },
        ],
      },
    },
  };
  const impact = circuitImpact(data, 8);
  assert.equal(
    impact,
    'Composants Figma touchés (2) : Card (Molécules), Menu (Organism)\nCode : src/App.css',
  );
  assert.equal(
    circuitConclusion(circuitSteps(data, 8), impact)?.text,
    'C’est bon ✓ À jour : ton code, ton interface et Figma\nComposants Figma touchés (2) : Card (Molécules), Menu (Organism)\nCode : src/App.css\nGitHub : 4/10 avant publication',
  );
  // Rien n'utilise le token : Clodo le dit aussi.
  assert.match(
    circuitImpact({ ...data, step: { ...data.step!, usedIn: [] }, figma: { ...data.figma, report: { ...data.figma.report!, impacted: [] } } }, 8),
    /^Aucun composant Figma touché\nAucun fichier du code ne l’utilise encore$/,
  );
});

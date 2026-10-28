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
  circuitSteps(data, 8).map((s) => `${s.label}:${s.state}`);

test('checklist : rien n’est coché par défaut, Figma fermé signalé avec sa solution', () => {
  assert.deepEqual(states(base), [
    'DS Studio:ok',
    'Code:ok',
    'Interface:ok',
    'Figma:warn',
    'GitHub:todo',
  ]);
  const figma = circuitSteps(base, 8)[3];
  assert.match(figma.fix ?? '', /Ouvre le plugin DS-Studio/);
  assert.match(circuitSteps(base, 8)[4].detail, /4\/10.*bloquée tant que Figma/);
  // Plugin ouvert : en cours ; compte rendu de la révision : à jour.
  assert.equal(circuitSteps({ ...base, figma: { report: null, pluginOpen: true } }, 8)[3].state, 'pending');
  const done = { ...base, figma: { pluginOpen: true, report: { revision: 8, updated: 1, created: 0, failed: [] } } };
  assert.deepEqual(states(done).slice(3), ['Figma:ok', 'GitHub:todo']);
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
  assert.deepEqual(states({ ...base, git: null, figmaLinked: false }), ['DS Studio:ok', 'Figma:todo']);
});

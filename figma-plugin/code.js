// Plugin Figma DS-Studio : applique les tokens validés dans DS-Studio aux
// variables du fichier. Plan d'abord, application au clic, puis relecture.
// Les fonctions pures du haut sont aussi testées hors de Figma.

// « Master/primary/purple/700 » → « master.primary.purple.700 »
function norm(name) {
  return String(name)
    .split('/')
    .map((seg) =>
      seg
        .normalize('NFD')
        .replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
        .replace(/^[A-Z]/, (c) => c.toLowerCase()),
    )
    .filter(Boolean)
    .join('.');
}
const kinds = { color: 'COLOR', dimension: 'FLOAT', fontFamily: 'STRING' };

function toHex(c) {
  const part = (x) =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  return ('#' + part(c.r) + part(c.g) + part(c.b)).toUpperCase();
}
function fromHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
    a: 1,
  };
}
// Valeur Figma lisible, comparable à la valeur du token.
function readable(variable) {
  const v = variable.value;
  if (v && typeof v === 'object' && v.type === 'VARIABLE_ALIAS') return null;
  if (variable.resolvedType === 'COLOR' && v && typeof v === 'object')
    return toHex(v);
  return v;
}

// Variable correspondant à un token : même type, nom identique ou suffixe du
// token (« color.primary.purple.700 » ↔ « primary/purple/700 »). Unique sinon rien.
function matchVariable(key, type, variables) {
  const same = variables.filter((v) => v.resolvedType === kinds[type]);
  const exact = same.filter(
    (v) => norm(v.name) === key || norm(v.path) === key,
  );
  if (exact.length === 1) return exact[0];
  const suffix = same.filter((v) => key.endsWith('.' + norm(v.name)));
  if (suffix.length === 1) return suffix[0];
  return null;
}

function plan(tokens, variables) {
  const result = { updates: [], same: 0, missing: [], aliased: [] };
  for (const [key, token] of Object.entries(tokens)) {
    const v = matchVariable(key, token.$type, variables);
    if (!v) {
      result.missing.push({
        key,
        type: token.$type,
        value: token.$value,
        // Pour comprendre l'échec : variables au dernier segment identique.
        near: variables
          .filter((x) => norm(x.name).split('.').pop() === key.split('.').pop())
          .slice(0, 3)
          .map((x) => x.path + ' (' + x.resolvedType + ')'),
      });
      continue;
    }
    const before = readable(v);
    if (before === null) result.aliased.push(key);
    else if (before === token.$value) result.same++;
    else
      result.updates.push({
        key,
        id: v.id,
        name: v.path,
        type: token.$type,
        before,
        after: token.$value,
      });
  }
  return result;
}
function figmaValue(type, value) {
  return type === 'color' ? fromHex(value) : value;
}

if (typeof module !== 'undefined')
  module.exports = { norm, matchVariable, plan, toHex, fromHex };

if (typeof figma !== 'undefined') {
  figma.showUI(__html__, { width: 400, height: 600, themeColors: true });

  // Variables locales avec leur valeur dans le mode par défaut.
  const readVariables = async () => {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const byId = new Map(collections.map((c) => [c.id, c]));
    const variables = await figma.variables.getLocalVariablesAsync();
    return variables.map((v) => {
      const col = byId.get(v.variableCollectionId);
      return {
        id: v.id,
        name: v.name,
        path: (col ? col.name + '/' : '') + v.name,
        resolvedType: v.resolvedType,
        modeId: col ? col.defaultModeId : undefined,
        value: col ? v.valuesByMode[col.defaultModeId] : undefined,
      };
    });
  };

  figma.ui.onmessage = async (msg) => {
    try {
      if (msg.type === 'load-settings') {
        figma.ui.postMessage({
          type: 'settings',
          server: await figma.clientStorage.getAsync('server'),
          code: await figma.clientStorage.getAsync('code'),
        });
      }
      if (msg.type === 'save-settings') {
        await figma.clientStorage.setAsync('server', msg.server);
        await figma.clientStorage.setAsync('code', msg.code);
      }
      if (msg.type === 'plan') {
        // Fichier autorisé : celui du projet ouvert dans DS-Studio, et aucun autre.
        if (msg.fileKey && figma.fileKey && msg.fileKey !== figma.fileKey)
          return figma.ui.postMessage({
            type: 'error',
            message:
              'Ce fichier Figma n’est pas celui du projet ouvert dans DS-Studio. Rien ne sera modifié.',
          });
        const variables = await readVariables();
        figma.ui.postMessage({
          type: 'plan',
          file: figma.root.name,
          variables: variables.length,
          plan: plan(msg.tokens, variables),
        });
      }
      if (msg.type === 'apply') {
        const done = [];
        const failed = [];
        for (const u of msg.updates) {
          const v = await figma.variables.getVariableByIdAsync(u.id);
          const col =
            v &&
            (await figma.variables.getVariableCollectionByIdAsync(
              v.variableCollectionId,
            ));
          if (!v || !col) {
            failed.push(u.key);
            continue;
          }
          v.setValueForMode(col.defaultModeId, figmaValue(u.type, u.after));
          done.push(u);
        }
        let created = 0;
        if (msg.create && msg.create.length) {
          const collections =
            await figma.variables.getLocalVariableCollectionsAsync();
          const col =
            collections.find((c) => c.name === 'DS-Studio') ||
            figma.variables.createVariableCollection('DS-Studio');
          for (const m of msg.create) {
            const v = figma.variables.createVariable(
              m.key.split('.').join('/'),
              col,
              kinds[m.type],
            );
            v.setValueForMode(col.defaultModeId, figmaValue(m.type, m.value));
            created++;
          }
        }
        // Relecture : chaque valeur écrite est relue avant de dire « fait ».
        const after = await readVariables();
        const wrong = done.filter((u) => {
          const v = after.find((x) => x.id === u.id);
          return !v || readable(v) !== u.after;
        });
        figma.ui.postMessage({
          type: 'report',
          updated: done.length - wrong.length,
          created,
          failed: failed.concat(wrong.map((u) => u.key)),
        });
        figma.notify(
          `DS-Studio : ${done.length - wrong.length} variable(s) mise(s) à jour` +
            (created ? `, ${created} créée(s)` : ''),
        );
      }
    } catch (e) {
      figma.ui.postMessage({ type: 'error', message: String(e.message || e) });
    }
  };
}

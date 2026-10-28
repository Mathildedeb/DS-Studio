// Plugin Figma DS-Studio : pont entre les variables du fichier et les tokens
// validés dans DS-Studio, dans les deux sens.
// - Récupérer : les variables deviennent des tokens, envoyés à DS-Studio qui
//   les montre en diff ; rien n'y est écrit sans validation.
// - Synchroniser : les tokens validés sont appliqués aux variables, puis relus.
// Un token et une variable se correspondent par une seule règle de nommage
// (tokenKey), la même dans les deux sens. Les fonctions pures du haut sont
// aussi testées hors de Figma.

// Collection créée par les anciennes versions pour les tokens sans variable :
// ses variables sont des doublons, ni récupérées ni mises à jour.
const LEGACY = 'DS-Studio';
const kinds = { color: 'COLOR', dimension: 'FLOAT', fontFamily: 'STRING' };
const keyPattern = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+){1,3}$/;
const fontPattern = /^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$/;

// « Spacing - 1 » → « spacing1 », « Chaîne » → « chaine »
function segment(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}
// « color/Primary/purple/700 » → « color.primary.purple.700 ». Un nom d'un
// seul niveau prend le nom de sa collection devant (« Font » + « Body-Font »
// → « font.bodyFont ») ; au-delà de quatre niveaux, la fin est fusionnée.
function tokenKey(name, collection) {
  let parts = String(name).split('/').map(segment).filter(Boolean);
  if (parts.length < 2) parts = [segment(collection), ...parts].filter(Boolean);
  if (parts.length > 4)
    parts = [
      ...parts.slice(0, 3),
      parts
        .slice(3)
        .map((p, i) => (i ? p.charAt(0).toUpperCase() + p.slice(1) : p))
        .join(''),
    ];
  const key = parts.join('.');
  return key.length <= 60 && keyPattern.test(key) ? key : null;
}

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
const isAlias = (v) =>
  !!v && typeof v === 'object' && v.type === 'VARIABLE_ALIAS';

// Variables lues dans Figma : { id, name, collection, resolvedType, value }
// (valeur du mode par défaut, éventuellement un alias { type, id }).
// Clé de token de chaque variable, sans doublon : en cas de collision, la
// seconde prend le nom de sa collection devant ; sinon elle est écartée.
function keyed(variables) {
  const byKey = new Map();
  const skipped = [];
  const sorted = variables
    .filter((v) => v.collection !== LEGACY)
    .slice()
    .sort((a, b) =>
      (a.collection + '/' + a.name).localeCompare(b.collection + '/' + b.name),
    );
  for (const v of sorted) {
    let key = tokenKey(v.name, v.collection);
    if (key && byKey.has(key)) key = tokenKey(v.collection + '/' + v.name, '');
    if (!key || byKey.has(key)) {
      skipped.push({
        name: v.collection + '/' + v.name,
        reason: key ? 'nom déjà pris par une autre variable' : 'nom non convertible',
      });
      continue;
    }
    byKey.set(key, v);
  }
  return { byKey, skipped };
}
// Valeur réelle d'une variable, alias suivis (cinq niveaux au plus).
// Variable de base au bout d'une chaîne d'alias (cinq niveaux au plus).
function baseOf(v, byId) {
  let current = v;
  for (let i = 0; i < 5 && current && isAlias(current.value); i++)
    current = byId.get(current.value.id);
  return current && !isAlias(current.value) ? current : undefined;
}
// Valeur réelle d'une variable, alias suivis.
function resolve(v, byId) {
  const base = baseOf(v, byId);
  return base && base.value;
}
// Valeur Figma → valeur de token, ou raison du refus.
function tokenValue(type, value) {
  if (type === 'COLOR') {
    if (!value || typeof value !== 'object') return { reason: 'couleur illisible' };
    if (value.a !== undefined && value.a < 0.999)
      return { reason: 'transparence non prise en charge par DS-Studio' };
    return { token: { $type: 'color', $value: toHex(value) } };
  }
  if (type === 'FLOAT') {
    if (typeof value !== 'number' || value < 0 || value > 2000)
      return { reason: 'dimension hors de 0 à 2000' };
    return {
      token: { $type: 'dimension', $value: Math.round(value * 100) / 100 },
    };
  }
  if (type === 'STRING') {
    if (typeof value !== 'string' || !fontPattern.test(value))
      return { reason: 'texte qui n’est pas un nom de police' };
    return { token: { $type: 'fontFamily', $value: value } };
  }
  return { reason: 'type ' + type + ' non pris en charge' };
}
// Récupérer : toutes les variables lisibles deviennent des tokens.
function collect(variables) {
  const byId = new Map(variables.map((v) => [v.id, v]));
  const { byKey, skipped } = keyed(variables);
  const tokens = {};
  for (const [key, v] of byKey) {
    const value = resolve(v, byId);
    const r =
      value === undefined
        ? { reason: 'alias vers une variable introuvable' }
        : tokenValue(v.resolvedType, value);
    if (r.token) tokens[key] = r.token;
    else skipped.push({ name: v.collection + '/' + v.name, reason: r.reason });
  }
  // Liens d'usage : chaque alias vers la clé de sa variable de base, pour que
  // DS-Studio modifie la base et tout son groupe ensemble.
  const keyOf = new Map([...byKey].map(([key, v]) => [v.id, key]));
  const aliases = {};
  for (const [key, v] of byKey) {
    if (!isAlias(v.value) || !tokens[key]) continue;
    const base = baseOf(v, byId);
    const baseKey = base && keyOf.get(base.id);
    if (baseKey && tokens[baseKey]) aliases[key] = baseKey;
  }
  const legacy = variables.filter((v) => v.collection === LEGACY).length;
  if (legacy)
    skipped.push({
      name: 'Collection « ' + LEGACY + ' »',
      reason: legacy + ' variable(s) créée(s) par une ancienne version, ignorées',
    });
  return { tokens, skipped, aliases };
}
// Couleurs comparées sans tenir compte de la casse : DS-Studio peut écrire
// « #5b3b6d » quand Figma relit « #5B3B6D ».
const hexEq = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();
const same = (type, figmaValue, tokenValue) =>
  type === 'color'
    ? hexEq(toHex(figmaValue), tokenValue)
    : figmaValue === tokenValue;
// Où créer la variable d'un nouveau token : dans la collection de ses
// voisines de même groupe, nommée comme elles (« color.primary.purple.850 »
// à côté de « Master/color/Primary/purple/800 » → « color/Primary/purple/850 »
// dans Master). Sans voisine, pas de collection évidente : rien n'est créé.
function placeFor(key, byKey) {
  const parent = key.slice(0, key.lastIndexOf('.'));
  const last = key.slice(key.lastIndexOf('.') + 1);
  for (const [k, v] of byKey) {
    if (k.slice(0, k.lastIndexOf('.')) !== parent) continue;
    const parts = v.name.split('/');
    if (parts.length < 2) continue;
    const name = parts.slice(0, -1).concat(last).join('/');
    if (tokenKey(name, v.collection) === key)
      return { collection: v.collection, name };
  }
  return null;
}
// Synchroniser : ce qu'il faut changer dans Figma pour suivre les tokens.
// Chaque token modifie la variable qui porte son nom. Un alias dont la base
// reçoit la même valeur dans ce passage la suit sans être touché.
function plan(tokens, variables) {
  const byId = new Map(variables.map((v) => [v.id, v]));
  const { byKey } = keyed(variables);
  const result = {
    updates: [],
    retargets: [],
    creates: [],
    same: 0,
    missing: [],
    blocked: [],
  };
  for (const [key, token] of Object.entries(tokens)) {
    if (byKey.has(key)) continue;
    const place = placeFor(key, byKey);
    if (place)
      result.creates.push({ key, type: token.$type, value: token.$value, ...place });
    else result.missing.push({ key, type: token.$type, value: token.$value });
  }
  // Valeurs que les variables de base vont recevoir dans ce passage : un
  // alias vers l'une d'elles suit sans être touché.
  const incoming = new Map();
  for (const [key, token] of Object.entries(tokens)) {
    const v = byKey.get(key);
    if (v && !isAlias(v.value) && v.resolvedType === kinds[token.$type])
      incoming.set(v.id, String(token.$value).toUpperCase());
  }
  for (const [key, token] of Object.entries(tokens)) {
    const v = byKey.get(key);
    if (!v) continue;
    const name = v.collection + '/' + v.name;
    if (v.resolvedType !== kinds[token.$type]) {
      result.blocked.push({ key, name, reason: 'type différent dans Figma' });
      continue;
    }
    const current = resolve(v, byId);
    if (current === undefined) {
      result.blocked.push({ key, name, reason: 'alias vers une variable introuvable' });
      continue;
    }
    const root = baseOf(v, byId);
    if (
      same(token.$type, current, token.$value) ||
      (isAlias(v.value) && root && incoming.get(root.id) === String(token.$value).toUpperCase())
    ) {
      result.same++;
      continue;
    }
    if (token.$type === 'color' && current.a !== undefined && current.a < 0.999) {
      result.blocked.push({ key, name, reason: 'variable transparente : à modifier dans Figma' });
      continue;
    }
    const before = token.$type === 'color' ? toHex(current) : current;
    // Même nom, même changement : la variable du token reçoit la valeur ;
    // un alias devient une valeur directe (detached), sa base ne bouge pas.
    result.updates.push({
      key,
      id: v.id,
      name,
      type: token.$type,
      before,
      after: token.$value,
      detached: isAlias(v.value),
    });
  }
  return result;
}
function figmaValue(type, value) {
  return type === 'color' ? fromHex(value) : value;
}

if (typeof module !== 'undefined')
  module.exports = { segment, tokenKey, keyed, collect, placeFor, plan, toHex, fromHex };

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
        collection: col ? col.name : '',
        resolvedType: v.resolvedType,
        value: col ? v.valuesByMode[col.defaultModeId] : undefined,
      };
    });
  };
  // Fichier autorisé : celui du projet ouvert dans DS-Studio, et aucun autre.
  // Sans clé lisible dans Figma, le contrôle est signalé au lieu d'être sauté.
  const checkFile = (expected) => {
    if (expected && figma.fileKey && expected !== figma.fileKey)
      throw new Error(
        'Ce fichier Figma n’est pas celui du projet ouvert dans DS-Studio. Rien ne sera modifié.',
      );
    return expected && !figma.fileKey
      ? 'Fichier non vérifié : Figma ne donne pas sa clé à ce plugin.'
      : null;
  };

  // Crée les variables nouvelles (dans la collection de leurs voisines),
  // applique valeurs et alias, puis relit tout avant de dire « fait ».
  const applyChanges = async (updates, retargets, creates) => {
    const failed = [];
    const written = [];
    const made = new Map();
    if (creates.length) {
      const collections = await figma.variables.getLocalVariableCollectionsAsync();
      for (const c of creates) {
        const col = collections.find((x) => x.name === c.collection);
        if (!col) {
          failed.push({ key: c.key, reason: 'collection ' + c.collection + ' introuvable' });
          continue;
        }
        const v = figma.variables.createVariable(c.name, col, kinds[c.type]);
        v.setValueForMode(col.defaultModeId, figmaValue(c.type, c.value));
        made.set(c.key, v);
        written.push({ key: c.key, id: v.id, type: c.type, after: c.value });
      }
    }
    for (const u of updates.concat(retargets)) {
      const v = await figma.variables.getVariableByIdAsync(u.id);
      const col =
        v &&
        (await figma.variables.getVariableCollectionByIdAsync(
          v.variableCollectionId,
        ));
      const target = u.targetId
        ? await figma.variables.getVariableByIdAsync(u.targetId)
        : u.createKey
          ? made.get(u.createKey)
          : null;
      if (!v || !col || ((u.targetId || u.createKey) && !target)) {
        failed.push({ key: u.key, reason: 'variable introuvable dans Figma' });
        continue;
      }
      v.setValueForMode(
        col.defaultModeId,
        target
          ? figma.variables.createVariableAlias(target)
          : figmaValue(u.type, u.after),
      );
      written.push(u);
    }
    // Relecture : chaque valeur écrite est relue, alias suivis.
    const after = await readVariables();
    const byId = new Map(after.map((x) => [x.id, x]));
    let wrong = 0;
    for (const u of written) {
      const v = byId.get(u.id);
      const value = v && resolve(v, byId);
      if (value === undefined || !same(u.type, value, u.after)) {
        failed.push({ key: u.key, reason: 'valeur relue différente' });
        wrong++;
      }
    }
    const created = [...made.keys()].length;
    return {
      updated: written.length - created - wrong,
      created,
      failed,
      ids: written.map((u) => u.id),
    };
  };

  // Une propriété liée à l'une de ces variables (couleur, espacement…).
  const usesAny = (bound, ids) => {
    if (!bound || typeof bound !== 'object') return false;
    if (bound.type === 'VARIABLE_ALIAS') return ids.has(bound.id);
    return Object.values(bound).some((b) => usesAny(b, ids));
  };
  // Composants qui utilisent les variables modifiées, directement ou par un
  // alias qui y mène : la liste que Clodo donne après la mise à jour.
  const impactedComponents = async (ids) => {
    if (!ids.length) return [];
    const all = await readVariables();
    const byId = new Map(all.map((x) => [x.id, x]));
    const touched = new Set(ids);
    for (const v of all) {
      const base = baseOf(v, byId);
      if (base && touched.has(base.id)) touched.add(v.id);
    }
    await figma.loadAllPagesAsync();
    const found = new Map();
    for (const page of figma.root.children) {
      for (const node of page.findAll((n) => usesAny(n.boundVariables, touched))) {
        let c = node;
        while (c && c.type !== 'COMPONENT' && c.type !== 'COMPONENT_SET' && c.type !== 'PAGE')
          c = c.parent;
        if (!c || c.type === 'PAGE') continue;
        const top = c.type === 'COMPONENT' && c.parent && c.parent.type === 'COMPONENT_SET' ? c.parent : c;
        found.set(top.id, { name: top.name, page: page.name });
        if (found.size >= 60) break;
      }
      if (found.size >= 60) break;
    }
    return [...found.values()];
  };

  figma.ui.onmessage = async (msg) => {
    try {
      if (msg.type === 'load-settings') {
        figma.ui.postMessage({
          type: 'settings',
          server: await figma.clientStorage.getAsync('server'),
          code: await figma.clientStorage.getAsync('code'),
          auto: await figma.clientStorage.getAsync('auto'),
        });
      }
      if (msg.type === 'save-settings') {
        await figma.clientStorage.setAsync('server', msg.server);
        await figma.clientStorage.setAsync('code', msg.code);
        await figma.clientStorage.setAsync('auto', !!msg.auto);
      }
      if (msg.type === 'collect') {
        const warning = checkFile(msg.fileKey);
        const result = collect(await readVariables());
        figma.ui.postMessage(
          Object.assign(
            { type: 'collected', file: figma.root.name, fileKey: figma.fileKey || null, warning },
            result,
          ),
        );
      }
      if (msg.type === 'plan') {
        const warning = checkFile(msg.fileKey);
        const variables = await readVariables();
        const p = plan(msg.tokens, variables);
        // Mode automatique : les tokens validés dans DS-Studio partent tout
        // de suite, nouvelles variables comprises (chez leurs voisines) ;
        // jamais de suppression.
        if (msg.auto) {
          const report =
            p.updates.length || p.retargets.length || p.creates.length
              ? await applyChanges(p.updates, p.retargets, p.creates)
              : { updated: 0, created: 0, failed: [], ids: [] };
          report.impacted = await impactedComponents(report.ids);
          delete report.ids;
          report.failed = report.failed.concat(
            p.blocked.map((b) => ({ key: b.key, reason: b.reason })),
            p.missing.map((m) => ({ key: m.key, reason: 'aucune variable de ce nom dans Figma, ni de collection évidente pour la créer' })),
          );
          return figma.ui.postMessage(
            Object.assign({ type: 'auto', revision: msg.revision, same: p.same, warning }, report),
          );
        }
        figma.ui.postMessage({
          type: 'plan',
          file: figma.root.name,
          variables: variables.length,
          warning,
          plan: p,
        });
      }
      if (msg.type === 'apply') {
        const report = await applyChanges(
          msg.updates,
          msg.retargets || [],
          msg.creates || [],
        );
        report.impacted = await impactedComponents(report.ids);
        delete report.ids;
        figma.ui.postMessage(Object.assign({ type: 'report', revision: msg.revision }, report));
      }
    } catch (e) {
      figma.ui.postMessage({ type: 'error', message: String(e.message || e) });
    }
  };
}

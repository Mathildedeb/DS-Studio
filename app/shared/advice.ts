import { contrast, type Patch, type Tokens } from './model.js';

// Conseils de Clodo AVANT la validation d'un diff, lisibles d'un coup d'œil :
// une ligne par sujet (lisibilité, échelle, neutre, alias, usages entraînés),
// quatre lignes au plus. Calculés sur place, sans IA.
export interface Advice {
  level: 'warn' | 'info';
  text: string;
}

const isText = (key: string) => /(^|\.)(text|icon)(\.|$)/i.test(key);
const isBackground = (key: string) =>
  /(^|\.)(background|button|items|surface|canvas)(\.|$)/i.test(key);
// Clarté relative : plus la valeur est haute, plus la couleur est claire.
const light = (hex: string) => contrast(hex, '#000000');
function saturation(hex: string) {
  const [r, g, b] = (hex.slice(1).match(/../g) ?? []).map(
    (x) => parseInt(x, 16) / 255,
  );
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}
const isColor = (v: unknown): v is string =>
  typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
// « a, b, c et 4 autres »
const few = (keys: string[], max = 3) =>
  keys.length > max
    ? `${keys.slice(0, max).join(', ')} et ${keys.length - max} autre(s)`
    : keys.join(', ');

export function adviseChange(
  patches: Patch[],
  tokens: Tokens,
  aliases: Record<string, string> = {},
): Advice[] {
  const after: Record<string, string | number> = Object.fromEntries(
    Object.entries(tokens).map(([k, t]) => [k, t.$value]),
  );
  for (const p of patches)
    if (p.after === null) delete after[p.key];
    else after[p.key] = p.after;
  const changed = new Set(patches.map((p) => p.key));
  const colors = patches.filter(
    (p): p is Patch & { after: string } => p.type === 'color' && isColor(p.after),
  );
  const advice: Advice[] = [];

  // Lisibilité : une ligne par nouvelle couleur, contre les tokens qui ne
  // changent pas (comparer le groupe à lui-même n'a pas de sens).
  for (const value of new Set(colors.map((p) => p.after.toUpperCase()))) {
    const keys = colors.filter((p) => p.after.toUpperCase() === value).map((p) => p.key);
    const asBackground = keys.some(isBackground);
    const asText = keys.some(isText);
    const others = Object.entries(after).filter(
      ([k, v]) =>
        !changed.has(k) &&
        isColor(v) &&
        ((asBackground && isText(k)) || (asText && isBackground(k))),
    );
    if (!others.length) continue;
    const bad = others.filter(([, v]) => contrast(value, v as string) < 3).map(([k]) => k);
    const big = others
      .filter(([, v]) => {
        const r = contrast(value, v as string);
        return r >= 3 && r < 4.5;
      })
      .map(([k]) => k);
    const ok = others.length - bad.length - big.length;
    advice.push({
      level: bad.length || big.length ? 'warn' : 'info',
      text: `Lisibilité de ${value} : ${[
        bad.length && `illisible avec ${few(bad)}`,
        big.length && `grand texte seulement avec ${few(big)}`,
        ok && `${ok} combinaison(s) lisible(s)`,
      ]
        .filter(Boolean)
        .join(' · ')}`,
    });
  }

  // Échelle numérotée (purple.50 → purple.900) : la valeur doit rester entre
  // ses voisines, dans le sens du reste de l'échelle.
  for (const p of colors) {
    const dot = p.key.lastIndexOf('.');
    const step = Number(p.key.slice(dot + 1));
    if (!Number.isFinite(step)) continue;
    const parent = p.key.slice(0, dot);
    const scale = Object.entries(after)
      .filter(
        ([k, v]) =>
          k.slice(0, k.lastIndexOf('.')) === parent &&
          Number.isFinite(Number(k.slice(k.lastIndexOf('.') + 1))) &&
          isColor(v),
      )
      .map(([k, v]) => ({ n: Number(k.slice(k.lastIndexOf('.') + 1)), v: v as string }))
      .sort((a, b) => a.n - b.n);
    if (scale.length < 3) continue;
    const darker = light(scale[0].v) > light(scale.at(-1)!.v);
    const below = scale.filter((x) => x.n < step).at(-1);
    const above = scale.find((x) => x.n > step);
    const v = light(p.after);
    const out =
      below && (darker ? v > light(below.v) : v < light(below.v))
        ? `plus ${darker ? 'clair' : 'foncé'} que ${below.n}`
        : above && (darker ? v < light(above.v) : v > light(above.v))
          ? `plus ${darker ? 'foncé' : 'clair'} que ${above.n}`
          : null;
    if (out)
      advice.push({
        level: 'warn',
        text: `Échelle ${parent} : ${step} deviendrait ${out}.`,
      });
  }

  for (const p of colors)
    if (/(^|\.)neutral(\.|$)/i.test(p.key) && saturation(p.after) > 0.25)
      advice.push({ level: 'warn', text: `${p.key} ne serait plus un gris neutre.` });

  const loose = colors.filter((p) => aliases[p.key] && !changed.has(aliases[p.key]));
  if (loose.length)
    advice.push({
      level: 'info',
      text: `Dans Figma, ${few(loose.map((p) => p.key))} perd(ent) le lien avec sa base.`,
    });
  const followers = patches.filter((p) => aliases[p.key] && changed.has(aliases[p.key]));
  if (followers.length)
    advice.push({
      level: 'info',
      text: `Suivent aussi : ${followers.length} usage(s) (${few(followers.map((p) => p.key))}).`,
    });
  return advice;
}

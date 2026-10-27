import { z } from 'zod';

// Ce sous-ensemble explicite utilise les noms $type/$value, pas toute la norme DTCG.
const color = z
  .object({
    $type: z.literal('color'),
    $value: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur attendue : #RRGGBB'),
  })
  .strict();
const dimension = z
  .object({
    $type: z.literal('dimension'),
    $value: z.number().finite().min(0).max(128),
  })
  .strict();
const font = z
  .object({
    $type: z.literal('fontFamily'),
    $value: z.enum(['system-ui', 'Arial', 'Georgia', 'Verdana']),
  })
  .strict();
export const tokensSchema = z
  .object({
    'color.brand': color,
    'color.brandHover': color,
    'color.onBrand': color,
    'color.surface': color,
    'color.canvas': color,
    'color.text': color,
    'color.muted': color,
    'color.border': color,
    'color.danger': color,
    'color.success': color,
    'color.focus': color,
    'font.family': font,
    'font.body': dimension,
    'font.heading': dimension,
    'space.sm': dimension,
    'space.md': dimension,
    'space.lg': dimension,
    'radius.control': dimension,
  })
  .strict();
export type Tokens = z.infer<typeof tokensSchema>;
export type TokenKey = keyof Tokens;
export const tokenKeys = Object.keys(tokensSchema.shape) as TokenKey[];
export type TokenValue = string | number;
export const changeSchema = z
  .object({
    key: z.enum(tokenKeys as [TokenKey, ...TokenKey[]]),
    value: z.union([z.string().max(100), z.number().finite()]),
  })
  .strict();
export const proposeSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    changes: z.array(changeSchema).min(1).max(50),
  })
  .strict();
export interface Patch {
  key: TokenKey;
  before: TokenValue;
  after: TokenValue;
}
export interface Revision {
  id: string;
  revision: number;
  date: string;
  source: 'manual' | 'codex' | 'import' | 'undo';
  patches: Patch[];
}
export interface State {
  version: 1;
  revision: number;
  tokens: Tokens;
  history: Revision[];
}
export interface Proposal {
  id: string;
  revision: number;
  source: Revision['source'];
  patches: Patch[];
}
export const patchSchema = z
  .object({
    key: z.enum(tokenKeys as [TokenKey, ...TokenKey[]]),
    before: z.union([z.string(), z.number()]),
    after: z.union([z.string(), z.number()]),
  })
  .strict();
export const stateSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    tokens: tokensSchema,
    history: z.array(
      z
        .object({
          id: z.string().uuid(),
          revision: z.number().int().positive(),
          date: z.string().datetime(),
          source: z.enum(['manual', 'codex', 'import', 'undo']),
          patches: z.array(patchSchema).min(1),
        })
        .strict(),
    ),
  })
  .strict();
export const agentReplySchema = z
  .object({
    message: z.string().max(12000),
    changes: z.array(changeSchema).max(20),
  })
  .strict();
export type AgentReply = z.infer<typeof agentReplySchema>;
export function applyChanges(
  tokens: Tokens,
  changes: { key: TokenKey; value: TokenValue }[],
): Tokens {
  const next = structuredClone(tokens);
  if (new Set(changes.map((c) => c.key)).size !== changes.length)
    throw new Error('Un token ne peut apparaître deux fois.');
  for (const change of changes) next[change.key].$value = change.value as never;
  return tokensSchema.parse(next);
}
export function diff(before: Tokens, after: Tokens): Patch[] {
  return tokenKeys
    .filter((key) => before[key].$value !== after[key].$value)
    .map((key) => ({
      key,
      before: before[key].$value,
      after: after[key].$value,
    }));
}
export function tokenCss(tokens: Tokens): Record<string, string> {
  return Object.fromEntries(
    tokenKeys.map((key) => [
      `--${key.replaceAll('.', '-')}`,
      `${tokens[key].$value}${tokens[key].$type === 'dimension' ? 'px' : ''}`,
    ]),
  );
}
export function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const rgb = hex
      .slice(1)
      .match(/../g)!
      .map((x) => parseInt(x, 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

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
    $value: z.number().finite().min(0).max(2000),
  })
  .strict();
const font = z
  .object({
    $type: z.literal('fontFamily'),
    $value: z.enum(['system-ui', 'Arial', 'Georgia', 'Verdana']),
  })
  .strict();
// Version 2 : les tokens forment une liste libre (vide au départ). Un nom
// suit la forme « groupe.nom » ; le type est fixé à la création du token.
export const tokenTypes = ['color', 'dimension', 'fontFamily'] as const;
export type TokenType = (typeof tokenTypes)[number];
export const tokenKeySchema = z
  .string()
  .max(60)
  .regex(
    /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+){1,3}$/,
    'Nom attendu : groupe.nom (ex. color.brand, space.md)',
  );
const fontName = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$/, 'Nom de police invalide');
const tokenSchema = z.discriminatedUnion('$type', [
  color,
  dimension,
  z.object({ $type: z.literal('fontFamily'), $value: fontName }).strict(),
]);
export type Token = z.infer<typeof tokenSchema>;
export const tokensSchema = z
  .record(tokenKeySchema, tokenSchema)
  .refine((t) => Object.keys(t).length <= 300, '300 tokens maximum');
export type Tokens = z.infer<typeof tokensSchema>;
export type TokenKey = string;
export type TokenValue = string | number;
export const tokenKeys = (tokens: Tokens) => Object.keys(tokens).sort();
// value null supprime le token ; type est requis pour en créer un.
export const changeSchema = z
  .object({
    key: tokenKeySchema,
    type: z.enum(tokenTypes).optional(),
    value: z.union([z.string().max(100), z.number().finite(), z.null()]),
  })
  .strict();
export type Change = z.infer<typeof changeSchema>;
export const proposeSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    changes: z.array(changeSchema).min(1).max(50),
  })
  .strict();
// before ou after à null : token absent (ajout ou suppression).
export interface Patch {
  key: TokenKey;
  type: TokenType;
  before: TokenValue | null;
  after: TokenValue | null;
}
export interface Revision {
  id: string;
  revision: number;
  date: string;
  source: 'manual' | 'codex' | 'claude' | 'import' | 'undo';
  patches: Patch[];
}
export interface State {
  version: 2;
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
const valueSchema = z.union([z.string(), z.number(), z.null()]);
export const patchSchema = z
  .object({
    key: tokenKeySchema,
    type: z.enum(tokenTypes),
    before: valueSchema,
    after: valueSchema,
  })
  .strict();
const revisionSchema = <T extends z.ZodType>(patch: T) =>
  z
    .object({
      id: z.string().uuid(),
      revision: z.number().int().positive(),
      date: z.string().datetime(),
      source: z.enum(['manual', 'codex', 'claude', 'import', 'undo']),
      patches: z.array(patch).min(1),
    })
    .strict();
export const stateSchema = z
  .object({
    version: z.literal(2),
    revision: z.number().int().nonnegative(),
    tokens: tokensSchema,
    history: z.array(revisionSchema(patchSchema)),
  })
  .strict();
// Format version 1 : 18 tokens fixes, patches sans type. Lu pour migration.
const v1Types: Record<string, TokenType> = {
  'font.family': 'fontFamily',
  'font.body': 'dimension',
  'font.heading': 'dimension',
  'space.sm': 'dimension',
  'space.md': 'dimension',
  'space.lg': 'dimension',
  'radius.control': 'dimension',
};
export const stateV1Schema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    tokens: tokensSchema,
    history: z.array(
      revisionSchema(
        z
          .object({
            key: tokenKeySchema,
            before: z.union([z.string(), z.number()]),
            after: z.union([z.string(), z.number()]),
          })
          .strict(),
      ),
    ),
  })
  .strict();
// Migration v1 → v2 : mêmes tokens, même journal ; chaque patch reçoit son type.
export function migrateV1(raw: unknown): State {
  const v1 = stateV1Schema.parse(raw);
  return {
    version: 2,
    revision: v1.revision,
    tokens: v1.tokens,
    history: v1.history.map((r) => ({
      ...r,
      patches: (
        r.patches as { key: string; before: TokenValue; after: TokenValue }[]
      ).map((p) => ({ ...p, type: v1Types[p.key] ?? 'color' })),
    })),
  };
}
export const agentReplySchema = z
  .object({
    message: z.string().max(12000),
    changes: z.array(changeSchema).max(20),
  })
  .strict();
export type AgentReply = z.infer<typeof agentReplySchema>;
export function applyChanges(tokens: Tokens, changes: Change[]): Tokens {
  const next = structuredClone(tokens);
  if (new Set(changes.map((c) => c.key)).size !== changes.length)
    throw new Error('Un token ne peut apparaître deux fois.');
  for (const c of changes) {
    const current = next[c.key];
    if (c.value === null) {
      if (!current) throw new Error(`Token inconnu : ${c.key}`);
      delete next[c.key];
      continue;
    }
    const type = current?.$type ?? c.type;
    if (!type) throw new Error(`Type requis pour créer ${c.key}.`);
    if (current && c.type && c.type !== current.$type)
      throw new Error(`${c.key} est de type ${current.$type}.`);
    next[c.key] = tokenSchema.parse({ $type: type, $value: c.value });
  }
  return tokensSchema.parse(next);
}
export function diff(before: Tokens, after: Tokens): Patch[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter((key) => before[key]?.$value !== after[key]?.$value)
    .map((key) => ({
      key,
      type: (after[key] ?? before[key]).$type,
      before: before[key]?.$value ?? null,
      after: after[key]?.$value ?? null,
    }));
}
export function tokenCss(tokens: Tokens): Record<string, string> {
  return Object.fromEntries(
    Object.keys(tokens).map((key) => [
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

import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DSProvider } from './DesignSystem.js';
import { FigmaDetail, figmaLevel } from './FigmaPanel.js';
import type { FigmaComponent } from '../../connectors/figma/library.js';
import { request } from './api.js';
import { codedFor, type CodeComponent } from '../shared/components.js';
import { defaultPreview, type PreviewConfig } from '../shared/dashboard.js';
import {
  entry,
  levels,
  match,
  registry,
  usedIn,
  type Entry,
  type Level,
} from './dsRegistry.js';
import type { TokenKey, Tokens } from '../shared/model.js';
import type { Focus } from '../shared/focus.js';

// Page Design System : un onglet par niveau atomique, une liste filtrable
// et, à côté, l'élément choisi en taille réelle avec ses propriétés.
export type Tab = 'tokens' | Level | 'figma' | 'components';
export const tabs: Record<Tab, string> = {
  tokens: 'Styles',
  components: 'Composants',
  ...levels,
  figma: 'Fichier Figma',
};
type Props = Record<string, string | boolean>;

const cssVar = (key: string) => `--${key.replaceAll('.', '-')}`;
const showValue = (tokens: Tokens, key: TokenKey) =>
  `${tokens[key].$value}${tokens[key].$type === 'dimension' ? 'px' : ''}`;

// Onglets du panneau ; flèches gauche/droite comme un tablist ARIA.
export function DsTabs({
  tab,
  onTab,
  extra = {},
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  // Composants Figma pas encore codés, comptés dans chaque niveau.
  extra?: Partial<Record<Level, number>>;
}) {
  const ids = Object.keys(tabs) as Tab[];
  return (
    <div className="ds-tabs" role="tablist" aria-label="Sections du DS">
      {ids.map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          id={`tab-${t}`}
          aria-controls={`panel-${t}`}
          aria-selected={tab === t}
          tabIndex={tab === t ? 0 : -1}
          onClick={() => onTab(t)}
          onKeyDown={(e) => {
            const step =
              e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (!step) return;
            const next = ids[(ids.indexOf(t) + step + ids.length) % ids.length];
            onTab(next);
            document.getElementById(`tab-${next}`)?.focus();
          }}
        >
          {tabs[t]}
          {t !== 'tokens' && t !== 'figma' && t !== 'components' && (
            <span>
              {registry.filter((e) => e.level === t).length + (extra[t] ?? 0)}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function TokenTable({
  tokens,
  keys,
  selected,
  onSelect,
}: {
  tokens: Tokens;
  keys: TokenKey[];
  selected: TokenKey;
  onSelect: (key: TokenKey) => void;
}) {
  return (
    <div className="token-table-scroll">
      <table className="token-table">
        <thead>
          <tr>
            <th aria-label="Aperçu" />
            <th>Token</th>
            <th>Valeur</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr
              key={k}
              aria-selected={selected === k}
              onClick={() => onSelect(k)}
            >
              <td>
                {tokens[k].$type === 'color' ? (
                  <span
                    className="token-swatch"
                    style={{ background: String(tokens[k].$value) }}
                  />
                ) : (
                  <span className="token-unit">
                    {tokens[k].$type === 'dimension' ? 'px' : 'Aa'}
                  </span>
                )}
              </td>
              <td>
                <button type="button" className="token-name">
                  {k}
                </button>
                <small>{cssVar(k)}</small>
              </td>
              <td>
                <code>{showValue(tokens, k)}</code>
              </td>
            </tr>
          ))}
          {!keys.length && (
            <tr>
              <td colSpan={3} className="token-uses">
                Aucun token ne correspond.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Exemples de chaque entrée : vrais composants React ou mêmes classes CSS
// que DesignSystem.tsx. Les props éditables sont celles du registre.
// Le DS est vide pour l'instant : chaque composant ajouté aura ici ses
// exemples et le rendu de ses props éditables.
const kits: Record<
  string,
  { render: (p: Props) => ReactNode; examples: Props[] }
> = {};

// Sélection dans l'aperçu : un exemple entier (modifiable) ou un élément
// imbriqué (lecture seule : ses valeurs sont écrites dans son parent).
interface Picked {
  ex: number;
  el?: HTMLElement;
  chain: string[];
}

export function ComponentWorkspace({
  tokens,
  tab,
  onTab,
  onToken,
  onFocus,
  figma = [],
  code,
  onAsk,
}: {
  tokens: Tokens;
  tab: Tab;
  onTab: (t: Tab) => void;
  onToken: (key: TokenKey) => void;
  onFocus: (focus: Focus) => void;
  // Composants du Figma du projet : ils apparaissent dans leur niveau
  // atomique tant qu'ils ne sont pas codés.
  figma?: FigmaComponent[];
  // Composants déjà codés dans le projet ouvert (et correspondances forcées).
  code?: { components: CodeComponent[]; map: Record<string, string> };
  onAsk: (message: string) => void;
}) {
  const codedOf = (c: FigmaComponent) =>
    code ? codedFor(c.name, code.components, code.map) : undefined;
  const level: Level =
    tab === 'tokens' || tab === 'figma' || tab === 'components' ? 'atom' : tab;
  const [query, setQuery] = useState('');
  const first = (l: Level) => registry.find((x) => x.level === l)?.name ?? '';
  const [items, setItems] = useState<Record<Level, string>>({
    atom: first('atom'),
    molecule: first('molecule'),
    organism: first('organism'),
    template: first('template'),
  });
  const figmaHere = figma.filter((c) => figmaLevel(c.page) === level);
  const name = items[level] || (figmaHere[0] ? `figma:${figmaHere[0].id}` : '');
  const figmaPicked = name.startsWith('figma:')
    ? figma.find((c) => `figma:${c.id}` === name)
    : undefined;
  // Niveau encore vide : aucun élément à afficher.
  const e = entry(name);
  const [picked, setPicked] = useState<Picked>({ ex: 0, chain: [name] });
  const [overrides, setOverrides] = useState<Record<string, Props[]>>({});
  const [interact, setInteract] = useState(false);
  // Le template montre les mêmes formats et pages que la Preview.
  const [preview, setPreview] = useState<PreviewConfig>(defaultPreview);
  const [format, setFormat] = useState(0);
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (tab === 'template')
      request<PreviewConfig>('preview')
        .then(setPreview)
        .catch(() => undefined);
  }, [tab]);
  const f = preview.formats[format] ?? preview.formats[0];
  const pg = preview.pages[page] ?? preview.pages[0];
  const stage = useRef<HTMLDivElement>(null);
  // Les styles calculés se lisent après le rendu : un second passage les affiche.
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  useLayoutEffect(refresh, [name, picked, overrides, tokens]);
  useEffect(() => setQuery(''), [tab]);
  // Changer d'onglet ramène la sélection sur l'élément de cet onglet.
  useEffect(() => setPicked({ ex: 0, chain: [name] }), [name]);

  const kit = kits[name];
  const props = (i: number): Props => ({
    ...kit?.examples[i],
    ...overrides[name]?.[i],
  });
  const box = stage.current?.querySelector<HTMLElement>(
    `[data-ex="${picked.ex}"]`,
  );
  const target =
    picked.el ??
    (e?.selector
      ? (box?.querySelector<HTMLElement>(e.selector) ?? undefined)
      : undefined);
  useEffect(() => {
    target?.classList.add('ds-picked');
    return () => target?.classList.remove('ds-picked');
  }, [target]);

  // La sélection est transmise au chat : « ce composant » = ce qui est affiché.
  const values = !picked.el && kit ? props(picked.ex) : undefined;
  useEffect(() => {
    const deepest = entry(picked.chain.at(-1)!) ?? e;
    if (!deepest) return;
    const read: Focus['props'] = {};
    for (const p of deepest.props) {
      const v = values
        ? (values[p.name] ?? p.default)
        : target && p.read(target);
      if (v !== undefined)
        read[p.name] = typeof v === 'string' ? v.slice(0, 300) : v;
    }
    onFocus({
      page: 'design-system',
      kind: 'component',
      name: deepest.name,
      path: picked.chain.slice(0, 10),
      level: deepest.level,
      source: deepest.source ?? undefined,
      selector: deepest.selector,
      props: read,
      tokens: deepest.tokens,
    });
  }, [picked, target, JSON.stringify(values)]);

  const choose = (n: string) => {
    const lvl = entry(n)!.level;
    setItems((it) => ({ ...it, [lvl]: n }));
    setPicked({ ex: 0, chain: [n] });
    onTab(lvl);
  };
  const q = query.trim().toLowerCase();
  const list = registry.filter(
    (x) =>
      x.level === level &&
      (x.name.toLowerCase().includes(q) || x.kind.includes(q)),
  );
  return (
    <div
      className="ds-workspace"
      role="tabpanel"
      id={`panel-${level}`}
      aria-labelledby={`tab-${level}`}
      hidden={tab === 'tokens' || tab === 'figma' || tab === 'components'}
    >
      <div className="ds-list">
        <label className="field">
          Rechercher un composant
          <input
            type="search"
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            placeholder={`Dans les ${levels[level].toLowerCase()}…`}
          />
        </label>
        <ul>
          {list.map((x) => (
            <li key={x.name}>
              <button
                type="button"
                aria-current={x.name === name ? 'true' : undefined}
                onClick={() => choose(x.name)}
              >
                <strong>{x.name}</strong>
                <span>{x.kind}</span>
              </button>
            </li>
          ))}
          {figmaHere
            .filter((c) => c.name.toLowerCase().includes(q))
            .map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={`figma:${c.id}` === name ? 'true' : undefined}
                  onClick={() =>
                    setItems((it) => ({ ...it, [level]: `figma:${c.id}` }))
                  }
                >
                  <strong>{c.name}</strong>
                  {codedOf(c) ? (
                    <span className="figma-badge figma-coded">✓ codé</span>
                  ) : (
                    <span className="figma-badge">Figma · à coder</span>
                  )}
                </button>
              </li>
            ))}
          {!list.length && !figmaHere.length && (
            <li className="ds-list-empty">Aucun résultat.</li>
          )}
        </ul>
      </div>

      {figmaPicked ? (
        <div className="ds-detail">
          {codedOf(figmaPicked) ? (
            <p className="figma-coded-note">
              ✓ Codé dans <code>{codedOf(figmaPicked)!.file}</code>
            </p>
          ) : (
            <p className="figma-uncoded">
              Ce composant existe dans Figma mais pas encore dans le code de
              votre projet.
            </p>
          )}
          <FigmaDetail
            component={figmaPicked}
            onFocus={onFocus}
            onAsk={onAsk}
            coded={codedOf(figmaPicked)}
          />
        </div>
      ) : !e ? (
        <div className="ds-detail">
          <p className="ds-stage-empty">
            Aucun élément dans les {levels[level].toLowerCase()} pour l’instant.
            Ajoutez des composants au DS (depuis Figma, avec Clodo ou à la main)
            : ils apparaîtront ici.
          </p>
        </div>
      ) : (
        <div className="ds-detail">
          <header className="ds-detail-head">
            <div>
              <h2>{e.name}</h2>
              <p>
                <span className={`level-tag ${e.level}`}>{e.level}</span>{' '}
                {e.kind} · {e.source ?? 'pas encore dans le code'}
              </p>
            </div>
            {e.level !== 'template' && (
              <label className="inspect-toggle">
                <input
                  type="checkbox"
                  checked={interact}
                  onChange={(ev) => setInteract(ev.target.checked)}
                />{' '}
                Interagir
              </label>
            )}
          </header>

          {e.level === 'template' ? (
            <div className="ds-template">
              <div className="preview-controls">
                <label className="field">
                  Format
                  <select
                    value={format}
                    onChange={(ev) => setFormat(Number(ev.target.value))}
                  >
                    {preview.formats.map((x, i) => (
                      <option key={x.id} value={i}>
                        {x.name} · {x.width} px
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Page
                  <select
                    value={page}
                    onChange={(ev) => setPage(Number(ev.target.value))}
                  >
                    {preview.pages.map((x, i) => (
                      <option key={x.id} value={i}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="viewport-scroll">
                <iframe
                  title="Template en taille réelle"
                  src={`/?preview=1&scenario=${encodeURIComponent(pg.id)}&title=${encodeURIComponent(pg.name)}`}
                  width={f.width}
                  height={f.height}
                />
              </div>
            </div>
          ) : (
            <div
              ref={stage}
              className="ds-stage"
              // Par défaut un clic inspecte l'élément le plus profond ;
              // « Interagir » rend les composants utilisables.
              onClickCapture={(ev) => {
                if (interact) return;
                const holder = (ev.target as HTMLElement).closest<HTMLElement>(
                  '[data-ex]',
                );
                if (!holder) return;
                ev.preventDefault();
                ev.stopPropagation();
                const found: { el: HTMLElement; name: string }[] = [];
                for (
                  let x: HTMLElement | null = ev.target as HTMLElement;
                  x && x !== holder;
                  x = x.parentElement
                ) {
                  const m = match(x);
                  if (m) found.unshift({ el: x, name: m.name });
                }
                const ex = Number(holder.dataset.ex);
                const inner = found.at(-1);
                // Un clic sur l'exemple lui-même le rend modifiable.
                if (!inner || (found.length === 1 && inner.name === name))
                  return setPicked({ ex, chain: [name] });
                const names = found.map((f) => f.name);
                setPicked({
                  ex,
                  el: inner.el,
                  chain: names[0] === name ? names : [name, ...names],
                });
              }}
            >
              {kit ? (
                <DSProvider tokens={tokens}>
                  <div className="ds-stage-row">
                    {kit.examples.map((_, i) => (
                      <div key={i} data-ex={i}>
                        {kit.render(props(i))}
                      </div>
                    ))}
                  </div>
                </DSProvider>
              ) : (
                <p className="ds-stage-empty">Pas encore défini dans le DS.</p>
              )}
            </div>
          )}
          {e.level !== 'template' && (
            <p className="ds-stage-foot">
              Taille réelle · 1 px = 1 px CSS. Cliquez un exemple ou un élément
              pour voir ses propriétés.
            </p>
          )}

          <Properties
            top={e}
            picked={picked}
            el={target}
            values={values}
            onChange={(k, v) =>
              setOverrides((o) => {
                const list = [...(o[name] ?? [])];
                list[picked.ex] = { ...list[picked.ex], [k]: v };
                return { ...o, [name]: list };
              })
            }
            onReset={
              overrides[name]?.[picked.ex]
                ? () =>
                    setOverrides((o) => {
                      const list = [...(o[name] ?? [])];
                      delete list[picked.ex];
                      return { ...o, [name]: list };
                    })
                : undefined
            }
            onGo={choose}
            onToken={onToken}
          />
        </div>
      )}
    </div>
  );
}

const hex = (c: string) => {
  const m = c.match(/[\d.]+/g);
  if (!m || m.length < 3) return c;
  if (m.length > 3 && Number(m[3]) === 0) return 'transparent';
  return (
    '#' +
    m
      .slice(0, 3)
      .map((x) => Number(x).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
};

function Properties({
  top,
  picked,
  el,
  values,
  onChange,
  onReset,
  onGo,
  onToken,
}: {
  top: Entry;
  picked: Picked;
  el?: HTMLElement;
  values?: Props;
  onChange: (key: string, value: string | boolean) => void;
  onReset?: () => void;
  onGo: (name: string) => void;
  onToken: (key: TokenKey) => void;
}) {
  // Décrit l'élément le plus profond sélectionné.
  const e = entry(picked.chain.at(-1)!) ?? top;
  const cs = el?.isConnected ? getComputedStyle(el) : undefined;
  const box = el?.getBoundingClientRect();
  return (
    <section className="ds-props" aria-label="Propriétés">
      <div>
        <h3>Élément</h3>
        <p className="ds-crumbs">
          {picked.chain.map((c, i) => (
            <span key={i}>
              {i > 0 && ' › '}
              {i === picked.chain.length - 1 ? (
                <strong>{c}</strong>
              ) : (
                <a
                  href={`#${c}`}
                  onClick={(ev) => {
                    ev.preventDefault();
                    onGo(c);
                  }}
                >
                  {c}
                </a>
              )}
            </span>
          ))}
        </p>
        <Row label="Niveau">
          <span className={`level-tag ${e.level}`}>{e.level}</span> {e.kind}
        </Row>
        <Row label="Source">{e.source ?? 'Pas encore dans le code'}</Row>
        <Row label="Composé de">
          <Links names={e.uses ?? []} onGo={onGo} empty="— (atome)" />
        </Row>
        <Row label="Utilisé dans">
          <Links names={usedIn(e.name)} onGo={onGo} empty="—" />
        </Row>

        <h3>Propriétés</h3>
        {!e.props.length && <p className="ds-muted">Aucune prop.</p>}
        {e.props.length > 0 &&
          (values ? (
            <p className="ds-note">
              Modifications locales à l’aperçu, pas encore écrites dans le code.{' '}
              {onReset && (
                <button type="button" onClick={onReset}>
                  Réinitialiser
                </button>
              )}
            </p>
          ) : (
            <p className="ds-note">
              Valeurs écrites dans {picked.chain.at(-2) ?? 'le composant'} :
              lecture seule.
            </p>
          ))}
        {e.props.map((p) => {
          const v = values ? (values[p.name] ?? p.default) : el && p.read(el);
          const id = `prop-${p.name}`;
          return (
            <Row key={p.name} label={p.name} htmlFor={values && id}>
              {!values ? (
                <code>{JSON.stringify(v ?? '—')}</code>
              ) : p.type === 'enum' ? (
                <select
                  id={id}
                  value={String(v)}
                  onChange={(ev) => onChange(p.name, ev.target.value)}
                >
                  {p.options!.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : p.type === 'bool' ? (
                <input
                  id={id}
                  type="checkbox"
                  checked={!!v}
                  onChange={(ev) => onChange(p.name, ev.target.checked)}
                />
              ) : (
                <input
                  id={id}
                  value={String(v)}
                  onChange={(ev) => onChange(p.name, ev.target.value)}
                />
              )}
              <small>
                défaut {JSON.stringify(p.default)}
                {p.options && ` · ${p.options.join(' | ')}`}
              </small>
            </Row>
          );
        })}
        {e.states.length > 0 && <Row label="États">{e.states.join(', ')}</Row>}
        {e.missing.length > 0 && (
          <p className="ds-muted">
            Pas encore pris en charge : {e.missing.join(' ; ')}.
          </p>
        )}
      </div>
      <div>
        <h3>Visuel</h3>
        {cs && box ? (
          <>
            <Row label="Taille">
              {Math.round(box.width)} × {Math.round(box.height)}
            </Row>
            <Row label="Affichage">
              {cs.display}
              {cs.display.includes('flex') &&
                ` · ${cs.flexDirection} · gap ${cs.gap}`}
            </Row>
            <Row label="Padding">{cs.padding}</Row>
            <Row label="Margin">{cs.margin}</Row>
            <Row label="Typo">
              {cs.fontFamily.split(',')[0]} · {cs.fontSize} · {cs.fontWeight} ·
              lh {cs.lineHeight}
            </Row>
            <Row label="Texte">{hex(cs.color)}</Row>
            <Row label="Fond">{hex(cs.backgroundColor)}</Row>
            <Row label="Bordure">
              {cs.borderTopWidth} {cs.borderTopStyle} {hex(cs.borderTopColor)}
            </Row>
            <Row label="Rayon">{cs.borderTopLeftRadius}</Row>
            <Row label="Opacité">{cs.opacity}</Row>
            <p className="ds-muted">
              Lu sur le rendu. Par breakpoint : à venir.
            </p>
          </>
        ) : (
          <p className="ds-muted">Pas de rendu à mesurer.</p>
        )}
        <h3>Tokens utilisés</h3>
        {e.tokens.length ? (
          <p className="ds-links">
            {e.tokens.map((k, i) => (
              <span key={k}>
                {i > 0 && ', '}
                <a
                  href="#panel-tokens"
                  onClick={(ev) => {
                    ev.preventDefault();
                    onToken(k);
                  }}
                >
                  {k}
                </a>
              </span>
            ))}
          </p>
        ) : (
          <p className="ds-muted">Aucun token référencé.</p>
        )}
      </div>
    </section>
  );
}
function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="ds-row">
      {htmlFor ? (
        <label htmlFor={htmlFor}>{label}</label>
      ) : (
        <span>{label}</span>
      )}
      <div>{children}</div>
    </div>
  );
}
function Links({
  names,
  onGo,
  empty,
}: {
  names: string[];
  onGo: (name: string) => void;
  empty: string;
}) {
  if (!names.length) return <span className="ds-muted">{empty}</span>;
  return (
    <span className="ds-links">
      {names.map((n, i) => (
        <span key={n}>
          {i > 0 && ', '}
          <a
            href={`#${n}`}
            onClick={(ev) => {
              ev.preventDefault();
              onGo(n);
            }}
          >
            {n}
          </a>
        </span>
      ))}
    </span>
  );
}

import { useEffect, useRef, useState } from 'react';
import { request } from './api.js';
import { codedFor, type CodeComponent } from '../shared/components.js';
import { panelSelection } from '../shared/panel.js';
import type { PropSpec } from '../shared/props.js';
import {
  addInstance,
  duplicateInstance,
  moveInstance,
  removeInstance,
  setProp,
  type PagePlan,
} from '../shared/pagePlan.js';
import type { CodeProposal } from '../server/code.js';
import type { Focus } from '../shared/focus.js';

type Value = string | number | boolean;
type Rect = { id: string; top: number; bottom: number };

// Mode « Construire » de la Preview : panneau des composants du DS, page
// rendue par le relais du projet avec les vrais composants, calques et
// propriétés de l'instance sélectionnée. Tout passe par le plan de page.
export default function PreviewBuild({
  page,
  devUrl,
  width,
  height,
  code,
  onAsk,
  onCodeProposal,
  onError,
  onFocus,
  chatChange,
}: {
  page: { id: string; name: string };
  devUrl: string;
  width: number;
  height: number;
  code?: { components: CodeComponent[]; map: Record<string, string> };
  onAsk: (message: string) => void;
  onCodeProposal: (p: CodeProposal) => void;
  onError: (message: string) => void;
  // Le chat reçoit la page et l'instance sélectionnée (« ce bouton »).
  onFocus: (focus: Focus) => void;
  // Plan modifié par le chat : la page se recharge, « Annuler » apparaît.
  chatChange?: { page: string; n: number };
}) {
  const [canUndo, setCanUndo] = useState(false);
  const [bridge, setBridge] = useState<boolean>();
  const [plan, setPlan] = useState<PagePlan>({ instances: [] });
  const [selected, setSelected] = useState<string>();
  const [rects, setRects] = useState<Rect[]>([]);
  const [dragging, setDragging] = useState(false);
  const [specs, setSpecs] = useState<Record<string, PropSpec[]>>({});
  const frame = useRef<HTMLIFrameElement>(null);
  const origin = new URL(devUrl).origin;

  // Relais présent dans le projet ? Revérifié tant qu'il manque (diff à valider).
  useEffect(() => {
    if (bridge) return;
    const check = () =>
      request<{ installed: boolean }>('ds-bridge')
        .then((b) => setBridge(b.installed))
        .catch(() => undefined);
    void check();
    const timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, [bridge]);
  useEffect(() => {
    setSelected(undefined);
    request<PagePlan>(`page-plan?page=${encodeURIComponent(page.id)}`)
      .then(setPlan)
      .catch((e) => onError(e.message));
  }, [page.id]);
  const save = (next: PagePlan, select?: string) => {
    setPlan(next);
    setCanUndo(false);
    if (select !== undefined) setSelected(select);
    request('page-plan', { page: page.id, plan: next }).catch((e) =>
      onError(e.message),
    );
  };
  // Plan et sélection envoyés au relais à chaque changement.
  const send = () =>
    frame.current?.contentWindow?.postMessage(
      { type: 'ds-studio:page', instances: plan.instances, selected },
      origin,
    );
  useEffect(send, [plan, selected]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      if (event.data?.type === 'ds-studio:ready') send();
      if (event.data?.type === 'ds-studio:select') setSelected(event.data.id);
      if (event.data?.type === 'ds-studio:rects') setRects(event.data.rects);
    };
    addEventListener('message', onMessage);
    return () => removeEventListener('message', onMessage);
  });
  const current = plan.instances.find((i) => i.id === selected);
  useEffect(() => {
    onFocus({
      page: 'preview',
      kind: current ? 'component' : 'page',
      name: current ? current.component : page.name,
      path: current ? [page.name, current.component] : [page.name],
      source: 'build',
      value: page.id,
      ...(current ? { selector: current.id } : {}),
      props: { format: `${width}px` },
    });
  }, [page.id, page.name, current?.id, width]);
  const reload = () =>
    request<PagePlan>(`page-plan?page=${encodeURIComponent(page.id)}`)
      .then(setPlan)
      .catch((e) => onError(e.message));
  useEffect(() => {
    if (chatChange?.page !== page.id) return;
    void reload();
    setCanUndo(true);
  }, [chatChange?.n]);
  // Propriétés du composant sélectionné, lues dans son code (une fois par fichier).
  useEffect(() => {
    if (!current || specs[current.file]) return;
    request<PropSpec[]>(`component-props?file=${encodeURIComponent(current.file)}`)
      .then((s) => setSpecs((all) => ({ ...all, [current.file]: s })))
      .catch((e) => onError(e.message));
  }, [current?.file]);

  const add = (c: CodeComponent, at = plan.instances.length) => {
    const { plan: next, id } = addInstance(plan, at, {
      component: c.name,
      file: c.file,
      props: {},
    });
    save(next, id);
  };
  const dropAt = (y: number) =>
    rects.filter((r) => (r.top + r.bottom) / 2 < y).length;

  if (bridge === false)
    return (
      <div className="build-setup">
        <p>
          Pour construire tes pages avec tes vrais composants, la Preview a
          besoin d’un petit relais dans ton projet : <code>ds-studio.html</code>{' '}
          et <code>src/ds-studio/canvas.tsx</code>, utilisés seulement en
          développement.
        </p>
        <button
          type="button"
          className="studio-primary"
          onClick={() =>
            request<CodeProposal>('ds-bridge/install', {})
              .then(onCodeProposal)
              .catch((e) => onError(e.message))
          }
        >
          Voir le diff du relais
        </button>
      </div>
    );

  return (
    <div className="build">
      <aside className="build-side" aria-label="Composants du Design System">
        <p className="build-empty">
          Glisse un composant dans la page, ou clique pour l’ajouter à la fin.
          « à coder » : Clodo le code d’abord.
        </p>
        {panelSelection.map((group) => (
          <section key={group.level}>
            <h3>{group.level}</h3>
            <ul>
              {group.names.map((name) => {
                const c = code ? codedFor(name, code.components, code.map) : undefined;
                return (
                  <li key={name}>
                    {c ? (
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/ds-component', JSON.stringify(c));
                          setDragging(true);
                        }}
                        onDragEnd={() => setDragging(false)}
                        onClick={() => add(c)}
                      >
                        {name}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="build-uncoded"
                        onClick={() =>
                          onAsk(
                            `Code le composant Figma « ${name} » dans mon projet, fidèle à Figma, avec mes tokens.`,
                          )
                        }
                      >
                        {name} <small>à coder</small>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        <section>
          <h3>Calques · {page.name}</h3>
          {canUndo && (
            <button
              type="button"
              onClick={() =>
                request<PagePlan>('page-plan/undo', { page: page.id })
                  .then((p) => {
                    setPlan(p);
                    setCanUndo(false);
                  })
                  .catch((e) => onError(e.message))
              }
            >
              ↶ Annuler la modification du chat
            </button>
          )}
          {!plan.instances.length && <p className="build-empty">Page vide.</p>}
          <ol className="build-layers">
            {plan.instances.map((i, index) => (
              <li
                key={i.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/ds-layer', i.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData('text/ds-layer');
                  if (id) save(moveInstance(plan, id, index));
                }}
              >
                <button
                  type="button"
                  aria-pressed={i.id === selected}
                  onClick={() => setSelected(i.id)}
                >
                  {i.component}
                </button>
              </li>
            ))}
          </ol>
        </section>
      </aside>

      <div className="build-stage">
        <div className="build-frame" style={{ width, height }}>
          <iframe
            ref={frame}
            title={`Construire · ${page.name}`}
            src={`${devUrl}/ds-studio.html`}
            width={width}
            height={height}
            onLoad={send}
          />
          {dragging && (
            <div
              className="build-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const raw = e.dataTransfer.getData('text/ds-component');
                if (!raw) return;
                const box = e.currentTarget.getBoundingClientRect();
                add(JSON.parse(raw) as CodeComponent, dropAt(e.clientY - box.top));
              }}
            >
              Dépose ici
            </div>
          )}
        </div>
      </div>

      <aside className="build-side" aria-label="Propriétés">
        {current ? (
          <>
            <h3>{current.component}</h3>
            <p className="build-file">{current.file}</p>
            <div className="build-actions">
              <button
                type="button"
                onClick={() =>
                  save(moveInstance(plan, current.id, plan.instances.indexOf(current) - 1))
                }
                disabled={plan.instances[0] === current}
                aria-label="Monter"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() =>
                  save(moveInstance(plan, current.id, plan.instances.indexOf(current) + 1))
                }
                disabled={plan.instances.at(-1) === current}
                aria-label="Descendre"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => {
                  const { plan: next, id } = duplicateInstance(plan, current.id);
                  save(next, id);
                }}
              >
                Dupliquer
              </button>
              <button
                type="button"
                onClick={() => save(removeInstance(plan, current.id), '')}
              >
                Supprimer
              </button>
            </div>
            {(specs[current.file] ?? []).map((s) => (
              <PropControl
                key={s.name}
                spec={s}
                value={current.props[s.name]}
                onChange={(v) => save(setProp(plan, current.id, s.name, v))}
              />
            ))}
            {specs[current.file]?.length === 0 && (
              <p className="build-empty">
                Aucune propriété modifiable trouvée dans le code de ce composant.
              </p>
            )}
          </>
        ) : (
          <p className="build-empty">
            Sélectionne un composant dans la page ou dans les calques.
          </p>
        )}
      </aside>
    </div>
  );
}

// Un contrôle adapté au type réel de la propriété ; vide = valeur par défaut.
function PropControl({
  spec,
  value,
  onChange,
}: {
  spec: PropSpec;
  value: Value | undefined;
  onChange: (v: Value | undefined) => void;
}) {
  const label = (
    <span>
      {spec.name}
      {spec.required && ' *'}
      {spec.doc && <small>{spec.doc}</small>}
    </span>
  );
  if (spec.kind === 'boolean')
    return (
      <label className="build-prop build-check">
        <input
          type="checkbox"
          checked={value === undefined ? spec.default === true : value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    );
  if (spec.kind === 'enum')
    return (
      <label className="build-prop">
        {label}
        <select
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">
            {spec.default !== undefined ? `${spec.default} (par défaut)` : '—'}
          </option>
          {spec.options!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <label className="build-prop">
      {label}
      <input
        type={spec.kind === 'number' ? 'number' : 'text'}
        value={value === undefined ? '' : String(value)}
        placeholder={spec.default !== undefined ? String(spec.default) : ''}
        onChange={(e) =>
          onChange(
            e.target.value === ''
              ? undefined
              : spec.kind === 'number'
                ? Number(e.target.value)
                : e.target.value,
          )
        }
      />
    </label>
  );
}

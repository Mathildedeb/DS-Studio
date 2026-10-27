import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { request } from './api.js';
import { maxSpan, minSpan } from '../shared/dashboard.js';

type Item<Id extends string> = { id: Id; span: number };
type BoardLayout<Id extends string> = { widgets: Item<Id>[] };

// Grille commune au tableau de bord et à l'atelier : glisser pour déplacer,
// tirer le bord droit pour la largeur, × pour cacher. Boutons et flèches au clavier.
export default function Board<Id extends string>({
  name,
  ids,
  titles,
  fallback,
  render,
  onError,
  label,
}: {
  name: 'dashboard' | 'atelier';
  ids: readonly Id[];
  titles: Record<Id, string>;
  fallback: BoardLayout<Id>;
  render: (id: Id) => ReactNode;
  onError: (message: string) => void;
  label: string;
}) {
  const [layout, setLayout] = useState<BoardLayout<Id>>();
  const [adding, setAdding] = useState<Id | ''>('');
  const [dragged, setDragged] = useState<Id>();
  const [drop, setDrop] = useState<{ id: Id; after: boolean }>();
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    request<BoardLayout<Id>>(name)
      .then(setLayout)
      .catch((e) => {
        setLayout(fallback);
        onError(e.message);
      });
  }, [name]);
  // La disposition est enregistrée par le serveur, jamais dans le navigateur.
  const save = (next: BoardLayout<Id>) => {
    setLayout(next);
    request(name, next).catch((e) => onError(e.message));
  };
  if (!layout) return <p className="loading">Chargement de la disposition…</p>;
  const shown = new Set(layout.widgets.map((w) => w.id));
  const hidden = ids.filter((id) => !shown.has(id));
  const setSpan = (id: Id, span: number, persist = true) => {
    const next = {
      widgets: layout.widgets.map((w) =>
        w.id === id
          ? { ...w, span: Math.min(maxSpan, Math.max(minSpan, span)) }
          : w,
      ),
    };
    if (persist) save(next);
    else setLayout(next);
  };
  const moveTo = (id: Id, target: Id, after: boolean) => {
    if (id === target) return;
    const rest = layout.widgets.filter((w) => w.id !== id);
    const moving = layout.widgets.find((w) => w.id === id)!;
    const at = rest.findIndex((w) => w.id === target) + (after ? 1 : 0);
    save({ widgets: [...rest.slice(0, at), moving, ...rest.slice(at)] });
  };
  const step = (id: Id, delta: 1 | -1) => {
    const i = layout.widgets.findIndex((w) => w.id === id);
    const target = layout.widgets[i + delta];
    if (target) moveTo(id, target.id, delta > 0);
  };
  // Glisser au pointeur (souris, trackpad, doigt) : la vue survolée indique
  // l'emplacement, avant ou après selon la moitié visée.
  function startDrag(id: Id, e: ReactPointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    let target: { id: Id; after: boolean } | undefined;
    setDragged(id);
    const move = (ev: PointerEvent) => {
      const over = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>('.board-item');
      const overId = over?.dataset.id as Id | undefined;
      if (!over || !overId || overId === id) {
        target = undefined;
      } else {
        const r = over.getBoundingClientRect();
        target = { id: overId, after: ev.clientX > r.left + r.width / 2 };
      }
      setDrop(target);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setDragged(undefined);
      setDrop(undefined);
      if (target) moveTo(id, target.id, target.after);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }
  function startResize(id: Id, start: number, e: ReactPointerEvent) {
    const box = grid.current;
    if (!box) return;
    e.preventDefault();
    const gap = parseFloat(getComputedStyle(box).columnGap) || 0;
    const column = (box.clientWidth - gap * (maxSpan - 1)) / maxSpan + gap;
    const x = e.clientX;
    let span = start;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const next = Math.min(
        maxSpan,
        Math.max(minSpan, start + Math.round((ev.clientX - x) / column)),
      );
      if (next !== span) {
        span = next;
        setSpan(id, span, false);
      }
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (span !== start) setSpan(id, span);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  return (
    <>
      <div className="board-tools" aria-label={`Disposition : ${label}`}>
        {hidden.length > 0 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!adding) return;
              save({ widgets: [...layout.widgets, { id: adding, span: 6 }] });
              setAdding('');
            }}
          >
            <label className="field">
              Vues cachées
              <select
                value={adding}
                onChange={(e) => setAdding(e.target.value as Id)}
              >
                <option value="">Choisir…</option>
                {hidden.map((id) => (
                  <option key={id} value={id}>
                    {titles[id]}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={!adding}>Afficher</button>
          </form>
        )}
        <button onClick={() => save(fallback)}>Réinitialiser</button>
      </div>
      <div className="board-grid" ref={grid}>
        {layout.widgets.map(({ id, span }, index) => (
          <div
            key={id}
            className={[
              'board-item',
              dragged === id ? 'is-dragging' : '',
              drop?.id === id
                ? drop.after
                  ? 'drop-after'
                  : 'drop-before'
                : '',
            ].join(' ')}
            style={{ '--span': span } as CSSProperties}
            data-id={id}
          >
            <div className="board-controls">
              <button
                className="board-handle"
                onPointerDown={(e) => startDrag(id, e)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    step(id, -1);
                  }
                  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    step(id, 1);
                  }
                }}
                aria-label={`Déplacer ${titles[id]} : glisser, ou flèches du clavier (position ${index + 1} sur ${layout.widgets.length})`}
                title="Glisser pour déplacer"
              >
                ⠿
              </button>
              <button
                onClick={() => setSpan(id, span - 1)}
                disabled={span <= minSpan}
                aria-label={`Réduire ${titles[id]} (${span} colonnes sur 12)`}
                title="Réduire"
              >
                −
              </button>
              <button
                onClick={() => setSpan(id, span + 1)}
                disabled={span >= maxSpan}
                aria-label={`Agrandir ${titles[id]} (${span} colonnes sur 12)`}
                title="Agrandir"
              >
                +
              </button>
              <button
                onClick={() =>
                  save({ widgets: layout.widgets.filter((w) => w.id !== id) })
                }
                aria-label={`Cacher ${titles[id]}`}
                title="Cacher"
              >
                ×
              </button>
            </div>
            {render(id)}
            <div
              className="board-resize"
              onPointerDown={(e) => startResize(id, span, e)}
              title="Tirer pour changer la largeur"
              aria-hidden="true"
            />
          </div>
        ))}
      </div>
    </>
  );
}

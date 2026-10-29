import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { request } from './api.js';
import { codedFor, type CodeComponent } from '../shared/components.js';
import { panelSelection } from '../shared/panel.js';
import type { PropSpec } from '../shared/props.js';
import {
  addInstance,
  duplicateInstance,
  moveInstance,
  removeInstance,
  setLink,
  setProp,
  type PagePlan,
} from '../shared/pagePlan.js';
import type { CodeProposal } from '../server/code.js';
import type { Focus } from '../shared/focus.js';
import type { FigmaComponent } from '../../connectors/figma/library.js';
import DeviceFrame, { closestIPhone, iPhones, isPhone } from './DeviceFrame.js';

type Value = string | number | boolean;
type Rect = { id: string; top: number; bottom: number };
// Ce qu'on glisse ou ajoute : un composant codé, ou sa maquette Figma.
type Entry = { component: string; file?: string; figma?: string };
type Variants = { props: PropSpec[]; variants: { id: string; values: Record<string, string> }[] };
// Un composant de la bibliothèque : son nom Figma, son niveau, et ce qui l'implémente.
type Item = { name: string; level: string; entry: Entry; coded: boolean; figma?: FigmaComponent };

// Combinaison Figma qui correspond aux valeurs choisies (défauts sinon).
const variantId = (v: Variants, props: Record<string, Value>) =>
  v.variants.find((x) =>
    v.props.every((p) => x.values[p.name] === String(props[p.name] ?? p.default)),
  )?.id ?? v.variants[0]?.id;

// Propriétés d'une maquette : les définitions Figma, sinon les noms des
// variantes (« style=filled, Size=small ») ; défaut = première variante.
const withProps = (v: Variants): Variants =>
  v.props.length || v.variants.length < 2
    ? v
    : {
        ...v,
        props: Object.keys(v.variants[0].values).map((name) => ({
          name,
          kind: 'enum' as const,
          options: [...new Set(v.variants.map((x) => x.values[name]).filter(Boolean))],
          required: false,
          default: v.variants[0].values[name],
          doc: 'Variante Figma',
        })),
      };

// Préférences d'affichage de l'éditeur, propres à ce poste.
const stored = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(`ds-build:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};
const store = (key: string, value: unknown) => {
  try {
    localStorage.setItem(`ds-build:${key}`, JSON.stringify(value));
  } catch {
    // Navigation privée : préférences non gardées.
  }
};
const narrowQuery = '(max-width: 900px)';

// Mode « Construire » de la Preview : bibliothèque du DS à gauche, page
// rendue par le relais du projet au centre (dans un vrai viewport d'iPhone),
// propriétés à droite. Tout passe par le plan de page, avec annuler/rétablir.
// Un composant pas encore codé s'utilise en maquette Figma : Build le code.
export default function PreviewBuild({
  page,
  pages,
  onNavigate,
  devUrl,
  width,
  height,
  code,
  figma,
  onBuild,
  onCodeProposal,
  onError,
  onFocus,
  chatChange,
}: {
  page: { id: string; name: string; path: string };
  // Pages de la Preview : cibles des interactions « au clic, aller à ».
  pages: { id: string; name: string; path?: string }[];
  onNavigate: (page: string) => void;
  devUrl: string;
  width: number;
  height: number;
  code?: { components: CodeComponent[]; map: Record<string, string> };
  // Composants du fichier Figma du projet : maquettes des composants non codés.
  figma?: FigmaComponent[];
  // Build : Clodo code la page et ses maquettes, proposé en diff.
  onBuild: (message: string, focus: Focus) => void;
  onCodeProposal: (p: CodeProposal) => void;
  onError: (message: string) => void;
  // Le chat reçoit la page et l'instance sélectionnée (« ce bouton »).
  onFocus: (focus: Focus) => void;
  // Plan modifié par le chat : la page se recharge, annulable comme le reste.
  chatChange?: { page: string; n: number };
}) {
  const [bridge, setBridge] = useState<{ installed: boolean; current: boolean }>();
  const [plan, setPlan] = useState<PagePlan>({ instances: [] });
  const [past, setPast] = useState<PagePlan[]>([]);
  const [future, setFuture] = useState<PagePlan[]>([]);
  const [selected, setSelected] = useState<string>();
  const [inspected, setInspected] = useState<string>();
  const [rects, setRects] = useState<Rect[]>([]);
  const [dropIndex, setDropIndex] = useState<number>();
  const [dragging, setDragging] = useState(false);
  const [testing, setTesting] = useState(false);
  const [query, setQuery] = useState('');
  const [closedLevels, setClosedLevels] = useState<string[]>(() => stored('closed', []));
  const [specs, setSpecs] = useState<Record<string, PropSpec[]>>({});
  const [variants, setVariants] = useState<Record<string, Variants>>({});
  const [images, setImages] = useState<Record<string, string>>({});
  const [deviceId, setDeviceId] = useState<string>(() => stored('device', ''));
  const [narrow, setNarrow] = useState(() => matchMedia(narrowQuery).matches);
  const [left, setLeft] = useState(() => !matchMedia(narrowQuery).matches && stored('left', true));
  const [right, setRight] = useState(() => !matchMedia(narrowQuery).matches && stored('right', true));
  const [widths, setWidths] = useState<[number, number]>(() => stored('widths', [240, 260]));
  const frame = useRef<HTMLIFrameElement>(null);
  // Aperçu de la fiche : le même relais que la page, avec une seule instance.
  const sample = useRef<HTMLIFrameElement>(null);
  const [draft, setDraft] = useState<Record<string, Value>>({});
  const search = useRef<HTMLInputElement>(null);
  const origin = new URL(devUrl).origin;
  const device = isPhone(width)
    ? (iPhones.find((d) => d.id === deviceId) ?? closestIPhone(width, height))
    : undefined;
  const screen = device ? { width: device.width, height: device.height } : { width, height };

  useEffect(() => {
    const media = matchMedia(narrowQuery);
    const change = () => {
      setNarrow(media.matches);
      // Écran étroit : les panneaux deviennent des tiroirs, fermés par défaut.
      if (media.matches) {
        setLeft(false);
        setRight(false);
      } else {
        setLeft(stored('left', true));
        setRight(stored('right', true));
      }
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (narrow) return;
    store('left', left);
    store('right', right);
  }, [left, right, narrow]);

  // Relais présent et à jour dans le projet ? Revérifié tant qu'il manque.
  useEffect(() => {
    if (bridge?.current) return;
    const check = () =>
      request<{ installed: boolean; current: boolean }>('ds-bridge')
        .then(setBridge)
        .catch(() => undefined);
    void check();
    const timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, [bridge?.current]);
  const load = () =>
    request<PagePlan>(`page-plan?page=${encodeURIComponent(page.id)}`)
      .then((p) => {
        setPlan(p);
        return p;
      })
      .catch((e) => {
        onError(e.message);
        return undefined;
      });
  useEffect(() => {
    setSelected(undefined);
    setPast([]);
    setFuture([]);
    void load();
  }, [page.id]);
  const write = (next: PagePlan) =>
    request('page-plan', { page: page.id, plan: next }).catch((e) => onError(e.message));
  // Chaque modification passe ici : enregistrée, et annulable.
  const save = (next: PagePlan, select?: string) => {
    setPast((p) => [...p.slice(-49), plan]);
    setFuture([]);
    setPlan(next);
    if (select !== undefined) setSelected(select || undefined);
    void write(next);
  };
  const undo = () => {
    const prev = past.at(-1);
    if (!prev) return;
    setPast(past.slice(0, -1));
    setFuture([plan, ...future]);
    setPlan(prev);
    void write(prev);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([...past, plan]);
    setPlan(next);
    void write(next);
  };
  // Le chat a modifié le plan : rechargé, et annulable comme une action à la main.
  useEffect(() => {
    if (chatChange?.page !== page.id) return;
    const before = plan;
    void load().then((p) => {
      if (!p) return;
      setPast((h) => [...h.slice(-49), before]);
      setFuture([]);
    });
  }, [chatChange?.n]);

  // Maquettes : variantes puis rendu Figma de la combinaison choisie.
  const figmaIds = [
    ...plan.instances.flatMap((i) => (i.figma && !i.file ? [i.figma] : [])),
  ];
  const library: Item[] = panelSelection.flatMap((group) =>
    group.names.map((name) => {
      const c = code ? codedFor(name, code.components, code.map) : undefined;
      const f = figma?.find((x) => x.name === name);
      return {
        name,
        level: group.level,
        coded: !!c,
        figma: f,
        entry: c
          ? { component: c.name, file: c.file }
          : { component: name, ...(f ? { figma: f.id } : {}) },
      };
    }),
  );
  const item = library.find((x) => x.name === inspected);
  useEffect(() => {
    const ids = new Set(figmaIds);
    if (item?.figma && !item.coded) ids.add(item.figma.id);
    for (const id of ids)
      if (!variants[id])
        request<Variants>(`figma/variants?id=${encodeURIComponent(id)}`)
          .then((v) => setVariants((all) => ({ ...all, [id]: withProps(v) })))
          .catch(() =>
            setVariants((all) => ({ ...all, [id]: { props: [], variants: [{ id, values: {} }] } })),
          );
  }, [plan, inspected]);
  const imageOf = (i: Entry & { props: Record<string, Value> }) =>
    i.figma && !i.file && variants[i.figma] ? variantId(variants[i.figma], i.props) : undefined;
  const fetchImage = (id: string) => {
    if (id in images) return;
    setImages((all) => ({ ...all, [id]: '' }));
    fetch(`/api/figma/image?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then(
        (blob) =>
          new Promise<string>((done) => {
            const reader = new FileReader();
            reader.onload = () => done(String(reader.result));
            reader.readAsDataURL(blob);
          }),
      )
      .then((url) => setImages((all) => ({ ...all, [id]: url })))
      .catch(() => undefined);
  };
  useEffect(() => {
    for (const i of plan.instances) {
      const id = imageOf(i);
      if (id) fetchImage(id);
    }
    const shown = item && imageOf({ ...item.entry, props: draft });
    if (shown) fetchImage(shown);
  }, [plan, variants, inspected, draft]);

  // Plan, sélection, safe areas et mode envoyés au relais à chaque changement.
  const send = () =>
    frame.current?.contentWindow?.postMessage(
      {
        type: 'ds-studio:page',
        instances: plan.instances.map((i) => {
          const id = imageOf(i);
          return id && images[id] ? { ...i, image: images[id] } : i;
        }),
        selected,
        insets: { top: device?.top ?? 0, bottom: device?.bottom ?? 0 },
        interactive: testing,
      },
      origin,
    );
  useEffect(send, [plan, selected, images, variants, testing, device?.id]);
  // La fiche montre le composant rendu comme dans la page, une variante à la fois.
  const sendSample = () => {
    if (!item) return;
    const one = { id: 'fiche', ...item.entry, props: draft };
    const id = imageOf(one);
    sample.current?.contentWindow?.postMessage(
      {
        type: 'ds-studio:page',
        instances: [id && images[id] ? { ...one, image: images[id] } : one],
        insets: { top: 0, bottom: 0 },
        interactive: true,
      },
      origin,
    );
  };
  useEffect(sendSample, [inspected, draft, images, variants]);
  useEffect(() => setDraft({}), [inspected]);

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
      props: { format: `${screen.width}px` },
    });
  }, [page.id, page.name, current?.id, screen.width]);
  // Propriétés du composant, lues dans son code (une fois par fichier).
  const needFile = current?.file ?? (item?.coded ? item.entry.file : undefined);
  useEffect(() => {
    if (!needFile || specs[needFile]) return;
    request<PropSpec[]>(`component-props?file=${encodeURIComponent(needFile)}`)
      .then((s) => setSpecs((all) => ({ ...all, [needFile]: s })))
      .catch((e) => onError(e.message));
  }, [needFile]);
  const specsOf = (e: Entry) =>
    e.file ? specs[e.file] : e.figma ? variants[e.figma]?.props : [];

  const add = (e: Entry, at = plan.instances.length, props: Record<string, Value> = {}) => {
    const { plan: next, id } = addInstance(plan, at, { ...e, props });
    save(next, id);
    setInspected(undefined);
  };
  const move = (by: number) => {
    if (!current) return;
    const at = plan.instances.indexOf(current) + by;
    if (at < 0 || at >= plan.instances.length) return;
    save(moveInstance(plan, current.id, at));
  };
  const duplicate = () => {
    if (!current) return;
    const { plan: next, id } = duplicateInstance(plan, current.id);
    save(next, id);
  };
  const remove = () => current && save(removeInstance(plan, current.id), '');

  // Raccourcis clavier, dans l'éditeur comme dans la page du projet.
  const shortcut = (k: { key: string; meta: boolean; shift: boolean; alt: boolean }) => {
    const key = k.key.toLowerCase();
    if (k.meta && key === 'z') (k.shift ? redo : undo)();
    else if (k.meta && key === 'y') redo();
    else if (k.meta && key === 'd') duplicate();
    else if (key === 'delete' || key === 'backspace') remove();
    else if (k.alt && key === 'arrowup') move(-1);
    else if (k.alt && key === 'arrowdown') move(1);
    else if (key === 'escape') {
      setSelected(undefined);
      setInspected(undefined);
    }
    else if (key === '/') search.current?.focus();
    else return false;
    return true;
  };
  const shortcutRef = useRef(shortcut);
  shortcutRef.current = shortcut;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : document.body;
      if (t.closest('input, textarea, select, [contenteditable], dialog, [role="dialog"]')) return;
      if (!t.closest('.build') && t !== document.body) return;
      if (shortcutRef.current({ key: e.key, meta: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey }))
        e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      const d = event.data;
      if (event.source === sample.current?.contentWindow) {
        if (d?.type === 'ds-studio:ready') sendSample();
        return;
      }
      if (d?.type === 'ds-studio:ready') send();
      if (d?.type === 'ds-studio:select') {
        setSelected(d.id);
        setInspected(undefined);
        if (narrow) setRight(true);
      }
      if (d?.type === 'ds-studio:rects') setRects(d.rects);
      // Mode Tester : un clic sur une instance liée ouvre sa page.
      if (d?.type === 'ds-studio:navigate' && pages.some((p) => p.id === d.page)) onNavigate(d.page);
      if (d?.type === 'ds-studio:key' && typeof d.key === 'string')
        shortcutRef.current({ key: d.key, meta: !!d.meta, shift: !!d.shift, alt: !!d.alt });
    };
    addEventListener('message', onMessage);
    return () => removeEventListener('message', onMessage);
  });

  // Dépôt : position dans la page à l'échelle de l'écran (zoom compris).
  const indexAt = (e: React.DragEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const y = ((e.clientY - box.top) * screen.height) / box.height;
    return rects.filter((r) => (r.top + r.bottom) / 2 < y).length;
  };
  const lineTop =
    dropIndex === undefined
      ? 0
      : dropIndex < rects.length
        ? rects[dropIndex].top - 8
        : (rects.at(-1)?.bottom ?? (device?.top ?? 0) + 8) + 8;

  // Redimensionner un panneau en glissant sa bordure (ou ← → au clavier).
  const resize = (side: 0 | 1) => (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = e.clientX;
    const from = widths[side];
    const onMove = (m: PointerEvent) => {
      const next = Math.min(420, Math.max(180, from + (side === 0 ? 1 : -1) * (m.clientX - start)));
      setWidths((w) => (side === 0 ? [next, w[1]] : [w[0], next]));
    };
    const onUp = () => {
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      setWidths((w) => {
        store('widths', w);
        return w;
      });
    };
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
  };
  const resizeKey = (side: 0 | 1) => (e: React.KeyboardEvent) => {
    const by = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
    if (!by) return;
    e.preventDefault();
    setWidths((w) => {
      const next = Math.min(420, Math.max(180, w[side] + (side === 0 ? by : -by)));
      const out: [number, number] = side === 0 ? [next, w[1]] : [w[0], next];
      store('widths', out);
      return out;
    });
  };

  // Une maquette dont le composant vient d'être codé devient une vraie
  // instance : même place, mêmes réglages, liée à son fichier.
  useEffect(() => {
    if (!code) return;
    let changed = false;
    const instances = plan.instances.map((i) => {
      const c = !i.file && codedFor(i.component, code.components, code.map);
      if (!c) return i;
      changed = true;
      const { figma: _, ...rest } = i;
      return { ...rest, component: c.name, file: c.file };
    });
    if (changed) {
      setPlan({ instances });
      void write({ instances });
    }
  }, [code, plan]);
  const toBuild = plan.instances.filter((i) => !i.file);
  const toCode = [...new Set(toBuild.map((i) => i.component))];
  // Build en deux temps, pour des réponses courtes et vérifiables : d'abord
  // les composants encore en maquette, puis la page qui les assemble.
  const build = () =>
    onBuild(
      toCode.length
        ? `Build, étape 1/2 de la page « ${page.name} » : code UNIQUEMENT ces composants du DS, encore en maquette, fidèles à Figma et avec mes tokens, chacun dans son dossier src/components/<niveau>/<Nom>/ avec son CSS et une interface <Nom>Props pour ses variantes : ${toCode.join(', ')}. Ne touche à aucune page : la page sera codée à l'étape 2.`
        : `Build, étape 2/2 : code la vraie page React « ${page.name} » avec les composants du DS, dans l'ordre et avec les props du plan ci-dessous, en réutilisant les composants codés (file) sans les recoder. La page vit à la route ${page.path} du projet : rends-la accessible à cette adresse sans casser l'existant. Les interactions « au_clic_aller_a » ouvrent la route indiquée : code cette navigation.`,
      {
        page: 'preview',
        kind: 'page',
        name: page.name,
        path: [page.name],
        source: 'page-build',
        value: page.id,
        props: { format: `${screen.width}px` },
      },
    );

  if (bridge && !bridge.current)
    return (
      <div className="build-setup">
        <p>
          {bridge.installed
            ? 'Le relais de ton projet doit être mis à jour (iPhone, safe areas, mode Tester) : '
            : 'Pour construire tes pages avec ton DS, la Preview a besoin d’un petit relais dans ton projet : '}
          <code>ds-studio.html</code> et <code>src/ds-studio/canvas.tsx</code>,
          utilisés seulement en développement.
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

  const q = query.trim().toLowerCase();
  const levels = panelSelection.map((g) => g.level);
  const columns = narrow
    ? 'minmax(0, 1fr)'
    : `${left ? `${widths[0]}px 6px` : ''} minmax(0, 1fr) ${right ? `6px ${widths[1]}px` : ''}`;
  const detailSpecs = item ? specsOf(item.entry) : undefined;
  const currentSpecs = current ? specsOf(current) : undefined;

  return (
    <div className="build" data-narrow={narrow || undefined}>
      <div className="build-toolbar" role="toolbar" aria-label="Outils de construction">
        <button
          type="button"
          className="build-tool"
          aria-pressed={left}
          aria-controls="build-library"
          onClick={() => setLeft(!left)}
          title="Afficher ou réduire la bibliothèque"
        >
          ☰ Composants
        </button>
        <div className="build-segment" role="group" aria-label="Mode">
          <button type="button" aria-pressed={!testing} onClick={() => setTesting(false)} title="Sélectionner et modifier">
            Édition
          </button>
          <button type="button" aria-pressed={testing} onClick={() => setTesting(true)} title="Utiliser la page comme dans l’application">
            Tester
          </button>
        </div>
        <button type="button" className="build-tool" onClick={undo} disabled={!past.length} title="Annuler (⌘Z)" aria-label="Annuler">
          ↶
        </button>
        <button type="button" className="build-tool" onClick={redo} disabled={!future.length} title="Rétablir (⇧⌘Z)" aria-label="Rétablir">
          ↷
        </button>
        {device && (
          <label className="build-device">
            <span className="sr-only">Modèle d’iPhone</span>
            <select
              value={device.id}
              onChange={(e) => {
                setDeviceId(e.target.value);
                store('device', e.target.value);
              }}
            >
              {iPhones.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.width}×{d.height}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="build-spacer" />
        <button
          type="button"
          className="studio-primary"
          onClick={build}
          disabled={!plan.instances.length}
          title={toCode.length ? `D'abord les composants : ${toCode.join(', ')}` : 'Clodo code la page et sa navigation'}
        >
          {toCode.length ? `Build 1/2 · coder ${toCode.length} composant(s)` : 'Build 2/2 · coder la page'}
        </button>
        <button
          type="button"
          className="build-tool"
          aria-pressed={right}
          aria-controls="build-props"
          onClick={() => setRight(!right)}
          title="Afficher ou réduire les propriétés"
        >
          Propriétés
        </button>
      </div>

      <div className="build-body" style={{ gridTemplateColumns: columns }}>
        {left && (
          <aside id="build-library" className="build-side build-left" aria-label="Bibliothèque du Design System">
            <div className="build-side-head">
              <input
                ref={search}
                type="search"
                className="build-search"
                placeholder="Rechercher  /"
                aria-label="Rechercher un composant"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="button" className="build-close" onClick={() => setLeft(false)} aria-label="Réduire la bibliothèque" title="Réduire">
                ‹
              </button>
            </div>
            {levels.map((level) => {
              const items = library.filter((x) => x.level === level && x.name.toLowerCase().includes(q));
              if (!items.length) return null;
              const open = q !== '' || !closedLevels.includes(level);
              return (
                <section key={level} className="build-group">
                  <button
                    type="button"
                    className="build-group-head"
                    aria-expanded={open}
                    onClick={() => {
                      const next = open ? [...closedLevels, level] : closedLevels.filter((l) => l !== level);
                      setClosedLevels(next);
                      store('closed', next);
                    }}
                  >
                    <span aria-hidden="true">{open ? '▾' : '▸'}</span> {level} <small>{items.length}</small>
                  </button>
                  {open && (
                    <ul>
                      {items.map((x) => (
                        <li key={x.name} className="build-item">
                          <button
                            type="button"
                            className="build-item-name"
                            aria-pressed={inspected === x.name}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/ds-component', JSON.stringify(x.entry));
                              e.dataTransfer.effectAllowed = 'copy';
                              setDragging(true);
                            }}
                            onDragEnd={() => {
                              setDragging(false);
                              setDropIndex(undefined);
                            }}
                            onClick={() => {
                              setInspected(inspected === x.name ? undefined : x.name);
                              setSelected(undefined);
                            }}
                            title="Voir la fiche · glisser dans la page"
                          >
                            {x.name}
                          </button>
                          <button
                            type="button"
                            className="build-add"
                            onClick={() => add(x.entry)}
                            aria-label={`Ajouter ${x.name} à la fin de la page`}
                            title="Ajouter à la fin"
                          >
                            +
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
            {!library.some((x) => x.name.toLowerCase().includes(q)) && (
              <p className="build-empty">Aucun composant ne correspond à « {query} ».</p>
            )}
            <section className="build-group">
              <h3 className="build-group-head">Calques · {page.name}</h3>
              {!plan.instances.length && (
                <p className="build-empty">Page vide : glisse un composant ou clique sur +.</p>
              )}
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
                      onClick={() => {
                        setSelected(i.id);
                        setInspected(undefined);
                      }}
                    >
                      <span aria-hidden="true">⋮⋮</span> {i.component}
                      {i.link && (
                        <small className="build-link">
                          → {pages.find((x) => x.id === i.link)?.name ?? 'page'}
                        </small>
                      )}
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        )}
        {left && !narrow && (
          <div
            className="build-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Largeur de la bibliothèque"
            tabIndex={0}
            onPointerDown={resize(0)}
            onKeyDown={resizeKey(0)}
          />
        )}

        {left && item && (
          <aside
            className="build-flyout"
            style={{ left: narrow ? 0 : widths[0] + 4 }}
            aria-label={`Fiche de ${item.name}`}
          >
            <div className="build-side-head">
              <h3>{item.name}</h3>
              <button type="button" className="build-close" onClick={() => setInspected(undefined)} aria-label="Fermer la fiche" title="Fermer (Échap)">
                ×
              </button>
            </div>
            <iframe
              ref={sample}
              className="build-sample"
              title={`Aperçu de ${item.name}`}
              src={`${devUrl}/ds-studio.html`}
              onLoad={sendSample}
            />
            <p className="build-file">
              {item.level} · {item.coded ? `codé · ${item.entry.file}` : 'pas encore codé : rendu Figma, codé au Build'}
            </p>
            {item.figma?.description && <p>{item.figma.description}</p>}
            {(detailSpecs ?? []).map((s) => (
              <PropControl
                key={s.name}
                spec={s}
                value={draft[s.name]}
                onChange={(v) =>
                  setDraft((d) => {
                    const next = { ...d };
                    if (v === undefined) delete next[s.name];
                    else next[s.name] = v;
                    return next;
                  })
                }
              />
            ))}
            {detailSpecs?.length === 0 && (
              <p className="build-empty">Aucune propriété modifiable connue.</p>
            )}
            <button type="button" className="studio-primary" onClick={() => add(item.entry, plan.instances.length, draft)}>
              Ajouter à la page
            </button>
          </aside>
        )}
        <div className="build-stage">
          <DeviceFrame
            width={screen.width}
            height={screen.height}
            device={device}
            overlay={
              dragging && (
                <div
                  className="build-drop"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropIndex(indexAt(e));
                  }}
                  onDragLeave={() => setDropIndex(undefined)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    setDropIndex(undefined);
                    const raw = e.dataTransfer.getData('text/ds-component');
                    if (raw) add(JSON.parse(raw) as Entry, indexAt(e));
                  }}
                >
                  {dropIndex !== undefined && (
                    <div className="build-drop-line" style={{ top: lineTop }} />
                  )}
                </div>
              )
            }
          >
            <iframe
              ref={frame}
              title={`Construire · ${page.name}`}
              src={`${devUrl}/ds-studio.html`}
              width={screen.width}
              height={screen.height}
              onLoad={send}
            />
          </DeviceFrame>
        </div>

        {right && !narrow && (
          <div
            className="build-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Largeur des propriétés"
            tabIndex={0}
            onPointerDown={resize(1)}
            onKeyDown={resizeKey(1)}
          />
        )}
        {right && (
          <aside id="build-props" className="build-side build-right" aria-label="Propriétés">
            <div className="build-side-head">
              <h3>Propriétés</h3>
              <button type="button" className="build-close" onClick={() => setRight(false)} aria-label="Réduire les propriétés" title="Réduire">
                ›
              </button>
            </div>
            {current ? (
              <>
                <p className="build-title">{current.component}</p>
                <p className="build-file">{current.file ?? 'Maquette Figma · codée au Build'}</p>
                <div className="build-actions">
                  <button type="button" onClick={() => move(-1)} disabled={plan.instances[0] === current} title="Monter (⌥↑)" aria-label="Monter">
                    ↑
                  </button>
                  <button type="button" onClick={() => move(1)} disabled={plan.instances.at(-1) === current} title="Descendre (⌥↓)" aria-label="Descendre">
                    ↓
                  </button>
                  <button type="button" onClick={duplicate} title="Dupliquer (⌘D)">
                    Dupliquer
                  </button>
                  <button type="button" onClick={remove} title="Supprimer (⌫)">
                    Supprimer
                  </button>
                </div>
                <label className="build-prop">
                  <span>
                    Au clic
                    <small>Interaction codée au Build ; essaie-la en mode Tester.</small>
                  </span>
                  <select
                    value={current.link ?? ''}
                    onChange={(e) => save(setLink(plan, current.id, e.target.value || undefined))}
                  >
                    <option value="">Rien</option>
                    {pages
                      .filter((x) => x.id !== page.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          Aller à « {x.name} »
                        </option>
                      ))}
                  </select>
                </label>
                {(currentSpecs ?? []).map((s) => (
                  <PropControl
                    key={s.name}
                    spec={s}
                    value={current.props[s.name]}
                    onChange={(v) => save(setProp(plan, current.id, s.name, v))}
                  />
                ))}
                {currentSpecs?.length === 0 && (
                  <p className="build-empty">Aucune propriété modifiable pour ce composant.</p>
                )}
              </>
            ) : (
              <p className="build-empty">
                Sélectionne un composant dans la page ou les calques.
                <br />
                <kbd>⌘Z</kbd> annuler · <kbd>⌘D</kbd> dupliquer · <kbd>⌫</kbd> supprimer · <kbd>⌥↑↓</kbd> déplacer · <kbd>/</kbd> rechercher
              </p>
            )}
          </aside>
        )}
      </div>
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

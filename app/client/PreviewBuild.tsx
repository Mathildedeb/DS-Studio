import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { request } from './api.js';
import { codedFor, type CodeComponent } from '../shared/components.js';
import { panelSelection } from '../shared/panel.js';
import type { PropSpec } from '../shared/props.js';
import {
  addInstance,
  duplicateInstance,
  findNode,
  flatten,
  isContainer,
  labelOf,
  moveInstance,
  removeInstance,
  renameNode,
  clearAdapt,
  deviceOf,
  layoutOn,
  setLayout,
  setSize,
  setStyle,
  setLink,
  setProp,
  unwrapNode,
  wrapNodes,
  type Instance,
  type Layout,
  type Node,
  type Size,
  type Sizing,
  type PagePlan,
} from '../shared/pagePlan.js';
import type { CodeProposal } from '../server/code.js';
import type { Focus } from '../shared/focus.js';
import type { FigmaComponent } from '../../connectors/figma/library.js';
import DeviceFrame, { closestIPhone, isPhone } from './DeviceFrame.js';

type Value = string | number | boolean;
// Ce que la Preview confie au chat pour le Build d'une page.
export type BuildRequest = {
  page: { id: string; name: string; path: string };
  toCode: string[];
  componentsMessage: string;
  pageMessage: string;
  focus: Focus;
};
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
const narrowQuery = '(max-width: 899px)';
const mediumQuery = '(min-width: 900px) and (max-width: 1279px)';

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
  // Build : le chat demande puis code les maquettes, puis la page, en diff.
  onBuild: (request: BuildRequest) => void;
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
  // Autres calques sélectionnés (⇧ clic dans les calques), pour grouper.
  const [multi, setMulti] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<string>();
  const [hint, setHint] = useState('');
  // Panneau de gauche : les calques de la page, ou la bibliothèque du DS.
  const [tab, setTabState] = useState<'layers' | 'components'>(() => stored('tab', 'layers'));
  const setTab = (t: 'layers' | 'components') => {
    setTabState(t);
    store('tab', t);
  };
  const [layerQuery, setLayerQuery] = useState('');
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>();
  // Tokens du projet proposés dans les propriétés : couleurs (par leur
  // variable CSS), espacements et arrondis (par leur valeur).
  const [tokens, setTokens] = useState<Tokens>({ colors: [], spacing: [], radius: [] });
  useEffect(() => {
    request<{ tokens: Record<string, { $type?: string; $value?: unknown }> }>('project-tokens')
      .then(({ tokens: all }) => {
        const px = (re: RegExp) =>
          [...new Set(Object.entries(all)
            .filter(([k, t]) => t.$type === 'dimension' && re.test(k))
            .map(([, t]) => parseFloat(String(t.$value)))
            .filter((n) => Number.isFinite(n) && n >= 0 && n <= 400))].sort((a, b) => a - b);
        setTokens({
          colors: Object.entries(all)
            .filter(([, t]) => t.$type === 'color' && typeof t.$value === 'string')
            .map(([k, t]) => ({ key: k, css: `--${k.replaceAll('.', '-')}`, value: String(t.$value) })),
          spacing: px(/spac/i),
          radius: px(/radius/i),
        });
      })
      .catch(() => undefined);
  }, []);
  const [dropOn, setDropOn] = useState<{ id: string; where: 'before' | 'after' | 'inside' }>();
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
  const [narrow, setNarrow] = useState(() => matchMedia(narrowQuery).matches);
  const [left, setLeft] = useState(() => !matchMedia(narrowQuery).matches && stored('left', true));
  const [right, setRight] = useState(() => !matchMedia(narrowQuery).matches && stored('right', true));
  const [widths, setWidths] = useState<[number, number]>(() => stored('widths', [240, 260]));
  const frame = useRef<HTMLIFrameElement>(null);
  // Hauteur de l'espace de travail : ce qui reste de l'écran sous la barre,
  // pour que les panneaux et le canvas défilent seuls, pas la page.
  const body = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState(600);
  useEffect(() => {
    const fit = () => {
      const el = body.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + scrollY;
      setFitted(Math.max(460, Math.round(innerHeight - top - 12)));
    };
    fit();
    addEventListener('resize', fit);
    const observer = new ResizeObserver(fit);
    observer.observe(document.body);
    return () => {
      removeEventListener('resize', fit);
      observer.disconnect();
    };
  }, []);
  // Largeur moyenne (900 à 1279 px) : panneaux plus étroits, toujours visibles.
  const [medium, setMedium] = useState(() => matchMedia(mediumQuery).matches);
  useEffect(() => {
    const media = matchMedia(mediumQuery);
    const change = () => setMedium(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  // Aperçu de la fiche : le même relais que la page, avec une seule instance.
  const sample = useRef<HTMLIFrameElement>(null);
  const [draft, setDraft] = useState<Record<string, Value>>({});
  const search = useRef<HTMLInputElement>(null);
  const origin = new URL(devUrl).origin;
  const device = isPhone(width)
    ? closestIPhone(width, height)
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

  // Composants de la page, à tous les niveaux de l'arbre.
  const components = flatten(plan)
    .map((f) => f.node)
    .filter((n): n is Instance => !isContainer(n));
  // Maquettes : variantes puis rendu Figma de la combinaison choisie.
  const figmaIds = components.flatMap((i) => (i.figma && !i.file ? [i.figma] : []));
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
    for (const i of components) {
      const id = imageOf(i);
      if (id) fetchImage(id);
    }
    const shown = item && imageOf({ ...item.entry, props: draft });
    if (shown) fetchImage(shown);
  }, [plan, variants, inspected, draft]);

  // Arbre envoyé au relais, chaque maquette avec son rendu Figma.
  const withImages = (nodes: Node[]): Node[] =>
    nodes.map((n) => {
      if (isContainer(n)) return { ...n, children: withImages(n.children) };
      const id = imageOf(n);
      return id && images[id] ? ({ ...n, image: images[id] } as Node) : n;
    });
  // Plan, sélection, safe areas et mode envoyés au relais à chaque changement.
  const send = () =>
    frame.current?.contentWindow?.postMessage(
      {
        type: 'ds-studio:page',
        instances: withImages(plan.instances),
        selected,
        multi,
        insets: { top: device?.top ?? 0, bottom: device?.bottom ?? 0 },
        interactive: testing,
      },
      origin,
    );
  useEffect(send, [plan, selected, multi, images, variants, testing, device?.id]);
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

  const found = selected ? findNode(plan, selected) : undefined;
  const current = found?.node;
  const currentComp = current && !isContainer(current) ? current : undefined;
  useEffect(() => {
    onFocus({
      page: 'preview',
      kind: current ? 'component' : 'page',
      name: current ? labelOf(current) : page.name,
      path: current ? [page.name, labelOf(current)] : [page.name],
      source: 'build',
      value: page.id,
      ...(current ? { selector: current.id } : {}),
      props: { format: `${screen.width}px` },
    });
  }, [page.id, page.name, current?.id, screen.width]);
  // Propriétés du composant, lues dans son code (une fois par fichier).
  const needFile = currentComp?.file ?? (item?.coded ? item.entry.file : undefined);
  useEffect(() => {
    if (!needFile || specs[needFile]) return;
    request<PropSpec[]>(`component-props?file=${encodeURIComponent(needFile)}`)
      .then((s) => setSpecs((all) => ({ ...all, [needFile]: s })))
      .catch((e) => onError(e.message));
  }, [needFile]);
  const specsOf = (e: Entry) =>
    e.file ? specs[e.file] : e.figma ? variants[e.figma]?.props : [];

  // Ajout : dans l'Auto Layout ou le Groupe sélectionné, sinon à la fin de la page.
  const add = (e: Entry, at?: number, props: Record<string, Value> = {}, parent?: string | null) => {
    const into = parent !== undefined ? parent : current && isContainer(current) ? current.id : null;
    const where = into ? findNode(plan, into)?.node : undefined;
    const end = where && isContainer(where) ? where.children.length : plan.instances.length;
    const { plan: next, id } = addInstance(plan, at ?? end, { ...e, props }, into);
    save(next, id);
    setInspected(undefined);
  };
  const move = (by: number) => {
    if (!current || !found) return;
    const at = found.index + by;
    if (at < 0 || at >= found.siblings.length) return;
    save(moveInstance(plan, current.id, at));
  };
  const duplicate = () => {
    if (!current) return;
    const { plan: next, id } = duplicateInstance(plan, current.id);
    save(next, id);
  };
  const remove = () => current && save(removeInstance(plan, current.id), '');
  const duplicateId = (target: string) => {
    const { plan: next, id: copy } = duplicateInstance(plan, target);
    save(next, copy);
  };
  const removeId = (target: string) => save(removeInstance(plan, target), target === selected ? '' : undefined);
  // Grouper (⌘G) ou mettre en Auto Layout (⇧A) la sélection ; dégrouper (⇧⌘G).
  const wrap = (kind: 'group' | 'autolayout') => {
    const ids = [selected, ...multi].filter((x): x is string => !!x);
    const done = wrapNodes(plan, ids, kind);
    if (done.error) return setHint(done.error);
    setHint('');
    setMulti([]);
    save(done.plan, done.id);
  };
  const unwrap = () => {
    if (!current || !isContainer(current)) return;
    const first = current.children[0]?.id ?? '';
    save(unwrapNode(plan, current.id), first);
  };
  // Appareil affiché : l'Adaptation règle un Auto Layout pour lui seul.
  const screenDevice = deviceOf(screen.width);
  const adaptOn = !!current && isContainer(current) && current.type === 'autolayout' && !!current.adapt?.[screenDevice];
  const layout = (patch: Partial<Layout>) =>
    current && save(setLayout(plan, current.id, patch, adaptOn ? screenDevice : undefined));
  // Un Groupe devient un Auto Layout (ou l'inverse) sans perdre ses calques.
  const convert = () => {
    if (!current || !isContainer(current) || !found) return;
    const ids = current.children.map((c) => c.id);
    let next = unwrapNode(plan, current.id);
    const done = ids.length
      ? wrapNodes(next, ids, current.type === 'group' ? 'autolayout' : 'group')
      : { plan: next, id: undefined };
    next = done.plan;
    if (done.id && current.name) next = renameNode(next, done.id, current.name);
    save(next, done.id ?? '');
  };

  // Raccourcis clavier, dans l'éditeur comme dans la page du projet.
  const shortcut = (k: { key: string; meta: boolean; shift: boolean; alt: boolean }) => {
    const key = k.key.toLowerCase();
    if (k.meta && key === 'z') (k.shift ? redo : undo)();
    else if (k.meta && key === 'y') redo();
    else if (k.meta && key === 'd') duplicate();
    else if (k.meta && k.shift && key === 'g') unwrap();
    else if (k.meta && key === 'g') wrap('group');
    else if (!k.meta && k.shift && key === 'a') wrap('autolayout');
    else if (key === 'delete' || key === 'backspace') remove();
    else if (k.alt && key === 'arrowup') move(-1);
    else if (k.alt && key === 'arrowdown') move(1);
    else if (key === 'escape') {
      if (menu) return setMenu(undefined), true;
      if (inspected) return setInspected(undefined), true;
      setSelected(undefined);
      setMulti([]);
      setInspected(undefined);
    }
    else if (key === '/') search.current?.focus();
    else return false;
    return true;
  };
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(undefined);
    addEventListener('pointerdown', close);
    return () => removeEventListener('pointerdown', close);
  }, [menu]);
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
        if (d.shift && selected && d.id !== selected)
          setMulti((m) => (m.includes(d.id) ? m.filter((x) => x !== d.id) : [...m, d.id]));
        else {
          setSelected(d.id);
          setMulti([]);
        }
        if (tab !== 'layers') setTab('layers');
        setInspected(undefined);
        if (narrow) setRight(true);
      }
      if (d?.type === 'ds-studio:rects') setRects(d.rects);
      // Gestes sur le canvas : espacements, taille fixe, déplacement ; chacun
      // devient un réglage du calque, annulable comme les autres.
      if (d?.type === 'ds-studio:layout' && d.id && d.patch) {
        if (d.id === selected) layout(d.patch);
        else save(setLayout(plan, d.id, d.patch));
      }
      if (d?.type === 'ds-studio:size' && d.id && d.patch) {
        const n = findNode(plan, d.id)?.node;
        if (n && isContainer(n) && n.type === 'autolayout') {
          if (d.id === selected) layout(d.patch);
          else save(setLayout(plan, d.id, d.patch));
        } else if (n) save(setSize(plan, d.id, d.patch));
      }
      if (d?.type === 'ds-studio:move' && d.id && Number.isInteger(d.to)) save(moveInstance(plan, d.id, d.to));
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
      const next = Math.min(420, Math.max(200, from + (side === 0 ? 1 : -1) * (m.clientX - start)));
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
      const next = Math.min(420, Math.max(200, w[side] + (side === 0 ? by : -by)));
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
    const upgrade = (nodes: Node[]): Node[] =>
      nodes.map((i) => {
        if (isContainer(i)) return { ...i, children: upgrade(i.children) };
        const c = !i.file && codedFor(i.component, code.components, code.map);
        if (!c) return i;
        changed = true;
        const { figma: _, ...rest } = i;
        return { ...rest, component: c.name, file: c.file };
      });
    const instances = upgrade(plan.instances);
    if (changed) {
      setPlan({ instances });
      void write({ instances });
    }
  }, [code, plan]);
  const toBuild = components.filter((i) => !i.file);
  const toCode = [...new Set(toBuild.map((i) => i.component))];
  // Build piloté par le chat, en deux temps pour des réponses courtes et
  // vérifiables : d'abord les composants encore en maquette, puis la page
  // qui les assemble. Le chat pose la question avant chaque étape.
  const build = () =>
    onBuild({
      page,
      toCode,
      componentsMessage: `Build, étape 1/2 de la page « ${page.name} » : code UNIQUEMENT ces composants du DS, encore en maquette, fidèles à Figma et avec mes tokens, chacun dans son dossier src/components/<niveau>/<Nom>/ avec son CSS et une interface <Nom>Props pour ses variantes : ${toCode.join(', ')}. Ne touche à aucune page : la page sera codée à l'étape 2.`,
      pageMessage: `Build, étape 2/2 : code la vraie page React « ${page.name} » avec les composants du DS, en suivant l'arbre des calques ci-dessous : chaque Auto Layout est une boîte flex (direction, gap, padding, align, justify, wrap, width/height : hug = ajusté au contenu, fill = extensible, nombre = fixe en px ; « adaptation » = réglages propres à mobile < 600 px, tablette < 1024 px, desktop, en media queries), chaque Groupe une simple boîte qui regroupe ; « taille » règle un calque dans son Auto Layout, « style » son fond (variable CSS d'un token) et son arrondi ; garde l'ordre et les props, et réutilise les composants codés (file) sans les recoder. La page vit à la route ${page.path} du projet : rends-la accessible à cette adresse sans casser l'existant. Les interactions « au_clic_aller_a » ouvrent la route indiquée : code cette navigation.`,
      focus: {
        page: 'preview',
        kind: 'page',
        name: page.name,
        path: [page.name],
        source: 'page-build',
        value: page.id,
        props: { format: `${screen.width}px` },
      },
    });

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

  // Calque replié dans les calques : ses enfants sont masqués.
  const hidden = (parent: string | null): boolean => {
    let p = parent;
    while (p) {
      if (collapsed.includes(p)) return true;
      p = findNode(plan, p)?.parent?.id ?? null;
    }
    return false;
  };
  // Dépôt dans les calques : avant, après, ou dedans (au milieu d'un Groupe ou d'un Auto Layout).
  const dropWhere = (e: React.DragEvent, box: boolean): 'before' | 'after' | 'inside' => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    return box && y > 0.3 && y < 0.7 ? 'inside' : y < 0.5 ? 'before' : 'after';
  };
  const q = query.trim().toLowerCase();
  // Recherche dans les calques : ceux dont le nom correspond, et leurs parents.
  const lq = layerQuery.trim().toLowerCase();
  const matching = new Set<string>();
  if (lq)
    for (const f of flatten(plan))
      if (labelOf(f.node).toLowerCase().includes(lq)) {
        matching.add(f.node.id);
        let p = f.parent;
        while (p) {
          matching.add(p);
          p = findNode(plan, p)?.parent?.id ?? null;
        }
      }
  const levels = panelSelection.map((g) => g.level);
  const shown: [number, number] = medium ? [Math.min(widths[0], 208), Math.min(widths[1], 232)] : widths;
  const columns = narrow
    ? 'minmax(0, 1fr)'
    : `${left ? `${shown[0]}px 6px` : ''} minmax(0, 1fr) ${right ? `6px ${shown[1]}px` : ''}`;
  const detailSpecs = item ? specsOf(item.entry) : undefined;
  const currentSpecs = currentComp ? specsOf(currentComp) : undefined;

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
          ☰ Calques
        </button>
        <div className="build-segment" role="group" aria-label="Mode">
          <button type="button" aria-pressed={!testing} onClick={() => setTesting(false)} title="Sélectionner et modifier">
            Modifier
          </button>
          <button type="button" aria-pressed={testing} onClick={() => setTesting(true)} title="Proto fictif : cliquer et naviguer comme dans l’app, avant le Build">
            Essayer le proto fictif
          </button>
        </div>
        <div className="build-history-actions" role="group" aria-label="Historique de la composition">
        <button type="button" className="build-tool" onClick={undo} disabled={!past.length} title="Annuler (⌘Z)" aria-label="Annuler">
          ↶
        </button>
        <button type="button" className="build-tool" onClick={redo} disabled={!future.length} title="Rétablir (⇧⌘Z)" aria-label="Rétablir">
          ↷
        </button>
        </div>
        <span className="build-spacer" />
        <button
          type="button"
          className="studio-primary build-code-action"
          onClick={build}
          disabled={!plan.instances.length}
          title={toCode.length ? `D'abord les composants : ${toCode.join(', ')}` : 'Clodo code la page et sa navigation'}
        >
          Préparer le code{toCode.length ? ` · ${toCode.length} à coder` : ''}
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

      <div
        ref={body}
        className="build-body"
        style={{ gridTemplateColumns: columns, ['--build-h' as string]: `${fitted}px` }}
      >
        {left && (
          <aside id="build-library" className="build-side build-left" aria-label="Calques et composants">
            <div className="build-side-head build-tabs">
              <div role="tablist" aria-label="Panneau de gauche">
                <button type="button" role="tab" aria-selected={tab === 'layers'} onClick={() => setTab('layers')}>
                  Calques
                </button>
                <button type="button" role="tab" aria-selected={tab === 'components'} onClick={() => setTab('components')}>
                  Composants
                </button>
              </div>
              <button type="button" className="build-close" onClick={() => setLeft(false)} aria-label="Réduire le panneau" title="Réduire">
                ‹
              </button>
            </div>
            {tab === 'layers' ? (
              <>
              <input
                ref={search}
                type="search"
                className="build-search"
                placeholder="Rechercher un calque  /"
                aria-label="Rechercher un calque"
                value={layerQuery}
                onChange={(e) => setLayerQuery(e.target.value)}
              />
            <section className="build-group">
              <div className="build-layer-tools">
                <span className="build-group-head">{page.name}</span>
                <button type="button" onClick={() => setTab('components')} title="Ajouter un composant" aria-label="Ajouter un composant">
                  +
                </button>
                <button type="button" onClick={() => wrap('group')} disabled={!selected} title="Grouper (⌘G)" aria-label="Grouper">
                  ▢
                </button>
                <button type="button" onClick={() => wrap('autolayout')} disabled={!selected} title="Auto Layout (⇧A)" aria-label="Auto Layout">
                  ⇥
                </button>
              </div>
              {!plan.instances.length && (
                <p className="build-empty">Page vide : glisse un composant ou clique sur +.</p>
              )}
              <ol className="build-layers" aria-label="Calques">
                {flatten(plan)
                  .filter((f) => (lq ? matching.has(f.node.id) : !hidden(f.parent)))
                  .map(({ node: n, depth }) => {
                    const box = isContainer(n);
                    const open = box && !collapsed.includes(n.id);
                    const isSel = n.id === selected || multi.includes(n.id);
                    return (
                      <li
                        key={n.id}
                        className={dropOn?.id === n.id ? `build-drop-${dropOn.where}` : undefined}
                        draggable={renaming !== n.id}
                        onDragStart={(e) => {
                          e.stopPropagation();
                          e.dataTransfer.setData('text/ds-layer', n.id);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDropOn({ id: n.id, where: dropWhere(e, box) });
                        }}
                        onDragLeave={() => setDropOn(undefined)}
                        onDrop={(e) => {
                          e.preventDefault();
                          const where = dropWhere(e, box);
                          setDropOn(undefined);
                          const moved = e.dataTransfer.getData('text/ds-layer');
                          const added = e.dataTransfer.getData('text/ds-component');
                          const at = findNode(plan, n.id)!;
                          const parent = where === 'inside' ? n.id : (at.parent?.id ?? null);
                          const index =
                            where === 'inside' ? (box ? n.children.length : 0) : at.index + (where === 'after' ? 1 : 0);
                          if (moved && moved !== n.id) {
                            const from = findNode(plan, moved);
                            // Même parent, plus bas : l'index se décale d'un cran.
                            const shift = from && (from.parent?.id ?? null) === parent && from.index < index ? 1 : 0;
                            save(moveInstance(plan, moved, index - shift, parent));
                          } else if (added) add(JSON.parse(added) as Entry, index, {}, parent);
                        }}
                      >
                        <div
                          className="build-layer"
                          style={{ paddingLeft: 4 + depth * 14 }}
                          aria-selected={isSel}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setSelected(n.id);
                            setMulti([]);
                            setMenu({ id: n.id, x: e.clientX, y: e.clientY });
                          }}
                        >
                          {box ? (
                            <button
                              type="button"
                              className="build-twist"
                              aria-label={open ? 'Réduire' : 'Développer'}
                              aria-expanded={open}
                              onClick={() =>
                                setCollapsed((c) => (open ? [...c, n.id] : c.filter((x) => x !== n.id)))
                              }
                            >
                              {open ? '▾' : '▸'}
                            </button>
                          ) : (
                            <span className="build-twist" />
                          )}
                          <span className="build-kind" aria-hidden="true" title={kindLabel(n)}>
                            {!box ? '◇' : n.type === 'group' ? '▢' : n.layout.direction === 'row' ? '⇥' : '⤓'}
                          </span>
                          {renaming === n.id ? (
                            <input
                              autoFocus
                              className="build-rename"
                              defaultValue={labelOf(n)}
                              aria-label="Nom du calque"
                              onBlur={(e) => {
                                setRenaming(undefined);
                                if (e.target.value.trim() !== labelOf(n)) save(renameNode(plan, n.id, e.target.value));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                                if (e.key === 'Escape') setRenaming(undefined);
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className="build-layer-name"
                              aria-pressed={isSel}
                              title={`${labelOf(n)} · ${kindLabel(n)} · double-clic pour renommer`}
                              onClick={(e) => {
                                setInspected(undefined);
                                if (e.shiftKey && selected && n.id !== selected)
                                  setMulti((m) => (m.includes(n.id) ? m.filter((x) => x !== n.id) : [...m, n.id]));
                                else {
                                  setSelected(n.id);
                                  setMulti([]);
                                }
                              }}
                              onDoubleClick={() => setRenaming(n.id)}
                            >
                              <span className="build-layer-label">{labelOf(n)}</span>
                              {n.link && (
                                <small className="build-link">→ {pages.find((x) => x.id === n.link)?.name ?? 'page'}</small>
                              )}
                            </button>
                          )}
                          <span className="build-layer-actions">
                            <button type="button" onClick={() => duplicateId(n.id)} title="Dupliquer (⌘D)" aria-label={`Dupliquer ${labelOf(n)}`}>
                              ⧉
                            </button>
                            <button type="button" onClick={() => removeId(n.id)} title="Supprimer (⌫)" aria-label={`Supprimer ${labelOf(n)}`}>
                              ✕
                            </button>
                          </span>
                        </div>
                      </li>
                    );
                  })}
              </ol>
              {hint && <p className="build-empty">{hint}</p>}
            </section>
              </>
            ) : item ? (
              <>
                <div className="build-fiche-head">
                  <button type="button" onClick={() => setInspected(undefined)} title="Retour aux composants (Échap)">
                    ← Composants
                  </button>
                  <strong>{item.name}</strong>
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
            <button type="button" className="studio-primary" onClick={() => add(item.entry, undefined, draft)}>
              Ajouter à la page
            </button>
              </>
            ) : (
              <>
              <input
                ref={search}
                type="search"
                className="build-search"
                placeholder="Rechercher un composant  /"
                aria-label="Rechercher un composant"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
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
              </>
            )}
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
            {multi.length > 0 ? (
              <>
                <p className="build-title">{multi.length + 1} calques sélectionnés</p>
                <div className="build-icons">
                  <button type="button" onClick={() => wrap('group')} title="Grouper (⌘G)">
                    ▢ Grouper
                  </button>
                  <button type="button" onClick={() => wrap('autolayout')} title="Auto Layout (⇧A)">
                    ⇥ Auto Layout
                  </button>
                </div>
                {hint && <p className="build-empty">{hint}</p>}
              </>
            ) : current ? (
              <>
                <div className="build-prop-head">
                  <p className="build-title" title={labelOf(current)}>{labelOf(current)}</p>
                  <small>{kindLabel(current)}</small>
                </div>
                <div className="build-icons" role="toolbar" aria-label="Actions du calque">
                  <button type="button" onClick={() => move(-1)} disabled={!found || found.index === 0} title="Monter (⌥↑)" aria-label="Monter">↑</button>
                  <button type="button" onClick={() => move(1)} disabled={!found || found.index === found.siblings.length - 1} title="Descendre (⌥↓)" aria-label="Descendre">↓</button>
                  <button type="button" onClick={duplicate} title="Dupliquer (⌘D)" aria-label="Dupliquer">⧉</button>
                  {isContainer(current) ? (
                    <>
                      <button type="button" onClick={convert} title={current.type === 'group' ? 'Transformer en Auto Layout' : 'Transformer en Groupe'} aria-label={current.type === 'group' ? 'Transformer en Auto Layout' : 'Transformer en Groupe'}>⇄</button>
                      <button type="button" onClick={unwrap} title="Dégrouper (⇧⌘G)" aria-label="Dégrouper">⊟</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => wrap('group')} title="Grouper (⌘G)" aria-label="Grouper">▢</button>
                      <button type="button" onClick={() => wrap('autolayout')} title="Auto Layout (⇧A)" aria-label="Auto Layout">⇥</button>
                    </>
                  )}
                  <button type="button" onClick={remove} title="Supprimer (⌫)" aria-label="Supprimer">✕</button>
                </div>
                {currentComp && (
                  <Section title="Composant">
                    {(currentSpecs ?? []).map((s) => (
                      <PropControl
                        key={s.name}
                        spec={s}
                        value={currentComp.props[s.name]}
                        onChange={(v) => save(setProp(plan, currentComp.id, s.name, v))}
                      />
                    ))}
                    {currentSpecs?.length === 0 && <p className="build-empty">Aucune propriété réglable.</p>}
                  </Section>
                )}
                {isContainer(current) && current.type === 'autolayout' ? (
                  <LayoutControls
                    layout={layoutOn(current.layout, current.adapt, screenDevice)}
                    spacing={tokens.spacing}
                    onChange={layout}
                  />
                ) : (
                  <Section title="Dimensions">
                    <SizeControl label="Largeur" axis="width" value={(current as { size?: Sizing }).size?.width} onChange={(v) => save(setSize(plan, current.id, { width: v }))} />
                    <SizeControl label="Hauteur" axis="height" value={(current as { size?: Sizing }).size?.height} onChange={(v) => save(setSize(plan, current.id, { height: v }))} />
                    {found?.parent?.type !== 'autolayout' && (
                      <p className="build-empty">« Extensible » agit dans un Auto Layout.</p>
                    )}
                  </Section>
                )}
                {isContainer(current) && current.type === 'group' && (
                  <p className="build-empty">Un Groupe organise des calques sans les disposer : ⇄ le transforme en Auto Layout.</p>
                )}
                {isContainer(current) && (
                  <Section title="Styles">
                    <label className="build-prop">
                      <span>Fond</span>
                      <span className="build-swatch-row">
                        <i
                          className="build-swatch"
                          style={{ background: tokens.colors.find((c) => c.css === current.style?.fill)?.value ?? 'transparent' }}
                        />
                        <select
                          value={current.style?.fill ?? ''}
                          onChange={(e) => save(setStyle(plan, current.id, { fill: e.target.value || undefined }))}
                        >
                          <option value="">Aucun</option>
                          {tokens.colors.map((c) => (
                            <option key={c.key} value={c.css}>
                              {c.key} · {c.value}
                            </option>
                          ))}
                        </select>
                      </span>
                    </label>
                    <NumberField
                      label="Arrondi"
                      value={current.style?.radius ?? 0}
                      suggestions={tokens.radius}
                      onChange={(v) => save(setStyle(plan, current.id, { radius: v || undefined }))}
                    />
                  </Section>
                )}
                {isContainer(current) && current.type === 'autolayout' && (
                  <Section title="Adaptation" closed>
                    <label className="build-check build-prop">
                      <input
                        type="checkbox"
                        checked={adaptOn}
                        onChange={(e) =>
                          save(
                            e.target.checked
                              ? setLayout(plan, current.id, {}, screenDevice)
                              : clearAdapt(plan, current.id, screenDevice),
                          )
                        }
                      />
                      <span>
                        Réglages propres à {deviceName[screenDevice]}
                        <small>
                          {adaptOn
                            ? `Disposition, espacements, alignement et dimensions ne changent que sur ${deviceName[screenDevice]}.`
                            : `Change de format (iPhone, Tablette, Desktop) pour régler un autre appareil.`}
                        </small>
                      </span>
                    </label>
                    {Object.keys(current.adapt ?? {}).length > 0 && (
                      <p className="build-empty">
                        Réglages propres : {Object.keys(current.adapt ?? {}).map((d) => deviceName[d as keyof typeof deviceName]).join(', ')}
                      </p>
                    )}
                  </Section>
                )}
                <Section title="Interactions" closed={!current.link}>
                  <label className="build-prop">
                    <span>
                      Au clic
                      <small>Codée au Build ; essaie-la en mode Tester.</small>
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
                </Section>
                <Section title="Détails techniques" closed>
                  <p className="build-file">
                    {currentComp
                      ? (currentComp.file ?? `Maquette Figma ${currentComp.figma ?? ''} · codée au Build`)
                      : `${kindLabel(current)} · ${isContainer(current) ? current.children.length : 0} calque(s)`}
                  </p>
                  <p className="build-file">Identifiant : {current.id}</p>
                </Section>
              </>
            ) : (
              <p className="build-empty">
                Sélectionne un calque dans la page ou les calques ; ⇧ clic pour en sélectionner plusieurs.
                <br />
                <kbd>⌘G</kbd> grouper · <kbd>⇧A</kbd> Auto Layout · <kbd>⇧⌘G</kbd> dégrouper · <kbd>⌘Z</kbd> annuler · <kbd>⌘D</kbd> dupliquer · <kbd>⌫</kbd> supprimer · <kbd>⌥↑↓</kbd> déplacer · <kbd>/</kbd> rechercher
              </p>
            )}
          </aside>
        )}
      </div>
      {menu && (
        <ul
          className="build-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(() => {
            const n = findNode(plan, menu.id)?.node;
            if (!n) return null;
            const item = (label: string, keys: string, run: () => void, off = false) => (
              <li key={label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  disabled={off}
                  onClick={() => {
                    setMenu(undefined);
                    run();
                  }}
                >
                  <span>{label}</span>
                  <kbd>{keys}</kbd>
                </button>
              </li>
            );
            return [
              item('Renommer', '2× clic', () => setRenaming(n.id)),
              item('Dupliquer', '⌘D', () => duplicateId(n.id)),
              item('Grouper', '⌘G', () => wrap('group')),
              item('Ajouter un Auto Layout', '⇧A', () => wrap('autolayout')),
              ...(isContainer(n)
                ? [
                    item(n.type === 'group' ? 'Transformer en Auto Layout' : 'Transformer en Groupe', '', convert),
                    item('Dégrouper', '⇧⌘G', unwrap),
                  ]
                : []),
              item('Monter', '⌥↑', () => move(-1), !found || found.index === 0),
              item('Descendre', '⌥↓', () => move(1), !found || found.index === found.siblings.length - 1),
              item('Supprimer', '⌫', () => removeId(n.id)),
            ];
          })()}
        </ul>
      )}
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

const kindLabel = (n: Node) =>
  !isContainer(n) ? 'Composant' : n.type === 'group' ? 'Groupe' : 'Auto Layout';

type Tokens = { colors: { key: string; css: string; value: string }[]; spacing: number[]; radius: number[] };
const deviceName = { mobile: 'mobile', tablet: 'tablette', desktop: 'desktop' } as const;

// Section repliable du panneau Propriétés ; son état reste d'une sélection à l'autre.
function Section({ title, closed, children }: { title: string; closed?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(() => stored(`section:${title}`, !closed));
  return (
    <section className="build-section">
      <button
        type="button"
        className="build-section-head"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          store(`section:${title}`, !open);
        }}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {title}
      </button>
      {open && <div className="build-section-body">{children}</div>}
    </section>
  );
}
// Champ de valeur en px, avec les valeurs de tes tokens proposées.
function NumberField({
  label,
  value,
  suggestions,
  onChange,
}: {
  label: string;
  value: number;
  suggestions: number[];
  onChange: (v: number) => void;
}) {
  const list = `build-list-${label.replace(/\W/g, '')}`;
  return (
    <label className="build-prop build-num">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={400}
        list={suggestions.length ? list : undefined}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(400, Math.round(Number(e.target.value) || 0))))}
      />
      {suggestions.length > 0 && (
        <datalist id={list}>
          {suggestions.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      )}
    </label>
  );
}
function SizeControl({
  label,
  axis,
  value,
  onChange,
}: {
  label: string;
  axis: 'width' | 'height';
  value: Size | undefined;
  onChange: (v: Size) => void;
}) {
  const mode = typeof value === 'number' ? 'fixed' : (value ?? 'hug');
  return (
    <label className="build-prop build-size">
      <span>{label}</span>
      <span className="build-size-row">
        <select
          value={mode}
          onChange={(e) => onChange(e.target.value === 'fixed' ? (axis === 'width' ? 320 : 200) : (e.target.value as Size))}
        >
          <option value="hug">Ajustée</option>
          <option value="fill">Extensible</option>
          <option value="fixed">Fixe</option>
        </select>
        {typeof value === 'number' && (
          <input
            type="number"
            min={1}
            max={4000}
            value={value}
            aria-label={`${label} fixe en px`}
            onChange={(e) => onChange(Math.max(1, Math.min(4000, Math.round(Number(e.target.value) || 1))))}
          />
        )}
      </span>
    </label>
  );
}
// Alignement en grille, comme dans Figma : la case choisie place les
// éléments ; « Répartie » les étale sur l'axe principal.
function AlignGrid({ layout, onChange }: { layout: Layout; onChange: (p: Partial<Layout>) => void }) {
  const steps = ['start', 'center', 'end'] as const;
  const row = layout.direction === 'row';
  return (
    <div className="build-align" role="group" aria-label="Alignement">
      {steps.map((v) =>
        steps.map((h) => {
          const main = row ? h : v;
          const cross = row ? v : h;
          const on =
            (layout.justify === main || (layout.justify === 'space-between' && main === 'start')) &&
            (layout.align === cross || (layout.align === 'stretch' && cross === 'start'));
          return (
            <button
              key={`${v}-${h}`}
              type="button"
              aria-pressed={on}
              aria-label={`${{ start: 'Haut', center: 'Milieu', end: 'Bas' }[v]} ${{ start: 'gauche', center: 'centre', end: 'droite' }[h]}`}
              title={`${{ start: 'Haut', center: 'Milieu', end: 'Bas' }[v]} ${{ start: 'gauche', center: 'centre', end: 'droite' }[h]}`}
              // Répartie et Étirer restent : la case règle l'autre axe.
              onClick={() =>
                onChange({
                  justify: layout.justify === 'space-between' ? 'space-between' : main,
                  align: layout.align === 'stretch' ? 'stretch' : cross,
                })
              }
            >
              <i />
            </button>
          );
        }),
      )}
    </div>
  );
}

// Disposition d'un Auto Layout : direction, espacements, alignement,
// dimensions. Chaque réglage change le canvas tout de suite.
function LayoutControls({
  layout,
  spacing,
  onChange,
}: {
  layout: Layout;
  spacing: number[];
  onChange: (p: Partial<Layout>) => void;
}) {
  const sameSides = layout.padding.every((p) => p === layout.padding[0]);
  const [split, setSplit] = useState(!sameSides);
  return (
    <>
      <Section title="Disposition">
        <div className="build-segment" role="group" aria-label="Direction">
          <button type="button" aria-pressed={layout.direction === 'column'} onClick={() => onChange({ direction: 'column' })} title="Vertical">
            ⤓ Vertical
          </button>
          <button type="button" aria-pressed={layout.direction === 'row'} onClick={() => onChange({ direction: 'row' })} title="Horizontal">
            ⇥ Horizontal
          </button>
        </div>
        <label className="build-check build-prop">
          <input type="checkbox" checked={layout.wrap} onChange={(e) => onChange({ wrap: e.target.checked })} />
          <span>Retour à la ligne</span>
        </label>
      </Section>
      <Section title="Espacements">
        <NumberField label="Entre les éléments" value={layout.gap} suggestions={spacing} onChange={(gap) => onChange({ gap })} />
        {!split ? (
          <NumberField
            label="Intérieurs"
            value={layout.padding[0]}
            suggestions={spacing}
            onChange={(v) => onChange({ padding: [v, v, v, v] })}
          />
        ) : (
          <div className="build-sides">
            {(['Haut', 'Droite', 'Bas', 'Gauche'] as const).map((side, i) => (
              <NumberField
                key={side}
                label={side}
                value={layout.padding[i]}
                suggestions={spacing}
                onChange={(v) => {
                  const next = [...layout.padding] as Layout['padding'];
                  next[i] = v;
                  onChange({ padding: next });
                }}
              />
            ))}
          </div>
        )}
        <button type="button" className="build-link-button" onClick={() => setSplit(!split)}>
          {split ? 'Mêmes intérieurs partout' : 'Intérieurs par côté'}
        </button>
      </Section>
      <Section title="Alignement">
        <div className="build-align-row">
          <AlignGrid layout={layout} onChange={onChange} />
          <div className="build-align-options">
            <label className="build-check build-prop">
              <input
                type="checkbox"
                checked={layout.justify === 'space-between'}
                onChange={(e) => onChange({ justify: e.target.checked ? 'space-between' : 'start' })}
              />
              <span>Répartie</span>
            </label>
            <label className="build-check build-prop">
              <input
                type="checkbox"
                checked={layout.align === 'stretch'}
                onChange={(e) => onChange({ align: e.target.checked ? 'stretch' : 'start' })}
              />
              <span>Étirer</span>
            </label>
          </div>
        </div>
      </Section>
      <Section title="Dimensions">
        <SizeControl label="Largeur" axis="width" value={layout.width} onChange={(width) => onChange({ width })} />
        <SizeControl label="Hauteur" axis="height" value={layout.height} onChange={(height) => onChange({ height })} />
      </Section>
    </>
  );
}

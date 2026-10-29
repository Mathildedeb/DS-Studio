// Relais de la Preview dans le projet ouvert : une page de développement
// (ds-studio.html) qui affiche le plan de page avec les vrais composants du
// projet, chargés par Vite. DS-Studio lui envoie le plan par postMessage ; elle
// renvoie le clic (sélection) et la position des instances (dépôt).
// Hors de index.html, Vite ne l'inclut pas dans le build de production.
export const bridgeHtml = 'ds-studio.html';
export const bridgeEntry = 'src/ds-studio/canvas.tsx';
// Marque de version du relais : un relais plus ancien est proposé en mise à jour.
export const bridgeMark = 'Relais DS-Studio v7';

// Même <head> que index.html (polices…), avec le relais comme script.
export function bridgeFiles(indexHtml: string, mainSource: string) {
  const html = /<script[^>]*type="module"[^>]*src="[^"]*"[^>]*><\/script>/.test(indexHtml)
    ? indexHtml.replace(
        /<script[^>]*type="module"[^>]*src="[^"]*"[^>]*><\/script>/,
        `<script type="module" src="/${bridgeEntry}"></script>`,
      )
    : `<!doctype html>\n<html lang="fr">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/${bridgeEntry}"></script>\n  </body>\n</html>\n`;
  // Les styles globaux du projet, comme dans son point d'entrée.
  const styles = [...mainSource.matchAll(/^import\s+['"]\.\/([^'"]+\.css)['"]/gm)]
    .map((m) => `import '../${m[1]}'`)
    .join('\n');
  const canvas = `// ${bridgeMark} (développement seulement) : affiche le plan de page de la
// Preview avec les vrais composants du projet, et les composants du DS pas
// encore codés en maquette Figma (codés au Build). Généré par DS-Studio.
import { StrictMode, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type MouseEvent as ClickEvent, type PointerEvent as PressEvent, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
${styles}

type Value = string | number | boolean
type Size = 'hug' | 'fill' | number
type Instance = {
  id: string
  name?: string
  component: string
  file?: string
  // Page ouverte au clic, en mode Tester.
  link?: string
  props: Record<string, Value>
  size?: { width?: Size; height?: Size }
  // Maquette Figma (rendu PNG à l'échelle 2), tant que le composant n'est pas codé.
  image?: string
}
type Layout = {
  direction: 'row' | 'column'
  gap: number
  padding: [number, number, number, number]
  align: 'start' | 'center' | 'end' | 'stretch'
  justify: 'start' | 'center' | 'end' | 'space-between'
  wrap: boolean
  width: Size
  height: Size
}
// Calque : un composant, un Groupe (organise) ou un Auto Layout (dispose).
type Device = 'mobile' | 'tablet' | 'desktop'
type Container = {
  id: string
  name?: string
  type: 'group' | 'autolayout'
  link?: string
  layout?: Layout
  // Réglages propres à un appareil, appliqués selon la largeur de l'écran.
  adapt?: Partial<Record<Device, Partial<Layout>>>
  size?: { width?: Size; height?: Size }
  style?: { fill?: string; radius?: number }
  children: Node[]
}
type Node = Instance | Container
const isContainer = (n: Node): n is Container => 'type' in n
const labelOf = (n: Node) => n.name ?? (isContainer(n) ? (n.type === 'group' ? 'Groupe' : 'Auto Layout') : n.component)
// Où est un calque : lui, ses voisins et la direction de son parent.
const locate = (
  nodes: Node[],
  id: string,
  dir: 'row' | 'column' = 'column',
  device: Device = 'mobile',
): { node: Node; siblings: Node[]; dir: 'row' | 'column' } | undefined => {
  for (const n of nodes) {
    if (n.id === id) return { node: n, siblings: nodes, dir }
    if (isContainer(n)) {
      const l = n.layout ? { ...n.layout, ...(n.adapt?.[device] ?? {}) } : undefined
      const found = locate(n.children, id, l ? l.direction : 'column', device)
      if (found) return found
    }
  }
  return undefined
}
type Draft = { id: string; layout?: Partial<Layout>; size?: { width?: number; height?: number } }
type Box = { left: number; top: number; width: number; height: number }
const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}
const pink = 'rgba(255, 64, 129, 0.22)'
const violet = '#8A38F5'

// Tous les composants du projet : chaque instance utilise le vrai composant.
const modules = import.meta.glob('../components/**/*.{tsx,jsx}', { eager: true }) as Record<
  string,
  { default?: ComponentType<Record<string, Value>> }
>
const byFile = Object.fromEntries(
  Object.entries(modules).map(([path, module]) => [
    'src/components/' + path.slice('../components/'.length),
    module.default,
  ]),
)
const flex = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', 'space-between': 'space-between' }
// Taille d'un calque selon la direction de son parent : « extensible »
// prend la place restante sur l'axe principal, s'étire sur l'autre.
const sized = (width: Size | undefined, height: Size | undefined, parent: 'row' | 'column' | 'page') => {
  const style: Record<string, string | number> = {}
  if (typeof width === 'number') style.width = width
  if (typeof height === 'number') style.height = height
  if (width === 'fill') {
    if (parent === 'row') Object.assign(style, { flex: '1 1 0', minWidth: 0 })
    else if (parent === 'page') style.justifySelf = 'stretch'
    else style.alignSelf = 'stretch'
  } else if (parent === 'page') style.justifySelf = 'start'
  if (height === 'fill') {
    if (parent === 'column') Object.assign(style, { flex: '1 1 0', minHeight: 0 })
    else style.alignSelf = 'stretch'
  }
  return style
}

function Canvas() {
  const [instances, setInstances] = useState<Node[]>([])
  const [selected, setSelected] = useState<string>()
  const [multi, setMulti] = useState<string[]>([])
  // Safe areas de l'appareil (status bar, barre d'accueil) et mode Tester :
  // sans sélection, les composants réagissent comme dans l'application.
  const [insets, setInsets] = useState({ top: 0, bottom: 0 })
  const [interactive, setInteractive] = useState(false)
  const [device, setDevice] = useState<Device>('mobile')
  // Survol, et réglage en cours à la souris (montré avant d'être envoyé).
  const [hovered, setHovered] = useState<string>()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const again = () => setTick((t) => t + 1)
    addEventListener('scroll', again, true)
    addEventListener('resize', again)
    return () => {
      removeEventListener('scroll', again, true)
      removeEventListener('resize', again)
    }
  }, [])
  useEffect(() => {
    const pick = () => setDevice(innerWidth < 600 ? 'mobile' : innerWidth < 1024 ? 'tablet' : 'desktop')
    pick()
    addEventListener('resize', pick)
    return () => removeEventListener('resize', pick)
  }, [])
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'ds-studio:page') return
      setInstances(event.data.instances)
      setSelected(event.data.selected)
      setMulti(event.data.multi ?? [])
      setInsets(event.data.insets ?? { top: 0, bottom: 0 })
      setInteractive(!!event.data.interactive)
    }
    // Raccourcis de l'éditeur, même quand le clic a donné le focus à la page.
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      parent.postMessage(
        { type: 'ds-studio:key', key: event.key, meta: event.metaKey || event.ctrlKey, shift: event.shiftKey, alt: event.altKey },
        '*',
      )
    }
    addEventListener('message', onMessage)
    addEventListener('keydown', onKey)
    parent.postMessage({ type: 'ds-studio:ready' }, '*')
    return () => {
      removeEventListener('message', onMessage)
      removeEventListener('keydown', onKey)
    }
  }, [])
  // Position des calques de premier niveau, pour placer un composant glissé.
  useEffect(() => {
    const rects = [...document.querySelectorAll<HTMLElement>('[data-ds-root]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { id: el.dataset.dsId, top: r.top, bottom: r.bottom }
    })
    parent.postMessage({ type: 'ds-studio:rects', rects }, '*')
  })
  const mark = (id: string) =>
    interactive
      ? undefined
      : id === selected
        ? '2px solid #8A38F5'
        : multi.includes(id)
          ? '2px dashed #8A38F5'
          : undefined
  const select = (id: string, event: ClickEvent) =>
    parent.postMessage({ type: 'ds-studio:select', id, shift: event.shiftKey }, '*')

  const render = (node: Node, within: 'row' | 'column' | 'page'): ReactElement => {
    const root = within === 'page'
    if (isContainer(node)) {
      const base = node.layout ? { ...node.layout, ...(node.adapt?.[device] ?? {}) } : undefined
      const d = draft?.id === node.id ? draft : null
      const l = base ? { ...base, ...(d?.layout ?? {}), ...(d?.size ?? {}) } : undefined
      const gsize = { ...node.size, ...(d?.size ?? {}) }
      return (
        <div
          key={node.id}
          data-ds-id={node.id}
          data-ds-root={root || undefined}
          onMouseOver={(event) => {
            event.stopPropagation()
            setHovered(node.id)
          }}
          onClick={(event) => {
            event.stopPropagation()
            if (interactive) {
              if (node.link) window.parent.postMessage({ type: 'ds-studio:navigate', page: node.link }, '*')
              return
            }
            select(node.id, event)
          }}
          style={{
            boxSizing: 'border-box',
            ...(l
              ? {
                  display: 'flex',
                  flexDirection: l.direction,
                  flexWrap: l.wrap ? 'wrap' : 'nowrap',
                  gap: l.gap,
                  padding: l.padding.map((p) => p + 'px').join(' '),
                  alignItems: flex[l.align],
                  justifyContent: flex[l.justify],
                  ...sized(l.width, l.height, within),
                }
              : { display: 'grid', justifyItems: 'start', ...sized(gsize.width, gsize.height, within) }),
            ...(node.style?.fill ? { background: \`var(\${node.style.fill})\` } : {}),
            ...(node.style?.radius !== undefined ? { borderRadius: node.style.radius } : {}),
            cursor: interactive ? (node.link ? 'pointer' : undefined) : 'pointer',
            outline:
              mark(node.id) ??
              (interactive ? undefined : hovered === node.id ? '1px solid rgba(138, 56, 245, 0.8)' : '1px dashed rgba(138, 56, 245, 0.3)'),
            outlineOffset: 2,
          }}
        >
          {node.children.map((child) => render(child, l ? l.direction : 'column'))}
        </div>
      )
    }
    const Component = node.file ? byFile[node.file] : undefined
    const csize = { ...node.size, ...(draft?.id === node.id ? (draft.size ?? {}) : {}) }
    return (
      <div
        key={node.id}
        data-ds-id={node.id}
        data-ds-root={root || undefined}
        onMouseOver={(event) => {
          event.stopPropagation()
          setHovered(node.id)
        }}
        onClickCapture={(event) => {
          if (interactive) {
            if (node.link) window.parent.postMessage({ type: 'ds-studio:navigate', page: node.link }, '*')
            return
          }
          event.preventDefault()
          event.stopPropagation()
          select(node.id, event)
        }}
        style={{
          ...sized(csize.width, csize.height, within),
          cursor: interactive ? undefined : 'pointer',
          outline: mark(node.id) ?? (!interactive && hovered === node.id ? '1px solid rgba(138, 56, 245, 0.8)' : undefined),
          outlineOffset: 4,
          borderRadius: 4,
        }}
      >
        {Component ? (
          <Component {...node.props} />
        ) : node.image ? (
          <img
            src={node.image}
            alt={node.component + ' (maquette Figma)'}
            onLoad={(event) => {
              const img = event.currentTarget
              img.width = img.naturalWidth / 2
            }}
            style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
          />
        ) : (
          <p
            style={{
              margin: 0,
              padding: '12px 16px',
              border: '1px dashed currentColor',
              borderRadius: 4,
              opacity: 0.7,
            }}
          >
            {node.file ? 'Composant introuvable : ' + node.file : node.component + ' · maquette'}
          </p>
        )}
      </div>
    )
  }
  // Poignées de la sélection : mesurées sur la page rendue, dans le même
  // document que les vrais composants.
  const box = useRef<HTMLDivElement>(null)
  const [geo, setGeo] = useState<Geometry | null>(null)
  useLayoutEffect(() => {
    const el = selected && !interactive ? document.querySelector('[data-ds-id="' + selected + '"]') : null
    const at = selected ? locate(instances, selected, 'column', device) : undefined
    let next: Geometry | null = null
    if (el && at) {
      const css = getComputedStyle(el)
      const kids = [...el.children].filter((c) => (c as HTMLElement).dataset.dsId).map(boxOf)
      next = {
        rect: boxOf(el),
        padding: [css.paddingTop, css.paddingRight, css.paddingBottom, css.paddingLeft].map((v) => parseFloat(v) || 0) as Geometry['padding'],
        kids,
        dir: css.flexDirection === 'row' ? 'row' : 'column',
        flex: css.display === 'flex',
        parentDir: at.dir,
        siblings: at.siblings.map((n) => {
          const s = document.querySelector('[data-ds-id="' + n.id + '"]')
          return { id: n.id, box: s ? boxOf(s) : null }
        }),
        label: labelOf(at.node),
        layout: isContainer(at.node) && at.node.layout ? { ...at.node.layout, ...(at.node.adapt?.[device] ?? {}) } : null,
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(geo)) setGeo(next)
  })
  // Glisser une poignée : aperçu immédiat, puis le réglage part à DS-Studio.
  const drag = (event: PressEvent, onMove: (dx: number, dy: number, alt: boolean) => Draft | null, onDone: (d: Draft) => void) => {
    event.preventDefault()
    event.stopPropagation()
    const x0 = event.clientX
    const y0 = event.clientY
    let last: Draft | null = null
    const move = (e: PointerEvent) => {
      last = onMove(e.clientX - x0, e.clientY - y0, e.altKey)
      setDraft(last)
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      if (last) onDone(last)
      setTimeout(() => setDraft(null), 50)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }
  const clamp = (v: number) => Math.max(0, Math.min(400, Math.round(v)))
  const sendLayout = (d: Draft) => window.parent.postMessage({ type: 'ds-studio:layout', id: d.id, patch: d.layout }, '*')
  const sendSize = (d: Draft) => window.parent.postMessage({ type: 'ds-studio:size', id: d.id, patch: d.size }, '*')
  const [moving, setMoving] = useState<{ line: Box; to: number } | null>(null)
  const startMove = (event: PressEvent) => {
    if (!geo || !selected) return
    event.preventDefault()
    event.stopPropagation()
    const others = geo.siblings.filter((s) => s.id !== selected && s.box)
    const row = geo.parentDir === 'row'
    const place = (x: number, y: number) => {
      const pos = row ? x : y
      const to = others.filter((s) => (row ? s.box!.left + s.box!.width / 2 : s.box!.top + s.box!.height / 2) < pos).length
      const ref = others[to]?.box ?? others[to - 1]?.box ?? geo.rect
      const before = !!others[to]
      const line = row
        ? { left: before ? ref.left - 3 : ref.left + ref.width + 1, top: ref.top, width: 2, height: ref.height }
        : { left: ref.left, top: before ? ref.top - 3 : ref.top + ref.height + 1, width: ref.width, height: 2 }
      return { line, to }
    }
    let last: { line: Box; to: number } | null = null
    const move = (e: PointerEvent) => {
      last = place(e.clientX, e.clientY)
      setMoving(last)
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      setMoving(null)
      const from = geo.siblings.findIndex((s) => s.id === selected)
      if (last && last.to !== from) window.parent.postMessage({ type: 'ds-studio:move', id: selected, to: last.to }, '*')
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }
  const at = (b: Box, extra: Record<string, string | number> = {}) => ({
    position: 'fixed' as const,
    left: b.left,
    top: b.top,
    width: b.width,
    height: b.height,
    ...extra,
  })
  const overlay = geo && selected && !interactive ? (
    <div ref={box} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2147483000 }} data-tick={tick}>
      {geo.layout && geo.flex && (
        <>
          {geo.kids.slice(1).map((b, i) => {
            const a = geo.kids[i]
            const row = geo.dir === 'row'
            const r = geo.rect
            const gap = row
              ? { left: a.left + a.width, top: r.top + geo.padding[0], width: Math.max(2, b.left - (a.left + a.width)), height: r.height - geo.padding[0] - geo.padding[2] }
              : { left: r.left + geo.padding[3], top: a.top + a.height, width: r.width - geo.padding[1] - geo.padding[3], height: Math.max(2, b.top - (a.top + a.height)) }
            return (
              <div
                key={'gap' + i}
                title={'Espacement entre les éléments : ' + geo.layout!.gap + ' px'}
                onPointerDown={(e) =>
                  drag(e, (dx, dy) => ({ id: selected, layout: { gap: clamp(geo.layout!.gap + (row ? dx : dy)) } }), sendLayout)
                }
                style={at(gap, { pointerEvents: 'auto', cursor: row ? 'col-resize' : 'row-resize', background: pink })}
              />
            )
          })}
          {(['top', 'right', 'bottom', 'left'] as const).map((side, i) => {
            const r = geo.rect
            const p = geo.padding
            const strip =
              side === 'top' ? { left: r.left, top: r.top, width: r.width, height: Math.max(6, p[0]) }
              : side === 'bottom' ? { left: r.left, top: r.top + r.height - Math.max(6, p[2]), width: r.width, height: Math.max(6, p[2]) }
              : side === 'left' ? { left: r.left, top: r.top, width: Math.max(6, p[3]), height: r.height }
              : { left: r.left + r.width - Math.max(6, p[1]), top: r.top, width: Math.max(6, p[1]), height: r.height }
            const sign = side === 'top' || side === 'left' ? 1 : -1
            const vertical = side === 'top' || side === 'bottom'
            return (
              <div
                key={side}
                title={'Espacement intérieur ' + { top: 'haut', right: 'droite', bottom: 'bas', left: 'gauche' }[side] + ' : ' + p[i] + ' px (⌥ : tous les côtés)'}
                onPointerDown={(e) =>
                  drag(
                    e,
                    (dx, dy, alt) => {
                      const v = clamp(geo.layout!.padding[i] + sign * (vertical ? dy : dx))
                      const next = [...geo.layout!.padding] as Layout['padding']
                      if (alt) next.fill(v)
                      else next[i] = v
                      return { id: selected, layout: { padding: next } }
                    },
                    sendLayout,
                  )
                }
                style={at(strip, { pointerEvents: 'auto', cursor: vertical ? 'row-resize' : 'col-resize', background: p[i] ? pink : 'transparent' })}
              />
            )
          })}
        </>
      )}
      <div
        onPointerDown={startMove}
        title="Glisser pour déplacer le calque"
        style={{
          position: 'fixed',
          left: geo.rect.left,
          top: Math.max(0, geo.rect.top - 20),
          maxWidth: Math.max(80, geo.rect.width),
          padding: '1px 6px',
          borderRadius: 4,
          background: violet,
          color: '#fff',
          font: '600 11px/16px system-ui, sans-serif',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          pointerEvents: 'auto',
          cursor: 'grab',
        }}
      >
        ⠿ {geo.label}
        {draft?.id === selected && draft.layout?.gap !== undefined ? ' · écart ' + draft.layout.gap : ''}
        {draft?.id === selected && draft.layout?.padding ? ' · intérieurs ' + draft.layout.padding.join(' ') : ''}
        {draft?.id === selected && draft.size ? ' · ' + [draft.size.width, draft.size.height].filter((v) => v !== undefined).join(' × ') + ' px' : ''}
      </div>
      {(['width', 'height', 'both'] as const).map((axis) => {
        const r = geo.rect
        const handle =
          axis === 'width' ? { left: r.left + r.width - 4, top: r.top + r.height / 2 - 4 }
          : axis === 'height' ? { left: r.left + r.width / 2 - 4, top: r.top + r.height - 4 }
          : { left: r.left + r.width - 4, top: r.top + r.height - 4 }
        return (
          <div
            key={axis}
            title={axis === 'both' ? 'Taille fixe' : axis === 'width' ? 'Largeur fixe' : 'Hauteur fixe'}
            onPointerDown={(e) =>
              drag(
                e,
                (dx, dy) => ({
                  id: selected,
                  size: {
                    ...(axis !== 'height' ? { width: Math.max(1, Math.round(r.width + dx)) } : {}),
                    ...(axis !== 'width' ? { height: Math.max(1, Math.round(r.height + dy)) } : {}),
                  },
                }),
                sendSize,
              )
            }
            style={{
              position: 'fixed',
              ...handle,
              width: 8,
              height: 8,
              boxSizing: 'border-box',
              border: '1.5px solid ' + violet,
              background: '#fff',
              borderRadius: 2,
              pointerEvents: 'auto',
              cursor: axis === 'width' ? 'ew-resize' : axis === 'height' ? 'ns-resize' : 'nwse-resize',
            }}
          />
        )
      })}
      {moving && <div style={at(moving.line, { background: violet, borderRadius: 1 })} />}
    </div>
  ) : null

  return (
    <>
    <main
      onMouseLeave={() => setHovered(undefined)}
      style={{
        display: 'grid',
        gap: 16,
        padding: \`\${insets.top + 16}px 16px \${insets.bottom + 16}px\`,
        alignContent: 'start',
        minHeight: '100vh',
        boxSizing: 'border-box',
      }}
    >
      {instances.map((node) => render(node, 'page'))}
      {!instances.length && (
        <p style={{ opacity: 0.6, textAlign: 'center', marginTop: 48 }}>
          Glisse un composant du panneau ici.
        </p>
      )}
    </main>
    {overlay}
    </>
  )
}
type Geometry = {
  rect: Box
  padding: [number, number, number, number]
  kids: Box[]
  dir: 'row' | 'column'
  flex: boolean
  parentDir: 'row' | 'column'
  siblings: { id: string; box: Box | null }[]
  label: string
  layout: Layout | null
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Canvas />
  </StrictMode>,
)
`;
  return [
    { file: bridgeHtml, content: html },
    { file: bridgeEntry, content: canvas },
  ];
}

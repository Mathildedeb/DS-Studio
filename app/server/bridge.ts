// Relais de la Preview dans le projet ouvert : une page de développement
// (ds-studio.html) qui affiche le plan de page avec les vrais composants du
// projet, chargés par Vite. DS-Studio lui envoie le plan par postMessage ; elle
// renvoie le clic (sélection) et la position des instances (dépôt).
// Hors de index.html, Vite ne l'inclut pas dans le build de production.
export const bridgeHtml = 'ds-studio.html';
export const bridgeEntry = 'src/ds-studio/canvas.tsx';
// Marque de version du relais : un relais plus ancien est proposé en mise à jour.
export const bridgeMark = 'Relais DS-Studio v6';

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
import { StrictMode, useEffect, useState, type ComponentType, type MouseEvent as ClickEvent, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
${styles}

type Value = string | number | boolean
type Size = 'hug' | 'fill' | number
type Instance = {
  id: string
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
      const l = node.layout ? { ...node.layout, ...(node.adapt?.[device] ?? {}) } : undefined
      return (
        <div
          key={node.id}
          data-ds-id={node.id}
          data-ds-root={root || undefined}
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
              : { display: 'grid', justifyItems: 'start', ...sized(node.size?.width, node.size?.height, within) }),
            ...(node.style?.fill ? { background: \`var(\${node.style.fill})\` } : {}),
            ...(node.style?.radius !== undefined ? { borderRadius: node.style.radius } : {}),
            cursor: interactive ? (node.link ? 'pointer' : undefined) : 'pointer',
            outline: mark(node.id) ?? (interactive ? undefined : '1px dashed rgba(138, 56, 245, 0.3)'),
            outlineOffset: 2,
          }}
        >
          {node.children.map((child) => render(child, l ? l.direction : 'column'))}
        </div>
      )
    }
    const Component = node.file ? byFile[node.file] : undefined
    return (
      <div
        key={node.id}
        data-ds-id={node.id}
        data-ds-root={root || undefined}
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
          ...sized(node.size?.width, node.size?.height, within),
          cursor: interactive ? undefined : 'pointer',
          outline: mark(node.id),
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
  return (
    <main
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
  )
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

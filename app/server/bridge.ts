// Relais de la Preview dans le projet ouvert : une page de développement
// (ds-studio.html) qui affiche le plan de page avec les vrais composants du
// projet, chargés par Vite. DS-Studio lui envoie le plan par postMessage ; elle
// renvoie le clic (sélection) et la position des instances (dépôt).
// Hors de index.html, Vite ne l'inclut pas dans le build de production.
export const bridgeHtml = 'ds-studio.html';
export const bridgeEntry = 'src/ds-studio/canvas.tsx';
// Marque de version du relais : un relais plus ancien est proposé en mise à jour.
export const bridgeMark = 'Relais DS-Studio v3';

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
import { StrictMode, useEffect, useState, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
${styles}

type Value = string | number | boolean
type Instance = {
  id: string
  component: string
  file?: string
  props: Record<string, Value>
  // Maquette Figma (rendu PNG à l'échelle 2), tant que le composant n'est pas codé.
  image?: string
}

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

function Canvas() {
  const [instances, setInstances] = useState<Instance[]>([])
  const [selected, setSelected] = useState<string>()
  // Safe areas de l'appareil (status bar, barre d'accueil) et mode Tester :
  // sans sélection, les composants réagissent comme dans l'application.
  const [insets, setInsets] = useState({ top: 0, bottom: 0 })
  const [interactive, setInteractive] = useState(false)
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'ds-studio:page') return
      setInstances(event.data.instances)
      setSelected(event.data.selected)
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
  // Position de chaque instance, pour placer un composant glissé.
  useEffect(() => {
    const rects = [...document.querySelectorAll<HTMLElement>('[data-ds-id]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { id: el.dataset.dsId, top: r.top, bottom: r.bottom }
    })
    parent.postMessage({ type: 'ds-studio:rects', rects }, '*')
  })
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
      {instances.map((instance) => {
        const Component = instance.file ? byFile[instance.file] : undefined
        return (
          <div
            key={instance.id}
            data-ds-id={instance.id}
            onClickCapture={(event) => {
              if (interactive) return
              event.preventDefault()
              event.stopPropagation()
              parent.postMessage({ type: 'ds-studio:select', id: instance.id }, '*')
            }}
            style={{
              justifySelf: 'start',
              cursor: interactive ? undefined : 'pointer',
              outline: !interactive && instance.id === selected ? '2px solid #8A38F5' : undefined,
              outlineOffset: 4,
              borderRadius: 4,
            }}
          >
            {Component ? (
              <Component {...instance.props} />
            ) : instance.image ? (
              <img
                src={instance.image}
                alt={instance.component + ' (maquette Figma)'}
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
                {instance.file ? 'Composant introuvable : ' + instance.file : instance.component + ' · maquette'}
              </p>
            )}
          </div>
        )
      })}
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

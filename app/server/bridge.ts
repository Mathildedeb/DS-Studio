// Relais de la Preview dans le projet ouvert : une page de développement
// (ds-studio.html) qui affiche le plan de page avec les vrais composants du
// projet, chargés par Vite. DS-Studio lui envoie le plan par postMessage ; elle
// renvoie le clic (sélection) et la position des instances (dépôt).
// Hors de index.html, Vite ne l'inclut pas dans le build de production.
export const bridgeHtml = 'ds-studio.html';
export const bridgeEntry = 'src/ds-studio/canvas.tsx';

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
  const canvas = `// Relais DS-Studio (développement seulement) : affiche le plan de page de la
// Preview avec les vrais composants du projet. Généré par DS-Studio.
import { StrictMode, useEffect, useState, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
${styles}

type Value = string | number | boolean
type Instance = { id: string; component: string; file: string; props: Record<string, Value> }

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
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'ds-studio:page') return
      setInstances(event.data.instances)
      setSelected(event.data.selected)
    }
    addEventListener('message', onMessage)
    parent.postMessage({ type: 'ds-studio:ready' }, '*')
    return () => removeEventListener('message', onMessage)
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
    <main style={{ display: 'grid', gap: 16, padding: 16, alignContent: 'start', minHeight: '100vh' }}>
      {instances.map((instance) => {
        const Component = byFile[instance.file]
        return (
          <div
            key={instance.id}
            data-ds-id={instance.id}
            onClickCapture={(event) => {
              event.preventDefault()
              event.stopPropagation()
              parent.postMessage({ type: 'ds-studio:select', id: instance.id }, '*')
            }}
            style={{
              justifySelf: 'start',
              cursor: 'pointer',
              outline: instance.id === selected ? '2px solid #8A38F5' : undefined,
              outlineOffset: 4,
              borderRadius: 4,
            }}
          >
            {Component ? (
              <Component {...instance.props} />
            ) : (
              <p>Composant introuvable : {instance.file}</p>
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

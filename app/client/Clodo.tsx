import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { request } from './api.js';
import { defaultClodo, type ClodoPosition } from '../shared/dashboard.js';

const size = 64;
const margin = 12;

// Bulle flottante : glisser pour la déplacer, cliquer pour ouvrir le chat à gauche.
// La position est enregistrée par le serveur, jamais dans le navigateur.
export default function Clodo({
  open,
  onOpen,
  children,
}: {
  open: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  const [position, setPosition] = useState<ClodoPosition>(defaultClodo);
  const [dragging, setDragging] = useState(false);
  const [, redraw] = useState(0);
  const bubble = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    request<ClodoPosition>('clodo')
      .then(setPosition)
      .catch(() => undefined);
    // Reste dans l'écran quand la fenêtre change de taille.
    const onResize = () => redraw((n) => n + 1);
    addEventListener('resize', onResize);
    // Le panneau se cale sous l'en-tête, dont la hauteur varie avec la largeur.
    const header = document.querySelector<HTMLElement>('.studio-header');
    const measure = new ResizeObserver(() =>
      document.documentElement.style.setProperty(
        '--studio-header-h',
        `${header?.offsetHeight ?? 0}px`,
      ),
    );
    if (header) measure.observe(header);
    return () => {
      removeEventListener('resize', onResize);
      measure.disconnect();
    };
  }, []);
  useEffect(() => {
    // Rend le focus à la bulle quand le panneau se ferme.
    if (wasOpen.current && !open) bubble.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const left = Math.round(
    margin + position.x * Math.max(0, innerWidth - size - 2 * margin),
  );
  const top = Math.round(
    margin + position.y * Math.max(0, innerHeight - size - 2 * margin),
  );
  function start(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const from = { x: e.clientX, y: e.clientY, left, top };
    let moved = false;
    let next = position;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - from.x;
      const dy = ev.clientY - from.y;
      // Au-delà de 4 px, c'est un déplacement et non un clic.
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      setDragging(true);
      const w = Math.max(1, innerWidth - size - 2 * margin);
      const h = Math.max(1, innerHeight - size - 2 * margin);
      next = {
        x: Math.min(1, Math.max(0, (from.left + dx - margin) / w)),
        y: Math.min(1, Math.max(0, (from.top + dy - margin) / h)),
      };
      setPosition(next);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setDragging(false);
      if (moved) request('clodo', next).catch(() => undefined);
      else onOpen();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }
  return (
    <>
      {!open && (
        <button
          ref={bubble}
          className={`clodo-bubble${dragging ? ' is-dragging' : ''}`}
          style={{ left, top }}
          onPointerDown={start}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpen();
            }
          }}
          aria-label="Ouvrir Clodo, l’assistant (glisser pour déplacer la bulle)"
          title="Clodo · cliquer pour ouvrir, glisser pour déplacer"
        >
          <span aria-hidden="true">✳</span>
        </button>
      )}
      {open && (
        <aside className="clodo-panel" aria-label="Clodo">
          {children}
        </aside>
      )}
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  GripVertical,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import snapshot from './pfe-data.json';
import './pfe-dashboard.css';
import { daysRemaining } from './pfe-dates';

const milestones = snapshot.items
  .filter((x) => x.kind === 'Jalon')
  .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
const defaultOrder = ['overview', 'calendar', ...milestones.map((x) => x.id)];
function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
function dateLabel(date: string | null) {
  return date
    ? new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'À compléter';
}
export default function AssistantDashboard() {
  const [now, setNow] = useState(new Date());
  const [done, setDone] = useState<Record<string, boolean>>(() =>
    read('pfe-done-v1', {}),
  );
  const [order, setOrder] = useState<string[]>(() => {
    const saved = read<string[]>('pfe-order-v1', []);
    return [
      ...new Set([
        ...saved.filter((x) => defaultOrder.includes(x)),
        ...defaultOrder,
      ]),
    ];
  });
  const [wide, setWide] = useState<Record<string, boolean>>(() =>
    read('pfe-wide-v1', {}),
  );
  const [drag, setDrag] = useState<{
    id: string;
    x: number;
    y: number;
    target: string | null;
    after: boolean;
  } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  function updateDrag(value: typeof drag) {
    dragRef.current = value;
    setDrag(value);
  }
  function trackDrag(x: number, y: number) {
    const current = dragRef.current;
    if (!current) return;
    const card = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>('[data-widget-id]');
    const rect = card?.getBoundingClientRect();
    const target = card?.dataset.widgetId;
    updateDrag({
      ...current,
      x,
      y,
      target: target && target !== current.id ? target : null,
      after: rect ? y > rect.top + rect.height / 2 : false,
    });
  }
  function finishDrag(cancel = false) {
    const current = dragRef.current;
    if (!cancel && current?.target) {
      setOrder((previous) => {
        const result = previous.filter((id) => id !== current.id);
        result.splice(
          result.indexOf(current.target!) + (current.after ? 1 : 0),
          0,
          current.id,
        );
        return result;
      });
    }
    updateDrag(null);
  }
  useEffect(() => {
    if (!drag) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finishDrag(true);
    };
    document.addEventListener('keydown', escape);
    const timer = setInterval(() => {
      const current = dragRef.current;
      if (!current) return;
      const delta =
        current.y < 90 ? -18 : current.y > innerHeight - 90 ? 18 : 0;
      if (delta) {
        window.scrollBy(0, delta);
        trackDrag(current.x, current.y);
      }
    }, 30);
    return () => {
      clearInterval(timer);
      document.removeEventListener('keydown', escape);
    };
  }, [!!drag]);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('pfe-done-v1', JSON.stringify(done));
      localStorage.setItem('pfe-order-v1', JSON.stringify(order));
      localStorage.setItem('pfe-wide-v1', JSON.stringify(wide));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [done, order, wide]);
  const isDone = (id: string) =>
    done[id] ?? snapshot.items.find((x) => x.id === id)?.done ?? false;
  const taskDone = snapshot.items.filter(
    (x) => x.kind === 'Tâche' && isDone(x.id),
  ).length;
  const next = milestones.find((x) => !isDone(x.id));
  function move(id: string, target: string) {
    if (id === target) return;
    setOrder((previous) => {
      const result = previous.filter((x) => x !== id);
      result.splice(result.indexOf(target), 0, id);
      return result;
    });
  }
  const counter = (date: string | null, finished = false) => {
    if (finished) return 'Remis';
    if (!date) return 'À compléter';
    const n = daysRemaining(date, now);
    return n === 0
      ? 'À rendre aujourd’hui'
      : n < 0
        ? `En retard de ${Math.abs(n)} jours`
        : `J−${n}`;
  };
  return (
    <section className="pfe-dashboard" aria-labelledby="pfe-title">
      <header className="pfe-heading">
        <div>
          <span className="pfe-eyebrow">SynKro · PFE 2026–2027</span>
          <h1 id="pfe-title">Chaque étape compte.</h1>
          <p>Tes rendus, tes priorités. Un peu plus clair, chaque jour.</p>
        </div>
        <a
          href="https://app.notion.com/p/3fe60f40714080938a53c3fb45a385b5"
          target="_blank"
          rel="noreferrer"
        >
          Mon espace Notion <ArrowUpRight size={18} />
        </a>
      </header>
      <div className="pfe-source">
        Données reprises de Notion le 30 octobre 2026 · Cases et disposition
        enregistrées dans ce navigateur, sans synchronisation Notion.
      </div>
      {storageError && (
        <p role="alert">
          L’enregistrement local est indisponible. Garde cette page ouverte pour
          conserver tes changements.
        </p>
      )}
      <div className="pfe-grid">
        {order.map((id, index) => {
          const item = milestones.find((x) => x.id === id);
          const tasks = item
            ? snapshot.items.filter((x) => item.tasks.includes(x.id))
            : [];
          const completed = tasks.filter((x) => isDone(x.id)).length;
          const progress = tasks.length
            ? Math.round((completed / tasks.length) * 100)
            : 0;
          const remaining = item?.date
            ? daysRemaining(item.date, now)
            : Infinity;
          const label =
            item?.title ||
            (id === 'overview' ? 'Vue d’ensemble' : 'Prochaines échéances');
          return (
            <Card
              key={id}
              data-widget-id={id}
              className={`pfe-widget ${drag?.id === id ? 'pfe-drag-source' : ''} ${drag?.target === id ? (drag.after ? 'pfe-drop-after' : 'pfe-drop-before') : ''} ${wide[id] ? 'pfe-wide' : ''} ${id === 'overview' ? 'pfe-lime' : id === 'calendar' ? 'pfe-dark' : 'pfe-paper'}`}
            >
              <div className="pfe-controls">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Déplacer ${label}`}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    updateDrag({
                      id,
                      x: event.clientX,
                      y: event.clientY,
                      target: null,
                      after: false,
                    });
                  }}
                  onPointerMove={(event) =>
                    trackDrag(event.clientX, event.clientY)
                  }
                  onPointerUp={() => finishDrag()}
                  onPointerCancel={() => finishDrag(true)}
                  onLostPointerCapture={() => {
                    if (dragRef.current) finishDrag(true);
                  }}
                  title="Glisser pour déplacer · Échap pour annuler"
                  className="pfe-grip"
                >
                  <GripVertical size={20} />
                </Button>
                <span className="pfe-widget-label">
                  {id === 'overview'
                    ? 'Mon avancée'
                    : id === 'calendar'
                      ? 'Agenda'
                      : 'Rendu'}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={index === 0}
                  aria-label={`Monter ${label}`}
                  onClick={() => move(id, order[index - 1])}
                >
                  <ArrowUp size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={index === order.length - 1}
                  aria-label={`Descendre ${label}`}
                  onClick={() =>
                    setOrder((o) => {
                      const a = [...o];
                      [a[index], a[index + 1]] = [a[index + 1], a[index]];
                      return a;
                    })
                  }
                >
                  <ArrowDown size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${wide[id] ? 'Réduire' : 'Agrandir'} ${label}`}
                  aria-pressed={!!wide[id]}
                  onClick={() => setWide((w) => ({ ...w, [id]: !w[id] }))}
                >
                  {wide[id] ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </Button>
              </div>
              {id === 'overview' ? (
                <>
                  <h2>Le prochain cap.</h2>
                  <p className="pfe-next-title">
                    {next?.title || 'Tous les rendus sont remis !'}
                  </p>
                  <div className="pfe-big-count">
                    {next ? counter(next.date) : 'Bravo !'}
                  </div>
                  <span>{next ? dateLabel(next.date) : ''}</span>
                  <div className="pfe-summary-bottom">
                    <strong>
                      {taskDone}
                      <span> / 21 tâches terminées</span>
                    </strong>
                    <progress value={taskDone} max={21} />
                    <p>
                      {milestones.filter((x) => isDone(x.id)).length} / 4 rendus
                      remis
                    </p>
                  </div>
                </>
              ) : id === 'calendar' ? (
                <>
                  <h2>
                    {now.toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'long',
                    })}
                  </h2>
                  <div className="pfe-week" aria-label="Cette semaine">
                    {Array.from({ length: 7 }, (_, i) => {
                      const d = new Date(now);
                      d.setDate(now.getDate() - ((now.getDay() + 6) % 7) + i);
                      return (
                        <div
                          key={i}
                          className={
                            d.toDateString() === now.toDateString()
                              ? 'pfe-today'
                              : ''
                          }
                        >
                          <span>
                            {d.toLocaleDateString('fr-FR', {
                              weekday: 'narrow',
                            })}
                          </span>
                          <strong>{d.getDate()}</strong>
                        </div>
                      );
                    })}
                  </div>
                  <div className="pfe-agenda-list">
                    {milestones.map((m) => (
                      <a key={m.id} href={`#rendu-${m.id}`}>
                        <span>
                          {dateLabel(m.date)}
                          <strong>{m.title}</strong>
                        </span>
                        <span className="pfe-agenda-count">
                          {counter(m.date, isDone(m.id))}
                        </span>
                      </a>
                    ))}
                  </div>
                </>
              ) : item ? (
                <>
                  <div className="pfe-rendu-heading">
                    <h2 id={`rendu-${item.id}`}>{item.title}</h2>
                    <span
                      className={`pfe-date-pill ${remaining <= 14 && !isDone(id) ? 'pfe-urgent' : ''}`}
                    >
                      {dateLabel(item.date)}
                    </span>
                  </div>
                  <div
                    className={`pfe-count-panel ${remaining <= 14 && !isDone(id) ? 'pfe-urgent-panel' : ''}`}
                  >
                    <span>{counter(item.date, isDone(id))}</span>
                    <small>
                      {isDone(id)
                        ? 'Une étape de plus.'
                        : remaining < 0
                          ? 'À traiter en priorité'
                          : 'Avant la remise'}
                    </small>
                  </div>
                  <div className="pfe-progress-label">
                    <strong>Préparation</strong>
                    <span>
                      {completed}/{tasks.length} · {progress} %
                    </span>
                  </div>
                  <progress value={completed} max={tasks.length || 1} />
                  <div className="pfe-task-list">
                    {tasks.map((t) => (
                      <label key={t.id}>
                        <input
                          type="checkbox"
                          checked={isDone(t.id)}
                          onChange={(e) =>
                            setDone((d) => ({ ...d, [t.id]: e.target.checked }))
                          }
                        />
                        <span className={isDone(t.id) ? 'pfe-complete' : ''}>
                          {t.title}
                          <small>{t.expected}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <details className="pfe-instructions">
                    <summary>Les points clés du rendu</summary>
                    <dl>
                      <dt>Éléments attendus</dt>
                      <dd>{item.expected}</dd>
                      <dt>Consignes</dt>
                      <dd>{item.instructions}</dd>
                      <dt>Format et remise</dt>
                      <dd>{item.format}</dd>
                      <dt>Date de remise</dt>
                      <dd>{dateLabel(item.date)} · Heure : À compléter</dd>
                    </dl>
                  </details>
                  <div className="pfe-rendu-footer">
                    <label>
                      <input
                        type="checkbox"
                        checked={isDone(id)}
                        onChange={(e) =>
                          setDone((d) => ({ ...d, [id]: e.target.checked }))
                        }
                      />{' '}
                      Rendu remis
                    </label>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      Fiche Notion <ArrowUpRight size={16} />
                    </a>
                  </div>
                </>
              ) : null}
            </Card>
          );
        })}
      </div>
      {drag && (
        <div
          className="pfe-drag-preview"
          style={{ left: drag.x + 18, top: drag.y + 12 }}
          aria-hidden="true"
        >
          <GripVertical size={20} />
          {milestones.find((item) => item.id === drag.id)?.title ||
            (drag.id === 'overview' ? 'Mon avancée' : 'Agenda')}
        </div>
      )}
      <span className="sr-only" role="status">
        {drag
          ? 'Déplacement en cours. Relâche sur une carte pour la repositionner. Échap pour annuler.'
          : ''}
      </span>
      <p className="pfe-layout-help">
        Déplace les widgets par leur poignée ou les flèches. Le bouton
        d’agrandissement étend une carte sur toute la largeur.
      </p>
    </section>
  );
}

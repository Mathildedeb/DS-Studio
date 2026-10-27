import { useEffect, useState, type ReactNode } from 'react';
import { request } from './api.js';
import ProjectBrief from './ProjectBrief.js';
import {
  defaultLayout,
  widgetIds,
  widgetSizes,
  type Checklist,
  type Layout,
  type Roadmap,
  type RoadmapStep,
  type WidgetId,
  type WidgetSize,
} from '../shared/dashboard.js';
import type { Tokens } from '../shared/model.js';

const titles: Record<WidgetId, string> = {
  brief: 'Mon PFE',
  checklist: 'Checklist de production',
  countdown: 'Compte à rebours',
  roadmap: 'Roadmap DS et écrans',
  designSystem: 'Design System',
};
const sizeNames: Record<WidgetSize, string> = {
  s: 'petit',
  m: 'moyen',
  l: 'large',
};
const statusClass = {
  Terminé: 'done',
  'En cours': 'doing',
  'À venir': 'todo',
} as const;

const dayMs = 86_400_000;
const toDate = (d: string) => new Date(`${d}T00:00:00`);
const daysUntil = (d: string) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((toDate(d).getTime() - today.getTime()) / dayMs);
};
const shortDate = (d: string) =>
  toDate(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const period = (s: RoadmapStep) =>
  s.end ? `${shortDate(s.start)} → ${shortDate(s.end)}` : shortDate(s.start);

function ChecklistWidget({
  items,
  onChange,
}: {
  items: Checklist;
  onChange: (next: Checklist) => void;
}) {
  const groups = [...new Set(items.map((i) => i.group))];
  const [group, setGroup] = useState(groups[0] ?? 'Production');
  const [label, setLabel] = useState('');
  const done = items.filter((i) => i.done).length;
  return (
    <>
      <p className="checklist-total">
        <progress max={items.length || 1} value={done} />
        <span>
          {done}/{items.length} faits
        </span>
      </p>
      {groups.map((g) => {
        const inGroup = items.filter((i) => i.group === g);
        return (
          <fieldset key={g} className="checklist-group">
            <legend>
              {g}
              <span className="muted">
                {inGroup.filter((i) => i.done).length}/{inGroup.length}
              </span>
            </legend>
            {inGroup.map((item) => (
              <div key={item.id} className="checklist-item">
                <label>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() =>
                      onChange(
                        items.map((i) =>
                          i.id === item.id ? { ...i, done: !i.done } : i,
                        ),
                      )
                    }
                  />
                  <span>{item.label}</span>
                </label>
                <button
                  className="checklist-remove"
                  onClick={() =>
                    onChange(items.filter((i) => i.id !== item.id))
                  }
                  aria-label={`Supprimer « ${item.label} »`}
                  title="Supprimer"
                >
                  ×
                </button>
              </div>
            ))}
          </fieldset>
        );
      })}
      <form
        className="checklist-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) return;
          onChange([
            ...items,
            {
              id: crypto.randomUUID(),
              group: group.trim() || 'Production',
              label: label.trim(),
              done: false,
            },
          ]);
          setLabel('');
        }}
      >
        <label className="field">
          Groupe
          <input
            list="checklist-groups"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            maxLength={100}
          />
          <datalist id="checklist-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </label>
        <label className="field">
          Nouvelle tâche
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={200}
            placeholder="Ex. États d’erreur des champs"
          />
        </label>
        <button disabled={!label.trim()}>Ajouter</button>
      </form>
    </>
  );
}

export default function Dashboard({
  tokens,
  revision,
  lastChange,
  onError,
}: {
  tokens: Tokens;
  revision: number;
  lastChange?: string;
  onError: (message: string) => void;
}) {
  const [roadmap, setRoadmap] = useState<Roadmap>();
  const [layout, setLayout] = useState<Layout>();
  const [checklist, setChecklist] = useState<Checklist>();
  const [adding, setAdding] = useState<WidgetId | ''>('');
  useEffect(() => {
    request<Roadmap>('roadmap')
      .then(setRoadmap)
      .catch((e) => onError(e.message));
    request<Checklist>('checklist')
      .then(setChecklist)
      .catch((e) => onError(e.message));
    request<Layout>('dashboard')
      .then(setLayout)
      .catch((e) => {
        setLayout(defaultLayout);
        onError(e.message);
      });
  }, []);
  // Disposition et checklist sont enregistrées par le serveur, jamais dans le navigateur.
  const save = (next: Layout) => {
    setLayout(next);
    request<Layout>('dashboard', next).catch((e) => onError(e.message));
  };
  const saveChecklist = (next: Checklist) => {
    setChecklist(next);
    request<Checklist>('checklist', next).catch((e) => onError(e.message));
  };
  if (!layout) return <p className="loading">Chargement du tableau de bord…</p>;
  const shown = new Set(layout.widgets.map((w) => w.id));
  const hidden = widgetIds.filter((id) => !shown.has(id));
  const resize = (id: WidgetId, step: 1 | -1) =>
    save({
      widgets: layout.widgets.map((w) =>
        w.id === id
          ? {
              ...w,
              size: widgetSizes[
                Math.min(2, Math.max(0, widgetSizes.indexOf(w.size) + step))
              ],
            }
          : w,
      ),
    });
  const move = (id: WidgetId, step: 1 | -1) => {
    const widgets = [...layout.widgets];
    const i = widgets.findIndex((w) => w.id === id);
    const j = i + step;
    if (j < 0 || j >= widgets.length) return;
    [widgets[i], widgets[j]] = [widgets[j], widgets[i]];
    save({ widgets });
  };
  const remove = (id: WidgetId) =>
    save({ widgets: layout.widgets.filter((w) => w.id !== id) });
  const add = (id: WidgetId) => {
    save({ widgets: [...layout.widgets, { id, size: 'm' }] });
    setAdding('');
  };

  const body = (id: WidgetId): ReactNode => {
    if (id === 'brief') return <ProjectBrief />;
    if (id === 'checklist')
      return checklist ? (
        <ChecklistWidget items={checklist} onChange={saveChecklist} />
      ) : (
        <p className="muted">Chargement de la checklist…</p>
      );
    if (id === 'designSystem')
      return (
        <>
          <p className="widget-metric">
            Révision {revision}
            <small>
              {lastChange
                ? `Dernier changement le ${new Date(lastChange).toLocaleDateString('fr-FR')}`
                : 'Aucun changement validé'}
            </small>
          </p>
          <div className="token-swatches" aria-label="Couleurs principales">
            {(
              [
                'color.brand',
                'color.text',
                'color.muted',
                'color.border',
                'color.danger',
                'color.success',
              ] as const
            ).map((k) => (
              <span
                key={k}
                title={`${k} · ${tokens[k].$value}`}
                style={{ background: tokens[k].$value }}
              />
            ))}
          </div>
        </>
      );
    if (!roadmap) return <p className="muted">Chargement de la roadmap…</p>;
    if (id === 'countdown')
      return (
        <>
          <p className="widget-metric">
            J-{Math.max(0, daysUntil(roadmap.project.defenseDate))}
            <small>
              Soutenance le {shortDate(roadmap.project.defenseDate)}
            </small>
          </p>
          <p className="muted">
            Rendu des livrables : J-
            {Math.max(0, daysUntil(roadmap.project.deliveryDate))} (
            {shortDate(roadmap.project.deliveryDate)})
          </p>
        </>
      );
    // Roadmap limitée aux phases de production (focusPhases).
    return (
      <ol className="phase-list">
        {roadmap.focusPhases.map((phase) => {
          const inPhase = roadmap.steps.filter((s) => s.phase === phase);
          const done = inPhase.filter((s) => s.status === 'Terminé').length;
          return (
            <li key={phase}>
              <p className="phase-head">
                <span className="phase-name">{phase}</span>
                <progress max={inPhase.length || 1} value={done} />
                <span className="muted">
                  {done}/{inPhase.length}
                </span>
              </p>
              <ul className="step-list">
                {inPhase.map((s) => (
                  <li key={s.url}>
                    <span className={`status-pill ${statusClass[s.status]}`}>
                      {s.status}
                    </span>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                    <span className="muted">{period(s)}</span>
                    {s.deliverable && (
                      <span className="step-deliverable">{s.deliverable}</span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    );
  };

  return (
    <main className="dashboard" id="tableau-de-bord" tabIndex={-1}>
      <div className="dashboard-head">
        <div>
          <span className="eyebrow">PRODUCTION · DESIGN SYSTEM ET ÉCRANS</span>
          <h1>
            {roadmap
              ? `${roadmap.project.name} · ${roadmap.project.tagline}`
              : 'Tableau de bord'}
          </h1>
        </div>
        <div className="dashboard-tools">
          {hidden.length > 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (adding) add(adding);
              }}
            >
              <label className="field">
                Ajouter un widget
                <select
                  value={adding}
                  onChange={(e) => setAdding(e.target.value as WidgetId)}
                >
                  <option value="">Choisir…</option>
                  {hidden.map((id) => (
                    <option key={id} value={id}>
                      {titles[id]}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={!adding}>Ajouter</button>
            </form>
          )}
          <button onClick={() => save(defaultLayout)}>Réinitialiser</button>
        </div>
      </div>
      <div className="widget-grid">
        {layout.widgets.map(({ id, size }, index) => (
          <section
            key={id}
            className={`widget size-${size}`}
            aria-labelledby={`widget-${id}`}
          >
            <header className="widget-head">
              <h2 id={`widget-${id}`}>{titles[id]}</h2>
              <div className="widget-actions">
                <button
                  onClick={() => move(id, -1)}
                  disabled={index === 0}
                  aria-label={`Déplacer ${titles[id]} avant`}
                  title="Déplacer avant"
                >
                  ←
                </button>
                <button
                  onClick={() => move(id, 1)}
                  disabled={index === layout.widgets.length - 1}
                  aria-label={`Déplacer ${titles[id]} après`}
                  title="Déplacer après"
                >
                  →
                </button>
                <button
                  onClick={() => resize(id, -1)}
                  disabled={size === 's'}
                  aria-label={`Réduire ${titles[id]} (actuellement ${sizeNames[size]})`}
                  title="Réduire"
                >
                  −
                </button>
                <button
                  onClick={() => resize(id, 1)}
                  disabled={size === 'l'}
                  aria-label={`Agrandir ${titles[id]} (actuellement ${sizeNames[size]})`}
                  title="Agrandir"
                >
                  +
                </button>
                <button
                  onClick={() => remove(id)}
                  aria-label={`Retirer ${titles[id]}`}
                  title="Retirer"
                >
                  ×
                </button>
              </div>
            </header>
            <div className="widget-body">{body(id)}</div>
          </section>
        ))}
      </div>
    </main>
  );
}

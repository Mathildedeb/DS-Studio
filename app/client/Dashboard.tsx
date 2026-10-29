import { useEffect, useState, type ReactNode } from 'react';
import { request } from './api.js';
import ProjectBrief from './ProjectBrief.js';
import Board from './Board.js';
import {
  defaultLayout,
  widgetIds,
  type Checklist,
  type Roadmap,
  type RoadmapStep,
  type WidgetId,
} from '../shared/dashboard.js';
import type { Tokens } from '../shared/model.js';
import type { FigmaFileStatus } from '../../connectors/figma/reader.js';

const titles: Record<WidgetId, string> = {
  brief: 'Mon PFE',
  checklist: 'Checklist de production',
  countdown: 'Jours restants',
  roadmap: 'Roadmap DS et écrans',
  designSystem: 'Design System',
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
  figma,
  onError,
}: {
  tokens: Tokens;
  revision: number;
  lastChange?: string;
  figma?: FigmaFileStatus;
  onError: (message: string) => void;
}) {
  const [roadmap, setRoadmap] = useState<Roadmap>();
  const [checklist, setChecklist] = useState<Checklist>();
  useEffect(() => {
    request<Roadmap>('roadmap')
      .then(setRoadmap)
      .catch((e) => onError(e.message));
    request<Checklist>('checklist')
      .then(setChecklist)
      .catch((e) => onError(e.message));
  }, []);
  // La checklist est enregistrée par le serveur, jamais dans le navigateur.
  const saveChecklist = (next: Checklist) => {
    setChecklist(next);
    request<Checklist>('checklist', next).catch((e) => onError(e.message));
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
            {/* Les six premières couleurs du DS, quelle que soit leur liste. */}
            {Object.entries(tokens)
              .filter(([, t]) => t.$type === 'color')
              .slice(0, 6)
              .map(([k, t]) => (
                <span
                  key={k}
                  title={`${k} · ${t.$value}`}
                  style={{ background: String(t.$value) }}
                />
              ))}
          </div>
          <p className="figma-line">
            {figma?.file ? (
              <>
                <a href={figma.file.url} target="_blank" rel="noreferrer">
                  {figma.label}
                </a>
                <small>
                  Modifié le{' '}
                  {new Date(figma.file.lastModified).toLocaleDateString(
                    'fr-FR',
                  )}{' '}
                  · {figma.file.pages.length} page(s)
                </small>
              </>
            ) : (
              <span className="muted">
                {figma?.label ?? 'Figma non connecté'}
              </span>
            )}
          </p>
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
      </div>
      <section className="ux-start" aria-labelledby="ux-start-title">
        <div>
          <span className="eyebrow">TON ATELIER</span>
          <h2 id="ux-start-title">Sur quoi veux-tu travailler ?</h2>
          <p>
            Retrouve tes styles, compose une page ou vérifie les écarts avec
            Figma.
          </p>
        </div>
        <div className="ux-start-links">
          <a href="#design-system">
            <strong>Bibliothèque →</strong>
            <span>Styles et composants</span>
          </a>
          <a href="#pages">
            <strong>Pages →</strong>
            <span>Composer et tester</span>
          </a>
          <a href="#synchro">
            <strong>Synchro →</strong>
            <span>Figma, code et GitHub</span>
          </a>
        </div>
      </section>
      <h2 className="ux-follow-title">Suivi du projet</h2>
      <Board
        name="dashboard"
        label="tableau de bord"
        ids={widgetIds}
        titles={titles}
        fallback={defaultLayout}
        onError={onError}
        render={(id) => (
          <section className="widget" aria-labelledby={`widget-${id}`}>
            <header className="widget-head">
              <h2 id={`widget-${id}`}>{titles[id]}</h2>
            </header>
            <div className="widget-body">{body(id)}</div>
          </section>
        )}
      />
    </main>
  );
}

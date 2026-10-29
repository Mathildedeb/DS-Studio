import type { FigmaComponent } from '../../connectors/figma/library.js';
import { useEffect, useState } from 'react';
import { request } from './api.js';
import { defaultPreview, type PreviewConfig } from '../shared/dashboard.js';
import type { FolderInfo } from '../shared/connection.js';
import type { Focus } from '../shared/focus.js';
import type { DevStatus } from '../server/devserver.js';
import type { CodeProposal } from '../server/code.js';
import type { CodeComponent } from '../shared/components.js';
import PreviewBuild, { type BuildRequest } from './PreviewBuild.js';
import DeviceFrame, { closestIPhone, isPhone } from './DeviceFrame.js';

// Page Preview : un format (largeur × hauteur réelles) et une page du proto.
// Formats et pages se créent ici et restent enregistrés sur ce poste. Avec un
// projet ouvert, l'iframe affiche le serveur de dev de ce projet, à la route
// de la page choisie.
const builtIn = new Set(['cards', 'form']);
const slug = (name: string) =>
  `${
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || 'item'
  }-${Math.random().toString(36).slice(2, 6)}`;

const routeOf = (name: string) =>
  '/' +
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export default function PreviewPage({
  project,
  onError,
  onFocus,
  code,
  figma,
  onAsk,
  onBuild,
  onCodeProposal,
  chatChange,
}: {
  project?: FolderInfo;
  onError: (message: string) => void;
  onFocus: (focus: Focus) => void;
  // Mode « Construire » : composants codés du projet, chat et diff de code.
  code?: { components: CodeComponent[]; map: Record<string, string> };
  figma?: FigmaComponent[];
  onAsk: (message: string) => void;
  onBuild: (request: BuildRequest) => void;
  onCodeProposal: (p: CodeProposal) => void;
  chatChange?: { page: string; n: number };
}) {
  // Aperçu du projet tel qu'il est codé, ou construction de la page avec
  // les composants du DS (plan de page, sans toucher au code).
  const [mode, setMode] = useState<'view' | 'build'>('view');
  const [dev, setDev] = useState<DevStatus>({ state: 'stopped', logs: [] });
  const [route, setRoute] = useState('/');
  useEffect(() => {
    if (project)
      request<DevStatus>('project-dev')
        .then(setDev)
        .catch(() => undefined);
  }, [project?.folder]);
  const run = (action: 'start' | 'stop' | 'install') => {
    setDev((d) => ({
      ...d,
      state:
        action === 'start'
          ? 'starting'
          : action === 'install'
            ? 'installing'
            : d.state,
    }));
    request<DevStatus>(`project-dev/${action}`, {})
      .then(setDev)
      .catch((e) => {
        setDev((d) => ({ ...d, state: 'error' }));
        onError(e.message);
      });
  };
  const [config, setConfig] = useState<PreviewConfig>(defaultPreview);
  const [format, setFormat] = useState('iphone');
  const [page, setPage] = useState('cards');
  const [adding, setAdding] = useState<'format' | 'page' | 'rename' | 'site'>();
  const [name, setName] = useState('');
  const [width, setWidth] = useState('390');
  const [height, setHeight] = useState('844');
  // Relu quand le chat a créé une page : elle apparaît dans la barre.
  useEffect(() => {
    request<PreviewConfig>('preview')
      .then(setConfig)
      .catch((e) => onError(e.message));
  }, [chatChange?.n]);
  const save = (next: PreviewConfig) => {
    setConfig(next);
    request('preview', next).catch((e) => onError(e.message));
  };
  const f = config.formats.find((x) => x.id === format) ?? config.formats[0];
  const p = config.pages.find((x) => x.id === page) ?? config.pages[0];
  const path = p.path ?? '/';
  // Clodo reçoit la page et le format affichés : « ici » = cette page.
  useEffect(() => {
    // En mode Construire, la page de construction donne elle-même le focus.
    if (mode === 'build' && dev.state === 'running') return;
    onFocus({
      page: 'preview',
      kind: 'page',
      name: p.name,
      path: [p.name],
      value: project ? path : p.id,
      props: { format: `${f.name} ${f.width}px` },
    });
  }, [p.name, path, f.name, f.width, !!project, mode, dev.state]);
  const close = () => {
    setAdding(undefined);
    setName('');
    setRoute('/');
  };

  return (
    <section className="panel mobile-panel" aria-labelledby="preview-title">
      <div className="preview-bar">
        <div className="preview-group" role="group" aria-label="Format">
          <span className="preview-label">Format</span>
          {config.formats.map((x) => (
            <button
              key={x.id}
              type="button"
              className="preview-chip"
              aria-pressed={x.id === f.id}
              onClick={() => setFormat(x.id)}
            >
              {x.name} <small>{x.width}</small>
            </button>
          ))}
          <button
            type="button"
            className="preview-add"
            onClick={() =>
              setAdding(adding === 'format' ? undefined : 'format')
            }
            aria-expanded={adding === 'format'}
          >
            + Format
          </button>
          {config.formats.length > 1 && (
            <button
              type="button"
              className="preview-remove"
              aria-label={`Supprimer le format ${f.name}`}
              title={`Supprimer le format ${f.name}`}
              onClick={() => {
                const rest = config.formats.filter((x) => x.id !== f.id);
                save({ ...config, formats: rest });
                setFormat(rest[0].id);
              }}
            >
              ×
            </button>
          )}
        </div>
        {project && (
          <div className="preview-group" role="group" aria-label="Mode">
            <span className="preview-label">Mode</span>
            <button
              type="button"
              className="preview-chip"
              aria-pressed={mode === 'view'}
              onClick={() => setMode('view')}
            >
              Aperçu
            </button>
            <button
              type="button"
              className="preview-chip"
              aria-pressed={mode === 'build'}
              onClick={() => setMode('build')}
            >
              Construire
            </button>
          </div>
        )}
        <div className="preview-group" role="group" aria-label="Page">
          <span className="preview-label">Page</span>
          {config.pages.map((x) => (
            <button
              key={x.id}
              type="button"
              className="preview-chip"
              aria-pressed={x.id === p.id}
              onClick={() => setPage(x.id)}
            >
              {x.name}
            </button>
          ))}
          <button
            type="button"
            className="preview-add"
            onClick={() => {
              setRoute('/');
              setAdding(adding === 'page' ? undefined : 'page');
            }}
            aria-expanded={adding === 'page'}
          >
            + Page
          </button>
          <button
            type="button"
            className="preview-add"
            onClick={() => {
              setName(p.name);
              setRoute(path);
              setAdding(adding === 'rename' ? undefined : 'rename');
            }}
            aria-expanded={adding === 'rename'}
          >
            Renommer
          </button>
          {(project ? config.pages.length > 1 : !builtIn.has(p.id)) && (
            <button
              type="button"
              className="preview-remove"
              aria-label={`Supprimer la page ${p.name}`}
              title={`Supprimer la page ${p.name}`}
              onClick={() => {
                const rest = config.pages.filter((x) => x.id !== p.id);
                save({ ...config, pages: rest });
                setPage(rest[0].id);
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {adding && (
        <form
          className="preview-form"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (adding === 'site') {
              const { siteUrl: _, ...rest } = config;
              save(n ? { ...rest, siteUrl: n } : rest);
              close();
              return;
            }
            if (!n) return;
            if (adding === 'format') {
              const id = slug(n);
              save({
                ...config,
                formats: [
                  ...config.formats,
                  { id, name: n, width: Number(width), height: Number(height) },
                ],
              });
              setFormat(id);
            } else if (adding === 'page') {
              const id = slug(n);
              save({
                ...config,
                pages: [
                  ...config.pages,
                  project
                    ? { id, name: n, path: route === '/' ? routeOf(n) : route }
                    : { id, name: n },
                ],
              });
              setPage(id);
            } else
              save({
                ...config,
                pages: config.pages.map((x) =>
                  x.id === p.id
                    ? { ...x, name: n, ...(project ? { path: route } : {}) }
                    : x,
                ),
              });
            close();
          }}
        >
          <label className="field">
            {adding === 'site'
              ? 'Lien du proto en ligne (vide pour le retirer)'
              : adding === 'format'
              ? 'Nom du format'
              : adding === 'page'
                ? 'Nom de la page'
                : 'Nouveau nom'}
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                adding === 'site'
                  ? 'https://mon-proto.vercel.app'
                  : adding === 'format'
                    ? 'Android, iPad mini…'
                    : 'Profil, Panier…'
              }
              type={adding === 'site' ? 'url' : 'text'}
              pattern={adding === 'site' ? 'https://.*' : undefined}
              maxLength={adding === 'site' ? 300 : 40}
              required={adding !== 'site'}
            />
          </label>
          {project && (adding === 'page' || adding === 'rename') && (
            <label className="field">
              Chemin dans le projet
              <input
                value={route}
                maxLength={200}
                onChange={(e) => setRoute(e.target.value)}
                placeholder="/profil"
              />
            </label>
          )}
          {adding === 'format' && (
            <>
              <label className="field">
                Largeur (px)
                <input
                  type="number"
                  min={240}
                  max={2560}
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                Hauteur (px)
                <input
                  type="number"
                  min={320}
                  max={2000}
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  required
                />
              </label>
            </>
          )}
          <button className="studio-primary">
            {adding === 'rename' ? 'Renommer' : adding === 'site' ? 'Enregistrer' : 'Ajouter'}
          </button>
          <button type="button" onClick={close}>
            Annuler
          </button>
        </form>
      )}

      {project && (
        <div className="project-run" role="status">
          <span>
            Projet <strong>{project.name}</strong> ·{' '}
            {dev.state === 'running'
              ? `en ligne sur ${dev.url}`
              : dev.state === 'starting'
                ? 'lancement…'
                : dev.state === 'installing'
                  ? 'installation des dépendances…'
                  : dev.state === 'error'
                    ? 'erreur au lancement'
                    : 'arrêté'}
          </span>
          {dev.needsInstall && dev.state !== 'installing' && (
            <button type="button" onClick={() => run('install')}>
              Installer les dépendances (npm install)
            </button>
          )}
          {dev.state === 'installing' ? null : dev.state === 'running' ||
            dev.state === 'starting' ? (
            <button type="button" onClick={() => run('stop')}>
              Arrêter
            </button>
          ) : (
            <button
              type="button"
              className="studio-primary"
              onClick={() => run('start')}
            >
              Lancer le projet
            </button>
          )}
          {config.siteUrl ? (
            <a className="preview-site" href={config.siteUrl} target="_blank" rel="noreferrer">
              Voir en ligne ↗
            </a>
          ) : null}
          <button
            type="button"
            className="preview-add"
            onClick={() => {
              setName(config.siteUrl ?? '');
              setAdding(adding === 'site' ? undefined : 'site');
            }}
            aria-expanded={adding === 'site'}
            title="Lien du proto mis en ligne (Vercel, Netlify…)"
          >
            {config.siteUrl ? 'Modifier le lien' : '+ Lien en ligne'}
          </button>
          {dev.logs.length > 0 && (
            <details>
              <summary>Journal {dev.command && `· ${dev.command}`}</summary>
              <pre>{dev.logs.join('\n')}</pre>
            </details>
          )}
        </div>
      )}
      <div
        className={
          project && dev.state === 'running' && dev.url ? 'viewport-device' : 'viewport-scroll'
        }
      >
        {!project ? (
          <iframe
            title="Aperçu responsive"
            src={`/?preview=1&scenario=${encodeURIComponent(p.id)}&title=${encodeURIComponent(p.name)}`}
            width={f.width}
            height={f.height}
          />
        ) : dev.state === 'running' && dev.url && mode === 'build' ? (
          <PreviewBuild
            page={{ id: p.id, name: p.name, path }}
            pages={config.pages}
            onNavigate={setPage}
            devUrl={dev.url.replace(/\/$/, '')}
            width={f.width}
            height={f.height}
            code={code}
            figma={figma}
            onBuild={onBuild}
            onCodeProposal={onCodeProposal}
            onError={onError}
            onFocus={onFocus}
            chatChange={chatChange}
          />
        ) : dev.state === 'running' && dev.url ? (
          <DeviceFrame
            width={isPhone(f.width) ? closestIPhone(f.width, f.height).width : f.width}
            height={isPhone(f.width) ? closestIPhone(f.width, f.height).height : f.height}
            device={isPhone(f.width) ? closestIPhone(f.width, f.height) : undefined}
          >
            <iframe
              title="Aperçu responsive"
              src={dev.url + path}
              width={isPhone(f.width) ? closestIPhone(f.width, f.height).width : f.width}
              height={isPhone(f.width) ? closestIPhone(f.width, f.height).height : f.height}
            />
          </DeviceFrame>
        ) : (
          <p className="project-idle">
            {dev.state === 'starting'
              ? 'Lancement du serveur de dev de votre projet…'
              : 'Lancez le projet pour l’afficher ici, à taille réelle.'}
          </p>
        )}
      </div>
      {!(project && dev.state === 'running') && (
        <div className="panel-foot">
          {f.name} · {f.width} × {f.height} px CSS · aucun zoom appliqué · défilez si nécessaire
        </div>
      )}
    </section>
  );
}

import type { FigmaComponent } from '../../connectors/figma/library.js';
import { useEffect, useRef, useState } from 'react';
import { request } from './api.js';
import { defaultPreview, type PreviewConfig } from '../shared/dashboard.js';
import type { FolderInfo } from '../shared/connection.js';
import type { Focus } from '../shared/focus.js';
import type { DevStatus } from '../server/devserver.js';
import type { CodeProposal } from '../server/code.js';
import type { CodeComponent } from '../shared/components.js';
import PreviewBuild, { type BuildRequest } from './PreviewBuild.js';
import DeviceFrame, { closestIPhone, iPhones, isPhone } from './DeviceFrame.js';

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
  const [phoneModel, setPhoneModel] = useState('');
  const [page, setPage] = useState('cards');
  const [adding, setAdding] = useState<'format' | 'page' | 'rename' | 'site'>();
  const [name, setName] = useState('');
  const [removal, setRemoval] = useState<'page' | 'format'>();
  const [toolbarMenu, setToolbarMenu] = useState<'page' | 'format'>();
  const removalDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = removalDialog.current;
    if (removal && dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>('button')?.focus();
    } else if (!removal) dialog?.close();
  }, [removal]);

  const [removedConfig, setRemovedConfig] = useState<PreviewConfig>();
  const [saveError, setSaveError] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [width, setWidth] = useState('390');
  const [height, setHeight] = useState('844');
  // Relu quand le chat a créé une page : elle apparaît dans la barre.
  useEffect(() => {
    request<PreviewConfig>('preview')
      .then((next) => {
        setConfig(next);
        setConfigLoaded(true);
      })
      .catch((e) => setSaveError(e.message));
  }, [chatChange?.n]);
  const save = (next: PreviewConfig, undoable = false) => {
    setSavingConfig(true);
    setSaveError('');
    return request('preview', next)
      .then(() => {
        setConfig(next);
        setRemovedConfig(undoable ? config : undefined);
        return true;
      })
      .catch((e) => {
        setSaveError(e.message);
        return false;
      })
      .finally(() => setSavingConfig(false));
  };
  const baseFormat =
    config.formats.find((x) => x.id === format) ?? config.formats[0];
  const phone = isPhone(baseFormat.width)
    ? iPhones.find((d) => d.id === phoneModel)
    : undefined;
  const f = phone
    ? { ...baseFormat, width: phone.width, height: phone.height }
    : baseFormat;
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

  // Construire : la page de travail se resserre pour laisser la place au canvas.
  const building = !!project && mode === 'build' && dev.state === 'running';
  useEffect(() => {
    if (!building) return;
    document.documentElement.dataset.building = '';
    return () => {
      delete document.documentElement.dataset.building;
    };
  }, [building]);
  return (
    <>
      {project && (
        <div
          className={
            building ? 'project-run project-run-compact' : 'project-run'
          }
          role="status"
        >
          <div className="preview-project-identity">
            <strong>{project.name}</strong>
            <span className="preview-server-status">
              {dev.state === 'running'
                ? 'Prototype actif'
                : dev.state === 'starting'
                  ? 'Lancement…'
                  : dev.state === 'installing'
                    ? 'Installation…'
                    : dev.state === 'error'
                      ? 'Lancement impossible'
                      : 'Prototype arrêté'}
            </span>
          </div>
          {dev.state === 'running' && dev.url && (
            <a
              className="preview-proto-link"
              href={new URL(path, dev.url).href}
              target="_blank"
              rel="noreferrer"
            >
              {new URL(path, dev.url).href} ↗
            </a>
          )}
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
            <a
              className="preview-site"
              href={config.siteUrl}
              target="_blank"
              rel="noreferrer"
            >
              Ouvrir le lien partagé ↗
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
            title="Ajouter un lien existant ne publie pas le projet"
          >
            {config.siteUrl ? 'Modifier le lien' : '+ Lien partagé'}
          </button>
        </div>
      )}
      <div className="intro preview-intro">
        <h1 id="preview-title" tabIndex={-1}>
          Preview
        </h1>
      </div>
      <section className="panel mobile-panel" aria-labelledby="preview-title">
        <fieldset
          className="preview-bar preview-toolbar ux-controls"
          disabled={savingConfig || !configLoaded}
        >
          <div
            className="preview-toolbar-section"
            role="group"
            aria-label="Page"
          >
            <label className="preview-select">
              <span>Page</span>
              <select
                aria-label="Page affichée"
                value={p.id}
                onChange={(e) => {
                  setPage(e.target.value);
                  setToolbarMenu(undefined);
                }}
              >
                {config.pages.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <div
              className="preview-actions-menu"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget))
                  setToolbarMenu(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setToolbarMenu(undefined);
                  e.currentTarget.querySelector('button')?.focus();
                }
              }}
            >
              <button
                type="button"
                className="preview-more preview-manage"
                aria-label="Actions de la page"
                aria-expanded={toolbarMenu === 'page'}
                aria-controls="preview-page-actions"
                onClick={() =>
                  setToolbarMenu(toolbarMenu === 'page' ? undefined : 'page')
                }
              >
                Gérer
              </button>
              {toolbarMenu === 'page' && (
                <div
                  className="preview-actions-popover"
                  id="preview-page-actions"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setRoute('/');
                      setAdding('page');
                      setToolbarMenu(undefined);
                    }}
                  >
                    Ajouter une page
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setName(p.name);
                      setRoute(path);
                      setAdding('rename');
                      setToolbarMenu(undefined);
                    }}
                  >
                    Renommer la page
                  </button>
                  {(project ? config.pages.length > 1 : !builtIn.has(p.id)) && (
                    <button
                      type="button"
                      className="preview-danger"
                      onClick={() => {
                        setRemoval('page');
                        setToolbarMenu(undefined);
                      }}
                    >
                      Supprimer la page
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          {project && (
            <div className="preview-mode-switch" role="group" aria-label="Mode">
              <button
                type="button"
                aria-pressed={mode === 'view'}
                onClick={() => setMode('view')}
              >
                Aperçu
              </button>
              <button
                type="button"
                aria-pressed={mode === 'build'}
                onClick={() => setMode('build')}
              >
                Composer
              </button>
            </div>
          )}
          <div
            className="preview-toolbar-section preview-format-section"
            role="group"
            aria-label="Format"
          >
            <label className="preview-select">
              <span>Format</span>
              <select
                aria-label="Format d’affichage"
                value={phone ? `phone:${phone.id}` : f.id}
                onChange={(e) => {
                  if (e.target.value.startsWith('phone:')) {
                    setPhoneModel(e.target.value.slice(6));
                    const firstPhone = config.formats.find((x) =>
                      isPhone(x.width),
                    );
                    if (firstPhone) setFormat(firstPhone.id);
                  } else {
                    setFormat(e.target.value);
                    setPhoneModel('');
                  }
                  setToolbarMenu(undefined);
                }}
              >
                {config.formats.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {x.width} px
                  </option>
                ))}
                {config.formats.some((x) => isPhone(x.width)) && (
                  <optgroup label="Modèles d’iPhone">
                    {iPhones.map((d) => (
                      <option key={d.id} value={`phone:${d.id}`}>
                        {d.name} · {d.width} × {d.height}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <div
              className="preview-actions-menu"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget))
                  setToolbarMenu(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setToolbarMenu(undefined);
                  e.currentTarget.querySelector('button')?.focus();
                }
              }}
            >
              <button
                type="button"
                className="preview-more preview-manage"
                aria-label="Actions du format"
                aria-expanded={toolbarMenu === 'format'}
                aria-controls="preview-format-actions"
                onClick={() =>
                  setToolbarMenu(
                    toolbarMenu === 'format' ? undefined : 'format',
                  )
                }
              >
                Gérer
              </button>
              {toolbarMenu === 'format' && (
                <div
                  className="preview-actions-popover"
                  id="preview-format-actions"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setAdding('format');
                      setToolbarMenu(undefined);
                    }}
                  >
                    Ajouter un format
                  </button>
                  {config.formats.length > 1 && (
                    <button
                      type="button"
                      className="preview-danger"
                      onClick={() => {
                        setRemoval('format');
                        setToolbarMenu(undefined);
                      }}
                    >
                      Supprimer le format
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </fieldset>

        <dialog
          ref={removalDialog}
          className="preview-removal-dialog"
          aria-labelledby="preview-removal-title"
          aria-describedby="preview-removal-description"
          onCancel={(e) => {
            e.preventDefault();
            if (!savingConfig) setRemoval(undefined);
          }}
        >
          <h2 id="preview-removal-title">
            Retirer{' '}
            {removal === 'page'
              ? `la page « ${p.name} »`
              : `le format « ${f.name} »`}{' '}
            ?
          </h2>
          <p id="preview-removal-description">
            Elle sera retirée de l’aperçu. Le code est conservé.
          </p>
          {saveError && (
            <p role="alert" className="error">
              {saveError}
            </p>
          )}
          <div className="preview-removal-actions">
            <button
              disabled={savingConfig}
              onClick={() => setRemoval(undefined)}
            >
              Annuler
            </button>
            <button
              disabled={savingConfig}
              onClick={() => {
                save(
                  removal === 'page'
                    ? {
                        ...config,
                        pages: config.pages.filter((x) => x.id !== p.id),
                      }
                    : {
                        ...config,
                        formats: config.formats.filter((x) => x.id !== f.id),
                      },
                  true,
                ).then((ok) => {
                  if (ok) setRemoval(undefined);
                });
              }}
            >
              {savingConfig
                ? 'Retrait…'
                : removal === 'page'
                  ? 'Retirer la page'
                  : 'Retirer le format'}
            </button>
          </div>
        </dialog>
        {removedConfig && (
          <div className="ux-confirm">
            <span>Tu peux rétablir la configuration précédente.</span>
            <button
              disabled={savingConfig}
              onClick={() => {
                void save(removedConfig).then((ok) => {
                  if (ok) setRemovedConfig(undefined);
                });
              }}
            >
              Annuler le retrait
            </button>
          </div>
        )}
        {(!configLoaded || savingConfig) && !saveError && (
          <p className="ux-save" role="status">
            {savingConfig ? 'Enregistrement…' : 'Chargement…'}
          </p>
        )}
        {saveError && (
          <p className="error" role="alert">
            Enregistrement impossible : {saveError}. La configuration précédente
            est conservée.
          </p>
        )}
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
                    {
                      id,
                      name: n,
                      width: Number(width),
                      height: Number(height),
                    },
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
                      ? {
                          id,
                          name: n,
                          path: route === '/' ? routeOf(n) : route,
                        }
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
              {adding === 'rename'
                ? 'Renommer'
                : adding === 'site'
                  ? 'Enregistrer'
                  : 'Ajouter'}
            </button>
            <button type="button" onClick={close}>
              Annuler
            </button>
          </form>
        )}

        <div
          className={
            project && dev.state === 'running' && dev.url
              ? 'viewport-device'
              : 'viewport-scroll'
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
              width={
                isPhone(f.width)
                  ? closestIPhone(f.width, f.height).width
                  : f.width
              }
              height={
                isPhone(f.width)
                  ? closestIPhone(f.width, f.height).height
                  : f.height
              }
              device={
                isPhone(f.width) ? closestIPhone(f.width, f.height) : undefined
              }
            >
              <iframe
                title="Aperçu responsive"
                src={dev.url + path}
                width={
                  isPhone(f.width)
                    ? closestIPhone(f.width, f.height).width
                    : f.width
                }
                height={
                  isPhone(f.width)
                    ? closestIPhone(f.width, f.height).height
                    : f.height
                }
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
            {f.name} · {f.width} × {f.height} px CSS · aucun zoom appliqué ·
            défilez si nécessaire
          </div>
        )}
      </section>
    </>
  );
}

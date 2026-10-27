import { useEffect, useState } from 'react';
import { request } from './api.js';
import { defaultPreview, type PreviewConfig } from '../shared/dashboard.js';

// Page Preview : un format (largeur × hauteur réelles) et une page du proto.
// Formats et pages se créent ici et restent enregistrés sur ce poste.
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

export default function PreviewPage({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const [config, setConfig] = useState<PreviewConfig>(defaultPreview);
  const [format, setFormat] = useState('iphone');
  const [page, setPage] = useState('cards');
  const [adding, setAdding] = useState<'format' | 'page' | 'rename'>();
  const [name, setName] = useState('');
  const [width, setWidth] = useState('390');
  const [height, setHeight] = useState('844');
  useEffect(() => {
    request<PreviewConfig>('preview')
      .then(setConfig)
      .catch((e) => onError(e.message));
  }, []);
  const save = (next: PreviewConfig) => {
    setConfig(next);
    request('preview', next).catch((e) => onError(e.message));
  };
  const f = config.formats.find((x) => x.id === format) ?? config.formats[0];
  const p = config.pages.find((x) => x.id === page) ?? config.pages[0];
  const close = () => {
    setAdding(undefined);
    setName('');
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
            onClick={() => setAdding(adding === 'page' ? undefined : 'page')}
            aria-expanded={adding === 'page'}
          >
            + Page
          </button>
          <button
            type="button"
            className="preview-add"
            onClick={() => {
              setName(p.name);
              setAdding(adding === 'rename' ? undefined : 'rename');
            }}
            aria-expanded={adding === 'rename'}
          >
            Renommer
          </button>
          {!builtIn.has(p.id) && (
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
              save({ ...config, pages: [...config.pages, { id, name: n }] });
              setPage(id);
            } else
              save({
                ...config,
                pages: config.pages.map((x) =>
                  x.id === p.id ? { ...x, name: n } : x,
                ),
              });
            close();
          }}
        >
          <label className="field">
            {adding === 'format'
              ? 'Nom du format'
              : adding === 'page'
                ? 'Nom de la page'
                : 'Nouveau nom'}
            <input
              autoFocus
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                adding === 'format' ? 'Android, iPad mini…' : 'Profil, Panier…'
              }
              required
            />
          </label>
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
            {adding === 'rename' ? 'Renommer' : 'Ajouter'}
          </button>
          <button type="button" onClick={close}>
            Annuler
          </button>
        </form>
      )}

      <div className="viewport-scroll">
        <iframe
          title="Aperçu responsive"
          src={`/?preview=1&scenario=${encodeURIComponent(p.id)}&title=${encodeURIComponent(p.name)}`}
          width={f.width}
          height={f.height}
        />
      </div>
      <div className="panel-foot">
        {f.name} · {f.width} × {f.height} px CSS · aucun zoom appliqué · défilez
        si nécessaire
      </div>
    </section>
  );
}

import { useState } from 'react';
import { request } from './api.js';
import type { FigmaFileStatus } from '../../connectors/figma/reader.js';
import type { ConnectionStatus, FolderInfo } from '../shared/connection.js';

// Ouvrir un projet, comme un dossier dans Claude Code : le dépôt Git local
// où vit le proto, et le fichier Figma précis qui l'accompagne.
export default function OpenProject({
  status,
  onDone,
  onClose,
}: {
  status?: ConnectionStatus;
  onDone: (status: ConnectionStatus) => void;
  // Absent au premier lancement : on ouvre un projet ou on passe.
  onClose?: () => void;
}) {
  const [folder, setFolder] = useState(status?.saved.folder ?? '');
  const [figmaUrl, setFigmaUrl] = useState(status?.saved.figmaUrl ?? '');
  const [info, setInfo] = useState<FolderInfo | undefined>(status?.project);
  const [figma, setFigma] = useState<FigmaFileStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const attempt = async (action: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const inspect = (path: string) =>
    attempt(async () => {
      setInfo(undefined);
      if (path.trim())
        setInfo(
          await request<FolderInfo>('connection/inspect', {
            folder: path.trim(),
          }),
        );
    });
  const checkFigma = () =>
    attempt(async () =>
      setFigma(
        await request<FigmaFileStatus>('connection/figma', {
          url: figmaUrl.trim(),
        }),
      ),
    );

  return (
    <main className="open-project">
      <section aria-labelledby="open-title">
        <h1 id="open-title">Ouvrir un projet</h1>
        <p className="open-lead">
          Choisissez le dossier de votre projet (votre dépôt Git) et son fichier
          Figma. DS-Studio travaillera dans ce dossier, et seulement dans
          celui-ci.
        </p>

        <h2>1. Dossier du projet</h2>
        <div className="open-row">
          <label className="field">
            Chemin du dossier
            <input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              onBlur={() => folder !== info?.folder && void inspect(folder)}
              placeholder="/chemin/vers/mon-projet"
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void attempt(async () => {
                const { folder: picked } = await request<{
                  folder: string | null;
                }>('connection/pick', {});
                if (picked) {
                  setFolder(picked);
                  await inspect(picked);
                }
              })
            }
          >
            Choisir un dossier…
          </button>
        </div>
        {info && (
          <p
            className={`open-status ${info.git ? 'ok' : 'warn'}`}
            role="status"
          >
            {info.git
              ? `Dépôt Git « ${info.name} » · branche ${info.git.branch ?? 'détachée'} · ${info.git.remote ?? 'sans dépôt distant'}`
              : `« ${info.name} » n’est pas un dépôt Git : le push ne sera pas possible.`}
          </p>
        )}

        <h2>2. Fichier Figma</h2>
        <div className="open-row">
          <label className="field">
            Lien du fichier Figma
            <input
              type="url"
              value={figmaUrl}
              onChange={(e) => {
                setFigmaUrl(e.target.value);
                setFigma(undefined);
              }}
              placeholder="https://www.figma.com/design/…"
            />
          </label>
          <button
            type="button"
            disabled={busy || !figmaUrl.trim()}
            onClick={() => void checkFigma()}
          >
            Vérifier
          </button>
        </div>
        {figma && (
          <p
            className={`open-status ${figma.connected ? 'ok' : 'warn'}`}
            role="status"
          >
            {figma.label}
          </p>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="open-actions">
          <button
            className="studio-primary"
            disabled={busy || !folder.trim()}
            onClick={() =>
              void attempt(async () =>
                onDone(
                  await request<ConnectionStatus>('connection', {
                    folder: folder.trim(),
                    ...(figmaUrl.trim() ? { figmaUrl: figmaUrl.trim() } : {}),
                  }),
                ),
              )
            }
          >
            Ouvrir le projet
          </button>
          {onClose ? (
            <button type="button" onClick={onClose}>
              Annuler
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void attempt(async () =>
                  onDone(
                    await request<ConnectionStatus>('connection', {
                      skipped: true,
                    }),
                  ),
                )
              }
            >
              Plus tard
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

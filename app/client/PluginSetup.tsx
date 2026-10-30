import { useEffect, useState } from 'react';
import { request } from './api.js';
import type { Proposal } from '../shared/model.js';

// Page Plugin : ce qui relie le DS au code et à Figma, au même endroit que
// la synchro. Les tokens du projet (design-system/tokens.json) à importer,
// et l'installation du plugin Figma avec son code d'appairage.
interface ProjectTokens {
  file: string;
  tokens: Record<string, unknown>;
  skipped: { name: string; reason: string }[];
}

export default function PluginSetup({
  revision,
  onProposal,
}: {
  revision: number;
  onProposal: (p: Proposal) => void;
}) {
  const [project, setProject] = useState<ProjectTokens>();
  const [tokenError, setTokenError] = useState('');
  const [pairing, setPairing] = useState<{ token: string; manifest: string }>();
  const [showCode, setShowCode] = useState(false);
  useEffect(() => {
    request<{ token: string; manifest: string }>('plugin/pairing')
      .then(setPairing)
      .catch(() => undefined);
    request<ProjectTokens>('project-tokens')
      .then(setProject)
      .catch((e) => setTokenError(e.message));
  }, []);
  return (
    <>
        <section className="figma-tokens" aria-label="Tokens du projet">
          <strong>Tokens du projet</strong>
          {project ? (
            <>
              <p>
                {Object.keys(project.tokens).length} tokens lisibles dans{' '}
                <code>{project.file}</code>
                {project.skipped.length > 0 &&
                  ` · ${project.skipped.length} non repris (typographies composées, ombres, transparences…)`}
              </p>
              <button
                type="button"
                className="studio-primary"
                onClick={() =>
                  request<Proposal>('project-tokens/import', { revision })
                    .then(onProposal)
                    .catch((e) => setTokenError(e.message))
                }
              >
                Importer dans DS-Studio
              </button>
            </>
          ) : (
            <p>{tokenError || 'Lecture…'}</p>
          )}
          {project && tokenError && <p className="error">{tokenError}</p>}
        </section>
        <details className="figma-tokens figma-plugin">
          <summary>
            <strong>Plugin Figma DS-Studio</strong>
          </summary>
          <p>
            Il applique tes tokens validés aux variables de ton fichier Figma :
            les composants qui les utilisent suivent.
          </p>
          <ol>
            <li>
              Figma (app de bureau) → Plugins → Développement → Importer un
              plugin depuis un manifeste.
            </li>
            <li>
              Choisis :{' '}
              <code>{pairing?.manifest ?? 'figma-plugin/manifest.json'}</code>
            </li>
            <li>Lance « DS-Studio » dans ton fichier, colle ce code :</li>
          </ol>
          {pairing && (
            <div className="plugin-code">
              <code>{showCode ? pairing.token : '•'.repeat(12)}</code>
              <button type="button" onClick={() => setShowCode(!showCode)}>
                {showCode ? 'Masquer' : 'Afficher'}
              </button>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard?.writeText(pairing.token)
                }
              >
                Copier
              </button>
              <button
                type="button"
                title="Le plugin devra recevoir le nouveau code"
                onClick={() =>
                  request<{ token: string; manifest: string }>(
                    'plugin/pairing/renew',
                    {},
                  )
                    .then(setPairing)
                    .catch(() => undefined)
                }
              >
                Renouveler
              </button>
            </div>
          )}
        </details>
    </>
  );
}

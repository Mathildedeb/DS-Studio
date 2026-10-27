import { useEffect, useRef } from 'react';
import type { CodeProposal } from '../server/code.js';

// Diff de code à valider : rien n'est écrit avant « Appliquer ».
export default function CodeReview({
  proposal,
  busy,
  error,
  onApply,
  onCancel,
}: {
  proposal?: CodeProposal;
  busy: boolean;
  error: string;
  onApply: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (proposal) {
      dialog.current?.showModal();
      cancel.current?.focus();
    } else dialog.current?.close();
  }, [proposal]);
  return (
    <dialog
      ref={dialog}
      className="code-review"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onCancel();
      }}
      aria-labelledby="code-title"
    >
      <h2 id="code-title">Valider la modification de code</h2>
      <p>
        Proposée par Clodo · {proposal?.files.length} fichier(s). Rien n’est
        écrit avant votre accord, et vous pourrez annuler ensuite.
      </p>
      <div className="diff-scroll">
        {proposal?.hunks.map((h, i) => (
          <section key={i} className="code-hunk">
            <h3>
              {h.file} <span>· ligne {h.line}</span>
            </h3>
            <pre>
              {h.removed.map((l, j) => (
                <del key={`r${j}`}>- {l}</del>
              ))}
              {h.added.map((l, j) => (
                <ins key={`a${j}`}>+ {l}</ins>
              ))}
            </pre>
          </section>
        ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button ref={cancel} onClick={onCancel} disabled={busy}>
          Ne pas appliquer
        </button>
        <button className="studio-primary" onClick={onApply} disabled={busy}>
          {busy ? 'Écriture…' : 'Appliquer'}
        </button>
      </div>
    </dialog>
  );
}

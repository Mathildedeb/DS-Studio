import { useState } from 'react';
import { Check, Copy, Star } from 'lucide-react';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

export function MessageActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="message-actions">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={copied ? 'Copié' : 'Copier la réponse'}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setError('');
              } catch {
                setError('Copie indisponible dans ce navigateur.');
              }
            }}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? 'Copié' : 'Copier'}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Marquer comme favori pour cette session"
            aria-pressed={saved}
            onClick={() => setSaved(!saved)}
          >
            <Star fill={saved ? 'currentColor' : 'none'} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Favori pour cette session</TooltipContent>
      </Tooltip>
      <span className="sr-only" role="status">
        {error || (copied ? 'Réponse copiée.' : '')}
      </span>
    </div>
  );
}

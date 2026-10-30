import type { ReactNode } from 'react';
import { Card, CardContent } from '../ui/card';
import { MessageActions } from './MessageActions';

export function ResponseCard({
  prompt,
  tone = 'paper',
  className = '',
  children,
  copyText,
}: {
  prompt: string;
  tone?: 'paper' | 'mist' | 'orange' | 'lime';
  className?: string;
  children: ReactNode;
  copyText: string;
}) {
  return (
    <Card
      aria-label={prompt}
      className={`response-card response-${tone} ${className}`}
    >
      <CardContent className="response-content">{children}</CardContent>
      <MessageActions text={copyText} />
    </Card>
  );
}

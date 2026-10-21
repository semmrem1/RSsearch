import { useEffect, useRef, useState } from 'react';
import { teilen, type TeilenInhalt } from '../lib/teilen';

type Zustand = 'bereit' | 'kopiert' | 'fehler';

/**
 * Teilen-Knopf: öffnet auf dem Handy das Share-Sheet (WhatsApp, Mail …),
 * auf dem Desktop kopiert er den Link und zeigt kurz «Link kopiert».
 */
export default function TeilenButton({ inhalt, className, nurIcon, style }: {
  inhalt: TeilenInhalt; className?: string; nurIcon?: boolean; style?: React.CSSProperties;
}) {
  const [zustand, setZustand] = useState<Zustand>('bereit');
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current !== null) { window.clearTimeout(timer.current); } }, []);

  async function klick() {
    const ergebnis = await teilen(inhalt);
    if (ergebnis === 'geteilt' || ergebnis === 'abgebrochen') { return; }
    setZustand(ergebnis === 'kopiert' ? 'kopiert' : 'fehler');
    if (timer.current !== null) { window.clearTimeout(timer.current); }
    timer.current = window.setTimeout(() => setZustand('bereit'), 2200);
  }

  const label = zustand === 'kopiert' ? 'Link kopiert' : zustand === 'fehler' ? 'Kopieren fehlgeschlagen' : 'Teilen';
  const title = 'Link an die andere Person senden (Share-Sheet oder Zwischenablage)';
  return (
    <button type="button" className={(className !== undefined ? className : 'btn') + (zustand === 'kopiert' ? ' teilen-ok' : '')} onClick={klick} title={title} aria-label={nurIcon ? label : undefined} aria-live="polite" style={style}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
      </svg>
      {nurIcon ? null : <span>{label}</span>}
    </button>
  );
}

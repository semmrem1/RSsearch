import type { CSSProperties, ReactNode } from 'react';
import type { ScoreDetail } from '../lib/types';
import { dateShort } from '../lib/format';
import HoverPop from './HoverPop';

/** Farbe für den automatischen Score 0..100 */
export function scoreFarbe(s: number | null | undefined): string {
  if (s === null || s === undefined) { return 'var(--ink-4)'; }
  if (s >= 70) { return 'var(--green)'; }
  if (s >= 55) { return 'var(--green-dark)'; }
  if (s >= 35) { return 'var(--amber)'; }
  return 'var(--warm)';
}

/** Score-Badge (0 bis 100) mit Erklärung beim Überfahren: Faktoren, Punkte und Hinweise. */
export function ScoreBadge({ score, detail, className, style, gross }: { score: number | null | undefined; detail: ScoreDetail | null | undefined; className?: string; style?: CSSProperties; gross?: boolean }) {
  const farbe = scoreFarbe(score);
  const badge = <span className={'score-badge' + (gross ? ' gross' : '')} style={{ borderColor: farbe, color: farbe }}>{score !== null && score !== undefined ? score : '–'}</span>;
  return <ScoreInfo score={score} detail={detail} className={className} style={style}>{badge}</ScoreInfo>;
}

export default function ScoreInfo({ score, detail, children, className, style }: { score: number | null | undefined; detail: ScoreDetail | null | undefined; children: ReactNode; className?: string; style?: CSSProperties }) {
  const farbe = scoreFarbe(score);
  const faktoren = detail !== null && detail !== undefined ? detail.faktoren : [];
  const hinweise = detail !== null && detail !== undefined ? detail.hinweise : [];
  const inhalt = (
    <>
      <div className="ampel-pop-kopf">
        <strong style={{ color: farbe, fontSize: 16 }}>Score {score !== null && score !== undefined ? score : '–'} von 100</strong>
        <span className="xs muted" style={{ marginLeft: 'auto' }}>{detail !== null && detail !== undefined && detail.punkte_roh !== undefined ? 'Stand ' + dateShort(detail.stand) : 'automatisch berechnet'}</span>
      </div>
      {faktoren.length === 0 ? <div className="small muted" style={{ padding: '8px 0' }}>{hinweise.length > 0 ? hinweise.join(' · ') : 'Noch keine Berechnung (kein Preis bekannt).'}</div> : (
        <div className="ampel-pop-liste">
          {faktoren.map((f) => {
            const anteil = f.max > 0 ? f.punkte / f.max : 0;
            const fb = anteil >= 0.7 ? 'var(--green)' : anteil >= 0.4 ? 'var(--amber)' : 'var(--warm)';
            return (
              <div key={f.name} className="ampel-pop-zeile score-zeile">
                <span className="score-balken" aria-hidden="true"><i style={{ height: Math.max(4, Math.round(anteil * 100)) + '%', background: fb }} /></span>
                <span className="ampel-pop-name">{f.name}<span className="xs tnum" style={{ color: fb, fontWeight: 600 }}>{Number(f.punkte).toFixed(f.punkte % 1 === 0 ? 0 : 1)} / {f.max}</span></span>
                <span className="ampel-pop-text">{f.text}</span>
              </div>
            );
          })}
        </div>
      )}
      {hinweise.length > 0 && faktoren.length > 0 ? <div className="small" style={{ color: 'var(--warm-dark)', fontWeight: 600, padding: '6px 0 0' }}>{hinweise.join(' · ')}</div> : null}
      <div className="xs muted ampel-pop-fuss">Objektive Faktoren: Tragbarkeit, Budget, Preis pro m², Fläche, Zimmer, Typ, Baujahr, Heizung, Steuern, Pendeln. Eure Bewertungen fliessen nicht ein. Wird beim Eintreffen, bei Änderungen und täglich neu gerechnet.</div>
    </>
  );
  return <HoverPop inhalt={inhalt} label={'Score ' + (score !== null && score !== undefined ? score : '–') + ' von 100, Erklärung anzeigen'} className={className} style={style} breite={480}>{children}</HoverPop>;
}

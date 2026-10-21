import type { CSSProperties, ReactNode } from 'react';
import { AMPEL_FARBE, AMPEL_LABEL, PRUEF_FARBE, type Ampel } from '../lib/ampel';
import HoverPop from './HoverPop';

const PRUEF_LABEL = { ok: 'ok', gelb: 'prüfen', rot: 'kritisch', offen: 'offen' };

/** Auswertung aller Ampel-Prüfungen beim Überfahren, Fokus oder Antippen. */
export default function AmpelInfo({ ampel, children, className, style }: { ampel: Ampel; children: ReactNode; className?: string; style?: CSSProperties }) {
  const kritisch = ampel.pruefungen.filter((x) => x.stufe === 'rot').length;
  const pruefen = ampel.pruefungen.filter((x) => x.stufe === 'gelb').length;
  const offenAnz = ampel.pruefungen.filter((x) => x.stufe === 'offen').length;
  const inhalt = (
    <>
      <div className="ampel-pop-kopf">
        <span className="ampel-dot" style={{ background: AMPEL_FARBE[ampel.stufe] }} />
        <strong style={{ color: AMPEL_FARBE[ampel.stufe] }}>{AMPEL_LABEL[ampel.stufe]}</strong>
        <span className="xs muted" style={{ marginLeft: 'auto' }}>{kritisch > 0 ? kritisch + ' kritisch' : ''}{kritisch > 0 && pruefen > 0 ? ' · ' : ''}{pruefen > 0 ? pruefen + ' zu prüfen' : ''}{(kritisch > 0 || pruefen > 0) && offenAnz > 0 ? ' · ' : ''}{offenAnz > 0 ? offenAnz + ' offen' : ''}</span>
      </div>
      <div className="ampel-pop-liste">
        {ampel.pruefungen.map((x) => (
          <div key={x.name} className="ampel-pop-zeile">
            <span className="ampel-dot" style={{ background: PRUEF_FARBE[x.stufe], marginTop: 4 }} />
            <span className="ampel-pop-name">{x.name}<span className="xs" style={{ color: PRUEF_FARBE[x.stufe], fontWeight: 600 }}>{PRUEF_LABEL[x.stufe]}</span></span>
            <span className="ampel-pop-text">{x.text}</span>
          </div>
        ))}
      </div>
      <div className="xs muted ampel-pop-fuss">Rot schlägt Gelb, Gelb schlägt Grün. Grau, solange Haushalt und Bewertungen fehlen.</div>
    </>
  );
  return <HoverPop inhalt={inhalt} label={'Einschätzung ' + AMPEL_LABEL[ampel.stufe] + ', Details anzeigen'} className={className} style={style}>{children}</HoverPop>;
}

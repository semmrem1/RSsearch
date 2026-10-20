import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AMPEL_FARBE, AMPEL_LABEL, PRUEF_FARBE, type Ampel } from '../lib/ampel';

const PRUEF_LABEL = { ok: 'ok', gelb: 'prüfen', rot: 'kritisch', offen: 'offen' };

/**
 * Zeigt beim Überfahren (Maus, Tastaturfokus) oder Antippen (Touch) eine Auswertung aller Ampel-Prüfungen.
 * Wird in document.body gerendert, damit die Tabelle mit overflow-x die Box nicht abschneidet.
 */
export default function AmpelInfo({ ampel, children, className, style }: { ampel: Ampel; children: ReactNode; className?: string; style?: CSSProperties }) {
  const [offen, setOffen] = useState(false);
  const [pos, setPos] = useState<{ top: number | null; bottom: number | null; left: number; breite: number; maxHoehe: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const klickIgnorieren = useRef(false);

  const zeigen = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    const el = ref.current;
    if (el === null) { return; }
    const r = el.getBoundingClientRect();
    const breite = Math.min(440, window.innerWidth - 24);
    let left = r.left;
    if (left + breite > window.innerWidth - 12) { left = window.innerWidth - 12 - breite; }
    if (left < 12) { left = 12; }
    const unten = window.innerHeight - r.bottom - 18;
    const oben = r.top - 18;
    if (unten >= 260 || unten >= oben) { setPos({ top: r.bottom + 6, bottom: null, left, breite, maxHoehe: Math.max(160, unten) }); }
    else { setPos({ top: null, bottom: window.innerHeight - r.top + 6, left, breite, maxHoehe: Math.max(160, oben) }); }
    setOffen(true);
  };
  const verstecken = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); }
    timer.current = window.setTimeout(() => { setOffen(false); timer.current = null; }, 120);
  };

  useEffect(() => {
    if (!offen) { return; }
    const schliessen = (e: PointerEvent) => {
      if (ref.current !== null && e.target instanceof Node && ref.current.contains(e.target)) {
        // zweites Antippen (Touch) schliesst; der folgende Click darf nicht wieder öffnen
        if (e.pointerType !== 'mouse') { klickIgnorieren.current = true; setOffen(false); }
        return;
      }
      setOffen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOffen(false); } };
    document.addEventListener('pointerdown', schliessen);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', zeigen, true);
    return () => { document.removeEventListener('pointerdown', schliessen); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', zeigen, true); };
  }, [offen]); // eslint-disable-line react-hooks/exhaustive-deps

  const kritisch = ampel.pruefungen.filter((x) => x.stufe === 'rot').length;
  const pruefen = ampel.pruefungen.filter((x) => x.stufe === 'gelb').length;
  const offenAnz = ampel.pruefungen.filter((x) => x.stufe === 'offen').length;

  return (
    <>
      <span
        ref={ref} className={className} style={style} tabIndex={0} role="button" aria-haspopup="dialog" aria-expanded={offen}
        aria-label={'Einschätzung ' + AMPEL_LABEL[ampel.stufe] + ', Details anzeigen'}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') { zeigen(); } }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') { verstecken(); } }} onFocus={zeigen} onBlur={verstecken}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (klickIgnorieren.current) { klickIgnorieren.current = false; return; } zeigen(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (offen) { setOffen(false); } else { zeigen(); } } }}
      >
        {children}
      </span>
      {offen && pos !== null ? createPortal(
        <div className="ampel-pop" role="dialog" aria-label="Auswertung der Einschätzung" style={{ top: pos.top !== null ? pos.top : undefined, bottom: pos.bottom !== null ? pos.bottom : undefined, left: pos.left, width: pos.breite, maxHeight: pos.maxHoehe, overflowY: 'auto' }} onMouseEnter={zeigen} onMouseLeave={verstecken}>
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
        </div>,
        document.body,
      ) : null}
    </>
  );
}

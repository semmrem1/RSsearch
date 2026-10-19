import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import { FILTER_STANDARD, filterAktiv, ortListe, type ObjektFilter } from '../lib/filter';
import type { ObjektUebersicht } from '../lib/types';

interface Props {
  objekte: ObjektUebersicht[];
  wert: ObjektFilter;
  onChange: (f: ObjektFilter) => void;
  treffer: number;
  standard?: ObjektFilter;
  /** Felder, die auf dieser Seite nicht angeboten werden */
  ohne?: ('phase' | 'markt' | 'q')[];
}

function OrtAuswahl({ objekte, gewaehlt, onChange }: { objekte: ObjektUebersicht[]; gewaehlt: string[]; onChange: (orte: string[]) => void }) {
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState('');
  const box = useRef<HTMLDivElement | null>(null);
  const orte = ortListe(objekte);
  const sichtbar = orte.filter((o) => o.ort.toLowerCase().indexOf(suche.trim().toLowerCase()) !== -1);

  useEffect(() => {
    if (!offen) { return; }
    const zu = (e: MouseEvent | TouchEvent) => {
      if (box.current !== null && !box.current.contains(e.target as Node)) { setOffen(false); }
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOffen(false); } };
    document.addEventListener('mousedown', zu);
    document.addEventListener('touchstart', zu);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', zu); document.removeEventListener('touchstart', zu); document.removeEventListener('keydown', esc); };
  }, [offen]);

  function umschalten(ort: string) {
    onChange(gewaehlt.indexOf(ort) === -1 ? [...gewaehlt, ort] : gewaehlt.filter((x) => x !== ort));
  }

  const label = gewaehlt.length === 0 ? 'Alle Ortschaften' : gewaehlt.length === 1 ? gewaehlt[0] : gewaehlt.length + ' Ortschaften';

  return (
    <div className="ort-auswahl" ref={box}>
      <button type="button" className={'select ort-btn' + (gewaehlt.length > 0 ? ' aktiv' : '')} aria-haspopup="listbox" aria-expanded={offen} onClick={() => setOffen(!offen)}>
        <span>{label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {offen ? <div className="ort-backdrop" aria-hidden="true" onClick={() => setOffen(false)} /> : null}
      {offen ? (
        <div className="ort-panel" role="dialog" aria-label="Ortschaften wählen">
          <div className="ort-panel-head">
            <input className="input" type="search" placeholder="Ortschaft suchen" value={suche} onChange={(e) => setSuche(e.target.value)} aria-label="Ortschaft suchen" />
            <div className="ort-panel-aktionen">
              <button type="button" className="linkbtn" onClick={() => onChange([])}>Alle zeigen</button>
              <span className="xs muted">{gewaehlt.length} gewählt</span>
            </div>
          </div>
          <div className="ort-liste" role="listbox" aria-multiselectable="true">
            {sichtbar.length === 0 ? <div className="small muted" style={{ padding: 12 }}>Keine Ortschaft gefunden</div> : null}
            {sichtbar.map((o) => (
              <label key={o.ort} className="ort-item">
                <input type="checkbox" checked={gewaehlt.indexOf(o.ort) !== -1} onChange={() => umschalten(o.ort)} />
                <span>{o.ort}</span>
                <span className="xs muted tnum">{o.n}</span>
              </label>
            ))}
          </div>
          <button type="button" className="btn primary ort-fertig" onClick={() => setOffen(false)}>Fertig</button>
        </div>
      ) : null}
    </div>
  );
}

export default function FilterBar({ objekte, wert, onChange, treffer, standard, ohne }: Props) {
  const { stufen, profiles, me } = useApp();
  const std = standard !== undefined ? standard : FILTER_STANDARD;
  const phasen = Array.from(new Map(stufen.map((s) => [s.phase, s.phase_name])).entries());
  const zeige = (k: 'phase' | 'markt' | 'q') => ohne === undefined || ohne.indexOf(k) === -1;
  const set = (patch: Partial<ObjektFilter>) => onChange({ ...wert, ...patch });

  return (
    <div className="filterbar">
      <div className="filter-felder">
        {zeige('q') ? (
          <input className="input f-suche" type="search" placeholder="Suche: Adresse, Makler, ID" aria-label="Suche" value={wert.q} onChange={(e) => set({ q: e.target.value })} />
        ) : null}
        <OrtAuswahl objekte={objekte} gewaehlt={wert.orte} onChange={(orte) => set({ orte })} />
        {zeige('markt') ? (
          <select className="select" aria-label="Marktstatus" value={wert.markt} onChange={(e) => set({ markt: e.target.value as ObjektFilter['markt'] })}>
            <option value="alle">Markt: alle</option>
            <option value="aktiv">Aktiv am Markt</option>
            <option value="reserviert">Reserviert</option>
            <option value="verkauft">Verkauft</option>
            <option value="offline">Nicht mehr online</option>
          </select>
        ) : null}
        {zeige('phase') ? (
          <select className="select" aria-label="Phase" value={wert.phase} onChange={(e) => set({ phase: e.target.value })}>
            <option value="alle">Phase: alle</option>
            {phasen.map(([p, n]) => <option key={p} value={String(p)}>{n}</option>)}
          </select>
        ) : null}
        <select className="select" aria-label="Favoriten" value={wert.fav} onChange={(e) => set({ fav: e.target.value })}>
          <option value="alle">Favoriten: alle</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>Favoriten {p.name.split(' ')[0]}{me !== null && me.id === p.id ? ' (ich)' : ''}</option>)}
        </select>
        <label className="f-check small">
          <input type="checkbox" checked={wert.ausgeschieden} onChange={(e) => set({ ausgeschieden: e.target.checked })} /> Ausgeschiedene
        </label>
        <label className="f-check small">
          <input type="checkbox" checked={wert.nurTragbar} onChange={(e) => set({ nurTragbar: e.target.checked })} /> Nur tragbar
        </label>
        <label className="f-check small">
          <input type="checkbox" checked={wert.nurUneinig} onChange={(e) => set({ nurUneinig: e.target.checked })} /> Nur uneinig
        </label>
        <label className="f-check small" title="ÖV-Pendelzeit zu meinem Arbeitsort">
          🚆 max.
          <input className="input" type="number" inputMode="numeric" min={5} max={180} step={5} placeholder="Min" value={wert.pendelMax !== null ? wert.pendelMax : ''} onChange={(e) => set({ pendelMax: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 76, minHeight: 36 }} />
          Min
        </label>
      </div>
      <div className="filter-status">
        {wert.orte.map((o) => (
          <button key={o} type="button" className="chip accent chip-x" onClick={() => set({ orte: wert.orte.filter((x) => x !== o) })} aria-label={o + ' entfernen'}>{o} ×</button>
        ))}
        <span className="small muted tnum" style={{ marginLeft: 'auto' }}>{treffer} von {objekte.length} Inseraten</span>
        {filterAktiv(wert, std) ? <button type="button" className="linkbtn small" onClick={() => onChange(std)}>Filter zurücksetzen</button> : null}
      </div>
    </div>
  );
}

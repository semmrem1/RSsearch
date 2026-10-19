import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { chf } from '../lib/format';
import type { Objekt, ObjektUebersicht } from '../lib/types';

interface Props { objekt: Objekt; onClose: () => void; onDone: (zielId: string) => void }

/** Dublette manuell zusammenführen: das aktuelle Objekt geht im gewählten Ziel auf. */
export default function ZusammenfuehrenModal({ objekt, onClose, onDone }: Props) {
  const [alle, setAlle] = useState<ObjektUebersicht[]>([]);
  const [q, setQ] = useState('');
  const [ziel, setZiel] = useState<string | null>(null);
  const [richtung, setRichtung] = useState<'in_ziel' | 'in_dieses'>('in_ziel');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('v_objekte_uebersicht').select('*').neq('id', objekt.id).order('ort')
      .then(({ data }) => { if (data) { setAlle(data as ObjektUebersicht[]); } });
  }, [objekt.id]);

  const kandidat = (o: ObjektUebersicht): boolean => {
    if (o.ort.toLowerCase() !== objekt.ort.toLowerCase()) { return false; }
    if (objekt.zimmer !== null && o.zimmer !== null && Math.abs(Number(o.zimmer) - Number(objekt.zimmer)) > 0.5) { return false; }
    if (objekt.flaeche_m2 !== null && o.flaeche_m2 !== null && Math.abs(o.flaeche_m2 - objekt.flaeche_m2) / Math.max(1, objekt.flaeche_m2) > 0.1) { return false; }
    return true;
  };
  const needle = q.trim().toLowerCase();
  const liste = (needle
    ? alle.filter((o) => (o.ort + ' ' + (o.adresse || '') + ' ' + (o.titel || '') + ' ' + o.quellen.map((x) => x.makler + ' ' + (x.externe_id || '')).join(' ')).toLowerCase().indexOf(needle) !== -1)
    : alle.filter(kandidat)).slice(0, 30);

  async function ausfuehren() {
    if (ziel === null) { return; }
    setBusy(true); setFehler(null);
    const quelle = richtung === 'in_ziel' ? objekt.id : ziel;
    const zielId = richtung === 'in_ziel' ? ziel : objekt.id;
    const { error } = await supabase.rpc('objekte_zusammenfuehren', { p_quelle: quelle, p_ziel: zielId });
    setBusy(false);
    if (error) { setFehler(error.message); return; }
    onDone(zielId);
  }

  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="zf-h" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2 id="zf-h">Mit anderem Objekt zusammenführen</h2>
          <button type="button" className="btn sm" onClick={onClose}>Schliessen</button>
        </div>
        <p className="small muted">Quellen, Verlauf, Dokumente und Bewertungen werden im Ziel vereint. Das aufgelöste Objekt wird ausgeblendet. Vorschläge: gleicher Ort, ähnliche Zimmer und Fläche.</p>
        <input className="input" type="search" placeholder="Anderes Objekt suchen (Ort, Adresse, Makler, ID)" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="rows" style={{ maxHeight: 320, overflowY: 'auto' }}>
          {liste.length === 0 ? <div className="small muted" style={{ padding: 12 }}>Keine Vorschläge. Über die Suche ein Objekt wählen.</div> : null}
          {liste.map((o) => (
            <label key={o.id} className="zf-item">
              <input type="radio" name="ziel" checked={ziel === o.id} onChange={() => setZiel(o.id)} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{o.ort}{o.adresse ? ', ' + o.adresse : ''}{o.titel ? ' · ' + o.titel : ''}</span>
                <span className="xs muted">{[o.zimmer !== null ? o.zimmer + ' Zi' : null, o.flaeche_m2 !== null ? o.flaeche_m2 + ' m²' : null, chf(o.preis_chf, true), o.quellen.map((x) => x.makler).join(', '), o.stufe_name].filter((x) => x !== null).join(' · ')}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Richtung">
          <button type="button" aria-pressed={richtung === 'in_ziel'} onClick={() => setRichtung('in_ziel')}>Dieses Objekt ins gewählte übernehmen</button>
          <button type="button" aria-pressed={richtung === 'in_dieses'} onClick={() => setRichtung('in_dieses')}>Gewähltes in dieses übernehmen</button>
        </div>
        {fehler !== null ? <div className="notice">{fehler}</div> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" disabled={ziel === null || busy} onClick={ausfuehren}>{busy ? 'Führe zusammen …' : 'Zusammenführen'}</button>
        </div>
      </div>
    </div>
  );
}

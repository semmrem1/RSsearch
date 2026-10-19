import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import type { ObjektTyp } from '../lib/types';
import { istDirektlink } from '../lib/links';

interface Props {
  onClose: () => void;
  onSaved: (id: string) => void;
}

export default function ObjektForm({ onClose, onSaved }: Props) {
  const [ort, setOrt] = useState('');
  const [plz, setPlz] = useState('');
  const [adresse, setAdresse] = useState('');
  const [typ, setTyp] = useState<ObjektTyp>('wohnung');
  const [zimmer, setZimmer] = useState('');
  const [flaeche, setFlaeche] = useState('');
  const [preis, setPreis] = useState('');
  const [baujahr, setBaujahr] = useState('');
  const [makler, setMakler] = useState('');
  const [externeId, setExterneId] = useState('');
  const [url, setUrl] = useState('');
  const [bildUrl, setBildUrl] = useState('');
  const [notizen, setNotizen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!istDirektlink(url.trim())) {
      setError('Bitte die Direkt-URL der Inserat-Detailseite angeben, nicht die Übersichts- oder Suchseite des Maklers.');
      return;
    }
    setBusy(true);
    setError(null);
    const preisNum = preis.replace(/[^0-9]/g, '');
    const { data, error: err } = await supabase.from('objekte').insert({
      ort,
      plz: plz || null,
      adresse: adresse || null,
      typ,
      zimmer: zimmer ? Number(zimmer.replace(',', '.')) : null,
      flaeche_m2: flaeche ? Number(flaeche) : null,
      preis_chf: preisNum ? Number(preisNum) : null,
      baujahr: baujahr ? Number(baujahr) : null,
      notizen: notizen || null,
      bild_url: bildUrl.trim() || null,
      stufe_code: 'vorgemerkt',
    }).select('id').single();
    if (err || data === null) { setError(err ? err.message : 'Unbekannter Fehler'); setBusy(false); return; }
    await supabase.from('objekt_quellen').insert({ objekt_id: data.id, makler, externe_id: externeId || null, url: url.trim(), preis_chf: preisNum ? Number(preisNum) : null });
    setBusy(false);
    onSaved(data.id);
  }

  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="of-h" onClick={onClose}>
      <form className="card modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2 id="of-h">Inserat manuell erfassen</h2>
          <button type="button" className="btn sm" onClick={onClose}>Schliessen</button>
        </div>
        <div className="form-grid">
          <div className="field"><label htmlFor="f-ort">Ort *</label><input id="f-ort" className="input" value={ort} onChange={(e) => setOrt(e.target.value)} required /></div>
          <div className="field"><label htmlFor="f-plz">PLZ</label><input id="f-plz" className="input" value={plz} onChange={(e) => setPlz(e.target.value)} /></div>
          <div className="field"><label htmlFor="f-adr">Adresse</label><input id="f-adr" className="input" value={adresse} onChange={(e) => setAdresse(e.target.value)} /></div>
          <div className="field"><label htmlFor="f-typ">Typ</label>
            <select id="f-typ" className="select" value={typ} onChange={(e) => setTyp(e.target.value as ObjektTyp)}>
              <option value="wohnung">Wohnung</option><option value="haus">Haus</option><option value="andere">Andere</option>
            </select>
          </div>
          <div className="field"><label htmlFor="f-zi">Zimmer</label><input id="f-zi" className="input" inputMode="decimal" value={zimmer} onChange={(e) => setZimmer(e.target.value)} placeholder="4.5" /></div>
          <div className="field"><label htmlFor="f-m2">Wohnfläche m²</label><input id="f-m2" className="input" inputMode="numeric" value={flaeche} onChange={(e) => setFlaeche(e.target.value)} /></div>
          <div className="field"><label htmlFor="f-preis">Preis CHF</label><input id="f-preis" className="input" inputMode="numeric" value={preis} onChange={(e) => setPreis(e.target.value)} placeholder="1'950'000" /></div>
          <div className="field"><label htmlFor="f-bj">Baujahr</label><input id="f-bj" className="input" inputMode="numeric" value={baujahr} onChange={(e) => setBaujahr(e.target.value)} /></div>
          <div className="field"><label htmlFor="f-mk">Makler *</label><input id="f-mk" className="input" value={makler} onChange={(e) => setMakler(e.target.value)} placeholder="Walde, MoneyPark …" required /></div>
          <div className="field"><label htmlFor="f-eid">Externe ID</label><input id="f-eid" className="input" value={externeId} onChange={(e) => setExterneId(e.target.value)} placeholder="L19.120" /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="f-url">Direktlink zum Inserat *</label><input id="f-url" className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… Detailseite des Inserats" required /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="f-bild">Bild-URL (optional, sonst automatisch vom Inserat)</label><input id="f-bild" className="input" type="url" value={bildUrl} onChange={(e) => setBildUrl(e.target.value)} placeholder="https://…jpg" /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="f-not">Notizen</label><textarea id="f-not" className="textarea" rows={2} value={notizen} onChange={(e) => setNotizen(e.target.value)} /></div>
        </div>
        {error !== null ? <div className="notice">{error}</div> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="btn primary" disabled={busy || !ort || !makler || !url}>Speichern</button>
        </div>
      </form>
    </div>
  );
}

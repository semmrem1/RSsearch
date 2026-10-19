import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useObjekte } from '../hooks/useObjekte';
import ObjektTable from '../components/ObjektTable';
import ObjektForm from '../components/ObjektForm';

export default function Inserate() {
  const { stufen } = useApp();
  const { objekte, loading, reload } = useObjekte();
  const [q, setQ] = useState('');
  const [phase, setPhase] = useState('alle');
  const [markt, setMarkt] = useState('alle');
  const [showForm, setShowForm] = useState(false);
  const nav = useNavigate();

  const phases = Array.from(new Map(stufen.map((s) => [s.phase, s.phase_name])).entries());
  const needle = q.trim().toLowerCase();
  const rows = objekte.filter((o) => {
    if (phase !== 'alle' && String(o.stufe_phase) !== phase) { return false; }
    if (markt !== 'alle' && o.markt_status !== markt) { return false; }
    if (needle) {
      const hay = [o.ort, o.adresse, o.titel, o.plz, ...o.quellen.map((s) => s.makler + ' ' + (s.externe_id || ''))].filter((x) => x !== null).join(' ').toLowerCase();
      if (hay.indexOf(needle) === -1) { return false; }
    }
    return true;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Inserate</h1>
          <p className="sub">Alle erfassten Objekte, inklusive ausgeschiedene</p>
        </div>
        <button type="button" className="btn primary" onClick={() => setShowForm(true)}>+ Inserat manuell erfassen</button>
      </div>
      <section className="card">
        <div className="card-head" style={{ padding: '20px 22px 14px' }}>
          <label htmlFor="q" className="sr-only">Suche</label>
          <input id="q" className="input" type="search" placeholder="Ort, Adresse, Makler, ID" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
          <select className="select" aria-label="Phase" value={phase} onChange={(e) => setPhase(e.target.value)} style={{ width: 'auto' }}>
            <option value="alle">Phase: alle</option>
            {phases.map(([p, n]) => <option key={p} value={String(p)}>{n}</option>)}
          </select>
          <select className="select" aria-label="Marktstatus" value={markt} onChange={(e) => setMarkt(e.target.value)} style={{ width: 'auto' }}>
            <option value="alle">Markt: alle</option>
            <option value="aktiv">aktiv</option><option value="reserviert">reserviert</option><option value="verkauft">verkauft</option><option value="offline">offline</option>
          </select>
          <span className="muted small" style={{ marginLeft: 'auto' }}>{rows.length} von {objekte.length}</span>
        </div>
        {loading ? <div className="empty">Lade …</div> : <ObjektTable rows={rows} />}
      </section>
      {showForm ? <ObjektForm onClose={() => setShowForm(false)} onSaved={(id) => { setShowForm(false); reload(); nav('/inserate/' + id); }} /> : null}
    </>
  );
}

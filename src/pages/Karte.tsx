import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useObjekte } from '../hooks/useObjekte';
import Karte from '../components/Karte';
import { phasenFarbe, zuKartenpunkt } from '../lib/kartenpunkte';
import type { KartenPunkt } from '../components/Karte';

export default function KartePage() {
  const { profiles } = useApp();
  const { objekte, loading, geoOffen } = useObjekte();
  const [markt, setMarkt] = useState<'aktiv' | 'alle'>('aktiv');
  const [ausgeschieden, setAusgeschieden] = useState(false);
  const [fav, setFav] = useState<string>('alle');
  const nav = useNavigate();

  const sichtbar = objekte.filter((o) => {
    if (markt === 'aktiv' && o.markt_status !== 'aktiv') { return false; }
    if (!ausgeschieden && o.stufe_phase === 9) { return false; }
    if (fav !== 'alle') {
      const b = o.bewertungen[fav];
      if (!b || !(b.favorit || b.sterne >= 4)) { return false; }
    }
    return true;
  });

  const punkte: KartenPunkt[] = [];
  sichtbar.forEach((o) => { const p = zuKartenpunkt(o); if (p !== null) { punkte.push(p); } });

  const ohneKoord = sichtbar.filter((o) => o.lat === null);
  const nurOrt = sichtbar.filter((o) => o.lat !== null && o.geo_genauigkeit === 'ort').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Karte</h1>
          <p className="sub">Alle Inserate auf einen Blick · Marker zeigen den Preis in Mio. CHF, Klick für Bild und Direktlink</p>
        </div>
      </div>

      <section className="card">
        <div className="card-head" style={{ padding: '16px 22px' }}>
          <div className="seg" role="group" aria-label="Marktstatus">
            <button type="button" aria-pressed={markt === 'aktiv'} onClick={() => setMarkt('aktiv')}>Aktiv am Markt</button>
            <button type="button" aria-pressed={markt === 'alle'} onClick={() => setMarkt('alle')}>Alle</button>
          </div>
          <div className="seg" role="group" aria-label="Favoriten">
            <button type="button" aria-pressed={fav === 'alle'} onClick={() => setFav('alle')}>Alle</button>
            {profiles.map((p) => (
              <button key={p.id} type="button" aria-pressed={fav === p.id} onClick={() => setFav(p.id)}>Favoriten {p.name.split(' ')[0]}</button>
            ))}
          </div>
          <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={ausgeschieden} onChange={(e) => setAusgeschieden(e.target.checked)} /> Ausgeschiedene zeigen
          </label>
          <span className="muted small" style={{ marginLeft: 'auto' }}>
            {loading ? 'Lade …' : punkte.length + ' von ' + sichtbar.length + ' auf der Karte'}{geoOffen > 0 ? ' · ' + geoOffen + ' Adressen werden ermittelt …' : ''}
          </span>
        </div>
        <Karte punkte={punkte} hoehe="calc(100vh - 290px)" onNavigieren={(id) => nav('/inserate/' + id)} />
        <div className="karte-legende">
          <span><i style={{ background: phasenFarbe(1) }} />Entdecken</span>
          <span><i style={{ background: phasenFarbe(2) }} />Im Prozess</span>
          <span><i style={{ background: phasenFarbe(9) }} />Ausgeschieden</span>
          <span><i className="ungenau" />Gestrichelt: nur Ort bekannt ({nurOrt}), Position ungefähr</span>
          <span>★ Favorit</span>
        </div>
      </section>

      {ohneKoord.length > 0 && geoOffen === 0 && !loading ? (
        <section className="card pad">
          <h2>Ohne Position ({ohneKoord.length})</h2>
          <p className="small muted" style={{ marginTop: 4 }}>Adresse und Ort konnten nicht gefunden werden. Im Inserat die Adresse ergänzen oder den Marker manuell setzen.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {ohneKoord.map((o) => <Link key={o.id} to={'/inserate/' + o.id} className="chip outline">{o.ort}{o.adresse ? ', ' + o.adresse : ''}</Link>)}
          </div>
        </section>
      ) : null}
    </>
  );
}

import { Link, useNavigate } from 'react-router-dom';
import FilterBar from '../components/FilterBar';
import { filtern, useObjektFilter } from '../lib/filter';
import { useObjekte } from '../hooks/useObjekte';
import { dateTime } from '../lib/format';
import { useApp } from '../state/AppContext';
import Karte from '../components/KarteLazy';
import { phasenFarbe, zuKartenpunkt } from '../lib/kartenpunkte';
import type { KartenPunkt } from '../components/Karte';

export default function KartePage() {
  const { me, haushalt } = useApp();
  const { objekte, loading, geoOffen, offlineStand } = useObjekte();
  const [filter, setFilter] = useObjektFilter('karte');
  const nav = useNavigate();

  const sichtbar = filtern(objekte, filter, { me: me !== null ? me.id : null, haushalt });

  const punkte: KartenPunkt[] = [];
  sichtbar.forEach((o) => { const p = zuKartenpunkt(o); if (p !== null) { punkte.push(p); } });

  const ohneKoord = sichtbar.filter((o) => o.lat === null);
  const nurOrt = sichtbar.filter((o) => o.lat !== null && o.geo_genauigkeit === 'ort').length;

  return (
    <>
      {offlineStand !== null ? <div className="notice">Keine Verbindung. Daten vom Stand {dateTime(offlineStand)}.</div> : null}
      <div className="page-head">
        <div>
          <h1>Karte</h1>
          <p className="sub">Marker zeigen den Preis in Mio. CHF, antippen für Bild und Direktlink</p>
        </div>
      </div>

      <section className="card">
        <FilterBar objekte={objekte} wert={filter} onChange={setFilter} treffer={sichtbar.length} />
        {loading || geoOffen > 0 ? <div className="small muted" style={{ padding: '0 22px 10px' }}>{loading ? 'Lade …' : geoOffen + ' Adressen werden auf der Karte verortet …'}</div> : null}
        <Karte punkte={punkte} hoehe="var(--karte-hoehe)" onNavigieren={(id) => nav('/inserate/' + id)} />
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

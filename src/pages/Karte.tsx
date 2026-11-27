import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import FilterBar from '../components/FilterBar';
import { filtern, useObjektFilter } from '../lib/filter';
import { useObjekte } from '../hooks/useObjekte';
import { dateTime } from '../lib/format';
import { useApp } from '../state/AppContext';
import Karte from '../components/KarteLazy';
import { FAVORIT_FARBE, phasenFarbe, zuKartenpunkt } from '../lib/kartenpunkte';
import type { KartenPunkt } from '../components/Karte';
import { supabase } from '../lib/supabase';
import { zuRadarPunkt } from '../lib/radarkarte';
import type { NeubauBewertung, Neubauprojekt } from '../lib/types';

const NEUBAU_ANZEIGEN = 'karte.neubau';

function neubauGespeichert(): boolean {
  try { return localStorage.getItem(NEUBAU_ANZEIGEN) !== '0'; } catch { return true; }
}

/** Neubauprojekte im Verkauf mit eigenem Pin auf der Inserate-Karte (Wunsch Remo 27.11.2026) */
function useNeubauImVerkauf(): { projekte: Neubauprojekt[]; bewertungen: NeubauBewertung[] } {
  const [projekte, setProjekte] = useState<Neubauprojekt[]>([]);
  const [bewertungen, setBewertungen] = useState<NeubauBewertung[]>([]);
  useEffect(() => {
    let aktiv = true;
    Promise.all([
      supabase.from('neubauprojekte').select('*').eq('phase', 'verkauf'),
      supabase.from('neubau_bewertungen').select('*'),
    ]).then(([p, b]) => {
      if (!aktiv) { return; }
      if (p.data) { setProjekte(p.data as Neubauprojekt[]); }
      if (b.data) { setBewertungen(b.data as NeubauBewertung[]); }
    }).catch(() => { /* offline: nur Inserate */ });
    return () => { aktiv = false; };
  }, []);
  return { projekte, bewertungen };
}

export default function KartePage() {
  const { me, haushalt, profiles, budgetPosten } = useApp();
  const { objekte, loading, geoOffen, offlineStand } = useObjekte();
  const [filter, setFilter] = useObjektFilter('karte');
  const nav = useNavigate();
  const neubau = useNeubauImVerkauf();
  const [zeigeNeubau, setZeigeNeubau] = useState<boolean>(neubauGespeichert);
  const neubauUmschalten = (an: boolean) => {
    setZeigeNeubau(an);
    try { localStorage.setItem(NEUBAU_ANZEIGEN, an ? '1' : '0'); } catch { /* egal */ }
  };

  const sichtbar = filtern(objekte, filter, { me: me !== null ? me.id : null, haushalt, profiles, posten: budgetPosten });

  const punkte: KartenPunkt[] = [];
  sichtbar.forEach((o) => { const p = zuKartenpunkt(o); if (p !== null) { punkte.push(p); } });
  const neubauPunkte: KartenPunkt[] = [];
  neubau.projekte.forEach((p) => { const k = zuRadarPunkt(p, [], neubau.bewertungen, profiles, { navPfad: true }); if (k !== null) { neubauPunkte.push(k); } });
  if (zeigeNeubau) { punkte.push(...neubauPunkte); }
  const neubauOhnePosition = neubau.projekte.length - neubauPunkte.length;

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
        {neubau.projekte.length > 0 ? (
          <div className="small" style={{ padding: '0 22px 10px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={zeigeNeubau} onChange={(e) => neubauUmschalten(e.target.checked)} />
              ⌂ Neubauprojekte im Verkauf ({neubauPunkte.length})
            </label>
            {neubauOhnePosition > 0 ? <span className="muted">{neubauOhnePosition} noch ohne Position, werden beim täglichen Abgleich verortet</span> : null}
          </div>
        ) : null}
        <Karte punkte={punkte} hoehe="var(--karte-hoehe)" onNavigieren={(id) => nav(id.startsWith('/') ? id : '/inserate/' + id)} />
        <div className="karte-legende">
          <span><i style={{ background: phasenFarbe(1) }} />Entdecken</span>
          <span><i style={{ background: phasenFarbe(2) }} />Im Prozess</span>
          <span><i style={{ background: phasenFarbe(9) }} />Ausgeschieden</span>
          <span><i style={{ background: FAVORIT_FARBE, border: '1px solid #15181C' }} />★ Favorit (von mindestens einer Person)</span>
          {zeigeNeubau && neubauPunkte.length > 0 ? <span><i className="neubau" />⌂ Neubauprojekt im Verkauf (Preis ab, antippen für Website und Radar)</span> : null}
          <span><i className="ungenau" />Gestrichelt: genaue Adresse unbekannt ({nurOrt}), Marker steht ungefähr im Ort</span>
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

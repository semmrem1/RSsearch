import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useApp } from '../state/AppContext';
import { chf } from '../lib/format';
import { STEUERJAHR } from '../data/steuerfuesse';
import { anzeigeName, farbeFuer, gemeindeSchluessel, haushaltEinkommen, OHNE_WERT, steuerWerte, stufen, wertVon, type SteuerMass, type SteuerWert } from '../lib/steuerkarte';
import type { SteuerGeo } from '../components/SteuerKarte';

// Leaflet erst laden, wenn die Karte gebraucht wird
const SteuerKarte = lazy(() => import('../components/SteuerKarte'));

const MASSE: { id: SteuerMass; label: string; hinweis: string }[] = [
  { id: 'gesamt', label: 'Gesamtsteuerfuss', hinweis: 'Kanton + Bezirk + Gemeinde in % der einfachen Steuer, ohne Kirchensteuer. Innerhalb eines Kantons direkt vergleichbar; zwischen ZH, SZ und SG nur bedingt, weil die Grundtarife verschieden sind. Für den fairen Vergleich «Steuern für uns» wählen.' },
  { id: 'gemeinde', label: 'Gemeindesteuerfuss', hinweis: 'Nur der Gemeindeanteil (inkl. Schulgemeinden), ohne Kanton und Bezirk. Gut für den Vergleich innerhalb eines Kantons.' },
  { id: 'uns', label: 'Steuern für uns', hinweis: 'Grobe Schätzung pro Jahr für unseren Haushalt: Kanton, Bezirk, Gemeinde und Bund, gemeinsame Veranlagung, ohne Kirchen- und Vermögenssteuer. Gleiches Modell wie im Budget (Nettolöhne, Pensen, Kinder aus den Einstellungen).' },
];

export default function Steuern() {
  const { haushalt, profiles, leser } = useApp();
  const [geo, setGeo] = useState<SteuerGeo | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [mass, setMass] = useState<SteuerMass>('gesamt');
  const [suche, setSuche] = useState<Set<string>>(new Set());
  const [markiert, setMarkiert] = useState<number | null>(null);
  const [filterText, setFilterText] = useState('');
  const kartenBox = useRef<HTMLElement | null>(null);

  useEffect(() => {
    fetch(import.meta.env.BASE_URL + 'geo/steuern-region.json')
      .then((r) => { if (!r.ok) { throw new Error('HTTP ' + r.status); } return r.json(); })
      .then((d) => setGeo(d as SteuerGeo))
      .catch(() => setFehler('Gemeindegrenzen konnten nicht geladen werden.'));
    supabase.from('gemeinden').select('name').then(({ data }) => {
      if (data) { setSuche(new Set((data as { name: string }[]).map((g) => gemeindeSchluessel(g.name)))); }
    });
  }, []);

  const einkommen = haushaltEinkommen(haushalt, profiles);
  const werte = useMemo(() => steuerWerte(haushalt, profiles), [haushalt, profiles]);
  const werteMap = useMemo(() => new Map(werte.map((w) => [w.bfs, w])), [werte]);
  const ohneEinkommen = einkommen.total <= 0;
  const aktivMass: SteuerMass = mass === 'uns' && ohneEinkommen ? 'gesamt' : mass;
  const st = useMemo(() => {
    const v = werte.map((w) => wertVon(w, aktivMass)).filter((x): x is number => x !== null);
    return stufen(v, aktivMass === 'uns' ? 500 : 1);
  }, [werte, aktivMass]);

  const sortiert = werte.slice().sort((a, b) => {
    const va = wertVon(a, aktivMass);
    const vb = wertVon(b, aktivMass);
    if (va === null && vb === null) { return a.name.localeCompare(b.name, 'de'); }
    if (va === null) { return 1; }
    if (vb === null) { return -1; }
    return va - vb || a.name.localeCompare(b.name, 'de');
  });
  const ft = filterText.trim().toLowerCase();
  const liste = ft === '' ? sortiert : sortiert.filter((w) => w.name.toLowerCase().includes(ft) || w.kanton.toLowerCase() === ft);
  const offen = werte.filter((w) => w.gemeinde === null);
  const quellen = Array.from(new Set(werte.map((w) => w.quelle).filter((q): q is string => q !== null)));
  const hinweis = MASSE.find((m) => m.id === aktivMass) as { hinweis: string };

  const legendeText = (von: number, bis: number, letzte: boolean): string => {
    if (aktivMass === 'uns') { return chf(von, true) + ' bis ' + chf(letzte ? bis - 500 : bis - 1); }
    return von + ' bis ' + (bis - 1) + ' %';
  };

  const zeigen = (bfs: number) => {
    setMarkiert(bfs);
    const el = kartenBox.current;
    if (el !== null) {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }
  };

  const wertZelle = (w: SteuerWert, m: SteuerMass): string => {
    const v = wertVon(w, m);
    if (v === null) { return '–'; }
    return m === 'uns' ? chf(v) : v + ' %';
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Steuern</h1>
          <p className="sub">Steuerfüsse {STEUERJAHR} der Gemeinden rund um den Zürichsee. Hell = tief, dunkel = hoch. Über eine Gemeinde fahren (auf dem Handy antippen) zeigt den genauen Wert.</p>
        </div>
      </div>

      <div className="seg" role="tablist" aria-label="Wert auf der Karte" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {MASSE.map((m) => (
          <button key={m.id} type="button" role="tab" aria-pressed={aktivMass === m.id} aria-selected={aktivMass === m.id}
            disabled={m.id === 'uns' && ohneEinkommen} title={m.id === 'uns' && ohneEinkommen ? 'Zuerst Nettolöhne unter Einstellungen › Budget erfassen' : undefined}
            onClick={() => setMass(m.id)}>{m.label}</button>
        ))}
      </div>
      {ohneEinkommen ? (
        <div className="notice">«Steuern für uns» braucht die Nettolöhne. {leser ? 'Sie sind noch nicht erfasst.' : <>Unter <Link to="/einstellungen">Einstellungen › Budget</Link> Nettolohn und Pensum pro Person eintragen.</>}</div>
      ) : null}

      <section className="card" ref={kartenBox}>
        <p className="small muted" style={{ padding: '14px 22px 12px', margin: 0 }}>{hinweis.hinweis}</p>
        {fehler !== null ? <div className="empty">{fehler}</div> : null}
        {geo !== null ? (
          <Suspense fallback={<div className="karte" style={{ height: 'var(--karte-hoehe)' }} />}>
            <SteuerKarte geo={geo} werte={werteMap} mass={aktivMass} stufen={st} suche={suche} hoehe="var(--karte-hoehe)" markiert={markiert} onWaehlen={setMarkiert} />
          </Suspense>
        ) : fehler === null ? <div className="karte" style={{ height: 'var(--karte-hoehe)' }} /> : null}
        <div className="karte-legende steuer-legende">
          {st.map((s, i) => <span key={s.von}><i style={{ background: s.farbe }} />{legendeText(s.von, s.bis, i === st.length - 1)}</span>)}
          <span><i style={{ background: OHNE_WERT }} />noch nicht erfasst ({offen.length})</span>
          <span><i className="umrandet" />Gemeinden aus unserer Suche</span>
        </div>
      </section>

      <section className="card">
        <div className="card-head" style={{ padding: '16px 22px 10px' }}>
          <h2>Rangliste <span className="muted">({liste.length})</span></h2>
          <input className="input" type="search" style={{ maxWidth: 260 }} aria-label="Gemeinde suchen" placeholder="Gemeinde oder Kanton (ZH, SZ, SG)" value={filterText} onChange={(e) => setFilterText(e.target.value)} />
        </div>
        <div className="steuer-tabelle-wrap">
          <table className="fin-tabelle steuer-tabelle">
            <thead>
              <tr>
                <th>Gemeinde</th>
                <th>Kt.</th>
                <th className="r">Gemeinde</th>
                <th className="r">Gesamt</th>
                <th className="r">Für uns / Jahr</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((w) => {
                const unsere = suche.has(gemeindeSchluessel(w.name));
                return (
                  <tr key={w.bfs} className={(markiert === w.bfs ? 'aktiv ' : '') + (unsere ? 'unsere' : '')} onClick={() => zeigen(w.bfs)} title="Auf der Karte zeigen">
                    <td><i className="steuer-punkt" style={{ background: farbeFuer(wertVon(w, aktivMass), st) }} />{anzeigeName(w.name)}</td>
                    <td>{w.kanton}</td>
                    <td className="r tnum">{wertZelle(w, 'gemeinde')}</td>
                    <td className="r tnum">{wertZelle(w, 'gesamt')}</td>
                    <td className="r tnum">{wertZelle(w, 'uns')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="xs muted" style={{ padding: '12px 22px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Quellen: {quellen.join('; ')}. Gemeindegrenzen: BFS, Stand 2026. Uster: Ortsteile mit Sekundarstufe Nänikon-Greifensee 110 % statt 112 %.</span>
          {offen.length > 0 ? <span>Noch nicht erfasst: {offen.map((w) => anzeigeName(w.name)).join(', ')}.</span> : null}
        </div>
      </section>
    </>
  );
}

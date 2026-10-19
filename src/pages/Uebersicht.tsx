import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useApp } from '../state/AppContext';
import { useObjekte } from '../hooks/useObjekte';
import ObjektTable from '../components/ObjektTable';
import ObjektForm from '../components/ObjektForm';
import FilterBar from '../components/FilterBar';
import { filtern, useObjektFilter } from '../lib/filter';
import { chf, pct, dateShort, relative, dow, dayNum, isToday } from '../lib/format';
import type { Aktivitaet, Snapshot } from '../lib/types';

interface FeedItem { key: string; when: string; kind: string; cls: string; title: string; detail: string; objektId: string }

export default function Uebersicht() {
  const { profiles } = useApp();
  const { objekte, loading, reload } = useObjekte();
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [todos, setTodos] = useState<Aktivitaet[]>([]);
  const [filter, setFilter] = useObjektFilter('uebersicht');
  const [showForm, setShowForm] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    supabase.from('snapshots').select('*').order('datum', { ascending: false }).limit(40)
      .then(({ data }) => { if (data) { setSnaps(data as Snapshot[]); } });
    supabase.from('aktivitaeten').select('*').eq('erledigt', false).not('faellig_am', 'is', null).order('faellig_am').limit(6)
      .then(({ data }) => { if (data) { setTodos(data as Aktivitaet[]); } });
  }, []);

  const byId = useMemo(() => {
    const m = new Map<string, (typeof objekte)[number]>();
    objekte.forEach((o) => m.set(o.id, o));
    return m;
  }, [objekte]);

  const since = new Date(); since.setDate(since.getDate() - 7);
  const sinceIso = since.toISOString();
  const aktiv = objekte.filter((o) => o.markt_status === 'aktiv');
  const neuHeute = objekte.filter((o) => isToday(o.erstmals_gesehen)).length;
  const preisAenderungen = snaps.filter((s) => s.typ === 'preis' && s.datum >= sinceIso);
  const imProzess = objekte.filter((o) => o.stufe_phase >= 2 && o.stufe_phase <= 5).length;
  const besichtigungen = objekte.filter((o) => o.stufe_code === 'besichtigung_geplant').length;

  const feed: FeedItem[] = snaps
    .filter((s) => s.typ !== 'bestaetigt')
    .slice(0, 8)
    .map((s) => {
      const o = byId.get(s.objekt_id);
      const name = o ? o.ort + (o.adresse ? ', ' + o.adresse : '') : 'Objekt';
      const facts = o ? [o.zimmer !== null ? o.zimmer + ' Zi' : null, o.flaeche_m2 !== null ? o.flaeche_m2 + ' m²' : null].filter((x) => x !== null).join(' · ') : '';
      let kind = 'Update'; let cls = 'neutral'; let detail = s.kommentar || '';
      if (s.typ === 'erfasst') { kind = 'Neu'; cls = 'accent'; detail = facts + (s.neu ? ' · CHF ' + chf(Number(s.neu)) : ''); }
      else if (s.typ === 'preis') {
        const alt = Number(s.alt); const neu = Number(s.neu);
        kind = neu < alt ? 'Preis ↓' : 'Preis ↑'; cls = neu < alt ? 'accent' : 'warm';
        detail = 'CHF ' + chf(alt) + ' → ' + chf(neu) + ' (' + pct(neu - alt, alt) + ')';
      }
      else if (s.typ === 'status') {
        if (s.neu === 'offline') { kind = 'Offline'; cls = 'warm'; detail = 'Inserat nicht mehr online, offline genommen am ' + dateShort(s.datum); }
        else if (s.neu === 'aktiv') { kind = 'Wieder online'; cls = 'green'; detail = 'Inserat ist wieder beim Makler aufgeschaltet'; }
        else { kind = 'Markt'; cls = 'warm'; detail = (s.alt || '') + ' → ' + (s.neu || ''); }
      }
      else if (s.typ === 'neue_quelle') { kind = 'Neue Quelle'; cls = 'neutral'; detail = s.neu || detail; }
      else if (s.typ === 'dublette') { kind = 'Dublette'; cls = 'neutral'; }
      return { key: 'snap' + s.id, when: relative(s.datum) === 'heute' ? new Date(s.datum).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) : dateShort(s.datum), kind, cls, title: name, detail, objektId: s.objekt_id };
    });

  const filtered = filtern(objekte, filter);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Übersicht</h1>
          <p className="sub">Kauf · ab 4.5 Zimmer · ab 120 m² · bis CHF 2.5 Mio · Zürichsee, Obersee, Uster, Pfäffikon ZH</p>
        </div>
        <button type="button" className="btn primary" onClick={() => setShowForm(true)}>+ Inserat manuell erfassen</button>
      </div>

      <section className="kpis" aria-label="Kennzahlen">
        <div className="kpi"><span className="muted small">Aktive Inserate im Suchgebiet</span><span className="v tnum">{aktiv.length}</span><span className="muted small">von {objekte.length} total</span></div>
        <div className="kpi accent"><span className="muted small">Neu heute</span><span className="v tnum">{neuHeute}</span><span className="muted small">{feed.filter((f) => f.kind === 'Neu').length} im Feed</span></div>
        <div className="kpi"><span className="muted small">Preisänderungen (7 Tage)</span><span className="v tnum">{preisAenderungen.length}</span><span className="muted small">{preisAenderungen.filter((s) => Number(s.neu) < Number(s.alt)).length} gesenkt</span></div>
        <div className="kpi"><span className="muted small">Im Prozess</span><span className="v tnum">{imProzess}</span><span className="muted small">{besichtigungen} Besichtigung{besichtigungen === 1 ? '' : 'en'} geplant</span></div>
      </section>

      <div className="two-col">
        <section className="card pad main" aria-labelledby="feed-h">
          <div className="card-head" style={{ paddingBottom: 8 }}>
            <h2 id="feed-h">Neu &amp; geändert</h2>
            <Link to="/inserate" className="small">Alle Inserate</Link>
          </div>
          <div className="rows">
            {feed.length === 0 ? <div className="empty">Noch keine Ereignisse.</div> : null}
            {feed.map((f) => (
              <Link key={f.key} to={'/inserate/' + f.objektId} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '12px 0', textDecoration: 'none', color: 'inherit' }}>
                <span className="muted small tnum" style={{ flex: '0 0 72px', paddingTop: 2 }}>{f.when}</span>
                <span className={'chip ' + f.cls}>{f.kind}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{f.title}</span>
                  <span className="muted small">{f.detail}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="card pad side" aria-labelledby="next-h">
          <h2 id="next-h">Nächste Schritte</h2>
          <div className="rows">
            {todos.length === 0 ? <div className="empty">Keine offenen Termine. Im Inserat eine Aktivität mit Fälligkeit erfassen.</div> : null}
            {todos.map((t) => {
              const o = byId.get(t.objekt_id);
              const who = profiles.find((p) => p.id === t.user_id);
              return (
                <Link key={t.id} to={'/inserate/' + t.objekt_id} style={{ display: 'flex', gap: 14, padding: '12px 0', textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ flex: '0 0 52px', height: 52, borderRadius: 10, background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <span className="xs muted" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{dow(t.faellig_am as string)}</span>
                    <span className="tnum" style={{ fontSize: 18, fontWeight: 700 }}>{dayNum(t.faellig_am as string)}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{t.titel}</span>
                    <span className="muted small">{o ? o.ort : ''}{who ? ' · ' + who.name.split(' ')[0] : ''}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      <section className="card" aria-labelledby="list-h">
        <div className="card-head list-head">
          <h2 id="list-h">Alle Inserate</h2>
          <span className="small muted">Spaltentitel antippen zum Sortieren</span>
        </div>
        <FilterBar objekte={objekte} wert={filter} onChange={setFilter} treffer={filtered.length} />
        {loading ? <div className="empty">Lade …</div> : <ObjektTable rows={filtered} />}
      </section>

      {showForm ? <ObjektForm onClose={() => setShowForm(false)} onSaved={(id) => { setShowForm(false); reload(); nav('/inserate/' + id); }} /> : null}
    </>
  );
}

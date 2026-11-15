import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useObjekte } from '../hooks/useObjekte';
import { dateTime } from '../lib/format';
import { useApp } from '../state/AppContext';
import ObjektTable from '../components/ObjektTable';
import ObjektForm from '../components/ObjektForm';
import FilterBar from '../components/FilterBar';
import { filtern, useObjektFilter } from '../lib/filter';
import type { Angebot } from '../lib/types';

/** Inseratsliste. Gleiche Seite für Kauf (/inserate) und Miete (/miete), getrennt über das Angebot. */
export default function Inserate({ angebot = 'kauf' }: { angebot?: Angebot }) {
  const miete = angebot === 'miete';
  const { me, haushalt, profiles, budgetPosten, leser } = useApp();
  const { objekte, loading, reload, offlineStand } = useObjekte(angebot);
  const [filter, setFilter] = useObjektFilter(miete ? 'miete' : 'inserate');
  const [showForm, setShowForm] = useState(false);
  const nav = useNavigate();
  const rows = filtern(objekte, filter, { me: me !== null ? me.id : null, haushalt, profiles, posten: budgetPosten });

  return (
    <>
      {offlineStand !== null ? <div className="notice">Keine Verbindung. Daten vom Stand {dateTime(offlineStand)}.</div> : null}
      <div className="page-head">
        <div>
          <h1>{miete ? 'Mietobjekte' : 'Inserate'}</h1>
          <p className="sub">{miete ? 'Gleiche Kriterien wie beim Kauf, Miete bis CHF 3\'500 pro Monat' : 'Alle erfassten Objekte, inklusive ausgeschiedene'}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <nav className="seg angebot-seg" aria-label="Kauf oder Miete">
            <NavLink to="/inserate">Kauf</NavLink>
            <NavLink to="/miete">Miete</NavLink>
          </nav>
          {!leser ? <button type="button" className="btn primary" onClick={() => setShowForm(true)}>{miete ? '+ Mietobjekt manuell erfassen' : '+ Inserat manuell erfassen'}</button> : null}
        </div>
      </div>
      <section className="card liste-voll">
        <FilterBar objekte={objekte} wert={filter} onChange={setFilter} treffer={rows.length} ohne={miete ? ['ampel', 'tragbar', 'score'] : undefined} miete={miete} />
        {loading ? <div className="empty">Lade …</div> : objekte.length === 0 && miete ? <div className="empty">Noch keine Mietobjekte erfasst. Der tägliche Lauf sucht sie ab jetzt mit und trägt sie hier ein.</div> : <ObjektTable rows={rows} onBewertet={reload} miete={miete} />}
      </section>
      {showForm ? <ObjektForm angebot={angebot} onClose={() => setShowForm(false)} onSaved={(id) => { setShowForm(false); reload(); nav('/inserate/' + id); }} /> : null}
    </>
  );
}

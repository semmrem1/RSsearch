import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useObjekte } from '../hooks/useObjekte';
import { dateTime } from '../lib/format';
import { useApp } from '../state/AppContext';
import ObjektTable from '../components/ObjektTable';
import ObjektForm from '../components/ObjektForm';
import FilterBar from '../components/FilterBar';
import { filtern, useObjektFilter } from '../lib/filter';

export default function Inserate() {
  const { me, haushalt, profiles, budgetPosten, leser } = useApp();
  const { objekte, loading, reload, offlineStand } = useObjekte();
  const [filter, setFilter] = useObjektFilter('inserate');
  const [showForm, setShowForm] = useState(false);
  const nav = useNavigate();
  const rows = filtern(objekte, filter, { me: me !== null ? me.id : null, haushalt, profiles, posten: budgetPosten });

  return (
    <>
      {offlineStand !== null ? <div className="notice">Keine Verbindung. Daten vom Stand {dateTime(offlineStand)}.</div> : null}
      <div className="page-head">
        <div>
          <h1>Inserate</h1>
          <p className="sub">Alle erfassten Objekte, inklusive ausgeschiedene</p>
        </div>
        {!leser ? <button type="button" className="btn primary" onClick={() => setShowForm(true)}>+ Inserat manuell erfassen</button> : null}
      </div>
      <section className="card liste-voll">
        <FilterBar objekte={objekte} wert={filter} onChange={setFilter} treffer={rows.length} />
        {loading ? <div className="empty">Lade …</div> : <ObjektTable rows={rows} onBewertet={reload} />}
      </section>
      {showForm ? <ObjektForm onClose={() => setShowForm(false)} onSaved={(id) => { setShowForm(false); reload(); nav('/inserate/' + id); }} /> : null}
    </>
  );
}

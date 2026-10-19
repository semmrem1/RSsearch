import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useObjekte } from '../hooks/useObjekte';
import ObjektTable from '../components/ObjektTable';
import ObjektForm from '../components/ObjektForm';
import FilterBar from '../components/FilterBar';
import { filtern, useObjektFilter } from '../lib/filter';

export default function Inserate() {
  const { objekte, loading, reload } = useObjekte();
  const [filter, setFilter] = useObjektFilter('inserate');
  const [showForm, setShowForm] = useState(false);
  const nav = useNavigate();
  const rows = filtern(objekte, filter);

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
        <FilterBar objekte={objekte} wert={filter} onChange={setFilter} treffer={rows.length} />
        {loading ? <div className="empty">Lade …</div> : <ObjektTable rows={rows} />}
      </section>
      {showForm ? <ObjektForm onClose={() => setShowForm(false)} onSaved={(id) => { setShowForm(false); reload(); nav('/inserate/' + id); }} /> : null}
    </>
  );
}

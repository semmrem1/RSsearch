import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { bytes, dateLong } from '../lib/format';
import type { Dokument } from '../lib/types';
import { Avatar } from '../components/Layout';

interface Row extends Dokument { objekte: { ort: string; adresse: string | null } | null }

export default function Dokumente() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    supabase.from('dokumente').select('*, objekte(ort, adresse)').order('created_at', { ascending: false })
      .then(({ data }) => { if (data) { setRows(data as unknown as Row[]); } });
  }, []);

  async function open(d: Dokument) {
    const { data } = await supabase.storage.from('dokumente').createSignedUrl(d.storage_path, 600);
    if (data) { window.open(data.signedUrl, '_blank', 'noopener'); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Dokumente</h1><p className="sub">Alle hochgeladenen Unterlagen, objektübergreifend</p></div>
      </div>
      <section className="card">
        {rows.length === 0 ? <div className="empty">Noch keine Dokumente. Im Inserat unter «Dokumente» hochladen.</div> : (
          <div className="table-wrap">
            <table className="list" style={{ minWidth: 700 }}>
              <thead><tr><th>Datei</th><th>Objekt</th><th>Kategorie</th><th>Von</th><th className="r">Grösse</th><th>Datum</th></tr></thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td><button type="button" className="btn sm" onClick={() => open(d)}>{d.name}</button></td>
                    <td>{d.objekte !== null ? <Link to={'/inserate/' + d.objekt_id}>{d.objekte.ort}{d.objekte.adresse ? ', ' + d.objekte.adresse : ''}</Link> : '–'}</td>
                    <td>{d.kategorie}</td>
                    <td><Avatar id={d.user_id} size="sm" /></td>
                    <td className="r">{bytes(d.groesse_bytes)}</td>
                    <td className="muted small">{dateLong(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

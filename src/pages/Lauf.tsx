import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { dateShort, dateTime } from '../lib/format';
import type { LaufProtokoll } from '../lib/types';

const MAKLER = ['Walde', 'Avora', 'Engel & Völkers', 'Von Poll', 'Streichan', "Sotheby's", 'RE/MAX', 'Raiffeisen', 'MoneyPark', 'Ginesta', 'HEV Aargau'];

/** Lauf-Protokoll: Matrix Makler x Tag der letzten 14 Tage plus Fehlerliste. */
export default function Lauf() {
  const [rows, setRows] = useState<LaufProtokoll[]>([]);

  useEffect(() => {
    const seit = new Date(); seit.setDate(seit.getDate() - 14);
    supabase.from('lauf_protokoll').select('*').gte('gestartet_am', seit.toISOString()).order('gestartet_am', { ascending: false })
      .then(({ data }) => { if (data) { setRows(data as LaufProtokoll[]); } });
  }, []);

  const tage = Array.from(new Set(rows.map((r) => r.gestartet_am.slice(0, 10)))).sort().reverse();
  const makler = Array.from(new Set([...MAKLER, ...rows.map((r) => r.makler)]));
  const zelle = (m: string, tag: string): LaufProtokoll | null => {
    const r = rows.filter((x) => x.makler === m && x.gestartet_am.slice(0, 10) === tag);
    if (r.length === 0) { return null; }
    return r.find((x) => x.geprueft) || r[0];
  };
  const fehler = rows.filter((r) => !r.geprueft || r.fehler !== null);

  return (
    <>
      <div className="page-head">
        <div><h1>Lauf-Protokoll</h1><p className="sub">Täglicher Makler-Check der letzten 14 Tage. Grün: vollständig geprüft, Rot: nicht lesbar, leer: kein Eintrag.</p></div>
        <Link to="/einstellungen" className="btn">Einstellungen</Link>
      </div>
      <section className="card">
        <div className="table-wrap">
          <table className="list" style={{ minWidth: 700 }}>
            <thead>
              <tr><th>Makler</th>{tage.map((t) => <th key={t} className="r">{dateShort(t)}</th>)}</tr>
            </thead>
            <tbody>
              {makler.map((m) => (
                <tr key={m}>
                  <td style={{ fontWeight: 600 }}>{m}</td>
                  {tage.map((t) => {
                    const z = zelle(m, t);
                    return (
                      <td key={t} className="r">
                        {z === null ? <span className="muted">·</span> : (
                          <span className={'chip ' + (z.geprueft && z.fehler === null ? 'green' : 'warm')} title={(z.fehler || '') + ' · ' + dateTime(z.gestartet_am)}>
                            {z.geprueft ? (z.anzahl_inserate !== null ? z.anzahl_inserate : '✓') : '✗'}{z.neue > 0 ? ' +' + z.neue : ''}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {tage.length === 0 ? <tr><td colSpan={2} className="empty">Noch kein Lauf in den letzten 14 Tagen.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="muted xs" style={{ padding: '10px 22px' }}>Zahl = gefundene Inserate, +n = neue Objekte an diesem Tag.</div>
      </section>
      {fehler.length > 0 ? (
        <section className="card pad">
          <h2>Fehler &amp; nicht geprüft</h2>
          <div className="rows" style={{ marginTop: 8 }}>
            {fehler.map((r) => (
              <div key={r.id} className="small" style={{ display: 'flex', gap: 12, padding: '8px 0' }}>
                <span className="muted tnum" style={{ flex: '0 0 110px' }}>{dateTime(r.gestartet_am)}</span>
                <span style={{ flex: '0 0 130px', fontWeight: 600 }}>{r.makler}</span>
                <span style={{ color: 'var(--warm-dark)' }}>{r.fehler || 'nicht geprüft'}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

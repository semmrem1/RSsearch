import { Link } from 'react-router-dom';
import type { ObjektUebersicht } from '../lib/types';
import { chf, pct, dateShort, typLabel } from '../lib/format';
import { useApp } from '../state/AppContext';
import { StarsText } from './Stars';
import ObjektBild from './ObjektBild';
import { quelleDirekt } from '../lib/links';

export default function ObjektTable({ rows }: { rows: ObjektUebersicht[] }) {
  const { profiles } = useApp();

  if (rows.length === 0) { return <div className="empty">Keine Inserate für diesen Filter.</div>; }

  return (
    <div className="table-wrap">
      <table className="list">
        <thead>
          <tr>
            <th>Objekt</th>
            <th className="r">Zi</th>
            <th className="r">m²</th>
            <th className="r">Preis CHF</th>
            <th className="r">CHF/m²</th>
            <th>Quelle</th>
            <th>Pipeline</th>
            {profiles.map((p) => <th key={p.id}>{p.name.split(' ')[0]}</th>)}
            <th>Erfasst</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const diff = r.preis_vorher_chf !== null && r.preis_chf !== null ? r.preis_chf - r.preis_vorher_chf : null;
            const phase = r.stufe_phase === 9 ? 0 : r.stufe_phase;
            const sub = [typLabel(r.typ), r.adresse].filter((x) => x !== null && x !== '').join(' · ');
            return (
              <tr key={r.id}>
                <td>
                  <Link to={'/inserate/' + r.id} className="obj" style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                    <ObjektBild o={r} className="thumb" />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{r.ort}{r.titel ? ' · ' + r.titel : ''}</span>
                      <span className="muted small">{sub}</span>
                    </span>
                  </Link>
                </td>
                <td className="r">{r.zimmer !== null ? r.zimmer : '–'}</td>
                <td className="r">{r.flaeche_m2 !== null ? r.flaeche_m2 : '–'}</td>
                <td className="r">
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                    <span style={{ fontWeight: 600 }}>{chf(r.preis_chf)}</span>
                    {diff !== null && diff !== 0 ? (
                      <span className="xs" style={{ color: diff < 0 ? 'var(--accent)' : 'var(--warm)', fontWeight: 600 }}>
                        {diff < 0 ? '↓' : '↑'} {chf(Math.abs(diff))} ({pct(diff, r.preis_vorher_chf as number)}) <s style={{ color: 'var(--ink-4)', fontWeight: 400 }}>{chf(r.preis_vorher_chf)}</s>
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="r" style={{ color: 'var(--ink-2)' }}>{r.preis_chf !== null && r.flaeche_m2 ? chf(r.preis_chf / r.flaeche_m2) : '–'}</td>
                <td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {r.quellen.map((q) => (quelleDirekt(q) && q.url
                      ? <a key={q.id} className="chip outline" href={q.url} target="_blank" rel="noopener noreferrer" title="Inserat beim Makler öffnen">{q.makler} ↗</a>
                      : <span key={q.id} className="chip link-fehlt" title="Kein Direktlink zum Inserat hinterlegt">{q.makler} · kein Direktlink</span>))}
                    {r.markt_status !== 'aktiv' ? <span className="chip warm">{r.markt_status}</span> : null}
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 170 }}>
                    <span className="small" style={{ fontWeight: 500 }}>{r.stufe_name}</span>
                    <div className="progress" aria-label={'Phase ' + phase + ' von 5'}>
                      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= phase ? 'on' : ''} />)}
                    </div>
                  </div>
                </td>
                {profiles.map((p) => {
                  const b = r.bewertungen[p.id];
                  return <td key={p.id}><StarsText n={b ? b.sterne : 0} color={p.farbe} /></td>;
                })}
                <td className="muted small">{dateShort(r.erstmals_gesehen)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ObjektUebersicht } from '../lib/types';
import { chf, pct, dateShort, typLabel, marktText } from '../lib/format';
import { useApp } from '../state/AppContext';
import { StarsText } from './Stars';
import ObjektBild from './ObjektBild';
import { quelleDirekt } from '../lib/links';

type Richtung = 'asc' | 'desc';
interface Sortierung { key: string; dir: Richtung }

const STANDARD: Sortierung = { key: 'erfasst', dir: 'desc' };

function wert(r: ObjektUebersicht, key: string): number | string | null {
  switch (key) {
    case 'ort': return r.ort + ' ' + (r.adresse || '');
    case 'zimmer': return r.zimmer !== null ? Number(r.zimmer) : null;
    case 'flaeche': return r.flaeche_m2;
    case 'preis': return r.preis_chf;
    case 'chfm2': return r.preis_chf !== null && r.flaeche_m2 ? r.preis_chf / r.flaeche_m2 : null;
    case 'quelle': return r.quellen.length > 0 ? r.quellen[0].makler : null;
    case 'stufe': return r.stufe_sort;
    case 'erfasst': return r.erstmals_gesehen + ' ' + r.created_at;
    default:
      if (key.indexOf('p:') === 0) {
        const b = r.bewertungen[key.slice(2)];
        return b ? b.sterne + (b.favorit ? 0.5 : 0) : null;
      }
      return null;
  }
}

function sortieren(rows: ObjektUebersicht[], s: Sortierung): ObjektUebersicht[] {
  const f = s.dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const va = wert(a, s.key);
    const vb = wert(b, s.key);
    if (va === null && vb === null) { return 0; }
    if (va === null) { return 1; } // leere Werte immer ans Ende
    if (vb === null) { return -1; }
    if (typeof va === 'number' && typeof vb === 'number') { return (va - vb) * f; }
    return String(va).localeCompare(String(vb), 'de-CH', { numeric: true }) * f;
  });
}

function lesen(): Sortierung {
  try {
    const raw = window.localStorage.getItem('rs.sort');
    if (raw !== null) { return JSON.parse(raw) as Sortierung; }
  } catch { /* egal */ }
  return STANDARD;
}

export default function ObjektTable({ rows }: { rows: ObjektUebersicht[] }) {
  const { profiles } = useApp();
  const [sort, setSortState] = useState<Sortierung>(lesen);

  function setSort(s: Sortierung) {
    setSortState(s);
    try { window.localStorage.setItem('rs.sort', JSON.stringify(s)); } catch { /* egal */ }
  }

  function klick(key: string) {
    if (sort.key === key) { setSort({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }); }
    // Zahlen und Datum zuerst absteigend wäre bei Preis unpraktisch: Text und Preis aufsteigend, Rest absteigend
    else { setSort({ key, dir: key === 'ort' || key === 'quelle' || key === 'preis' || key === 'chfm2' || key === 'stufe' ? 'asc' : 'desc' }); }
  }

  if (rows.length === 0) { return <div className="empty">Keine Inserate für diesen Filter.</div>; }

  const sortiert = sortieren(rows, sort);

  const spalten: { key: string; label: string; r?: boolean }[] = [
    { key: 'ort', label: 'Objekt' },
    { key: 'zimmer', label: 'Zi', r: true },
    { key: 'flaeche', label: 'm²', r: true },
    { key: 'preis', label: 'Preis CHF', r: true },
    { key: 'chfm2', label: 'CHF/m²', r: true },
    { key: 'quelle', label: 'Quelle' },
    { key: 'stufe', label: 'Pipeline' },
    ...profiles.map((p) => ({ key: 'p:' + p.id, label: p.name.split(' ')[0] })),
    { key: 'erfasst', label: 'Erfasst' },
  ];

  const kopf = (s: { key: string; label: string; r?: boolean }) => {
    const aktiv = sort.key === s.key;
    return (
      <th key={s.key} className={s.r ? 'r' : undefined} aria-sort={aktiv ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className={'th-sort' + (aktiv ? ' aktiv' : '')} onClick={() => klick(s.key)}>
          {s.label}<span className="pfeil" aria-hidden="true">{aktiv ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
        </button>
      </th>
    );
  };

  const quellenChips = (r: ObjektUebersicht) => (
    <>
      {r.markt_status !== 'aktiv' ? <span className="chip warm" title={marktText(r.markt_status, r.offline_seit)}>{marktText(r.markt_status, r.offline_seit, true)}</span> : null}
      {r.quellen.map((q) => {
        const weg = q.status !== 'aktiv';
        if (quelleDirekt(q) && q.url) {
          return <a key={q.id} className={'chip outline' + (weg ? ' chip-weg' : '')} href={q.url} target="_blank" rel="noopener noreferrer" title={weg ? q.makler + ': ' + marktText(q.status, q.offline_seit) : 'Inserat beim Makler öffnen'}>{q.makler} ↗</a>;
        }
        return <span key={q.id} className="chip link-fehlt" title="Kein Direktlink zum Inserat hinterlegt">{q.makler} · kein Direktlink</span>;
      })}
    </>
  );

  const preisDiff = (r: ObjektUebersicht) => {
    const diff = r.preis_vorher_chf !== null && r.preis_chf !== null ? r.preis_chf - r.preis_vorher_chf : null;
    if (diff === null || diff === 0) { return null; }
    return (
      <span className="xs" style={{ color: diff < 0 ? 'var(--accent)' : 'var(--warm)', fontWeight: 600 }}>
        {diff < 0 ? '↓' : '↑'} {chf(Math.abs(diff))} ({pct(diff, r.preis_vorher_chf as number)}) <s style={{ color: 'var(--ink-4)', fontWeight: 400 }}>{chf(r.preis_vorher_chf)}</s>
      </span>
    );
  };

  return (
    <>
      {/* Mobile: Sortierung als Auswahl, Inserate als Karten */}
      <div className="mob sort-mob">
        <label htmlFor="sort-mob" className="small muted">Sortieren</label>
        <select id="sort-mob" className="select" value={sort.key} onChange={(e) => klick(e.target.value)}>
          {spalten.map((s) => <option key={s.key} value={s.key}>{s.key.indexOf('p:') === 0 ? 'Bewertung ' + s.label : s.label === 'Objekt' ? 'Ortschaft' : s.label}</option>)}
        </select>
        <button type="button" className="btn sm" onClick={() => setSort({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })} aria-label={sort.dir === 'asc' ? 'Aufsteigend, umkehren' : 'Absteigend, umkehren'}>
          {sort.dir === 'asc' ? '▲ auf' : '▼ ab'}
        </button>
      </div>
      <div className="mob obj-karten">
        {sortiert.map((r) => {
          const phase = r.stufe_phase === 9 ? 0 : r.stufe_phase;
          return (
            <div key={r.id} className={'obj-karte' + (r.stufe_phase === 9 ? ' aus' : '')}>
              <Link to={'/inserate/' + r.id} className="obj-karte-link">
                <ObjektBild o={r} className="karte-bild" />
                <div className="obj-karte-text">
                  <span className="obj-karte-titel">{r.ort}{r.titel ? ' · ' + r.titel : ''}</span>
                  {r.adresse ? <span className="xs muted">{r.adresse}</span> : null}
                  <span className="small tnum">{[r.zimmer !== null ? r.zimmer + ' Zi' : null, r.flaeche_m2 !== null ? r.flaeche_m2 + ' m²' : null, typLabel(r.typ)].filter((x) => x !== null).join(' · ')}</span>
                  <span className="tnum" style={{ fontWeight: 700 }}>{chf(r.preis_chf, true)}</span>
                  {preisDiff(r)}
                </div>
              </Link>
              <div className="obj-karte-fuss">
                <span className="small" style={{ fontWeight: 500 }}>{r.stufe_name}</span>
                <div className="progress" aria-label={'Phase ' + phase + ' von 5'} style={{ flex: '1 1 60px', maxWidth: 120 }}>
                  {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= phase ? 'on' : ''} />)}
                </div>
                {profiles.map((p) => {
                  const b = r.bewertungen[p.id];
                  return <span key={p.id} className="xs" style={{ color: p.farbe }}>{p.kuerzel} <StarsText n={b ? b.sterne : 0} color={p.farbe} /></span>;
                })}
              </div>
              <div className="obj-karte-quellen">{quellenChips(r)}<span className="xs muted" style={{ marginLeft: 'auto' }}>erfasst {dateShort(r.erstmals_gesehen)}</span></div>
            </div>
          );
        })}
      </div>

      {/* Desktop: Tabelle */}
      <div className="table-wrap desk">
        <table className="list">
          <thead>
            <tr>{spalten.map(kopf)}</tr>
          </thead>
          <tbody>
            {sortiert.map((r) => {
              const phase = r.stufe_phase === 9 ? 0 : r.stufe_phase;
              const sub = [typLabel(r.typ), r.adresse].filter((x) => x !== null && x !== '').join(' · ');
              return (
                <tr key={r.id} className={r.stufe_phase === 9 ? 'aus' : undefined}>
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
                      {preisDiff(r)}
                    </div>
                  </td>
                  <td className="r" style={{ color: 'var(--ink-2)' }}>{r.preis_chf !== null && r.flaeche_m2 ? chf(r.preis_chf / r.flaeche_m2) : '–'}</td>
                  <td><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{quellenChips(r)}</div></td>
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
    </>
  );
}

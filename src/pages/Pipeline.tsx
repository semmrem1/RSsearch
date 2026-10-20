import { useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useApp } from '../state/AppContext';
import { useObjekte } from '../hooks/useObjekte';
import { chf, relative } from '../lib/format';
import { StarsText } from '../components/Stars';
import type { ObjektUebersicht, Stufe } from '../lib/types';

export default function Pipeline() {
  const { stufen, profiles, leser } = useApp();
  const { objekte, reload } = useObjekte();
  const [hideEmpty, setHideEmpty] = useState(false);
  const [onlyFav, setOnlyFav] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const phases = Array.from(new Map(stufen.map((s) => [s.phase, s.phase_name])).entries());

  function cardsFor(stufe: Stufe): ObjektUebersicht[] {
    return objekte.filter((o) => {
      if (o.stufe_code !== stufe.code) { return false; }
      if (onlyFav) {
        const any = Object.values(o.bewertungen).some((b) => b.favorit || b.sterne >= 4);
        if (!any) { return false; }
      }
      return true;
    });
  }

  async function move(objektId: string, code: string) {
    const o = objekte.find((x) => x.id === objektId);
    if (!o || o.stufe_code === code) { return; }
    await supabase.from('objekte').update({ stufe_code: code }).eq('id', objektId);
    reload();
  }

  function onDrop(e: DragEvent, code: string) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/objekt') || dragId;
    setOver(null);
    setDragId(null);
    if (id) { move(id, code); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pipeline</h1>
          <p className="sub">{leser ? 'Ein gemeinsamer Prozess pro Objekt' : 'Ein gemeinsamer Prozess pro Objekt · Karten per Drag & Drop verschieben oder über das Menü in der Karte'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn md" aria-pressed={hideEmpty} onClick={() => setHideEmpty(!hideEmpty)} style={hideEmpty ? { background: 'var(--accent-soft)', borderColor: 'var(--accent)' } : undefined}>Leere Stufen ausblenden</button>
          <button type="button" className="btn md" aria-pressed={onlyFav} onClick={() => setOnlyFav(!onlyFav)} style={onlyFav ? { background: 'var(--accent-soft)', borderColor: 'var(--accent)' } : undefined}>Nur Favoriten</button>
        </div>
      </div>

      <div className="board">
        <div className="board-inner">
          {phases.map(([phase, phaseName], idx) => {
            const ps = stufen.filter((s) => s.phase === phase);
            const total = ps.reduce((n, s) => n + cardsFor(s).length, 0);
            return (
              <section key={phase} className={'col' + (phase === 9 ? ' out' : '')} aria-label={phaseName}>
                <div className="col-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="mono xs muted">{phase === 9 ? '×' : String(idx + 1).padStart(2, '0')}</span>
                    <h2 style={{ fontSize: 15 }}>{phaseName}</h2>
                  </div>
                  <span className="count tnum">{total}</span>
                </div>
                {ps.map((s) => {
                  const cards = cardsFor(s);
                  if (hideEmpty && cards.length === 0) { return null; }
                  return (
                    <div
                      key={s.code}
                      className={'stage' + (over === s.code ? ' over' : '')}
                      onDragOver={(e) => { e.preventDefault(); if (over !== s.code) { setOver(s.code); } }}
                      onDragLeave={() => { if (over === s.code) { setOver(null); } }}
                      onDrop={(e) => onDrop(e, s.code)}
                    >
                      <div className="stage-head" title={s.hinweis || ''}>
                        <span>{s.name}</span>
                        <span className="tnum" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{cards.length}</span>
                      </div>
                      {cards.length === 0 ? <div className="stage-empty">leer</div> : null}
                      {cards.map((o) => {
                        const facts = [o.zimmer !== null ? o.zimmer + ' Zi' : null, o.flaeche_m2 !== null ? o.flaeche_m2 + ' m²' : null, chf(o.preis_chf)].filter((x) => x !== null).join(' · ');
                        const next = o.notizen;
                        return (
                          <div
                            key={o.id}
                            className="kcard"
                            draggable={!leser}
                            onDragStart={(e) => { e.dataTransfer.setData('text/objekt', o.id); e.dataTransfer.effectAllowed = 'move'; setDragId(o.id); }}
                            onDragEnd={() => { setDragId(null); setOver(null); }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                              <Link to={'/inserate/' + o.id} style={{ fontWeight: 600, textDecoration: 'none', color: 'inherit' }}>{o.ort}{o.adresse ? ', ' + o.adresse : ''}</Link>
                              <span className="xs muted" style={{ whiteSpace: 'nowrap' }}>{relative(o.stufe_geaendert_am)}</span>
                            </div>
                            <span className="small tnum" style={{ color: 'var(--ink-2)' }}>{facts}{o.preis_vorher_chf !== null && o.preis_chf !== null && o.preis_chf < o.preis_vorher_chf ? ' ↓' : ''}</span>
                            <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                              {profiles.map((p) => {
                                const b = o.bewertungen[p.id];
                                return <span key={p.id} style={{ color: p.farbe, display: 'inline-flex', gap: 4 }}>{p.kuerzel} <StarsText n={b ? b.sterne : 0} color={p.farbe} /></span>;
                              })}
                            </div>
                            {next ? <span className="chip accent" style={{ whiteSpace: 'normal' }}>{next}</span> : null}
                            {!leser ? (
                              <>
                                <label className="sr-only" htmlFor={'mv-' + o.id}>Stufe wechseln</label>
                                <select id={'mv-' + o.id} className="select" style={{ minHeight: 32, fontSize: 12, padding: '0 8px' }} value={o.stufe_code} onChange={(e) => move(o.id, e.target.value)}>
                                  {stufen.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
                                </select>
                              </>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>

      <section className="card pad" aria-labelledby="def-h">
        <h2 id="def-h">Stufen-Definition</h2>
        <p className="muted small" style={{ marginTop: 4 }}>Abgeleitet vom Schweizer Kaufablauf: verbindlich wird der Kauf erst mit der öffentlichen Beurkundung, Eigentum geht erst mit dem Grundbucheintrag über.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, marginTop: 16 }}>
          {phases.filter(([p]) => p !== 9).map(([phase, phaseName], idx) => (
            <div key={phase} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontWeight: 600 }}>{String(idx + 1).padStart(2, '0')} {phaseName}</span>
              {stufen.filter((s) => s.phase === phase).map((s) => (
                <div key={s.code} style={{ display: 'flex', gap: 10 }}>
                  <span className="mono" style={{ flex: '0 0 22px', height: 22, borderRadius: 6, background: 'var(--bg)', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-2)' }}>{s.sort / 10}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span className="small" style={{ fontWeight: 600 }}>{s.name}</span>
                    <span className="xs muted">{s.hinweis}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

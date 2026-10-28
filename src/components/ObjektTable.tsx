import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ObjektUebersicht } from '../lib/types';
import { chf, pct, dateShort, typLabel, marktText } from '../lib/format';
import { useApp } from '../state/AppContext';
import { StarsInput, StarsText } from './Stars';
import { supabase } from '../lib/supabase';
import ObjektBild from './ObjektBild';
import { quelleDirekt } from '../lib/links';
import { eigenkapital, tragbarkeit, quoteText, stufeFarbe } from '../lib/finanz';
import type { BudgetPosten, Haushalt, Profile } from '../lib/types';
import { budget, ueberschussFarbe } from '../lib/budget';
import { gemeindeAusZeile } from '../lib/steuern';
import { ampel, AMPEL_FARBE, AMPEL_LABEL } from '../lib/ampel';
import AmpelInfo from './AmpelInfo';
import { ScoreBadge } from './ScoreInfo';

type Richtung = 'asc' | 'desc';
interface Sortierung { key: string; dir: Richtung }

const STANDARD: Sortierung = { key: 'erfasst', dir: 'desc' };

interface SortCtx { h: Haushalt; me: string | null; profiles: Profile[]; posten: BudgetPosten[]; ek: number }

function wert(r: ObjektUebersicht, key: string, ctx: SortCtx): number | string | null {
  switch (key) {
    case 'ampel': { const a = ampel(r, ctx.h, ctx.profiles, ctx.posten).stufe; return a === 'gruen' ? 3 : a === 'gelb' ? 2 : a === 'rot' ? 1 : 0; }
    case 'budget': { const b = budget(r.preis_chf, ctx.h, ctx.profiles, ctx.posten, null, gemeindeAusZeile(r)); return b.vollstaendig ? b.ueberschuss : null; }
    case 'tage': return r.tage_am_markt;
    case 'score': return r.score_auto !== null && r.score_auto !== undefined ? Number(r.score_auto) : null;
    case 'bewertung': return r.score_gesamt;
    case 'tragbar': { const t = tragbarkeit(r.preis_chf, ctx.h, null, ctx.ek); return t !== null && t.quote !== null ? (t.ekZuTief ? 9 : t.quote) : null; }
    case 'pendeln': { if (ctx.me === null) { return null; } const pz = r.pendelzeiten[ctx.me]; return pz ? pz.minuten : null; }
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

function sortieren(rows: ObjektUebersicht[], s: Sortierung, ctx: SortCtx): ObjektUebersicht[] {
  const f = s.dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const va = wert(a, s.key, ctx);
    const vb = wert(b, s.key, ctx);
    if (va === null && vb === null) { return 0; }
    if (va === null) { return 1; } // leere Werte immer ans Ende
    if (vb === null) { return -1; }
    if (typeof va === 'number' && typeof vb === 'number') { return (va - vb) * f; }
    return String(va).localeCompare(String(vb), 'de-CH', { numeric: true }) * f;
  });
}

export default function ObjektTable({ rows, onBewertet }: { rows: ObjektUebersicht[]; onBewertet?: () => void }) {
  const { profiles, haushalt, me, budgetPosten, leser } = useApp();
  const ctx: SortCtx = { h: haushalt, me: me !== null ? me.id : null, profiles, posten: budgetPosten, ek: eigenkapital(haushalt, profiles).total };
  // Die Liste startet immer mit den neusten Inseraten zuoberst; eine andere Sortierung gilt nur, bis die Seite neu geladen wird.
  const [sort, setSort] = useState<Sortierung>(STANDARD);
  // Sterne, die in dieser Liste gesetzt wurden, sofort anzeigen (bis die Daten neu geladen sind)
  const [lokal, setLokal] = useState<Record<string, number>>({});
  const [sterneFehler, setSterneFehler] = useState<string | null>(null);

  function sterne(r: ObjektUebersicht, userId: string): number {
    if (me !== null && userId === me.id && lokal[r.id] !== undefined) { return lokal[r.id]; }
    const b = r.bewertungen[userId];
    return b ? b.sterne : 0;
  }

  /** Eigene Sterne direkt aus der Liste speichern. Nur die Spalte sterne wird geschrieben, Notiz, Tags und Markierungen bleiben. */
  async function sterneSetzen(r: ObjektUebersicht, n: number) {
    if (me === null || leser) { return; }
    const vorher = sterne(r, me.id);
    setLokal((alt) => ({ ...alt, [r.id]: n }));
    setSterneFehler(null);
    const { error } = await supabase.from('bewertungen').upsert({ objekt_id: r.id, user_id: me.id, sterne: n, updated_at: new Date().toISOString() });
    if (error) {
      setLokal((alt) => ({ ...alt, [r.id]: vorher }));
      setSterneFehler('Sterne für ' + r.ort + ' nicht gespeichert: ' + error.message);
      return;
    }
    if (onBewertet) { onBewertet(); }
  }

  /** Sterne einer Person: die eigenen zum Anklicken, die der anderen Person nur zur Anzeige. */
  const sterneZelle = (r: ObjektUebersicht, p: Profile) => {
    const mein = me !== null && p.id === me.id && !leser;
    if (mein) { return <StarsInput kompakt value={sterne(r, p.id)} onChange={(n) => sterneSetzen(r, n)} color={p.farbe} label={'Meine Sterne für ' + r.ort} />; }
    return <span title={p.name}><StarsText n={sterne(r, p.id)} color={p.farbe} /></span>;
  };

  function klick(key: string) {
    if (sort.key === key) { setSort({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }); }
    // Zahlen und Datum zuerst absteigend wäre bei Preis unpraktisch: Text und Preis aufsteigend, Rest absteigend
    else { setSort({ key, dir: key === 'ort' || key === 'quelle' || key === 'preis' || key === 'chfm2' || key === 'stufe' || key === 'tragbar' || key === 'pendeln' ? 'asc' : 'desc' }); }
  }

  if (rows.length === 0) { return <div className="empty">Keine Inserate für diesen Filter.</div>; }

  const sortiert = sortieren(rows, sort, ctx);
  const neuFuerMich = (r: ObjektUebersicht): boolean => me !== null && r.letzte_aktivitaet_user !== null && r.letzte_aktivitaet_user !== me.id && r.letzte_aktivitaet_am !== null && (r.mein_besuch_am === null || r.letzte_aktivitaet_am > r.mein_besuch_am);
  /** Noch nie von mir geöffnet: bläulich hinterlegt, bis ich das Inserat einmal aufgerufen habe. */
  const ungelesen = (r: ObjektUebersicht): boolean => me !== null && !leser && r.mein_besuch_am === null;
  const meinePendel = (r: ObjektUebersicht) => (me !== null && r.pendelzeiten[me.id] ? r.pendelzeiten[me.id] : null);

  const spalten: { key: string; label: ReactNode; titel?: string; r?: boolean; breit?: boolean; sterne?: boolean }[] = [
    { key: 'ampel', label: '', titel: 'Einschätzung (Ampel)' },
    { key: 'ort', label: 'Objekt' },
    { key: 'zimmer', label: 'Zi', r: true },
    { key: 'flaeche', label: 'm²', r: true },
    { key: 'preis', label: 'Preis CHF', r: true },
    { key: 'chfm2', label: 'CHF/m²', r: true },
    { key: 'quelle', label: 'Quelle' },
    { key: 'tragbar', label: 'Tragbar', titel: 'Tragbarkeit Bank (Anteil am Einkommen)', r: true },
    { key: 'pendeln', label: 'ÖV', titel: 'Pendelzeit zu meinem Arbeitsort', r: true },
    { key: 'budget', label: 'Budget', titel: 'Budget-Überschuss pro Monat', r: true },
    { key: 'stufe', label: 'Pipeline' },
    { key: 'score', label: 'Score', titel: 'Automatischer Score 0 bis 100 (objektive Faktoren), Erklärung beim Überfahren', r: true },
    { key: 'bewertung', label: 'Bew.', titel: 'Gemeinsame Objektbewertung 1 bis 5 (gewichtete Kriterien beider Personen)', r: true },
    ...profiles.map((p) => ({ key: 'p:' + p.id, label: <span className="avatar sm th-avatar" style={{ background: p.farbe }}>{p.kuerzel}</span>, titel: 'Sterne ' + p.name + (me !== null && p.id === me.id && !leser ? ' (direkt anklicken zum Bewerten)' : ''), sterne: true })),
    { key: 'tage', label: 'Tage', titel: 'Tage am Markt', r: true },
    { key: 'erfasst', label: 'Erfasst', breit: true },
  ];

  const kopf = (s: { key: string; label: ReactNode; titel?: string; r?: boolean; breit?: boolean; sterne?: boolean }) => {
    const aktiv = sort.key === s.key;
    return (
      <th key={s.key} className={[s.r ? 'r' : '', s.breit ? 'nur-breit' : '', s.sterne ? 'sterne-spalte' : ''].join(' ').trim() || undefined} aria-sort={aktiv ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className={'th-sort' + (aktiv ? ' aktiv' : '')} onClick={() => klick(s.key)} title={s.titel}>
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

  const kennzahlChips = (r: ObjektUebersicht) => {
    const t = tragbarkeit(r.preis_chf, haushalt, null, ctx.ek);
    const pz = meinePendel(r);
    return (
      <>
        {(() => { const a = ampel(r, haushalt, profiles, budgetPosten); return <AmpelInfo ampel={a} className="chip neutral" style={{ color: AMPEL_FARBE[a.stufe], fontWeight: 700 }}><span className="ampel-dot" style={{ background: AMPEL_FARBE[a.stufe] }} />{AMPEL_LABEL[a.stufe]}</AmpelInfo>; })()}
        {neuFuerMich(r) ? <span className="chip accent">💬 neu für dich</span> : null}
        <span className={'chip ' + (r.tage_am_markt > 90 ? 'warm' : 'neutral')} title="Tage am Markt">{r.tage_am_markt} Tage</span>
        {t !== null && t.quote !== null ? <span className="chip neutral" style={{ color: stufeFarbe(t.stufe), fontWeight: 700 }} title="Tragbarkeit">{t.ekZuTief ? 'EK zu tief' : 'Tragbarkeit ' + quoteText(t)}</span> : null}
        {pz !== null ? <span className="chip neutral" title={'ÖV ab ' + (pz.von || '')}>🚆 {pz.minuten} Min</span> : null}
        {(() => { const b = budget(r.preis_chf, haushalt, profiles, budgetPosten, null, gemeindeAusZeile(r)); return b.vollstaendig ? <span className="chip neutral" style={{ color: ueberschussFarbe(b), fontWeight: 700 }} title="Budget-Überschuss pro Monat mit Standardwerten">{b.ueberschuss < 0 ? '−' : '+'}{chf(Math.abs(b.ueberschuss))}/Mt</span> : null; })()}
        <ScoreBadge score={r.score_auto} detail={r.score_auto_detail} className="chip neutral" style={{ gap: 6, fontWeight: 700 }} />
        {r.score_gesamt !== null ? <span className="chip neutral" title="Gemeinsame Objektbewertung (gewichtete Kriterien)">Bewertung {Number(r.score_gesamt).toFixed(1)}</span> : null}
      </>
    );
  };

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
      {sterneFehler !== null ? <div className="notice" role="alert" style={{ margin: '0 22px 12px' }}>{sterneFehler}</div> : null}
      {/* Mobile: Sortierung als Auswahl, Inserate als Karten */}
      <div className="mob sort-mob">
        <label htmlFor="sort-mob" className="small muted">Sortieren</label>
        <select id="sort-mob" className="select" value={sort.key} onChange={(e) => klick(e.target.value)}>
          {spalten.map((s) => <option key={s.key} value={s.key}>{s.key.indexOf('p:') === 0 ? 'Sterne ' + s.label : s.label === 'Objekt' ? 'Ortschaft' : s.key === 'tage' ? 'Tage am Markt' : s.key === 'tragbar' ? 'Tragbarkeit' : s.key === 'pendeln' ? 'Pendelzeit' : s.key === 'budget' ? 'Budget-Überschuss' : s.key === 'ampel' ? 'Einschätzung' : s.key === 'score' ? 'Score (automatisch)' : s.key === 'bewertung' ? 'Objektbewertung' : s.label}</option>)}
        </select>
        <button type="button" className="btn sm" onClick={() => setSort({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })} aria-label={sort.dir === 'asc' ? 'Aufsteigend, umkehren' : 'Absteigend, umkehren'}>
          {sort.dir === 'asc' ? '▲ auf' : '▼ ab'}
        </button>
      </div>
      <div className="mob obj-karten">
        {sortiert.map((r) => {
          const phase = r.stufe_phase === 9 ? 0 : r.stufe_phase;
          return (
            <div key={r.id} className={'obj-karte' + (r.stufe_phase === 9 ? ' aus' : '') + (ungelesen(r) ? ' ungelesen' : '')}>
              <Link to={'/inserate/' + r.id} className="obj-karte-link">
                <ObjektBild o={r} className="karte-bild" />
                <div className="obj-karte-text">
                  <span className="obj-karte-titel">{r.ort}{r.titel ? ' · ' + r.titel : ''}</span>
                  {r.adresse ? <span className="xs muted">{r.adresse}</span> : null}
                  <span className="small tnum">{[r.zimmer !== null ? r.zimmer + ' Zi' : null, r.flaeche_m2 !== null ? r.flaeche_m2 + ' m²' : null, typLabel(r.typ)].filter((x) => x !== null).join(' · ')}</span>
                  {r.steuerfuss !== null ? <span className="xs muted tnum">{(r.gemeinde !== null && r.gemeinde !== r.ort ? r.gemeinde + ' · ' : '') + 'Steuerfuss ' + r.steuerfuss + ' %'}</span> : null}
                  <span className="tnum" style={{ fontWeight: 700 }}>{chf(r.preis_chf, true)}</span>
                  {preisDiff(r)}
                </div>
              </Link>
              <div className="obj-karte-fuss">
                <span className="small" style={{ fontWeight: 500 }}>{r.stufe_name}</span>
                <div className="progress" aria-label={'Phase ' + phase + ' von 5'} style={{ flex: '1 1 60px', maxWidth: 120 }}>
                  {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= phase ? 'on' : ''} />)}
                </div>
              </div>
              <div className="obj-karte-sterne">
                {profiles.map((p) => (
                  <span key={p.id} className="obj-karte-person">
                    <span className="avatar sm th-avatar" style={{ background: p.farbe }} title={p.name}>{p.kuerzel}</span>
                    {sterneZelle(r, p)}
                  </span>
                ))}
              </div>
              <div className="obj-karte-kennzahlen">
                {kennzahlChips(r)}
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
              const steuer = r.steuerfuss !== null ? (r.gemeinde !== null && r.gemeinde !== r.ort ? r.gemeinde + ' · ' : '') + 'Steuerfuss ' + r.steuerfuss + ' %' : null;
              return (
                <tr key={r.id} className={[r.stufe_phase === 9 ? 'aus' : '', ungelesen(r) ? 'ungelesen' : ''].join(' ').trim() || undefined} title={ungelesen(r) ? 'Noch nicht geöffnet' : undefined}>
                  <td className="ampel-zelle">{(() => { const a = ampel(r, haushalt, profiles, budgetPosten); return <AmpelInfo ampel={a} className="ampel-trigger"><span className="ampel-dot" style={{ background: AMPEL_FARBE[a.stufe], marginRight: 0 }} /></AmpelInfo>; })()}</td>
                  <td className="objekt-zelle">
                    <Link to={'/inserate/' + r.id} className="obj" style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                      <ObjektBild o={r} className="thumb" />
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }}>{r.ort}{r.titel ? ' · ' + r.titel : ''}</span>
                        <span className="muted small">{sub}</span>
                        {steuer !== null ? <span className="xs muted tnum" title={'Steuerfuss ' + (r.gemeinde !== null ? r.gemeinde : r.ort) + (r.steuerfuss_jahr !== null ? ' ' + r.steuerfuss_jahr : '')}>{steuer}</span> : null}
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
                  <td className="r tnum">{(() => { const t = tragbarkeit(r.preis_chf, haushalt, null, ctx.ek); if (t === null || (t.quote === null && !t.ekZuTief)) { return <span className="muted">–</span>; } return <span style={{ color: stufeFarbe(t.stufe), fontWeight: 600 }} title={'Kosten/Jahr CHF ' + chf(t.kosten) + (t.ekZuTief ? ' · Belehnung ' + (t.belehnung * 100).toFixed(0) + ' %' : '')}>{t.ekZuTief ? 'EK' : quoteText(t)}</span>; })()}</td>
                  <td className="r tnum">{(() => { const pz = meinePendel(r); return pz !== null ? <span title={'ab ' + (pz.von || '') + ' nach ' + (pz.nach || '')}>{pz.minuten}'</span> : <span className="muted">–</span>; })()}</td>
                  <td className="r tnum">{(() => { const b = budget(r.preis_chf, haushalt, profiles, budgetPosten, null, gemeindeAusZeile(r)); return b.vollstaendig ? <span style={{ color: ueberschussFarbe(b), fontWeight: 600 }} title={'Einkommen ' + chf(b.einkommen) + ' − Wohnen ' + chf(b.wohnen.total) + ' − Ausgaben ' + chf(b.ausgabenTotal)}>{b.ueberschuss < 0 ? '−' : ''}{chf(Math.abs(b.ueberschuss))}</span> : <span className="muted">–</span>; })()}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 130 }}>
                      <span className="small" style={{ fontWeight: 500 }}>{r.stufe_name}{neuFuerMich(r) ? <span className="chip accent" style={{ marginLeft: 6 }}>💬 neu</span> : null}</span>
                      <div className="progress" aria-label={'Phase ' + phase + ' von 5'}>
                        {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= phase ? 'on' : ''} />)}
                      </div>
                    </div>
                  </td>
                  <td className="r tnum"><ScoreBadge score={r.score_auto} detail={r.score_auto_detail} className="score-trigger" /></td>
                  <td className="r tnum">{r.score_gesamt !== null ? <span style={{ fontWeight: 600 }} title={'Gemeinsame Objektbewertung · ' + profiles.map((p) => p.kuerzel + ' ' + (r.kriterien_scores[p.id] !== undefined ? Number(r.kriterien_scores[p.id]).toFixed(1) : '–')).join(' · ')}>{Number(r.score_gesamt).toFixed(1)}</span> : <span className="muted">–</span>}</td>
                  {profiles.map((p) => <td key={p.id} className="sterne-zelle">{sterneZelle(r, p)}</td>)}
                  <td className={'r tnum' + (r.tage_am_markt > 90 ? '' : ' muted')} style={r.tage_am_markt > 90 ? { color: 'var(--warm-dark)', fontWeight: 600 } : undefined}>{r.tage_am_markt}</td>
                  <td className="muted small nur-breit">{dateShort(r.erstmals_gesehen)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

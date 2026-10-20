import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useApp } from '../state/AppContext';
import { budget, ueberschussFarbe } from '../lib/budget';
import { chf } from '../lib/format';
import type { ObjektBudgetDaten } from '../lib/types';

function Betrag({ wert, onChange, breit, aria }: { wert: number; onChange: (v: number) => void; breit?: boolean; aria: string }) {
  const [text, setText] = useState(String(wert));
  useEffect(() => { setText(String(wert)); }, [wert]);
  return (
    <input
      className="input budget-input" inputMode="numeric" aria-label={aria} value={text}
      style={breit ? { width: 110 } : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { const v = Number(text.replace(/[^0-9.-]/g, '')); if (!isNaN(v) && v !== wert) { onChange(Math.round(v)); } else { setText(String(wert)); } }}
      onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

/** Monatsbudget pro Objekt: Standardwerte aus den Einstellungen, Überschreibungen in objekt_budget. */
export default function BudgetKarte({ objektId, preis }: { objektId: string; preis: number | null }) {
  const { haushalt, profiles, budgetPosten } = useApp();
  const [daten, setDaten] = useState<ObjektBudgetDaten | null>(null);
  const [geladen, setGeladen] = useState(false);
  const [extraName, setExtraName] = useState('');
  const [extraBetrag, setExtraBetrag] = useState('');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    supabase.from('objekt_budget').select('daten').eq('objekt_id', objektId).maybeSingle()
      .then(({ data }) => { setDaten(data !== null ? (data as { daten: ObjektBudgetDaten }).daten : {}); setGeladen(true); });
  }, [objektId]);

  function speichern(neu: ObjektBudgetDaten) {
    setDaten(neu);
    if (timer.current !== null) { window.clearTimeout(timer.current); }
    timer.current = window.setTimeout(() => {
      supabase.from('objekt_budget').upsert({ objekt_id: objektId, daten: neu, updated_at: new Date().toISOString() }).then(() => undefined);
    }, 400);
  }

  if (!geladen || daten === null) { return <div className="small muted">Lade Budget …</div>; }
  const b = budget(preis, haushalt, profiles, budgetPosten, daten);
  const ov = daten;
  const istStandard = Object.keys(ov).length === 0;

  const setPensum = (userId: string, v: number) => {
    const pensum = { ...(ov.pensum || {}) };
    const p = b.personen.find((x) => x.id === userId);
    if (p !== undefined && v === p.standardPensum) { delete pensum[userId]; } else { pensum[userId] = v; }
    const neu: ObjektBudgetDaten = { ...ov, pensum };
    if (Object.keys(pensum).length === 0) { delete neu.pensum; }
    speichern(neu);
  };
  const setPosten = (id: string, v: number) => {
    const posten = { ...(ov.posten || {}) };
    const z = b.ausgaben.find((x) => x.id === id);
    if (z !== undefined && v === z.standard) { delete posten[id]; } else { posten[id] = v; }
    const neu: ObjektBudgetDaten = { ...ov, posten };
    if (Object.keys(posten).length === 0) { delete neu.posten; }
    speichern(neu);
  };
  const setExtra = (i: number, betrag: number | null) => {
    const extra = (ov.extra || []).slice();
    if (betrag === null) { extra.splice(i, 1); } else { extra[i] = { ...extra[i], betrag }; }
    const neu: ObjektBudgetDaten = { ...ov, extra };
    if (extra.length === 0) { delete neu.extra; }
    speichern(neu);
  };
  const extraHinzu = () => {
    const betrag = Number(extraBetrag.replace(/[^0-9.-]/g, ''));
    if (extraName.trim() === '' || isNaN(betrag)) { return; }
    speichern({ ...ov, extra: [...(ov.extra || []), { name: extraName.trim(), betrag: Math.round(betrag) }] });
    setExtraName(''); setExtraBetrag('');
  };

  return (
    <div className="budget">
      {!b.vollstaendig ? (
        <div className="notice" style={{ marginBottom: 12 }}>Nettolohn und Pensum unter <Link to="/einstellungen">Einstellungen › Budget</Link> hinterlegen, dann rechnet die Tabelle mit euren Zahlen. Ausgaben kannst du hier trotzdem schon erfassen.</div>
      ) : null}

      <div className="budget-block">
        <div className="budget-kopf"><span>Einkommen pro Monat</span><span className="tnum">CHF {chf(b.einkommen)}</span></div>
        {b.personen.map((p) => (
          <div key={p.id} className="budget-zeile">
            <span><span style={{ color: p.farbe, fontWeight: 600 }}>{p.name}</span> <span className="xs muted">netto {chf(p.nettolohn100)} bei 100 %</span></span>
            <span className="budget-pensum">
              <Betrag wert={p.pensum} onChange={(v) => setPensum(p.id, Math.max(0, Math.min(100, v)))} aria={'Pensum ' + p.name} />
              <span className="xs muted">%</span>
              {p.pensum !== p.standardPensum ? <button type="button" className="linkbtn xs" onClick={() => setPensum(p.id, p.standardPensum)} title="Zurück auf Standard">↺</button> : null}
            </span>
            <span className="tnum">{chf(p.betrag)}</span>
          </div>
        ))}
        {b.weitereEinkuenfte !== 0 ? <div className="budget-zeile"><span>Weitere Einkünfte</span><span /><span className="tnum">{chf(b.weitereEinkuenfte)}</span></div> : null}
      </div>

      <div className="budget-block">
        <div className="budget-kopf"><span>Wohnkosten dieses Objekts</span><span className="tnum">− CHF {chf(b.wohnen.total)}</span></div>
        <div className="budget-zeile"><span>Hypozins {b.zinsEffektiv} % effektiv <span className="xs muted">auf CHF {chf(b.hypothek)}</span></span><span /><span className="tnum">{chf(b.wohnen.zins)}</span></div>
        <div className="budget-zeile"><span>Nebenkosten, Unterhalt <span className="xs muted">{haushalt.nebenkosten_pct} % vom Preis</span></span><span /><span className="tnum">{chf(b.wohnen.nebenkosten)}</span></div>
        <div className="budget-zeile"><span>Amortisation 2. Hypothek <span className="xs muted">auf 65 % in {haushalt.amortisation_jahre} Jahren</span></span><span /><span className="tnum">{chf(b.wohnen.amortisation)}</span></div>
      </div>

      <div className="budget-block">
        <div className="budget-kopf"><span>Ausgaben</span><span className="tnum">− CHF {chf(b.ausgabenTotal)}</span></div>
        {b.ausgaben.map((z, i) => (
          <div key={z.id} className="budget-zeile">
            <span>{z.name}{z.ueberschrieben && z.id.indexOf('extra-') !== 0 ? <span className="xs muted"> · Standard {chf(z.standard)}</span> : null}</span>
            <span className="budget-pensum">
              {z.id.indexOf('extra-') === 0
                ? <button type="button" className="linkbtn xs" onClick={() => setExtra(Number(z.id.slice(6)), null)} title="Entfernen">✕</button>
                : (z.ueberschrieben ? <button type="button" className="linkbtn xs" onClick={() => setPosten(z.id, z.standard)} title="Zurück auf Standard">↺</button> : null)}
            </span>
            <Betrag wert={z.betrag} breit aria={z.name} onChange={(v) => (z.id.indexOf('extra-') === 0 ? setExtra(i - budgetPosten.length, v) : setPosten(z.id, v))} />
          </div>
        ))}
        <div className="budget-zeile budget-neu">
          <input className="input" placeholder="Weiterer Posten für dieses Objekt" aria-label="Posten" value={extraName} onChange={(e) => setExtraName(e.target.value)} />
          <span />
          <span style={{ display: 'flex', gap: 6 }}>
            <input className="input budget-input" style={{ width: 110 }} inputMode="numeric" placeholder="CHF" aria-label="Betrag" value={extraBetrag} onChange={(e) => setExtraBetrag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { extraHinzu(); } }} />
            <button type="button" className="btn sm" onClick={extraHinzu} disabled={extraName.trim() === '' || extraBetrag.trim() === ''}>+</button>
          </span>
        </div>
      </div>

      <div className="budget-summe" style={{ color: ueberschussFarbe(b) }}>
        <span>{b.ueberschuss >= 0 ? 'Überschuss pro Monat' : 'Fehlbetrag pro Monat'}</span>
        <span className="tnum">{b.ueberschuss < 0 ? '−' : ''}CHF {chf(Math.abs(b.ueberschuss))}{b.sparquote !== null ? <span className="xs" style={{ fontWeight: 400, marginLeft: 8 }}>{(b.sparquote * 100).toFixed(0)} % vom Einkommen</span> : null}</span>
      </div>
      <div className="xs muted" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span>{istStandard ? 'Standardwerte aus den Einstellungen' : 'Für dieses Objekt angepasste Werte (gelb markierbar per ↺ zurück)'}</span>
        <span style={{ display: 'flex', gap: 12 }}>
          {!istStandard ? <button type="button" className="linkbtn xs" onClick={() => speichern({})}>Alles auf Standard</button> : null}
          <Link to="/einstellungen">Standardwerte ändern</Link>
        </span>
      </div>
    </div>
  );
}

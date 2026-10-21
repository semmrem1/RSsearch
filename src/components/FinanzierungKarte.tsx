import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { eigenkapital, tragbarkeit, quoteText, stufeFarbe } from '../lib/finanz';
import { chf } from '../lib/format';
import type { Gemeinde, ObjektBudgetDaten } from '../lib/types';

function Betrag({ wert, onChange, aria }: { wert: number; onChange: (v: number) => void; aria: string }) {
  const [text, setText] = useState(String(wert));
  useEffect(() => { setText(String(wert)); }, [wert]);
  return (
    <input
      className="input budget-input" style={{ width: 110 }} inputMode="numeric" aria-label={aria} value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { const v = Number(text.replace(/[^0-9.-]/g, '')); if (!isNaN(v) && Math.round(v) !== wert) { onChange(Math.max(0, Math.round(v))); } else { setText(String(wert)); } }}
      onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

/**
 * Finanzierung: Bank-Sicht (kalk. Zins) neben der effektiven Belastung (realer Zins, pro Objekt anpassbar),
 * Eigenkapital-Bausteine (Basis, erweitertes EK, Säule 3a pro Person; Standard aus den Einstellungen, pro Objekt anpassbar)
 * und Mittelbedarf beim Kauf.
 */
export default function FinanzierungKarte({ preis, daten, speichern, gemeinde, ort }: { preis: number | null; daten: ObjektBudgetDaten | null; speichern: (d: ObjektBudgetDaten) => void; gemeinde: Gemeinde | null; ort: string }) {
  const { haushalt, profiles, leser } = useApp();
  const zinsOverride = daten !== null && daten.zins_effektiv !== undefined ? Number(daten.zins_effektiv) : null;
  const zinsEff = zinsOverride !== null ? zinsOverride : Number(haushalt.zins_effektiv);
  const [zinsText, setZinsText] = useState(String(zinsEff));
  useEffect(() => { setZinsText(String(zinsEff)); }, [zinsEff]);

  const ek = eigenkapital(haushalt, profiles, daten);
  const t = tragbarkeit(preis, haushalt, zinsEff, ek.total);
  const eingerichtet = haushalt.eigenkapital !== null && haushalt.einkommen_jahr !== null;

  function zinsSetzen() {
    const v = Number(zinsText.replace(',', '.'));
    if (daten === null || isNaN(v) || v < 0 || v > 15) { setZinsText(String(zinsEff)); return; }
    const neu: ObjektBudgetDaten = { ...daten };
    if (Math.abs(v - Number(haushalt.zins_effektiv)) < 1e-9) { delete neu.zins_effektiv; } else { neu.zins_effektiv = v; }
    speichern(neu);
  }

  /** EK-Baustein für dieses Objekt setzen; gleich dem Standard = Überschreibung entfernen. */
  function ekSetzen(patch: { basis?: number; erweitert?: number; saeule3a?: { id: string; wert: number } }) {
    if (daten === null) { return; }
    const alt = daten.ek !== undefined ? daten.ek : {};
    const neuEk: NonNullable<ObjektBudgetDaten['ek']> = { ...alt, saeule3a: { ...(alt.saeule3a || {}) } };
    if (patch.basis !== undefined) { if (patch.basis === ek.standardBasis) { delete neuEk.basis; } else { neuEk.basis = patch.basis; } }
    if (patch.erweitert !== undefined) { if (patch.erweitert === ek.standardErweitert) { delete neuEk.erweitert; } else { neuEk.erweitert = patch.erweitert; } }
    if (patch.saeule3a !== undefined) {
      const s3 = neuEk.saeule3a as Record<string, number>;
      if (patch.saeule3a.wert === ek.standardSaeule3a[patch.saeule3a.id]) { delete s3[patch.saeule3a.id]; } else { s3[patch.saeule3a.id] = patch.saeule3a.wert; }
    }
    if (neuEk.saeule3a !== undefined && Object.keys(neuEk.saeule3a).length === 0) { delete neuEk.saeule3a; }
    const neu: ObjektBudgetDaten = { ...daten };
    if (Object.keys(neuEk).length === 0) { delete neu.ek; } else { neu.ek = neuEk; }
    speichern(neu);
  }
  function ekZuruecksetzen() {
    if (daten === null) { return; }
    const neu: ObjektBudgetDaten = { ...daten };
    delete neu.ek;
    speichern(neu);
  }

  const ekZeile = (label: string, hinweis: string, wert: number, standard: number, onChange: (v: number) => void, aria: string) => (
    <tr>
      <td>{label} <span className="xs muted">{hinweis}{wert !== standard ? ' · Standard ' + chf(standard) : ''}</span></td>
      <td className="r">
        {leser ? <span className="tnum">CHF {chf(wert)}</span> : (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
            {standard > 0 && wert > 0 ? <button type="button" className="linkbtn xs" title="Für dieses Objekt nicht einsetzen" onClick={() => onChange(0)}>nicht einsetzen</button> : null}
            {wert !== standard ? <button type="button" className="linkbtn xs" title={'Zurück auf Standard ' + chf(standard)} onClick={() => onChange(standard)}>↺</button> : null}
            <Betrag wert={wert} onChange={onChange} aria={aria} />
          </span>
        )}
      </td>
    </tr>
  );

  return (
    <>
      <div className="card-head">
        <h2 id="fin-h">Finanzierung</h2>
        {leser ? <span className="xs muted">Zins effektiv {zinsEff} %</span> : (
          <label className="xs muted" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            Zins effektiv
            <input className="input budget-input" style={{ width: 64 }} inputMode="decimal" aria-label="Effektiver Hypothekarzins für dieses Objekt" value={zinsText} onChange={(e) => setZinsText(e.target.value)} onBlur={zinsSetzen} onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }} />
            %
            {zinsOverride !== null ? <button type="button" className="linkbtn xs" title={'Zurück auf Standard ' + haushalt.zins_effektiv + ' %'} onClick={() => { if (daten !== null) { const neu = { ...daten }; delete neu.zins_effektiv; speichern(neu); } }}>↺</button> : null}
          </label>
        )}
      </div>
      {t === null ? <div className="small muted" style={{ marginTop: 10 }}>Kein Preis bekannt.</div> : !eingerichtet ? (
        <div className="notice" style={{ marginTop: 10 }}>{leser ? 'Eigenkapital und Einkommen sind noch nicht hinterlegt.' : <>Eigenkapital und Einkommen unter <Link to="/einstellungen">Einstellungen › Haushalt</Link> hinterlegen, dann rechnet die App Tragbarkeit und monatliche Belastung.</>}</div>
      ) : (
        <>
          <table className="fin-tabelle">
            <thead>
              <tr><th /><th className="r">Bank <span className="xs muted">kalk. {haushalt.zins_kalk} %</span></th><th className="r">Effektiv <span className="xs muted">{t.effektiv.zins} %</span></th></tr>
            </thead>
            <tbody>
              <tr><td>Hypothek <span className="xs muted">{(t.belehnung * 100).toFixed(0)} % Belehnung · Preis − Eigenkapital {chf(ek.total)}</span></td><td className="r" colSpan={2}>CHF {chf(t.hypothek)}</td></tr>
              <tr><td>Hypothekarzins</td><td className="r">{chf(t.bank.zinsen)}</td><td className="r">{chf(t.effektiv.zinsen)}</td></tr>
              <tr><td>Nebenkosten, Unterhalt <span className="xs muted">{haushalt.nebenkosten_pct} %</span></td><td className="r">{chf(t.bank.nebenkosten)}</td><td className="r">{chf(t.effektiv.nebenkosten)}</td></tr>
              <tr><td>Amortisation <span className="xs muted">auf 65 % in {haushalt.amortisation_jahre} J.</span></td><td className="r">{chf(t.bank.amortisation)}</td><td className="r">{chf(t.effektiv.amortisation)}</td></tr>
              <tr className="fin-summe"><td>Kosten pro Jahr</td><td className="r">{chf(t.bank.kosten)}</td><td className="r">{chf(t.effektiv.kosten)}</td></tr>
              <tr className="fin-summe"><td>Kosten pro Monat</td><td className="r">{chf(t.bank.kosten / 12)}</td><td className="r" style={{ fontSize: 16 }}>{chf(t.effektiv.kosten / 12)}</td></tr>
              <tr className="fin-summe"><td>Anteil am Einkommen</td><td className="r" style={{ color: stufeFarbe(t.bank.stufe) }}>{t.ekZuTief ? 'EK zu tief' : quoteText(t.bank)}</td><td className="r" style={{ color: stufeFarbe(t.effektiv.stufe) }}>{quoteText(t.effektiv)}</td></tr>
            </tbody>
          </table>
          <div className="xs muted" style={{ marginTop: 6 }}>
            Bank-Sicht entscheidet über die Finanzierung (max. {haushalt.tragbarkeit_max} %): <strong style={{ color: stufeFarbe(t.bank.stufe) }}>{t.bank.stufe === 'ok' ? 'tragbar' : t.bank.stufe === 'knapp' ? 'knapp' : 'nicht tragbar'}</strong>. Effektiv-Sicht ist die reale monatliche Belastung; sie fliesst als «Wohnkosten» ins Budget.
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 14, gap: 8 }}>
            <h3 className="small" style={{ fontWeight: 600 }}>Eigenkapital für dieses Objekt</h3>
            <span className="xs muted">{ek.angepasst ? <>angepasst{!leser ? <> · <button type="button" className="linkbtn xs" onClick={ekZuruecksetzen}>alles auf Standard</button></> : null}</> : 'Standard aus den Einstellungen'}</span>
          </div>
          <table className="fin-tabelle">
            <tbody>
              {ekZeile('Eigenkapital', 'Ersparnisse, Konto', ek.basis, ek.standardBasis, (v) => ekSetzen({ basis: v }), 'Eigenkapital Basis')}
              {ekZeile('Erweitertes EK', 'z.B. Darlehen Götti', ek.erweitert, ek.standardErweitert, (v) => ekSetzen({ erweitert: v }), 'Erweitertes Eigenkapital')}
              {profiles.map((p) => ekZeile('Säule 3a ' + p.name.split(' ')[0], 'Vorbezug für Wohneigentum', ek.saeule3a[p.id] || 0, ek.standardSaeule3a[p.id] || 0, (v) => ekSetzen({ saeule3a: { id: p.id, wert: v } }), 'Säule 3a ' + p.name))}
              <tr className="fin-summe"><td>Eigenkapital eingesetzt <span className="xs muted">mind. 20 % = {chf(t.ekMindest)}</span></td><td className="r" style={t.ekZuTief ? { color: 'var(--warm)' } : undefined}>CHF {chf(t.ekEingesetzt)}</td></tr>
            </tbody>
          </table>
          {t.ekZuTief ? <div className="notice" style={{ marginTop: 8 }}>Belehnung über {haushalt.belehnung_max} %: Es fehlen CHF {chf(t.ekMindest - t.ekEingesetzt)} Eigenkapital.</div> : null}

          <h3 className="small" style={{ marginTop: 14, fontWeight: 600 }}>Beim Kauf</h3>
          <table className="fin-tabelle">
            <tbody>
              <tr><td>Kaufpreis</td><td className="r">CHF {chf(t.preis)}</td></tr>
              <tr><td>Eigenkapital eingesetzt</td><td className="r">CHF {chf(t.ekEingesetzt)}</td></tr>
              <tr><td>Kaufnebenkosten <span className="xs muted">{haushalt.kaufnebenkosten_pct} % · Notar, Grundbuch, Steuern</span></td><td className="r">CHF {chf(t.kaufnebenkosten)}</td></tr>
              <tr className="fin-summe"><td>Mittelbedarf beim Kauf</td><td className="r" style={{ fontSize: 16 }}>CHF {chf(t.mittelbedarf)}</td></tr>
            </tbody>
          </table>
        </>
      )}

      <h3 className="small" style={{ marginTop: 14, fontWeight: 600 }}>Gemeinde &amp; Steuern</h3>
      {gemeinde === null ? (
        <div className="xs muted" style={{ marginTop: 6 }}>Keine Gemeindedaten für «{ort}».{!leser ? <> Unter <Link to="/einstellungen">Einstellungen › Gemeinden</Link> erfassen.</> : null}</div>
      ) : (
        <table className="fin-tabelle">
          <tbody>
            <tr><td>Gemeinde</td><td className="r">{gemeinde.name} {gemeinde.kanton}</td></tr>
            <tr><td>Steuerfuss Gemeinde{gemeinde.steuerfuss_jahr ? <span className="xs muted"> {gemeinde.steuerfuss_jahr}</span> : null}{gemeinde.steuerfuss_hinweis ? <span className="xs muted"> · {gemeinde.steuerfuss_hinweis}</span> : null}</td><td className="r" style={{ fontWeight: 700 }}>{gemeinde.steuerfuss !== null ? gemeinde.steuerfuss + ' %' : '–'}</td></tr>
            {gemeinde.steuerfuss !== null && gemeinde.steuerfuss_kanton !== null && gemeinde.steuerfuss_kanton !== undefined ? <tr><td>Gesamt <span className="xs muted">Kanton {gemeinde.steuerfuss_kanton} %{gemeinde.steuerfuss_bezirk ? ' + Bezirk ' + gemeinde.steuerfuss_bezirk + ' %' : ''} + Gemeinde, ohne Kirche</span></td><td className="r">{Number(gemeinde.steuerfuss) + Number(gemeinde.steuerfuss_kanton) + Number(gemeinde.steuerfuss_bezirk || 0)} %</td></tr> : null}
            {gemeinde.steuer_index !== null ? <tr><td>Steuerbelastungsindex{gemeinde.steuer_index_hinweis ? <span className="xs muted"> · {gemeinde.steuer_index_hinweis}</span> : null}</td><td className="r">{gemeinde.steuer_index}</td></tr> : null}
            {gemeinde.steuer_beispiel_chf !== null ? <tr><td>Steuern Beispiel{gemeinde.steuer_beispiel_hinweis ? <span className="xs muted"> · {gemeinde.steuer_beispiel_hinweis}</span> : null}</td><td className="r">CHF {chf(gemeinde.steuer_beispiel_chf)}</td></tr> : null}
            <tr><td className="xs muted">Schätzung der Steuern: siehe Posten «Steuern» im Budget</td><td className="r">{gemeinde.quelle_url ? <a className="xs" href={gemeinde.quelle_url} target="_blank" rel="noopener noreferrer">Quelle ↗</a> : null}</td></tr>
          </tbody>
        </table>
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { tragbarkeit, quoteText, stufeFarbe } from '../lib/finanz';
import { chf } from '../lib/format';
import type { Gemeinde, ObjektBudgetDaten } from '../lib/types';

/** Finanzierung: Bank-Sicht (kalk. Zins) neben der effektiven Belastung (realer Zins, pro Objekt anpassbar) und Mittelbedarf beim Kauf. */
export default function FinanzierungKarte({ preis, daten, speichern, gemeinde, ort }: { preis: number | null; daten: ObjektBudgetDaten | null; speichern: (d: ObjektBudgetDaten) => void; gemeinde: Gemeinde | null; ort: string }) {
  const { haushalt } = useApp();
  const zinsOverride = daten !== null && daten.zins_effektiv !== undefined ? Number(daten.zins_effektiv) : null;
  const zinsEff = zinsOverride !== null ? zinsOverride : Number(haushalt.zins_effektiv);
  const [zinsText, setZinsText] = useState(String(zinsEff));
  useEffect(() => { setZinsText(String(zinsEff)); }, [zinsEff]);

  const t = tragbarkeit(preis, haushalt, zinsEff);
  const eingerichtet = haushalt.eigenkapital !== null && haushalt.einkommen_jahr !== null;

  function zinsSetzen() {
    const v = Number(zinsText.replace(',', '.'));
    if (daten === null || isNaN(v) || v < 0 || v > 15) { setZinsText(String(zinsEff)); return; }
    const neu: ObjektBudgetDaten = { ...daten };
    if (Math.abs(v - Number(haushalt.zins_effektiv)) < 1e-9) { delete neu.zins_effektiv; } else { neu.zins_effektiv = v; }
    speichern(neu);
  }

  return (
    <>
      <div className="card-head">
        <h2 id="fin-h">Finanzierung</h2>
        <label className="xs muted" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          Zins effektiv
          <input className="input budget-input" style={{ width: 64 }} inputMode="decimal" aria-label="Effektiver Hypothekarzins für dieses Objekt" value={zinsText} onChange={(e) => setZinsText(e.target.value)} onBlur={zinsSetzen} onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }} />
          %
          {zinsOverride !== null ? <button type="button" className="linkbtn xs" title={'Zurück auf Standard ' + haushalt.zins_effektiv + ' %'} onClick={() => { if (daten !== null) { const neu = { ...daten }; delete neu.zins_effektiv; speichern(neu); } }}>↺</button> : null}
        </label>
      </div>
      {t === null ? <div className="small muted" style={{ marginTop: 10 }}>Kein Preis bekannt.</div> : !eingerichtet ? (
        <div className="notice" style={{ marginTop: 10 }}>Eigenkapital und Einkommen unter <Link to="/einstellungen">Einstellungen › Haushalt</Link> hinterlegen, dann rechnet die App Tragbarkeit und monatliche Belastung.</div>
      ) : (
        <>
          <table className="fin-tabelle">
            <thead>
              <tr><th /><th className="r">Bank <span className="xs muted">kalk. {haushalt.zins_kalk} %</span></th><th className="r">Effektiv <span className="xs muted">{t.effektiv.zins} %</span></th></tr>
            </thead>
            <tbody>
              <tr><td>Hypothek <span className="xs muted">{(t.belehnung * 100).toFixed(0)} % Belehnung</span></td><td className="r" colSpan={2}>CHF {chf(t.hypothek)}</td></tr>
              <tr><td>Hypothekarzins</td><td className="r">{chf(t.bank.zinsen)}</td><td className="r">{chf(t.effektiv.zinsen)}</td></tr>
              <tr><td>Nebenkosten, Unterhalt <span className="xs muted">{haushalt.nebenkosten_pct} %</span></td><td className="r">{chf(t.bank.nebenkosten)}</td><td className="r">{chf(t.effektiv.nebenkosten)}</td></tr>
              <tr><td>Amortisation <span className="xs muted">auf 65 % in {haushalt.amortisation_jahre} J.</span></td><td className="r">{chf(t.bank.amortisation)}</td><td className="r">{chf(t.effektiv.amortisation)}</td></tr>
              <tr className="fin-summe"><td>Kosten pro Jahr</td><td className="r">{chf(t.bank.kosten)}</td><td className="r">{chf(t.effektiv.kosten)}</td></tr>
              <tr className="fin-summe"><td>Kosten pro Monat</td><td className="r">{chf(t.bank.kosten / 12)}</td><td className="r" style={{ fontSize: 16 }}>{chf(t.effektiv.kosten / 12)}</td></tr>
              <tr className="fin-summe"><td>Anteil am Einkommen</td><td className="r" style={{ color: stufeFarbe(t.bank.stufe) }}>{t.ekZuTief ? 'EK zu tief' : quoteText(t.bank)}</td><td className="r" style={{ color: stufeFarbe(t.effektiv.stufe) }}>{quoteText(t.effektiv)}</td></tr>
            </tbody>
          </table>
          <div className="xs muted" style={{ marginTop: 6 }}>
            Bank-Sicht entscheidet über die Finanzierung (max. {haushalt.tragbarkeit_max} %): <strong style={{ color: stufeFarbe(t.bank.stufe) }}>{t.bank.stufe === 'ok' ? 'tragbar' : t.bank.stufe === 'knapp' ? 'knapp' : 'nicht tragbar'}</strong>. Effektiv-Sicht ist die reale monatliche Belastung.
          </div>

          <h3 className="small" style={{ marginTop: 14, fontWeight: 600 }}>Beim Kauf</h3>
          <table className="fin-tabelle">
            <tbody>
              <tr><td>Kaufpreis</td><td className="r">CHF {chf(t.preis)}</td></tr>
              <tr><td>Eigenkapital eingesetzt <span className="xs muted">mind. 20 % = {chf(t.ekMindest)}</span></td><td className="r" style={t.ekZuTief ? { color: 'var(--warm)' } : undefined}>CHF {chf(t.ekEingesetzt)}</td></tr>
              <tr><td>Kaufnebenkosten <span className="xs muted">{haushalt.kaufnebenkosten_pct} % · Notar, Grundbuch, Steuern</span></td><td className="r">CHF {chf(t.kaufnebenkosten)}</td></tr>
              <tr className="fin-summe"><td>Mittelbedarf beim Kauf</td><td className="r" style={{ fontSize: 16 }}>CHF {chf(t.mittelbedarf)}</td></tr>
            </tbody>
          </table>
          {t.ekZuTief ? <div className="notice" style={{ marginTop: 8 }}>Belehnung über {haushalt.belehnung_max} %: Es fehlen CHF {chf(t.ekMindest - t.ekEingesetzt)} Eigenkapital.</div> : null}
        </>
      )}

      <h3 className="small" style={{ marginTop: 14, fontWeight: 600 }}>Gemeinde &amp; Steuern</h3>
      {gemeinde === null ? (
        <div className="xs muted" style={{ marginTop: 6 }}>Keine Gemeindedaten für «{ort}». Unter <Link to="/einstellungen">Einstellungen › Gemeinden</Link> erfassen.</div>
      ) : (
        <table className="fin-tabelle">
          <tbody>
            <tr><td>Gemeinde</td><td className="r">{gemeinde.name} {gemeinde.kanton}</td></tr>
            <tr><td>Steuerfuss{gemeinde.steuerfuss_jahr ? <span className="xs muted"> {gemeinde.steuerfuss_jahr}</span> : null}{gemeinde.steuerfuss_hinweis ? <span className="xs muted"> · {gemeinde.steuerfuss_hinweis}</span> : null}</td><td className="r" style={{ fontWeight: 700 }}>{gemeinde.steuerfuss !== null ? gemeinde.steuerfuss + ' %' : '–'}</td></tr>
            {gemeinde.steuer_index !== null ? <tr><td>Steuerbelastungsindex{gemeinde.steuer_index_hinweis ? <span className="xs muted"> · {gemeinde.steuer_index_hinweis}</span> : null}</td><td className="r">{gemeinde.steuer_index}</td></tr> : null}
            {gemeinde.steuer_beispiel_chf !== null ? <tr><td>Steuern Beispiel{gemeinde.steuer_beispiel_hinweis ? <span className="xs muted"> · {gemeinde.steuer_beispiel_hinweis}</span> : null}</td><td className="r">CHF {chf(gemeinde.steuer_beispiel_chf)}</td></tr> : null}
            <tr><td className="xs muted">Nur innerhalb eines Kantons vergleichbar</td><td className="r">{gemeinde.quelle_url ? <a className="xs" href={gemeinde.quelle_url} target="_blank" rel="noopener noreferrer">Quelle ↗</a> : null}</td></tr>
          </tbody>
        </table>
      )}
    </>
  );
}

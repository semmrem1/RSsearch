import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useApp } from '../state/AppContext';
import { pushAktivieren, pushDeaktivieren, pushStatus, pushMoeglich } from '../lib/push';
import { chf } from '../lib/format';
import type { BudgetPosten, Gemeinde, Haushalt, Profile } from '../lib/types';
import { budget } from '../lib/budget';

function Zahl({ id, label, wert, onChange, hinweis, einheit }: { id: string; label: string; wert: number | null; onChange: (v: number | null) => void; hinweis?: string; einheit?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}{einheit ? ' (' + einheit + ')' : ''}</label>
      <input id={id} className="input" inputMode="decimal" value={wert !== null ? String(wert) : ''} onChange={(e) => { const v = e.target.value.replace(/[^0-9.,-]/g, '').replace(',', '.'); onChange(v === '' ? null : Number(v)); }} />
      {hinweis ? <span className="xs muted">{hinweis}</span> : null}
    </div>
  );
}

export default function Einstellungen() {
  const { me, profiles, haushalt, budgetPosten, reloadStammdaten } = useApp();
  const [personen, setPersonen] = useState<Profile[]>([]);
  const [posten, setPosten] = useState<BudgetPosten[]>([]);
  const [neuPosten, setNeuPosten] = useState('');
  const [budgetMeldung, setBudgetMeldung] = useState<string | null>(null);
  const [h, setH] = useState<Haushalt>(haushalt);
  const [hGespeichert, setHGespeichert] = useState<string | null>(null);
  const [push, setPush] = useState<'aktiv' | 'aus' | 'blockiert' | 'unmoeglich' | 'lade'>('lade');
  const [pushMeldung, setPushMeldung] = useState<string | null>(null);
  const [arbeitsort, setArbeitsort] = useState('');
  const [stationen, setStationen] = useState<{ name: string; lat: number; lng: number }[]>([]);
  const [arbeitMeldung, setArbeitMeldung] = useState<string | null>(null);
  const [gemeinden, setGemeinden] = useState<Gemeinde[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [geheimnisse, setGeheimnisse] = useState<Record<string, boolean>>({});
  const [keyMeldung, setKeyMeldung] = useState<string | null>(null);

  useEffect(() => { setH(haushalt); }, [haushalt]);
  useEffect(() => { setPersonen(profiles); }, [profiles]);
  useEffect(() => { setPosten(budgetPosten); }, [budgetPosten]);
  useEffect(() => {
    pushStatus().then(setPush);
    supabase.from('gemeinden').select('*').order('kanton').order('name').then(({ data }) => { if (data) { setGemeinden(data as Gemeinde[]); } });
    supabase.rpc('geheimnisse_vorhanden').then(({ data }) => {
      const m: Record<string, boolean> = {};
      ((data || []) as { name: string; gesetzt: boolean }[]).forEach((r) => { m[r.name] = r.gesetzt; });
      setGeheimnisse(m);
    });
  }, []);
  useEffect(() => { if (me !== null && me.arbeitsort) { setArbeitsort(me.arbeitsort); } }, [me]);

  async function haushaltSpeichern() {
    const { error } = await supabase.from('haushalt').upsert({ ...h, id: 1, updated_at: new Date().toISOString() });
    setHGespeichert(error ? error.message : 'Gespeichert');
    if (!error) { reloadStammdaten(); }
  }

  async function stationSuchen() {
    setArbeitMeldung(null);
    const { data, error } = await supabase.functions.invoke('pendelzeit', { body: { aktion: 'station_suchen', text: arbeitsort } });
    if (error) { setArbeitMeldung(error.message); return; }
    const res = data as { stationen: { name: string; lat: number; lng: number }[] };
    setStationen(res.stationen);
    if (res.stationen.length === 0) { setArbeitMeldung('Keine Station gefunden. Anders schreiben (z.B. «Zürich HB»).'); }
  }

  async function arbeitsortSetzen(s: { name: string; lat: number; lng: number }) {
    if (me === null) { return; }
    const { error } = await supabase.from('profiles').update({ arbeitsort: s.name, arbeitsort_lat: s.lat, arbeitsort_lng: s.lng, arbeitsort_station: s.name }).eq('id', me.id);
    if (error) { setArbeitMeldung(error.message); return; }
    setStationen([]); setArbeitsort(s.name);
    setArbeitMeldung('Arbeitsort gespeichert. Pendelzeiten werden berechnet …');
    reloadStammdaten();
    const r = await supabase.functions.invoke('pendelzeit', { body: { user_id: me.id, erzwingen: true } });
    const res = r.data as { berechnet?: number } | null;
    setArbeitMeldung(res !== null && res.berechnet !== undefined ? res.berechnet + ' Pendelzeiten berechnet.' : 'Berechnung gestartet.');
  }

  async function pendelNeu() {
    setArbeitMeldung('Berechne …');
    const r = await supabase.functions.invoke('pendelzeit', { body: { erzwingen: true } });
    const res = r.data as { berechnet?: number; hinweis?: string } | null;
    setArbeitMeldung(res !== null ? (res.hinweis || res.berechnet + ' Pendelzeiten neu berechnet.') : 'Fehler');
  }

  async function pushUmschalten() {
    if (me === null) { return; }
    setPushMeldung(null);
    if (push === 'aktiv') { await pushDeaktivieren(); setPush('aus'); return; }
    const err = await pushAktivieren(me.id);
    if (err !== null) { setPushMeldung(err); } else { setPush('aktiv'); setPushMeldung('Aktiviert. Testnachricht wird gesendet …'); await supabase.rpc('push_senden', { p_titel: 'PRimmo', p_text: 'Push-Benachrichtigungen sind aktiv.', p_url: '/', p_user_ids: [me.id] }); }
  }

  async function personSpeichern(p: Profile) {
    const { error } = await supabase.from('profiles').update({ nettolohn_100_monat: p.nettolohn_100_monat !== undefined ? p.nettolohn_100_monat : null, pensum_pct: p.pensum_pct !== undefined && p.pensum_pct !== null ? p.pensum_pct : 100 }).eq('id', p.id);
    setBudgetMeldung(error ? error.message : 'Gespeichert');
    if (!error) { reloadStammdaten(); }
  }

  async function postenSpeichern(x: BudgetPosten) {
    const { error } = await supabase.from('budget_posten').upsert({ id: x.id, name: x.name, betrag_monat: Math.round(Number(x.betrag_monat) || 0), kategorie: x.kategorie, sort: x.sort });
    setBudgetMeldung(error ? error.message : 'Gespeichert');
    if (!error) { reloadStammdaten(); }
  }

  async function postenNeu() {
    if (neuPosten.trim() === '') { return; }
    const sort = posten.reduce((m, x) => Math.max(m, x.sort), 0) + 10;
    const { error } = await supabase.from('budget_posten').insert({ name: neuPosten.trim(), betrag_monat: 0, kategorie: 'fix', sort });
    setBudgetMeldung(error ? error.message : 'Hinzugefügt');
    if (!error) { setNeuPosten(''); reloadStammdaten(); }
  }

  async function postenLoeschen(x: BudgetPosten) {
    if (!window.confirm('«' + x.name + '» aus den Standardausgaben entfernen?')) { return; }
    const { error } = await supabase.from('budget_posten').delete().eq('id', x.id);
    setBudgetMeldung(error ? error.message : 'Entfernt');
    if (!error) { reloadStammdaten(); }
  }

  async function gemeindeSpeichern(g: Gemeinde) {
    await supabase.from('gemeinden').upsert({ ...g, updated_at: new Date().toISOString() });
  }

  async function keySpeichern() {
    if (apiKey.trim() === '') { return; }
    const { error } = await supabase.rpc('geheimnis_setzen', { p_name: 'anthropic_api_key', p_wert: apiKey.trim() });
    setKeyMeldung(error ? error.message : 'Gespeichert (verschlüsselt im Supabase Vault).');
    if (!error) { setApiKey(''); setGeheimnisse({ ...geheimnisse, anthropic_api_key: true }); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Einstellungen</h1><p className="sub">Benachrichtigungen, Arbeitsort, Finanzen, Gemeinden, Exposé-Extraktion</p></div>
        <Link to="/lauf" className="btn">Lauf-Protokoll</Link>
      </div>

      <div className="two-col">
        <div className="main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section className="card pad" aria-labelledby="push-h">
            <h2 id="push-h">Benachrichtigungen</h2>
            <p className="small muted" style={{ marginTop: 4 }}>Push bei neuen Inseraten, Preissenkungen und Kommentaren der anderen Person. Funktioniert in Chrome, auch als installierte App.</p>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              <button type="button" className={'btn' + (push === 'aktiv' ? '' : ' primary')} disabled={push === 'lade' || push === 'unmoeglich' || push === 'blockiert'} onClick={pushUmschalten}>
                {push === 'aktiv' ? 'Push deaktivieren' : 'Push aktivieren'}
              </button>
              <span className="small muted">{push === 'aktiv' ? 'Aktiv auf diesem Gerät' : push === 'blockiert' ? 'In den Browser-Einstellungen blockiert' : push === 'unmoeglich' || !pushMoeglich() ? 'Nicht unterstützt' : 'Auf diesem Gerät nicht aktiv'}</span>
            </div>
            {pushMeldung !== null ? <div className="notice" style={{ marginTop: 10 }}>{pushMeldung}</div> : null}
          </section>

          <section className="card pad" aria-labelledby="arbeit-h">
            <h2 id="arbeit-h">Mein Arbeitsort</h2>
            <p className="small muted" style={{ marginTop: 4 }}>ÖV-Pendelzeit pro Objekt (Montag 07:30, inkl. Fussweg zur nächsten Station). Als Bahnhof oder Haltestelle angeben.</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <input className="input" style={{ flex: '1 1 240px' }} placeholder="z.B. Zürich HB, Zürich Stadelhofen, Baden" value={arbeitsort} onChange={(e) => setArbeitsort(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { stationSuchen(); } }} />
              <button type="button" className="btn" onClick={stationSuchen}>Suchen</button>
            </div>
            {stationen.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {stationen.map((s) => <button key={s.name} type="button" className="chip outline" style={{ cursor: 'pointer', padding: '8px 10px' }} onClick={() => arbeitsortSetzen(s)}>{s.name}</button>)}
              </div>
            ) : null}
            <div className="small" style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {profiles.map((p) => <span key={p.id}><span style={{ color: p.farbe, fontWeight: 600 }}>{p.name.split(' ')[0]}</span>: {p.arbeitsort_station || p.arbeitsort || <span className="muted">kein Arbeitsort</span>}</span>)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn sm" onClick={pendelNeu}>Pendelzeiten neu berechnen</button>
              {arbeitMeldung !== null ? <span className="small muted">{arbeitMeldung}</span> : null}
            </div>
          </section>

          <section className="card pad" aria-labelledby="fin-h">
            <h2 id="fin-h">Haushalt &amp; Tragbarkeit</h2>
            <p className="small muted" style={{ marginTop: 4 }}>Gemeinsame Werte für beide. Bankübliche Rechnung: kalkulatorischer Zins, Nebenkosten, Amortisation der 2. Hypothek auf 65 % Belehnung. Tragbar, wenn die Kosten unter dem Maximum liegen.</p>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <Zahl id="ek" label="Eigenkapital" einheit="CHF" wert={h.eigenkapital} onChange={(v) => setH({ ...h, eigenkapital: v })} hinweis="Inkl. Vorsorgegelder, die eingesetzt werden" />
              <Zahl id="eink" label="Haushaltseinkommen pro Jahr" einheit="CHF brutto" wert={h.einkommen_jahr} onChange={(v) => setH({ ...h, einkommen_jahr: v })} />
              <Zahl id="zins" label="Kalkulatorischer Zins" einheit="%" wert={h.zins_kalk} onChange={(v) => setH({ ...h, zins_kalk: v !== null ? v : 5 })} />
              <Zahl id="nk" label="Nebenkosten" einheit="% des Preises" wert={h.nebenkosten_pct} onChange={(v) => setH({ ...h, nebenkosten_pct: v !== null ? v : 1 })} />
              <Zahl id="amort" label="Amortisation" einheit="Jahre" wert={h.amortisation_jahre} onChange={(v) => setH({ ...h, amortisation_jahre: v !== null ? Math.round(v) : 15 })} />
              <Zahl id="bel" label="Max. Belehnung" einheit="%" wert={h.belehnung_max} onChange={(v) => setH({ ...h, belehnung_max: v !== null ? v : 80 })} />
              <Zahl id="trag" label="Max. Tragbarkeit" einheit="%" wert={h.tragbarkeit_max} onChange={(v) => setH({ ...h, tragbarkeit_max: v !== null ? v : 33 })} />
              <Zahl id="kaufnk" label="Kaufnebenkosten" einheit="% des Preises" wert={h.kaufnebenkosten_pct} onChange={(v) => setH({ ...h, kaufnebenkosten_pct: v !== null ? v : 1.5 })} hinweis="Notar, Grundbuch, Handänderungssteuer; je nach Kanton ca. 0.5 bis 2 %" />
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
              <button type="button" className="btn primary" onClick={haushaltSpeichern}>Speichern</button>
              {hGespeichert !== null ? <span className="small muted">{hGespeichert}</span> : null}
              {h.eigenkapital !== null && h.einkommen_jahr !== null ? <span className="small muted">Beispiel 2.0 Mio: Hypothek CHF {chf(Math.max(0, 2000000 - h.eigenkapital))}</span> : null}
            </div>
          </section>

          <section className="card pad" aria-labelledby="budget-h">
            <h2 id="budget-h">Budget</h2>
            <p className="small muted" style={{ marginTop: 4 }}>Standardwerte für die Budgetrechnung auf jeder Inseratsseite. Dort lassen sich Pensum und Ausgaben pro Objekt abweichend eintragen.</p>
            <h3 className="small" style={{ marginTop: 14, fontWeight: 600 }}>Einkommen</h3>
            <div className="rows" style={{ marginTop: 6 }}>
              {personen.map((p) => (
                <div key={p.id} className="budget-person">
                  <span style={{ color: p.farbe, fontWeight: 600 }}>{p.name.split(' ')[0]}</span>
                  <label className="field"><span className="xs muted">Nettolohn pro Monat bei 100 %</span>
                    <input className="input" inputMode="numeric" value={p.nettolohn_100_monat !== null && p.nettolohn_100_monat !== undefined ? String(p.nettolohn_100_monat) : ''} onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ''); setPersonen(personen.map((x) => (x.id === p.id ? { ...x, nettolohn_100_monat: v === '' ? null : Number(v) } : x))); }} onBlur={() => personSpeichern(personen.find((x) => x.id === p.id) as Profile)} />
                  </label>
                  <label className="field"><span className="xs muted">Pensum %</span>
                    <input className="input" inputMode="numeric" value={p.pensum_pct !== null && p.pensum_pct !== undefined ? String(p.pensum_pct) : '100'} onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ''); setPersonen(personen.map((x) => (x.id === p.id ? { ...x, pensum_pct: v === '' ? 0 : Math.min(100, Number(v)) } : x))); }} onBlur={() => personSpeichern(personen.find((x) => x.id === p.id) as Profile)} />
                  </label>
                  <span className="tnum small" style={{ textAlign: 'right', fontWeight: 600 }}>{chf(Math.round((Number(p.nettolohn_100_monat) || 0) * (p.pensum_pct !== null && p.pensum_pct !== undefined ? Number(p.pensum_pct) : 100) / 100))}</span>
                </div>
              ))}
            </div>
            <div className="form-grid" style={{ marginTop: 10 }}>
              <Zahl id="weitere" label="Weitere Einkünfte pro Monat" einheit="CHF" wert={h.weitere_einkuenfte_monat} onChange={(v) => setH({ ...h, weitere_einkuenfte_monat: v !== null ? v : 0 })} hinweis="Kinderzulagen, Nebenerwerb, Mieteinnahmen" />
              <Zahl id="zinseff" label="Effektiver Hypozins" einheit="%" wert={h.zins_effektiv} onChange={(v) => setH({ ...h, zins_effektiv: v !== null ? v : 1.5 })} hinweis="Für das Budget; die Tragbarkeit rechnet weiter mit dem kalkulatorischen Zins" />
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
              <button type="button" className="btn" onClick={haushaltSpeichern}>Einkünfte und Zins speichern</button>
              <span className="small muted tnum">Haushaltseinkommen: CHF {chf(budget(null, h, personen, posten).einkommen)} pro Monat</span>
            </div>

            <h3 className="small" style={{ marginTop: 18, fontWeight: 600 }}>Ausgaben pro Monat (Standard)</h3>
            <div className="rows" style={{ marginTop: 6 }}>
              {posten.map((x) => (
                <div key={x.id} className="budget-posten">
                  <input className="input" aria-label="Name" value={x.name} onChange={(e) => setPosten(posten.map((y) => (y.id === x.id ? { ...y, name: e.target.value } : y)))} onBlur={() => postenSpeichern(posten.find((y) => y.id === x.id) as BudgetPosten)} />
                  <select className="select" aria-label="Kategorie" value={x.kategorie} onChange={(e) => { const neu = posten.map((y) => (y.id === x.id ? { ...y, kategorie: e.target.value as BudgetPosten['kategorie'] } : y)); setPosten(neu); postenSpeichern(neu.find((y) => y.id === x.id) as BudgetPosten); }}>
                    <option value="fix">fix</option><option value="variabel">variabel</option><option value="sparen">sparen</option>
                  </select>
                  <input className="input budget-input" style={{ width: 100 }} inputMode="numeric" aria-label="Betrag" value={String(x.betrag_monat)} onChange={(e) => setPosten(posten.map((y) => (y.id === x.id ? { ...y, betrag_monat: Number(e.target.value.replace(/[^0-9]/g, '')) || 0 } : y)))} onBlur={() => postenSpeichern(posten.find((y) => y.id === x.id) as BudgetPosten)} />
                  <button type="button" className="linkbtn" aria-label={x.name + ' entfernen'} onClick={() => postenLoeschen(x)}>✕</button>
                </div>
              ))}
              <div className="budget-posten" style={{ background: 'var(--bg)' }}>
                <input className="input" placeholder="Neuer Posten" aria-label="Neuer Posten" value={neuPosten} onChange={(e) => setNeuPosten(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { postenNeu(); } }} />
                <span /><span />
                <button type="button" className="btn sm" onClick={postenNeu} disabled={neuPosten.trim() === ''}>+</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
              <span className="small muted tnum">Total Ausgaben: CHF {chf(posten.reduce((s, x) => s + (Number(x.betrag_monat) || 0), 0))} pro Monat</span>
              {budgetMeldung !== null ? <span className="small muted">· {budgetMeldung}</span> : null}
            </div>
          </section>

          <section className="card pad" aria-labelledby="key-h">
            <h2 id="key-h">Exposé-Extraktion (Claude API)</h2>
            <p className="small muted" style={{ marginTop: 4 }}>Für «Kennzahlen» bei PDF-Exposés braucht die App einen Anthropic API Key (console.anthropic.com). Er wird verschlüsselt im Supabase Vault abgelegt und nur von der Server-Funktion gelesen.</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" style={{ flex: '1 1 260px' }} type="password" autoComplete="off" placeholder={geheimnisse.anthropic_api_key ? 'Key ist gesetzt, zum Ersetzen neu eingeben' : 'sk-ant-…'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <button type="button" className="btn" onClick={keySpeichern} disabled={apiKey.trim() === ''}>Speichern</button>
              <span className="small muted">{geheimnisse.anthropic_api_key ? 'Status: gesetzt' : 'Status: fehlt'}{keyMeldung !== null ? ' · ' + keyMeldung : ''}</span>
            </div>
          </section>
        </div>

        <aside className="side">
          <section className="card pad" aria-labelledby="gem-h">
            <h2 id="gem-h">Gemeinden &amp; Steuerfüsse</h2>
            <p className="xs muted" style={{ marginTop: 4 }}>Steuerfuss in % der einfachen Staatssteuer, nur innerhalb eines Kantons vergleichbar. Werte direkt editierbar.</p>
            <div className="rows" style={{ marginTop: 8, maxHeight: 520, overflowY: 'auto' }}>
              {gemeinden.map((g) => (
                <div key={g.name} style={{ display: 'grid', gridTemplateColumns: '1fr 72px 56px', gap: 8, alignItems: 'center', padding: '6px 0' }}>
                  <span className="small" style={{ minWidth: 0 }}><span style={{ fontWeight: 600 }}>{g.name}</span> <span className="xs muted">{g.kanton}</span>{g.quelle_url ? <> <a className="xs" href={g.quelle_url} target="_blank" rel="noopener noreferrer">↗</a></> : null}</span>
                  <input className="input" style={{ minHeight: 34, padding: '0 8px' }} inputMode="decimal" aria-label={'Steuerfuss ' + g.name} value={g.steuerfuss !== null ? String(g.steuerfuss) : ''} onChange={(e) => { const v = e.target.value.replace(',', '.'); setGemeinden(gemeinden.map((x) => (x.name === g.name ? { ...x, steuerfuss: v === '' ? null : Number(v) } : x))); }} onBlur={() => gemeindeSpeichern(gemeinden.find((x) => x.name === g.name) as Gemeinde)} />
                  <input className="input" style={{ minHeight: 34, padding: '0 8px' }} inputMode="numeric" aria-label={'Jahr ' + g.name} value={g.steuerfuss_jahr !== null ? String(g.steuerfuss_jahr) : ''} onChange={(e) => setGemeinden(gemeinden.map((x) => (x.name === g.name ? { ...x, steuerfuss_jahr: e.target.value === '' ? null : Number(e.target.value) } : x)))} onBlur={() => gemeindeSpeichern(gemeinden.find((x) => x.name === g.name) as Gemeinde)} />
                </div>
              ))}
              {gemeinden.length === 0 ? <div className="small muted" style={{ padding: 10 }}>Noch keine Gemeinden erfasst.</div> : null}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

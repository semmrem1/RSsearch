import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useApp } from '../state/AppContext';
import { Avatar } from '../components/Layout';
import ObjektBild from '../components/ObjektBild';
import Karte from '../components/KarteLazy';
import { direktQuelle, quelleDirekt } from '../lib/links';
import { geocode, geoSuchtext } from '../lib/geo';
import KriterienGrid from '../components/KriterienGrid';
import Galerie from '../components/Galerie';
import ZusammenfuehrenModal from '../components/ZusammenfuehrenModal';
import BudgetKarte from '../components/BudgetKarte';
import { useObjektBudget } from '../hooks/useObjektBudget';
import { budget, ueberschussFarbe } from '../lib/budget';
import { ampel, AMPEL_FARBE, AMPEL_LABEL } from '../lib/ampel';
import AmpelInfo from '../components/AmpelInfo';
import FinanzierungKarte from '../components/FinanzierungKarte';
import { tragbarkeit, quoteText, stufeFarbe } from '../lib/finanz';
import type { ExposeExtrakt, Gemeinde, ObjektUebersicht } from '../lib/types';
import { chf, pct, dateShort, dateLong, dateTime, bytes, typLabel, marktText } from '../lib/format';
import type { Objekt, Quelle, Snapshot, Aktivitaet, Dokument, Standortfaktor, AktivitaetTyp } from '../lib/types';

export default function Detail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { me, profiles, stufen, stufeByCode, haushalt, budgetPosten } = useApp();
  const { daten: budgetDaten, speichern: budgetSpeichern } = useObjektBudget(id);
  const [o, setO] = useState<Objekt | null>(null);
  const [quellen, setQuellen] = useState<Quelle[]>([]);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [akt, setAkt] = useState<Aktivitaet[]>([]);
  const [docs, setDocs] = useState<Dokument[]>([]);
  const [loc, setLoc] = useState<Standortfaktor[]>([]);
  const [missing, setMissing] = useState(false);

  // Aktivität erfassen
  const [aTyp, setATyp] = useState<AktivitaetTyp>('notiz');
  const [aText, setAText] = useState('');
  const [aFaellig, setAFaellig] = useState('');
  const [uploading, setUploading] = useState(false);
  const [extrakte, setExtrakte] = useState<ExposeExtrakt[]>([]);
  const [gemeinde, setGemeinde] = useState<Gemeinde | null>(null);
  const [extrahiere, setExtrahiere] = useState<string | null>(null);
  const [zfOffen, setZfOffen] = useState(false);
  const [galerieVersion] = useState(0);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [ue, setUe] = useState<ObjektUebersicht | null>(null);
  const [bildLaedt, setBildLaedt] = useState(false);
  const [geoStatus, setGeoStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) { return; }
    const [a, b, c, d, f, g] = await Promise.all([
      supabase.from('objekte').select('*').eq('id', id).maybeSingle(),
      supabase.from('objekt_quellen').select('*').eq('objekt_id', id).order('spiegel_von', { nullsFirst: true }).order('erstmals_gesehen'),
      supabase.from('snapshots').select('*').eq('objekt_id', id).order('datum', { ascending: false }),
      supabase.from('aktivitaeten').select('*').eq('objekt_id', id).order('datum', { ascending: false }),
      supabase.from('dokumente').select('*').eq('objekt_id', id).order('created_at', { ascending: false }),
      supabase.from('standortfaktoren').select('*').eq('objekt_id', id).order('id'),
    ]);
    if (a.data === null) { setMissing(true); return; }
    setO(a.data as Objekt);
    setQuellen((b.data || []) as Quelle[]);
    setSnaps((c.data || []) as Snapshot[]);
    setAkt((d.data || []) as Aktivitaet[]);
    setDocs((f.data || []) as Dokument[]);
    setLoc((g.data || []) as Standortfaktor[]);
    const obj = a.data as Objekt;
    if (obj.zusammengefuehrt_in) { return; }
    const [ex, gm, uv] = await Promise.all([
      supabase.from('expose_extrakte').select('*').eq('objekt_id', id).order('erstellt_am', { ascending: false }),
      supabase.from('ortschaften').select('gemeinde').eq('ort', obj.ort).maybeSingle(),
      supabase.from('v_objekte_uebersicht').select('*').eq('id', id).maybeSingle(),
    ]);
    setUe(uv.data !== null ? (uv.data as ObjektUebersicht) : null);
    setExtrakte((ex.data || []) as ExposeExtrakt[]);
    const gName = gm.data !== null ? (gm.data as { gemeinde: string }).gemeinde : obj.ort;
    const g2 = await supabase.from('gemeinden').select('*').eq('name', gName).maybeSingle();
    setGemeinde(g2.data !== null ? (g2.data as Gemeinde) : null);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Aufgelöste Dublette: zum Ziel weiterleiten. Sonst Besuch merken (für «neu für dich»).
  useEffect(() => {
    if (o === null || me === null) { return; }
    if (o.zusammengefuehrt_in) { nav('/inserate/' + o.zusammengefuehrt_in, { replace: true }); return; }
    supabase.from('objekt_besuche').upsert({ objekt_id: o.id, user_id: me.id, zuletzt: new Date().toISOString() }).then(() => undefined);
  }, [o === null ? null : o.id, o === null ? null : o.zusammengefuehrt_in, me === null ? null : me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Koordinaten fehlen oder Adresse geändert: hier direkt ermitteln
  useEffect(() => {
    if (o === null || o.geo_genauigkeit === 'manuell') { return; }
    if (o.lat !== null && o.geo_suchtext === geoSuchtext(o)) { return; }
    let ab = false;
    setGeoStatus('Adresse wird gesucht …');
    geocode(o).then(async (t) => {
      if (ab) { return; }
      if (t === null) { setGeoStatus('Adresse nicht gefunden. Marker manuell setzen: auf der Karte verschieben.'); return; }
      const patch = { lat: t.lat, lng: t.lng, geo_genauigkeit: t.genauigkeit, geo_suchtext: geoSuchtext(o) };
      await supabase.from('objekte').update(patch).eq('id', o.id);
      if (!ab) { setO({ ...o, ...patch }); setGeoStatus(null); }
    }).catch(() => { if (!ab) { setGeoStatus('Kartendienst nicht erreichbar.'); } });
    return () => { ab = true; };
  }, [o === null ? null : o.id, o === null ? null : geoSuchtext(o)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (missing) { return <div className="empty">Objekt nicht gefunden. <Link to="/inserate">Zurück</Link></div>; }
  if (o === null) { return <div className="empty">Lade …</div>; }

  const stufe = stufeByCode(o.stufe_code);
  const priceSnaps = snaps.filter((s) => s.typ === 'preis' || s.typ === 'erfasst').slice().reverse();
  const series: { date: string; v: number }[] = [];
  priceSnaps.forEach((s) => { if (s.neu) { series.push({ date: s.datum, v: Number(s.neu) }); } });
  if (series.length === 0 && o.preis_chf !== null) { series.push({ date: o.created_at, v: o.preis_chf }); }
  const maxV = series.reduce((m, p) => Math.max(m, p.v), 0);
  const lastPriceChange = snaps.find((s) => s.typ === 'preis');

  async function saveAkt(e: FormEvent) {
    e.preventDefault();
    if (!aText.trim() || me === null) { return; }
    const labels: Record<string, string> = { notiz: 'Notiz', mail: 'Mail an Makler', telefon: 'Telefonat', besichtigung: 'Besichtigung', termin: 'Termin', dokument: 'Dokument', stufe: 'Stufe', system: 'System' };
    const text = aText.trim();
    await supabase.from('aktivitaeten').insert({ objekt_id: o!.id, user_id: me.id, typ: aTyp, titel: labels[aTyp], text, faellig_am: aFaellig ? new Date(aFaellig).toISOString() : null });
    // Push an die anderen (bei @Name nur an die Erwähnten)
    const erwaehnt = profiles.filter((p) => p.id !== me.id && new RegExp('@' + p.name.split(' ')[0], 'i').test(text));
    const andere = erwaehnt.length > 0 ? erwaehnt : profiles.filter((p) => p.id !== me.id);
    if (andere.length > 0) {
      const titel = me.name.split(' ')[0] + ': ' + labels[aTyp] + ' zu ' + o!.ort + (o!.adresse ? ', ' + o!.adresse : '');
      supabase.rpc('push_senden', { p_titel: titel, p_text: text.slice(0, 160), p_url: '/inserate/' + o!.id, p_user_ids: andere.map((p) => p.id) }).then(() => undefined);
    }
    setAText(''); setAFaellig('');
    load();
  }

  async function toggleDone(a: Aktivitaet) {
    await supabase.from('aktivitaeten').update({ erledigt: !a.erledigt }).eq('id', a.id);
    load();
  }

  async function changeStufe(code: string) {
    await supabase.from('objekte').update({ stufe_code: code }).eq('id', o!.id);
    load();
  }

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || me === null) { return; }
    setUploading(true);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const path = o!.id + '/' + Date.now() + '_' + f.name.replace(/[^A-Za-z0-9._-]/g, '_');
      const { error } = await supabase.storage.from('dokumente').upload(path, f, { contentType: f.type });
      if (!error) {
        await supabase.from('dokumente').insert({ objekt_id: o!.id, user_id: me.id, name: f.name, storage_path: path, groesse_bytes: f.size, mime: f.type || null, kategorie: /expos|verkaufsdok/i.test(f.name) ? 'expose' : /grundriss/i.test(f.name) ? 'grundriss' : 'sonstiges' });
        await supabase.from('aktivitaeten').insert({ objekt_id: o!.id, user_id: me.id, typ: 'dokument', titel: 'Dokument hochgeladen', text: f.name });
      }
    }
    setUploading(false);
    e.target.value = '';
    load();
  }

  async function markerVerschoben(_id: string, lat: number, lng: number) {
    const patch = { lat, lng, geo_genauigkeit: 'manuell' as const };
    await supabase.from('objekte').update(patch).eq('id', o!.id);
    setO({ ...o!, ...patch });
  }

  async function bildHochladen(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files !== null ? e.target.files[0] : undefined;
    if (f === undefined) { return; }
    setBildLaedt(true);
    const path = o!.id + '/' + Date.now() + '_' + f.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const { error } = await supabase.storage.from('objektbilder').upload(path, f, { contentType: f.type, upsert: true });
    if (!error) {
      await supabase.from('objekte').update({ bild_pfad: path, bild_fehler: null }).eq('id', o!.id);
      setO({ ...o!, bild_pfad: path, bild_fehler: null });
    }
    setBildLaedt(false);
    e.target.value = '';
  }

  async function extrahieren(d: Dokument) {
    setExtrahiere(d.id); setHinweis(null);
    const { data, error } = await supabase.functions.invoke('expose-extrahieren', { body: { dokument_id: d.id } });
    setExtrahiere(null);
    const res = data as { error?: string } | null;
    if (error || (res !== null && res.error)) {
      let msg = res !== null && res.error ? res.error : (error ? error.message : 'Fehler');
      if (error && (error as { context?: Response }).context) {
        try { const j = await ((error as { context: Response }).context).json(); if (j && j.error) { msg = j.error; } } catch { /* egal */ }
      }
      setHinweis(msg);
      return;
    }
    load();
  }

  async function zusammengefuehrt(zielId: string) {
    setZfOffen(false);
    nav('/inserate/' + zielId, { replace: true });
  }

  async function openDoc(d: Dokument) {
    const { data } = await supabase.storage.from('dokumente').createSignedUrl(d.storage_path, 600);
    if (data) { window.open(data.signedUrl, '_blank', 'noopener'); }
  }

  const direkt = direktQuelle(quellen);
  const genauText = o.geo_genauigkeit === 'adresse' ? 'Position aus Adresse' : o.geo_genauigkeit === 'manuell' ? 'Position manuell gesetzt' : o.geo_genauigkeit === 'ort' ? 'Nur Ort bekannt, Position ungefähr' : '';
  const geoAdminLink = o.lat !== null && o.lng !== null ? 'https://map.geo.admin.ch/#/map?lang=de&center=' + o.lng.toFixed(6) + ',' + o.lat.toFixed(6) + '&z=12&crosshair=marker&bgLayer=ch.swisstopo.swissimage&swisssearch=' + encodeURIComponent((o.adresse || '') + ' ' + o.ort) : null;


  return (
    <>
      {/* In der installierten App gibt es keinen Browser-Zurück-Knopf */}
      <button type="button" className="linkbtn small" style={{ alignSelf: 'flex-start', fontWeight: 500 }} onClick={() => { if (window.history.state !== null && window.history.state.idx > 0) { nav(-1); } else { nav('/'); } }}>← Zurück</button>

      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span className="chip accent">{stufe !== null ? stufe.name : o.stufe_code}</span>
            <span className={'chip ' + (o.markt_status === 'aktiv' ? 'green' : 'warm')}>{marktText(o.markt_status, o.offline_seit)}</span>
            <span className="xs muted">Erstmals gesehen {dateLong(o.erstmals_gesehen)} · zuletzt bestätigt {dateLong(o.zuletzt_gesehen)}</span>
          </div>
          <h1>{o.ort} · {o.zimmer !== null ? o.zimmer + '-Zimmer-' : ''}{typLabel(o.typ)}{o.titel ? ' «' + o.titel + '»' : ''}</h1>
          <p className="sub">{o.adresse ? o.adresse : 'Adresse noch nicht publiziert'}{o.plz ? ' · ' + o.plz : ''}{o.kanton ? ' ' + o.kanton : ''}{o.lage_hinweis ? ' · ' + o.lage_hinweis : ''}</p>
        </div>
        <div className="detail-aktionen" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {direkt !== null && direkt.url ? (
            <a className="btn primary" href={direkt.url} target="_blank" rel="noopener noreferrer" style={{ minHeight: 44 }}>Inserat öffnen ↗ <span style={{ fontWeight: 400, opacity: 0.85 }}>{direkt.makler}</span></a>
          ) : (
            <span className="chip link-fehlt" style={{ padding: '10px 12px' }} title="Kein Direktlink hinterlegt, wird beim nächsten Lauf ergänzt">Kein Direktlink zum Inserat</span>
          )}
          <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setZfOffen(true)} title="Dublette manuell zusammenführen">Zusammenführen</button>
          <label htmlFor="stufe-sel" className="sr-only">Stufe wechseln</label>
          <select id="stufe-sel" className="select" style={{ width: 'auto', minHeight: 44 }} value={o.stufe_code} onChange={(e) => changeStufe(e.target.value)}>
            {stufen.map((s) => <option key={s.code} value={s.code}>{s.phase_name} · {s.name}</option>)}
          </select>
        </div>
      </div>

      {o.markt_status === 'offline' || o.markt_status === 'verkauft' ? (
        <div className="notice" role="status">
          <strong>{marktText(o.markt_status, o.offline_seit)}.</strong> Der tägliche Lauf hat das Inserat beim Makler nicht mehr gefunden. Taucht es wieder auf, wird es automatisch wieder aktiv.
        </div>
      ) : null}

      <section className="card" aria-labelledby="lage-h">
        <h2 id="lage-h" className="sr-only">Bild und Lage</h2>
        <div className="lage-grid">
          <ObjektBild o={o} className="hero" label />
          {o.lat !== null && o.lng !== null ? (
            <Karte punkte={[{ id: o.id, lat: o.lat, lng: o.lng, genau: o.geo_genauigkeit !== 'ort', label: o.adresse ? o.adresse : o.ort, farbe: '#1D5B84' }]} hoehe={300} zoom={o.geo_genauigkeit === 'ort' ? 14 : 17} onVerschoben={markerVerschoben} />
          ) : (
            <div className="empty" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>{geoStatus !== null ? geoStatus : 'Keine Position'}</div>
          )}
        </div>
        <div className="karte-legende" style={{ justifyContent: 'space-between' }}>
          <span>{genauText}{o.lat !== null ? ' · Marker verschieben, um die Position zu korrigieren' : ''}{geoStatus !== null && o.lat !== null ? ' · ' + geoStatus : ''}</span>
          <span style={{ gap: 14 }}>
            {geoAdminLink !== null ? <a href={geoAdminLink} target="_blank" rel="noopener noreferrer">map.geo.admin.ch ↗</a> : null}
            <label style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 600 }}>{bildLaedt ? 'Lädt …' : (o.bild_pfad || o.bild_url ? 'Bild ersetzen' : 'Bild hochladen')}<input type="file" accept="image/*" onChange={bildHochladen} style={{ display: 'none' }} disabled={bildLaedt} /></label>
          </span>
        </div>
        <Galerie objektId={o.id} version={galerieVersion} />
      </section>

      {(() => {
        const zEff = budgetDaten !== null && budgetDaten.zins_effektiv !== undefined ? Number(budgetDaten.zins_effektiv) : Number(haushalt.zins_effektiv);
        const t = tragbarkeit(o.preis_chf, haushalt, zEff);
        const b = budget(o.preis_chf, haushalt, profiles, budgetPosten, budgetDaten);
        const amp = ue !== null ? ampel(ue, haushalt, profiles, budgetPosten, budgetDaten) : null;
        const pz = ue !== null ? ue.pendelzeiten : {};
        const kpi = (k: string, v: ReactNode, sub?: ReactNode, farbe?: string) => (
          <div key={k} className="kpi ek">
            <span className="xs muted">{k}</span>
            <span className="tnum ek-wert" style={farbe ? { color: farbe } : undefined}>{v}</span>
            {sub !== undefined ? <span className="xs muted ek-sub">{sub}</span> : null}
          </div>
        );
        return (
          <section className="ek-strip" aria-label="Entscheid auf einen Blick">
            {amp !== null ? (
              <AmpelInfo ampel={amp} className="kpi ek ek-ampel" style={{ borderColor: AMPEL_FARBE[amp.stufe], cursor: 'help' }}>
                <span className="xs muted">Einschätzung</span>
                <span className="ek-wert" style={{ color: AMPEL_FARBE[amp.stufe] }}><span className="ampel-dot" style={{ background: AMPEL_FARBE[amp.stufe] }} />{AMPEL_LABEL[amp.stufe]}</span>
                <span className="xs muted ek-sub">{amp.stufe === 'gruen' || amp.stufe === 'grau' ? amp.gruende[0] : amp.pruefungen.filter((x) => x.stufe === 'rot' || x.stufe === 'gelb').map((x) => x.name).join(' · ')} · Details beim Überfahren</span>
              </AmpelInfo>
            ) : null}
            {kpi('Preis', chf(o.preis_chf, true), o.preis_chf !== null && o.flaeche_m2 ? 'CHF ' + chf(o.preis_chf / o.flaeche_m2) + '/m²' + (lastPriceChange ? ' · geändert ' + dateShort(lastPriceChange.datum) : '') : (lastPriceChange ? 'geändert ' + dateShort(lastPriceChange.datum) : 'unverändert'))}
            {kpi('Objekt', (o.zimmer !== null ? o.zimmer + ' Zi' : '–') + ' · ' + (o.flaeche_m2 !== null ? o.flaeche_m2 + ' m²' : '–'), typLabel(o.typ) + (o.baujahr !== null ? ' · Baujahr ' + o.baujahr : '') + (o.grundstueck_m2 !== null ? ' · ' + o.grundstueck_m2 + ' m² Land' : ''))}
            {kpi('Am Markt', (ue !== null ? ue.tage_am_markt : 0) + ' Tage', 'seit ' + dateShort(o.erstmals_gesehen) + ' · zuletzt ' + dateShort(o.zuletzt_gesehen), ue !== null && ue.tage_am_markt > 90 ? 'var(--warm-dark)' : undefined)}
            {kpi('Tragbarkeit Bank', t !== null && (t.bank.quote !== null || t.ekZuTief) ? (t.ekZuTief ? 'EK zu tief' : quoteText(t.bank)) : '–', 'kalk. ' + haushalt.zins_kalk + ' % · max. ' + haushalt.tragbarkeit_max + ' %', t !== null ? stufeFarbe(t.bank.stufe) : undefined)}
            {kpi('Belastung pro Monat', t !== null && haushalt.eigenkapital !== null ? 'CHF ' + chf(t.effektiv.kosten / 12) : '–', 'Zins ' + zEff + ' % effektiv · Hypothek ' + (t !== null ? chf(t.hypothek) : '–'))}
            {kpi('Budget', b.vollstaendig ? (b.ueberschuss < 0 ? '−' : '+') + 'CHF ' + chf(Math.abs(b.ueberschuss)) + '/Mt' : '–', b.vollstaendig && b.sparquote !== null ? (b.sparquote * 100).toFixed(0) + ' % Sparquote' : 'Nettolohn in Einstellungen', b.vollstaendig ? ueberschussFarbe(b) : undefined)}
            {kpi('Pendeln ÖV', profiles.map((p) => p.kuerzel + ' ' + (pz[p.id] ? pz[p.id].minuten + "'" : '–')).join(' · '), profiles.map((p) => (pz[p.id] && pz[p.id].nach ? p.kuerzel + ' → ' + pz[p.id].nach : null)).filter((x) => x !== null).join(' · ') || 'Arbeitsort in Einstellungen')}
            {kpi('Score', ue !== null && ue.score_gesamt !== null ? Number(ue.score_gesamt).toFixed(1) : '–', profiles.map((p) => p.kuerzel + ' ' + (ue !== null && ue.kriterien_scores[p.id] !== undefined ? Number(ue.kriterien_scores[p.id]).toFixed(1) : '–')).join(' · '))}
            {kpi('Steuerfuss', gemeinde !== null && gemeinde.steuerfuss !== null ? gemeinde.steuerfuss + ' %' : '–', gemeinde !== null ? gemeinde.name + ' ' + gemeinde.kanton + (gemeinde.steuerfuss_jahr ? ' · ' + gemeinde.steuerfuss_jahr : '') : o.ort)}
          </section>
        );
      })()}

      <div className="entscheid-grid">
        <section className="card pad" aria-labelledby="fin-h">
          <FinanzierungKarte preis={o.preis_chf} daten={budgetDaten} speichern={budgetSpeichern} gemeinde={gemeinde} ort={o.ort} />
        </section>
        <section className="card pad" aria-labelledby="budget-h">
          <div className="card-head"><h2 id="budget-h">Budget pro Monat</h2><span className="xs muted">Einkommen nach Pensum, Wohnkosten, Ausgaben</span></div>
          <BudgetKarte preis={o.preis_chf} daten={budgetDaten} speichern={budgetSpeichern} gemeinde={gemeinde} />
        </section>
        <section className="card pad" aria-labelledby="krit-h">
          <div className="card-head"><h2 id="krit-h">Kriterien &amp; Bewertung</h2><span className="xs muted">1 schlecht · 5 sehr gut · pro Person</span></div>
          <KriterienGrid objektId={o.id} onChange={() => load()} />
        </section>
      </div>

      <div className="two-col">
        <div className="main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          <section className="card pad" aria-labelledby="price-h">
            <div className="card-head"><h2 id="price-h">Preis- und Inseratsverlauf</h2><span className="small muted">Jede Änderung, die der tägliche Lauf erkennt</span></div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 16 }}>
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <div className="bars">
                  {series.map((p, i) => (
                    <div key={i} className={'bar' + (i === series.length - 1 ? ' cur' : '')}>
                      <span className="xs tnum" style={{ color: 'var(--ink-2)', textAlign: 'center', lineHeight: 1.2 }}>{(p.v / 1000000).toFixed(2)} M{o.flaeche_m2 ? <><br /><span className="muted">{chf(p.v / o.flaeche_m2)}/m²</span></> : null}</span>
                      <i style={{ height: maxV ? Math.max(8, Math.round((p.v / maxV) * 80)) + '%' : '8%' }} />
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 10, padding: '4px 4px 0' }}>
                  {series.map((p, i) => <span key={i} className="xs muted" style={{ flex: '1 1 0', textAlign: 'center' }}>{dateShort(p.date)}</span>)}
                </div>
              </div>
              <div className="rows" style={{ flex: '1 1 260px', minWidth: 0 }}>
                {snaps.slice(0, 8).map((s) => {
                  const labels: Record<string, string> = { erfasst: 'Erfasst', preis: 'Preis', status: 'Status', flaeche: 'Fläche', zimmer: 'Zimmer', bestaetigt: 'Bestätigt', neue_quelle: 'Neue Quelle', dublette: 'Dublette', sonstiges: 'Update' };
                  let val = s.kommentar || '';
                  if (s.typ === 'status') { val = marktText(s.alt || '', null, true) + ' → ' + marktText(s.neu || '', null, true) + (s.neu === 'offline' ? ' · beim Makler nicht mehr gefunden' : s.neu === 'reserviert' ? ' · beim Makler als reserviert markiert' : ''); }
                  else if (s.typ === 'preis') { val = 'CHF ' + chf(Number(s.alt)) + ' → ' + chf(Number(s.neu)) + ' (' + pct(Number(s.neu) - Number(s.alt), Number(s.alt)) + ')'; }
                  else if (s.typ === 'erfasst') { val = (s.kommentar || '') + (s.neu ? ' · CHF ' + chf(Number(s.neu)) : ''); }
                  else if (s.alt || s.neu) { val = (s.alt || '') + ' → ' + (s.neu || '') + (s.kommentar ? ' · ' + s.kommentar : ''); }
                  return (
                    <div key={s.id} className="small" style={{ display: 'flex', gap: 12, padding: '9px 0' }}>
                      <span className="muted tnum" style={{ flex: '0 0 64px' }}>{dateShort(s.datum)}</span>
                      <span style={{ flex: '0 0 100px', fontWeight: 600 }}>{labels[s.typ]}</span>
                      <span style={{ color: 'var(--ink-2)', minWidth: 0 }}>{val}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="card pad" aria-labelledby="tl-h">
            <div className="card-head"><h2 id="tl-h">Verlauf &amp; Aktivitäten</h2><span className="small muted">Automatisch und manuell, chronologisch</span></div>
            <form onSubmit={saveAkt} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 14 }}>
              <label htmlFor="note" className="sr-only">Neue Aktivität</label>
              <textarea id="note" className="textarea" rows={2} placeholder="Notiz, Anruf, Mail … (sichtbar für beide)" value={aText} onChange={(e) => setAText(e.target.value)} style={{ flex: '1 1 320px' }} />
              <select className="select" aria-label="Aktivitätstyp" value={aTyp} onChange={(e) => setATyp(e.target.value as AktivitaetTyp)} style={{ width: 'auto', minHeight: 44 }}>
                <option value="notiz">Notiz</option><option value="mail">Mail an Makler</option><option value="telefon">Telefonat</option><option value="besichtigung">Besichtigung</option><option value="termin">Termin</option>
              </select>
              <input className="input" type="datetime-local" aria-label="Fällig am (optional)" value={aFaellig} onChange={(e) => setAFaellig(e.target.value)} style={{ width: 'auto', minHeight: 44 }} />
              <button type="submit" className="btn primary" disabled={!aText.trim()}>Speichern</button>
            </form>
            <div className="rows" style={{ marginTop: 10 }}>
              {akt.length === 0 ? <div className="empty">Noch keine Aktivitäten.</div> : null}
              {akt.map((a) => (
                <div key={a.id} className="tl-item">
                  <Avatar id={a.user_id} size="sm" />
                  <div className="tl-body">
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 600 }}>{a.titel}</span>
                      <span className="xs muted tnum">{dateTime(a.datum)}</span>
                      {a.faellig_am !== null ? (
                        <button type="button" className={'chip ' + (a.erledigt ? 'neutral' : 'accent')} style={{ border: 'none', cursor: 'pointer' }} onClick={() => toggleDone(a)} title="Erledigt umschalten">
                          {a.erledigt ? '✓ erledigt' : 'fällig ' + dateTime(a.faellig_am)}
                        </button>
                      ) : null}
                    </div>
                    {a.text ? <span className="small" style={{ color: 'var(--ink-2)', whiteSpace: 'pre-line' }}>{a.text.split(/(@[A-Za-zÄÖÜäöü]+)/g).map((t, i) => (/^@/.test(t) ? <mark key={i} className="erwaehnung">{t}</mark> : t))}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="side">
          <section className="card pad" aria-labelledby="src-h">
            <h2 id="src-h">Quellen &amp; Makler</h2>
            <div className="rows" style={{ marginTop: 8 }}>
              {quellen.length === 0 ? <div className="small muted" style={{ padding: '10px 0' }}>Keine Makler-Quelle hinterlegt.</div> : null}
              {quellen.map((q) => (
                <div key={q.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    {q.url && quelleDirekt(q) ? <a href={q.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>{q.makler} ↗</a> : <span style={{ fontWeight: 600 }}>{q.makler} <span className="chip link-fehlt" style={{ marginLeft: 6 }}>kein Direktlink</span></span>}
                    <span className="xs muted" title={q.externe_id || ''} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, maxWidth: 140 }}>{q.externe_id || ''}</span>
                  </div>
                  {q.kontakt ? <span className="small" style={{ color: 'var(--ink-2)' }}>{q.kontakt}</span> : null}
                  <span className="xs muted"><span style={q.status !== 'aktiv' ? { color: 'var(--warm-dark)', fontWeight: 600 } : undefined}>{marktText(q.status, q.offline_seit)}</span> · erfasst {dateShort(q.erstmals_gesehen)} · zuletzt {dateShort(q.zuletzt_gesehen)}{q.preis_chf !== null ? ' · CHF ' + chf(q.preis_chf) : ''}</span>
                </div>
              ))}
            </div>
            {quellen.length > 1 ? <span className="xs muted">{quellen.length} Inserate wurden als dasselbe Objekt erkannt.</span> : null}
          </section>

          <section className="card pad" aria-labelledby="doc-h">
            <div className="card-head">
              <h2 id="doc-h">Dokumente</h2>
              <label className="btn sm" style={{ cursor: 'pointer' }}>{uploading ? 'Lädt …' : '+ Hochladen'}<input type="file" multiple accept=".pdf,image/*" onChange={upload} style={{ display: 'none' }} disabled={uploading} /></label>
            </div>
            <div className="rows" style={{ marginTop: 8 }}>
              {docs.map((d) => (
                <button key={d.id} type="button" onClick={() => openDoc(d)} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', background: 'none', border: 'none', borderTop: '1px solid var(--line-soft)', width: '100%', textAlign: 'left' }}>
                  <span className="mono xs" style={{ flex: '0 0 36px', height: 36, borderRadius: 8, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-2)' }}>{(d.name.split('.').pop() || 'DOC').toUpperCase().slice(0, 4)}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: '1 1 auto' }}>
                    <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                    <span className="xs muted">{dateShort(d.created_at)} · {bytes(d.groesse_bytes)}{extrakte.some((x) => x.dokument_id === d.id) ? ' · ausgewertet' : ''}</span>
                  </span>
                  {d.mime === 'application/pdf' || /\.pdf$/i.test(d.name) ? (
                    <span className="chip accent" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); if (extrahiere === null) { extrahieren(d); } }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); extrahieren(d); } }}>
                      {extrahiere === d.id ? 'Liest …' : extrakte.some((x) => x.dokument_id === d.id) ? 'Neu auswerten' : 'Kennzahlen'}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            {hinweis !== null ? <div className="notice" style={{ marginTop: 10 }}>{hinweis}</div> : null}
            {extrakte.length > 0 ? (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {extrakte.map((x) => {
                  const d = x.daten;
                  const zeile = (k: string, label: string, fmt?: (v: unknown) => string) => {
                    const v = d[k];
                    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) { return null; }
                    return <><span className="muted">{label}</span><span style={{ textAlign: 'right' }}>{fmt ? fmt(v) : Array.isArray(v) ? v.join(', ') : String(v)}</span></>;
                  };
                  return (
                    <div key={x.dokument_id} style={{ background: 'var(--bg)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span className="small" style={{ fontWeight: 600 }}>Exposé-Daten <span className="xs muted" style={{ fontWeight: 400 }}>{dateShort(x.erstellt_am)}{x.modell ? ' · ' + x.modell : ''}</span></span>
                      {x.zusammenfassung ? <span className="small" style={{ color: 'var(--ink-2)' }}>{x.zusammenfassung}</span> : null}
                      <div className="xs tnum" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 12px' }}>
                        {zeile('baujahr', 'Baujahr')}{zeile('renovationen', 'Renovationen')}{zeile('heizung', 'Heizung')}{zeile('energie', 'Energie')}
                        {zeile('nebenkosten_chf_jahr', 'Nebenkosten/Jahr', (v) => 'CHF ' + chf(Number(v)))}{zeile('erneuerungsfonds_chf', 'Erneuerungsfonds', (v) => 'CHF ' + chf(Number(v)))}
                        {zeile('stwe_anteil', 'STWE-Anteil')}{zeile('parkplaetze', 'Parkplätze')}{zeile('verfuegbarkeit', 'Verfügbar')}{zeile('grundstueck_m2', 'Grundstück', (v) => String(v) + ' m²')}
                        {zeile('besonderheiten', 'Besonderheiten')}{zeile('risiken', 'Risiken')}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="stage-empty" style={{ marginTop: 10 }}>Exposé-PDF hochladen und «Kennzahlen» antippen: Claude liest Baujahr, Nebenkosten, Erneuerungsfonds und mehr aus</div>
          </section>

          <section className="card pad" aria-labelledby="loc-h">
            <h2 id="loc-h">Standortfaktoren</h2>
            <div className="rows" style={{ marginTop: 8 }}>
              {loc.length === 0 ? <div className="small muted" style={{ padding: '10px 0' }}>Noch nicht recherchiert. Claude im Chat darum bitten, dann erscheinen die Faktoren hier.</div> : null}
              {loc.map((l) => (
                <div key={l.id} className="small" style={{ display: 'flex', gap: 10, padding: '8px 0' }}>
                  <span className="dot" style={{ flex: '0 0 8px', marginTop: 6, background: l.bewertung === 'positiv' ? 'var(--green)' : l.bewertung === 'negativ' ? 'var(--warm)' : 'var(--amber)' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontWeight: 600 }}>{l.titel}</span>
                    <span style={{ color: 'var(--ink-2)' }}>{l.text}{l.quelle_url ? <> · <a href={l.quelle_url} target="_blank" rel="noopener noreferrer">Quelle</a></> : null}</span>
                  </div>
                </div>
              ))}
            </div>
            {loc.length > 0 ? <span className="xs muted">Stand {dateLong(loc[0].stand)}</span> : null}
          </section>
        </aside>
      </div>
      {zfOffen ? <ZusammenfuehrenModal objekt={o} onClose={() => setZfOffen(false)} onDone={zusammengefuehrt} /> : null}
    </>
  );
}

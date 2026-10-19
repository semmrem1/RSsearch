import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useApp } from '../state/AppContext';
import { Avatar } from '../components/Layout';
import { StarsInput, StarsText } from '../components/Stars';
import { chf, pct, dateShort, dateLong, dateTime, bytes, typLabel, statusLabel } from '../lib/format';
import type { Objekt, Quelle, Snapshot, Aktivitaet, Bewertung, Dokument, Standortfaktor, AktivitaetTyp } from '../lib/types';

export default function Detail() {
  const { id } = useParams();
  const { me, profiles, stufen, stufeByCode } = useApp();
  const [o, setO] = useState<Objekt | null>(null);
  const [quellen, setQuellen] = useState<Quelle[]>([]);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [akt, setAkt] = useState<Aktivitaet[]>([]);
  const [bew, setBew] = useState<Bewertung[]>([]);
  const [docs, setDocs] = useState<Dokument[]>([]);
  const [loc, setLoc] = useState<Standortfaktor[]>([]);
  const [missing, setMissing] = useState(false);

  // Aktivität erfassen
  const [aTyp, setATyp] = useState<AktivitaetTyp>('notiz');
  const [aText, setAText] = useState('');
  const [aFaellig, setAFaellig] = useState('');
  // eigene Bewertung
  const [editRating, setEditRating] = useState(false);
  const [rSterne, setRSterne] = useState(0);
  const [rFav, setRFav] = useState(false);
  const [rUnint, setRUnint] = useState(false);
  const [rKomm, setRKomm] = useState('');
  const [rTags, setRTags] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!id) { return; }
    const [a, b, c, d, e, f, g] = await Promise.all([
      supabase.from('objekte').select('*').eq('id', id).maybeSingle(),
      supabase.from('objekt_quellen').select('*').eq('objekt_id', id).order('erstmals_gesehen'),
      supabase.from('snapshots').select('*').eq('objekt_id', id).order('datum', { ascending: false }),
      supabase.from('aktivitaeten').select('*').eq('objekt_id', id).order('datum', { ascending: false }),
      supabase.from('bewertungen').select('*').eq('objekt_id', id),
      supabase.from('dokumente').select('*').eq('objekt_id', id).order('created_at', { ascending: false }),
      supabase.from('standortfaktoren').select('*').eq('objekt_id', id).order('id'),
    ]);
    if (a.data === null) { setMissing(true); return; }
    setO(a.data as Objekt);
    setQuellen((b.data || []) as Quelle[]);
    setSnaps((c.data || []) as Snapshot[]);
    setAkt((d.data || []) as Aktivitaet[]);
    setBew((e.data || []) as Bewertung[]);
    setDocs((f.data || []) as Dokument[]);
    setLoc((g.data || []) as Standortfaktor[]);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (me === null) { return; }
    const mine = bew.find((x) => x.user_id === me.id);
    if (mine) { setRSterne(mine.sterne); setRFav(mine.favorit); setRUnint(mine.uninteressant); setRKomm(mine.kommentar || ''); setRTags(mine.tags.join(', ')); }
  }, [bew, me]);

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
    await supabase.from('aktivitaeten').insert({ objekt_id: o!.id, user_id: me.id, typ: aTyp, titel: labels[aTyp], text: aText.trim(), faellig_am: aFaellig ? new Date(aFaellig).toISOString() : null });
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

  async function saveRating() {
    if (me === null) { return; }
    const tags = rTags.split(',').map((t) => t.trim()).filter((t) => t !== '');
    await supabase.from('bewertungen').upsert({ objekt_id: o!.id, user_id: me.id, sterne: rSterne, favorit: rFav, uninteressant: rUnint, kommentar: rKomm || null, tags });
    setEditRating(false);
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

  async function openDoc(d: Dokument) {
    const { data } = await supabase.storage.from('dokumente').createSignedUrl(d.storage_path, 600);
    if (data) { window.open(data.signedUrl, '_blank', 'noopener'); }
  }

  const facts = [
    { k: 'Preis', v: chf(o.preis_chf, true), sub: lastPriceChange ? 'geändert ' + dateShort(lastPriceChange.datum) : 'unverändert seit Erfassung' },
    { k: 'Preis pro m²', v: o.preis_chf !== null && o.flaeche_m2 ? 'CHF ' + chf(o.preis_chf / o.flaeche_m2) : '–', sub: '' },
    { k: 'Zimmer', v: o.zimmer !== null ? String(o.zimmer) : '–', sub: typLabel(o.typ) },
    { k: 'Wohnfläche', v: o.flaeche_m2 !== null ? o.flaeche_m2 + ' m²' : '–', sub: o.grundstueck_m2 !== null ? 'Grundstück ' + o.grundstueck_m2 + ' m²' : '' },
    { k: 'Baujahr', v: o.baujahr !== null ? String(o.baujahr) : '–', sub: '' },
    { k: 'Gesehen', v: dateShort(o.erstmals_gesehen), sub: 'zuletzt ' + dateShort(o.zuletzt_gesehen) },
  ];

  return (
    <>
      <Link to="/" className="small" style={{ textDecoration: 'none' }}>← Zurück zur Übersicht</Link>

      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span className="chip accent">{stufe !== null ? stufe.name : o.stufe_code}</span>
            <span className={'chip ' + (o.markt_status === 'aktiv' ? 'green' : 'warm')}>{statusLabel(o.markt_status)}</span>
            <span className="xs muted">Erstmals gesehen {dateLong(o.erstmals_gesehen)} · zuletzt bestätigt {dateLong(o.zuletzt_gesehen)}</span>
          </div>
          <h1>{o.ort} · {o.zimmer !== null ? o.zimmer + '-Zimmer-' : ''}{typLabel(o.typ)}{o.titel ? ' «' + o.titel + '»' : ''}</h1>
          <p className="sub">{o.adresse ? o.adresse : 'Adresse noch nicht publiziert'}{o.plz ? ' · ' + o.plz : ''}{o.kanton ? ' ' + o.kanton : ''}{o.lage_hinweis ? ' · ' + o.lage_hinweis : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label htmlFor="stufe-sel" className="sr-only">Stufe wechseln</label>
          <select id="stufe-sel" className="select" style={{ width: 'auto', minHeight: 44 }} value={o.stufe_code} onChange={(e) => changeStufe(e.target.value)}>
            {stufen.map((s) => <option key={s.code} value={s.code}>{s.phase_name} · {s.name}</option>)}
          </select>
        </div>
      </div>

      <section className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }} aria-label="Eckdaten">
        {facts.map((f) => (
          <div key={f.k} className="kpi" style={{ padding: '14px 16px', gap: 4 }}>
            <span className="xs muted">{f.k}</span>
            <span className="tnum" style={{ fontSize: 20, fontWeight: 700 }}>{f.v}</span>
            <span className="xs muted">{f.sub}</span>
          </div>
        ))}
      </section>

      <div className="two-col">
        <div className="main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          <section className="card pad" aria-labelledby="price-h">
            <div className="card-head"><h2 id="price-h">Preis- und Inseratsverlauf</h2><span className="small muted">Jede Änderung, die der tägliche Lauf erkennt</span></div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 16 }}>
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <div className="bars">
                  {series.map((p, i) => (
                    <div key={i} className={'bar' + (i === series.length - 1 ? ' cur' : '')}>
                      <span className="xs tnum" style={{ color: 'var(--ink-2)' }}>{(p.v / 1000000).toFixed(2)} M</span>
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
                  if (s.typ === 'preis') { val = 'CHF ' + chf(Number(s.alt)) + ' → ' + chf(Number(s.neu)) + ' (' + pct(Number(s.neu) - Number(s.alt), Number(s.alt)) + ')'; }
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
                    {a.text ? <span className="small" style={{ color: 'var(--ink-2)', whiteSpace: 'pre-line' }}>{a.text}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="side">
          <section className="card pad" aria-labelledby="rate-h">
            <h2 id="rate-h">Bewertung pro Person</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
              {profiles.map((p) => {
                const b = bew.find((x) => x.user_id === p.id);
                return (
                  <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 10, background: 'var(--bg)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, color: p.farbe }}>{p.name}</span>
                      <StarsText n={b ? b.sterne : 0} color={p.farbe} />
                    </div>
                    {b && b.kommentar ? <span className="small" style={{ color: 'var(--ink-2)' }}>{b.kommentar}</span> : <span className="small muted">Noch keine Bewertung</span>}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {b && b.favorit ? <span className="chip outline">Favorit</span> : null}
                      {b && b.uninteressant ? <span className="chip outline">Uninteressant</span> : null}
                      {b ? b.tags.map((t) => <span key={t} className="chip outline">{t}</span>) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {me !== null && !editRating ? <button type="button" className="btn" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }} onClick={() => setEditRating(true)}>Meine Bewertung bearbeiten</button> : null}
            {me !== null && editRating ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                <StarsInput value={rSterne} onChange={setRSterne} color={me.farbe} />
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={rFav} onChange={(e) => setRFav(e.target.checked)} /> Favorit</label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={rUnint} onChange={(e) => setRUnint(e.target.checked)} /> Uninteressant</label>
                <label htmlFor="r-komm" className="sr-only">Kommentar</label>
                <textarea id="r-komm" className="textarea" rows={3} placeholder="Kommentar" value={rKomm} onChange={(e) => setRKomm(e.target.value)} />
                <label htmlFor="r-tags" className="sr-only">Tags</label>
                <input id="r-tags" className="input" placeholder="Tags, mit Komma getrennt" value={rTags} onChange={(e) => setRTags(e.target.value)} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn" onClick={() => setEditRating(false)}>Abbrechen</button>
                  <button type="button" className="btn primary" onClick={saveRating}>Speichern</button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="card pad" aria-labelledby="src-h">
            <h2 id="src-h">Quellen &amp; Makler</h2>
            <div className="rows" style={{ marginTop: 8 }}>
              {quellen.length === 0 ? <div className="small muted" style={{ padding: '10px 0' }}>Keine Makler-Quelle hinterlegt.</div> : null}
              {quellen.map((q) => (
                <div key={q.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    {q.url ? <a href={q.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>{q.makler}</a> : <span style={{ fontWeight: 600 }}>{q.makler}</span>}
                    <span className="xs muted">{q.externe_id || ''}</span>
                  </div>
                  {q.kontakt ? <span className="small" style={{ color: 'var(--ink-2)' }}>{q.kontakt}</span> : null}
                  <span className="xs muted">{statusLabel(q.status)} · seit {dateShort(q.erstmals_gesehen)} · zuletzt {dateShort(q.zuletzt_gesehen)}{q.preis_chf !== null ? ' · CHF ' + chf(q.preis_chf) : ''}</span>
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
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                    <span className="xs muted">{dateShort(d.created_at)} · {bytes(d.groesse_bytes)}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="stage-empty" style={{ marginTop: 10 }}>Exposé-PDF hochladen und Claude zum Extrahieren der Kennzahlen geben</div>
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
    </>
  );
}

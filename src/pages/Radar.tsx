import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useApp } from '../state/AppContext';
import { chf, dateLong, dateShort } from '../lib/format';
import type { Baugesuch, BaugesuchStatus, NeubauEreignis, NeubauPhase, Neubauprojekt, RadarGemeinde } from '../lib/types';

type Tab = 'projekte' | 'baugesuche' | 'gemeinden';
type RelFilter = 'hoch' | 'mittel' | 'alle';
type StatusFilter = 'offen' | 'beobachten' | 'alle';

const BUDGET = 2500000;

interface ProjektInserat { id: string; zimmer: number | null; flaeche_m2: number | null; preis_chf: number | null; markt_status: string; neubauprojekt_id: string }

const PHASEN: { code: NeubauPhase; name: string; hinweis: string }[] = [
  { code: 'verkauf', name: 'Im Verkauf', hinweis: 'Preise publiziert, Reservation möglich' },
  { code: 'vormerkung', name: 'Vormerkung', hinweis: 'Interessentenliste offen, noch keine Preise' },
  { code: 'geplant', name: 'Geplant', hinweis: 'Baugesuch oder Gestaltungsplan, Vermarktung noch offen' },
  { code: 'ausverkauft', name: 'Ausverkauft', hinweis: '' },
  { code: 'miete', name: 'Nur Miete', hinweis: '' },
  { code: 'uninteressant', name: 'Uninteressant', hinweis: '' },
];
const AKTIVE_PHASEN: NeubauPhase[] = ['verkauf', 'vormerkung', 'geplant'];

function phaseChip(p: NeubauPhase): string {
  if (p === 'verkauf') { return 'chip green'; }
  if (p === 'vormerkung') { return 'chip accent'; }
  if (p === 'geplant') { return 'chip outline'; }
  return 'chip neutral';
}
function relChip(r: string): string { return r === 'hoch' ? 'chip warm' : r === 'mittel' ? 'chip accent' : 'chip neutral'; }
function spanne(a: number | null, b: number | null, fmt: (n: number) => string): string {
  if (a === null && b === null) { return ''; }
  if (a !== null && b !== null && a !== b) { return fmt(a) + ' – ' + fmt(b); }
  return fmt((a !== null ? a : b) as number);
}
function heuteIso(): string { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fristOffen(b: Baugesuch): boolean { return b.frist_bis !== null && b.frist_bis >= heuteIso(); }

// ---------- Projekt-Formular ----------
const LEER: Partial<Neubauprojekt> = { name: '', phase: 'vormerkung' };

function ProjektModal({ start, gemeinden, onClose, onSaved }: { start: Partial<Neubauprojekt>; gemeinden: RadarGemeinde[]; onClose: () => void; onSaved: (id: string) => void }) {
  const [p, setP] = useState<Partial<Neubauprojekt>>(start);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const set = (k: keyof Neubauprojekt, v: unknown) => setP((x) => ({ ...x, [k]: v }));
  const zahl = (v: string): number | null => { const t = v.replace(/[^0-9.,]/g, '').replace(',', '.'); return t === '' ? null : Number(t); };
  const txt = (k: keyof Neubauprojekt) => (p[k] === null || p[k] === undefined ? '' : String(p[k]));

  async function speichern() {
    if (!p.name || p.name.trim() === '') { setFehler('Name fehlt'); return; }
    setLaeuft(true); setFehler(null);
    const g = gemeinden.find((x) => x.name === p.gemeinde);
    const leer = (v: unknown) => (v === '' || v === undefined ? null : v);
    const felder = {
      name: p.name.trim(), gemeinde: leer(p.gemeinde), kanton: leer(p.kanton) || (g ? g.kanton : null), adresse: leer(p.adresse), typ: leer(p.typ),
      einheiten: leer(p.einheiten), zimmer_von: leer(p.zimmer_von), zimmer_bis: leer(p.zimmer_bis), flaeche_von: leer(p.flaeche_von), flaeche_bis: leer(p.flaeche_bis),
      preis_ab: leer(p.preis_ab), preis_bis: leer(p.preis_bis), bezug: leer(p.bezug), bauherr: leer(p.bauherr), vermarkter: leer(p.vermarkter), kontakt: leer(p.kontakt),
      website: leer(p.website), interessent_seit: leer(p.interessent_seit), notiz: leer(p.notiz),
    };
    let id = p.id || null;
    if (id === null) {
      // Neu: über die RPC (legt Ereignis «erfasst» an, findet Dubletten über Website oder Name + Gemeinde)
      const { data, error } = await supabase.rpc('neubauprojekt_melden', { p: { ...felder, phase: p.phase || 'vormerkung' } });
      if (error) { setFehler(error.message); setLaeuft(false); return; }
      id = data as string;
      await supabase.from('neubauprojekte').update({ interessent_seit: felder.interessent_seit, notiz: felder.notiz }).eq('id', id);
    } else {
      // Bearbeiten: direkt, damit Felder auch geleert werden können; Phase über die RPC (Verlauf)
      const { error } = await supabase.from('neubauprojekte').update({ ...felder, aktualisiert_am: new Date().toISOString() }).eq('id', id);
      if (error) { setFehler(error.message); setLaeuft(false); return; }
      if (p.phase && p.phase !== start.phase) { await supabase.rpc('neubauprojekt_melden', { p: { id, phase: p.phase } }); }
    }
    setLaeuft(false);
    onSaved(id);
  }

  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="np-h" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <h2 id="np-h">{p.id ? 'Projekt bearbeiten' : 'Neubauprojekt erfassen'}</h2>
        <div className="form-grid">
          <div className="field"><label htmlFor="np-name">Name</label><input id="np-name" className="input" value={txt('name')} onChange={(e) => set('name', e.target.value)} placeholder="z.B. Sonnhalden" /></div>
          <div className="field"><label htmlFor="np-gem">Gemeinde</label>
            <select id="np-gem" className="select" value={txt('gemeinde')} onChange={(e) => set('gemeinde', e.target.value || null)}>
              <option value="">–</option>
              {gemeinden.map((g) => <option key={g.name} value={g.name}>{g.name} ({g.kanton})</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="np-adr">Adresse</label><input id="np-adr" className="input" value={txt('adresse')} onChange={(e) => set('adresse', e.target.value)} /></div>
          <div className="field"><label htmlFor="np-phase">Phase</label>
            <select id="np-phase" className="select" value={txt('phase')} onChange={(e) => set('phase', e.target.value)}>
              {PHASEN.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="np-typ">Typ</label><input id="np-typ" className="input" value={txt('typ')} onChange={(e) => set('typ', e.target.value)} placeholder="Wohnungen, Reihenhäuser …" /></div>
          <div className="field"><label htmlFor="np-einh">Einheiten</label><input id="np-einh" className="input" inputMode="numeric" value={txt('einheiten')} onChange={(e) => set('einheiten', zahl(e.target.value))} /></div>
          <div className="field"><label htmlFor="np-zv">Zimmer von</label><input id="np-zv" className="input" inputMode="decimal" value={txt('zimmer_von')} onChange={(e) => set('zimmer_von', zahl(e.target.value))} /></div>
          <div className="field"><label htmlFor="np-zb">Zimmer bis</label><input id="np-zb" className="input" inputMode="decimal" value={txt('zimmer_bis')} onChange={(e) => set('zimmer_bis', zahl(e.target.value))} /></div>
          <div className="field"><label htmlFor="np-fv">Fläche von (m²)</label><input id="np-fv" className="input" inputMode="numeric" value={txt('flaeche_von')} onChange={(e) => set('flaeche_von', zahl(e.target.value))} /></div>
          <div className="field"><label htmlFor="np-fb">Fläche bis (m²)</label><input id="np-fb" className="input" inputMode="numeric" value={txt('flaeche_bis')} onChange={(e) => set('flaeche_bis', zahl(e.target.value))} /></div>
          <div className="field"><label htmlFor="np-pa">Preis ab (CHF)</label><input id="np-pa" className="input" inputMode="numeric" value={txt('preis_ab')} onChange={(e) => set('preis_ab', zahl(e.target.value))} /></div>
          <div className="field"><label htmlFor="np-pb">Preis bis (CHF)</label><input id="np-pb" className="input" inputMode="numeric" value={txt('preis_bis')} onChange={(e) => set('preis_bis', zahl(e.target.value))} /></div>
          <div className="field"><label htmlFor="np-bez">Bezug</label><input id="np-bez" className="input" value={txt('bezug')} onChange={(e) => set('bezug', e.target.value)} placeholder="z.B. Sommer 2028" /></div>
          <div className="field"><label htmlFor="np-bh">Bauherr</label><input id="np-bh" className="input" value={txt('bauherr')} onChange={(e) => set('bauherr', e.target.value)} /></div>
          <div className="field"><label htmlFor="np-vm">Vermarkter</label><input id="np-vm" className="input" value={txt('vermarkter')} onChange={(e) => set('vermarkter', e.target.value)} /></div>
          <div className="field"><label htmlFor="np-kt">Kontakt</label><input id="np-kt" className="input" value={txt('kontakt')} onChange={(e) => set('kontakt', e.target.value)} placeholder="Name, Telefon, E-Mail" /></div>
          <div className="field"><label htmlFor="np-web">Projekt-Website</label><input id="np-web" className="input" type="url" value={txt('website')} onChange={(e) => set('website', e.target.value)} placeholder="https://…" /></div>
          <div className="field"><label htmlFor="np-int">Auf Interessentenliste seit</label><input id="np-int" className="input" type="date" value={txt('interessent_seit')} onChange={(e) => set('interessent_seit', e.target.value || null)} /></div>
        </div>
        <div className="field"><label htmlFor="np-notiz">Notiz</label><textarea id="np-notiz" className="textarea" rows={3} value={txt('notiz')} onChange={(e) => set('notiz', e.target.value)} /></div>
        {fehler !== null ? <div className="notice">{fehler}</div> : null}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" disabled={laeuft} onClick={speichern}>{laeuft ? 'Speichert …' : 'Speichern'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Projektkarte ----------
function ProjektKarte({ p, gesuche, ereignisse, inserate, leser, onEdit, onPhase, onInteressent }: {
  p: Neubauprojekt; gesuche: Baugesuch[]; ereignisse: NeubauEreignis[]; inserate: ProjektInserat[]; leser: boolean;
  onEdit: () => void; onPhase: (ph: NeubauPhase) => void; onInteressent: () => void;
}) {
  const [offen, setOffen] = useState(false);
  const zimmer = spanne(p.zimmer_von, p.zimmer_bis, (n) => String(n));
  const flaeche = spanne(p.flaeche_von, p.flaeche_bis, (n) => String(n));
  const preis = p.preis_ab !== null ? (p.preis_bis !== null && p.preis_bis !== p.preis_ab ? chf(p.preis_ab, true) + ' – ' + chf(p.preis_bis) : 'ab ' + chf(p.preis_ab, true)) : null;
  const imBudget = p.preis_ab !== null && p.preis_ab <= BUDGET;
  return (
    <article className="card radar-projekt">
      <div className="radar-projekt-kopf">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <span className={phaseChip(p.phase)}>{(PHASEN.find((x) => x.code === p.phase) || PHASEN[0]).name}</span>
            {p.interessent_seit ? <span className="chip green" title="Wir stehen auf der Interessentenliste">Vorgemerkt seit {dateShort(p.interessent_seit)}</span> : null}
            {p.preis_ab !== null ? <span className={imBudget ? 'chip green' : 'chip warm'}>{imBudget ? 'im Budget' : 'über Budget'}</span> : null}
          </div>
          <h3 className="radar-projekt-name">{p.name}</h3>
          <div className="muted small">{[p.gemeinde, p.adresse].filter(Boolean).join(' · ')}</div>
        </div>
        {p.website ? <a className="btn sm" href={p.website} target="_blank" rel="noreferrer">Website</a> : null}
      </div>
      <dl className="radar-fakten">
        {p.typ ? <div><dt>Typ</dt><dd>{p.typ}{p.einheiten !== null ? ', ' + p.einheiten + ' Einheiten' : ''}</dd></div> : null}
        {zimmer !== '' ? <div><dt>Zimmer</dt><dd className="tnum">{zimmer}</dd></div> : null}
        {flaeche !== '' ? <div><dt>Fläche</dt><dd className="tnum">{flaeche} m²</dd></div> : null}
        {preis !== null ? <div><dt>Preis</dt><dd className="tnum">{preis}</dd></div> : null}
        {p.bezug ? <div><dt>Bezug</dt><dd>{p.bezug}</dd></div> : null}
        {p.vermarkter ? <div><dt>Vermarkter</dt><dd>{p.vermarkter}</dd></div> : null}
        {p.kontakt ? <div><dt>Kontakt</dt><dd>{p.kontakt}</dd></div> : null}
        {p.bauherr ? <div><dt>Bauherr</dt><dd>{p.bauherr}</dd></div> : null}
      </dl>
      {p.notiz ? <p className="small" style={{ color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{p.notiz}</p> : null}
      {inserate.length > 0 ? (
        <div className="radar-inserate">
          <span className="xs muted">Passende Einheiten in der App</span>
          {inserate.map((o) => (
            <Link key={o.id} to={'/inserate/' + o.id} className="chip accent" style={{ textDecoration: 'none' }}>
              {[o.zimmer !== null ? o.zimmer + ' Zi' : null, o.flaeche_m2 !== null ? o.flaeche_m2 + ' m²' : null, o.preis_chf !== null ? chf(o.preis_chf, true) : null].filter(Boolean).join(' · ')}{o.markt_status !== 'aktiv' ? ' (' + o.markt_status + ')' : ''}
            </Link>
          ))}
        </div>
      ) : null}
      <div className="radar-projekt-fuss">
        <button type="button" className="linkbtn small" onClick={() => setOffen(!offen)} aria-expanded={offen}>
          {offen ? 'Verlauf ausblenden' : 'Verlauf' + (gesuche.length > 0 ? ' · ' + gesuche.length + ' Baugesuch' + (gesuche.length > 1 ? 'e' : '') : '')}
        </button>
        <span className="muted xs">Erfasst {dateLong(p.erfasst_am)}{p.zuletzt_geprueft ? ' · geprüft ' + dateShort(p.zuletzt_geprueft) : ''}</span>
        {!leser ? (
          <div className="radar-aktionen">
            {!p.interessent_seit && p.phase !== 'ausverkauft' && p.phase !== 'uninteressant' ? <button type="button" className="btn sm" onClick={onInteressent}>Vorgemerkt</button> : null}
            <select className="select radar-phase" aria-label="Phase ändern" value={p.phase} onChange={(e) => onPhase(e.target.value as NeubauPhase)}>
              {PHASEN.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
            </select>
            <button type="button" className="btn sm" onClick={onEdit}>Bearbeiten</button>
          </div>
        ) : null}
      </div>
      {offen ? (
        <div className="radar-verlauf">
          {gesuche.map((g) => (
            <div key={g.id} className="small"><span className="muted tnum">{dateShort(g.publiziert_am)}</span> Baugesuch {g.adresse}: {g.beschreibung} {g.url ? <a href={g.url} target="_blank" rel="noreferrer">Amtsblatt</a> : null}</div>
          ))}
          {ereignisse.map((e) => (
            <div key={e.id} className="small"><span className="muted tnum">{dateShort(e.datum)}</span> {e.typ === 'erfasst' ? 'Erfasst' : e.typ === 'phase' ? 'Phase: ' + (e.alt || '') + ' → ' + (e.neu || '') : e.typ === 'preis' ? 'Preis ab: ' + chf(Number(e.alt)) + ' → ' + chf(Number(e.neu)) : e.typ === 'baugesuch' ? 'Baugesuch verknüpft' : (e.neu || e.typ)}</div>
          ))}
          {gesuche.length === 0 && ereignisse.length === 0 ? <div className="muted small">Noch kein Verlauf.</div> : null}
        </div>
      ) : null}
    </article>
  );
}

// ---------- Seite ----------
export default function Radar() {
  const { leser } = useApp();
  const [tab, setTab] = useState<Tab>(() => { try { const t = localStorage.getItem('radar-tab'); return t === 'baugesuche' || t === 'gemeinden' ? t : 'projekte'; } catch { return 'projekte'; } });
  const [projekte, setProjekte] = useState<Neubauprojekt[]>([]);
  const [gesuche, setGesuche] = useState<Baugesuch[]>([]);
  const [ereignisse, setEreignisse] = useState<NeubauEreignis[]>([]);
  const [gemeinden, setGemeinden] = useState<RadarGemeinde[]>([]);
  const [inserate, setInserate] = useState<ProjektInserat[]>([]);
  const [laden, setLaden] = useState(true);
  const [rel, setRel] = useState<RelFilter>('hoch');
  const [stat, setStat] = useState<StatusFilter>('offen');
  const [kanton, setKanton] = useState<string>('');
  const [gemeinde, setGemeinde] = useState<string>('');
  const [suche, setSuche] = useState('');
  const [anzahl, setAnzahl] = useState(60);
  const [modal, setModal] = useState<{ start: Partial<Neubauprojekt>; gesuchId: string | null } | null>(null);
  const [zeigeAlte, setZeigeAlte] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [neueGemeinde, setNeueGemeinde] = useState({ name: '', kanton: 'ZH', bfs: '' });

  useEffect(() => { try { localStorage.setItem('radar-tab', tab); } catch { /* egal */ } }, [tab]);

  async function laden_() {
    const [p, g, e, gm, o] = await Promise.all([
      supabase.from('neubauprojekte').select('*').order('aktualisiert_am', { ascending: false }),
      supabase.from('baugesuche').select('*').order('publiziert_am', { ascending: false }).limit(3000),
      supabase.from('neubau_ereignisse').select('*').order('datum', { ascending: false }).limit(2000),
      supabase.from('radar_gemeinden').select('*').order('kanton').order('name'),
      supabase.from('objekte').select('id, zimmer, flaeche_m2, preis_chf, markt_status, neubauprojekt_id').not('neubauprojekt_id', 'is', null).is('zusammengefuehrt_in', null).order('preis_chf'),
    ]);
    if (o.data) { setInserate(o.data as ProjektInserat[]); }
    if (p.data) { setProjekte(p.data as Neubauprojekt[]); }
    if (g.data) { setGesuche(g.data as Baugesuch[]); }
    if (e.data) { setEreignisse(e.data as NeubauEreignis[]); }
    if (gm.data) { setGemeinden(gm.data as RadarGemeinde[]); }
    setLaden(false);
  }
  useEffect(() => { laden_(); }, []);

  const gefiltert = useMemo(() => {
    const s = suche.trim().toLowerCase();
    return gesuche.filter((b) => {
      if (rel === 'hoch' && b.relevanz !== 'hoch') { return false; }
      if (rel === 'mittel' && b.relevanz === 'tief') { return false; }
      if (stat === 'offen' && (b.status === 'irrelevant' || b.status === 'gesichtet' || b.neubauprojekt_id !== null)) { return false; }
      if (stat === 'beobachten' && b.status !== 'beobachten' && b.neubauprojekt_id === null) { return false; }
      if (kanton !== '' && b.kanton !== kanton) { return false; }
      if (gemeinde !== '' && b.gemeinde !== gemeinde) { return false; }
      if (s !== '' && ![b.adresse, b.beschreibung, b.bauherr, b.projektverfasser, b.gemeinde, b.ortsteil].join(' ').toLowerCase().includes(s)) { return false; }
      return true;
    });
  }, [gesuche, rel, stat, kanton, gemeinde, suche]);

  const kpiNeu = gesuche.filter((b) => b.relevanz === 'hoch' && b.status === 'neu' && b.neubauprojekt_id === null).length;
  const kpiFrist = gesuche.filter((b) => b.relevanz === 'hoch' && fristOffen(b)).length;
  const kpiVerkauf = projekte.filter((p) => p.phase === 'verkauf').length;
  const kpiVormerk = projekte.filter((p) => p.phase === 'vormerkung').length;
  const letzterAbruf = gesuche.length > 0 ? gesuche.reduce((m, b) => (b.erfasst_am > m ? b.erfasst_am : m), gesuche[0].erfasst_am) : null;

  async function gesuchStatus(b: Baugesuch, s: BaugesuchStatus) {
    setGesuche((xs) => xs.map((x) => (x.id === b.id ? { ...x, status: s } : x)));
    const { error } = await supabase.from('baugesuche').update({ status: s, aktualisiert_am: new Date().toISOString() }).eq('id', b.id);
    if (error) { setMeldung(error.message); laden_(); }
  }
  async function phaseSetzen(p: Neubauprojekt, ph: NeubauPhase) {
    const { error } = await supabase.rpc('neubauprojekt_melden', { p: { id: p.id, phase: ph } });
    if (error) { setMeldung(error.message); }
    laden_();
  }
  async function vorgemerkt(p: Neubauprojekt) {
    const { error } = await supabase.from('neubauprojekte').update({ interessent_seit: heuteIso(), phase: p.phase === 'geplant' ? 'vormerkung' : p.phase }).eq('id', p.id);
    if (error) { setMeldung(error.message); }
    laden_();
  }
  async function nachSpeichern(id: string) {
    if (modal !== null && modal.gesuchId !== null) {
      const { error } = await supabase.rpc('baugesuch_zuordnen', { p_baugesuch: modal.gesuchId, p_projekt: id });
      if (error) { setMeldung(error.message); }
    }
    setModal(null);
    laden_();
  }
  async function gemeindeAktiv(g: RadarGemeinde, aktiv: boolean) {
    setGemeinden((xs) => xs.map((x) => (x.name === g.name ? { ...x, aktiv } : x)));
    const { error } = await supabase.from('radar_gemeinden').update({ aktiv, updated_at: new Date().toISOString() }).eq('name', g.name);
    if (error) { setMeldung(error.message); laden_(); }
  }
  async function gemeindeNeu() {
    const name = neueGemeinde.name.trim();
    if (name === '') { return; }
    const bfs = neueGemeinde.bfs.trim() === '' ? null : Number(neueGemeinde.bfs);
    const { error } = await supabase.from('radar_gemeinden').insert({ name, kanton: neueGemeinde.kanton, bfs_nr: bfs, aktiv: true });
    if (error) { setMeldung(error.message); return; }
    setNeueGemeinde({ name: '', kanton: neueGemeinde.kanton, bfs: '' });
    laden_();
  }
  async function jetztAbrufen() {
    setMeldung('Abruf läuft, das dauert rund eine Minute …');
    const { data, error } = await supabase.functions.invoke('baugesuche-abruf', { body: { push: true } });
    if (error) { setMeldung('Abruf fehlgeschlagen: ' + error.message); return; }
    const info = (data && Array.isArray((data as { info?: string[] }).info)) ? (data as { info: string[] }).info.join(' · ') : 'fertig';
    setMeldung(info);
    laden_();
  }

  const aktiv = projekte.filter((p) => AKTIVE_PHASEN.includes(p.phase));
  const alt = projekte.filter((p) => !AKTIVE_PHASEN.includes(p.phase));
  const gemeindenMitGesuchen = Array.from(new Set(gesuche.map((b) => b.gemeinde).filter(Boolean) as string[])).sort();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Neubau-Radar</h1>
          <p className="sub">Neubauprojekte rund um den Zürichsee, bevor sie auf den Portalen erscheinen. Baugesuche aus den Amtsblättern ZH, SZ und SG werden täglich um 07:15 geladen.</p>
        </div>
        {!leser ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {tab === 'baugesuche' ? <button type="button" className="btn" onClick={jetztAbrufen}>Jetzt abrufen</button> : null}
            <button type="button" className="btn primary" onClick={() => setModal({ start: { ...LEER }, gesuchId: null })}>Projekt erfassen</button>
          </div>
        ) : null}
      </div>

      <div className="kpis">
        <div className="kpi accent"><span className="small muted">Im Verkauf</span><span className="v tnum">{kpiVerkauf}</span><span className="xs muted">Projekte mit Preisen</span></div>
        <div className="kpi"><span className="small muted">Vormerkung</span><span className="v tnum">{kpiVormerk}</span><span className="xs muted">Interessentenliste offen</span></div>
        <div className="kpi"><span className="small muted">Neue Wohnbau-Gesuche</span><span className="v tnum">{kpiNeu}</span><span className="xs muted">noch nicht angeschaut</span></div>
        <div className="kpi"><span className="small muted">Auflage läuft</span><span className="v tnum">{kpiFrist}</span><span className="xs muted">Wohnbau-Gesuche mit offener Frist</span></div>
      </div>

      {meldung !== null ? <div className="notice" role="status" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>{meldung}</span><button type="button" className="linkbtn" onClick={() => setMeldung(null)}>Schliessen</button></div> : null}

      <div className="seg" role="tablist" aria-label="Ansicht" style={{ alignSelf: 'flex-start' }}>
        <button type="button" role="tab" aria-pressed={tab === 'projekte'} aria-selected={tab === 'projekte'} onClick={() => setTab('projekte')}>Projekte <span className="tnum muted">{aktiv.length}</span></button>
        <button type="button" role="tab" aria-pressed={tab === 'baugesuche'} aria-selected={tab === 'baugesuche'} onClick={() => setTab('baugesuche')}>Baugesuche{kpiNeu > 0 ? <span className="chip warm" style={{ marginLeft: 6 }}>{kpiNeu}</span> : null}</button>
        <button type="button" role="tab" aria-pressed={tab === 'gemeinden'} aria-selected={tab === 'gemeinden'} onClick={() => setTab('gemeinden')}>Gemeinden</button>
      </div>

      {laden ? <div className="card empty">Lädt …</div> : null}

      {!laden && tab === 'projekte' ? (
        <>
          {PHASEN.filter((ph) => AKTIVE_PHASEN.includes(ph.code)).map((ph) => {
            const liste = aktiv.filter((p) => p.phase === ph.code);
            if (liste.length === 0) { return null; }
            return (
              <section key={ph.code} className="radar-gruppe">
                <div className="radar-gruppe-kopf"><h2>{ph.name} <span className="muted">({liste.length})</span></h2><span className="xs muted">{ph.hinweis}</span></div>
                <div className="radar-projekte">
                  {liste.map((p) => (
                    <ProjektKarte key={p.id} p={p} leser={leser}
                      gesuche={gesuche.filter((g) => g.neubauprojekt_id === p.id)}
                      ereignisse={ereignisse.filter((e) => e.neubauprojekt_id === p.id)}
                      inserate={inserate.filter((o) => o.neubauprojekt_id === p.id)}
                      onEdit={() => setModal({ start: { ...p }, gesuchId: null })}
                      onPhase={(x) => phaseSetzen(p, x)} onInteressent={() => vorgemerkt(p)} />
                  ))}
                </div>
              </section>
            );
          })}
          {aktiv.length === 0 ? <div className="card empty">Noch keine aktiven Projekte. Der tägliche Lauf erfasst Neubauprojekte von Vermarktern und Banken, ihr könnt Projekte auch selbst erfassen oder aus einem Baugesuch anlegen.</div> : null}
          {alt.length > 0 ? (
            <section className="radar-gruppe">
              <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setZeigeAlte(!zeigeAlte)} aria-expanded={zeigeAlte}>{zeigeAlte ? 'Ausverkaufte und uninteressante ausblenden' : 'Ausverkauft, nur Miete, uninteressant (' + alt.length + ')'}</button>
              {zeigeAlte ? (
                <div className="radar-projekte">
                  {alt.map((p) => (
                    <ProjektKarte key={p.id} p={p} leser={leser}
                      gesuche={gesuche.filter((g) => g.neubauprojekt_id === p.id)}
                      ereignisse={ereignisse.filter((e) => e.neubauprojekt_id === p.id)}
                      inserate={inserate.filter((o) => o.neubauprojekt_id === p.id)}
                      onEdit={() => setModal({ start: { ...p }, gesuchId: null })}
                      onPhase={(x) => phaseSetzen(p, x)} onInteressent={() => vorgemerkt(p)} />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}

      {!laden && tab === 'baugesuche' ? (
        <section className="card">
          <div className="filterbar">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="seg" aria-label="Relevanz">
                <button type="button" aria-pressed={rel === 'hoch'} onClick={() => setRel('hoch')}>Wohnbau</button>
                <button type="button" aria-pressed={rel === 'mittel'} onClick={() => setRel('mittel')}>+ EFH</button>
                <button type="button" aria-pressed={rel === 'alle'} onClick={() => setRel('alle')}>Alle</button>
              </div>
              <div className="seg" aria-label="Status">
                <button type="button" aria-pressed={stat === 'offen'} onClick={() => setStat('offen')}>Offen</button>
                <button type="button" aria-pressed={stat === 'beobachten'} onClick={() => setStat('beobachten')}>Beobachtet</button>
                <button type="button" aria-pressed={stat === 'alle'} onClick={() => setStat('alle')}>Alle</button>
              </div>
            </div>
            <div className="filter-felder">
              <select className="select" aria-label="Kanton" value={kanton} onChange={(e) => setKanton(e.target.value)}>
                <option value="">Alle Kantone</option><option value="ZH">ZH</option><option value="SZ">SZ</option><option value="SG">SG</option>
              </select>
              <select className="select" aria-label="Gemeinde" value={gemeinde} onChange={(e) => setGemeinde(e.target.value)}>
                <option value="">Alle Gemeinden</option>
                {gemeindenMitGesuchen.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <input className="input radar-suche" type="search" aria-label="Suche" placeholder="Adresse, Bauherr, Architekt …" value={suche} onChange={(e) => setSuche(e.target.value)} />
            </div>
          </div>
          <div className="list-head small muted">{gefiltert.length} Baugesuche{letzterAbruf ? ' · zuletzt neu erfasst ' + dateLong(letzterAbruf) : ''}</div>
          <div className="radar-gesuche">
            {gefiltert.slice(0, anzahl).map((b) => {
              const projekt = b.neubauprojekt_id !== null ? projekte.find((p) => p.id === b.neubauprojekt_id) : undefined;
              return (
                <div key={b.id} className={'radar-gesuch' + (b.status === 'neu' && b.neubauprojekt_id === null ? ' neu' : '')}>
                  <div className="radar-gesuch-kopf">
                    <span className="tnum small muted">{dateShort(b.publiziert_am)}</span>
                    <span className="radar-gesuch-ort">{b.gemeinde}{b.ortsteil && b.gemeinde && !b.gemeinde.toLowerCase().startsWith(b.ortsteil.toLowerCase().replace(/\s+(zh|sz|sg)$/, '')) ? ' (' + b.ortsteil + ')' : ''}</span>
                    <span className={relChip(b.relevanz)}>{b.relevanz === 'hoch' ? 'Wohnbau' : b.relevanz === 'mittel' ? 'EFH' : 'Übrige'}</span>
                    {b.wohnungen !== null ? <span className="chip outline">{b.wohnungen} Einheiten</span> : null}
                    {fristOffen(b) ? <span className="chip outline" title="Öffentliche Auflage läuft">Auflage bis {dateShort(b.frist_bis)}</span> : null}
                    {b.status === 'beobachten' && b.neubauprojekt_id === null ? <span className="chip accent">beobachtet</span> : null}
                    {projekt ? <span className="chip green">Projekt: {projekt.name}</span> : null}
                  </div>
                  <div className="radar-gesuch-adr">{b.adresse}</div>
                  <div className="small" style={{ color: 'var(--ink-2)' }}>{b.beschreibung}</div>
                  {b.bauherr || b.projektverfasser ? (
                    <div className="xs muted">{b.bauherr ? 'Bauherr: ' + b.bauherr : ''}{b.bauherr && b.projektverfasser ? ' · ' : ''}{b.projektverfasser ? 'Projekt: ' + b.projektverfasser : ''}</div>
                  ) : null}
                  <div className="radar-gesuch-fuss">
                    {b.url ? <a className="small" href={b.url} target="_blank" rel="noreferrer">{b.quelle}</a> : <span className="small muted">{b.quelle}</span>}
                    {!leser ? (
                      <div className="radar-aktionen">
                        {b.neubauprojekt_id === null ? <button type="button" className="btn sm" onClick={() => setModal({ start: { name: (b.adresse || 'Projekt') + ', ' + (b.gemeinde || ''), gemeinde: b.gemeinde, kanton: b.kanton, adresse: b.adresse, phase: 'geplant', bauherr: b.bauherr, einheiten: b.wohnungen, notiz: b.beschreibung }, gesuchId: b.id })}>Projekt anlegen</button> : null}
                        {b.neubauprojekt_id === null && projekte.length > 0 ? (
                          <select className="select radar-phase" aria-label="Bestehendem Projekt zuordnen" value="" onChange={async (e) => { if (e.target.value === '') { return; } const { error } = await supabase.rpc('baugesuch_zuordnen', { p_baugesuch: b.id, p_projekt: e.target.value }); if (error) { setMeldung(error.message); } laden_(); }}>
                            <option value="">Zuordnen …</option>
                            {projekte.filter((p) => p.gemeinde === b.gemeinde || p.gemeinde === null).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        ) : null}
                        {b.status !== 'beobachten' && b.neubauprojekt_id === null ? <button type="button" className="btn sm" onClick={() => gesuchStatus(b, 'beobachten')}>Beobachten</button> : null}
                        {b.status === 'neu' ? <button type="button" className="btn sm" onClick={() => gesuchStatus(b, 'gesichtet')}>Gesehen</button> : null}
                        {b.status !== 'irrelevant' ? <button type="button" className="btn sm" onClick={() => gesuchStatus(b, 'irrelevant')}>Irrelevant</button> : <button type="button" className="btn sm" onClick={() => gesuchStatus(b, 'neu')}>Wiederherstellen</button>}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {gefiltert.length === 0 ? <div className="empty">Keine Baugesuche für diesen Filter.</div> : null}
          </div>
          {gefiltert.length > anzahl ? <div style={{ padding: 16, textAlign: 'center' }}><button type="button" className="btn" onClick={() => setAnzahl(anzahl + 60)}>Weitere {Math.min(60, gefiltert.length - anzahl)} anzeigen</button></div> : null}
        </section>
      ) : null}

      {!laden && tab === 'gemeinden' ? (
        <section className="card pad">
          <h2>Gemeinden im Radar</h2>
          <p className="small muted" style={{ marginTop: 4 }}>Baugesuche werden nur für aktive Gemeinden geladen. Weiter entfernte Orte in SZ und SG sind bewusst nicht dabei.</p>
          <div className="radar-gemeinden">
            {['ZH', 'SZ', 'SG'].map((k) => (
              <div key={k}>
                <h3 className="small" style={{ margin: '14px 0 6px' }}>{k === 'ZH' ? 'Kanton Zürich' : k === 'SZ' ? 'Kanton Schwyz' : 'Kanton St. Gallen'}</h3>
                {gemeinden.filter((g) => g.kanton === k).map((g) => (
                  <label key={g.name} className="radar-gemeinde">
                    <input type="checkbox" checked={g.aktiv} disabled={leser} onChange={(e) => gemeindeAktiv(g, e.target.checked)} />
                    <span>{g.name}</span>
                    <span className="xs muted">{g.hinweis || ''}</span>
                    <span className="xs muted tnum">{gesuche.filter((b) => b.gemeinde === g.name && b.relevanz === 'hoch').length || ''}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
          {!leser ? (
            <div className="form-grid" style={{ marginTop: 18, alignItems: 'end' }}>
              <div className="field"><label htmlFor="rg-name">Gemeinde hinzufügen</label><input id="rg-name" className="input" value={neueGemeinde.name} onChange={(e) => setNeueGemeinde({ ...neueGemeinde, name: e.target.value })} placeholder="Name wie im Amtsblatt" /></div>
              <div className="field"><label htmlFor="rg-k">Kanton</label><select id="rg-k" className="select" value={neueGemeinde.kanton} onChange={(e) => setNeueGemeinde({ ...neueGemeinde, kanton: e.target.value })}><option>ZH</option><option>SZ</option><option>SG</option></select></div>
              <div className="field"><label htmlFor="rg-bfs">BFS-Nr. (optional)</label><input id="rg-bfs" className="input" inputMode="numeric" value={neueGemeinde.bfs} onChange={(e) => setNeueGemeinde({ ...neueGemeinde, bfs: e.target.value.replace(/\D/g, '') })} /></div>
              <button type="button" className="btn" onClick={gemeindeNeu}>Hinzufügen</button>
            </div>
          ) : null}
          <p className="xs muted" style={{ marginTop: 14 }}>Zahl rechts: Wohnbau-Baugesuche der letzten 12 Monate. Neue Gemeinden werden ab dem nächsten täglichen Abruf berücksichtigt (rückwirkend 3 Tage).</p>
        </section>
      ) : null}

      {modal !== null ? <ProjektModal start={modal.start} gemeinden={gemeinden} onClose={() => setModal(null)} onSaved={nachSpeichern} /> : null}
    </>
  );
}

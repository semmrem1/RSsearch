import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../state/AppContext';
import { StarsInput, StarsText } from './Stars';
import { dateShort } from '../lib/format';
import type { Bewertung, Kriterium, KriterienBewertung } from '../lib/types';

/**
 * Kriterienkatalog: jede Person bewertet jedes Kriterium 1 bis 5, Score = Durchschnitt.
 * Dazu pro Person ein «Gefühl» (Sterne), Notiz, Tags und die Markierungen Favorit / Uninteressant (Tabelle bewertungen).
 */
export default function KriterienGrid({ objektId, onChange }: { objektId: string; onChange?: () => void }) {
  const { me, profiles, leser } = useApp();
  const [kriterien, setKriterien] = useState<Kriterium[]>([]);
  const [werte, setWerte] = useState<KriterienBewertung[]>([]);
  const [bew, setBew] = useState<Bewertung[]>([]);
  const [notiz, setNotiz] = useState('');
  const [tags, setTags] = useState('');
  const [gespeichert, setGespeichert] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const load = async () => {
    const [k, w, b] = await Promise.all([
      supabase.from('kriterien').select('*').order('sort'),
      supabase.from('kriterien_bewertungen').select('*').eq('objekt_id', objektId),
      supabase.from('bewertungen').select('*').eq('objekt_id', objektId),
    ]);
    if (k.data) { setKriterien(k.data as Kriterium[]); }
    if (w.data) { setWerte(w.data as KriterienBewertung[]); }
    if (b.data) { setBew(b.data as Bewertung[]); }
  };
  useEffect(() => { load(); }, [objektId]); // eslint-disable-line react-hooks/exhaustive-deps

  // eigene Notiz und Tags in die Felder übernehmen (nur wenn nicht gerade getippt wird)
  useEffect(() => {
    if (me === null) { return; }
    const mine = bew.find((x) => x.user_id === me.id);
    if (timer.current !== null) { return; }
    setNotiz(mine && mine.kommentar ? mine.kommentar : '');
    setTags(mine ? mine.tags.join(', ') : '');
  }, [bew, me]);

  const wert = (userId: string, code: string): number | null => {
    const w = werte.find((x) => x.user_id === userId && x.kriterium === code);
    return w ? w.wert : null;
  };
  const score = (userId: string): number | null => {
    const w = werte.filter((x) => x.user_id === userId);
    if (w.length === 0) { return null; }
    return w.reduce((s, x) => s + x.wert, 0) / w.length;
  };
  const meine = me !== null ? bew.find((x) => x.user_id === me.id) : undefined;

  async function setzen(code: string, v: number) {
    if (me === null) { return; }
    const alt = wert(me.id, code);
    if (alt === v) {
      await supabase.from('kriterien_bewertungen').delete().eq('objekt_id', objektId).eq('user_id', me.id).eq('kriterium', code);
    } else {
      await supabase.from('kriterien_bewertungen').upsert({ objekt_id: objektId, user_id: me.id, kriterium: code, wert: v, updated_at: new Date().toISOString() });
    }
    await load();
    if (onChange) { onChange(); }
  }

  /** Teilweise Änderung der eigenen Bewertung (Gefühl, Favorit, Uninteressant, Notiz, Tags). */
  async function bewertungSpeichern(patch: Partial<Pick<Bewertung, 'sterne' | 'favorit' | 'uninteressant' | 'kommentar' | 'tags'>>) {
    if (me === null) { return; }
    const basis = meine !== undefined
      ? { sterne: meine.sterne, favorit: meine.favorit, uninteressant: meine.uninteressant, kommentar: meine.kommentar, tags: meine.tags }
      : { sterne: 0, favorit: false, uninteressant: false, kommentar: null, tags: [] as string[] };
    const zeile = { objekt_id: objektId, user_id: me.id, ...basis, ...patch, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('bewertungen').upsert(zeile);
    if (!error) { setGespeichert(new Date().toISOString()); }
    await load();
    if (onChange) { onChange(); }
  }

  /** Notiz und Tags verzögert speichern, sobald man zu tippen aufhört. */
  function textGeaendert(neuNotiz: string, neuTags: string) {
    setNotiz(neuNotiz); setTags(neuTags);
    if (timer.current !== null) { window.clearTimeout(timer.current); }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const t = neuTags.split(',').map((x) => x.trim()).filter((x) => x !== '');
      bewertungSpeichern({ kommentar: neuNotiz.trim() === '' ? null : neuNotiz.trim(), tags: t });
    }, 700);
  }

  const gesamt = (() => {
    const s = profiles.map((p) => score(p.id)).filter((x) => x !== null) as number[];
    return s.length > 0 ? s.reduce((a, b) => a + b, 0) / s.length : null;
  })();
  const uneinig = (() => {
    const s = profiles.map((p) => score(p.id)).filter((x) => x !== null) as number[];
    return s.length >= 2 && Math.max(...s) - Math.min(...s) >= 1.5;
  })();

  return (
    <div className="krit" style={{ '--personen': String(profiles.length) } as CSSProperties}>
      <div className="krit-kopf">
        <span className="small muted">Kriterium</span>
        {profiles.map((p) => <span key={p.id} className="small" style={{ color: p.farbe, fontWeight: 600, textAlign: 'center' }}>{p.name.split(' ')[0]}{me !== null && me.id === p.id ? ' (ich)' : ''}</span>)}
      </div>
      {kriterien.map((k) => (
        <div key={k.code} className="krit-zeile">
          <div className="krit-name"><span style={{ fontWeight: 600 }}>{k.name}</span><span className="xs muted">{k.beschreibung}</span></div>
          {profiles.map((p) => {
            const v = wert(p.id, k.code);
            const mein = me !== null && me.id === p.id;
            return (
              <div key={p.id} className="krit-werte" role={mein ? 'radiogroup' : undefined} aria-label={mein ? k.name : undefined}>
                {[1, 2, 3, 4, 5].map((n) => (
                  mein
                    ? <button key={n} type="button" role="radio" aria-checked={v === n} className={'krit-btn' + (v !== null && n <= v ? ' on' : '')} style={v !== null && n <= v ? { background: p.farbe, borderColor: p.farbe } : undefined} onClick={() => setzen(k.code, n)}>{n}</button>
                    : <span key={n} className={'krit-dot' + (v !== null && n <= v ? ' on' : '')} style={v !== null && n <= v ? { background: p.farbe } : undefined} aria-hidden="true" />
                ))}
                {!mein ? <span className="xs muted" style={{ marginLeft: 6 }}>{v !== null ? v : '–'}</span> : null}
              </div>
            );
          })}
        </div>
      ))}
      <div className="krit-zeile krit-summe">
        <div className="krit-name"><span style={{ fontWeight: 700 }}>Score</span><span className="xs muted">Durchschnitt aller Kriterien{gesamt !== null ? ' · gesamt ' + gesamt.toFixed(1) : ''}</span></div>
        {profiles.map((p) => { const s = score(p.id); return <span key={p.id} className="tnum" style={{ color: p.farbe, fontWeight: 700, fontSize: 18, textAlign: 'center' }}>{s !== null ? s.toFixed(1) : '–'}</span>; })}
      </div>
      <div className="krit-zeile">
        <div className="krit-name"><span style={{ fontWeight: 600 }}>Gefühl</span><span className="xs muted">Bauchgefühl, unabhängig von den Kriterien</span></div>
        {profiles.map((p) => {
          const b = bew.find((x) => x.user_id === p.id);
          const mein = me !== null && me.id === p.id;
          return (
            <div key={p.id} className="krit-werte">
              {mein
                ? <StarsInput value={b ? b.sterne : 0} onChange={(n) => bewertungSpeichern({ sterne: n })} color={p.farbe} />
                : <StarsText n={b ? b.sterne : 0} color={p.farbe} />}
            </div>
          );
        })}
      </div>
      {uneinig ? <div className="notice" style={{ marginTop: 10 }}>Ihr liegt deutlich auseinander. Dieses Objekt lohnt ein Gespräch.</div> : null}

      {leser ? <div className="xs muted" style={{ marginTop: 10 }}>Nur Lesen: Bewertungen sind den Mitgliedern vorbehalten.</div> : null}
      <div className="krit-personen">
        {profiles.map((p) => {
          const b = bew.find((x) => x.user_id === p.id);
          const mein = me !== null && me.id === p.id;
          return (
            <div key={p.id} className="krit-person">
              <div className="krit-person-kopf">
                <span style={{ fontWeight: 600, color: p.farbe }}>{p.name.split(' ')[0]}{mein ? ' (ich)' : ''}</span>
                {mein ? (
                  <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <label className="xs" style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={b ? b.favorit : false} onChange={(e) => bewertungSpeichern({ favorit: e.target.checked, uninteressant: e.target.checked ? false : (b ? b.uninteressant : false) })} /> Favorit</label>
                    <label className="xs" style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={b ? b.uninteressant : false} onChange={(e) => bewertungSpeichern({ uninteressant: e.target.checked, favorit: e.target.checked ? false : (b ? b.favorit : false) })} /> Uninteressant</label>
                  </span>
                ) : (
                  <span style={{ display: 'flex', gap: 6 }}>
                    {b && b.favorit ? <span className="chip outline">Favorit</span> : null}
                    {b && b.uninteressant ? <span className="chip warm">Uninteressant</span> : null}
                  </span>
                )}
              </div>
              {mein ? (
                <>
                  <label htmlFor={'krit-notiz-' + p.id} className="sr-only">Notiz</label>
                  <textarea id={'krit-notiz-' + p.id} className="textarea" rows={3} placeholder="Notiz zu diesem Objekt (sichtbar für beide)" value={notiz} onChange={(e) => textGeaendert(e.target.value, tags)} />
                  <label htmlFor={'krit-tags-' + p.id} className="sr-only">Tags</label>
                  <input id={'krit-tags-' + p.id} className="input" placeholder="Tags, mit Komma getrennt: Garten, laut, Renovation" value={tags} onChange={(e) => textGeaendert(notiz, e.target.value)} />
                  <span className="xs muted">{timer.current !== null ? 'speichert …' : gespeichert !== null ? 'gespeichert' : (b ? 'Stand ' + dateShort(b.updated_at) : 'wird beim Tippen gespeichert')}</span>
                </>
              ) : (
                <>
                  {b && b.kommentar ? <span className="small" style={{ color: 'var(--ink-2)', whiteSpace: 'pre-line' }}>{b.kommentar}</span> : <span className="small muted">Keine Notiz</span>}
                  {b && b.tags.length > 0 ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{b.tags.map((t) => <span key={t} className="chip outline">{t}</span>)}</div> : null}
                  {b ? <span className="xs muted">Stand {dateShort(b.updated_at)}</span> : null}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../state/AppContext';
import type { Kriterium, KriterienBewertung } from '../lib/types';

/** Kriterienkatalog: jede Person bewertet jedes Kriterium 1 bis 5, Score = Durchschnitt. */
export default function KriterienGrid({ objektId, onChange }: { objektId: string; onChange?: () => void }) {
  const { me, profiles } = useApp();
  const [kriterien, setKriterien] = useState<Kriterium[]>([]);
  const [werte, setWerte] = useState<KriterienBewertung[]>([]);

  const load = async () => {
    const [k, w] = await Promise.all([
      supabase.from('kriterien').select('*').order('sort'),
      supabase.from('kriterien_bewertungen').select('*').eq('objekt_id', objektId),
    ]);
    if (k.data) { setKriterien(k.data as Kriterium[]); }
    if (w.data) { setWerte(w.data as KriterienBewertung[]); }
  };
  useEffect(() => { load(); }, [objektId]); // eslint-disable-line react-hooks/exhaustive-deps

  const wert = (userId: string, code: string): number | null => {
    const w = werte.find((x) => x.user_id === userId && x.kriterium === code);
    return w ? w.wert : null;
  };
  const score = (userId: string): number | null => {
    const w = werte.filter((x) => x.user_id === userId);
    if (w.length === 0) { return null; }
    return w.reduce((s, x) => s + x.wert, 0) / w.length;
  };

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

  const gesamt = (() => {
    const s = profiles.map((p) => score(p.id)).filter((x) => x !== null) as number[];
    return s.length > 0 ? s.reduce((a, b) => a + b, 0) / s.length : null;
  })();
  const uneinig = (() => {
    const s = profiles.map((p) => score(p.id)).filter((x) => x !== null) as number[];
    return s.length >= 2 && Math.max(...s) - Math.min(...s) >= 1.5;
  })();

  return (
    <div className="krit">
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
      {uneinig ? <div className="notice" style={{ marginTop: 10 }}>Ihr liegt deutlich auseinander. Dieses Objekt lohnt ein Gespräch.</div> : null}
    </div>
  );
}

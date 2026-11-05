import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import type { ScoreDetail } from '../lib/types';

/**
 * Manueller Score pro Inserat (objekte.score_manuell). Übersteuert den berechneten Score dauerhaft,
 * die DB-Funktion objekt_score_rechnen() übernimmt ihn in score_auto und behält den berechneten Wert im Detail.
 */
export default function ScoreManuell({ objektId, wert, grund, detail, userId, leser, onGespeichert }: {
  objektId: string;
  wert: number | null | undefined;
  grund: string | null | undefined;
  detail: ScoreDetail | null | undefined;
  userId: string | null;
  leser: boolean;
  onGespeichert: () => void;
}) {
  const gesetzt = wert !== null && wert !== undefined;
  const [offen, setOffen] = useState(false);
  const [zahl, setZahl] = useState(gesetzt ? String(wert) : '');
  const [text, setText] = useState(grund !== null && grund !== undefined ? grund : '');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const berechnet = detail !== null && detail !== undefined ? (detail.manuell === true ? detail.score_berechnet : detail.score) : null;

  async function speichern(neu: number | null, neuGrund: string | null) {
    setLaeuft(true);
    setFehler(null);
    const { error } = await supabase.from('objekte').update({
      score_manuell: neu,
      score_manuell_grund: neu === null ? null : neuGrund,
      score_manuell_von: neu === null ? null : userId,
      score_manuell_am: neu === null ? null : new Date().toISOString(),
    }).eq('id', objektId);
    setLaeuft(false);
    if (error) { setFehler('Speichern fehlgeschlagen: ' + error.message); return; }
    setOffen(false);
    onGespeichert();
  }

  function absenden(e: FormEvent) {
    e.preventDefault();
    const n = Math.round(Number(zahl));
    if (zahl.trim() === '' || Number.isNaN(n) || n < 0 || n > 100) { setFehler('Score zwischen 0 und 100 eingeben'); return; }
    speichern(n, text.trim() === '' ? null : text.trim());
  }

  if (leser) {
    return gesetzt ? <div className="score-manuell muted">Score manuell auf {wert} gesetzt (berechnet {berechnet !== null && berechnet !== undefined ? berechnet : '–'}){grund ? ': ' + grund : ''}</div> : null;
  }

  if (!offen) {
    return (
      <div className="score-manuell">
        {gesetzt ? <span><strong>Score manuell {wert}</strong> <span className="muted">(berechnet {berechnet !== null && berechnet !== undefined ? berechnet : '–'}){grund ? ' · ' + grund : ''}</span></span> : <span className="muted">Score wird automatisch berechnet{berechnet !== null && berechnet !== undefined ? ' (' + berechnet + ')' : ''}.</span>}
        <button type="button" className="btn sm" onClick={() => { setZahl(gesetzt ? String(wert) : (berechnet !== null && berechnet !== undefined ? String(berechnet) : '')); setText(grund !== null && grund !== undefined ? grund : ''); setOffen(true); }}>{gesetzt ? 'Ändern' : 'Score manuell setzen'}</button>
        {gesetzt ? <button type="button" className="btn sm" disabled={laeuft} onClick={() => speichern(null, null)}>{laeuft ? 'Speichert …' : 'Zurück auf berechnet'}</button> : null}
        {fehler !== null ? <span style={{ color: 'var(--warm-dark)' }}>{fehler}</span> : null}
      </div>
    );
  }

  return (
    <form className="score-manuell" onSubmit={absenden}>
      <label className="muted" htmlFor="score-manuell-wert">Score manuell</label>
      <input id="score-manuell-wert" className="input" type="number" min={0} max={100} step={1} value={zahl} onChange={(e) => setZahl(e.target.value)} />
      <input className="input" type="text" aria-label="Begründung" placeholder="Begründung (z.B. Finanzierung geklärt)" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />
      <button type="submit" className="btn sm primary" disabled={laeuft}>{laeuft ? 'Speichert …' : 'Speichern'}</button>
      <button type="button" className="btn sm" onClick={() => { setOffen(false); setFehler(null); }}>Abbrechen</button>
      {fehler !== null ? <span style={{ color: 'var(--warm-dark)' }}>{fehler}</span> : null}
    </form>
  );
}

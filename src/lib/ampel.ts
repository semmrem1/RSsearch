import { budget } from './budget';
import { tragbarkeit } from './finanz';
import type { BudgetPosten, Haushalt, ObjektUebersicht, Profile } from './types';

/** Beide haben bewertet und liegen deutlich auseinander (Score >= 1.5 oder Sterne >= 2). */
export function uneinig(o: ObjektUebersicht): boolean {
  const scores = Object.values(o.kriterien_scores).map(Number);
  if (scores.length >= 2 && Math.max(...scores) - Math.min(...scores) >= 1.5) { return true; }
  const sterne = Object.values(o.bewertungen).map((b) => b.sterne).filter((s) => s > 0);
  return sterne.length >= 2 && Math.max(...sterne) - Math.min(...sterne) >= 2;
}

export type AmpelStufe = 'gruen' | 'gelb' | 'rot' | 'grau';
export interface Ampel { stufe: AmpelStufe; gruende: string[] }

export const AMPEL_LABEL: Record<AmpelStufe, string> = { gruen: 'Passt', gelb: 'Prüfen', rot: 'Eher nicht', grau: 'Offen' };
export const AMPEL_FARBE: Record<AmpelStufe, string> = { gruen: 'var(--green)', gelb: 'var(--amber)', rot: 'var(--warm)', grau: 'var(--ink-4)' };

/** Ampel aus Tragbarkeit (Bank), Budget-Überschuss, Score, Uneinigkeit und Marktstatus. Grau, solange nichts davon bekannt ist. */
export function ampel(o: ObjektUebersicht, h: Haushalt, profiles: Profile[], posten: BudgetPosten[]): Ampel {
  const rot: string[] = [];
  const gelb: string[] = [];
  let bekannt = false;

  if (o.markt_status === 'verkauft' || o.markt_status === 'offline') { rot.push('nicht mehr am Markt'); bekannt = true; }
  else if (o.markt_status === 'reserviert') { gelb.push('reserviert'); bekannt = true; }

  const t = tragbarkeit(o.preis_chf, h);
  if (t !== null && (t.quote !== null || t.ekZuTief)) {
    bekannt = true;
    if (t.ekZuTief) { rot.push('Eigenkapital zu tief'); }
    else if (t.stufe === 'nein') { rot.push('Tragbarkeit ' + (t.quote !== null ? (t.quote * 100).toFixed(0) + ' %' : '')); }
    else if (t.stufe === 'knapp') { gelb.push('Tragbarkeit knapp'); }
  }

  const b = budget(o.preis_chf, h, profiles, posten);
  if (b.vollstaendig) {
    bekannt = true;
    if (b.ueberschuss < 0) { rot.push('Budget im Minus'); }
    else if (b.sparquote !== null && b.sparquote < 0.1) { gelb.push('Sparquote unter 10 %'); }
  }

  if (o.score_gesamt !== null) {
    bekannt = true;
    const s = Number(o.score_gesamt);
    if (s < 2.5) { rot.push('Score ' + s.toFixed(1)); } else if (s < 3.5) { gelb.push('Score ' + s.toFixed(1)); }
  }
  if (uneinig(o)) { gelb.push('uneinig'); bekannt = true; }
  const unint = Object.values(o.bewertungen).some((x) => x.uninteressant);
  if (unint) { rot.push('als uninteressant markiert'); bekannt = true; }

  if (!bekannt) { return { stufe: 'grau', gruende: ['noch keine Bewertung, Haushalt oder Budget'] }; }
  if (rot.length > 0) { return { stufe: 'rot', gruende: rot.concat(gelb) }; }
  if (gelb.length > 0) { return { stufe: 'gelb', gruende: gelb }; }
  return { stufe: 'gruen', gruende: ['tragbar, Budget im Plus, keine Einwände'] };
}

import { budget } from './budget';
import { eigenkapital, tragbarkeit } from './finanz';
import { chf } from './format';
import { gemeindeAusZeile } from './steuern';
import type { BudgetPosten, Haushalt, ObjektBudgetDaten, ObjektUebersicht, Profile } from './types';

/** Beide haben bewertet und liegen deutlich auseinander (Score >= 1.5 oder Sterne >= 2). */
export function uneinig(o: ObjektUebersicht): boolean {
  const scores = Object.values(o.kriterien_scores).map(Number);
  if (scores.length >= 2 && Math.max(...scores) - Math.min(...scores) >= 1.5) { return true; }
  const sterne = Object.values(o.bewertungen).map((b) => b.sterne).filter((s) => s > 0);
  return sterne.length >= 2 && Math.max(...sterne) - Math.min(...sterne) >= 2;
}

export type AmpelStufe = 'gruen' | 'gelb' | 'rot' | 'grau';
export type PruefStufe = 'ok' | 'gelb' | 'rot' | 'offen';
export interface AmpelPruefung { name: string; stufe: PruefStufe; text: string }
export interface Ampel { stufe: AmpelStufe; gruende: string[]; pruefungen: AmpelPruefung[] }

export const AMPEL_LABEL: Record<AmpelStufe, string> = { gruen: 'Passt', gelb: 'Prüfen', rot: 'Eher nicht', grau: 'Offen' };
export const AMPEL_FARBE: Record<AmpelStufe, string> = { gruen: 'var(--green)', gelb: 'var(--amber)', rot: 'var(--warm)', grau: 'var(--ink-4)' };
export const PRUEF_FARBE: Record<PruefStufe, string> = { ok: 'var(--green)', gelb: 'var(--amber)', rot: 'var(--warm)', offen: 'var(--ink-4)' };

const pctText = (q: number) => (q * 100).toFixed(0) + ' %';

/**
 * Ampel aus acht Prüfungen: Marktstatus, Eigenkapital/Belehnung, Tragbarkeit (Bank-Sicht),
 * Budget-Überschuss, automatischer Score, Objektbewertung, Einigkeit und Markierungen. Rot schlägt Gelb, Gelb schlägt Grün.
 * Grau, solange keine Prüfung ein Ergebnis hat.
 */
export function ampel(o: ObjektUebersicht, h: Haushalt, profiles: Profile[], posten: BudgetPosten[], daten?: ObjektBudgetDaten | null): Ampel {
  const p: AmpelPruefung[] = [];
  const kuerzel = (id: string) => { const pr = profiles.find((x) => x.id === id); return pr ? pr.kuerzel : '?'; };

  // 1. Markt
  if (o.markt_status === 'verkauft') { p.push({ name: 'Markt', stufe: 'rot', text: 'verkauft' }); }
  else if (o.markt_status === 'offline') { p.push({ name: 'Markt', stufe: 'rot', text: 'offline genommen' + (o.offline_seit ? ' seit ' + o.offline_seit.slice(8, 10) + '.' + o.offline_seit.slice(5, 7) + '.' : '') }); }
  else if (o.markt_status === 'reserviert') { p.push({ name: 'Markt', stufe: 'gelb', text: 'beim Makler reserviert' }); }
  else { p.push({ name: 'Markt', stufe: 'ok', text: 'aktiv, ' + o.tage_am_markt + ' Tage am Markt' }); }

  // 2. Eigenkapital und 3. Tragbarkeit (Bank-Sicht, kalkulatorischer Zins)
  const ek = eigenkapital(h, profiles, daten);
  const t = tragbarkeit(o.preis_chf, h, daten !== undefined && daten !== null && daten.zins_effektiv !== undefined ? daten.zins_effektiv : null, ek.total);
  if (t === null) {
    p.push({ name: 'Eigenkapital', stufe: 'offen', text: 'kein Preis bekannt' });
    p.push({ name: 'Tragbarkeit', stufe: 'offen', text: 'kein Preis bekannt' });
  } else {
    if (h.eigenkapital === null) { p.push({ name: 'Eigenkapital', stufe: 'offen', text: 'Eigenkapital in den Einstellungen fehlt' }); }
    else if (t.ekZuTief) { p.push({ name: 'Eigenkapital', stufe: 'rot', text: 'Belehnung ' + pctText(t.belehnung) + ', max. ' + h.belehnung_max + ' %: es fehlen CHF ' + chf(t.ekMindest - t.ekEingesetzt) }); }
    else { p.push({ name: 'Eigenkapital', stufe: 'ok', text: 'Belehnung ' + pctText(t.belehnung) + ' bei CHF ' + chf(t.ekEingesetzt) + ' Eigenkapital' + (Object.values(ek.saeule3a).some((x) => x > 0) ? ' (inkl. Säule 3a)' : '') + ', Mittelbedarf CHF ' + chf(t.mittelbedarf) }); }

    if (t.bank.quote === null) { p.push({ name: 'Tragbarkeit', stufe: 'offen', text: 'Einkommen in den Einstellungen fehlt' }); }
    else {
      const basis = pctText(t.bank.quote) + ' vom Einkommen bei ' + h.zins_kalk + ' % kalk. Zins (max. ' + h.tragbarkeit_max + ' %), Kosten CHF ' + chf(t.bank.kosten / 12) + '/Mt';
      if (t.bank.stufe === 'ok') { p.push({ name: 'Tragbarkeit', stufe: 'ok', text: basis }); }
      else if (t.bank.stufe === 'knapp') { p.push({ name: 'Tragbarkeit', stufe: 'gelb', text: 'knapp: ' + basis }); }
      else { p.push({ name: 'Tragbarkeit', stufe: 'rot', text: basis }); }
    }
  }

  // 4. Budget (effektiver Zins, Pensen, Ausgaben; mit Überschreibungen pro Objekt, falls übergeben)
  const b = budget(o.preis_chf, h, profiles, posten, daten, gemeindeAusZeile(o));
  if (o.preis_chf === null) { p.push({ name: 'Budget', stufe: 'offen', text: 'kein Preis bekannt' }); }
  else if (!b.vollstaendig) { p.push({ name: 'Budget', stufe: 'offen', text: 'Nettolöhne und Pensen in den Einstellungen fehlen' }); }
  else {
    const sq = b.sparquote !== null ? ', Sparquote ' + pctText(b.sparquote) : '';
    if (b.ueberschuss < 0) { p.push({ name: 'Budget', stufe: 'rot', text: 'Fehlbetrag CHF ' + chf(Math.abs(b.ueberschuss)) + '/Mt bei ' + b.zinsEffektiv + ' % effektivem Zins' }); }
    else if (b.sparquote !== null && b.sparquote < 0.1) { p.push({ name: 'Budget', stufe: 'gelb', text: 'Überschuss CHF ' + chf(b.ueberschuss) + '/Mt' + sq + ' (unter 10 %)' }); }
    else { p.push({ name: 'Budget', stufe: 'ok', text: 'Überschuss CHF ' + chf(b.ueberschuss) + '/Mt' + sq + ' bei ' + b.zinsEffektiv + ' % effektivem Zins' + (b.steuer !== null ? ', Steuern geschätzt CHF ' + chf(b.steuer.monat) + '/Mt' : '') }); }
  }

  // 5. Automatischer Score (0 bis 100, objektive Faktoren, in der DB gerechnet)
  if (o.score_auto === null || o.score_auto === undefined) { p.push({ name: 'Score', stufe: 'offen', text: 'noch nicht gerechnet (kein Preis)' }); }
  else {
    const sa = Number(o.score_auto);
    const schwach = o.score_auto_detail !== null && o.score_auto_detail !== undefined ? o.score_auto_detail.faktoren.filter((f) => f.max > 0 && f.punkte / f.max < 0.4).map((f) => f.name) : [];
    const txt = sa + ' von 100' + (schwach.length > 0 ? ', schwach: ' + schwach.join(', ') : '');
    if (sa < 35) { p.push({ name: 'Score', stufe: 'rot', text: txt }); }
    else if (sa < 55) { p.push({ name: 'Score', stufe: 'gelb', text: txt }); }
    else { p.push({ name: 'Score', stufe: 'ok', text: txt }); }
  }

  // 6. Objektbewertung (gewichtete Kriterien pro Person) und 7. Einigkeit
  const scores = Object.entries(o.kriterien_scores).map(([id, s]) => ({ id, s: Number(s) }));
  const scoreText = scores.map((x) => kuerzel(x.id) + ' ' + x.s.toFixed(1)).join(' · ');
  if (o.score_gesamt === null) { p.push({ name: 'Objektbewertung', stufe: 'offen', text: 'noch keine Kriterien bewertet' }); }
  else {
    const s = Number(o.score_gesamt);
    const txt = s.toFixed(1) + ' von 5 gemeinsam (' + scoreText + ')';
    if (s < 2.5) { p.push({ name: 'Objektbewertung', stufe: 'rot', text: txt + ', unter 2.5' }); }
    else if (s < 3.5) { p.push({ name: 'Objektbewertung', stufe: 'gelb', text: txt + ', unter 3.5' }); }
    else { p.push({ name: 'Objektbewertung', stufe: 'ok', text: txt }); }
  }
  const sterne = Object.entries(o.bewertungen).filter(([, x]) => x.sterne > 0).map(([id, x]) => kuerzel(id) + ' ' + x.sterne + '★');
  const bewertet = scores.length + sterne.length;
  if (uneinig(o)) { p.push({ name: 'Einigkeit', stufe: 'gelb', text: 'ihr liegt deutlich auseinander: ' + [scoreText, sterne.join(' · ')].filter((x) => x !== '').join(' · Gefühl ') }); }
  else if (scores.length >= 2 || sterne.length >= 2) { p.push({ name: 'Einigkeit', stufe: 'ok', text: 'ähnliche Einschätzung' + (sterne.length > 0 ? ', Gefühl ' + sterne.join(' · ') : '') }); }
  else { p.push({ name: 'Einigkeit', stufe: 'offen', text: bewertet === 0 ? 'noch niemand hat bewertet' : 'erst eine Person hat bewertet' }); }

  // 8. Markierungen
  const unint = Object.entries(o.bewertungen).filter(([, x]) => x.uninteressant).map(([id]) => kuerzel(id));
  const fav = Object.entries(o.bewertungen).filter(([, x]) => x.favorit).map(([id]) => kuerzel(id));
  if (unint.length > 0) { p.push({ name: 'Markierung', stufe: 'rot', text: 'als uninteressant markiert von ' + unint.join(', ') }); }
  else if (fav.length > 0) { p.push({ name: 'Markierung', stufe: 'ok', text: 'Favorit von ' + fav.join(', ') }); }
  else { p.push({ name: 'Markierung', stufe: 'offen', text: 'kein Favorit, nicht als uninteressant markiert' }); }

  const bekannt = p.some((x) => x.stufe !== 'offen' && !(x.name === 'Markt' && x.stufe === 'ok') && !(x.name === 'Markierung'));
  const rot = p.filter((x) => x.stufe === 'rot');
  const gelb = p.filter((x) => x.stufe === 'gelb');
  const grund = (x: AmpelPruefung) => x.name + ': ' + x.text;
  if (!bekannt && rot.length === 0 && gelb.length === 0) { return { stufe: 'grau', gruende: ['noch keine Bewertung, kein Haushalt und kein Budget hinterlegt'], pruefungen: p }; }
  if (rot.length > 0) { return { stufe: 'rot', gruende: rot.concat(gelb).map(grund), pruefungen: p }; }
  if (gelb.length > 0) { return { stufe: 'gelb', gruende: gelb.map(grund), pruefungen: p }; }
  return { stufe: 'gruen', gruende: ['tragbar, Budget im Plus, keine Einwände'], pruefungen: p };
}

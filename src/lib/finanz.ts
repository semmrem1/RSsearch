import type { Haushalt } from './types';

export interface Tragbarkeit {
  hypothek: number;
  belehnung: number; // 0..1
  zinsen: number;
  nebenkosten: number;
  amortisation: number;
  kosten: number; // pro Jahr
  quote: number | null; // kosten / einkommen, 0..1
  ekZuTief: boolean;
  stufe: 'ok' | 'knapp' | 'nein' | 'unbekannt';
}

export const HAUSHALT_STANDARD: Haushalt = { id: 1, eigenkapital: null, einkommen_jahr: null, zins_kalk: 5, nebenkosten_pct: 1, amortisation_jahre: 15, belehnung_max: 80, tragbarkeit_max: 33, zins_effektiv: 1.5, weitere_einkuenfte_monat: 0 };

/** Bankübliche Tragbarkeitsrechnung: kalkulatorischer Zins, 1 % Nebenkosten, Amortisation der 2. Hypothek auf 65 %. */
export function tragbarkeit(preis: number | null, h: Haushalt): Tragbarkeit | null {
  if (preis === null || preis <= 0) { return null; }
  const ek = h.eigenkapital !== null ? h.eigenkapital : 0;
  const hypothek = Math.max(0, preis - ek);
  const belehnung = hypothek / preis;
  const zinsen = hypothek * (Number(h.zins_kalk) / 100);
  const nebenkosten = preis * (Number(h.nebenkosten_pct) / 100);
  const amortisation = Math.max(0, hypothek - 0.65 * preis) / Math.max(1, h.amortisation_jahre);
  const kosten = zinsen + nebenkosten + amortisation;
  const quote = h.einkommen_jahr !== null && h.einkommen_jahr > 0 ? kosten / h.einkommen_jahr : null;
  const ekZuTief = belehnung > Number(h.belehnung_max) / 100 + 1e-9;
  let stufe: Tragbarkeit['stufe'] = 'unbekannt';
  if (quote !== null) {
    const max = Number(h.tragbarkeit_max) / 100;
    if (ekZuTief || quote > max + 0.05) { stufe = 'nein'; } else if (quote > max) { stufe = 'knapp'; } else { stufe = 'ok'; }
  } else if (ekZuTief) { stufe = 'nein'; }
  return { hypothek, belehnung, zinsen, nebenkosten, amortisation, kosten, quote, ekZuTief, stufe };
}

export function quoteText(t: Tragbarkeit | null): string {
  if (t === null || t.quote === null) { return '–'; }
  return (t.quote * 100).toFixed(0) + ' %';
}

export function stufeFarbe(s: Tragbarkeit['stufe']): string {
  if (s === 'ok') { return 'var(--green)'; }
  if (s === 'knapp') { return 'var(--amber)'; }
  if (s === 'nein') { return 'var(--warm)'; }
  return 'var(--ink-4)';
}

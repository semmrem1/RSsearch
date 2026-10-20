import type { Haushalt } from './types';

export interface Sicht { zins: number; zinsen: number; nebenkosten: number; amortisation: number; kosten: number; quote: number | null; stufe: 'ok' | 'knapp' | 'nein' | 'unbekannt' }

export interface Tragbarkeit {
  preis: number;
  hypothek: number;
  belehnung: number; // 0..1
  ekEingesetzt: number;
  ekMindest: number; // 20 % des Preises
  ekZuTief: boolean;
  kaufnebenkosten: number;
  mittelbedarf: number; // Eigenkapital + Kaufnebenkosten beim Kauf
  bank: Sicht; // kalkulatorisch (Tragbarkeitsprüfung der Bank)
  effektiv: Sicht; // mit dem realen Zins (monatliche Belastung)
  // Kurzform für Tabelle und Filter (Bank-Sicht)
  zinsen: number; nebenkosten: number; amortisation: number; kosten: number; quote: number | null; stufe: Sicht['stufe'];
}

export const HAUSHALT_STANDARD: Haushalt = { id: 1, eigenkapital: null, einkommen_jahr: null, zins_kalk: 5, nebenkosten_pct: 1, amortisation_jahre: 15, belehnung_max: 80, tragbarkeit_max: 33, zins_effektiv: 1.5, weitere_einkuenfte_monat: 0, kaufnebenkosten_pct: 1.5 };

function sicht(preis: number, hypothek: number, zins: number, h: Haushalt, ekZuTief: boolean): Sicht {
  const zinsen = hypothek * (zins / 100);
  const nebenkosten = preis * (Number(h.nebenkosten_pct) / 100);
  const amortisation = Math.max(0, hypothek - 0.65 * preis) / Math.max(1, h.amortisation_jahre);
  const kosten = zinsen + nebenkosten + amortisation;
  const quote = h.einkommen_jahr !== null && h.einkommen_jahr > 0 ? kosten / h.einkommen_jahr : null;
  let stufe: Sicht['stufe'] = 'unbekannt';
  if (quote !== null) {
    const max = Number(h.tragbarkeit_max) / 100;
    if (ekZuTief || quote > max + 0.05) { stufe = 'nein'; } else if (quote > max) { stufe = 'knapp'; } else { stufe = 'ok'; }
  } else if (ekZuTief) { stufe = 'nein'; }
  return { zins, zinsen, nebenkosten, amortisation, kosten, quote, stufe };
}

/** Bankübliche Tragbarkeit (kalk. Zins) und effektive Belastung (realer Zins, pro Objekt überschreibbar). */
export function tragbarkeit(preis: number | null, h: Haushalt, zinsEffektiv?: number | null): Tragbarkeit | null {
  if (preis === null || preis <= 0) { return null; }
  const ek = h.eigenkapital !== null ? Number(h.eigenkapital) : 0;
  const hypothek = Math.max(0, preis - ek);
  const belehnung = hypothek / preis;
  const ekEingesetzt = preis - hypothek;
  const ekMindest = preis * 0.2;
  const ekZuTief = belehnung > Number(h.belehnung_max) / 100 + 1e-9;
  const kaufnebenkosten = preis * (Number(h.kaufnebenkosten_pct !== undefined ? h.kaufnebenkosten_pct : 1.5) / 100);
  const bank = sicht(preis, hypothek, Number(h.zins_kalk), h, ekZuTief);
  const zEff = zinsEffektiv !== undefined && zinsEffektiv !== null ? Number(zinsEffektiv) : Number(h.zins_effektiv);
  const effektiv = sicht(preis, hypothek, zEff, h, ekZuTief);
  return {
    preis, hypothek, belehnung, ekEingesetzt, ekMindest, ekZuTief, kaufnebenkosten, mittelbedarf: ekEingesetzt + kaufnebenkosten,
    bank, effektiv,
    zinsen: bank.zinsen, nebenkosten: bank.nebenkosten, amortisation: bank.amortisation, kosten: bank.kosten, quote: bank.quote, stufe: bank.stufe,
  };
}

export function quoteText(t: Tragbarkeit | Sicht | null): string {
  if (t === null || t.quote === null) { return '–'; }
  return (t.quote * 100).toFixed(0) + ' %';
}

export function stufeFarbe(s: Sicht['stufe']): string {
  if (s === 'ok') { return 'var(--green)'; }
  if (s === 'knapp') { return 'var(--amber)'; }
  if (s === 'nein') { return 'var(--warm)'; }
  return 'var(--ink-4)';
}

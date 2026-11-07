import type { Haushalt, ObjektBudgetDaten, Profile } from './types';

export interface Sicht { zins: number; unterhaltPct: number; zinsen: number; nebenkosten: number; amortisation: number; kosten: number; quote: number | null; stufe: 'ok' | 'knapp' | 'nein' | 'unbekannt' }

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

export const HAUSHALT_STANDARD: Haushalt = { id: 1, eigenkapital: null, einkommen_jahr: null, zins_kalk: 5, nebenkosten_pct: 1, amortisation_jahre: 15, belehnung_max: 80, tragbarkeit_max: 33, zins_effektiv: 1.5, weitere_einkuenfte_monat: 0, kaufnebenkosten_pct: 1.5, ek_erweitert: 0, kinder: 2, unterhalt_effektiv_pct: 0.6 };

/** Amortisationspflicht: 2. Hypothek über 2/3 des Belehnungswerts (hier Kaufpreis) innert der Amortisationsdauer abbauen. */
export const AMORTISATION_GRENZE = 2 / 3;

/** Jährliche Pflichtamortisation der 2. Hypothek (0, wenn die Belehnung bei höchstens 2/3 liegt). */
export function amortisationJahr(preis: number, hypothek: number, jahre: number): number {
  const ueber = hypothek - AMORTISATION_GRENZE * preis;
  return ueber > 0.5 ? ueber / Math.max(1, jahre) : 0;
}

/** Unterhalt effektiv in %: Überschreibung pro Objekt, sonst Standard aus dem Haushalt. */
export function unterhaltEffektivPct(h: Haushalt, daten?: ObjektBudgetDaten | null): number {
  if (daten !== undefined && daten !== null && daten.unterhalt_effektiv !== undefined) { return Number(daten.unterhalt_effektiv); }
  return h.unterhalt_effektiv_pct !== undefined && h.unterhalt_effektiv_pct !== null ? Number(h.unterhalt_effektiv_pct) : Number(h.nebenkosten_pct);
}

/** Eigenkapital-Bausteine: Basis (Haushalt), erweitertes EK (z.B. Götti), Säule 3a pro Person. Pro Objekt überschreibbar (objekt_budget.daten.ek). */
export interface Eigenkapital {
  basis: number;
  erweitert: number;
  saeule3a: Record<string, number>; // Profil-ID → eingesetzter Betrag
  total: number;
  standardBasis: number;
  standardErweitert: number;
  standardSaeule3a: Record<string, number>;
  angepasst: boolean;
}

export function eigenkapital(h: Haushalt, profiles: Profile[], daten?: ObjektBudgetDaten | null): Eigenkapital {
  const ek = daten !== undefined && daten !== null && daten.ek !== undefined ? daten.ek : {};
  const standardBasis = h.eigenkapital !== null ? Number(h.eigenkapital) : 0;
  const standardErweitert = Number(h.ek_erweitert || 0);
  const basis = ek.basis !== undefined ? Number(ek.basis) : standardBasis;
  const erweitert = ek.erweitert !== undefined ? Number(ek.erweitert) : standardErweitert;
  const standardSaeule3a: Record<string, number> = {};
  const saeule3a: Record<string, number> = {};
  profiles.forEach((p) => {
    const std = p.saeule3a !== null && p.saeule3a !== undefined ? Number(p.saeule3a) : 0;
    standardSaeule3a[p.id] = std;
    saeule3a[p.id] = ek.saeule3a !== undefined && ek.saeule3a[p.id] !== undefined ? Number(ek.saeule3a[p.id]) : std;
  });
  const total = basis + erweitert + Object.values(saeule3a).reduce((s, x) => s + x, 0);
  const angepasst = basis !== standardBasis || erweitert !== standardErweitert || profiles.some((p) => saeule3a[p.id] !== standardSaeule3a[p.id]);
  return { basis, erweitert, saeule3a, total, standardBasis, standardErweitert, standardSaeule3a, angepasst };
}

function sicht(preis: number, hypothek: number, zins: number, unterhaltPct: number, h: Haushalt, ekZuTief: boolean): Sicht {
  const zinsen = hypothek * (zins / 100);
  const nebenkosten = preis * (unterhaltPct / 100);
  const amortisation = amortisationJahr(preis, hypothek, h.amortisation_jahre);
  const kosten = zinsen + nebenkosten + amortisation;
  const quote = h.einkommen_jahr !== null && h.einkommen_jahr > 0 ? kosten / h.einkommen_jahr : null;
  let stufe: Sicht['stufe'] = 'unbekannt';
  if (quote !== null) {
    const max = Number(h.tragbarkeit_max) / 100;
    if (ekZuTief || quote > max + 0.05) { stufe = 'nein'; } else if (quote > max) { stufe = 'knapp'; } else { stufe = 'ok'; }
  } else if (ekZuTief) { stufe = 'nein'; }
  return { zins, unterhaltPct, zinsen, nebenkosten, amortisation, kosten, quote, stufe };
}

/**
 * Bankübliche Tragbarkeit (kalk. Zins) und effektive Belastung (realer Zins, pro Objekt überschreibbar).
 * Bank-Sicht mit nebenkosten_pct (bankübliche 1 %), Effektiv-Sicht mit dem realen Unterhalt (unterhalt_effektiv_pct, pro Objekt überschreibbar).
 * @param ekTotal eingesetztes Eigenkapital (siehe eigenkapital()); ohne Angabe nur das Basis-Eigenkapital des Haushalts
 * @param unterhaltEffektiv Unterhalt effektiv in % (siehe unterhaltEffektivPct()); ohne Angabe der Standard des Haushalts
 */
export function tragbarkeit(preis: number | null, h: Haushalt, zinsEffektiv?: number | null, ekTotal?: number | null, unterhaltEffektiv?: number | null): Tragbarkeit | null {
  if (preis === null || preis <= 0) { return null; }
  const ek = ekTotal !== undefined && ekTotal !== null ? ekTotal : (h.eigenkapital !== null ? Number(h.eigenkapital) + Number(h.ek_erweitert || 0) : 0);
  const hypothek = Math.max(0, preis - ek);
  const belehnung = hypothek / preis;
  const ekEingesetzt = preis - hypothek;
  const ekMindest = preis * 0.2;
  const ekZuTief = belehnung > Number(h.belehnung_max) / 100 + 1e-9;
  const kaufnebenkosten = preis * (Number(h.kaufnebenkosten_pct !== undefined ? h.kaufnebenkosten_pct : 1.5) / 100);
  const bank = sicht(preis, hypothek, Number(h.zins_kalk), Number(h.nebenkosten_pct), h, ekZuTief);
  const zEff = zinsEffektiv !== undefined && zinsEffektiv !== null ? Number(zinsEffektiv) : Number(h.zins_effektiv);
  const uEff = unterhaltEffektiv !== undefined && unterhaltEffektiv !== null ? Number(unterhaltEffektiv) : unterhaltEffektivPct(h);
  const effektiv = sicht(preis, hypothek, zEff, uEff, h, ekZuTief);
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

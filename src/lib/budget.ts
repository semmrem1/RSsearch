import type { BudgetPosten, Haushalt, ObjektBudgetDaten, Profile } from './types';
import { eigenkapital, type Eigenkapital } from './finanz';
import { steuerSchaetzung, type GemeindeSteuer, type SteuerSchaetzung } from './steuern';

export interface BudgetZeile { id: string; name: string; betrag: number; standard: number; ueberschrieben: boolean; geschaetzt: boolean }
export interface BudgetPerson { id: string; name: string; farbe: string; nettolohn100: number; pensum: number; standardPensum: number; betrag: number }
export interface Budget {
  personen: BudgetPerson[];
  weitereEinkuenfte: number;
  einkommen: number;
  zinsEffektiv: number;
  ek: Eigenkapital;
  hypothek: number;
  wohnen: { zins: number; nebenkosten: number; amortisation: number; total: number };
  ausgaben: BudgetZeile[];
  ausgabenTotal: number;
  ueberschuss: number;
  sparquote: number | null; // Anteil des Überschusses am Einkommen
  vollstaendig: boolean; // Einkommen hinterlegt
  steuer: SteuerSchaetzung | null; // grobe Schätzung für die Gemeinde (Posten «Steuern», falls nicht überschrieben)
}

function runden(n: number): number { return Math.round(n); }

/** Grobe Steuerschätzung für den Haushalt in dieser Gemeinde (Nettolöhne nach Pensum, Kinder aus den Einstellungen). */
export function steuerFuerBudget(gemeinde: GemeindeSteuer | null | undefined, h: Haushalt, personen: { betrag: number }[], weitereEinkuenfte: number): SteuerSchaetzung | null {
  if (gemeinde === null || gemeinde === undefined) { return null; }
  return steuerSchaetzung(gemeinde, personen.map((p) => p.betrag * 12), weitereEinkuenfte * 12, Number(h.kinder !== undefined ? h.kinder : 0));
}

/**
 * Monatsbudget: Einkommen nach Pensum minus Wohnkosten des Objekts (Hypozins effektiv, Nebenkosten, Amortisation)
 * minus Ausgaben. Überschreibungen pro Objekt aus objekt_budget.daten. Der Posten mit «Steuer» im Namen nimmt
 * die Schätzung für die Gemeinde, solange er nicht pro Objekt überschrieben ist.
 */
export function budget(preis: number | null, h: Haushalt, profiles: Profile[], posten: BudgetPosten[], o?: ObjektBudgetDaten | null, gemeinde?: GemeindeSteuer | null): Budget {
  const ov = o !== undefined && o !== null ? o : {};
  const personen: BudgetPerson[] = profiles.map((p) => {
    const nettolohn100 = p.nettolohn_100_monat !== null && p.nettolohn_100_monat !== undefined ? Number(p.nettolohn_100_monat) : 0;
    const standardPensum = p.pensum_pct !== null && p.pensum_pct !== undefined ? Number(p.pensum_pct) : 100;
    const pensum = ov.pensum !== undefined && ov.pensum[p.id] !== undefined ? Number(ov.pensum[p.id]) : standardPensum;
    return { id: p.id, name: p.name.split(' ')[0], farbe: p.farbe, nettolohn100, pensum, standardPensum, betrag: runden(nettolohn100 * pensum / 100) };
  });
  const weitereEinkuenfte = ov.weitere_einkuenfte !== undefined ? Number(ov.weitere_einkuenfte) : Number(h.weitere_einkuenfte_monat || 0);
  const einkommen = personen.reduce((s, p) => s + p.betrag, 0) + weitereEinkuenfte;

  const zinsEffektiv = ov.zins_effektiv !== undefined ? Number(ov.zins_effektiv) : Number(h.zins_effektiv);
  const ek = eigenkapital(h, profiles, o);
  const p = preis !== null ? preis : 0;
  const hypothek = Math.max(0, p - ek.total);
  const zins = runden(hypothek * zinsEffektiv / 100 / 12);
  const nebenkosten = runden(p * Number(h.nebenkosten_pct) / 100 / 12);
  const amortisation = runden(Math.max(0, hypothek - 0.65 * p) / Math.max(1, h.amortisation_jahre) / 12);
  const wohnen = { zins, nebenkosten, amortisation, total: zins + nebenkosten + amortisation };

  const steuer = einkommen > 0 ? steuerFuerBudget(gemeinde, h, personen, weitereEinkuenfte) : null;
  const ausgaben: BudgetZeile[] = posten.slice().sort((a, b) => a.sort - b.sort).map((x) => {
    const op = ov.posten !== undefined ? ov.posten : {};
    const ueb = op[x.id] !== undefined;
    const istSteuer = /steuer/i.test(x.name) && steuer !== null;
    const standard = istSteuer && steuer !== null ? steuer.monat : Number(x.betrag_monat);
    return { id: x.id, name: x.name, betrag: ueb ? Number(op[x.id]) : standard, standard, ueberschrieben: ueb, geschaetzt: istSteuer && !ueb };
  });
  (ov.extra || []).forEach((e, i) => { ausgaben.push({ id: 'extra-' + i, name: e.name, betrag: Number(e.betrag), standard: 0, ueberschrieben: true, geschaetzt: false }); });
  const ausgabenTotal = ausgaben.reduce((s, z) => s + z.betrag, 0);
  const ueberschuss = einkommen - wohnen.total - ausgabenTotal;
  return {
    personen, weitereEinkuenfte, einkommen, zinsEffektiv, ek, hypothek, wohnen, ausgaben, ausgabenTotal, ueberschuss,
    sparquote: einkommen > 0 ? ueberschuss / einkommen : null,
    vollstaendig: einkommen > 0,
    steuer,
  };
}

export function ueberschussFarbe(b: Budget): string {
  if (!b.vollstaendig) { return 'var(--ink-4)'; }
  if (b.ueberschuss < 0) { return 'var(--warm)'; }
  if (b.sparquote !== null && b.sparquote < 0.1) { return 'var(--amber)'; }
  return 'var(--green)';
}

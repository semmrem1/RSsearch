import { KANTON_STEUERFUSS, STEUERFUESSE, type Steuerfuss } from '../data/steuerfuesse';
import { steuerSchaetzung } from './steuern';
import type { Haushalt, Profile } from './types';
import { chf } from './format';

export type SteuerMass = 'gesamt' | 'gemeinde' | 'uns';

export interface SteuerWert {
  bfs: number;
  name: string;
  kanton: 'ZH' | 'SZ' | 'SG';
  gemeinde: number | null;
  bezirk: number;
  kantonFuss: number;
  gesamt: number | null;
  /** Steuern für unseren Haushalt pro Jahr (Kanton, Bezirk, Gemeinde und Bund), null ohne Einkommen oder Steuerfuss */
  uns: number | null;
  quelle: string | null;
}

/** Name ohne Kantonszusatz, damit «Kilchberg (ZH)» und «Pfäffikon ZH» auf die App-Namen passen. */
export function gemeindeSchluessel(name: string): string {
  return name.replace(/\s*\((ZH|SZ|SG)\)\s*$/, '').replace(/\s+(ZH|SZ|SG)$/, '').trim().toLowerCase();
}

/** Anzeigename ohne Kantonszusatz, ausser bei Namen, die sonst doppelt vorkämen. */
export function anzeigeName(name: string): string {
  if (/^(Benken|Wangen) \(/.test(name)) { return name; }
  return name.replace(/\s*\((ZH|SZ|SG)\)\s*$/, '');
}

/** Nettolöhne nach Pensum (pro Jahr) und weitere Einkünfte aus den Einstellungen. */
export function haushaltEinkommen(h: Haushalt, profiles: Profile[]): { netto: number[]; weitere: number; total: number } {
  const netto = profiles.map((p) => {
    const lohn = p.nettolohn_100_monat !== null && p.nettolohn_100_monat !== undefined ? Number(p.nettolohn_100_monat) : 0;
    const pensum = p.pensum_pct !== null && p.pensum_pct !== undefined ? Number(p.pensum_pct) : 100;
    return Math.round(lohn * pensum / 100) * 12;
  });
  const weitere = Number(h.weitere_einkuenfte_monat || 0) * 12;
  return { netto, weitere, total: netto.reduce((s, x) => s + x, 0) + weitere };
}

export function steuerWerte(h: Haushalt, profiles: Profile[]): SteuerWert[] {
  const ek = haushaltEinkommen(h, profiles);
  const kinder = Number(h.kinder !== undefined && h.kinder !== null ? h.kinder : 0);
  return STEUERFUESSE.map((s: Steuerfuss) => {
    const kantonFuss = KANTON_STEUERFUSS[s.kanton];
    const gesamt = s.gemeinde !== null ? s.gemeinde + s.bezirk + kantonFuss : null;
    let uns: number | null = null;
    if (s.gemeinde !== null && ek.total > 0) {
      const r = steuerSchaetzung({ name: s.name, kanton: s.kanton, steuerfuss: s.gemeinde, steuerfuss_kanton: kantonFuss, steuerfuss_bezirk: s.bezirk }, ek.netto, ek.weitere, kinder);
      uns = r !== null ? r.total : null;
    }
    return { bfs: s.bfs, name: s.name, kanton: s.kanton, gemeinde: s.gemeinde, bezirk: s.bezirk, kantonFuss, gesamt, uns, quelle: s.quelle };
  });
}

export function wertVon(w: SteuerWert, mass: SteuerMass): number | null {
  if (mass === 'gesamt') { return w.gesamt; }
  if (mass === 'gemeinde') { return w.gemeinde; }
  return w.uns;
}

/** Hell (tief) bis dunkel (hoch), 7 Stufen. */
export const STUFEN_FARBEN = ['#FDF3E6', '#FADCBC', '#F4BE8C', '#EA9A5E', '#D7733A', '#B0511E', '#7A3210'];
export const OHNE_WERT = '#D9DBD6';

export interface Stufe { von: number; bis: number; farbe: string }

/**
 * Stufen nach Quantilen der vorhandenen Werte (gleich viele Gemeinden pro Farbe), damit auch kleine
 * Unterschiede innerhalb eines Kantons sichtbar werden. Grenzen gerundet.
 */
export function stufen(werte: number[], rundung: number): Stufe[] {
  const v = werte.slice().sort((a, b) => a - b);
  if (v.length === 0) { return []; }
  const n = STUFEN_FARBEN.length;
  const grenzen: number[] = [v[0]];
  for (let i = 1; i < n; i++) {
    const q = v[Math.min(v.length - 1, Math.floor(i * v.length / n))];
    const r = Math.round(q / rundung) * rundung;
    if (r > grenzen[grenzen.length - 1]) { grenzen.push(r); }
  }
  grenzen.push(v[v.length - 1] + rundung);
  const farben = grenzen.length - 1 === n ? STUFEN_FARBEN : verteilen(grenzen.length - 1);
  const out: Stufe[] = [];
  for (let i = 0; i < grenzen.length - 1; i++) { out.push({ von: grenzen[i], bis: grenzen[i + 1], farbe: farben[i] }); }
  return out;
}

function verteilen(k: number): string[] {
  if (k <= 1) { return [STUFEN_FARBEN[3]]; }
  const out: string[] = [];
  for (let i = 0; i < k; i++) { out.push(STUFEN_FARBEN[Math.round(i * (STUFEN_FARBEN.length - 1) / (k - 1))]); }
  return out;
}

export function farbeFuer(wert: number | null, s: Stufe[]): string {
  if (wert === null || s.length === 0) { return OHNE_WERT; }
  for (let i = 0; i < s.length; i++) {
    if (wert < s[i].bis) { return s[i].farbe; }
  }
  return s[s.length - 1].farbe;
}

export function formatWert(w: SteuerWert, mass: SteuerMass): string {
  const v = wertVon(w, mass);
  if (v === null) { return mass === 'uns' && w.gemeinde !== null ? 'keine Einkommen erfasst' : 'Steuerfuss noch nicht erfasst'; }
  if (mass === 'uns') { return chf(v, true) + ' pro Jahr'; }
  return v + ' %';
}

/** Zusammensetzung für den Tooltip: «Kanton 95 % + Gemeinde 75 % = 170 %». */
export function zusammensetzung(w: SteuerWert): string {
  if (w.gemeinde === null) { return ''; }
  const teile = ['Kanton ' + w.kantonFuss + ' %'];
  if (w.bezirk > 0) { teile.push('Bezirk ' + w.bezirk + ' %'); }
  teile.push('Gemeinde ' + w.gemeinde + ' %');
  return teile.join(' + ') + ' = ' + (w.gesamt as number) + ' %';
}

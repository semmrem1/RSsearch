/**
 * Grobe Steuerschätzung pro Jahr: gemeinsame Veranlagung, Tarife 2026 (Bund, ZH, SZ, SG), Pauschalabzüge.
 * Eigenmietwert und Schuldzinsen/Unterhalt werden als neutral angenommen (heben sich bei hoher Belehnung etwa auf).
 * Spiegelbild von public.steuer_schaetzung() in supabase/migrations/20261021_score_steuern_eigenkapital.sql.
 */
export interface GemeindeSteuer { name: string; kanton: string; steuerfuss: number | null; steuerfuss_kanton: number | null; steuerfuss_bezirk: number | null }

export interface SteuerSchaetzung {
  kanton: string;
  gemeinde: string;
  steuerfussGesamt: number;
  kinder: number;
  personen: number;
  einkommen: number;
  steuerbarKanton: number;
  steuerbarBund: number;
  einfacheSteuer: number;
  kantonGemeinde: number;
  bund: number;
  total: number;
  monat: number;
}

function stufen(e: number, grenzen: number[], saetze: number[]): number {
  if (e <= 0) { return 0; }
  let s = 0; let u = 0;
  for (let i = 0; i < saetze.length; i++) {
    if (i < grenzen.length && e > grenzen[i]) { s += (grenzen[i] - u) * saetze[i] / 100; u = grenzen[i]; }
    else { return s + (e - u) * saetze[i] / 100; }
  }
  return s;
}

const SZ_E = [0, 1000, 5000, 10000, 50000, 100000, 150000, 230400];
const SZ_S = [0, 2.5, 29.75, 114.25, 1335.25, 3252.80, 5202.80, 8409.60];

/** Einfache Staatssteuer für gemeinsam Veranlagte (ZH Verheiratetentarif 2026, SG Vollsplitting, SZ Divisor 1.9). */
export function einfacheSteuer(kanton: string, e: number): number | null {
  if (e <= 0) { return 0; }
  if (kanton === 'ZH') { return stufen(e, [14100, 20500, 28600, 38400, 49600, 64100, 96300, 128700, 177200, 235100, 298000, 370600], [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]); }
  if (kanton === 'SG') {
    const h = e / 2;
    if (h > 264500) { return e * 8.5 / 100; }
    return 2 * stufen(h, [11600, 15800, 33800, 60300, 98400, 264500], [0, 4, 6, 8, 9.2, 9.4]);
  }
  if (kanton === 'SZ') {
    const h = e / 1.9;
    if (h >= 230400) { return e * 3.65 / 100; }
    for (let i = 1; i < SZ_E.length; i++) {
      if (h <= SZ_E[i]) { return 1.9 * (SZ_S[i - 1] + (h - SZ_E[i - 1]) * (SZ_S[i] - SZ_S[i - 1]) / (SZ_E[i] - SZ_E[i - 1])); }
    }
    return e * 3.65 / 100;
  }
  return null;
}

/** Direkte Bundessteuer, Verheiratetentarif 2026, abzüglich 263 pro Kind. */
export function bundessteuer(e: number, kinder: number): number {
  if (e <= 0) { return 0; }
  const s = e > 941400 ? e * 11.5 / 100 : stufen(e, [29700, 53400, 61300, 79200, 94900, 108700, 120600, 130600, 138500, 144300, 148300, 150300, 152400, 941400], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  return Math.max(0, s - 263 * kinder);
}

const ABZUEGE: Record<string, { kind: number; vers: number; versKind: number; zwei: number; beruf: number }> = {
  ZH: { kind: 9300, vers: 5400, versKind: 1400, zwei: 6100, beruf: 7500 },
  SG: { kind: 10800, vers: 6800, versKind: 1100, zwei: 500, beruf: 7000 },
  SZ: { kind: 9000, vers: 6400, versKind: 1000, zwei: 2100, beruf: 7000 },
};

/**
 * @param nettoJahr Nettolohn pro Jahr je erwerbstätige Person (nach Sozialabzügen, nach Pensum)
 * @param weitereJahr Kinderzulagen und weitere Einkünfte pro Jahr
 */
export function steuerSchaetzung(g: GemeindeSteuer | null, nettoJahr: number[], weitereJahr: number, kinder: number): SteuerSchaetzung | null {
  if (g === null || g.steuerfuss === null || g.steuerfuss_kanton === null || g.steuerfuss_kanton === undefined) { return null; }
  const a = ABZUEGE[g.kanton];
  if (a === undefined) { return null; }
  const erwerb = nettoJahr.filter((x) => x > 0);
  const n = erwerb.length;
  const brutto = erwerb.reduce((s, x) => s + x, 0) + (weitereJahr || 0);
  if (brutto <= 0) { return null; }
  const tief = n > 0 ? Math.min(...erwerb) : 0;
  const k = kinder || 0;
  const abzK = n * (a.beruf + 7258) + a.vers + a.versKind * k + a.kind * k + (n >= 2 ? a.zwei : 0);
  const abzB = n * (8000 + 7258) + 3700 + 700 * k + 6800 * k + (n >= 2 ? Math.min(14100, Math.max(8600, tief * 0.5)) : 0);
  const stbK = Math.max(0, Math.round((brutto - abzK) / 100) * 100);
  const stbB = Math.max(0, Math.round((brutto - abzB) / 100) * 100);
  const einf = einfacheSteuer(g.kanton, stbK);
  if (einf === null) { return null; }
  const steuerfussGesamt = Number(g.steuerfuss) + Number(g.steuerfuss_kanton) + Number(g.steuerfuss_bezirk || 0);
  const kant = einf * steuerfussGesamt / 100;
  const bund = bundessteuer(stbB, k);
  return {
    kanton: g.kanton, gemeinde: g.name, steuerfussGesamt, kinder: k, personen: n,
    einkommen: Math.round(brutto), steuerbarKanton: stbK, steuerbarBund: stbB,
    einfacheSteuer: Math.round(einf), kantonGemeinde: Math.round(kant), bund: Math.round(bund),
    total: Math.round(kant + bund), monat: Math.round((kant + bund) / 12),
  };
}

/** Gemeindedaten aus der Übersichtszeile (v_objekte_uebersicht) für die Schätzung. */
export function gemeindeAusZeile(o: { gemeinde: string | null; gemeinde_kanton: string | null; steuerfuss: number | null; steuerfuss_kanton?: number | null; steuerfuss_bezirk?: number | null }): GemeindeSteuer | null {
  if (o.gemeinde === null || o.gemeinde_kanton === null) { return null; }
  return { name: o.gemeinde, kanton: o.gemeinde_kanton, steuerfuss: o.steuerfuss, steuerfuss_kanton: o.steuerfuss_kanton !== undefined ? o.steuerfuss_kanton : null, steuerfuss_bezirk: o.steuerfuss_bezirk !== undefined ? o.steuerfuss_bezirk : null };
}

import { useState } from 'react';
import type { Haushalt, ObjektUebersicht } from './types';
import { tragbarkeit } from './finanz';

export interface ObjektFilter {
  q: string;
  orte: string[];
  markt: 'alle' | 'aktiv' | 'reserviert' | 'verkauft' | 'offline';
  phase: string; // 'alle' oder Phasennummer
  fav: string; // 'alle' oder Profil-ID
  ausgeschieden: boolean; // Phase 9 anzeigen
  pendelMax: number | null; // Minuten, bezogen auf die eingeloggte Person
  nurTragbar: boolean;
  nurUneinig: boolean;
}

export const FILTER_STANDARD: ObjektFilter = { q: '', orte: [], markt: 'alle', phase: 'alle', fav: 'alle', ausgeschieden: true, pendelMax: null, nurTragbar: false, nurUneinig: false };

export interface FilterKontext { me: string | null; haushalt: Haushalt }

/** Beide haben bewertet und liegen deutlich auseinander (Score >= 1.5 oder Sterne >= 2). */
export function uneinig(o: ObjektUebersicht): boolean {
  const scores = Object.values(o.kriterien_scores).map(Number);
  if (scores.length >= 2 && Math.max(...scores) - Math.min(...scores) >= 1.5) { return true; }
  const sterne = Object.values(o.bewertungen).map((b) => b.sterne).filter((s) => s > 0);
  return sterne.length >= 2 && Math.max(...sterne) - Math.min(...sterne) >= 2;
}

function lesen(key: string, standard: ObjektFilter): ObjektFilter {
  try {
    const raw = window.localStorage.getItem('rs.filter.' + key);
    if (raw === null) { return standard; }
    const v = JSON.parse(raw) as Partial<ObjektFilter>;
    return { ...standard, ...v, orte: Array.isArray(v.orte) ? v.orte : [] };
  } catch {
    return standard;
  }
}

/** Filterzustand pro Seite, im Browser gemerkt. */
export function useObjektFilter(key: string, standard: ObjektFilter = FILTER_STANDARD): [ObjektFilter, (f: ObjektFilter) => void] {
  const [f, setF] = useState<ObjektFilter>(() => lesen(key, standard));
  const setzen = (neu: ObjektFilter) => {
    setF(neu);
    try { window.localStorage.setItem('rs.filter.' + key, JSON.stringify(neu)); } catch { /* privat-Modus */ }
  };
  return [f, setzen];
}

export function filterAktiv(f: ObjektFilter, standard: ObjektFilter = FILTER_STANDARD): boolean {
  return f.q.trim() !== '' || f.orte.length > 0 || f.markt !== standard.markt || f.phase !== standard.phase || f.fav !== standard.fav || f.ausgeschieden !== standard.ausgeschieden || f.pendelMax !== null || f.nurTragbar || f.nurUneinig;
}

export function filtern(objekte: ObjektUebersicht[], f: ObjektFilter, ctx?: FilterKontext): ObjektUebersicht[] {
  const needle = f.q.trim().toLowerCase();
  return objekte.filter((o) => {
    if (f.pendelMax !== null && ctx !== undefined) {
      const pz = ctx.me !== null ? o.pendelzeiten[ctx.me] : undefined;
      if (!pz || pz.minuten > f.pendelMax) { return false; }
    }
    if (f.nurTragbar && ctx !== undefined) {
      const t = tragbarkeit(o.preis_chf, ctx.haushalt);
      if (t === null || t.stufe === 'nein') { return false; }
    }
    if (f.nurUneinig && !uneinig(o)) { return false; }
    if (!f.ausgeschieden && o.stufe_phase === 9) { return false; }
    if (f.orte.length > 0 && f.orte.indexOf(o.ort) === -1) { return false; }
    if (f.markt !== 'alle' && o.markt_status !== f.markt) { return false; }
    if (f.phase !== 'alle' && String(o.stufe_phase) !== f.phase) { return false; }
    if (f.fav !== 'alle') {
      const b = o.bewertungen[f.fav];
      if (!b || !(b.favorit || b.sterne >= 4)) { return false; }
    }
    if (needle) {
      const hay = [o.ort, o.adresse, o.titel, o.plz, ...o.quellen.map((s) => s.makler + ' ' + (s.externe_id || ''))].filter((x) => x !== null).join(' ').toLowerCase();
      if (hay.indexOf(needle) === -1) { return false; }
    }
    return true;
  });
}

/** Ortschaften mit Anzahl, alphabetisch. */
export function ortListe(objekte: ObjektUebersicht[]): { ort: string; n: number }[] {
  const m = new Map<string, number>();
  objekte.forEach((o) => m.set(o.ort, (m.get(o.ort) || 0) + 1));
  return Array.from(m.entries()).map(([ort, n]) => ({ ort, n })).sort((a, b) => a.ort.localeCompare(b.ort, 'de-CH'));
}

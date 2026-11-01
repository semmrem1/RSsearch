import type { KartenPunkt } from '../components/Karte';
import { versatz } from './geo';
import { chf, dateShort } from './format';
import type { Baugesuch, BaugesuchKategorie, NeubauBewertung, Neubauprojekt, Profile } from './types';

/** Für «Geplant» überwachte Bauarten (Entscheid 01.11.2026: Mehrfamilienbauten inkl. Überbauungen und Reihenhäuser) */
export const MEHRFAMILIEN_KAT: BaugesuchKategorie[] = ['mfh', 'ueberbauung', 'reihen'];

export const GWR_TEXT: Record<number, string> = { 1001: 'projektiert', 1002: 'bewilligt', 1003: 'im Bau', 1004: 'fertig', 1007: 'abgebrochen', 1008: 'nicht realisiert' };

/** Gleiche Regel wie public.neubau_mehrfamilien() */
export function istMehrfamilien(p: Neubauprojekt, gesuche: Baugesuch[]): boolean {
  if (gesuche.some((g) => g.neubauprojekt_id === p.id && g.kategorie !== null && MEHRFAMILIEN_KAT.includes(g.kategorie))) { return true; }
  const t = (p.typ || '').toLowerCase();
  return /(wohnung|reihen|doppel|überbauung|mehrfamilien|loft|maisonet|attika)/.test(t) && !/^einfamilienh/.test(t);
}

/** Geplantes Projekt, bei dem sich eine Kontaktaufnahme lohnt (bewilligt, im Bau, fertig oder Vermarkter/Website gefunden) */
export function kontaktSinnvoll(p: Neubauprojekt): boolean {
  return p.phase === 'geplant' && p.kontakt_sinnvoll_seit !== undefined && p.kontakt_sinnvoll_seit !== null;
}
/** Kontaktiert seit «Kontakt sinnvoll» gesetzt wurde */
export function schonKontaktiert(p: Neubauprojekt): boolean {
  const k = p.kontaktiert_am !== undefined ? p.kontaktiert_am : null;
  const s = p.kontakt_sinnvoll_seit !== undefined ? p.kontakt_sinnvoll_seit : null;
  return k !== null && (s === null || k >= s);
}

export function farbeProjekt(p: Neubauprojekt): string {
  if (kontaktSinnvoll(p)) { return '#A4470B'; } // warm: jetzt handeln
  if (p.phase === 'verkauf') { return '#2F7D4F'; }
  if (p.phase === 'vormerkung') { return '#1D5B84'; }
  return '#5E6670';
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

const PHASE_NAME: Record<string, string> = { geplant: 'Geplant', vormerkung: 'Vormerkung', verkauf: 'Im Verkauf', ausverkauft: 'Ausverkauft', miete: 'Nur Miete', uninteressant: 'Uninteressant' };

export function zuRadarPunkt(p: Neubauprojekt, gesuche: Baugesuch[], bewertungen: NeubauBewertung[], profiles: Profile[]): KartenPunkt | null {
  if (p.lat === undefined || p.lat === null || p.lng === undefined || p.lng === null) { return null; }
  const genau = p.geo_genauigkeit === 'gwr' || p.geo_genauigkeit === 'adresse' || p.geo_genauigkeit === 'manuell';
  const [lat, lng] = genau ? [p.lat, p.lng] : versatz(p.id, p.lat, p.lng);
  const gemerkt = bewertungen.filter((b) => b.neubauprojekt_id === p.id && b.gemerkt === true);
  const kontakt = kontaktSinnvoll(p);
  const einheiten = p.einheiten !== null ? p.einheiten : (p.gwr_wohnungen !== undefined ? p.gwr_wohnungen : null);
  const g = gesuche.find((x) => x.neubauprojekt_id === p.id);

  const label = [
    gemerkt.length > 0 ? '★' : null,
    kontakt ? 'Kontakt' : p.phase === 'geplant' ? (einheiten !== null ? einheiten + ' Whg' : 'MFH') : PHASE_NAME[p.phase],
  ].filter(Boolean).join(' ');

  const status = [
    PHASE_NAME[p.phase],
    p.gwr_status !== undefined && p.gwr_status !== null ? 'GWR: ' + (GWR_TEXT[p.gwr_status] || String(p.gwr_status)) : null,
    einheiten !== null ? einheiten + ' Einheiten' : null,
    p.preis_ab !== null ? 'ab ' + chf(p.preis_ab, true) : null,
  ].filter(Boolean).join(' · ');
  const wer = gemerkt.map((b) => { const pr = profiles.find((x) => x.id === b.user_id); return pr ? pr.name.split(' ')[0] : ''; }).filter(Boolean).join(', ');

  const html =
    '<div class="pp-body">' +
    '<a class="pp-title" href="/radar?projekt=' + p.id + '" data-nav="' + p.id + '">' + esc(p.name) + '</a>' +
    '<div class="pp-facts">' + esc([p.gemeinde, p.adresse !== null && !p.name.includes(p.adresse) ? p.adresse : null].filter(Boolean).join(' · ')) + '</div>' +
    (p.kurznotiz ? '<div class="pp-notiz">«' + esc(p.kurznotiz) + '»</div>' : '') +
    '<div class="pp-stage">' + esc(status) + (genau ? '' : ' · Lage nur auf Ortsebene') + '</div>' +
    (kontakt ? '<div class="pp-kontakt">Kontakt sinnvoll seit ' + esc(dateShort(p.kontakt_sinnvoll_seit)) + ': ' + esc(p.kontakt_grund || '') + (schonKontaktiert(p) ? ' (kontaktiert)' : '') + '</div>' : '') +
    (g !== undefined && g.beschreibung ? '<div class="pp-facts">' + esc(g.beschreibung.slice(0, 140)) + '</div>' : '') +
    (wer !== '' ? '<div class="pp-stage">Gemerkt: ' + esc(wer) + '</div>' : '') +
    '<div class="pp-links"><a class="pp-detail" href="/radar?projekt=' + p.id + '" data-nav="' + p.id + '">Zum Projekt</a>' +
    (p.website ? '<a class="pp-ext" href="' + esc(p.website) + '" target="_blank" rel="noopener noreferrer">Website ↗</a>' : '') +
    (g !== undefined && g.url ? '<a class="pp-ext" href="' + esc(g.url) + '" target="_blank" rel="noopener noreferrer">Baugesuch ↗</a>' : '') +
    '</div></div>';

  return { id: p.id, lat, lng, genau, label, farbe: farbeProjekt(p), popupHtml: html };
}

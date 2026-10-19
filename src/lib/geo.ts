import type { Objekt } from './types';

// Geocoding über die öffentliche Such-API von swisstopo (geo.admin.ch), kein Key nötig.
const SEARCH = 'https://api3.geo.admin.ch/rest/services/api/SearchServer';

export interface GeoTreffer { lat: number; lng: number; genauigkeit: 'adresse' | 'ort' }

/** Ortsnamen bereinigen: "Hinteregg (Egg)" -> "Hinteregg", "Wilen b. Wollerau" bleibt. */
function ortSuche(ort: string): string {
  return ort.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Adresse sieht wie Strasse + Nummer aus (sonst ist es meist nur ein Ortsteil wie "Nossikon"). */
function istStrasse(adresse: string): boolean {
  return /\d/.test(adresse) && /[a-zäöü]{3,}/i.test(adresse);
}

/** Schlüssel, an dem erkannt wird, ob neu geocodiert werden muss (Adresse oder Ort geändert). */
export function geoSuchtext(o: Pick<Objekt, 'adresse' | 'plz' | 'ort'>): string {
  return [o.adresse || '', o.plz || '', o.ort].join('|');
}

function inSchweiz(lat: number, lng: number): boolean {
  return lat > 45.7 && lat < 47.9 && lng > 5.9 && lng < 10.6;
}

async function suche(text: string, origins: string): Promise<{ lat: number; lng: number; origin: string } | null> {
  const url = SEARCH + '?type=locations&sr=4326&limit=1&origins=' + origins + '&searchText=' + encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) { return null; }
  const json = await res.json() as { results?: { attrs: { lat: number; lon: number; origin: string } }[] };
  if (!json.results || json.results.length === 0) { return null; }
  const a = json.results[0].attrs;
  if (typeof a.lat !== 'number' || typeof a.lon !== 'number' || !inSchweiz(a.lat, a.lon)) { return null; }
  return { lat: a.lat, lng: a.lon, origin: a.origin };
}

export async function geocode(o: Pick<Objekt, 'adresse' | 'plz' | 'ort'>): Promise<GeoTreffer | null> {
  const ort = ortSuche(o.ort);
  if (o.adresse && istStrasse(o.adresse)) {
    const t = await suche(o.adresse + ' ' + (o.plz ? o.plz + ' ' : '') + ort, 'address');
    if (t !== null) { return { lat: t.lat, lng: t.lng, genauigkeit: 'adresse' }; }
  }
  // Ortsteil (z.B. "Nossikon", "Au") genauer als die Gemeinde
  if (o.adresse && !istStrasse(o.adresse)) {
    const t = await suche(o.adresse + ' ' + ort, 'gazetteer,gg25,zipcode');
    if (t !== null) { return { lat: t.lat, lng: t.lng, genauigkeit: 'ort' }; }
  }
  const t = await suche(ort, 'gg25,zipcode,gazetteer');
  if (t !== null) { return { lat: t.lat, lng: t.lng, genauigkeit: 'ort' }; }
  return null;
}

/** Luftbild-Kachel (SWISSIMAGE) an der Position, als Wiedererkennungsbild, wenn kein Foto vorhanden. */
export function luftbildUrl(lat: number, lng: number, z = 18): string {
  const n = Math.pow(2, z);
  const x = Math.floor(((lng + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/' + z + '/' + x + '/' + y + '.jpeg';
}

/** Deterministischer Versatz für Objekte, die nur auf Ortsebene bekannt sind, damit sie sich nicht überdecken. */
export function versatz(id: string, lat: number, lng: number): [number, number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) { h = (h * 31 + id.charCodeAt(i)) >>> 0; }
  const winkel = (h % 360) * (Math.PI / 180);
  const radius = 0.002 + ((h >>> 9) % 100) / 100 * 0.004; // ca. 200 bis 600 m
  return [lat + Math.sin(winkel) * radius, lng + Math.cos(winkel) * radius * 1.45];
}

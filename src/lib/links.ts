import type { Quelle } from './types';

// Muss mit public.ist_direktlink() in der DB übereinstimmen.
const UEBERSICHTSSEITEN: RegExp[] = [
  /walde\.ch\/(en|de)\/listing\/?(\?.*)?$/i,
  /streichan\.ch\/kaufen\/?$/i,
  /moneypark\.ch\/de\/immobilien\/kaufen\/?(\?.*)?$/i,
  /avora-immobilien\.ch\/kaufen-mieten\/?$/i,
  /remax\.ch\/de\/immobilien\/immobilien-suchen/i,
  /engelvoelkers\.com\/ch\/de\/region-/i,
  /von-poll\.com\/de\/immobilien\/[a-z-]+\/?$/i,
  /sothebysrealty\.com\/eng\/sales\/[a-z-]+\/?$/i,
  /ginesta\.ch\/objekte\/immobilien-kaufen/i,
  /hev-aargau\.ch\/vermarktung\/haus-kaufen/i,
  /immo\.raiffeisen\.ch\/?$/i,
];

export function istDirektlink(url: string | null | undefined): boolean {
  if (!url) { return false; }
  if (!/^https?:\/\/[^/]+\/.+/i.test(url)) { return false; }
  return !UEBERSICHTSSEITEN.some((r) => r.test(url));
}

export function quelleDirekt(q: Quelle): boolean {
  if (q.url_direkt !== undefined && q.url_direkt !== null) { return q.url_direkt; }
  return istDirektlink(q.url);
}

/** Erste Quelle mit Direktlink, bevorzugt aktive. */
export function direktQuelle(quellen: Quelle[]): Quelle | null {
  const direkt = quellen.filter(quelleDirekt);
  if (direkt.length === 0) { return null; }
  const aktiv = direkt.find((q) => q.status === 'aktiv');
  return aktiv !== undefined ? aktiv : direkt[0];
}

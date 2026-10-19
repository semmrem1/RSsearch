import type { KartenPunkt } from '../components/Karte';
import { bildKandidaten } from './bild';
import { versatz } from './geo';
import { chf, typLabel, marktText } from './format';
import { quelleDirekt } from './links';
import type { ObjektUebersicht } from './types';

export function phasenFarbe(phase: number): string {
  if (phase === 9) { return '#8A9096'; }
  if (phase >= 2) { return '#2F7D4F'; }
  return '#1D5B84';
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function preisKurz(n: number | null): string {
  if (n === null) { return '?'; }
  return (n / 1000000).toFixed(2) + ' M';
}

export function zuKartenpunkt(o: ObjektUebersicht): KartenPunkt | null {
  if (o.lat === null || o.lng === null) { return null; }
  const genau = o.geo_genauigkeit === 'adresse' || o.geo_genauigkeit === 'manuell';
  const [lat, lng] = genau ? [o.lat, o.lng] : versatz(o.id, o.lat, o.lng);
  const favorit = Object.values(o.bewertungen).some((b) => b.favorit);

  const bilder = bildKandidaten(o).map((k) => k.src);
  const img = bilder.length > 0
    ? '<img class="pp-img" src="' + esc(bilder[0]) + '" data-alt="' + esc(bilder.slice(1).join(' ')) + '" referrerpolicy="no-referrer" alt="" onerror="var a=(this.dataset.alt||\'\').split(\' \').filter(Boolean);if(a.length){this.src=a.shift();this.dataset.alt=a.join(\' \');}else{this.remove();}">'
    : '';
  const fakten = [o.zimmer !== null ? o.zimmer + ' Zi' : null, o.flaeche_m2 !== null ? o.flaeche_m2 + ' m²' : null, typLabel(o.typ)].filter((x) => x !== null).join(' · ');
  const links = o.quellen.map((q) => {
    if (quelleDirekt(q) && q.url) {
      return '<a class="pp-ext" href="' + esc(q.url) + '" target="_blank" rel="noopener noreferrer">' + esc(q.makler) + ' ↗</a>';
    }
    return '<span class="pp-ext fehlt" title="Kein Direktlink hinterlegt">' + esc(q.makler) + ' (kein Direktlink)</span>';
  }).join('');

  const html =
    img +
    '<div class="pp-body">' +
    '<a class="pp-title" href="/inserate/' + o.id + '" data-nav="' + o.id + '">' + esc(o.ort) + (o.adresse ? ', ' + esc(o.adresse) : '') + '</a>' +
    '<div class="pp-facts">' + esc(fakten) + '</div>' +
    '<div class="pp-price">' + esc(chf(o.preis_chf, true)) + '</div>' +
    (o.markt_status !== 'aktiv' ? '<div class="pp-offline">' + esc(marktText(o.markt_status, o.offline_seit)) + '</div>' : '') +
    '<div class="pp-stage">' + esc(o.stufe_name) + (genau ? '' : ' · Lage nur auf Ortsebene') + '</div>' +
    '<div class="pp-links"><a class="pp-detail" href="/inserate/' + o.id + '" data-nav="' + o.id + '">Details</a>' + links + '</div>' +
    '</div>';

  return {
    id: o.id,
    lat,
    lng,
    genau,
    label: (favorit ? '★ ' : '') + preisKurz(o.preis_chf),
    farbe: phasenFarbe(o.stufe_phase),
    popupHtml: html,
  };
}

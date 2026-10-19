import { supabase } from './supabase';
import { luftbildUrl } from './geo';
import type { Objekt } from './types';

export type BildObjekt = Pick<Objekt, 'id' | 'bild_pfad' | 'bild_url' | 'lat' | 'lng' | 'geo_genauigkeit' | 'ort'>;

export interface Kandidat { src: string; art: 'foto' | 'luftbild' }

export function bildKandidaten(o: BildObjekt): Kandidat[] {
  const k: Kandidat[] = [];
  if (o.bild_pfad) {
    k.push({ src: supabase.storage.from('objektbilder').getPublicUrl(o.bild_pfad).data.publicUrl, art: 'foto' });
  }
  if (o.bild_url) { k.push({ src: o.bild_url, art: 'foto' }); }
  if (o.lat !== null && o.lng !== null && o.geo_genauigkeit !== null && o.geo_genauigkeit !== 'ort') {
    k.push({ src: luftbildUrl(o.lat, o.lng), art: 'luftbild' });
  }
  return k;
}

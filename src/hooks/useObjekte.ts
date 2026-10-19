import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { geocode, geoSuchtext } from '../lib/geo';
import { direktQuelle } from '../lib/links';
import type { ObjektUebersicht } from '../lib/types';

// Pro Browser-Session nur einmal pro Objekt versuchen (Seitenwechsel, StrictMode)
const geoVersucht = new Set<string>();
let bildLaufGestartet = false;

function brauchtGeo(o: ObjektUebersicht): boolean {
  if (o.geo_genauigkeit === 'manuell') { return false; }
  if (o.lat === null || o.lat === undefined) { return true; }
  return o.geo_suchtext !== geoSuchtext(o);
}

function brauchtBild(o: ObjektUebersicht): boolean {
  if (o.bild_pfad) { return false; }
  if (o.bild_fehler) { return false; }
  return o.bild_url !== null || direktQuelle(o.quellen) !== null;
}

export function useObjekte() {
  const [objekte, setObjekte] = useState<ObjektUebersicht[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [geoOffen, setGeoOffen] = useState(0);

  const reload = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('v_objekte_uebersicht')
      .select('*')
      .order('erstmals_gesehen', { ascending: false })
      .order('created_at', { ascending: false });
    if (err) { setError(err.message); } else if (data) { setObjekte(data as ObjektUebersicht[]); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Fehlende Koordinaten im Hintergrund ermitteln und in der DB ablegen
  useEffect(() => {
    if (loading) { return; }
    const offen = objekte.filter((o) => brauchtGeo(o) && !geoVersucht.has(o.id));
    if (offen.length === 0) { return; }
    let abgebrochen = false;
    setGeoOffen(offen.length);
    (async () => {
      for (const o of offen) {
        if (abgebrochen) { return; }
        geoVersucht.add(o.id);
        try {
          const t = await geocode(o);
          if (t !== null) {
            const patch = { lat: t.lat, lng: t.lng, geo_genauigkeit: t.genauigkeit, geo_suchtext: geoSuchtext(o) };
            await supabase.from('objekte').update(patch).eq('id', o.id);
            if (!abgebrochen) { setObjekte((prev) => prev.map((x) => (x.id === o.id ? { ...x, ...patch } : x))); }
          }
        } catch {
          // Netzwerkfehler: beim nächsten Laden erneut
          geoVersucht.delete(o.id);
        }
        if (!abgebrochen) { setGeoOffen((n) => Math.max(0, n - 1)); }
      }
    })();
    return () => { abgebrochen = true; setGeoOffen(0); };
  }, [loading, objekte.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fehlende Haupt- und Galeriebilder serverseitig sichern lassen (einmal pro Session)
  useEffect(() => {
    if (loading || bildLaufGestartet || objekte.length === 0) { return; }
    bildLaufGestartet = true;
    const brauchtHaupt = objekte.some(brauchtBild);
    supabase.functions.invoke('bild-sichern', { body: { limit: brauchtHaupt ? 20 : 10 } }).then(({ data }) => {
      const res = data as { gesichert?: number; galerie_gesichert?: number } | null;
      if (res !== null && ((res.gesichert || 0) > 0 || (res.galerie_gesichert || 0) > 0)) { reload(); }
    });
  }, [loading, objekte, reload]);

  return { objekte, loading, error, reload, geoOffen };
}

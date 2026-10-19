// Edge Function: ÖV-Pendelzeit vom Objekt zum Arbeitsort jeder Person (transport.opendata.ch, kein Key nötig).
// Aufrufe:
//   { aktion: 'station_suchen', text: 'Zürich HB' }        -> Stationsvorschläge für die Einstellungen
//   { objekt_id?: uuid, user_id?: uuid, erzwingen?: bool } -> Pendelzeiten berechnen und in pendelzeiten schreiben
// Aus SQL: select public.pendelzeiten_berechnen();
import { admin, berechtigt, cors, json, leseBody } from './auth.ts';

const API = 'https://transport.opendata.ch/v1';
const GEHTEMPO_M_PRO_MIN = 80;

interface Station { id: string; name: string; coordinate: { x: number; y: number }; distance: number | null }
interface Profil { id: string; name: string; arbeitsort: string | null; arbeitsort_lat: number | null; arbeitsort_lng: number | null; arbeitsort_station: string | null }
interface Objekt { id: string; ort: string; lat: number | null; lng: number | null }

async function api(pfad: string, params: Record<string, string>): Promise<Record<string, unknown> | null> {
  const u = new URL(API + pfad);
  Object.keys(params).forEach((k) => u.searchParams.set(k, params[k]));
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(u.toString(), { signal: ctl.signal, headers: { 'Accept': 'application/json' } });
    if (!r.ok) { return null; }
    return await r.json() as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function naechsteStation(lat: number, lng: number): Promise<Station | null> {
  const r = await api('/locations', { x: String(lat), y: String(lng), type: 'station' });
  if (r === null) { return null; }
  const st = (r.stations as Station[] | undefined) || [];
  const mitId = st.filter((s) => s.id && s.name);
  return mitId.length > 0 ? mitId[0] : null;
}

async function stationenSuchen(text: string): Promise<{ name: string; lat: number; lng: number }[]> {
  const r = await api('/locations', { query: text, type: 'station' });
  if (r === null) { return []; }
  const st = (r.stations as Station[] | undefined) || [];
  return st.filter((s) => s.coordinate && s.coordinate.x !== null && s.name).slice(0, 8).map((s) => ({ name: s.name, lat: s.coordinate.x, lng: s.coordinate.y }));
}

/** Nächster Montag 07:30 als Abfahrt, damit Wochenend-Fahrpläne nicht verfälschen. */
function naechsterMontag(): string {
  const d = new Date();
  const tag = d.getDay(); // 0 So .. 6 Sa
  const plus = tag === 1 ? 7 : ((8 - tag) % 7 || 7);
  d.setDate(d.getDate() + plus);
  return d.toISOString().slice(0, 10);
}

function dauerMinuten(s: string): number | null {
  // Format "00d00:42:00"
  const m = s.match(/^(\d+)d(\d+):(\d+):(\d+)$/);
  if (m === null) { return null; }
  return Number(m[1]) * 1440 + Number(m[2]) * 60 + Number(m[3]);
}

async function verbindung(von: string, nach: string): Promise<{ minuten: number; umstiege: number } | null> {
  const r = await api('/connections', { from: von, to: nach, date: naechsterMontag(), time: '07:30', limit: '4' });
  if (r === null) { return null; }
  const cons = (r.connections as { duration: string; transfers: number }[] | undefined) || [];
  let best: { minuten: number; umstiege: number } | null = null;
  for (const c of cons) {
    const min = dauerMinuten(c.duration);
    if (min === null) { continue; }
    if (best === null || min < best.minuten) { best = { minuten: min, umstiege: c.transfers }; }
  }
  return best;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: cors }); }
  const a = admin();
  const b = await berechtigt(req, a);
  if (!b.ok) { return json({ error: 'nicht berechtigt' }, 401); }
  const body = await leseBody(req);

  if (body.aktion === 'station_suchen') {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length < 2) { return json({ stationen: [] }); }
    return json({ stationen: await stationenSuchen(text) });
  }

  const objektId = typeof body.objekt_id === 'string' && body.objekt_id !== '' ? body.objekt_id : null;
  const nurUser = typeof body.user_id === 'string' && body.user_id !== '' ? body.user_id : null;
  const erzwingen = body.erzwingen === true;
  const limit = Math.min(Math.max(Number(body.limit !== undefined ? body.limit : 60) || 60, 1), 150);

  const { data: profile } = await a.from('profiles').select('id, name, arbeitsort, arbeitsort_lat, arbeitsort_lng, arbeitsort_station');
  const personen = ((profile || []) as Profil[]).filter((p) => p.arbeitsort_lat !== null && p.arbeitsort_lng !== null && (nurUser === null || p.id === nurUser));
  if (personen.length === 0) { return json({ berechnet: 0, hinweis: 'Kein Arbeitsort hinterlegt' }); }

  // Arbeitsort-Station sicherstellen
  for (const p of personen) {
    if (p.arbeitsort_station === null || p.arbeitsort_station === '') {
      const s = await naechsteStation(p.arbeitsort_lat as number, p.arbeitsort_lng as number);
      if (s !== null) { p.arbeitsort_station = s.name; await a.from('profiles').update({ arbeitsort_station: s.name }).eq('id', p.id); }
    }
  }

  let oq = a.from('objekte').select('id, ort, lat, lng').not('lat', 'is', null).is('zusammengefuehrt_in', null);
  if (objektId !== null) { oq = oq.eq('id', objektId); }
  const { data: objekte } = await oq.limit(500);
  const { data: vorhanden } = await a.from('pendelzeiten').select('objekt_id, user_id, berechnet_am, minuten, fehler');
  const alt = new Date(Date.now() - 30 * 86400000).toISOString();
  const istFrisch = (oid: string, uid: string): boolean => {
    const v = ((vorhanden || []) as { objekt_id: string; user_id: string; berechnet_am: string; minuten: number | null; fehler: string | null }[]).find((x) => x.objekt_id === oid && x.user_id === uid);
    if (v === undefined) { return false; }
    return v.berechnet_am > alt;
  };

  const stationCache = new Map<string, Station | null>();
  let n = 0;
  const ergebnis: { objekt: string; person: string; minuten: number | null; info: string }[] = [];
  for (const o of ((objekte || []) as Objekt[])) {
    if (n >= limit) { break; }
    const key = (o.lat as number).toFixed(4) + ',' + (o.lng as number).toFixed(4);
    for (const p of personen) {
      if (n >= limit) { break; }
      if (!erzwingen && objektId === null && istFrisch(o.id, p.id)) { continue; }
      n++;
      let s = stationCache.get(key);
      if (s === undefined) { s = await naechsteStation(o.lat as number, o.lng as number); stationCache.set(key, s); }
      if (s === null || p.arbeitsort_station === null) {
        await a.from('pendelzeiten').upsert({ objekt_id: o.id, user_id: p.id, minuten: null, umstiege: null, von_station: null, nach_station: p.arbeitsort_station, fehler: 'Keine Station gefunden', berechnet_am: new Date().toISOString() });
        ergebnis.push({ objekt: o.ort, person: p.name, minuten: null, info: 'keine Station' });
        continue;
      }
      const v = await verbindung(s.name, p.arbeitsort_station);
      if (v === null) {
        await a.from('pendelzeiten').upsert({ objekt_id: o.id, user_id: p.id, minuten: null, umstiege: null, von_station: s.name, nach_station: p.arbeitsort_station, fehler: 'Keine Verbindung gefunden', berechnet_am: new Date().toISOString() });
        ergebnis.push({ objekt: o.ort, person: p.name, minuten: null, info: 'keine Verbindung' });
        continue;
      }
      const fussweg = s.distance !== null && s.distance !== undefined ? Math.round(s.distance / GEHTEMPO_M_PRO_MIN) : 0;
      const minuten = v.minuten + fussweg;
      await a.from('pendelzeiten').upsert({
        objekt_id: o.id, user_id: p.id, minuten, umstiege: v.umstiege,
        von_station: s.name + (fussweg > 0 ? ' (' + fussweg + ' Min zu Fuss)' : ''),
        nach_station: p.arbeitsort_station, fehler: null, berechnet_am: new Date().toISOString(),
      });
      ergebnis.push({ objekt: o.ort, person: p.name, minuten, info: s.name + ' → ' + p.arbeitsort_station });
    }
  }
  return json({ berechnet: n, ergebnis });
});

// Edge Function: Neubau-Radar, Koordinaten und GWR-Status der Neubauprojekte.
// Body: { ids?: string[] (nur diese Projekte), trocken?: boolean (nichts schreiben, Ergebnis zurückgeben), push?: boolean (Standard true) }
//
// 1. Verorten: alle aktiven Projekte (geplant, vormerkung, verkauf) ohne Koordinaten oder mit geänderter Adresse.
// 2. GWR: für überwachte Projekte (Phase «geplant» und Mehrfamilienbau, public.neubau_mehrfamilien) die Gebäude an der Adresse
//    im eidg. Gebäude- und Wohnungsregister suchen (geo.admin.ch, Layer ch.bfs.gebaeude_wohnungs_register).
//    Neubau = Gebäude mit gstat 1001 projektiert, 1002 bewilligt, 1003 im Bau (oder das schon gemerkte EGID, auch wenn 1004 fertig).
//    Der Trigger neubauprojekte_kontakt setzt daraus «Kontakt sinnvoll» und schreibt den Verlauf.
// 3. Ein gemeinsamer Push (public.neubau_kontakt_melden) und eine Zeile in lauf_protokoll («Radar GWR»).
// Aufruf aus SQL: select public.radar_gwr_abrufen();  (täglich per pg_cron, Migration 20261101_radar_karte_gwr.sql)
import { admin, berechtigt, cors, json, leseBody } from './auth.ts';

const API = 'https://api3.geo.admin.ch/rest/services';
const LAYER = 'ch.bfs.gebaeude_wohnungs_register';
const HDR = { 'User-Agent': 'PRimmo/1.0 (privater Neubau-Radar, 1 Abgleich pro Tag)', Accept: 'application/json' };

interface Projekt {
  id: string; name: string; gemeinde: string | null; adresse: string | null; phase: string; typ: string | null;
  lat: number | null; lng: number | null; geo_genauigkeit: string | null; geo_suchtext: string | null;
  gwr_status: number | null; gwr_egid: number | null;
}
interface Gebaeude { egid: number; gstat: number; ganzwhg: number | null; gbauj: number | null; deinr: string; strname: string; gemeinde: string; e: number; n: number }
interface Ergebnis {
  id: string; name: string; adresse: string | null; ueberwacht: boolean;
  geo: { lat: number; lng: number; genauigkeit: string } | null; gwr_status: number | null; gwr_egid: number | null;
  gwr_wohnungen: number | null; gebaeude: Gebaeude[]; fehler: string | null;
}

// ---------- Helfer ----------
/** Gemeindename vergleichbar machen: «Kilchberg (ZH)» und «Kilchberg» -> «kilchberg», «Wangen SZ» -> «wangen» */
function gemNorm(s: string | null | undefined): string {
  return (s || '').toLowerCase().replace(/[()]/g, ' ').replace(/\s+(zh|sz|sg|ag|zg|tg|lu)\s*$/, '').replace(/\s+/g, ' ').trim();
}
/** «Gstaldenstrasse 12 - 14» -> Strasse «Gstaldenstrasse», Nummern ['12','14']; «Kreuzstrasse» -> Nummern [] */
function zerlege(adresse: string): { strasse: string; nummern: string[] } {
  // Nur die erste Strasse («Seestrasse 4; Bergstrasse 2» oder «Seestrasse 4, Bergstrasse 2»), Nummernlisten wie «12/14» bleiben
  const a = adresse.split(/\s*;\s*|\s*,\s*(?=[A-ZÄÖÜ][a-zäöü]+(strasse|weg|gasse|rain|halde))/)[0].trim();
  const m = a.match(/^(.*?[a-zäöüé.])\s+(\d.*)$/i);
  if (m === null) { return { strasse: a, nummern: [] }; }
  const nummern = (m[2].match(/\d+\s?[a-z]?\b/gi) || []).map((x) => x.replace(/\s/g, '').toLowerCase());
  return { strasse: m[1].trim(), nummern: Array.from(new Set(nummern)).slice(0, 4) };
}
/** LV95 (E/N) nach WGS84, Näherungsformel swisstopo (Genauigkeit ca. 1 m) */
function lv95zuWgs(e: number, n: number): { lat: number; lng: number } {
  const y = (e - 2600000) / 1e6; const x = (n - 1200000) / 1e6;
  const lng = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y;
  const lat = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.014 * x * x * x;
  return { lat: lat * 100 / 36, lng: lng * 100 / 36 };
}
function inSchweiz(lat: number, lng: number): boolean { return lat > 45.7 && lat < 47.9 && lng > 5.9 && lng < 10.6; }
async function holeJson(url: string): Promise<unknown> {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: HDR });
      if (r.ok) { return await r.json(); }
      if (r.status < 500) { return null; }
    } catch { /* nochmals */ }
    await new Promise((res) => setTimeout(res, 800));
  }
  return null;
}
function zahl(v: unknown): number | null { const n = Number(v); return v === null || v === undefined || v === '' || Number.isNaN(n) ? null : n; }

function gebaeudeAus(attrs: Record<string, unknown>): Gebaeude | null {
  const egid = zahl(attrs.egid); const gstat = zahl(attrs.gstat); const e = zahl(attrs.gkode); const n = zahl(attrs.gkodn);
  if (egid === null || gstat === null || e === null || n === null) { return null; }
  return { egid, gstat, ganzwhg: zahl(attrs.ganzwhg), gbauj: zahl(attrs.gbauj), deinr: String(attrs.deinr || ''), strname: String(attrs.strname || ''), gemeinde: String(attrs.ggdename || ''), e, n };
}

/** Alle GWR-Gebäude mit genau dieser Strasse + Nummer in der Gemeinde */
async function gwrAdresse(strasse: string, nr: string, gemeinde: string): Promise<Gebaeude[]> {
  const url = API + '/ech/MapServer/find?layer=' + LAYER + '&searchField=strname_deinr&contains=false&returnGeometry=false&searchText=' + encodeURIComponent(strasse + ' ' + nr);
  const j = await holeJson(url) as { results?: { attributes?: Record<string, unknown> }[] } | null;
  if (j === null || !Array.isArray(j.results)) { return []; }
  const g = gemNorm(gemeinde);
  const out: Gebaeude[] = [];
  for (const r of j.results) {
    if (!r.attributes) { continue; }
    const b = gebaeudeAus(r.attributes);
    if (b !== null && gemNorm(b.gemeinde) === g) { out.push(b); }
  }
  return out;
}
/** Ein Gebäude per EGID (Status des schon gemerkten Neubaus nachführen) */
async function gwrEgid(egid: number): Promise<Gebaeude | null> {
  const url = API + '/ech/MapServer/find?layer=' + LAYER + '&searchField=egid&contains=false&returnGeometry=false&searchText=' + egid;
  const j = await holeJson(url) as { results?: { attributes?: Record<string, unknown> }[] } | null;
  if (j === null || !Array.isArray(j.results)) { return null; }
  for (const r of j.results) { if (r.attributes) { const b = gebaeudeAus(r.attributes); if (b !== null && b.egid === egid) { return b; } } }
  return null;
}
/** Adress- oder Ortssuche (swisstopo SearchServer), Fallback wenn das GWR nichts liefert */
async function suche(text: string, origins: string): Promise<{ lat: number; lng: number } | null> {
  const url = API + '/api/SearchServer?type=locations&sr=4326&limit=1&origins=' + origins + '&searchText=' + encodeURIComponent(text);
  const j = await holeJson(url) as { results?: { attrs: { lat: number; lon: number } }[] } | null;
  if (j === null || !j.results || j.results.length === 0) { return null; }
  const a = j.results[0].attrs;
  if (typeof a.lat !== 'number' || typeof a.lon !== 'number' || !inSchweiz(a.lat, a.lon)) { return null; }
  return { lat: a.lat, lng: a.lon };
}

const NEU = [1001, 1002, 1003];

async function pruefe(p: Projekt, ueberwacht: boolean): Promise<Ergebnis> {
  const erg: Ergebnis = { id: p.id, name: p.name, adresse: p.adresse, ueberwacht, geo: null, gwr_status: p.gwr_status, gwr_egid: p.gwr_egid, gwr_wohnungen: null, gebaeude: [], fehler: null };
  const gemeinde = p.gemeinde || '';
  const { strasse, nummern } = zerlege(p.adresse || '');
  try {
    // GWR an allen Nummern der Adresse
    if (strasse !== '' && nummern.length > 0 && gemeinde !== '') {
      for (const nr of nummern) {
        const gs = await gwrAdresse(strasse, nr, gemeinde);
        gs.forEach((g) => { if (!erg.gebaeude.some((x) => x.egid === g.egid)) { erg.gebaeude.push(g); } });
      }
    }
    // Schon bekannter Neubau, der unter einer neuen Adresse geführt wird
    if (p.gwr_egid !== null && !erg.gebaeude.some((x) => x.egid === p.gwr_egid)) {
      const g = await gwrEgid(p.gwr_egid);
      if (g !== null) { erg.gebaeude.push(g); }
    }
    const neu = erg.gebaeude.filter((g) => NEU.includes(g.gstat) || (p.gwr_egid !== null && g.egid === p.gwr_egid));
    if (ueberwacht) {
      if (neu.length > 0) {
        const best = neu.reduce((a, b) => (b.gstat > a.gstat ? b : a));
        erg.gwr_status = best.gstat; erg.gwr_egid = best.egid;
        erg.gwr_wohnungen = neu.reduce((s, g) => s + (g.ganzwhg || 0), 0) || null;
      } else {
        erg.gwr_status = null; // noch nicht als Neubau im GWR
      }
    }
    // Koordinaten: Neubau, sonst erstes Gebäude an der Adresse, sonst Adress- bzw. Ortssuche
    const lage = neu.length > 0 ? neu[0] : erg.gebaeude[0];
    if (lage !== undefined) {
      const w = lv95zuWgs(lage.e, lage.n);
      if (inSchweiz(w.lat, w.lng)) { erg.geo = { lat: w.lat, lng: w.lng, genauigkeit: 'gwr' }; }
    }
    if (erg.geo === null && strasse !== '') {
      const t = await suche((p.adresse || '') + ' ' + gemeinde.replace(/\s+(ZH|SZ|SG)$/, ''), 'address');
      if (t !== null) { erg.geo = { ...t, genauigkeit: nummern.length > 0 ? 'adresse' : 'ort' }; }
    }
    if (erg.geo === null && gemeinde !== '') {
      const t = await suche(gemeinde, 'gg25,gazetteer,zipcode');
      if (t !== null) { erg.geo = { ...t, genauigkeit: 'ort' }; }
    }
  } catch (e) {
    erg.fehler = String(e instanceof Error ? e.message : e);
  }
  return erg;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: cors }); }
  const a = admin();
  const ber = await berechtigt(req, a);
  if (!ber.ok) { return json({ fehler: 'Nicht berechtigt' }, 401); }
  const body = await leseBody(req);
  const trocken = body.trocken === true || body.trocken === 'true';
  const push = !(body.push === false || body.push === 'false');
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : null;
  const start = new Date().toISOString();

  let q = a.from('neubauprojekte').select('id, name, gemeinde, adresse, phase, typ, lat, lng, geo_genauigkeit, geo_suchtext, gwr_status, gwr_egid').in('phase', ['geplant', 'vormerkung', 'verkauf']);
  if (ids !== null) { q = q.in('id', ids); }
  const { data, error } = await q;
  if (error) { return json({ fehler: error.message }, 500); }
  const projekte = (data || []) as Projekt[];

  // Welche Projekte sind überwachte Mehrfamilienbauten? (gleiche Regel wie public.neubau_mehrfamilien)
  const { data: bg } = await a.from('baugesuche').select('neubauprojekt_id, kategorie').not('neubauprojekt_id', 'is', null);
  const mfhIds = new Set(((bg || []) as { neubauprojekt_id: string; kategorie: string | null }[])
    .filter((b) => b.kategorie === 'mfh' || b.kategorie === 'ueberbauung' || b.kategorie === 'reihen').map((b) => b.neubauprojekt_id));
  const istMfh = (p: Projekt) => {
    const t = (p.typ || '').toLowerCase();
    return mfhIds.has(p.id) || (/(wohnung|reihen|doppel|überbauung|mehrfamilien|loft|maisonet|attika)/.test(t) && !/^einfamilienh/.test(t));
  };

  const arbeit = projekte.filter((p) => {
    const ueberwacht = p.phase === 'geplant' && istMfh(p);
    const suchtext = (p.adresse || '') + '|' + (p.gemeinde || '');
    const geoFehlt = p.geo_genauigkeit !== 'manuell' && (p.lat === null || p.geo_suchtext !== suchtext);
    return ueberwacht || geoFehlt;
  });

  // Parallel in kleinen Gruppen, damit geo.admin.ch nicht überlastet wird
  const ergebnisse: Ergebnis[] = [];
  for (let i = 0; i < arbeit.length; i += 5) {
    const teil = await Promise.all(arbeit.slice(i, i + 5).map((p) => pruefe(p, p.phase === 'geplant' && istMfh(p))));
    ergebnisse.push(...teil);
  }

  let geaendert = 0; let verortet = 0; let fehler = 0;
  if (!trocken) {
    for (const r of ergebnisse) {
      const p = projekte.find((x) => x.id === r.id) as Projekt;
      if (r.fehler !== null) { fehler++; continue; }
      const patch: Record<string, unknown> = {};
      if (r.geo !== null && p.geo_genauigkeit !== 'manuell') {
        patch.lat = r.geo.lat; patch.lng = r.geo.lng; patch.geo_genauigkeit = r.geo.genauigkeit;
        patch.geo_suchtext = (p.adresse || '') + '|' + (p.gemeinde || '');
        if (p.lat === null) { verortet++; }
      }
      if (r.ueberwacht) {
        patch.gwr_geprueft_am = new Date().toISOString();
        patch.gwr_detail = r.gebaeude.map((g) => ({ egid: g.egid, gstat: g.gstat, wohnungen: g.ganzwhg, baujahr: g.gbauj, adresse: g.strname + ' ' + g.deinr }));
        // Status nur nach oben oder bei Wegfall schreiben; ein einmal gesehener Neubau bleibt bekannt
        if (r.gwr_status !== p.gwr_status && !(r.gwr_status === null && p.gwr_status !== null && p.gwr_egid !== null)) { patch.gwr_status = r.gwr_status; geaendert++; }
        if (r.gwr_egid !== null) { patch.gwr_egid = r.gwr_egid; }
        if (r.gwr_wohnungen !== null) { patch.gwr_wohnungen = r.gwr_wohnungen; }
      }
      if (Object.keys(patch).length > 0) {
        const { error: e2 } = await a.from('neubauprojekte').update(patch).eq('id', r.id);
        if (e2) { fehler++; r.fehler = e2.message; }
      }
    }
  }

  let gemeldet = 0;
  if (!trocken && push) {
    const { data: n } = await a.rpc('neubau_kontakt_melden');
    gemeldet = typeof n === 'number' ? n : 0;
  }
  const ueberwacht = ergebnisse.filter((r) => r.ueberwacht).length;
  if (!trocken && ids === null) {
    await a.from('lauf_protokoll').insert({
      makler: 'Radar GWR', geprueft: true, anzahl_inserate: ueberwacht, neue: gemeldet, geaendert,
      fehler: fehler > 0 ? fehler + ' Projekte nicht geprüft' : null, gestartet_am: start, beendet_am: new Date().toISOString(),
    });
  }
  return json({
    info: [ueberwacht + ' geplante Mehrfamilienbauten im GWR geprüft', geaendert + ' Statuswechsel', verortet + ' neu verortet', gemeldet + ' Mal Kontakt sinnvoll gemeldet', fehler + ' Fehler'],
    ergebnisse: trocken ? ergebnisse : ergebnisse.filter((r) => r.fehler !== null || r.gwr_status !== null).map((r) => ({ name: r.name, gwr_status: r.gwr_status, fehler: r.fehler })),
  });
});

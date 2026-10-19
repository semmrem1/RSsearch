// Edge Function: sichert für Objekte ohne gespeichertes Bild ein Foto im Storage-Bucket "objektbilder".
// Quelle: objekte.bild_url, sonst og:image / twitter:image der Inserat-Detailseite (Direktlink).
// Aufruf (eingeloggt): supabase.functions.invoke('bild-sichern', { body: { objekt_id?: string, limit?: number } })
import { createClient } from 'npm:@supabase/supabase-js@2';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Quelle { url: string | null; url_direkt: boolean; status: string }
interface Zeile { id: string; bild_url: string | null; bild_fehler: string | null; objekt_quellen: Quelle[] }

async function holen(url: string, referer: string | null, ms = 10000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const headers: Record<string, string> = { 'User-Agent': UA, 'Accept-Language': 'de-CH,de;q=0.9' };
    if (referer !== null) { headers['Referer'] = referer; }
    return await fetch(url, { headers, redirect: 'follow', signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

function metaBild(html: string, basis: string): string | null {
  const muster = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']twitter:image(?::src)?["']/i,
    /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i,
  ];
  for (const m of muster) {
    const r = html.match(m);
    if (r !== null && r[1]) {
      try { return new URL(r[1].replace(/&amp;/g, '&'), basis).toString(); } catch { /* weiter */ }
    }
  }
  return null;
}

function endung(typ: string): string {
  if (typ.includes('png')) { return 'png'; }
  if (typ.includes('webp')) { return 'webp'; }
  if (typ.includes('gif')) { return 'gif'; }
  if (typ.includes('avif')) { return 'avif'; }
  return 'jpg';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: cors }); }

  const admin = createClient(Deno.env.get('SUPABASE_URL') as string, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string);
  let body: { objekt_id?: string; limit?: number } = {};
  try { body = await req.json(); } catch { body = {}; }
  const limit = Math.min(Math.max(body.limit !== undefined ? body.limit : 15, 1), 40);

  let q = admin.from('objekte').select('id, bild_url, bild_fehler, objekt_quellen(url, url_direkt, status)').is('bild_pfad', null);
  if (body.objekt_id) { q = q.eq('id', body.objekt_id); }
  const { data, error } = await q.limit(200);
  if (error) { return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }); }

  // Nur Objekte, für die es etwas Neues zu versuchen gibt
  const offen = (data as Zeile[]).filter((o) => {
    const hatDirektlink = o.objekt_quellen.some((x) => x.url_direkt && x.url !== null);
    if (!hatDirektlink && !o.bild_url) { return false; } // nichts zu versuchen, später erneut
    if (body.objekt_id) { return true; }
    if (o.bild_fehler === null) { return true; }
    return o.bild_url !== null && !o.bild_fehler.includes(o.bild_url);
  }).slice(0, limit);

  const ergebnis: { id: string; ok: boolean; info: string }[] = [];
  for (const o of offen) {
    const seiten = o.objekt_quellen.filter((x) => x.url_direkt && x.url !== null).map((x) => x.url as string);
    let fehler = '';
    let gesichert = false;

    const versuche = async (bild: string, referer: string | null): Promise<boolean> => {
      try {
        const r = await holen(bild, referer);
        const typ = r.headers.get('content-type') || '';
        if (!r.ok || !typ.startsWith('image/')) { fehler += 'Bild ' + r.status + ' ' + typ + ' ' + bild + '; '; return false; }
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.byteLength < 2000 || bytes.byteLength > 10 * 1024 * 1024) { fehler += 'Bildgroesse ' + bytes.byteLength + ' ' + bild + '; '; return false; }
        const pfad = 'auto/' + o.id + '.' + endung(typ);
        const up = await admin.storage.from('objektbilder').upload(pfad, bytes, { contentType: typ.split(';')[0], upsert: true });
        if (up.error) { fehler += 'Upload ' + up.error.message + '; '; return false; }
        await admin.from('objekte').update({ bild_pfad: pfad, bild_url: o.bild_url || bild, bild_fehler: null }).eq('id', o.id);
        return true;
      } catch (e) { fehler += 'Bild nicht erreichbar ' + bild + ' (' + String(e) + '); '; return false; }
    };

    // 1) bekannte Bild-URL
    if (o.bild_url) { gesichert = await versuche(o.bild_url, seiten.length > 0 ? seiten[0] : null); }
    // 2) og:image der Detailseiten
    for (const seite of seiten) {
      if (gesichert) { break; }
      try {
        const r = await holen(seite, null);
        if (!r.ok) { fehler += 'Seite ' + r.status + ' ' + seite + '; '; continue; }
        const bild = metaBild(await r.text(), r.url || seite);
        if (bild === null) { fehler += 'kein og:image ' + seite + '; '; continue; }
        gesichert = await versuche(bild, seite);
      } catch (e) { fehler += 'Seite nicht erreichbar ' + seite + ' (' + String(e) + '); '; }
    }

    if (!gesichert) {
      const text = (fehler || 'kein Direktlink und keine Bild-URL') + (o.bild_url ? ' [' + o.bild_url + ']' : '');
      await admin.from('objekte').update({ bild_fehler: text.slice(0, 1000) }).eq('id', o.id);
    }
    ergebnis.push({ id: o.id, ok: gesichert, info: gesichert ? 'gesichert' : fehler.slice(0, 300) });
  }

  return new Response(JSON.stringify({ geprueft: ergebnis.length, gesichert: ergebnis.filter((e) => e.ok).length, ergebnis }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});

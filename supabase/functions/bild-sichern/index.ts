// Edge Function: sichert Inseratfotos im Storage-Bucket "objektbilder".
// 1) Hauptbild: objekte.bild_url, sonst og:image der Inserat-Detailseite (Direktlink) -> objekte.bild_pfad
// 2) Galerie: objekt_bilder.quelle_url -> objekt_bilder.pfad
// Aufruf aus der App: supabase.functions.invoke('bild-sichern', { body: { objekt_id?, limit? } })
// Aufruf aus SQL: select public.bilder_sichern();
import { admin, berechtigt, cors, json, leseBody } from './auth.ts';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

interface Quelle { url: string | null; url_direkt: boolean; status: string }
interface Zeile { id: string; bild_url: string | null; bild_fehler: string | null; objekt_quellen: Quelle[] }
interface Galerie { id: string; objekt_id: string; quelle_url: string; fehler: string | null; objekte: { objekt_quellen: Quelle[] } | null }

async function holen(url: string, referer: string | null, ms = 12000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const headers: Record<string, string> = { 'User-Agent': UA, 'Accept-Language': 'de-CH,de;q=0.9', 'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8' };
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
  const a = admin();
  const b = await berechtigt(req, a);
  if (!b.ok) { return json({ error: 'nicht berechtigt' }, 401); }

  const body = await leseBody(req);
  const objektId = typeof body.objekt_id === 'string' && body.objekt_id !== '' ? body.objekt_id : null;
  const limit = Math.min(Math.max(Number(body.limit !== undefined ? body.limit : 15) || 15, 1), 40);

  // Bild laden und ins Storage legen; gibt den Pfad oder null zurück
  const sichern = async (bild: string, referer: string | null, pfadOhneEndung: string, fehler: string[]): Promise<string | null> => {
    try {
      const r = await holen(bild, referer);
      const typ = r.headers.get('content-type') || '';
      if (!r.ok || !typ.startsWith('image/')) { fehler.push('Bild ' + r.status + ' ' + typ + ' ' + bild); return null; }
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.byteLength < 2000 || bytes.byteLength > 10 * 1024 * 1024) { fehler.push('Bildgroesse ' + bytes.byteLength + ' ' + bild); return null; }
      const pfad = pfadOhneEndung + '.' + endung(typ);
      const up = await a.storage.from('objektbilder').upload(pfad, bytes, { contentType: typ.split(';')[0], upsert: true });
      if (up.error) { fehler.push('Upload ' + up.error.message); return null; }
      return pfad;
    } catch (e) { fehler.push('Bild nicht erreichbar ' + bild + ' (' + String(e) + ')'); return null; }
  };

  // ---------------------------------------------------------------- Hauptbild
  let q = a.from('objekte').select('id, bild_url, bild_fehler, objekt_quellen(url, url_direkt, status)').is('bild_pfad', null);
  if (objektId !== null) { q = q.eq('id', objektId); }
  const { data, error } = await q.limit(200);
  if (error) { return json({ error: error.message }, 500); }

  const offen = (data as Zeile[]).filter((o) => {
    const hatDirektlink = o.objekt_quellen.some((x) => x.url_direkt && x.url !== null);
    if (!hatDirektlink && !o.bild_url) { return false; }
    if (objektId !== null) { return true; }
    if (o.bild_fehler === null) { return true; }
    return o.bild_url !== null && !o.bild_fehler.includes(o.bild_url);
  }).slice(0, limit);

  const ergebnis: { id: string; ok: boolean; info: string }[] = [];
  for (const o of offen) {
    const seiten = o.objekt_quellen.filter((x) => x.url_direkt && x.url !== null).map((x) => x.url as string);
    const fehler: string[] = [];
    let pfad: string | null = null;
    let quelle: string | null = null;
    if (o.bild_url) { quelle = o.bild_url; pfad = await sichern(o.bild_url, seiten.length > 0 ? seiten[0] : null, 'auto/' + o.id, fehler); }
    for (const seite of seiten) {
      if (pfad !== null) { break; }
      try {
        const r = await holen(seite, null);
        if (!r.ok) { fehler.push('Seite ' + r.status + ' ' + seite); continue; }
        const bild = metaBild(await r.text(), r.url || seite);
        if (bild === null) { fehler.push('kein og:image ' + seite); continue; }
        quelle = bild;
        pfad = await sichern(bild, seite, 'auto/' + o.id, fehler);
      } catch (e) { fehler.push('Seite nicht erreichbar ' + seite + ' (' + String(e) + ')'); }
    }
    if (pfad !== null) {
      await a.from('objekte').update({ bild_pfad: pfad, bild_url: o.bild_url || quelle, bild_fehler: null }).eq('id', o.id);
      // Hauptbild auch als erstes Galeriebild führen
      if (quelle !== null) {
        await a.from('objekt_bilder').upsert({ objekt_id: o.id, quelle_url: quelle, pfad, sort: 0, fehler: null }, { onConflict: 'objekt_id,quelle_url' });
      }
    } else {
      const text = (fehler.join('; ') || 'kein Direktlink und keine Bild-URL') + (o.bild_url ? ' [' + o.bild_url + ']' : '');
      await a.from('objekte').update({ bild_fehler: text.slice(0, 1000) }).eq('id', o.id);
    }
    ergebnis.push({ id: o.id, ok: pfad !== null, info: pfad !== null ? 'gesichert' : fehler.join('; ').slice(0, 300) });
  }

  // ---------------------------------------------------------------- Galerie
  let g = a.from('objekt_bilder').select('id, objekt_id, quelle_url, fehler, objekte(objekt_quellen(url, url_direkt, status))').is('pfad', null).is('fehler', null).order('sort');
  if (objektId !== null) { g = g.eq('objekt_id', objektId); }
  const gal = await g.limit(limit * 2);
  const galerie: { id: string; ok: boolean; info: string }[] = [];
  for (const bild of ((gal.data || []) as unknown as Galerie[])) {
    const fehler: string[] = [];
    const quellen = bild.objekte !== null ? bild.objekte.objekt_quellen : [];
    const referer = quellen.filter((x) => x.url_direkt && x.url !== null).map((x) => x.url as string)[0] || null;
    const pfad = await sichern(bild.quelle_url, referer, 'galerie/' + bild.objekt_id + '/' + bild.id, fehler);
    if (pfad !== null) {
      await a.from('objekt_bilder').update({ pfad, fehler: null }).eq('id', bild.id);
    } else {
      await a.from('objekt_bilder').update({ fehler: fehler.join('; ').slice(0, 500) }).eq('id', bild.id);
    }
    galerie.push({ id: bild.id, ok: pfad !== null, info: pfad !== null ? 'gesichert' : fehler.join('; ').slice(0, 200) });
  }

  return json({
    geprueft: ergebnis.length,
    gesichert: ergebnis.filter((e) => e.ok).length,
    galerie_geprueft: galerie.length,
    galerie_gesichert: galerie.filter((e) => e.ok).length,
    ergebnis,
    galerie,
  });
});

// Edge Function: Web Push an die Abos in push_abos.
// Body: { titel, text, url?, user_ids?: uuid[] | null (null = alle), tag? }
// Aufruf aus SQL: select public.push_senden('Titel', 'Text', '/inserate/<id>', array['<user uuid>']::uuid[]);
import webpush from 'npm:web-push@3.6.7';
import { admin, berechtigt, cors, geheimnis, json, leseBody } from './auth.ts';

interface Abo { endpoint: string; user_id: string; p256dh: string; auth: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: cors }); }
  const a = admin();
  const b = await berechtigt(req, a);
  if (!b.ok) { return json({ error: 'nicht berechtigt' }, 401); }
  const body = await leseBody(req);

  const titel = typeof body.titel === 'string' ? body.titel : 'PRimmo';
  const text = typeof body.text === 'string' ? body.text : '';
  const url = typeof body.url === 'string' && body.url !== '' ? body.url : '/';
  const tag = typeof body.tag === 'string' ? body.tag : undefined;
  let userIds: string[] | null = null;
  if (Array.isArray(body.user_ids)) { userIds = (body.user_ids as unknown[]).filter((x) => typeof x === 'string') as string[]; }
  if (userIds !== null && userIds.length === 0) { userIds = null; }

  const { data: konfig } = await a.from('konfig').select('wert').eq('key', 'vapid_public').maybeSingle();
  const pub = konfig !== null ? (konfig as { wert: string }).wert : null;
  const priv = await geheimnis(a, 'vapid_private');
  if (pub === null || priv === null) { return json({ error: 'VAPID-Schlüssel fehlen (konfig.vapid_public / vault vapid_private)' }, 500); }
  webpush.setVapidDetails('mailto:remo.semm@gmail.com', pub, priv);

  let q = a.from('push_abos').select('endpoint, user_id, p256dh, auth');
  if (userIds !== null) { q = q.in('user_id', userIds); }
  const { data: abos, error } = await q;
  if (error) { return json({ error: error.message }, 500); }

  const payload = JSON.stringify({ titel, text, url, tag });
  let ok = 0; let weg = 0; let fehler = 0;
  const details: string[] = [];
  for (const abo of ((abos || []) as Abo[])) {
    try {
      await webpush.sendNotification({ endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } }, payload, { TTL: 86400 });
      ok++;
      await a.from('push_abos').update({ zuletzt_ok: new Date().toISOString(), fehler: null }).eq('endpoint', abo.endpoint);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        weg++;
        await a.from('push_abos').delete().eq('endpoint', abo.endpoint);
      } else {
        fehler++;
        details.push(String(status) + ' ' + String((e as Error).message).slice(0, 120));
        await a.from('push_abos').update({ fehler: String((e as Error).message).slice(0, 300) }).eq('endpoint', abo.endpoint);
      }
    }
  }
  return json({ gesendet: ok, entfernt: weg, fehler, details, empfaenger: (abos || []).length });
});

// Gemeinsame Helfer für die Edge Functions: Admin-Client, CORS, Berechtigung.
// Berechtigt ist, wer (a) den App-Secret-Header mitschickt (Aufrufe aus SQL via pg_net)
// oder (b) ein gültiges Supabase-Session-Token hat (Aufrufe aus der App).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function admin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL') as string, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string, { auth: { persistSession: false } });
}

export async function geheimnis(a: SupabaseClient, name: string): Promise<string | null> {
  const { data, error } = await a.rpc('geheimnis', { p_name: name });
  if (error || typeof data !== 'string' || data === '') { return null; }
  return data;
}

export async function berechtigt(req: Request, a: SupabaseClient): Promise<{ ok: boolean; userId: string | null }> {
  const secret = req.headers.get('x-app-secret');
  if (secret !== null && secret !== '') {
    const soll = await geheimnis(a, 'app_secret');
    if (soll !== null && soll === secret) { return { ok: true, userId: null }; }
  }
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token === '') { return { ok: false, userId: null }; }
  const { data, error } = await a.auth.getUser(token);
  if (error || !data.user) { return { ok: false, userId: null }; }
  return { ok: true, userId: data.user.id };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

export async function leseBody(req: Request): Promise<Record<string, unknown>> {
  if (req.method === 'POST') {
    try { const b = await req.json(); return (b && typeof b === 'object') ? b as Record<string, unknown> : {}; } catch { return {}; }
  }
  const u = new URL(req.url);
  const o: Record<string, unknown> = {};
  u.searchParams.forEach((v, k) => { o[k] = v; });
  return o;
}

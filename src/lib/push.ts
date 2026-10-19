import { supabase } from './supabase';

function b64ToUint8(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(s);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) { out[i] = raw.charCodeAt(i); }
  return out;
}

export function pushMoeglich(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function pushStatus(): Promise<'aktiv' | 'aus' | 'blockiert' | 'unmoeglich'> {
  if (!pushMoeglich()) { return 'unmoeglich'; }
  if (Notification.permission === 'denied') { return 'blockiert'; }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) { return 'aus'; }
  const sub = await reg.pushManager.getSubscription();
  return sub !== null ? 'aktiv' : 'aus';
}

/** Push aktivieren: Berechtigung holen, Abo erstellen, in push_abos speichern. */
export async function pushAktivieren(userId: string): Promise<string | null> {
  if (!pushMoeglich()) { return 'Dieser Browser unterstützt keine Push-Benachrichtigungen.'; }
  const { data } = await supabase.from('konfig').select('wert').eq('key', 'vapid_public').maybeSingle();
  if (data === null) { return 'VAPID-Schlüssel fehlt in konfig.'; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { return 'Benachrichtigungen wurden nicht erlaubt.'; }
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub === null) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8((data as { wert: string }).wert) });
  }
  const j = sub.toJSON();
  const keys = j.keys || {};
  const { error } = await supabase.from('push_abos').upsert({ endpoint: sub.endpoint, user_id: userId, p256dh: keys.p256dh || '', auth: keys.auth || '', user_agent: navigator.userAgent.slice(0, 200) });
  return error ? error.message : null;
}

export async function pushDeaktivieren(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) { return; }
  const sub = await reg.pushManager.getSubscription();
  if (sub === null) { return; }
  await supabase.from('push_abos').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

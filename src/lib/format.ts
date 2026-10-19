export function chf(n: number | null | undefined, withPrefix = false): string {
  if (n === null || n === undefined) { return withPrefix ? 'CHF auf Anfrage' : 'auf Anfrage'; }
  const s = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return withPrefix ? 'CHF ' + s : s;
}

export function pct(diff: number, base: number): string {
  if (!base) { return ''; }
  const p = (diff / base) * 100;
  return (p > 0 ? '+' : '') + p.toFixed(1) + ' %';
}

export function dateShort(iso: string | null | undefined): string {
  if (!iso) { return ''; }
  const d = new Date(iso);
  if (isNaN(d.getTime())) { return ''; }
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' });
}

export function dateLong(iso: string | null | undefined): string {
  if (!iso) { return ''; }
  const d = new Date(iso);
  if (isNaN(d.getTime())) { return ''; }
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) { return ''; }
  const d = new Date(iso);
  if (isNaN(d.getTime())) { return ''; }
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
}

export function relative(iso: string | null | undefined): string {
  if (!iso) { return ''; }
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days <= 0) { return 'heute'; }
  if (days === 1) { return 'gestern'; }
  return days + ' T';
}

export function isToday(iso: string | null | undefined): boolean {
  if (!iso) { return false; }
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export function dow(iso: string): string {
  return new Date(iso).toLocaleDateString('de-CH', { weekday: 'short' }).replace('.', '');
}

export function dayNum(iso: string): string {
  return String(new Date(iso).getDate());
}

export function bytes(n: number | null): string {
  if (n === null) { return ''; }
  if (n < 1024 * 1024) { return (n / 1024).toFixed(0) + ' KB'; }
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

export function typLabel(t: string): string {
  if (t === 'haus') { return 'Haus'; }
  if (t === 'wohnung') { return 'Wohnung'; }
  return 'Objekt';
}

export function statusLabel(s: string): string {
  const map: Record<string, string> = { aktiv: 'Aktiv am Markt', reserviert: 'Reserviert', verkauft: 'Verkauft', offline: 'Nicht mehr online', unbekannt: 'Status unbekannt' };
  return map[s] || s;
}

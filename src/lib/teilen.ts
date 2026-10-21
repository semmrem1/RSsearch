export type TeilenErgebnis = 'geteilt' | 'kopiert' | 'abgebrochen' | 'fehler';

export interface TeilenInhalt {
  titel: string;
  text?: string;
  /** App-Pfad, z.B. /inserate/<id> oder /radar?projekt=<id> */
  pfad: string;
}

/** Absolute URL für einen App-Pfad. */
export function appUrl(pfad: string): string {
  return window.location.origin + pfad;
}

/**
 * Teilt einen Link über das System-Share-Sheet (Handy) oder kopiert ihn in die Zwischenablage (Desktop).
 * Share-Sheet: WhatsApp, Mail, Nachrichten usw. Nur über https oder localhost verfügbar.
 */
export async function teilen(inhalt: TeilenInhalt): Promise<TeilenErgebnis> {
  const url = appUrl(inhalt.pfad);
  const daten: ShareData = { title: inhalt.titel, url };
  if (inhalt.text !== undefined && inhalt.text !== '') { daten.text = inhalt.text; }

  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean };
  const kannTeilen = typeof nav.share === 'function' && (typeof nav.canShare !== 'function' || nav.canShare(daten));
  if (kannTeilen && nav.share !== undefined) {
    try {
      await nav.share(daten);
      return 'geteilt';
    } catch (e) {
      // Nutzer hat das Share-Sheet geschlossen: kein Fehler, nichts weiter tun
      if (e instanceof Error && e.name === 'AbortError') { return 'abgebrochen'; }
      // Andere Fehler (z.B. Share-Sheet nicht erlaubt): auf Kopieren ausweichen
    }
  }
  return (await linkKopieren(url)) ? 'kopiert' : 'fehler';
}

async function linkKopieren(url: string): Promise<boolean> {
  if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
    try { await navigator.clipboard.writeText(url); return true; } catch { /* unten versuchen */ }
  }
  // Fallback für alte Browser: temporäres Textfeld
  try {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

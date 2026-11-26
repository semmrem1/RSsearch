// Edge Function: Domain-Radar der Neubau-Frühwarnung.
// Sucht in den öffentlichen Zertifikatslogs (Certificate Transparency, via crt.sh) nach neuen .ch-Domains,
// deren Name einen Ortsnamen der Wunsch-Gemeinden enthält (radar_gemeinden.domain_stichworte, fruehwarnung = true),
// z.B. ursinia-uster.ch. Neue Funde landen in public.domain_funde (status 'neu'); der tägliche Frühwarnungs-Lauf
// öffnet sie und entscheidet, ob es eine Neubau-Website ist.
// Body: { tage?: number (Standard 3, nur Zertifikate der letzten n Tage), trocken?: boolean (nichts schreiben) }
// Aufruf aus SQL: select public.domain_radar_abrufen();  (täglich per pg_cron, Migration 20261126_neubau_fruehwarnung.sql)
import { admin, berechtigt, cors, json, leseBody } from './auth.ts';

const CRT = 'https://crt.sh/';
const HDR = { 'User-Agent': 'PRimmo/1.0 (privater Neubau-Radar, 1 Abruf pro Tag)', Accept: 'application/json' };

// Offizielle Gemeinde-Domains und bekannte Seiten, die nie ein Neubauprojekt sind
const IGNORIEREN = new Set([
  'uster.ch', 'stadt-uster.ch', 'staefa.ch', 'rapperswil-jona.ch', 'freienbach.ch', 'pfaeffikon.ch', 'richterswil.ch',
  'waedenswil.ch', 'maennedorf.ch', 'meilen.ch', 'stadtuster.ch', 'jona.ch', 'rapperswil.ch', 'ost.ch', 'hsr.ch',
]);
// Wörter, die ein Stichwort nur zufällig enthalten (z.B. «cluster» enthält «uster»)
const FALSCH = /(cluster|buster|booster|rooster|holster|bolster|lobster|mobster|toaster|coaster|roaster|poster|jonas|jonathan)/;

interface Gemeinde { name: string; domain_stichworte: string[] | null }
interface CrtZeile { name_value: string; not_before: string; entry_timestamp: string | null }
interface Fund { domain: string; stichwort: string; gemeinde: string; ab: string }

async function holen(url: string, ms: number): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { headers: HDR, signal: c.signal }); } finally { clearTimeout(t); }
}

// Registrierbare .ch-Domain (zweite Ebene), sonst null
function registrierbar(name: string): string | null {
  const n = name.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
  if (!n.endsWith('.ch')) { return null; }
  const teile = n.split('.');
  if (teile.length < 2) { return null; }
  return teile.slice(-2).join('.');
}

// Passt das Stichwort als eigenes Wort oder als Wortanfang/-ende im Domainnamen?
function passt(domain: string, kw: string): boolean {
  const label = domain.replace(/\.ch$/, '');
  if (FALSCH.test(label)) { return false; }
  const woerter = label.split('-');
  return woerter.some((w) => w === kw || w.startsWith(kw) || (w.endsWith(kw) && w.length >= kw.length + 3));
}

function muster(kw: string): string[] {
  const m = [kw + '-%.ch', '%-' + kw + '.ch', kw + '%.ch'];
  if (kw.length >= 6) { m.push('%' + kw + '.ch'); }
  return m;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: cors }); }
  const a = admin();
  const b = await berechtigt(req, a);
  if (!b.ok) { return json({ error: 'nicht berechtigt' }, 401); }
  const body = await leseBody(req);
  const tage = typeof body.tage === 'number' ? body.tage : typeof body.tage === 'string' && /^\d+$/.test(body.tage) ? Number(body.tage) : 3;
  const trocken = body.trocken === true || body.trocken === 'true';
  const grenze = Date.now() - Math.max(1, Math.min(tage, 60)) * 86400000;
  const start = new Date().toISOString();

  const { data: gem, error: ge } = await a.from('radar_gemeinden').select('name, domain_stichworte').eq('aktiv', true).eq('fruehwarnung', true);
  if (ge) { return json({ error: ge.message }, 500); }
  const gemeinden = (gem || []) as Gemeinde[];

  // Stichwort -> Gemeinden (pfaeffikon gehört zu Freienbach und Pfäffikon ZH)
  const stich = new Map<string, string[]>();
  for (const g of gemeinden) {
    for (const kw of g.domain_stichworte || []) {
      const k = kw.toLowerCase().trim();
      if (k === '') { continue; }
      stich.set(k, (stich.get(k) || []).concat(g.name));
    }
  }

  const funde = new Map<string, Fund>();
  const info: string[] = [];
  let abfragen = 0; let fehler = 0;
  const auftraege: { kw: string; q: string }[] = [];
  for (const kw of stich.keys()) { for (const q of muster(kw)) { auftraege.push({ kw, q }); } }

  // Höchstens 3 Abfragen gleichzeitig, Gesamtzeit begrenzt (Edge Function max. 150 s)
  const ende = Date.now() + 120000;
  let i = 0;
  async function arbeiter() {
    while (i < auftraege.length && Date.now() < ende) {
      const { kw, q } = auftraege[i++];
      try {
        const r = await holen(CRT + '?q=' + encodeURIComponent(q) + '&output=json&exclude=expired', 30000);
        abfragen++;
        if (!r.ok) { fehler++; continue; }
        const zeilen = (await r.json()) as CrtZeile[];
        for (const z of zeilen) {
          const zeit = Date.parse((z.entry_timestamp || z.not_before) + 'Z');
          if (!(zeit >= grenze)) { continue; }
          for (const name of (z.name_value || '').split('\n')) {
            const d = registrierbar(name);
            if (d === null || IGNORIEREN.has(d) || !passt(d, kw)) { continue; }
            const alt = funde.get(d);
            const ab = new Date(Date.parse(z.not_before + 'Z')).toISOString();
            if (alt === undefined || ab < alt.ab) { funde.set(d, { domain: d, stichwort: kw, gemeinde: (stich.get(kw) || []).join(' / '), ab }); }
          }
        }
      } catch (_e) { fehler++; }
    }
  }
  await Promise.all([arbeiter(), arbeiter(), arbeiter()]);
  const unvollstaendig = i < auftraege.length;
  info.push(abfragen + ' von ' + auftraege.length + ' Abfragen' + (fehler > 0 ? ', ' + fehler + ' Fehler' : '') + (unvollstaendig ? ', Zeitlimit erreicht' : ''));

  // Schon bekannte Domains nicht erneut melden
  const liste = [...funde.values()];
  let neu: Fund[] = liste;
  if (liste.length > 0) {
    const { data: bekannt } = await a.from('domain_funde').select('domain').in('domain', liste.map((f) => f.domain));
    const set = new Set(((bekannt || []) as { domain: string }[]).map((x) => x.domain));
    neu = liste.filter((f) => !set.has(f.domain));
  }
  if (!trocken && neu.length > 0) {
    const { error } = await a.from('domain_funde').upsert(neu.map((f) => ({ domain: f.domain, stichwort: f.stichwort, gemeinde: f.gemeinde, zertifikat_ab: f.ab })), { onConflict: 'domain', ignoreDuplicates: true });
    if (error) { info.push('Speichern: ' + error.message); }
  }
  const ganzFehler = abfragen === 0 || fehler === abfragen;
  if (!trocken) {
    await a.from('lauf_protokoll').insert({
      makler: 'Domain-Radar', gestartet_am: start, geprueft: !ganzFehler, anzahl_inserate: liste.length, neue: neu.length, geaendert: 0,
      fehler: ganzFehler ? 'crt.sh nicht erreichbar (' + fehler + ' Fehler)' : unvollstaendig ? 'Zeitlimit: ' + info[0] : null, beendet_am: new Date().toISOString(),
    });
  }
  return json({ ok: !ganzFehler, tage, gefunden: liste.length, neu: neu.map((f) => f.domain), info });
});

// Edge Function: Domain-Radar der Neubau-Frühwarnung.
// Sucht in den öffentlichen Zertifikatslogs (Certificate Transparency, öffentliche Postgres-Schnittstelle von crt.sh,
// guest@crt.sh:5432/certwatch, Index auf dem umgekehrten Namen) nach neuen .ch-Domains, die auf einen Ortsnamen enden
// (z.B. ursinia-uster.ch, wohnen-in-meilen.ch; der Volltextindex findet nur Firmenzertifikate wie «Spital Uster»),
// Stichworte aus radar_gemeinden.domain_stichworte (fruehwarnung = true). Neue Funde landen in public.domain_funde (status 'neu'); der tägliche Frühwarnungs-Lauf
// öffnet sie und entscheidet, ob es eine Neubau-Website ist.
// Body: { tage?: number (Standard 3, nur Zertifikate der letzten n Tage), trocken?: boolean (nichts schreiben),
//         stichworte?: string[] (nur diese Stichworte, für Tests) }
// Aufruf aus SQL: select public.domain_radar_abrufen();  (täglich per pg_cron, Migration 20261126_neubau_fruehwarnung.sql)
import { admin, berechtigt, cors, json, leseBody } from './auth.ts';
import postgres from 'npm:postgres@3.4.4';

// Offizielle Gemeinde-Domains und bekannte Seiten, die nie ein Neubauprojekt sind
const IGNORIEREN = new Set([
  'uster.ch', 'stadt-uster.ch', 'staefa.ch', 'rapperswil-jona.ch', 'freienbach.ch', 'pfaeffikon.ch', 'richterswil.ch',
  'waedenswil.ch', 'maennedorf.ch', 'meilen.ch', 'stadtuster.ch', 'jona.ch', 'rapperswil.ch', 'ost.ch', 'hsr.ch',
]);
// Wörter, die ein Stichwort nur zufällig enthalten (z.B. «cluster» enthält «uster»)
const FALSCH = /(cluster|buster|booster|rooster|holster|bolster|lobster|mobster|toaster|coaster|roaster|poster|jonas|jonathan)/;

interface Gemeinde { name: string; domain_stichworte: string[] | null }
interface Fund { domain: string; stichwort: string; gemeinde: string; ab: string }

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: cors }); }
  const a = admin();
  const b = await berechtigt(req, a);
  if (!b.ok) { return json({ error: 'nicht berechtigt' }, 401); }
  const body = await leseBody(req);
  const tage = typeof body.tage === 'number' ? body.tage : typeof body.tage === 'string' && /^\d+$/.test(body.tage) ? Number(body.tage) : 3;
  const trocken = body.trocken === true || body.trocken === 'true';
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

  if (Array.isArray(body.stichworte)) {
    const nur = new Set((body.stichworte as unknown[]).map((x) => String(x).toLowerCase().trim()));
    for (const k of [...stich.keys()]) { if (!nur.has(k)) { stich.delete(k); } }
  }

  const funde = new Map<string, Fund>();
  const info: string[] = [];
  let abfragen = 0; let fehler = 0; const fehlerArt = new Map<string, number>();
  const kws = [...stich.keys()];

  // Ein Stichwort pro Abfrage, nacheinander (crt.sh erlaubt Gäste nur wenige Verbindungen), Gesamtzeit begrenzt
  // (pg_net wartet 120 s, Edge Function max. 150 s). Die HTTP-Suche von crt.sh taugt nicht: «%» am Anfang ist
  // nicht erlaubt, Teilwort-Muster laufen in Timeouts, ohne «%» findet sie nur exakte Namen.
  const ende = Date.now() + 85000;
  let erledigt = 0;
  let sql: ReturnType<typeof postgres> | null = null;
  try {
    sql = postgres({ host: 'crt.sh', port: 5432, database: 'certwatch', username: 'guest', ssl: false, max: 1, prepare: false, connect_timeout: 15, idle_timeout: 5 });
    for (const kw of kws) {
      if (ende - Date.now() < 8000) { break; }
      abfragen++;
      try {
        // crt.sh nutzt Statement-Pooling: keine Transaktionen und kein SET, deshalb Zeitlimit auf Client-Seite
        const ms = Math.max(5000, Math.min(25000, ende - Date.now() - 2000));
        const abfrage = sql.unsafe(
          "select distinct lower(cai.name_value) as name, x509_notbefore(cai.certificate) as nb " +
          "from certificate_and_identities cai " +
          "where reverse(lower(cai.name_value)) like reverse('%' || $1 || '.ch') " +
          "and x509_notbefore(cai.certificate) >= now() - ($2 || ' days')::interval " +
          "limit 3000", [kw, String(Math.max(1, Math.min(tage, 400)))]);
        let uhr: number | undefined;
        const zeitlimit = new Promise<never>((_, nein) => { uhr = setTimeout(() => nein(new Error('Timeout ' + Math.round(ms / 1000) + ' s')), ms); });
        let zeilen: { name: string; nb: Date | string }[];
        try { zeilen = (await Promise.race([abfrage, zeitlimit])) as unknown as { name: string; nb: Date | string }[]; }
        finally { clearTimeout(uhr); }
        erledigt++;
        for (const z of zeilen) {
          const d = registrierbar(z.name);
          if (d === null || IGNORIEREN.has(d) || !passt(d, kw)) { continue; }
          const ab = new Date(z.nb).toISOString();
          const alt = funde.get(d);
          if (alt === undefined || ab < alt.ab) { funde.set(d, { domain: d, stichwort: kw, gemeinde: (stich.get(kw) || []).join(' / '), ab }); }
        }
      } catch (e) {
        fehler++;
        const k = e instanceof Error ? e.message.slice(0, 80) : 'Fehler';
        fehlerArt.set(k, (fehlerArt.get(k) || 0) + 1);
      }
    }
  } catch (e) {
    fehler++; abfragen = Math.max(abfragen, 1);
    fehlerArt.set('Verbindung: ' + (e instanceof Error ? e.message.slice(0, 80) : 'Fehler'), 1);
  } finally {
    if (sql !== null) { try { await sql.end({ timeout: 2 }); } catch (_e) { /* egal */ } }
  }
  const unvollstaendig = erledigt + fehler < kws.length;
  info.push(erledigt + ' von ' + kws.length + ' Stichworten abgefragt' + (fehler > 0 ? ', ' + fehler + ' Fehler (' + [...fehlerArt.entries()].map(([k, n]) => k + ': ' + n).join(', ') + ')' : '') + (unvollstaendig ? ', Zeitlimit erreicht' : ''));

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
      fehler: ganzFehler ? 'crt.sh nicht erreichbar: ' + info[0] : unvollstaendig ? 'Zeitlimit: ' + info[0] : null, beendet_am: new Date().toISOString(),
    });
  }
  return json({ ok: !ganzFehler, tage, gefunden: liste.length, neu: neu.map((f) => f.domain), info });
});

// Edge Function: Neubau-Radar, Baugesuche aus Amtsblatt ZH, Amtsblatt SZ und Publikationen SG holen.
// Body: { seit?: 'YYYY-MM-DD', bis?: 'YYYY-MM-DD', quellen?: ['ZH','SZ','SG'], push?: boolean (Standard true), protokoll?: boolean (Standard true; false für Nachladen),
//         nur_einstufen?: boolean (kein Abruf, nur offene Einstufungen per Claude), limit?: number (Einstufungen pro Aufruf, Standard 60) }
// Einstufung: jedes Gesuch bekommt beim Import eine Regel-Einstufung (SQL), danach präzisiert Claude (Vault anthropic_api_key)
// Kategorie, Bauherr-Typ, Vermarktung, Einstufung (fokus/pruefen/irrelevant) und Begründung. Push nur für «fokus».
// Ohne seit: ab public.radar_seit(<Quelle>) (letzter erfolgreicher Abruf minus 3 Tage, sonst 365 Tage zurück).
// ZH und SZ kommen über die Amtsblattportal-API auf www.amtsblatt.zh.ch (amtsblatt.sz.ch ist aus der Cloud nicht erreichbar,
// die SZ-Rubrik BA-SZ05 ist über den ZH-Host aber lesbar). SG über publikationen.sg.ch (HTML).
// Privatpersonen werden nicht gespeichert: Bauherrschaft/Projektverfasser nur bei Firmen und Körperschaften.
// Aufruf aus SQL: select public.baugesuche_abrufen();  (täglich per pg_cron, siehe Migration 20261020_neubau_radar_abruf.sql)
import { admin, berechtigt, cors, geheimnis, json, leseBody } from './auth.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const ZH = 'https://www.amtsblatt.zh.ch';
const SG = 'https://publikationen.sg.ch';
const HDR = { 'User-Agent': 'PRimmo/1.0 (privater Neubau-Radar, 1 Abruf pro Tag)', Accept: 'application/json' };

interface Gemeinde { name: string; kanton: string; bfs_nr: number | null }
interface Zeile {
  quelle: string; externe_id: string; publ_nr: string | null; publiziert_am: string; frist_bis: string | null;
  gemeinde: string; kanton: string; ortsteil: string | null; adresse: string; beschreibung: string;
  bauherr: string | null; bauherr_typ: string; projektverfasser: string | null; url: string;
}
interface Meta {
  id: string; publicationNumber: string; publicationDate: string; title: { de?: string } | null;
  registrationOffice: { municipalityId: string | null; displayName: string | null; town: string | null } | null;
}

// ---------- Text-Helfer ----------
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ss', eacute: 'é', egrave: 'è', agrave: 'à', ecirc: 'ê', ccedil: 'ç', laquo: '«', raquo: '»', ndash: '–', mdash: '–', rsquo: '’', lsquo: '‘', hellip: '…' };
function dekodiere(s: string): string {
  let t = s;
  for (let i = 0; i < 3; i++) {
    const n = t.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') { return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)); }
      return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
    });
    if (n === t) { break; }
    t = n;
  }
  return t;
}
function text(s: string | null | undefined): string {
  if (!s) { return ''; }
  let t = dekodiere(s).replace(/<[^>]+>/g, ' ');
  t = dekodiere(t).replace(/<[^>]+>/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}
function inner(xml: string, tag: string): string {
  const m = xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>'));
  return m ? m[1] : '';
}
function alle(xml: string, tag: string): string[] {
  const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'g');
  const out: string[] = []; let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) { out.push(m[1]); }
  return out;
}
const FIRMA = /\b(ag|gmbh|sa|sàrl|genossenschaft|baugenossenschaft|stiftung|anlagestiftung|holding|immobilien|invest|real estate|pensionskasse|vorsorge|fonds|verein|kollektivgesellschaft|klg|& co|architekt|architekten|bau|partner|generalunternehm\w*|gemeinde|stadt|kanton|kirchgemeinde|schulgemeinde|korporation)\b/i;
function nurFirma(s: string | null | undefined): string | null {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t !== '' && FIRMA.test(t) ? t.slice(0, 160) : null;
}
// Bauherr-Typ aus einem Firmennamen (gleiche Logik wie public.bauherr_typ_aus_name)
function typAusName(p: string): string {
  if (/(politische gemeinde|\bgemeinde\b|\bstadt\b|\bkanton\b|schulgemeinde|kirchgemeinde|kirchenpflege|primarschul|sekundarschul|zweckverband|korporation|\bbezirk\b|eidgenossenschaft|\bsbb\b|armasuisse|wasserversorgung|elektrizitätswerk)/i.test(p)) { return 'oeffentlich'; }
  if (/(genossenschaft|stiftung|pensionskasse|vorsorge|anlagefonds|\bfonds\b|fondation|swiss life|\baxa\b|helvetia|baloise|mobiliar|\bbvk\b|\bubs\b)/i.test(p)) { return 'gemeinnuetzig'; }
  if (/(architekt|architektur|atelier|planung|\bplaner|raumfindung)/i.test(p)) { return 'architekt'; }
  if (/(immobilien|real estate|development|entwicklung|invest|holding|liegenschaft|wohnbau|generalunternehm|totalunternehm|promotion|projekt|properties|estate|\bbau\b|bau ag|bau gmbh|bauunternehm|holzbau|zimmerei|baupartner|residenz)/i.test(p)) { return 'entwickler'; }
  return 'firma';
}
// Aus den Namen der Bauherrschaft: gespeicherter Firmenname, Typ, Vertreter (Firma). Namen von Privatpersonen verlassen diese Funktion nie.
function bauherrInfo(namen: string[]): { bauherr: string | null; typ: string; vertreter: string | null } {
  const firmen: string[] = []; const vertreter: string[] = []; let privat = false;
  for (const roh of namen) {
    const t = (roh || '').replace(/\s+/g, ' ').trim();
    if (t === '') { continue; }
    const teile = t.split(/,?\s*(?:vertreten durch|vertr\.\s*durch|c\/o|p\.\s*a\.)\s*/i);
    const haupt = teile[0].trim();
    const f = nurFirma(haupt);
    if (f !== null) { firmen.push(f); } else if (haupt !== '') { privat = true; }
    for (const v of teile.slice(1)) { const fv = nurFirma(v); if (fv !== null) { vertreter.push(fv); } }
  }
  const typ = firmen.length > 0 ? typAusName(firmen.join(' ')) : privat ? 'privat' : 'unbekannt';
  return { bauherr: firmen.length > 0 ? firmen.join(', ').slice(0, 160) : null, typ, vertreter: vertreter.length > 0 ? vertreter.join(', ').slice(0, 160) : null };
}
const WOHNEN = /(neubau|ersatzneubau|neuerstellung|überbauung|gestaltungsplan|sondernutzungsplan|überbauungsplan|mehrfamilien|\bmfh\b|reihen|doppeleinfamilien|doppelhaus|doppelhäuser|terrassenh|wohnungen|wohneinheiten|einfamilienh|wohnhaus|wohnhäuser|stockwerkeigentum)/i;
function plusTage(iso: string, n: number): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
function chDatum(s: string): string | null {
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : null;
}
async function holen(url: string, ms = 20000): Promise<Response> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { headers: HDR, signal: ctl.signal }); } finally { clearTimeout(t); }
}
async function parallel<T>(items: T[], n: number, f: (x: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += n) { await Promise.all(items.slice(i, i + n).map(f)); }
}

// ---------- Gemeinde-Zuordnung ----------
function zuordnung(gemeinden: Gemeinde[]) {
  const norm = (s: string | null | undefined) => (s || '').toLowerCase()
    .replace(/\((zh|sz|sg)\)/g, ' ').replace(/\b(zh|sz|sg)\b/g, ' ')
    .replace(/^(politische\s+)?(gemeinde|stadt|bezirk)\s+/, '').replace(/\s+-\s+.*$/, '').replace(/,.*$/, '')
    .replace(/b\.\s*zürich/g, '').replace(/\s+/g, ' ').trim();
  const alias: Record<string, string> = { 'hirzel': 'horgen', 'zollikerberg': 'zollikon', 'schindellegi': 'feusisberg', 'bäch': 'freienbach', 'wilen b. wollerau': 'freienbach', 'pfäffikon sz': 'freienbach', 'siebnen': 'schübelbach', 'buttikon': 'schübelbach', 'samstagern': 'richterswil', 'au': 'wädenswil', 'uerikon': 'stäfa', 'feldbach': 'hombrechtikon', 'jona': 'rapperswil-jona', 'rapperswil': 'rapperswil-jona', 'nuolen': 'wangen', 'ermenswil': 'eschenbach', 'goldingen': 'eschenbach' };
  const byBfs = new Map<string, string>(); const byName = new Map<string, string>();
  for (const g of gemeinden) {
    if (g.bfs_nr !== null) { byBfs.set(String(g.bfs_nr), g.name); }
    byName.set(norm(g.name), g.name);
  }
  return (bfs: string | null | undefined, ...namen: (string | null | undefined)[]): string | null => {
    if (bfs && byBfs.has(String(bfs))) { return byBfs.get(String(bfs)) as string; }
    for (const n of namen) {
      let k = norm(n); if (k === '') { continue; }
      if (alias[k]) { k = alias[k]; }
      if (byName.has(k)) { return byName.get(k) as string; }
      for (const [nk, nv] of byName) { if (k.startsWith(nk + ' ') || nk.startsWith(k + ' ')) { return nv; } }
    }
    return null;
  };
}

// ---------- Amtsblattportal (ZH und SZ) ----------
async function amtsblatt(kanton: 'ZH' | 'SZ', seit: string, bis: string | null, finde: ReturnType<typeof zuordnung>, info: string[]): Promise<Zeile[]> {
  const quelle = kanton === 'ZH' ? 'Amtsblatt ZH' : 'Amtsblatt SZ';
  const linkBasis = kanton === 'ZH' ? 'https://www.amtsblatt.zh.ch' : 'https://amtsblatt.sz.ch';
  const filter = kanton === 'ZH' ? 'rubrics=BP-ZH' : 'subRubrics=BA-SZ05';
  const liste: Meta[] = [];
  for (let p = 0; p < 150; p++) {
    let u = ZH + '/api/v1/publications?publicationStates=PUBLISHED&' + filter + '&publicationDate.start=' + seit + '&pageRequest.size=100&pageRequest.page=' + p;
    if (bis !== null) { u += '&publicationDate.end=' + bis; }
    const r = await holen(u);
    if (!r.ok) { throw new Error(quelle + ': Liste HTTP ' + r.status); }
    const j = await r.json() as { content: { meta: Meta }[] };
    for (const c of j.content) { liste.push(c.meta); }
    if (j.content.length < 100) { break; }
  }
  const kandidaten = liste.filter((m) => {
    if (bis !== null && m.publicationDate.slice(0, 10) > bis) { return false; }
    const o = m.registrationOffice || { municipalityId: null, displayName: null, town: null };
    return finde(o.municipalityId, o.displayName, o.town) !== null;
  });
  const out: Zeile[] = []; let fehler = 0;
  await parallel(kandidaten, 8, async (m) => {
    try {
      const r = await holen(ZH + '/api/v1/publications/' + m.id + '/xml');
      if (!r.ok) { fehler++; return; }
      const xml = await r.text();
      const c = inner(xml, 'content');
      const o = m.registrationOffice || { municipalityId: null, displayName: null, town: null };
      const titel = (m.title && m.title.de) ? m.title.de : '';
      const pub = m.publicationDate.slice(0, 10);
      let gemeinde: string | null; let beschreibung = ''; let adresse = ''; let ortsteil: string | null = null;
      let bauherr: string | null = null; let bauherrTyp = 'unbekannt'; let verfasser: string | null = null; let frist: string | null = null;
      if (kanton === 'ZH') {
        const mun = inner(inner(c, 'localization'), 'municipalityId');
        gemeinde = finde(text(inner(mun, 'key')), text(inner(inner(mun, 'term'), 'de')), o.displayName, o.town);
        if (gemeinde === null) { return; }
        beschreibung = text(inner(c, 'projectDescription'));
        const a = inner(inner(c, 'projectLocation'), 'address');
        adresse = (text(inner(a, 'street')) + ' ' + text(inner(a, 'houseNumber'))).trim();
        ortsteil = text(inner(a, 'town')) || null;
        const namen = (block: string) => [...alle(block, 'person'), ...alle(block, 'company')].map((p) => ['companyName', 'officialName', 'prename', 'name'].map((t) => text(inner(p, t))).filter(Boolean).join(' '));
        const bi = bauherrInfo(namen(inner(c, 'buildingContractor')));
        bauherr = bi.bauherr; bauherrTyp = bi.typ;
        verfasser = [...namen(inner(c, 'projectFramer')), ...namen(inner(c, 'delegation'))].map(nurFirma).filter(Boolean).join(', ') || bi.vertreter;
        const ed = text(inner(c, 'entryDeadline'));
        frist = /^\d{4}-\d\d-\d\d/.test(ed) ? ed.slice(0, 10) : null;
      } else {
        gemeinde = finde(o.municipalityId, o.displayName, o.town);
        if (gemeinde === null) { return; }
        const el: Record<string, string> = {};
        for (const e of alle(c, 'element')) { const k = text(inner(e, 'key')); if (k !== '' && !(k in el)) { el[k] = e; } }
        const wert = (k: string) => { const e = el[k]; if (!e) { return ''; } const v = inner(e, 'valueRichText') || inner(e, 'valueText') || inner(e, 'subject'); return text(inner(v, 'de') || v); };
        adresse = wert('constructionProjectTitle');
        const roh = wert('projectDescription');
        const bo = roh.match(/Bauobjekt:\s*([\s\S]*?)(?:,\s*KTN\b|$)/i);
        beschreibung = (bo ? bo[1] : roh).replace(/Das Baugesuch liegt zur Einsicht auf[\s\S]*$/i, '').trim();
        const zone = roh.match(/^(Innerhalb|Ausserhalb) Bauzone/i);
        if (zone) { beschreibung = beschreibung + ' (' + zone[0] + ')'; }
        const bc = el.buildingContractor ? text(inner(el.buildingContractor, 'officialName') || inner(el.buildingContractor, 'name')) : '';
        const bi = bauherrInfo([bc]);
        bauherr = bi.bauherr; bauherrTyp = bi.typ;
        const pv = roh.match(/Projektverfasser(?:in)?:\s*([^,;]+)/i); verfasser = pv ? nurFirma(pv[1]) : bi.vertreter;
      }
      if (!WOHNEN.test(beschreibung + ' ' + titel)) { return; }
      out.push({
        quelle, externe_id: m.id, publ_nr: m.publicationNumber || null, publiziert_am: pub, frist_bis: frist || plusTage(pub, 20),
        gemeinde, kanton, ortsteil, adresse: adresse || text(titel.replace(/^[^:]*:\s*/, '')), beschreibung: beschreibung.slice(0, 800),
        bauherr, bauherr_typ: bauherrTyp, projektverfasser: verfasser, url: linkBasis + '/#!/search/publications/detail/' + m.id,
      });
    } catch (_e) { fehler++; }
  });
  info.push(quelle + ': ' + liste.length + ' Publikationen seit ' + seit + ', ' + kandidaten.length + ' in Radar-Gemeinden, ' + out.length + ' Wohnbau-Treffer' + (fehler > 0 ? ', ' + fehler + ' Fehler' : ''));
  if (kandidaten.length > 0 && fehler === kandidaten.length) { throw new Error(quelle + ': keine Publikation lesbar'); }
  return out;
}

// ---------- Publikationen SG ----------
async function stGallen(gemeinden: Gemeinde[], seit: string, info: string[]): Promise<Zeile[]> {
  const out: Zeile[] = []; let gelesen = 0; let fehler = 0;
  for (const g of gemeinden.filter((x) => x.kanton === 'SG')) {
    const suche = g.name.replace(/\s+SG$/, '');
    const u = SG + '/amtliche-publikationen/?searchQuery=' + encodeURIComponent(suche) + '&timerange%5Btype%5D=4&filter%5Bcategory%5D%5B%5D=172%2C180&sortorder=1';
    let html = '';
    try { const r = await holen(u, 30000); if (!r.ok) { fehler++; continue; } html = await r.text(); } catch (_e) { fehler++; continue; }
    const teile = html.split('publication-list__item--publication').slice(1);
    for (const t of teile) {
      const link = t.match(/href="(?:https:\/\/publikationen\.sg\.ch)?(\/ekab\/([\d.]+)\/publikation\/)"/);
      if (!link) { continue; }
      const kurz = text(t.slice(0, 4000));
      const stelle = (kurz.match(/Stelle:\s*(.*?)\s+Rubrik:/) || [])[1] || '';
      const gemeinde = zuordnung([g])(null, stelle);
      if (gemeinde === null) { continue; }
      const pub = chDatum(kurz) || '';
      if (pub === '' || pub < seit) { continue; }
      const titel = (kurz.match(/\d{2}\.\d{2}\.\d{4}\s+(?:Frist[^A-Z]*?(?:abgelaufen|\d{2}\.\d{2}\.\d{4})\s+)?(.*?)\s+Publ\.-Nr\./) || [])[1] || '';
      if (!/(bauanzeige|baugesuch|planauflage|sondernutzungsplan|überbauungsplan|gestaltungsplan)/i.test(titel + ' ' + kurz.slice(0, 600))) { continue; }
      let detail = '';
      try { const r = await holen(SG + link[1], 30000); if (r.ok) { detail = text(await r.text()); gelesen++; } } catch (_e) { fehler++; }
      const quelltext = detail !== '' ? detail : kurz;
      const feld = (name: string, bis: string) => { const m = quelltext.match(new RegExp(name + '\\s+(.*?)\\s+(?:' + bis + ')')); return m ? m[1].trim() : ''; };
      let beschreibung = feld('Bauvorhaben', 'Standort|Wer ein|Einsprache|Gesuchsteller|$');
      if (beschreibung === '') { beschreibung = titel + '. ' + (quelltext.match(/Publ\.-Nr\.:[\s\S]*?Rubrik:[^.]*?\s(.{0,500})/) || ['', ''])[1]; }
      const standort = feld('Standort', 'Wer ein|Einsprache|Gesuchsteller|Rechtliche|$');
      const adr = (standort.match(/(?:Grundstück[^,]*,\s*)?([^,]+?\s\d+[a-z]?)\b/) || [])[1] || titel.replace(/^(Bauanzeige|Baugesuch)\s*/i, '');
      const frist = chDatum((quelltext.match(/bis zum\s+(\d{1,2}\.\d{1,2}\.\d{4})/) || ['', ''])[1] || '');
      if (!WOHNEN.test(beschreibung + ' ' + titel)) { continue; }
      const sgBi = bauherrInfo([feld('Gesuchsteller', 'Planverfasser|Bauvorhaben|Grundeigent')]);
      out.push({
        quelle: 'Publikationen SG', externe_id: link[2], publ_nr: link[2], publiziert_am: pub, frist_bis: frist,
        gemeinde, kanton: 'SG', ortsteil: null, adresse: adr.trim().slice(0, 160), beschreibung: beschreibung.slice(0, 800),
        bauherr: sgBi.bauherr, bauherr_typ: sgBi.typ, projektverfasser: nurFirma(feld('Planverfasser', 'Bauvorhaben|Standort')) || sgBi.vertreter,
        url: SG + link[1],
      });
    }
  }
  info.push('Publikationen SG: ' + gelesen + ' Detailseiten gelesen, ' + out.length + ' Wohnbau-Treffer' + (fehler > 0 ? ', ' + fehler + ' Fehler' : ''));
  return out;
}

// ---------- Einstufung per Claude ----------
const KATEGORIEN = ['mfh', 'reihen', 'mehrere_efh', 'efh', 'ueberbauung', 'umbau', 'nebenbau', 'nicht_wohnen'];
const TYPEN = ['entwickler', 'architekt', 'privat', 'oeffentlich', 'gemeinnuetzig', 'firma', 'unbekannt'];
const VERMARKTUNG = ['verkauf', 'offen', 'miete', 'eigenbedarf'];
const EINSTUFUNG = ['fokus', 'pruefen', 'irrelevant'];
const MODELL_STANDARD = 'claude-sonnet-5-5';

interface Offen {
  id: string; quelle: string; externe_id: string; url: string | null; gemeinde: string | null; ortsteil: string | null; adresse: string | null;
  beschreibung: string | null; bauherr: string | null; bauherr_typ: string | null; projektverfasser: string | null; wohnungen: number | null;
}

const ANLEITUNG = `Du stufst Baugesuche aus Schweizer Amtsblättern für ein Paar ein, das rund um den Zürichsee Wohneigentum kaufen will (Haus oder Wohnung, ab 4.5 Zimmer, ab 120 m², bis CHF 2.5 Mio.). Ziel: Neubauten früh entdecken, die später zum Kauf angeboten werden.

Relevant sind Neubauten mit Wohnraum, den die Bauherrschaft anschliessend verkauft:
- Entwickler, Immobilienfirmen, Generalunternehmer, Bau- und Holzbaufirmen, Architekturbüros als Bauherr (auch einzelne Einfamilienhäuser, diese werden meist verkauft)
- Privatpersonen, die mehr bauen als sie selbst brauchen: mehrere Häuser, Doppel- oder Reihenhäuser, Mehrfamilienhaus nach Abbruch eines Einfamilienhauses (oft Stockwerkeigentum)
Nicht relevant:
- Umbau, Sanierung, Anbau, Aufstockung, Umnutzung, Erweiterung bestehender Gebäude
- Nebenbauten und Technik (Pool, Garage, Carport, Wärmepumpe, PV, Mauern, Umgebung, Tiny House)
- Gewerbe, Infrastruktur, Landwirtschaft, Schulen, Kliniken, öffentliche Bauten
- Mietwohnungsbau von Gemeinden, Genossenschaften, Stiftungen, Pensionskassen, Anlagefonds, Versicherungen
- ein einzelnes Einfamilienhaus einer Privatperson (Eigenbedarf)
Projektänderungen und Korrigenda zu einem relevanten Neubau bleiben relevant.

Felder pro Gesuch:
- kategorie: mfh (Mehrfamilienhaus, Wohnungen), reihen (Reihen-, Doppel-, Terrassenhäuser), mehrere_efh (mehrere Ein- oder Zweifamilienhäuser), efh (ein Ein- oder Zweifamilienhaus), ueberbauung (Gestaltungsplan, Arealüberbauung ohne Details), umbau, nebenbau, nicht_wohnen
- bauherr_typ: entwickler, architekt, privat, oeffentlich, gemeinnuetzig (Genossenschaft, Stiftung, Pensionskasse, Fonds, Versicherung), firma (andere Firma), unbekannt. «Privatperson» im Feld bauherr heisst privat; «nicht angegeben» heisst unbekannt, ausser der Text sagt mehr.
- vermarktung: verkauf (wahrscheinlich Eigentum zum Kauf), offen, miete, eigenbedarf; null bei umbau, nebenbau, nicht_wohnen
- einstufung: fokus (Neubau mit Wohnraum, Verkauf sehr wahrscheinlich), pruefen (Neubau mit Wohnraum, Verkauf möglich aber unklar, z.B. Privatperson baut Mehrfamilienhaus, unbekannte Firma, sehr grosse Überbauung eines Investors, Zweifamilienhaus), irrelevant (alles andere)
- einheiten: Anzahl Wohneinheiten oder Häuser, nur wenn im Text genannt, sonst null
- begruendung: ein kurzer Satz auf Deutsch, höchstens 110 Zeichen, Schweizer Rechtschreibung (ss statt ß), keine Gedankenstriche

Antworte ausschliesslich mit einem JSON-Array: [{"id": "...", "kategorie": "...", "bauherr_typ": "...", "vermarktung": "...", "einstufung": "...", "einheiten": null, "begruendung": "..."}]`;

async function claudeEinstufen(apiKey: string, modell: string, gesuche: Offen[]): Promise<Record<string, unknown>[]> {
  const eingabe = gesuche.map((g) => ({
    id: g.id, gemeinde: g.gemeinde, ortsteil: g.ortsteil, adresse: g.adresse, beschreibung: (g.beschreibung || '').slice(0, 600),
    bauherr: g.bauherr !== null ? g.bauherr : g.bauherr_typ === 'privat' ? 'Privatperson' : 'nicht angegeben',
    projektverfasser: g.projektverfasser, einheiten_aus_text: g.wohnungen,
  }));
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 90000);
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: modell, max_tokens: 6000, system: ANLEITUNG, messages: [{ role: 'user', content: 'Baugesuche:\n' + JSON.stringify(eingabe) }] }),
    });
  } finally { clearTimeout(t); }
  if (!res.ok) { throw new Error('Claude API ' + res.status + ': ' + (await res.text()).slice(0, 200)); }
  const antwort = await res.json() as { content: { type: string; text?: string }[] };
  const txt = antwort.content.filter((c) => c.type === 'text').map((c) => c.text || '').join('\n');
  const m = txt.match(/\[[\s\S]*\]/);
  if (m === null) { throw new Error('Claude: keine JSON-Antwort'); }
  const liste = JSON.parse(m[0]) as Record<string, unknown>[];
  const ids = new Set(gesuche.map((g) => g.id));
  const aus = (v: unknown, erlaubt: string[]) => (typeof v === 'string' && erlaubt.includes(v) ? v : null);
  const out: Record<string, unknown>[] = [];
  for (const r of liste) {
    if (typeof r.id !== 'string' || !ids.has(r.id)) { continue; }
    const kategorie = aus(r.kategorie, KATEGORIEN); const einstufung = aus(r.einstufung, EINSTUFUNG);
    if (kategorie === null || einstufung === null) { continue; }
    const einheiten = typeof r.einheiten === 'number' && isFinite(r.einheiten) && r.einheiten > 0 && r.einheiten < 1000 ? Math.round(r.einheiten) : null;
    const begr = typeof r.begruendung === 'string' ? r.begruendung.replace(/[—–]/g, ',').replace(/ß/g, 'ss').trim().slice(0, 160) : null;
    out.push({ id: r.id, kategorie, einstufung, bauherr_typ: aus(r.bauherr_typ, TYPEN), vermarktung: aus(r.vermarktung, VERMARKTUNG), einheiten, begruendung: begr, von: 'claude' });
  }
  return out;
}

// Bauherr-Typ für ältere Gesuche nachtragen: Publikation erneut lesen (ZH/SZ als XML, SG als HTML)
async function bauherrNachlesen(g: Offen): Promise<{ typ: string; vertreter: string | null } | null> {
  try {
    if (g.quelle === 'Amtsblatt ZH' || g.quelle === 'Amtsblatt SZ') {
      const r = await holen(ZH + '/api/v1/publications/' + g.externe_id + '/xml');
      if (!r.ok) { return null; }
      const c = inner(await r.text(), 'content');
      if (g.quelle === 'Amtsblatt ZH') {
        const blk = inner(c, 'buildingContractor');
        const namen = [...alle(blk, 'person'), ...alle(blk, 'company')].map((p) => ['companyName', 'officialName', 'prename', 'name'].map((t) => text(inner(p, t))).filter(Boolean).join(' '));
        const bi = bauherrInfo(namen); return { typ: bi.typ, vertreter: bi.vertreter };
      }
      let bc = '';
      for (const e of alle(c, 'element')) { if (text(inner(e, 'key')) === 'buildingContractor') { bc = text(inner(e, 'officialName') || inner(e, 'name')); break; } }
      const bi = bauherrInfo([bc]); return { typ: bi.typ, vertreter: bi.vertreter };
    }
    if (g.quelle === 'Publikationen SG' && g.url) {
      const r = await holen(g.url, 30000);
      if (!r.ok) { return null; }
      const q = text(await r.text());
      const m = q.match(/Gesuchsteller\s+(.*?)\s+(?:Planverfasser|Bauvorhaben|Grundeigent)/);
      const bi = bauherrInfo([m ? m[1] : '']); return { typ: bi.typ, vertreter: bi.vertreter };
    }
  } catch (_e) { return null; }
  return null;
}

// Offene Einstufungen (klassifiziert_von = 'regel') per Claude präzisieren. Gibt die IDs zurück, die Claude bearbeitet hat.
async function einstufen(a: SupabaseClient, limit: number, info: string[]): Promise<string[]> {
  const apiKey = await geheimnis(a, 'anthropic_api_key');
  if (apiKey === null) { info.push('Einstufung: kein Anthropic API Key, Regel-Einstufung bleibt'); return []; }
  const { data: konf } = await a.from('konfig').select('wert').eq('key', 'anthropic_modell').maybeSingle();
  const modell = konf !== null ? (konf as { wert: string }).wert : MODELL_STANDARD;
  const { data, error } = await a.from('baugesuche')
    .select('id, quelle, externe_id, url, gemeinde, ortsteil, adresse, beschreibung, bauherr, bauherr_typ, projektverfasser, wohnungen')
    .eq('klassifiziert_von', 'regel').order('publiziert_am', { ascending: false }).limit(limit);
  if (error) { info.push('Einstufung: ' + error.message); return []; }
  const offen = (data || []) as Offen[];
  if (offen.length === 0) { return []; }

  // Bauherr-Typ fehlt (Bestand vor der Einstufung): nachlesen, Namen von Privatpersonen werden dabei nicht gespeichert
  const ohneTyp = offen.filter((g) => g.bauherr_typ === null);
  const typen: Record<string, unknown>[] = [];
  await parallel(ohneTyp, 8, async (g) => {
    const r = await bauherrNachlesen(g);
    const typ = r !== null ? (g.bauherr !== null && r.typ === 'privat' && !/vertreten durch/i.test(g.bauherr) ? typAusName(g.bauherr) : r.typ) : (g.bauherr !== null ? typAusName(g.bauherr) : 'unbekannt');
    g.bauherr_typ = typ;
    if (typ === 'privat' && g.bauherr !== null && /vertreten durch/i.test(g.bauherr)) { g.bauherr = null; }
    typen.push({ id: g.id, bauherr_typ: typ, vertreter: r !== null ? r.vertreter : null });
  });
  if (typen.length > 0) { await a.rpc('baugesuche_bauherr_typ_setzen', { p: typen }); }

  const fertig: string[] = []; let fehler = 0;
  const pakete: Offen[][] = [];
  for (let i = 0; i < offen.length; i += 25) { pakete.push(offen.slice(i, i + 25)); }
  await parallel(pakete, 3, async (paket) => {
    try {
      const erg = await claudeEinstufen(apiKey, modell, paket);
      if (erg.length > 0) {
        const { error: e2 } = await a.rpc('baugesuche_einstufung_setzen', { p: erg });
        if (e2) { throw new Error(e2.message); }
        for (const r of erg) { fertig.push(r.id as string); }
      }
    } catch (e) { fehler++; info.push('Einstufung: ' + String(e instanceof Error ? e.message : e).slice(0, 160)); }
  });
  info.push('Einstufung: ' + fertig.length + ' von ' + offen.length + ' per Claude (' + modell + ')' + (typen.length > 0 ? ', Bauherr-Typ für ' + typen.length + ' nachgelesen' : '') + (fehler > 0 ? ', ' + fehler + ' Pakete mit Fehler' : ''));
  return fertig;
}

// ---------- Hauptablauf ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: cors }); }
  const a = admin();
  const b = await berechtigt(req, a);
  if (!b.ok) { return json({ error: 'nicht berechtigt' }, 401); }
  const body = await leseBody(req);
  const quellen = Array.isArray(body.quellen) ? (body.quellen as string[]) : ['ZH', 'SZ', 'SG'];
  const bis = typeof body.bis === 'string' && /^\d{4}-\d\d-\d\d$/.test(body.bis) ? body.bis : null;
  const push = body.push !== false && body.push !== 'false';
  const protokollieren = body.protokoll !== false && body.protokoll !== 'false';

  const { data: gem, error: ge } = await a.from('radar_gemeinden').select('name, kanton, bfs_nr').eq('aktiv', true);
  if (ge) { return json({ error: ge.message }, 500); }
  const gemeinden = (gem || []) as Gemeinde[];

  const ergebnis: Record<string, unknown> = {};
  const neuIds: string[] = [];
  const info: string[] = [];
  const limit = typeof body.limit === 'number' ? body.limit : typeof body.limit === 'string' && /^\d+$/.test(body.limit) ? Number(body.limit) : 60;

  if (body.nur_einstufen === true || body.nur_einstufen === 'true') {
    const fertig = await einstufen(a, Math.min(Math.max(limit, 1), 150), info);
    const { count } = await a.from('baugesuche').select('id', { count: 'exact', head: true }).eq('klassifiziert_von', 'regel');
    return json({ ok: true, eingestuft: fertig.length, offen: count, info });
  }

  for (const k of quellen) {
    const quelle = k === 'ZH' ? 'Amtsblatt ZH' : k === 'SZ' ? 'Amtsblatt SZ' : 'Publikationen SG';
    const protokoll = k === 'ZH' ? 'Baugesuche ZH' : k === 'SZ' ? 'Baugesuche SZ' : 'Baugesuche SG';
    const start = new Date().toISOString();
    let seit = typeof body.seit === 'string' && /^\d{4}-\d\d-\d\d$/.test(body.seit) ? body.seit : '';
    if (seit === '') {
      const { data: s } = await a.rpc('radar_seit', { p_quelle: protokoll });
      seit = typeof s === 'string' ? s : plusTage(new Date().toISOString(), -365);
    }
    try {
      const teilGemeinden = gemeinden.filter((g) => g.kanton === k);
      const finde = zuordnung(teilGemeinden);
      const zeilen = k === 'SG' ? await stGallen(teilGemeinden, seit, info) : await amtsblatt(k as 'ZH' | 'SZ', seit, bis, finde, info);
      let neu: { id: string; einstufung: string }[] = [];
      for (let i = 0; i < zeilen.length; i += 200) {
        const { data, error } = await a.rpc('baugesuche_import', { p: zeilen.slice(i, i + 200) });
        if (error) { throw new Error(quelle + ': Import ' + error.message); }
        neu = neu.concat((data || []) as typeof neu);
      }
      for (const n of neu) { neuIds.push(n.id); }
      ergebnis[quelle] = { seit, treffer: zeilen.length, neu: neu.length };
      if (protokollieren) await a.from('lauf_protokoll').insert({ makler: protokoll, gestartet_am: start, geprueft: true, anzahl_inserate: zeilen.length, neue: neu.length, geaendert: 0, fehler: null, beendet_am: new Date().toISOString() });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 300);
      ergebnis[quelle] = { seit, fehler: msg };
      if (protokollieren) await a.from('lauf_protokoll').insert({ makler: protokoll, gestartet_am: start, geprueft: false, anzahl_inserate: 0, neue: 0, geaendert: 0, fehler: msg, beendet_am: new Date().toISOString() });
    }
  }

  // Neue Gesuche (und allenfalls liegengebliebene) per Claude einstufen
  await einstufen(a, Math.max(limit, neuIds.length), info);

  // Push nur für neue Gesuche mit Einstufung «fokus»
  let fokus: { id: string; gemeinde: string | null; adresse: string | null; beschreibung: string | null; begruendung: string | null }[] = [];
  if (neuIds.length > 0) {
    const { data } = await a.from('baugesuche').select('id, gemeinde, adresse, beschreibung, begruendung').in('id', neuIds).eq('einstufung', 'fokus');
    fokus = (data || []) as typeof fokus;
  }
  ergebnis.neu_fokus = fokus.length;
  if (push && fokus.length > 0) {
    const titel = fokus.length === 1 ? 'Baugesuch im Fokus: ' + (fokus[0].gemeinde || '') : fokus.length + ' Baugesuche im Fokus';
    const txt = fokus.slice(0, 4).map((n) => (n.gemeinde || '') + ', ' + (n.adresse || '') + ': ' + (n.beschreibung || '').slice(0, 70)).join(' · ');
    await a.rpc('push_senden', { p_titel: titel, p_text: txt, p_url: '/radar' });
  }

  return json({ ok: true, ergebnis, info, neue_fokus: fokus });
});

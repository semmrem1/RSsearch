// Edge Function: Kennzahlen aus einem hochgeladenen Exposé-PDF extrahieren (Claude API).
// Body: { dokument_id: uuid }. Braucht das Vault-Secret 'anthropic_api_key' (in der App unter Einstellungen setzbar).
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import { admin, berechtigt, cors, geheimnis, json, leseBody } from './auth.ts';

const MODELL_STANDARD = 'claude-sonnet-5-5';

const FELDER = `{
  "objekt_typ": "wohnung|haus|andere|null",
  "titel": "Vermarktungsname oder null",
  "adresse": "Strasse Nr oder null",
  "plz": "PLZ oder null",
  "ort": "Ort oder null",
  "preis_chf": Zahl oder null,
  "zimmer": Zahl oder null,
  "wohnflaeche_m2": Zahl oder null,
  "grundstueck_m2": Zahl oder null,
  "baujahr": Zahl oder null,
  "renovationen": "Jahr und was, z.B. 2019 Küche, Bad; oder null",
  "heizung": "System, z.B. Wärmepumpe, Öl, Gas, Fernwärme; oder null",
  "energie": "GEAK-Klasse oder Minergie-Label oder null",
  "nebenkosten_chf_jahr": Zahl oder null,
  "stwe_anteil": "Wertquote in Promille/Prozent oder null",
  "erneuerungsfonds_chf": Zahl oder null,
  "parkplaetze": "Anzahl und Preis, z.B. 2 Garagenplätze à CHF 45'000 inkl.; oder null",
  "verfuegbarkeit": "ab wann / nach Vereinbarung oder null",
  "besonderheiten": ["max. 6 kurze Stichworte"],
  "risiken": ["max. 5 kurze Stichworte, z.B. Baurecht, Strassenlärm, Sanierungsbedarf"],
  "zusammenfassung": "3 bis 5 Sätze auf Deutsch"
}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: cors }); }
  const a = admin();
  const b = await berechtigt(req, a);
  if (!b.ok) { return json({ error: 'nicht berechtigt' }, 401); }
  const body = await leseBody(req);
  const dokumentId = typeof body.dokument_id === 'string' ? body.dokument_id : '';
  if (dokumentId === '') { return json({ error: 'dokument_id fehlt' }, 400); }

  const apiKey = await geheimnis(a, 'anthropic_api_key');
  if (apiKey === null) { return json({ error: 'Kein Anthropic API Key hinterlegt. In der App unter Einstellungen > Exposé-Extraktion eintragen.' }, 400); }

  const { data: dok } = await a.from('dokumente').select('id, objekt_id, name, storage_path, mime, groesse_bytes').eq('id', dokumentId).maybeSingle();
  if (dok === null) { return json({ error: 'Dokument nicht gefunden' }, 404); }
  const d = dok as { id: string; objekt_id: string; name: string; storage_path: string; mime: string | null; groesse_bytes: number | null };
  if (!(d.mime === 'application/pdf' || /\.pdf$/i.test(d.name))) { return json({ error: 'Nur PDF-Dokumente' }, 400); }
  if (d.groesse_bytes !== null && d.groesse_bytes > 30 * 1024 * 1024) { return json({ error: 'PDF grösser als 30 MB' }, 400); }

  const dl = await a.storage.from('dokumente').download(d.storage_path);
  if (dl.error || dl.data === null) { return json({ error: 'Download fehlgeschlagen: ' + (dl.error ? dl.error.message : '') }, 500); }
  const pdfB64 = encodeBase64(new Uint8Array(await dl.data.arrayBuffer()));

  const { data: konf } = await a.from('konfig').select('wert').eq('key', 'anthropic_modell').maybeSingle();
  const modell = konf !== null ? (konf as { wert: string }).wert : MODELL_STANDARD;

  const prompt = 'Du bist ein Assistent für eine Schweizer Immobiliensuche. Extrahiere aus dem beigefügten Verkaufsexposé die Kennzahlen als JSON. '
    + 'Antworte ausschliesslich mit einem JSON-Objekt nach diesem Schema (Werte, die im Dokument nicht vorkommen, als null; keine Schätzungen):\n' + FELDER
    + '\nPreise als reine Zahlen in CHF ohne Trennzeichen. Flächen in m² als Zahl. Schweizer Rechtschreibung (ss statt ß).';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: modell,
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 }, title: d.name },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    return json({ error: 'Claude API ' + res.status + ': ' + t.slice(0, 400) }, 502);
  }
  const antwort = await res.json() as { content: { type: string; text?: string }[] };
  const text = antwort.content.filter((c) => c.type === 'text').map((c) => c.text || '').join('\n');
  const m = text.match(/\{[\s\S]*\}/);
  if (m === null) { return json({ error: 'Keine JSON-Antwort erhalten', roh: text.slice(0, 500) }, 502); }
  let daten: Record<string, unknown>;
  try { daten = JSON.parse(m[0]) as Record<string, unknown>; } catch { return json({ error: 'JSON nicht lesbar', roh: m[0].slice(0, 500) }, 502); }

  const zusammenfassung = typeof daten.zusammenfassung === 'string' ? daten.zusammenfassung : null;
  await a.from('expose_extrakte').upsert({ dokument_id: d.id, objekt_id: d.objekt_id, daten, zusammenfassung, modell, erstellt_am: new Date().toISOString() });

  // Leere Objektfelder ergänzen (nie überschreiben)
  const { data: o } = await a.from('objekte').select('baujahr, grundstueck_m2, flaeche_m2, zimmer, plz, adresse, titel, heizung').eq('id', d.objekt_id).maybeSingle();
  if (o !== null) {
    const obj = o as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const zahl = (k: string): number | null => { const v = daten[k]; return typeof v === 'number' && isFinite(v) ? v : null; };
    const str = (k: string): string | null => { const v = daten[k]; return typeof v === 'string' && v.trim() !== '' ? v.trim() : null; };
    if (obj.baujahr === null && zahl('baujahr') !== null) { patch.baujahr = Math.round(zahl('baujahr') as number); }
    if (obj.grundstueck_m2 === null && zahl('grundstueck_m2') !== null) { patch.grundstueck_m2 = Math.round(zahl('grundstueck_m2') as number); }
    if (obj.flaeche_m2 === null && zahl('wohnflaeche_m2') !== null) { patch.flaeche_m2 = Math.round(zahl('wohnflaeche_m2') as number); }
    if (obj.zimmer === null && zahl('zimmer') !== null) { patch.zimmer = zahl('zimmer'); }
    if (obj.plz === null && str('plz') !== null) { patch.plz = str('plz'); }
    if ((obj.adresse === null || !/[0-9]/.test(String(obj.adresse))) && str('adresse') !== null && /[0-9]/.test(str('adresse') as string)) { patch.adresse = str('adresse'); }
    if (obj.titel === null && str('titel') !== null) { patch.titel = str('titel'); }
    if ((obj.heizung === null || obj.heizung === undefined) && str('heizung') !== null) { patch.heizung = str('heizung'); } // fliesst in den Score
    if (Object.keys(patch).length > 0) { await a.from('objekte').update(patch).eq('id', d.objekt_id); }
  }
  await a.from('aktivitaeten').insert({ objekt_id: d.objekt_id, user_id: b.userId, typ: 'system', titel: 'Exposé ausgewertet', text: d.name + (zusammenfassung !== null ? ': ' + zusammenfassung : '') });

  return json({ ok: true, daten, zusammenfassung, modell });
});

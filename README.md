# PRimmo (Repo RSsearch)

Immobilien-Tracker für die Eigenheimsuche von Remo und Pascale. React + Vite + Supabase, gehostet auf Cloudflare Pages.

## Was die App macht

- Alle Inserate aus dem täglichen Makler-Monitoring landen in der Datenbank (Tabelle `objekte` mit `objekt_quellen` je Makler)
- Jede Preis-, Status- oder Flächenänderung wird als `snapshot` protokolliert (Trigger in der DB)
- Pipeline in 5 Phasen und 18 Stufen nach dem Schweizer Kaufablauf, plus «Ausgeschieden»
- Bewertungen (Sterne, Favorit, Kommentar, Tags) pro Person
- Aktivitäten-Timeline mit Fälligkeiten, Dokumente im Supabase Storage, Standortfaktoren
- Karte (swisstopo) im Inserat und Gesamtkarte aller Inserate (`/karte`); Koordinaten ermittelt die App über die geo.admin.ch-Suche und speichert sie in `objekte.lat/lng`
- Bild pro Objekt: Edge Function `bild-sichern` kopiert das Inseratfoto (`bild_url` oder og:image der Detailseite) in den Bucket `objektbilder`; ohne Foto zeigt die App das Luftbild an der Adresse
- Sortierbare Tabelle (Spaltentitel), Filter nach Ortschaft, Markt, Phase und Favoriten auf Übersicht, Inserate und Karte; Filter und Sortierung bleiben im Browser gespeichert
- Mobile: Inserate als Karten, Ortsfilter als Bottom Sheet, installierbar als PWA (`manifest.webmanifest`, `sw.js` cached nur die App-Shell, Daten kommen immer live)
- Nicht mehr gefundene Inserate: `markiere_offline` setzt `status = 'offline'` und `offline_seit`, die App zeigt «Offline genommen seit …»; taucht das Inserat wieder auf, wird es automatisch wieder aktiv
- Tragbarkeit pro Objekt (Haushalt unter Einstellungen: Eigenkapital, Einkommen, kalk. Zins, Nebenkosten, Amortisation), Tage am Markt, Kriterienkatalog (8 Kriterien, 1 bis 5 pro Person, Score), Konflikt-Ansicht «Uneinig», Pendelzeit ÖV zum Arbeitsort pro Person (transport.opendata.ch), Gemeinde und Steuerfuss (Tabelle `gemeinden`, Mapping `ortschaften`)
- Galerie (bis 5 Bilder pro Inserat, Bucket `objektbilder`), Originalportal bei MoneyPark als Spiegel-Quelle (`objekt_quellen.spiegel_von`), manuelles Zusammenführen von Dubletten (`objekte_zusammenfuehren`, Quelle wird ausgeblendet statt gelöscht), Exposé-Extraktion aus PDF via Claude API (Edge Function `expose-extrahieren`, Key unter Einstellungen), Web Push (VAPID, `push_abos`, Edge Function `push-senden`, aus SQL via `public.push_senden(...)`), Lärm- und Gefahren-Layer auf der Karte (wmts.geo.admin.ch), Lauf-Protokoll unter `/lauf`, Offline-Datencache
- Budgetrechnung pro Inserat: Nettolohn und Pensum pro Person, weitere Einkünfte, effektiver Hypozins und Standard-Ausgaben (`budget_posten`) unter Einstellungen; auf der Inseratsseite Einkommen minus Wohnkosten des Objekts minus Ausgaben, pro Objekt überschreibbar (`objekt_budget.daten`), Spalte «Budget» in der Tabelle
- Finanzierung pro Inserat: Bank-Sicht (kalk. Zins, entscheidet über Tragbarkeit) neben Effektiv-Sicht (realer Zins, Standard unter Einstellungen › Budget, pro Inserat in der Karte «Finanzierung» überschreibbar, `objekt_budget.daten.zins_effektiv`); «Beim Kauf» mit Eigenkapital (mind. 20 %), Kaufnebenkosten (`haushalt.kaufnebenkosten_pct`) und Mittelbedarf
- Entscheid auf einen Blick: KPI-Leiste oben auf dem Inserat (Einschätzung, Preis, Objekt, Tage am Markt, Tragbarkeit Bank, Belastung pro Monat, Budget, Pendeln, Score, Steuerfuss) und dreispaltiges Raster Finanzierung / Budget / Kriterien; Layout bis 1800 px breit
- Ampel (`src/lib/ampel.ts`): grün «Passt», gelb «Prüfen», rot «Eher nicht», grau «Offen» aus sieben Prüfungen (Markt, Eigenkapital, Tragbarkeit, Budget, Score, Einigkeit, Markierung); erste Spalte der Tabelle (sortierbar), Filter «Einschätzung»; Auswertung aller Prüfungen als Popover beim Überfahren oder Antippen (`AmpelInfo`), in Übersicht und Inserat
- Inseratsseite von oben nach unten: Bild und Karte, KPI-Leiste mit Ampel, Finanzierung / Budget / Kriterien, dann Preisverlauf, Aktivitäten, Quellen, Dokumente, Standortfaktoren
- Kriterien & Bewertung in einer Karte: Kriterien 1 bis 5 pro Person, Score, «Gefühl» (Sterne, `bewertungen.sterne`), Notiz und Tags pro Person (automatisch beim Tippen gespeichert), Favorit / Uninteressant
- Rollen: `profiles.rolle` = `mitglied` (Remo, Pascale: alles) oder `leser` (nur lesen). Leser werden in der DB gesperrt (RLS-Richtlinien mit `public.ist_leser()`, Storage-Upload, `nur_mitglieder()` in den RPCs `push_senden`, `geheimnis_setzen`, `objekte_zusammenfuehren`, Edge Functions weisen Leser ab, Lauf-Funktionen sind für `authenticated` nicht mehr aufrufbar) und in der App ausgeblendet (keine Bewertungen, Aktivitäten, Uploads, Stufenwechsel, Einstellungen; Chip «Nur Lesen» im Header). Leser zählen nicht als Person bei Bewertungen, Budget und Pendelzeiten
- Gemeinde & Steuern in der Karte «Finanzierung» (Steuerfuss, Index, Beispiel, Quelle) und beim Posten «Steuern» im Budget; Steuerfuss in der Übersicht unter dem Objekt
- Direktlink zum Inserat ist Pflicht: `objekt_quellen.url_direkt` erkennt Übersichtsseiten, `upsert_inserat` lehnt sie ab

## Lokal starten

```bash
cp .env.example .env   # Werte aus Supabase > Project Settings > API eintragen
npm install
npm run dev
```

## Deployment (Cloudflare Pages)

1. Cloudflare Dashboard > Workers & Pages > Create > Pages > Connect to Git > Repo `semmrem1/RSsearch`
2. Build command: `npm run build`, Build output directory: `dist`
3. Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
4. React-Router: Cloudflare Pages liefert bei unbekannten Pfaden automatisch `index.html` aus (SPA-Fallback), keine `_redirects` nötig

## Edge Functions

Siehe `supabase/functions/README.md`. Aufrufe aus SQL laufen über `public.edge_aufruf()` (pg_net, Secret im Vault `app_secret`): `bilder_sichern()`, `pendelzeiten_berechnen()`, `push_senden(...)`.

## Datenbank

Schema in `supabase/migrations/`. Der tägliche Monitoring-Task schreibt über den Supabase-Connector direkt in `objekte`, `objekt_quellen`, `snapshots` und `lauf_protokoll`.

Konventionen für den Task:

- Dublettenprüfung zuerst über `objekt_quellen (makler, externe_id)`, dann über `objekte (ort, zimmer, flaeche_m2)` mit Preis ±2 %
- Immer `upsert_inserat(…, p_bild_url)` mit der Direkt-URL der Detailseite aufrufen (Übersichts-/Suchseiten werden abgelehnt)
- Neues Objekt: Insert in `objekte` (Stufe `neu`), dann Insert in `objekt_quellen`; der Trigger schreibt den `erfasst`-Snapshot
- Bestehendes Objekt: `zuletzt_gesehen` setzen; bei Preisänderung `preis_chf` updaten (Trigger schreibt Snapshot); Objekt nicht mehr gefunden an 2 Läufen in Folge: `markt_status = 'offline'`
- Pro Makler eine Zeile in `lauf_protokoll`

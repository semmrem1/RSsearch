# RSsearch

Immobilien-Tracker für die Eigenheimsuche von Remo und Pascale. React + Vite + Supabase, gehostet auf Cloudflare Pages.

## Was die App macht

- Alle Inserate aus dem täglichen Makler-Monitoring landen in der Datenbank (Tabelle `objekte` mit `objekt_quellen` je Makler)
- Jede Preis-, Status- oder Flächenänderung wird als `snapshot` protokolliert (Trigger in der DB)
- Pipeline in 5 Phasen und 18 Stufen nach dem Schweizer Kaufablauf, plus «Ausgeschieden»
- Bewertungen (Sterne, Favorit, Kommentar, Tags) pro Person
- Aktivitäten-Timeline mit Fälligkeiten, Dokumente im Supabase Storage, Standortfaktoren

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
4. Für React-Router: Datei `public/_redirects` ist bereits vorhanden (`/* /index.html 200`)

## Datenbank

Schema in `supabase/migrations/`. Der tägliche Monitoring-Task schreibt über den Supabase-Connector direkt in `objekte`, `objekt_quellen`, `snapshots` und `lauf_protokoll`.

Konventionen für den Task:

- Dublettenprüfung zuerst über `objekt_quellen (makler, externe_id)`, dann über `objekte (ort, zimmer, flaeche_m2)` mit Preis ±2 %
- Neues Objekt: Insert in `objekte` (Stufe `neu`), dann Insert in `objekt_quellen`; der Trigger schreibt den `erfasst`-Snapshot
- Bestehendes Objekt: `zuletzt_gesehen` setzen; bei Preisänderung `preis_chf` updaten (Trigger schreibt Snapshot); Objekt nicht mehr gefunden an 2 Läufen in Folge: `markt_status = 'offline'`
- Pro Makler eine Zeile in `lauf_protokoll`

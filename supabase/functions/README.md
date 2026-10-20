# Edge Functions

- `bild-sichern`: kopiert Haupt- und Galeriebilder in den Bucket `objektbilder`
- `pendelzeit`: ÖV-Pendelzeit pro Objekt und Person (transport.opendata.ch), Stationssuche für die Einstellungen
- `push-senden`: Web Push an `push_abos` (VAPID-Keys: `konfig.vapid_public`, Vault `vapid_private`)
- `expose-extrahieren`: Kennzahlen aus Exposé-PDF via Claude API (Vault `anthropic_api_key`)

`auth.ts` ist in jedem Ordner identisch (Deploy über MCP erlaubt keine gemeinsamen Ordner). Berechtigt ist ein gültiges Session-Token der App oder der Header `x-app-secret` (Vault `app_secret`), den `public.edge_aufruf()` aus SQL mitschickt. Alle Functions sind mit `verify_jwt = false` deployt, die Prüfung passiert in `auth.ts`.
- `baugesuche-abruf`: Neubau-Radar, Baugesuche aus Amtsblatt ZH/SZ und Publikationen SG (täglich per pg_cron)

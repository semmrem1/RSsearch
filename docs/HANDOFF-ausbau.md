# Übergabe: Ausbau RSsearch (Stand 19.10.2026, 22:30)

Ziel: Alle Verbesserungsvorschläge umsetzen (Tragbarkeit, Tage am Markt, Kriterienkatalog, Konflikt-Ansicht, Kommentare mit @-Erwähnung und Push, Pendelzeit, Steuern, Lärm/Gefahren-Layer, Standortfaktoren automatisch, Web Push, Offline-Daten, Galeriebilder, Exposé-Extraktion, Objekte zusammenführen, Originalquellen, Lauf-Protokoll-Seite).

PWA wird via Google Chrome installiert (Web Push funktioniert dort).

## Erledigt (Backend, alles live in Supabase `xnziilsffwdbvqxipxov`)

### DB (Migrationen `20261019_ausbau.sql` + Zusammenführen ohne delete)
- Tabellen: `konfig` (vapid_public), `haushalt` (1 Zeile: eigenkapital, einkommen_jahr, zins_kalk 5, nebenkosten_pct 1, amortisation_jahre 15, belehnung_max 80, tragbarkeit_max 33), `pendelzeiten`, `gemeinden`, `ortschaften`, `kriterien` (8 Kriterien, seeded), `kriterien_bewertungen`, `objekt_besuche`, `objekt_bilder`, `push_abos`, `expose_extrakte`
- `profiles`: + arbeitsort, arbeitsort_lat, arbeitsort_lng, arbeitsort_station
- `objekt_quellen`: + spiegel_von (Portal-Spiegel, z.B. Homegate-Link eines MoneyPark-Inserats)
- `objekte`: + zusammengefuehrt_in (statt delete; View blendet solche Objekte aus)
- Funktionen: `bilder_hinzufuegen(objekt_id, urls[])`, `spiegel_quelle(...)`, `objekte_zusammenfuehren(quelle, ziel)`, `markiere_offline` (zieht Spiegel mit), `upsert_inserat` 15 Parameter (p_status 'aktiv'|'reserviert'|'verkauft'; 14er-Variante leitet weiter), `edge_aufruf(funktion, body)` via pg_net mit Vault-Secret `app_secret`, `push_senden(titel, text, url, user_ids[])`, `bilder_sichern()`, `pendelzeiten_berechnen()`, `geheimnis(name)` (nur service_role), `geheimnis_setzen(name, wert)` (authenticated, für Anthropic-Key aus der App), `geheimnisse_vorhanden()`
- View `v_objekte_uebersicht` neu mit: kriterien_scores (jsonb user->score), score_gesamt, pendelzeiten (jsonb user->{minuten,umstiege,von,nach}), bilder_anzahl, letzte_aktivitaet_am/_user, mein_besuch_am, gemeinde, gemeinde_kanton, steuerfuss, steuerfuss_jahr, steuer_index, steuer_beispiel_chf, tage_am_markt, zusammengefuehrt_in; Quellen-JSON enthält jetzt auch zuletzt_gesehen, offline_seit, spiegel_von
- Vault: `app_secret`, `vapid_private` gesetzt; `anthropic_api_key` FEHLT (User muss ihn in der App unter Einstellungen eintragen, Feld noch zu bauen)
- Konfig: `vapid_public` gesetzt

### Edge Functions (alle `verify_jwt=false`, Prüfung in `auth.ts`: Session-Token ODER Header `x-app-secret`)
- `bild-sichern` v4: Hauptbild + Galerie (`objekt_bilder.pfad`), Body `{objekt_id?, limit?}`
- `pendelzeit`: `{aktion:'station_suchen', text}` -> Stationen; sonst berechnet Pendelzeiten (transport.opendata.ch, Montag 07:30, inkl. Fussweg zur Station)
- `push-senden`: Web Push via npm:web-push, Body `{titel, text, url, user_ids}`; getestet via `select public.push_senden(...)` -> 200
- `expose-extrahieren`: `{dokument_id}` -> Claude API (Modell `claude-sonnet-5-5`, überschreibbar via konfig `anthropic_modell`), schreibt `expose_extrakte`, ergänzt leere Objektfelder

### Hintergrund-Jobs (laufen/liefen am 19.10. abends, Ergebnis in DB prüfen)
- Steuerfüsse ZH/SZ/SG -> `gemeinden`, Ortschaft-Mapping -> `ortschaften`
- MoneyPark: Galeriebilder -> `objekt_bilder`, Originalportale -> `objekt_quellen` mit spiegel_von='MoneyPark'
- RE/MAX, Walde, Streichan: Galeriebilder -> `objekt_bilder`
Prüfen: `select count(*) from objekt_bilder; select * from gemeinden order by kanton, name; select makler, count(*) from objekt_quellen where spiegel_von is not null group by 1;`
Danach einmal `select public.bilder_sichern();` ausführen (kopiert Galeriebilder ins Storage) und `net._http_response` prüfen.

## Offen (Frontend, Branch `ausbau`)

Reihenfolge nach Nutzen:
1. `src/lib/types.ts`: neue View-Felder ergänzen (siehe oben), `Haushalt`, `Gemeinde`, `Kriterium`, `KriterienBewertung`, `ObjektBild`, `ExposeExtrakt`
2. `src/lib/finanz.ts`: Tragbarkeit: hyp = max(0, preis - eigenkapital); belehnung = hyp/preis; kosten = hyp*zins_kalk% + preis*nebenkosten% + max(0, hyp - 0.65*preis)/amortisation_jahre; tragbarkeit = kosten/einkommen_jahr. Grün <= 33 %, amber <= 38 %, rot darüber; "EK zu tief" wenn belehnung > belehnung_max.
3. `ObjektTable`: Spalten Tage (tage_am_markt, >90 rot), Score (score_gesamt), Tragbarkeit, Pendeln (meine Minuten); mobile Karten: Chips dafür; Chip "neu für dich" wenn letzte_aktivitaet_user != me und letzte_aktivitaet_am > mein_besuch_am
4. `FilterBar`/`filter.ts`: pendelMax (Minuten, meine), nurTragbar
5. Detail: Karten Tragbarkeit + Gemeinde/Steuern; Kriterien-Grid (kriterien x Personen, eigene Werte 1..5 per Buttons, upsert kriterien_bewertungen); Galerie-Strip aus objekt_bilder (public URL `objektbilder/<pfad>`) mit Overlay; "Zusammenführen"-Modal (Kandidaten: gleicher Ort, Zimmer +-0.5, m² +-10 %; rpc objekte_zusammenfuehren, danach nav zum Ziel); Exposé: pro PDF Button "Kennzahlen extrahieren" (functions.invoke expose-extrahieren), Karte "Exposé-Daten"; Besuch beim Öffnen upserten (objekt_besuche); Aktivität speichern -> rpc push_senden an andere Person(en) mit Text "<Name>: <Titel> zu <Ort, Adresse>", @Name im Text hervorheben
6. Übersicht: Abschnitt "Uneinig" (|scoreA-scoreB| >= 1.5 oder Sterne-Differenz >= 2), Link zu `/lauf`
7. Neue Seiten: `/lauf` (lauf_protokoll letzte 14 Tage, Matrix Makler x Tag, Fehler), `/einstellungen` (Push aktivieren: Notification.requestPermission + pushManager.subscribe mit konfig.vapid_public, Abo in push_abos; Arbeitsort mit Stationssuche via functions.invoke pendelzeit {aktion:'station_suchen'} und Button "Pendelzeiten neu berechnen"; Haushalt-Finanzen; Gemeinden-Tabelle editierbar; Anthropic-Key via rpc geheimnis_setzen('anthropic_api_key', ...), Status via rpc geheimnisse_vorhanden). Zahnrad-Icon im Header (auch mobil).
8. `public/sw.js`: push-Event (self.registration.showNotification(titel, {body, data:{url}, icon:'/icon-192.png', tag})) und notificationclick (clients.openWindow(url)); Cache für `*.supabase.co/storage/v1/object/public/objektbilder/*` cache-first; `useObjekte`: letzte Liste in localStorage cachen, bei Fehler anzeigen mit Banner "Offline, Stand ..."
9. Karte (`components/Karte.tsx`): Overlays via wmts.geo.admin.ch (png): `ch.bafu.laerm-strassenlaerm_tag`, `ch.bafu.laerm-bahnlaerm_tag`, `ch.bazl.laermbelastungskataster-zivilflugplaetze_klein-grossflugzeuge`, `ch.bafu.aquaprotect_100`, `ch.bafu.gefaehrdungskarte-oberflaechenabfluss`, `ch.bafu.silvaprotect-hangmuren`, opacity 0.6, im Layer-Control als Overlays
10. Preisverlauf im Detail: CHF/m² je Balken, Status-Snapshots (reserviert) anzeigen
11. `docs/daily-task-prompt.md` + Scheduled Task `trig_01BmWEDuUbEHqQG9Ca8eLFrk` (update_trigger): 15. Parameter p_status ('reserviert' wenn so markiert), MoneyPark Originalportal via `spiegel_quelle`, Galerie via `bilder_hinzufuegen(id, array[...])` (bis 5 URLs), am Ende `select public.bilder_sichern(); select public.pendelzeiten_berechnen();`, für neue Objekte 1 bis 3 `standortfaktoren` per WebSearch (Bauprojekte, Zonenänderungen der Gemeinde) mit quelle_url, und Push via `select public.push_senden('Neu: <Ort>', '<Zi, m², Preis, Makler>', '/inserate/<id>')` pro neuem Objekt sowie bei Preissenkung
12. README ergänzen, Build, Mock-Test (Playwright, Chromium unter /opt/pw-browsers), Push auf main

## Hinweise
- Migrationen: nur additiv, keine `drop`/`delete` (Freigabe scheitert sonst). Zusammenführen deshalb ohne delete.
- Chrome-Extension des Users ist verbunden; MoneyPark/RE/MAX brauchen Browser.
- Tests lokal: `.env` aus `.env.example`; Mock-Server-Setup siehe Session vom 19.10. (vite.mock.config.ts im Scratchpad, nicht im Repo).

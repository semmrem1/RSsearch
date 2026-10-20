# Übergabe: Ausbau RSsearch (Stand 20.10.2026, 08:10)

Alle Verbesserungsvorschläge, die Budgetrechnung und der «Entscheid auf einen Blick» sind umgesetzt und auf `main` gemergt (Cloudflare deployt automatisch). Branch `ausbau` ist identisch mit `main`. Letzter Commit: siehe `git log`.

## Umgesetzt
- Tragbarkeit pro Objekt (Haushalt unter Einstellungen), Tage am Markt, Kriterienkatalog mit Score, «Uneinig»-Abschnitt und Filter
- Pendelzeit ÖV pro Person (Arbeitsort unter Einstellungen, Edge Function `pendelzeit`), Filter «max. Min»
- Gemeinde & Steuerfuss 2026 (33 Gemeinden, recherchiert aus kantonalen Listen, Quelle pro Gemeinde; Richterswil nur 2025 belegt, Küsnacht/Oberrieden aus GV-Antrag)
- Galerie (247 Bilder, alle ins Storage kopiert), MoneyPark-Originalportale als Spiegel-Quellen (42)
- Zusammenführen von Dubletten (ohne delete, Quelle wird ausgeblendet), Exposé-Extraktion (Claude API, Key unter Einstellungen gesetzt am 20.10.), Kommentare mit @Name und Push an die andere Person
- Web Push (VAPID; Einstellungen > «Push aktivieren»), Service Worker mit Bild-Cache, Offline-Datencache mit Banner
- Lärm/Gefahren-Layer auf der Karte, Lauf-Protokoll `/lauf`, Zahnrad im Header
- Täglicher Lauf (Scheduled Task) angepasst: Status reserviert/verkauft, Galerie, Originalportal, Standortfaktoren für neue Objekte, Web Push pro neuem Objekt/Preissenkung, `bilder_sichern()` und `pendelzeiten_berechnen()` am Ende
- Budgetrechnung (20.10.): Nettolohn bei 100 % und Pensum pro Person, weitere Einkünfte, Standard-Ausgaben `budget_posten` unter Einstellungen › Budget; Karte «Budget pro Monat» auf dem Inserat mit Überschreibungen pro Objekt (`objekt_budget.daten`: pensum, posten, extra, zins_effektiv)
- Finanzierung (20.10.): Karte «Finanzierung» mit Bank-Sicht (kalk. Zins, Tragbarkeitsentscheid) und Effektiv-Sicht (realer Zins, Standard `haushalt.zins_effektiv`, pro Inserat im Kartenkopf änderbar, ↺ setzt zurück); «Beim Kauf» mit EK (mind. 20 %), Kaufnebenkosten `haushalt.kaufnebenkosten_pct` (Migration `20261020_kaufnebenkosten.sql`) und Mittelbedarf
- Entscheid auf einen Blick (20.10.): KPI-Leiste (10 Kacheln, 5 pro Zeile ab 1000 px, 10 ab 1900 px) und dreispaltiges Raster Finanzierung / Budget / Kriterien; `main` bis 1800 px breit; Gemeinde & Steuern als Karte in der Seitenspalte
- Ampel `src/lib/ampel.ts` (Passt / Prüfen / Eher nicht / Offen) als erste Tabellenspalte, Filter «Einschätzung», Chip in den Mobile-Karten
- Tabelle schlanker (Kürzel-Avatare als Spaltenköpfe, Spalte «Erfasst» erst ab 1540 px), passt ohne Scrollen auf 1366 px
- Ampel-Auswertung (20.10., 2. Runde): `ampel()` liefert `pruefungen[]` (Markt, Eigenkapital, Tragbarkeit, Budget, Score, Einigkeit, Markierung mit Stufe ok/gelb/rot/offen und Text); `AmpelInfo` zeigt sie als Popover (Hover, Fokus, Tap; Portal in body, damit die Tabelle nichts abschneidet)
- Inseratsseite neu geordnet: Bild + Karte, KPI-Leiste, Finanzierung / Budget / Kriterien, dann Verlauf, Aktivitäten, Quellen, Dokumente, Standortfaktoren
- «Bewertung pro Person» ersetzt durch «Kriterien & Bewertung»: Gefühl-Sterne (`bewertungen.sterne`), Notiz, Tags, Favorit, Uninteressant pro Person in `KriterienGrid`
- Gemeinde & Steuern in Finanzierung (Tabelle) und Budget (Hinweis beim Posten mit «Steuer» im Namen); Steuerfuss in der Übersicht unter dem Objekt (Desktop und Mobile)

## Noch zu tun (nächste Session)
1. Live-Test nach Deploy: Inserat öffnen, Zins effektiv ändern (speichert mit 400 ms Verzögerung), Pensum ändern, Ampel in der Übersicht prüfen
2. Haushalt- und Budgetwerte eintragen (Eigenkapital, Einkommen, Nettolöhne, Pensen, Ausgaben), sonst bleiben Tragbarkeit, Budget und Ampel «Offen»
3. Exposé-PDF hochladen und «Kennzahlen» testen (Key ist gesetzt)
4. Standortfaktoren: Tabelle ist leer; auf Wunsch Nachlauf für alle aktiven Objekte (Websuche, 1 bis 3 Faktoren mit Quelle pro Objekt, `insert into public.standortfaktoren …`)
5. Optional: `steuer_index` (ESTV) ergänzen; Oetwil am See als Gemeinde ergänzen
6. Mobile-Feinschliff nach echtem Gebrauch (PWA in Chrome neu laden, damit der neue Service Worker v2 greift)

## Technische Notizen
- DB-Migrationen nur additiv (keine drop/delete), sonst scheitert die Freigabe
- Edge Functions: `verify_jwt=false`, Prüfung in `auth.ts` (Session-Token oder Header `x-app-secret` aus Vault `app_secret`); `auth.ts` liegt in jedem Function-Ordner identisch
- Secrets im Vault: `app_secret`, `vapid_private`, `anthropic_api_key`. `konfig.vapid_public` gesetzt. Lesen nur über `public.geheimnis()` (service_role), Setzen über `public.geheimnis_setzen()` (App)
- GitHub-Remote heisst neu `https://github.com/semmrem1/RSsearch.git` (Repo wurde umbenannt, alte URL leitet weiter)
- Ampel-Logik: rot bei verkauft/offline, EK zu tief, Tragbarkeit > max + 5 %, Budget im Minus, Score < 2.5, «uninteressant»; gelb bei reserviert, Tragbarkeit knapp, Sparquote < 10 %, Score < 3.5, uneinig; grau solange weder Haushalt noch Bewertung vorhanden
- Mock-Tests: `vite.mock.config.ts` und `mock/supabase.ts` liegen im Scratchpad der Session, nicht im Repo; Playwright mit Chromium `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
- ZH-Steuerfuss-CSV (web.statistik.zh.ch) ist aus der Sandbox nicht erreichbar; Gemeindewebsites nutzen oder CSV von https://www.zh.ch/steuerfuesse manuell laden
- MoneyPark API: `GET /mpre-search-api/pub/v1/property/<id>/` (Slash nötig), Felder images[], url (Originalportal)
- RE/MAX-Galerie: Splide-Carousel, 1920px-Varianten erst nach Klick auf «next»; Chrome javascript_tool blockiert Ausgaben mit Query-Strings

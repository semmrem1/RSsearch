# Übergabe: Ausbau RSsearch (Stand 19.10.2026, 23:00)

Alle Verbesserungsvorschläge sind umgesetzt und auf `main` gemergt (Cloudflare deployt automatisch). Branch `ausbau` ist identisch mit `main`.

## Umgesetzt
- Tragbarkeit pro Objekt (Haushalt unter Einstellungen), Tage am Markt, Kriterienkatalog mit Score, «Uneinig»-Abschnitt und Filter
- Pendelzeit ÖV pro Person (Arbeitsort unter Einstellungen, Edge Function `pendelzeit`), Filter «max. Min»
- Gemeinde & Steuerfuss 2026 (33 Gemeinden, recherchiert aus kantonalen Listen, Quelle pro Gemeinde; Richterswil nur 2025 belegt, Küsnacht/Oberrieden aus GV-Antrag)
- Galerie (247 Bilder, alle ins Storage kopiert), MoneyPark-Originalportale als Spiegel-Quellen (42)
- Zusammenführen von Dubletten (ohne delete, Quelle wird ausgeblendet), Exposé-Extraktion (Claude API, Key unter Einstellungen), Kommentare mit @Name und Push an die andere Person
- Web Push (VAPID; Einstellungen > «Push aktivieren»), Service Worker mit Bild-Cache, Offline-Datencache mit Banner
- Lärm/Gefahren-Layer auf der Karte, Lauf-Protokoll `/lauf`, Zahnrad im Header
- Täglicher Lauf (Scheduled Task) angepasst: Status reserviert/verkauft, Galerie, Originalportal, Standortfaktoren für neue Objekte, Web Push pro neuem Objekt/Preissenkung, `bilder_sichern()` und `pendelzeiten_berechnen()` am Ende

## Noch zu tun (nächste Session)
1. Live-Test der App in Chrome mit echten Daten (Login nötig): Detailseite, Kriterien speichern, Zusammenführen-Modal, Einstellungen > Push aktivieren und Testpush, Arbeitsort setzen, Galerie
2. Galerie: alle 247 Bilder sind im Storage (erledigt 19.10., 23:05)
3. Anthropic API Key unter Einstellungen eintragen, dann ein Exposé-PDF testen
4. Optional: `steuer_index` (ESTV) ergänzen; Oetwil am See als Gemeinde ergänzen
5. Mobile-Feinschliff nach echtem Gebrauch (PWA in Chrome neu laden, damit der neue Service Worker v2 greift)

## Technische Notizen
- DB-Migrationen nur additiv (keine drop/delete), sonst scheitert die Freigabe
- Edge Functions: `verify_jwt=false`, Prüfung in `auth.ts` (Session-Token oder Header `x-app-secret` aus Vault `app_secret`); `auth.ts` liegt in jedem Function-Ordner identisch
- Secrets im Vault: `app_secret`, `vapid_private`; `anthropic_api_key` fehlt noch. `konfig.vapid_public` gesetzt. Lesen nur über `public.geheimnis()` (service_role), Setzen über `public.geheimnis_setzen()` (App)
- ZH-Steuerfuss-CSV (web.statistik.zh.ch) ist aus der Sandbox nicht erreichbar; Gemeindewebsites nutzen oder CSV von https://www.zh.ch/steuerfuesse manuell laden
- MoneyPark API: `GET /mpre-search-api/pub/v1/property/<id>/` (Slash nötig), Felder images[], url (Originalportal)
- RE/MAX-Galerie: Splide-Carousel, 1920px-Varianten erst nach Klick auf «next»; Chrome javascript_tool blockiert Ausgaben mit Query-Strings

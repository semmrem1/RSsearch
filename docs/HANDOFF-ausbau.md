# Übergabe: Ausbau PRimmo / RSsearch (Stand 20.10.2026, 10:00)

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
- App heisst PRimmo (Header, Login, Tab, Manifest, Push-Titel); Profil «Remo Semm»
- Leser-Rolle (20.10.): Dieter Semm (dieter.semm@bluewin.ch, `profiles.rolle = 'leser'`) darf nur lesen. Migration `20261020_leser_rolle.sql`: `ist_leser()`, `nur_mitglieder()`, alle `_auth_all`-Richtlinien auf `not ist_leser()` plus `_leser_select`, eigene Bewertungs-/Besuchs-/Push-Richtlinien gesperrt, Storage-Insert/Update gesperrt, RPCs geschützt, `revoke execute` der Lauf-Funktionen für `authenticated`. Edge Functions (`auth.ts`) weisen Leser ab. App: `useApp().leser`, `profiles` = nur Mitglieder, `alleProfiles` für Avatare. Weitere Leser: `update public.profiles set rolle = 'leser' where id = '<uuid>'`
- Gemeinde & Steuern in Finanzierung (Tabelle) und Budget (Hinweis beim Posten mit «Steuer» im Namen); Steuerfuss in der Übersicht unter dem Objekt (Desktop und Mobile)

## Stand 21.10.2026: Eigenkapital-Bausteine, Steuerschätzung, Score 0 bis 100, Score-Modell pro Person
- Migration `20261021_score_steuern_eigenkapital.sql` (live, additiv). Neue Spalten: `haushalt.ek_erweitert`, `haushalt.kinder`, `profiles.saeule3a`, `gemeinden.steuerfuss_kanton` (ZH 95, SZ 110, SG 105), `gemeinden.steuerfuss_bezirk` (SZ: Höfe 14, March 30), `objekte.heizung`, `objekte.score_auto`, `objekte.score_auto_detail` (jsonb), `objekte.score_auto_am`; Tabelle `kriterien_gewichte`
- Eigenkapital = Basis (`haushalt.eigenkapital`) + erweitertes EK (`haushalt.ek_erweitert`, z.B. Götti) + Säule 3a pro Person (`profiles.saeule3a`). Standard aus den Einstellungen, pro Inserat in der Karte «Finanzierung» anpassbar oder «nicht einsetzen» (`objekt_budget.daten.ek = { basis?, erweitert?, saeule3a?: { <user_id>: betrag } }`). `src/lib/finanz.ts: eigenkapital()`; `tragbarkeit()` nimmt das Total als 4. Parameter
- Budget nimmt die berechneten Wohnkosten der Effektiv-Sicht (Hypozins effektiv, Nebenkosten 1 %, Amortisation). Differenz zum Excel «Zinsberechnung»: dort EK 625k statt 500k, Unterhalt 0.6 % statt 1 %, Amortisation auf 66 %
- Steuerschätzung (grob): `public.steuer_schaetzung()` und Spiegel `src/lib/steuern.ts` (bei Änderungen beide anpassen). Gemeinsame Veranlagung, Tarife 2026: ZH Verheiratetentarif § 35, SG Vollsplitting Art. 50, SZ Divisor 1.9 mit Stützpunkten (Steuerbuch 90.10), Bund Verheiratetentarif (Steuer ab 29'700). Pauschalabzüge pro Kanton (Berufskosten, 3a 7'258, Versicherungen, Kinder, Zweiverdiener). Eigenmietwert/Schuldzinsen neutral, keine Kirchensteuer, keine Vermögenssteuer. Kalibrierung: Excel Wädenswil (201'800 brutto, 2 Kinder) 1'229/Mt, Modell 1'105/Mt. Im Budget ersetzt die Schätzung den Posten mit «Steuer» im Namen, solange er pro Objekt nicht überschrieben ist (Erklärung beim Überfahren)
- Score 0 bis 100 (`objekt_score_rechnen(objekte)`, nur objektive Faktoren): Tragbarkeit 18, Budget 14, Preis/m² vs. Median gleicher Kanton+Typ 14, Wohnfläche 15 (min. 115 m², darunter −1/m², darüber +0.1/m²), Zimmer 10 (4.5 = 7, 5.5 = 10, 6.5 = 6), Typ 4 (Haus 4, Wohnung 3.5), Baujahr 8, Heizung 5, Steuern 7 (Vergleich aller Gemeinden), Pendeln 5. Obergrenze 40 bei EK zu tief, 45 bei Tragbarkeit > max + 5, 50 bei Fehlbetrag; reserviert ×0.5; verkauft/offline/zusammengeführt = 0; ohne Preis null. Trigger `objekte_score` (before insert/update relevanter Spalten), Nachrechnen bei Änderungen an haushalt/profiles/budget_posten/gemeinden (alle) und objekt_budget/pendelzeiten (Objekt), pg_cron `scores-taeglich` 03:45 UTC, manuell `select public.scores_berechnen();`
- Baujahr und Heizung sind im Bestand leer (neutral gewertet). Exposé-Extraktion füllt beide (Edge Function `expose-extrahieren`, neu auch `heizung`, Deploy nötig); der tägliche Lauf soll sie für neue Objekte setzen: `update public.objekte set baujahr = …, heizung = … where id = …`
- Score-Modell pro Person: `kriterien_gewichte(user_id, kriterium, gewicht 1..10)`, Einstellungen › Score-Modell. View `v_objekte_uebersicht`: `kriterien_scores` = gewichteter Durchschnitt pro Person, `score_gesamt` = Mittel der Personen («Gemeinsam»). Ohne Eintrag Gewicht 5
- App: Spalte «Score» (Badge, Erklärung beim Überfahren: `ScoreInfo`/`HoverPop`), Spalte «Bew.» (gemeinsame Objektbewertung), Filter «Score ab», KPI «Score», «Eigenkapital», «Objektbewertung»; Ampel-Prüfung «Score» (rot < 35, gelb < 55) und «Objektbewertung»
- Übersicht: startet immer nach «Erfasst» (neuste zuerst), Sortierung wird nicht mehr gemerkt; Zeilen/Karten ohne eigenen Besuch (`mein_besuch_am` null) bläulich («ungelesen»)

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
- Ampel-Logik: rot bei verkauft/offline, EK zu tief, Tragbarkeit > max + 5 %, Budget im Minus, Score < 35, Objektbewertung < 2.5, «uninteressant»; gelb bei reserviert, Tragbarkeit knapp, Sparquote < 10 %, Score < 55, Objektbewertung < 3.5, uneinig
- Mock-Tests: `vite.mock.config.ts` und `mock/supabase.ts` liegen im Scratchpad der Session, nicht im Repo; Playwright mit Chromium `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
- ZH-Steuerfuss-CSV (web.statistik.zh.ch) ist aus der Sandbox nicht erreichbar; Gemeindewebsites nutzen oder CSV von https://www.zh.ch/steuerfuesse manuell laden
- MoneyPark API: `GET /mpre-search-api/pub/v1/property/<id>/` (Slash nötig), Felder images[], url (Originalportal)
- RE/MAX-Galerie: Splide-Carousel, 1920px-Varianten erst nach Klick auf «next»; Chrome javascript_tool blockiert Ausgaben mit Query-Strings

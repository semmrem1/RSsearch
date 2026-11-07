-- Unterhalt effektiv und Amortisationsgrenze 2/3 (07.11.2026), additiv
-- 1. haushalt.unterhalt_effektiv_pct: realer Unterhalt in % des Preises für Effektiv-Sicht und Budget (Standard 0.6 %).
--    nebenkosten_pct (1 %) bleibt für die Bank-Sicht. Pro Inserat überschreibbar: objekt_budget.daten.unterhalt_effektiv.
-- 2. Pflichtamortisation nur für den Teil der Hypothek über 2/3 des Preises (vorher fälschlich 65 %).
-- Spiegel im Frontend: src/lib/finanz.ts (amortisationJahr, unterhaltEffektivPct) und src/lib/budget.ts.

alter table public.haushalt add column if not exists unterhalt_effektiv_pct numeric(4,2) not null default 0.6;

-- objekt_score_berechnet() gezielt anpassen (Ersetzungen auf der live Definition, damit nichts anderes verloren geht)
do $$
declare
  def text := pg_get_functiondef('public.objekt_score_berechnet(public.objekte)'::regprocedure);
  u text := 'coalesce((ob->>''unterhalt_effektiv'')::numeric, h.unterhalt_effektiv_pct, h.nebenkosten_pct)';
  a_alt text := 'amort := greatest(0, hyp - 0.65 * preis) / greatest(1, h.amortisation_jahre);';
  a_neu text := 'amort := case when hyp - preis * 2.0 / 3 > 0.5 then (hyp - preis * 2.0 / 3) / greatest(1, h.amortisation_jahre) else 0 end;';
  w_alt text := 'wohnen := round(hyp * zins_eff / 100 / 12) + round(nk / 12) + round(amort / 12);';
  w_neu text;
  t_alt text := ' || '' ('' || zins_eff || '' % effektiv) − Ausgaben ''';
  t_neu text;
begin
  w_neu := 'wohnen := round(hyp * zins_eff / 100 / 12) + round(preis * ' || u || ' / 100 / 12) + round(amort / 12);';
  t_neu := ' || '' ('' || zins_eff || '' % Zins, '' || ' || u || ' || '' % Unterhalt effektiv) − Ausgaben ''';
  if position(a_alt in def) > 0 then def := replace(def, a_alt, a_neu);
  elsif position(a_neu in def) = 0 then raise exception 'Amortisationszeile nicht gefunden'; end if;
  if position(w_alt in def) > 0 then def := replace(def, w_alt, w_neu);
  elsif position(w_neu in def) = 0 then raise exception 'Wohnen-Zeile nicht gefunden'; end if;
  if position(t_alt in def) > 0 then def := replace(def, t_alt, t_neu); end if;
  execute def;
end $$;

revoke execute on function public.objekt_score_berechnet(public.objekte) from public, anon;

-- Scores neu rechnen
select public.scores_berechnen();

-- 21.10.2026: Eigenkapital-Bausteine (erweitertes EK, Säule 3a pro Person, pro Inserat anpassbar),
-- grobe Steuerschätzung (Bund + ZH/SZ/SG, Steuerfuss der Gemeinde) und automatischer Score 0 bis 100
-- pro Inserat (beim Eintreffen in der DB, bei Änderungen und täglich per pg_cron neu gerechnet).
-- Nur additiv: keine drop/delete von Daten.

-- -----------------------------------------------------------------------------
-- Spalten
-- -----------------------------------------------------------------------------
alter table public.haushalt add column if not exists ek_erweitert bigint not null default 0;   -- z.B. Darlehen Götti
alter table public.haushalt add column if not exists kinder int not null default 2;            -- für die Steuerschätzung (gemeinsame Veranlagung)
alter table public.profiles add column if not exists saeule3a bigint not null default 0;       -- Säule 3a pro Person, standardmässig als EK eingesetzt
alter table public.gemeinden add column if not exists steuerfuss_kanton numeric(6,2);          -- Kantonssteuerfuss in % der einfachen Steuer
alter table public.gemeinden add column if not exists steuerfuss_bezirk numeric(6,2) not null default 0; -- SZ: Bezirk
alter table public.objekte add column if not exists heizung text;                              -- z.B. Wärmepumpe, Gas, Öl (vom Lauf oder Exposé)
alter table public.objekte add column if not exists score_auto int;                            -- 0..100, null solange kein Preis
alter table public.objekte add column if not exists score_auto_detail jsonb;                   -- Erklärung (Faktoren)
alter table public.objekte add column if not exists score_auto_am timestamptz;

update public.gemeinden set steuerfuss_kanton = case kanton when 'ZH' then 95 when 'SZ' then 110 when 'SG' then 105 end where steuerfuss_kanton is null;
update public.gemeinden set steuerfuss_bezirk = 14 where kanton = 'SZ' and steuerfuss_bezirk = 0 and name in ('Freienbach', 'Wollerau', 'Feusisberg');
update public.gemeinden set steuerfuss_bezirk = 30 where kanton = 'SZ' and steuerfuss_bezirk = 0 and name in ('Altendorf', 'Lachen', 'Tuggen', 'Galgenen', 'Schübelbach', 'Reichenburg', 'Wangen SZ', 'Wangen');

-- -----------------------------------------------------------------------------
-- Steuerschätzung (grob): gemeinsame Veranlagung, Tarife 2026, Pauschalabzüge.
-- Eigenmietwert und Schuldzinsen/Unterhalt werden als neutral angenommen.
-- Spiegelbild in src/lib/steuern.ts (bei Änderungen beide anpassen).
-- -----------------------------------------------------------------------------
create or replace function public.tarif_stufen(p_e numeric, p_grenzen numeric[], p_saetze numeric[])
returns numeric language plpgsql immutable as $$
declare s numeric := 0; u numeric := 0; i int; n int := coalesce(array_length(p_grenzen, 1), 0);
begin
  if p_e <= 0 then return 0; end if;
  for i in 1..array_length(p_saetze, 1) loop
    if i <= n and p_e > p_grenzen[i] then
      s := s + (p_grenzen[i] - u) * p_saetze[i] / 100; u := p_grenzen[i];
    else
      return s + (p_e - u) * p_saetze[i] / 100;
    end if;
  end loop;
  return s;
end $$;

-- Zahl mit Schweizer Tausendertrennzeichen
create or replace function public.chf_text(n numeric)
returns text language sql immutable as $$
  select replace(to_char(round(coalesce(n, 0)), 'FM999G999G999G999'), ',', '''');
$$;

-- Einfache Steuer (Kanton/Gemeinde) für gemeinsam Veranlagte
create or replace function public.steuer_einfach_kanton(p_kanton text, p_e numeric)
returns numeric language plpgsql immutable as $$
declare h numeric; pts_e numeric[] := array[0, 1000, 5000, 10000, 50000, 100000, 150000, 230400]; pts_s numeric[] := array[0, 2.5, 29.75, 114.25, 1335.25, 3252.80, 5202.80, 8409.60]; i int;
begin
  if p_e <= 0 then return 0; end if;
  if p_kanton = 'ZH' then
    return public.tarif_stufen(p_e, array[14100, 20500, 28600, 38400, 49600, 64100, 96300, 128700, 177200, 235100, 298000, 370600], array[0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  elsif p_kanton = 'SG' then
    -- Vollsplitting: Satz auf der Hälfte des Einkommens
    h := p_e / 2;
    if h > 264500 then return p_e * 8.5 / 100; end if;
    return 2 * public.tarif_stufen(h, array[11600, 15800, 33800, 60300, 98400, 264500], array[0, 4, 6, 8, 9.2, 9.4]);
  elsif p_kanton = 'SZ' then
    -- Splitting-Divisor 1.9; Tarif als Stützpunkte der einfachen Steuer (Schwyzer Steuerbuch 90.10, gültig ab 2026)
    h := p_e / 1.9;
    if h >= 230400 then return p_e * 3.65 / 100; end if;
    for i in 2..array_length(pts_e, 1) loop
      if h <= pts_e[i] then
        return 1.9 * (pts_s[i - 1] + (h - pts_e[i - 1]) * (pts_s[i] - pts_s[i - 1]) / (pts_e[i] - pts_e[i - 1]));
      end if;
    end loop;
    return p_e * 3.65 / 100;
  end if;
  return null;
end $$;

-- Direkte Bundessteuer, Verheiratetentarif 2026 (Teuerungsausgleich: Steuer ab 29'700, Höchstsatz ab 941'400)
create or replace function public.steuer_bund(p_e numeric, p_kinder int)
returns numeric language plpgsql immutable as $$
declare s numeric;
begin
  if p_e <= 0 then return 0; end if;
  if p_e > 941400 then s := p_e * 11.5 / 100;
  else s := public.tarif_stufen(p_e, array[29700, 53400, 61300, 79200, 94900, 108700, 120600, 130600, 138500, 144300, 148300, 150300, 152400, 941400], array[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  end if;
  return greatest(0, s - 263 * coalesce(p_kinder, 0));
end $$;

-- Gesamtschätzung pro Jahr. p_netto_jahr: Nettolohn pro Jahr je erwerbstätige Person (nach Sozialabzügen), p_weitere_jahr: Kinderzulagen u.ä.
create or replace function public.steuer_schaetzung(p_kanton text, p_steuerfuss_gesamt numeric, p_netto_jahr numeric[], p_weitere_jahr numeric, p_kinder int)
returns jsonb language plpgsql immutable as $$
declare
  brutto numeric := 0; n int := 0; tief numeric := null; e numeric;
  k_kind numeric; k_vers numeric; k_vers_kind numeric; k_zwei numeric; k_beruf numeric;
  abz_k numeric; abz_b numeric; stb_k numeric; stb_b numeric; einf numeric; kant numeric; bund numeric;
begin
  if p_kanton is null or p_steuerfuss_gesamt is null then return null; end if;
  foreach e in array coalesce(p_netto_jahr, array[]::numeric[]) loop
    if e > 0 then brutto := brutto + e; n := n + 1; tief := least(coalesce(tief, e), e); end if;
  end loop;
  brutto := brutto + coalesce(p_weitere_jahr, 0);
  if brutto <= 0 then return null; end if;
  if p_kanton = 'ZH' then k_kind := 9300; k_vers := 5400; k_vers_kind := 1400; k_zwei := 6100; k_beruf := 7500;
  elsif p_kanton = 'SG' then k_kind := 10800; k_vers := 6800; k_vers_kind := 1100; k_zwei := 500; k_beruf := 7000;
  elsif p_kanton = 'SZ' then k_kind := 9000; k_vers := 6400; k_vers_kind := 1000; k_zwei := 2100; k_beruf := 7000;
  else return null; end if;
  -- Abzüge Kanton: Berufskosten und Säule 3a pro erwerbstätige Person, Versicherungen, Kinder, Zweiverdiener
  abz_k := n * (k_beruf + 7258) + k_vers + k_vers_kind * coalesce(p_kinder, 0) + k_kind * coalesce(p_kinder, 0) + case when n >= 2 then k_zwei else 0 end;
  -- Abzüge Bund: Berufskosten 8'000, 3a 7'258, Versicherungen 3'700 + 700/Kind, Kinder 6'800, Zweiverdiener 50 % des tieferen Einkommens (8'600 bis 14'100)
  abz_b := n * (8000 + 7258) + 3700 + 700 * coalesce(p_kinder, 0) + 6800 * coalesce(p_kinder, 0) + case when n >= 2 then least(14100, greatest(8600, tief * 0.5)) else 0 end;
  stb_k := greatest(0, round((brutto - abz_k) / 100) * 100);
  stb_b := greatest(0, round((brutto - abz_b) / 100) * 100);
  einf := public.steuer_einfach_kanton(p_kanton, stb_k);
  kant := einf * p_steuerfuss_gesamt / 100;
  bund := public.steuer_bund(stb_b, p_kinder);
  return jsonb_build_object(
    'kanton', p_kanton, 'steuerfuss_gesamt', p_steuerfuss_gesamt, 'kinder', coalesce(p_kinder, 0), 'personen', n,
    'einkommen', round(brutto), 'steuerbar_kanton', stb_k, 'steuerbar_bund', stb_b,
    'einfache_steuer', round(einf), 'kanton_gemeinde', round(kant), 'bund', round(bund),
    'total', round(kant + bund), 'monat', round((kant + bund) / 12)
  );
end $$;

-- -----------------------------------------------------------------------------
-- Score 0..100 pro Objekt (objektive Faktoren; persönliche Bewertungen bleiben separat)
-- -----------------------------------------------------------------------------
create or replace function public.objekt_score_rechnen(o public.objekte)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  h public.haushalt%rowtype;
  g public.gemeinden%rowtype;
  ob jsonb := '{}'::jsonb;
  p record;
  f jsonb := '[]'::jsonb;
  hinweise text[] := array[]::text[];
  preis numeric := o.preis_chf;
  ek numeric; ek_basis numeric; ek_erw numeric; ek_3a numeric := 0;
  hyp numeric; bel numeric; ek_tief boolean := false;
  zins_eff numeric; nk numeric; amort numeric; kosten_bank numeric; eink_jahr numeric; quote numeric;
  netto_sum numeric := 0; netto_arr numeric[] := array[]::numeric[]; pens numeric; eink_monat numeric; weitere numeric;
  wohnen numeric; ausgaben numeric := 0; betrag numeric; steuer jsonb := null; steuer_monat numeric := null; posten_ueb jsonb;
  ueber numeric; sparq numeric;
  m2 numeric; med numeric; vgl text; ratio numeric;
  fl numeric := o.flaeche_m2; zi numeric := o.zimmer;
  jahr int := extract(year from current_date)::int;
  st_min numeric; st_max numeric; st_dies numeric;
  pz_avg numeric; pz_n int;
  pts numeric; total numeric := 0; maxsum numeric := 0; cap numeric := 100; faktor numeric := 1; v_kanton text;
begin
  select * into h from public.haushalt where id = 1;
  select g2.* into g from public.gemeinden g2 left join public.ortschaften ol on ol.gemeinde = g2.name where g2.name = o.ort or ol.ort = o.ort limit 1;
  v_kanton := coalesce(g.kanton, o.kanton);
  select daten into ob from public.objekt_budget where objekt_id = o.id;
  ob := coalesce(ob, '{}'::jsonb);

  if preis is null or preis <= 0 then
    return jsonb_build_object('score', null, 'faktoren', f, 'hinweise', array['Kein Preis bekannt, Score erst mit Preis'], 'stand', now());
  end if;

  -- Eigenkapital: Basis + erweitert + Säule 3a pro Person, pro Objekt überschreibbar (objekt_budget.daten.ek)
  ek_basis := coalesce((ob->'ek'->>'basis')::numeric, h.eigenkapital, 0);
  ek_erw := coalesce((ob->'ek'->>'erweitert')::numeric, h.ek_erweitert, 0);
  for p in select pr.id, pr.name, pr.saeule3a, pr.nettolohn_100_monat, pr.pensum_pct from public.profiles pr where pr.rolle <> 'leser' order by pr.created_at loop
    ek_3a := ek_3a + coalesce((ob->'ek'->'saeule3a'->>(p.id::text))::numeric, p.saeule3a, 0);
    pens := coalesce((ob->'pensum'->>(p.id::text))::numeric, p.pensum_pct, 100);
    betrag := round(coalesce(p.nettolohn_100_monat, 0) * pens / 100);
    netto_sum := netto_sum + betrag;
    if betrag > 0 then netto_arr := netto_arr || (betrag * 12); end if;
  end loop;
  ek := ek_basis + ek_erw + ek_3a;
  hyp := greatest(0, preis - ek);
  bel := hyp / preis;
  ek_tief := h.eigenkapital is not null and bel > h.belehnung_max / 100 + 1e-9;
  weitere := coalesce((ob->>'weitere_einkuenfte')::numeric, h.weitere_einkuenfte_monat, 0);
  eink_monat := netto_sum + weitere;
  eink_jahr := coalesce(h.einkommen_jahr, case when netto_sum > 0 then (eink_monat * 12) / 0.89 else null end);
  zins_eff := coalesce((ob->>'zins_effektiv')::numeric, h.zins_effektiv);
  nk := preis * h.nebenkosten_pct / 100;
  amort := greatest(0, hyp - 0.65 * preis) / greatest(1, h.amortisation_jahre);
  kosten_bank := hyp * h.zins_kalk / 100 + nk + amort;
  quote := case when eink_jahr is not null and eink_jahr > 0 then kosten_bank / eink_jahr else null end;

  -- 1. Tragbarkeit (Bank-Sicht), 18 Punkte
  if h.eigenkapital is null then
    pts := 9; f := f || jsonb_build_object('name', 'Tragbarkeit', 'punkte', pts, 'max', 18, 'text', 'Eigenkapital in den Einstellungen fehlt, neutral gewertet');
  elsif ek_tief then
    pts := 0; cap := least(cap, 40);
    f := f || jsonb_build_object('name', 'Tragbarkeit', 'punkte', pts, 'max', 18, 'text', 'Eigenkapital reicht nicht: Belehnung ' || round(bel * 100) || ' % bei CHF ' || public.chf_text(ek) || ' EK (max. ' || h.belehnung_max || ' %), Score auf 40 begrenzt');
  elsif quote is null then
    pts := 9; f := f || jsonb_build_object('name', 'Tragbarkeit', 'punkte', pts, 'max', 18, 'text', 'Einkommen fehlt, neutral gewertet');
  else
    pts := round(18 * least(1, greatest(0, (h.tragbarkeit_max + 8 - quote * 100) / 16)), 1);
    if quote * 100 > h.tragbarkeit_max + 5 then cap := least(cap, 45); end if;
    f := f || jsonb_build_object('name', 'Tragbarkeit', 'punkte', pts, 'max', 18, 'text', round(quote * 100) || ' % vom Einkommen bei ' || h.zins_kalk || ' % kalk. Zins (max. ' || h.tragbarkeit_max || ' %), Kosten CHF ' || public.chf_text(round(kosten_bank / 12)) || '/Mt, Hypothek CHF ' || public.chf_text(hyp) || ' mit EK CHF ' || public.chf_text(ek) || case when ek_3a > 0 then ' (davon 3a ' || public.chf_text(ek_3a) || ')' else '' end || case when quote * 100 > h.tragbarkeit_max + 5 then ', deutlich über dem Maximum: Score auf 45 begrenzt' when quote * 100 > h.tragbarkeit_max then ', knapp über dem Maximum' else '' end);
  end if;
  total := total + pts; maxsum := maxsum + 18;

  -- Steuern (für Budget und Faktor)
  if g.name is not null and g.steuerfuss is not null and g.steuerfuss_kanton is not null then
    steuer := public.steuer_schaetzung(g.kanton, g.steuerfuss + g.steuerfuss_kanton + coalesce(g.steuerfuss_bezirk, 0), netto_arr, weitere * 12, h.kinder);
    if steuer is not null then steuer_monat := (steuer->>'monat')::numeric; end if;
  end if;

  -- 2. Budget (effektiver Zins, Pensen, Standard-Ausgaben, Steuerschätzung für den Posten «Steuern»), 14 Punkte
  if eink_monat <= 0 then
    pts := 7; f := f || jsonb_build_object('name', 'Budget', 'punkte', pts, 'max', 14, 'text', 'Nettolöhne in den Einstellungen fehlen, neutral gewertet');
  else
    wohnen := round(hyp * zins_eff / 100 / 12) + round(nk / 12) + round(amort / 12);
    for p in select bp.id, bp.name, bp.betrag_monat from public.budget_posten bp loop
      posten_ueb := ob->'posten'->(p.id::text);
      if posten_ueb is not null then betrag := (ob->'posten'->>(p.id::text))::numeric;
      elsif p.name ~* 'steuer' and steuer_monat is not null then betrag := steuer_monat;
      else betrag := p.betrag_monat; end if;
      ausgaben := ausgaben + betrag;
    end loop;
    select coalesce(sum((x->>'betrag')::numeric), 0) into betrag from jsonb_array_elements(coalesce(ob->'extra', '[]'::jsonb)) x;
    ausgaben := ausgaben + betrag;
    ueber := eink_monat - wohnen - ausgaben;
    sparq := ueber / eink_monat;
    pts := round(14 * least(1, greatest(0, sparq / 0.25)), 1);
    if ueber < 0 then cap := least(cap, 50); end if;
    f := f || jsonb_build_object('name', 'Budget', 'punkte', pts, 'max', 14, 'text', case when ueber < 0 then 'Fehlbetrag CHF ' || public.chf_text(abs(round(ueber))) || '/Mt, Score auf 50 begrenzt' else 'Überschuss CHF ' || public.chf_text(round(ueber)) || '/Mt (' || round(sparq * 100) || ' % Sparquote)' end || ': Einkommen ' || public.chf_text(round(eink_monat)) || ' − Wohnen ' || public.chf_text(wohnen) || ' (' || zins_eff || ' % effektiv) − Ausgaben ' || public.chf_text(round(ausgaben)) || case when steuer_monat is not null then ' (Steuern geschätzt ' || public.chf_text(steuer_monat) || ')' else '' end);
  end if;
  total := total + pts; maxsum := maxsum + 14;

  -- 3. Preis pro m² im Vergleich (gleicher Kanton und Typ, sonst Kanton, sonst alle aktiven), 14 Punkte
  if fl is not null and fl > 0 then
    m2 := preis / fl;
    select percentile_cont(0.5) within group (order by x.preis_chf::numeric / x.flaeche_m2), count(*) into med, pz_n
      from public.objekte x left join public.ortschaften xo on xo.ort = x.ort left join public.gemeinden xg on xg.name = coalesce(xo.gemeinde, x.ort)
     where x.id is distinct from o.id and x.zusammengefuehrt_in is null and x.markt_status in ('aktiv', 'reserviert') and x.preis_chf > 0 and x.flaeche_m2 > 0
       and coalesce(xg.kanton, x.kanton) = v_kanton and x.typ = o.typ;
    vgl := 'aktive ' || case when o.typ = 'haus' then 'Häuser' when o.typ = 'wohnung' then 'Wohnungen' else 'Objekte' end || ' im Kanton ' || coalesce(v_kanton, '?');
    if pz_n < 5 then
      select percentile_cont(0.5) within group (order by x.preis_chf::numeric / x.flaeche_m2), count(*) into med, pz_n
        from public.objekte x left join public.ortschaften xo on xo.ort = x.ort left join public.gemeinden xg on xg.name = coalesce(xo.gemeinde, x.ort)
       where x.id is distinct from o.id and x.zusammengefuehrt_in is null and x.markt_status in ('aktiv', 'reserviert') and x.preis_chf > 0 and x.flaeche_m2 > 0
         and coalesce(xg.kanton, x.kanton) = v_kanton;
      vgl := 'aktive Objekte im Kanton ' || coalesce(v_kanton, '?');
    end if;
    if pz_n < 5 then
      select percentile_cont(0.5) within group (order by x.preis_chf::numeric / x.flaeche_m2), count(*) into med, pz_n
        from public.objekte x where x.id is distinct from o.id and x.zusammengefuehrt_in is null and x.markt_status in ('aktiv', 'reserviert') and x.preis_chf > 0 and x.flaeche_m2 > 0;
      vgl := 'alle aktiven Objekte';
    end if;
    if med is not null and med > 0 then
      ratio := m2 / med;
      pts := round(14 * least(1, greatest(0, (1.25 - ratio) / 0.4)), 1);
      f := f || jsonb_build_object('name', 'Preis pro m²', 'punkte', pts, 'max', 14, 'text', 'CHF ' || public.chf_text(round(m2)) || '/m², Median ' || public.chf_text(round(med)) || ' (' || pz_n || ' ' || vgl || '): ' || case when ratio < 0.97 then round((1 - ratio) * 100) || ' % günstiger' when ratio > 1.03 then round((ratio - 1) * 100) || ' % teurer' else 'im Mittel' end);
    else
      pts := 7; f := f || jsonb_build_object('name', 'Preis pro m²', 'punkte', pts, 'max', 14, 'text', 'CHF ' || public.chf_text(round(m2)) || '/m², noch keine Vergleichsobjekte, neutral');
    end if;
  else
    pts := 5; f := f || jsonb_build_object('name', 'Preis pro m²', 'punkte', pts, 'max', 14, 'text', 'Wohnfläche unbekannt');
  end if;
  total := total + pts; maxsum := maxsum + 14;

  -- 4. Wohnfläche: mindestens 115 m², darunter massive Abzüge, darüber leichter Bonus, 15 Punkte
  if fl is null then
    pts := 5; f := f || jsonb_build_object('name', 'Wohnfläche', 'punkte', pts, 'max', 15, 'text', 'unbekannt');
  elsif fl < 115 then
    pts := round(greatest(0, 10 - (115 - fl)), 1);
    f := f || jsonb_build_object('name', 'Wohnfläche', 'punkte', pts, 'max', 15, 'text', fl || ' m², unter dem Minimum von 115 m² (' || (115 - fl) || ' m² fehlen)');
  else
    pts := round(least(15, 10 + (fl - 115) * 0.1), 1);
    f := f || jsonb_build_object('name', 'Wohnfläche', 'punkte', pts, 'max', 15, 'text', fl || ' m²' || case when fl >= 165 then ', grosszügig' when fl > 115 then ', ' || (fl - 115) || ' m² über dem Minimum' else ', genau am Minimum' end);
  end if;
  total := total + pts; maxsum := maxsum + 15;

  -- 5. Zimmer: 4.5 ok, 5.5 ideal, 6.5 zu viel, 10 Punkte
  if zi is null then pts := 4; vgl := 'unbekannt';
  elsif zi < 4 then pts := 1; vgl := 'zu wenig';
  elsif zi < 4.5 then pts := 4; vgl := 'knapp';
  elsif zi < 5 then pts := 7; vgl := 'in Ordnung';
  elsif zi < 5.5 then pts := 8; vgl := 'gut';
  elsif zi < 6 then pts := 10; vgl := 'ideal';
  elsif zi < 6.5 then pts := 8; vgl := 'gut';
  elsif zi < 7 then pts := 6; vgl := 'eher zu gross';
  else pts := 4; vgl := 'zu gross'; end if;
  f := f || jsonb_build_object('name', 'Zimmer', 'punkte', pts, 'max', 10, 'text', coalesce(rtrim(rtrim(zi::text, '0'), '.') || ' Zimmer, ', '') || vgl);
  total := total + pts; maxsum := maxsum + 10;

  -- 6. Objekttyp, 4 Punkte (Haus ganz leicht bevorzugt)
  pts := case o.typ when 'haus' then 4 when 'wohnung' then 3.5 else 2 end;
  f := f || jsonb_build_object('name', 'Objekttyp', 'punkte', pts, 'max', 4, 'text', case o.typ when 'haus' then 'Haus' when 'wohnung' then 'Wohnung' else 'anderer Typ' end);
  total := total + pts; maxsum := maxsum + 4;

  -- 7. Baujahr, 8 Punkte
  if o.baujahr is null then pts := 4; vgl := 'unbekannt, neutral';
  elsif o.baujahr >= jahr - 1 then pts := 8; vgl := 'Neubau';
  elsif o.baujahr >= 2015 then pts := 7; vgl := 'neuwertig';
  elsif o.baujahr >= 2005 then pts := 6; vgl := 'jünger';
  elsif o.baujahr >= 1995 then pts := 5; vgl := 'mittleres Alter';
  elsif o.baujahr >= 1980 then pts := 4; vgl := 'älter, Renovationen möglich';
  elsif o.baujahr >= 1965 then pts := 3; vgl := 'alt, Renovationsbedarf wahrscheinlich';
  else pts := 2; vgl := 'sehr alt'; end if;
  f := f || jsonb_build_object('name', 'Baujahr', 'punkte', pts, 'max', 8, 'text', coalesce('Baujahr ' || o.baujahr || ', ', '') || vgl);
  total := total + pts; maxsum := maxsum + 8;

  -- 8. Heizung, 5 Punkte
  if o.heizung is null or btrim(o.heizung) = '' then pts := 3; vgl := 'unbekannt, neutral';
  elsif o.heizung ~* 'wärmepumpe|waermepumpe|erdsonde|erdwärme|fernwärme|fernwaerme|pellet|holz|solar|photovoltaik|seewasser' then pts := 5; vgl := 'erneuerbar';
  elsif o.heizung ~* 'gas' then pts := 2; vgl := 'fossil, Ersatz absehbar';
  elsif o.heizung ~* 'öl|oel|elektro' then pts := 0; vgl := 'fossil oder elektrisch, Ersatz nötig';
  else pts := 3; vgl := 'neutral'; end if;
  f := f || jsonb_build_object('name', 'Heizung', 'punkte', pts, 'max', 5, 'text', coalesce(o.heizung || ': ', '') || vgl);
  total := total + pts; maxsum := maxsum + 5;

  -- 9. Steuern der Gemeinde im Vergleich aller erfassten Gemeinden, 7 Punkte
  if steuer is not null then
    st_dies := (steuer->>'total')::numeric;
    select min((public.steuer_schaetzung(x.kanton, x.steuerfuss + x.steuerfuss_kanton + coalesce(x.steuerfuss_bezirk, 0), netto_arr, weitere * 12, h.kinder)->>'total')::numeric),
           max((public.steuer_schaetzung(x.kanton, x.steuerfuss + x.steuerfuss_kanton + coalesce(x.steuerfuss_bezirk, 0), netto_arr, weitere * 12, h.kinder)->>'total')::numeric)
      into st_min, st_max from public.gemeinden x where x.steuerfuss is not null and x.steuerfuss_kanton is not null;
    pts := case when st_max > st_min then round(7 * (st_max - st_dies) / (st_max - st_min), 1) else 3.5 end;
    f := f || jsonb_build_object('name', 'Steuern', 'punkte', pts, 'max', 7, 'text', g.name || ' ' || g.kanton || ': geschätzt CHF ' || public.chf_text(st_dies) || '/Jahr (' || public.chf_text(steuer_monat) || '/Mt) bei Steuerfuss ' || (steuer->>'steuerfuss_gesamt') || ' % gesamt; günstigste Gemeinde ' || public.chf_text(st_min) || ', teuerste ' || public.chf_text(st_max));
  else
    pts := 3; f := f || jsonb_build_object('name', 'Steuern', 'punkte', pts, 'max', 7, 'text', 'Gemeinde «' || o.ort || '» nicht erfasst oder ohne Steuerfuss, neutral');
  end if;
  total := total + pts; maxsum := maxsum + 7;

  -- 10. Pendelzeit ÖV (Mittel beider Personen), 5 Punkte
  select avg(pz.minuten), count(*) into pz_avg, pz_n from public.pendelzeiten pz join public.profiles pr on pr.id = pz.user_id and pr.rolle <> 'leser' where pz.objekt_id = o.id and pz.minuten is not null;
  if pz_n > 0 then
    pts := round(5 * least(1, greatest(0, (75 - pz_avg) / 45)), 1);
    f := f || jsonb_build_object('name', 'Pendeln ÖV', 'punkte', pts, 'max', 5, 'text', 'im Mittel ' || round(pz_avg) || ' Min (' || (select string_agg(pr.kuerzel || ' ' || pz.minuten || '''', ' · ') from public.pendelzeiten pz join public.profiles pr on pr.id = pz.user_id where pz.objekt_id = o.id and pz.minuten is not null) || ')');
  else
    pts := 2.5; f := f || jsonb_build_object('name', 'Pendeln ÖV', 'punkte', pts, 'max', 5, 'text', 'noch nicht berechnet, neutral');
  end if;
  total := total + pts; maxsum := maxsum + 5;

  -- Markt
  if o.markt_status in ('verkauft', 'offline') then faktor := 0; hinweise := array_append(hinweise, 'Objekt ist ' || case when o.markt_status = 'verkauft' then 'verkauft' else 'nicht mehr online' end || ': Score 0');
  elsif o.markt_status = 'reserviert' then faktor := 0.5; hinweise := array_append(hinweise, 'beim Makler reserviert: Score halbiert'); end if;
  if o.zusammengefuehrt_in is not null then faktor := 0; hinweise := array_append(hinweise, 'in ein anderes Objekt zusammengeführt'); end if;
  if cap < 100 then hinweise := array_append(hinweise, 'Obergrenze ' || cap || ' wegen Eigenkapital, Tragbarkeit oder Budget'); end if;

  total := round(least(cap, total) * faktor);
  return jsonb_build_object('score', greatest(0, least(100, total))::int, 'punkte_roh', round(total), 'max', maxsum, 'faktoren', f, 'hinweise', to_jsonb(hinweise), 'steuer', steuer, 'stand', now());
end $$;
revoke execute on function public.objekt_score_rechnen(public.objekte) from anon, public;
grant execute on function public.objekt_score_rechnen(public.objekte) to authenticated, service_role;

-- Trigger: Score beim Einfügen und bei relevanten Änderungen direkt setzen
create or replace function public.objekte_score_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := public.objekt_score_rechnen(new);
  new.score_auto := (r->>'score')::int;
  new.score_auto_detail := r;
  new.score_auto_am := now();
  return new;
end $$;
revoke execute on function public.objekte_score_trigger() from anon, authenticated, public;
create or replace trigger objekte_score before insert or update of preis_chf, zimmer, flaeche_m2, typ, ort, kanton, baujahr, heizung, markt_status, zusammengefuehrt_in on public.objekte
for each row execute function public.objekte_score_trigger();

-- Einzelnes Objekt neu rechnen
create or replace function public.objekt_score_setzen(p_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare o public.objekte%rowtype; r jsonb;
begin
  select * into o from public.objekte where id = p_id;
  if o.id is null then return null; end if;
  r := public.objekt_score_rechnen(o);
  update public.objekte set score_auto = (r->>'score')::int, score_auto_detail = r, score_auto_am = now() where id = p_id;
  return (r->>'score')::int;
end $$;
revoke execute on function public.objekt_score_setzen(uuid) from anon, public;
grant execute on function public.objekt_score_setzen(uuid) to authenticated, service_role;

-- Alle Objekte neu rechnen (täglich per pg_cron, nach Änderungen an Haushalt/Budget/Gemeinden, vom Lauf)
create or replace function public.scores_berechnen()
returns int language plpgsql security definer set search_path = public as $$
declare o public.objekte%rowtype; r jsonb; n int := 0;
begin
  for o in select * from public.objekte order by erstmals_gesehen loop
    r := public.objekt_score_rechnen(o);
    update public.objekte set score_auto = (r->>'score')::int, score_auto_detail = r, score_auto_am = now() where id = o.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.scores_berechnen() from anon, public;
grant execute on function public.scores_berechnen() to authenticated, service_role;

-- Nachrechnen, wenn sich Grundlagen ändern
create or replace function public.scores_nachrechnen_alle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.scores_berechnen();
  return null;
end $$;
create or replace function public.scores_nachrechnen_objekt()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.objekt_score_setzen(coalesce(new.objekt_id, old.objekt_id));
  return null;
end $$;
revoke execute on function public.scores_nachrechnen_alle() from anon, authenticated, public;
revoke execute on function public.scores_nachrechnen_objekt() from anon, authenticated, public;
create or replace trigger haushalt_scores after update on public.haushalt for each statement execute function public.scores_nachrechnen_alle();
create or replace trigger profiles_scores after update of nettolohn_100_monat, pensum_pct, saeule3a on public.profiles for each statement execute function public.scores_nachrechnen_alle();
create or replace trigger budget_posten_scores after insert or update or delete on public.budget_posten for each statement execute function public.scores_nachrechnen_alle();
create or replace trigger gemeinden_scores after insert or update on public.gemeinden for each statement execute function public.scores_nachrechnen_alle();
create or replace trigger objekt_budget_scores after insert or update on public.objekt_budget for each row execute function public.scores_nachrechnen_objekt();
create or replace trigger pendelzeiten_scores after insert or update on public.pendelzeiten for each row execute function public.scores_nachrechnen_objekt();

-- Täglich 05:45 (nach Mitternacht ändern sich Vergleichswerte und Marktstatus)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and not exists (select 1 from cron.job where jobname = 'scores-taeglich') then
    perform cron.schedule('scores-taeglich', '45 3 * * *', 'select public.scores_berechnen()');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Score-Modell pro Person: Gewicht 1..10 je Kriterium. Objektbewertung pro Person = gewichteter
-- Durchschnitt ihrer Kriterienbewertungen (1..5), «Gemeinsam» = Mittel der Personen. Ohne Eintrag Gewicht 5.
-- -----------------------------------------------------------------------------
create table if not exists public.kriterien_gewichte (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kriterium text not null references public.kriterien (code) on delete cascade,
  gewicht int not null default 5 check (gewicht between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (user_id, kriterium)
);
alter table public.kriterien_gewichte enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'kriterien_gewichte' and policyname = 'kg_select') then
    create policy kg_select on public.kriterien_gewichte for select to authenticated using (true);
    create policy kg_insert_own on public.kriterien_gewichte for insert to authenticated with check (user_id = auth.uid() and not public.ist_leser());
    create policy kg_update_own on public.kriterien_gewichte for update to authenticated using (user_id = auth.uid() and not public.ist_leser()) with check (user_id = auth.uid() and not public.ist_leser());
    create policy kg_delete_own on public.kriterien_gewichte for delete to authenticated using (user_id = auth.uid() and not public.ist_leser());
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- View: Kriterien-Scores gewichtet, neue Spalten am Ende
-- -----------------------------------------------------------------------------
create or replace view public.v_objekte_uebersicht with (security_invoker = true) as
select
  o.id, o.titel, o.ort, o.plz, o.kanton, o.adresse, o.typ, o.zimmer, o.flaeche_m2, o.grundstueck_m2, o.baujahr, o.preis_chf, o.markt_status, o.stufe_code, o.stufe_geaendert_am, o.erstmals_gesehen, o.zuletzt_gesehen, o.notizen, o.lage_hinweis, o.created_at, o.updated_at,
  s.name as stufe_name,
  s.phase as stufe_phase,
  s.phase_name as stufe_phase_name,
  s.sort as stufe_sort,
  s.terminal as stufe_terminal,
  coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'makler', q.makler, 'externe_id', q.externe_id, 'url', q.url, 'url_direkt', q.url_direkt, 'status', q.status, 'preis_chf', q.preis_chf, 'zuletzt_gesehen', q.zuletzt_gesehen, 'offline_seit', q.offline_seit, 'spiegel_von', q.spiegel_von) order by q.spiegel_von nulls first, q.url_direkt desc, q.erstmals_gesehen)
            from public.objekt_quellen q where q.objekt_id = o.id), '[]'::jsonb) as quellen,
  coalesce((select jsonb_object_agg(b.user_id, jsonb_build_object('sterne', b.sterne, 'favorit', b.favorit, 'uninteressant', b.uninteressant))
            from public.bewertungen b where b.objekt_id = o.id), '{}'::jsonb) as bewertungen,
  (select p.alt::bigint from public.snapshots p where p.objekt_id = o.id and p.typ = 'preis' order by p.datum desc limit 1) as preis_vorher_chf,
  (select p.datum from public.snapshots p where p.objekt_id = o.id and p.typ = 'preis' order by p.datum desc limit 1) as preis_geaendert_am,
  o.lat, o.lng, o.geo_genauigkeit, o.geo_suchtext, o.bild_url, o.bild_pfad, o.bild_fehler,
  o.offline_seit,
  coalesce((select jsonb_object_agg(k.user_id, k.score) from (
      select kb.user_id, round((sum(kb.wert * coalesce(gw.gewicht, 5))::numeric / sum(coalesce(gw.gewicht, 5))), 2) as score
        from public.kriterien_bewertungen kb left join public.kriterien_gewichte gw on gw.user_id = kb.user_id and gw.kriterium = kb.kriterium
       where kb.objekt_id = o.id group by kb.user_id) k), '{}'::jsonb) as kriterien_scores,
  (select round(avg(k.score), 2) from (
      select kb.user_id, (sum(kb.wert * coalesce(gw.gewicht, 5))::numeric / sum(coalesce(gw.gewicht, 5))) as score
        from public.kriterien_bewertungen kb left join public.kriterien_gewichte gw on gw.user_id = kb.user_id and gw.kriterium = kb.kriterium
       where kb.objekt_id = o.id group by kb.user_id) k) as score_gesamt,
  coalesce((select jsonb_object_agg(p.user_id, jsonb_build_object('minuten', p.minuten, 'umstiege', p.umstiege, 'von', p.von_station, 'nach', p.nach_station)) from public.pendelzeiten p where p.objekt_id = o.id and p.minuten is not null), '{}'::jsonb) as pendelzeiten,
  (select count(*) from public.objekt_bilder b where b.objekt_id = o.id and b.pfad is not null)::int as bilder_anzahl,
  (select max(a.datum) from public.aktivitaeten a where a.objekt_id = o.id and a.user_id is not null and a.typ in ('notiz','mail','telefon','besichtigung','termin')) as letzte_aktivitaet_am,
  (select a.user_id from public.aktivitaeten a where a.objekt_id = o.id and a.user_id is not null and a.typ in ('notiz','mail','telefon','besichtigung','termin') order by a.datum desc limit 1) as letzte_aktivitaet_user,
  (select v.zuletzt from public.objekt_besuche v where v.objekt_id = o.id and v.user_id = auth.uid()) as mein_besuch_am,
  g.name as gemeinde, g.kanton as gemeinde_kanton, g.steuerfuss, g.steuerfuss_jahr, g.steuer_index, g.steuer_beispiel_chf,
  (coalesce(o.offline_seit, current_date) - o.erstmals_gesehen)::int as tage_am_markt,
  o.zusammengefuehrt_in,
  g.steuerfuss_kanton, g.steuerfuss_bezirk,
  o.heizung, o.score_auto, o.score_auto_detail, o.score_auto_am
from public.objekte o
join public.pipeline_stufen s on s.code = o.stufe_code
left join public.ortschaften ol on ol.ort = o.ort
left join public.gemeinden g on g.name = coalesce(ol.gemeinde, o.ort);

-- Bestand einmalig rechnen
select public.scores_berechnen();

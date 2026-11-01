-- Neubau-Radar: Einschätzung von Claude (Score 0 bis 100) und Sterne pro Person auf jedem Projekt.
-- Nur additiv (keine drop/delete).
--
-- Score «Passt zu uns» (Claude), 100 Punkte:
--   Budget 25      CHF 2.5 Mio. Obergrenze; zählt, ob die grossen Einheiten im Budget liegen
--   Zimmer 12      5.5 Zi ideal, 4.5 Zi in Ordnung, nur 6.5+ zu gross, unter 4.5 zu klein
--   Fläche 13      ab 140 m² voll, 125 gut, 115 Minimum, darunter 0
--   Typ 10         Haus leicht bevorzugt (Haus 10, gemischt 9, Wohnung 8)
--   Lage 20        Einschätzung pro Gemeinde (Seenähe, Anbindung Zürich, Steuern), pro Projekt überschreibbar
--   Phase 20       Im Verkauf 20, Vormerkung 16, Geplant 10; ausverkauft und nur Miete = Score 0
-- Fehlende Angaben werden zurückhaltend gewertet. claude_fazit = Kurzeinschätzung in Worten (vom täglichen Lauf oder manuell).

alter table public.neubauprojekte add column if not exists claude_lage smallint check (claude_lage between 0 and 10); -- Überschreibt die Lage der Gemeinde
alter table public.neubauprojekte add column if not exists claude_fazit text;
alter table public.neubauprojekte add column if not exists claude_score int;
alter table public.neubauprojekte add column if not exists claude_score_detail jsonb;
alter table public.neubauprojekte add column if not exists claude_score_am timestamptz;

-- Lage pro Gemeinde (0 bis 10)
create or replace function public.radar_lage(p_gemeinde text) returns smallint
language sql immutable as $$
  select (case p_gemeinde
    when 'Rüschlikon' then 9 when 'Kilchberg' then 8 when 'Thalwil' then 8 when 'Oberrieden' then 8
    when 'Zollikon' then 8 when 'Küsnacht' then 8 when 'Erlenbach' then 8 when 'Herrliberg' then 8 when 'Meilen' then 8
    when 'Wollerau' then 8 when 'Freienbach' then 8
    when 'Horgen' then 7 when 'Wädenswil' then 7 when 'Richterswil' then 7 when 'Uetikon am See' then 7 when 'Männedorf' then 7
    when 'Stäfa' then 7 when 'Rapperswil-Jona' then 7 when 'Feusisberg' then 7
    when 'Hombrechtikon' then 6 when 'Zumikon' then 6 when 'Uster' then 6 when 'Altendorf' then 6 when 'Lachen' then 6
    when 'Adliswil' then 5 when 'Langnau am Albis' then 5 when 'Oetwil am See' then 5 when 'Egg' then 5 when 'Pfäffikon ZH' then 5
    when 'Galgenen' then 5 when 'Wangen SZ' then 5 when 'Schmerikon' then 5
    when 'Schübelbach' then 4 when 'Tuggen' then 4 when 'Eschenbach SG' then 4 when 'Uznach' then 4
    else 5 end)::smallint;
$$;

create or replace function public.chf_mio(p bigint) returns text
language sql immutable as $$ select 'CHF ' || to_char(p / 1000000.0, 'FM0.00') || ' Mio.'; $$;

create or replace function public.neubau_score_rechnen(p public.neubauprojekte) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  budget constant bigint := 2500000;
  f jsonb := '[]'::jsonb; h text[] := '{}'; pts numeric; total numeric := 0; txt text;
  zv numeric := coalesce(p.zimmer_von, p.zimmer_bis); zb numeric := coalesce(p.zimmer_bis, p.zimmer_von);
  fb int := coalesce(p.flaeche_bis, p.flaeche_von);
  t text := lower(coalesce(p.typ, ''));
  haus boolean; wohnung boolean; einzeltyp boolean; lage smallint; unbekannt int := 0;
  stark text[] := '{}'; schwach text[] := '{}'; fazit text; e jsonb;
begin
  if p.phase in ('ausverkauft', 'miete') then
    return jsonb_build_object('score', 0, 'faktoren', '[]'::jsonb, 'stand', now(),
      'hinweise', jsonb_build_array(case when p.phase = 'ausverkauft' then 'Ausverkauft, nicht mehr kaufbar' else 'Nur Miete, kein Kauf möglich' end),
      'fazit', coalesce(p.claude_fazit, 'Für uns nicht verfügbar.'));
  end if;

  haus := t ~ '(einfamilien|reihen|doppel|haus|häuser)';
  wohnung := t ~ '(wohnung|loft|maisonet|attika)';
  einzeltyp := (p.zimmer_von is not null and p.zimmer_von = p.zimmer_bis) or (p.flaeche_von is not null and p.flaeche_von = p.flaeche_bis);

  -- Budget (25)
  if p.preis_ab is null then
    pts := 10; txt := 'Preis noch nicht bekannt'; unbekannt := unbekannt + 1;
  elsif p.preis_ab > budget then
    pts := 0; txt := 'ab ' || chf_mio(p.preis_ab) || ', über dem Budget von ' || chf_mio(budget);
  elsif p.preis_bis is not null and p.preis_bis <= budget then
    pts := 25; txt := chf_mio(p.preis_ab) || ' bis ' || chf_mio(p.preis_bis) || ', alle Einheiten im Budget';
  elsif p.preis_bis is not null then
    pts := 18; txt := chf_mio(p.preis_ab) || ' bis ' || chf_mio(p.preis_bis) || ', die grössten Einheiten liegen über dem Budget';
  elsif einzeltyp then
    pts := case when p.preis_ab <= 2200000 then 25 else 20 end; txt := chf_mio(p.preis_ab) || ', im Budget';
  elsif p.preis_ab <= 1900000 then
    pts := 16; txt := 'ab ' || chf_mio(p.preis_ab) || ', Preis der grossen Einheiten noch offen';
  elsif p.preis_ab <= 2200000 then
    pts := 11; txt := 'ab ' || chf_mio(p.preis_ab) || ', grosse Einheiten vermutlich knapp';
  else
    pts := 6; txt := 'ab ' || chf_mio(p.preis_ab) || ', grosse Einheiten kaum im Budget';
  end if;
  f := f || jsonb_build_object('name', 'Budget', 'punkte', pts, 'max', 25, 'text', txt); total := total + pts;

  -- Zimmer (12)
  if zb is null then
    pts := 5; txt := 'Zimmerzahl noch nicht bekannt'; unbekannt := unbekannt + 1;
  elsif zv <= 5.5 and zb >= 5.5 then
    pts := 12; txt := case when zv = zb then '5.5 Zimmer, ideal' else trim_scale(zv)::text || ' bis ' || trim_scale(zb)::text || ' Zi, 5.5 Zi im Angebot (ideal)' end;
  elsif zb >= 4.5 and zb < 5.5 then
    pts := 8; txt := case when zv = zb then trim_scale(zb)::text || ' Zimmer, in Ordnung' else 'bis ' || trim_scale(zb)::text || ' Zi, in Ordnung (5.5 wäre ideal)' end;
  elsif zv >= 6 then
    pts := 5; txt := 'nur ' || trim_scale(zv)::text || ' Zi und mehr, eher zu gross';
  else
    pts := 0; txt := 'höchstens ' || trim_scale(zb)::text || ' Zi, zu klein';
  end if;
  f := f || jsonb_build_object('name', 'Zimmer', 'punkte', pts, 'max', 12, 'text', txt); total := total + pts;

  -- Fläche (13)
  if fb is null then
    pts := case when haus and not wohnung then 8 else 5 end;
    txt := 'Fläche noch nicht bekannt' || case when haus and not wohnung then ' (Häuser meist gross genug)' else '' end; unbekannt := unbekannt + 1;
  elsif fb >= 140 then pts := 13; txt := 'bis ' || fb || ' m², grosszügig';
  elsif fb >= 125 then pts := 10; txt := 'bis ' || fb || ' m², gut';
  elsif fb >= 115 then pts := 7; txt := 'bis ' || fb || ' m², knapp über dem Minimum von 115 m²';
  else pts := 0; txt := 'höchstens ' || fb || ' m², unter dem Minimum von 115 m²';
  end if;
  f := f || jsonb_build_object('name', 'Fläche', 'punkte', pts, 'max', 13, 'text', txt); total := total + pts;

  -- Typ (10)
  if t = '' then pts := 6; txt := 'Typ unbekannt';
  elsif haus and wohnung then pts := 9; txt := 'Wohnungen und Häuser';
  elsif haus then pts := 10; txt := p.typ || ', Haus leicht bevorzugt';
  else pts := 8; txt := p.typ || ', in Ordnung';
  end if;
  f := f || jsonb_build_object('name', 'Typ', 'punkte', pts, 'max', 10, 'text', txt); total := total + pts;

  -- Lage (20)
  lage := coalesce(p.claude_lage, radar_lage(p.gemeinde));
  pts := lage * 2;
  txt := coalesce(p.gemeinde, 'Gemeinde unbekannt') || ': ' || lage || ' von 10'
    || case when p.claude_lage is not null then ' (für dieses Projekt angepasst)' else ' (Seenähe, Anbindung Zürich, Steuern)' end;
  f := f || jsonb_build_object('name', 'Lage', 'punkte', pts, 'max', 20, 'text', txt); total := total + pts;

  -- Phase (20)
  pts := case p.phase when 'verkauf' then 20 when 'vormerkung' then 16 when 'geplant' then 10 else 0 end;
  txt := case p.phase when 'verkauf' then 'Im Verkauf, jetzt kaufbar' when 'vormerkung' then 'Vormerkung offen, früh dabei sein möglich'
    when 'geplant' then 'Erst geplant, Vermarktung offen; Chance, früh dabei zu sein' else 'Von euch als uninteressant markiert' end;
  f := f || jsonb_build_object('name', 'Phase', 'punkte', pts, 'max', 20, 'text', txt); total := total + pts;

  if unbekannt >= 2 then h := h || 'Wenig Angaben, Score vorläufig'; end if;
  if p.phase = 'uninteressant' then h := h || 'Von euch als uninteressant markiert'; end if;

  for e in select * from jsonb_array_elements(f) loop
    if (e->>'punkte')::numeric >= 0.75 * (e->>'max')::numeric then stark := stark || (e->>'name'); end if;
    if (e->>'punkte')::numeric <= 0.3 * (e->>'max')::numeric then schwach := schwach || (e->>'name'); end if;
  end loop;
  fazit := coalesce(p.claude_fazit,
    case when array_length(stark, 1) is not null then 'Stark: ' || array_to_string(stark, ', ') || '.' else '' end
    || case when array_length(schwach, 1) is not null then ' Schwach: ' || array_to_string(schwach, ', ') || '.' else '' end);

  return jsonb_build_object('score', round(total)::int, 'punkte_roh', total, 'max', 100, 'faktoren', f, 'hinweise', to_jsonb(h), 'fazit', trim(fazit), 'stand', now());
end $$;

create or replace function public.neubau_score_trigger() returns trigger
language plpgsql set search_path = public as $$
declare r jsonb;
begin
  r := public.neubau_score_rechnen(new);
  new.claude_score := (r->>'score')::int;
  new.claude_score_detail := r;
  new.claude_score_am := now();
  return new;
end $$;

create or replace trigger neubauprojekte_score before insert or update of phase, typ, zimmer_von, zimmer_bis, flaeche_von, flaeche_bis, preis_ab, preis_bis, gemeinde, claude_lage, claude_fazit
  on public.neubauprojekte for each row execute function public.neubau_score_trigger();

-- Bestand rechnen
update public.neubauprojekte n set claude_score = (r->>'score')::int, claude_score_detail = r, claude_score_am = now()
from (select id, public.neubau_score_rechnen(x) as r from public.neubauprojekte x) s where s.id = n.id;

-- Sterne pro Person (0 = keine Bewertung; kein Löschen nötig)
create table if not exists public.neubau_bewertungen (
  neubauprojekt_id uuid not null references public.neubauprojekte(id),
  user_id uuid not null references public.profiles(id),
  sterne smallint not null default 0 check (sterne between 0 and 5),
  aktualisiert_am timestamptz not null default now(),
  primary key (neubauprojekt_id, user_id)
);
alter table public.neubau_bewertungen enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'neubau_bewertungen' and policyname = 'nb_select') then
    create policy nb_select on public.neubau_bewertungen for select to authenticated using (true);
    create policy nb_insert_own on public.neubau_bewertungen for insert to authenticated with check (user_id = auth.uid() and not public.ist_leser());
    create policy nb_update_own on public.neubau_bewertungen for update to authenticated using (user_id = auth.uid() and not public.ist_leser()) with check (user_id = auth.uid() and not public.ist_leser());
  end if;
end $$;

grant execute on function public.neubau_score_rechnen(public.neubauprojekte) to authenticated, service_role;

-- Kurzeinschätzung (Claude) für die Projekte mit Angaben, Stand 28.10.2026. Der Trigger rechnet den Score dabei neu.
update public.neubauprojekte set claude_fazit = v.fazit from (values
  ('Alte Landstrasse', 'Meilen', 'Gute Lage mit Seesicht je nach Geschoss, 4.5 Zi bis 149 m² im Budget. 5.5 Zi fehlt, nur noch wenige Einheiten frei.'),
  ('AU VERDE', 'Wädenswil', '5.5 Zi bis 160 m² im Angebot. Bekannt ist nur der Einstiegspreis, Preis der grossen Einheiten prüfen.'),
  ('Bachgass', 'Uster', 'Ganzes Angebot im Budget, inkl. 5.5 Zi bis 156 m². Uster ohne Seenähe, die Hälfte ist schon reserviert.'),
  ('Frohe Aussicht 1, Uznach', 'Uznach', 'Sehr grosszügig (5.5 Zi ab 170 m²), Preis grösstenteils im Budget. Uznach liegt weit weg vom Zürichsee-Kern.'),
  ('Gartenhaus', 'Wädenswil', 'Höchstens 4.5 Zi, Preise und Flächen nur in der Preisliste. Die 4.5 Zi im 3./4. OG anschauen.'),
  ('GIARDINO', 'Horgen', '5.5 Zi vorhanden, aber schon der Einstieg liegt bei CHF 2.34 Mio. Die grossen Einheiten sind kaum im Budget.'),
  ('Grossacher', 'Hombrechtikon', 'Minergie-P, 5.5 Zi im Angebot, Einstieg tief. Preisliste der grossen Wohnungen prüfen.'),
  ('Limbergstrasse 14, Küsnacht', 'Küsnacht', '4.5 Zi mit 136 m² in Küsnacht für CHF 1.89 Mio. ist ein guter Wert. 5.5 Zi wäre ideal.'),
  ('MIRRO', 'Langnau am Albis', 'Maisonetten mit 5.5 bis 6.5 Zi (nur noch eine frei), sonst eher kleinere Wohnungen. Sihltal, weniger Seenähe.'),
  ('REBHUS', 'Zumikon', 'Kleines Projekt mit grosszügigen 4.5 Zi, aber am oberen Budgetrand.'),
  ('Sonnhalden', 'Uster', 'Reiheneinfamilienhäuser mit 5.5 Zi bis 157 m², alle im Budget. TG-Plätze kosten zusätzlich.'),
  ('Zwüschegass', 'Uster', 'Mix mit Reihenhäusern, Grössen und Preise der grossen Einheiten noch unklar.'),
  ('LUME', 'Küsnacht', 'Über dem Budget und höchstens 4.5 Zi.'),
  ('Sonnenrainstrasse 2, Eschenbach SG', 'Eschenbach SG', 'Grosses Reihenhaus zu gutem Preis, aber weit vom See.')
) as v(name, gemeinde, fazit)
where public.neubauprojekte.name = v.name and public.neubauprojekte.gemeinde = v.gemeinde;

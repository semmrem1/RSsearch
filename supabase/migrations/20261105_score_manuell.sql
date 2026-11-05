-- Manueller Score pro Inserat (05.11.2026), additiv
-- objekte.score_manuell übersteuert den berechneten Score dauerhaft (auch im täglichen Nachrechnen).
-- Die Berechnung selbst heisst neu objekt_score_berechnet(); objekt_score_rechnen() ist eine Hülle,
-- die den manuellen Wert übernimmt und den berechneten im Detail behält (score_berechnet).
-- Wichtig: Änderungen an der Berechnung künftig in objekt_score_berechnet() machen, nicht in objekt_score_rechnen().

alter table public.objekte add column if not exists score_manuell smallint;
alter table public.objekte add column if not exists score_manuell_grund text;
alter table public.objekte add column if not exists score_manuell_von uuid references public.profiles(id);
alter table public.objekte add column if not exists score_manuell_am timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'objekte_score_manuell_bereich') then
    alter table public.objekte add constraint objekte_score_manuell_bereich check (score_manuell is null or (score_manuell between 0 and 100));
  end if;
  -- Bisherige Berechnung umbenennen (nur einmal)
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'objekt_score_berechnet') then
    alter function public.objekt_score_rechnen(public.objekte) rename to objekt_score_berechnet;
  end if;
end $$;

create or replace function public.objekt_score_rechnen(o public.objekte)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  r jsonb := public.objekt_score_berechnet(o);
  berechnet int := (r->>'score')::int;
  wer text;
  hinweis text;
begin
  if o.score_manuell is null then return r; end if;
  if o.markt_status in ('verkauft', 'offline') or o.zusammengefuehrt_in is not null then
    return jsonb_set(r, '{hinweise}', coalesce(r->'hinweise', '[]'::jsonb) || to_jsonb('Manueller Score ' || o.score_manuell || ' ruht, solange das Objekt nicht aktiv ist'::text));
  end if;
  select pr.name into wer from public.profiles pr where pr.id = o.score_manuell_von;
  hinweis := 'Manuell auf ' || o.score_manuell || ' gesetzt'
    || coalesce(' von ' || wer, '')
    || coalesce(' am ' || to_char(o.score_manuell_am at time zone 'Europe/Zurich', 'DD.MM.YYYY'), '')
    || ' (berechnet ' || coalesce(berechnet::text, '–') || ')'
    || coalesce(': ' || nullif(btrim(o.score_manuell_grund), ''), '');
  return r || jsonb_build_object(
    'score', o.score_manuell,
    'manuell', true,
    'score_berechnet', berechnet,
    'manuell_grund', o.score_manuell_grund,
    'hinweise', jsonb_build_array(hinweis) || coalesce(r->'hinweise', '[]'::jsonb));
end $$;

revoke execute on function public.objekt_score_berechnet(public.objekte) from public, anon;

create or replace trigger objekte_score before insert or update of preis_chf, zimmer, flaeche_m2, typ, ort, kanton, baujahr, heizung, markt_status, zusammengefuehrt_in, score_manuell, score_manuell_grund on public.objekte
  for each row execute function public.objekte_score_trigger();

-- Bergweidstrasse Pfäffikon ZH: Finanzierung machbar, Steuern akzeptiert (Remo, 05.11.2026)
update public.objekte set
  score_manuell = 88,
  score_manuell_grund = 'Sehr interessantes Objekt. Finanzierung bekommen wir hin, die eher hohen Steuern sind in Ordnung (88 = Berechnung mit voller Tragbarkeit, Budget und Steuern)',
  score_manuell_von = '0bac3806-bc45-4b27-bd74-24353476706a',
  score_manuell_am = now()
where id = '9e1cfb9e-31ba-41b2-9a3c-adf8f0a118ba';

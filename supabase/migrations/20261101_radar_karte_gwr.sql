-- Neubau-Radar: Karte, GWR-Überwachung der geplanten Mehrfamilienbauten, «Kontakt sinnvoll», Merken pro Person, gemeinsame Kurznotiz.
-- Nur additiv (keine drop/delete). Setzt 20261028_radar_score_bewertung.sql voraus (Tabelle neubau_bewertungen).
--
-- Überwacht werden Projekte in Phase «geplant», die ein Mehrfamilienbau sind: verknüpftes Baugesuch mit Kategorie
-- mfh, ueberbauung oder reihen, oder Typ mit Wohnungen/Reihen/Doppel (public.neubau_mehrfamilien).
-- Die Edge Function radar-gwr (täglich per pg_cron) holt Koordinaten und den Gebäudestatus aus dem eidg. Gebäude- und
-- Wohnungsregister (GWR, geo.admin.ch): 1001 projektiert, 1002 bewilligt, 1003 im Bau, 1004 bestehend.
-- «Kontakt sinnvoll» wird gesetzt, sobald der Neubau bewilligt / im Bau / fertig ist oder ein Vermarkter bzw. eine Website auftaucht.

-- ---------- Spalten ----------
alter table public.neubauprojekte add column if not exists lat double precision;
alter table public.neubauprojekte add column if not exists lng double precision;
alter table public.neubauprojekte add column if not exists geo_genauigkeit text check (geo_genauigkeit in ('gwr', 'adresse', 'ort', 'manuell'));
alter table public.neubauprojekte add column if not exists geo_suchtext text;   -- Adresse|Gemeinde beim letzten Verorten
alter table public.neubauprojekte add column if not exists gwr_status smallint;  -- bester Status der neuen Gebäude (1001..1004)
alter table public.neubauprojekte add column if not exists gwr_status_seit date;
alter table public.neubauprojekte add column if not exists gwr_egid bigint;      -- EGID des Neubaus im GWR
alter table public.neubauprojekte add column if not exists gwr_wohnungen int;
alter table public.neubauprojekte add column if not exists gwr_detail jsonb;     -- gefundene Gebäude an der Adresse
alter table public.neubauprojekte add column if not exists gwr_geprueft_am timestamptz;
alter table public.neubauprojekte add column if not exists kontakt_sinnvoll_seit date;
alter table public.neubauprojekte add column if not exists kontakt_grund text;
alter table public.neubauprojekte add column if not exists kontakt_gemeldet_am date;
alter table public.neubauprojekte add column if not exists kurznotiz text;       -- gemeinsame Merkhilfe, z.B. «Seeblick, nah Bahnhof»
alter table public.neubauprojekte add column if not exists kurznotiz_von uuid references public.profiles(id);
alter table public.neubauprojekte add column if not exists kurznotiz_am timestamptz;

-- Merken pro Person (gleiche Zeile wie die Sterne; Entfernen = gemerkt false, kein Löschen)
alter table public.neubau_bewertungen add column if not exists gemerkt boolean not null default false;
alter table public.neubau_bewertungen add column if not exists gemerkt_am timestamptz;

-- ---------- Mehrfamilienbau? ----------
create or replace function public.neubau_mehrfamilien(p public.neubauprojekte) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from public.baugesuche b where b.neubauprojekt_id = p.id and b.kategorie in ('mfh', 'ueberbauung', 'reihen'))
      or (lower(coalesce(p.typ, '')) ~ '(wohnung|reihen|doppel|überbauung|mehrfamilien|loft|maisonet|attika)'
          and lower(coalesce(p.typ, '')) !~ '^einfamilienh');
$$;
grant execute on function public.neubau_mehrfamilien(public.neubauprojekte) to authenticated, service_role;

create or replace function public.gwr_status_text(p smallint) returns text
language sql immutable as $$
  select case p when 1001 then 'projektiert' when 1002 then 'bewilligt' when 1003 then 'im Bau' when 1004 then 'fertig'
    when 1007 then 'abgebrochen' when 1008 then 'nicht realisiert' else 'nicht im GWR' end;
$$;

-- ---------- «Kontakt sinnvoll» und Verlauf ----------
create or replace function public.neubau_kontakt_trigger() returns trigger
language plpgsql set search_path = public as $$
declare v_grund text;
begin
  if new.gwr_status is distinct from old.gwr_status then
    new.gwr_status_seit := current_date;
    insert into public.neubau_ereignisse (neubauprojekt_id, typ, alt, neu)
    values (new.id, 'gwr', public.gwr_status_text(old.gwr_status), public.gwr_status_text(new.gwr_status));
  end if;

  if new.phase = 'geplant' then
    v_grund := case
      when new.gwr_status = 1004 and old.gwr_status is distinct from 1004 then 'Neubau fertiggestellt (GWR)'
      when new.gwr_status = 1003 and old.gwr_status is distinct from 1003 then 'Im Bau (GWR)'
      when new.gwr_status = 1002 and old.gwr_status is distinct from 1002 then 'Baubewilligung erteilt (GWR)'
      when nullif(new.website, '') is not null and nullif(old.website, '') is null then 'Projektwebsite gefunden'
      when nullif(new.vermarkter, '') is not null and nullif(old.vermarkter, '') is null then 'Vermarkter gefunden: ' || new.vermarkter
      else null end;
    if v_grund is not null then
      if new.kontakt_sinnvoll_seit is null then
        new.kontakt_sinnvoll_seit := current_date;
        new.kontakt_gemeldet_am := null;
      end if;
      new.kontakt_grund := v_grund;
      insert into public.neubau_ereignisse (neubauprojekt_id, typ, neu) values (new.id, 'kontakt', 'Kontakt sinnvoll: ' || v_grund);
    end if;
  end if;
  return new;
end $$;

create or replace trigger neubauprojekte_kontakt before update of gwr_status, website, vermarkter
  on public.neubauprojekte for each row execute function public.neubau_kontakt_trigger();

-- Ein gemeinsamer Push für alle Projekte, die heute neu «Kontakt sinnvoll» sind (von radar-gwr und vom täglichen Lauf aufgerufen)
create or replace function public.neubau_kontakt_melden() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n int; v_text text; v_id uuid;
begin
  perform public.nur_mitglieder();
  select count(*), string_agg(name || ': ' || coalesce(kontakt_grund, 'Kontakt sinnvoll'), ' · ' order by name), min(id::text)::uuid
    into v_n, v_text, v_id
  from public.neubauprojekte
  where kontakt_sinnvoll_seit is not null and kontakt_gemeldet_am is null and phase = 'geplant';
  if v_n = 0 then return 0; end if;
  perform public.push_senden(
    case when v_n = 1 then 'Neubau: Kontakt sinnvoll' else v_n || ' Neubauten: Kontakt sinnvoll' end,
    left(v_text, 240),
    case when v_n = 1 then '/radar?projekt=' || v_id else '/radar?filter=kontakt' end);
  update public.neubauprojekte set kontakt_gemeldet_am = current_date
  where kontakt_sinnvoll_seit is not null and kontakt_gemeldet_am is null and phase = 'geplant';
  return v_n;
end $$;
revoke all on function public.neubau_kontakt_melden() from public, anon;
grant execute on function public.neubau_kontakt_melden() to authenticated, service_role;

-- GWR-Abgleich auslösen (asynchron über pg_net)
create or replace function public.radar_gwr_abrufen(p_body jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform public.nur_mitglieder();
  return public.edge_aufruf('radar-gwr', coalesce(p_body, '{}'::jsonb));
end $$;
revoke all on function public.radar_gwr_abrufen(jsonb) from public, anon;
grant execute on function public.radar_gwr_abrufen(jsonb) to authenticated, service_role;

-- Täglich 06:30 Schweizer Zeit im Winter (05:30 UTC), nach dem Baugesuch-Abruf, vor dem Claude-Lauf
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'neubau-radar-gwr') then
    perform cron.schedule('neubau-radar-gwr', '30 5 * * *', 'select public.radar_gwr_abrufen()');
  end if;
end $$;

-- ---------- Nur Mehrfamilienbauten unter «Geplant» ----------
-- Einzelne EFH und mehrere EFH in Phase «geplant» sind für Remo und Pascale nicht relevant (Entscheid 01.11.2026).
insert into public.neubau_ereignisse (neubauprojekt_id, typ, alt, neu)
select p.id, 'phase', 'geplant', 'uninteressant' from public.neubauprojekte p
where p.phase = 'geplant' and not public.neubau_mehrfamilien(p);
update public.neubauprojekte p set phase = 'uninteressant', aktualisiert_am = now()
where p.phase = 'geplant' and not public.neubau_mehrfamilien(p);

-- RSsearch Ausbau: Haushalt/Tragbarkeit, Kriterienkatalog, Pendelzeiten, Gemeinden/Steuern,
-- Galeriebilder, Web Push, Exposé-Extrakte, Objekte zusammenführen, Besuche.
-- Rein additiv (kein drop). Secrets werden separat in vault abgelegt (nicht im Repo).

create extension if not exists pg_net with schema extensions;

-- -----------------------------------------------------------------------------
-- Konfiguration (öffentliche Werte wie VAPID Public Key)
-- -----------------------------------------------------------------------------
create table if not exists public.konfig (
  key text primary key,
  wert text not null,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Haushalt: Finanzprofil für die Tragbarkeit (eine Zeile, gemeinsam)
-- -----------------------------------------------------------------------------
create table if not exists public.haushalt (
  id int primary key default 1 check (id = 1),
  eigenkapital bigint,
  einkommen_jahr bigint,
  zins_kalk numeric(4,2) not null default 5,
  nebenkosten_pct numeric(4,2) not null default 1,
  amortisation_jahre int not null default 15,
  belehnung_max numeric(4,1) not null default 80,
  tragbarkeit_max numeric(4,1) not null default 33,
  updated_at timestamptz not null default now()
);
insert into public.haushalt (id) values (1) on conflict (id) do nothing;

-- Arbeitsort pro Person (für Pendelzeit)
alter table public.profiles add column if not exists arbeitsort text;
alter table public.profiles add column if not exists arbeitsort_lat double precision;
alter table public.profiles add column if not exists arbeitsort_lng double precision;
alter table public.profiles add column if not exists arbeitsort_station text;

create table if not exists public.pendelzeiten (
  objekt_id uuid not null references public.objekte (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  minuten int,
  umstiege int,
  von_station text,
  nach_station text,
  fehler text,
  berechnet_am timestamptz not null default now(),
  primary key (objekt_id, user_id)
);

-- -----------------------------------------------------------------------------
-- Gemeinden & Steuern
-- -----------------------------------------------------------------------------
create table if not exists public.gemeinden (
  name text primary key,
  kanton text not null,
  bfs_nr int,
  steuerfuss numeric(6,2),
  steuerfuss_jahr int,
  steuerfuss_hinweis text,
  steuer_index numeric(6,1),
  steuer_index_hinweis text,
  steuer_beispiel_chf int,
  steuer_beispiel_hinweis text,
  quelle_url text,
  updated_at timestamptz not null default now()
);
-- Ortschaft (wie im Inserat) zu politischer Gemeinde
create table if not exists public.ortschaften (
  ort text primary key,
  gemeinde text not null references public.gemeinden (name) on update cascade
);

-- -----------------------------------------------------------------------------
-- Kriterienkatalog
-- -----------------------------------------------------------------------------
create table if not exists public.kriterien (
  code text primary key,
  name text not null,
  beschreibung text,
  sort int not null
);
insert into public.kriterien (code, name, beschreibung, sort) values
  ('lage',        'Lage',            'Quartier, Aussicht, Besonnung, Nachbarschaft', 10),
  ('laerm',       'Lärm',            'Strasse, Bahn, Flugverkehr, Gewerbe', 20),
  ('grundriss',   'Grundriss',       'Raumaufteilung, Zimmergrössen, Stauraum', 30),
  ('zustand',     'Zustand',         'Bausubstanz, Küche/Bad, Renovationsbedarf, Energie', 40),
  ('oev',         'ÖV & Pendeln',    'Anbindung, Weg zur Arbeit, Takt', 50),
  ('schule',      'Schule & Kita',   'Nähe, Schulweg, Betreuungsangebot', 60),
  ('aussenraum',  'Aussenraum',      'Garten, Balkon, Terrasse, Privatsphäre', 70),
  ('preis',       'Preis-Leistung',  'Preis pro m² im Vergleich, Verhandlungsspielraum', 80)
on conflict (code) do nothing;

create table if not exists public.kriterien_bewertungen (
  objekt_id uuid not null references public.objekte (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kriterium text not null references public.kriterien (code),
  wert int not null check (wert between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (objekt_id, user_id, kriterium)
);

-- Letzter Besuch pro Person (für "neu für dich")
create table if not exists public.objekt_besuche (
  objekt_id uuid not null references public.objekte (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  zuletzt timestamptz not null default now(),
  primary key (objekt_id, user_id)
);

-- -----------------------------------------------------------------------------
-- Galeriebilder (mehrere pro Objekt, Kopie im Bucket objektbilder)
-- -----------------------------------------------------------------------------
create table if not exists public.objekt_bilder (
  id uuid primary key default gen_random_uuid(),
  objekt_id uuid not null references public.objekte (id) on delete cascade,
  quelle_url text not null,
  pfad text,
  sort int not null default 0,
  fehler text,
  created_at timestamptz not null default now(),
  unique (objekt_id, quelle_url)
);
create index if not exists objekt_bilder_objekt_idx on public.objekt_bilder (objekt_id, sort);

create or replace function public.bilder_hinzufuegen(p_objekt_id uuid, p_urls text[])
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; u text; i int := 0;
begin
  if p_urls is null then return 0; end if;
  foreach u in array p_urls loop
    i := i + 1;
    if u is null or u !~* '^https?://' then continue; end if;
    insert into public.objekt_bilder (objekt_id, quelle_url, sort) values (p_objekt_id, u, i)
    on conflict (objekt_id, quelle_url) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function public.bilder_hinzufuegen(uuid, text[]) from anon, public;
grant execute on function public.bilder_hinzufuegen(uuid, text[]) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Web Push Abos
-- -----------------------------------------------------------------------------
create table if not exists public.push_abos (
  endpoint text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  zuletzt_ok timestamptz,
  fehler text
);
create index if not exists push_abos_user_idx on public.push_abos (user_id);

-- -----------------------------------------------------------------------------
-- Exposé-Extrakte (aus PDF via Claude)
-- -----------------------------------------------------------------------------
create table if not exists public.expose_extrakte (
  dokument_id uuid primary key references public.dokumente (id) on delete cascade,
  objekt_id uuid not null references public.objekte (id) on delete cascade,
  daten jsonb not null default '{}'::jsonb,
  zusammenfassung text,
  modell text,
  erstellt_am timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Quellen: Portal-Spiegel (z.B. Homegate-Link eines MoneyPark-Inserats)
-- -----------------------------------------------------------------------------
alter table public.objekt_quellen add column if not exists spiegel_von text;

-- -----------------------------------------------------------------------------
-- Aufrufe von Edge Functions aus SQL (pg_net), Secret aus Vault
-- -----------------------------------------------------------------------------
create or replace function public.edge_aufruf(p_funktion text, p_body jsonb)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text; v_id bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'app_secret' limit 1;
  if v_secret is null then raise exception 'Vault-Secret app_secret fehlt'; end if;
  select net.http_post(
    url := 'https://xnziilsffwdbvqxipxov.supabase.co/functions/v1/' || p_funktion,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-app-secret', v_secret),
    body := coalesce(p_body, '{}'::jsonb),
    timeout_milliseconds := 120000
  ) into v_id;
  return v_id;
end $$;
revoke execute on function public.edge_aufruf(text, jsonb) from anon, public;
grant execute on function public.edge_aufruf(text, jsonb) to authenticated, service_role;

-- Push an Personen (null = alle), z.B. select public.push_senden('Neu: Wädenswil', '4.5 Zi, CHF 1.81 Mio', '/inserate/<id>');
create or replace function public.push_senden(p_titel text, p_text text, p_url text default '/', p_user_ids uuid[] default null)
returns bigint language sql security definer set search_path = public as $$
  select public.edge_aufruf('push-senden', jsonb_build_object('titel', p_titel, 'text', p_text, 'url', coalesce(p_url, '/'), 'user_ids', to_jsonb(p_user_ids)));
$$;
revoke execute on function public.push_senden(text, text, text, uuid[]) from anon, public;
grant execute on function public.push_senden(text, text, text, uuid[]) to authenticated, service_role;

-- Bilder sichern und Pendelzeiten berechnen (vom täglichen Lauf aufzurufen)
create or replace function public.bilder_sichern()
returns bigint language sql security definer set search_path = public as $$
  select public.edge_aufruf('bild-sichern', jsonb_build_object('limit', 40));
$$;
create or replace function public.pendelzeiten_berechnen()
returns bigint language sql security definer set search_path = public as $$
  select public.edge_aufruf('pendelzeit', '{}'::jsonb);
$$;
revoke execute on function public.bilder_sichern() from anon, public;
revoke execute on function public.pendelzeiten_berechnen() from anon, public;
grant execute on function public.bilder_sichern() to authenticated, service_role;
grant execute on function public.pendelzeiten_berechnen() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Objekte manuell zusammenführen (Quelle geht in Ziel auf)
-- -----------------------------------------------------------------------------
create or replace function public.objekte_zusammenfuehren(p_quelle uuid, p_ziel uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare q public.objekte%rowtype; z public.objekte%rowtype;
begin
  if p_quelle = p_ziel then raise exception 'Quelle und Ziel sind dasselbe Objekt'; end if;
  select * into q from public.objekte where id = p_quelle;
  select * into z from public.objekte where id = p_ziel;
  if q.id is null or z.id is null then raise exception 'Objekt nicht gefunden'; end if;

  update public.objekt_quellen set objekt_id = p_ziel where objekt_id = p_quelle;
  update public.snapshots set objekt_id = p_ziel where objekt_id = p_quelle;
  update public.aktivitaeten set objekt_id = p_ziel where objekt_id = p_quelle;
  update public.dokumente set objekt_id = p_ziel where objekt_id = p_quelle;
  update public.standortfaktoren set objekt_id = p_ziel where objekt_id = p_quelle;
  update public.expose_extrakte set objekt_id = p_ziel where objekt_id = p_quelle;
  insert into public.objekt_bilder (objekt_id, quelle_url, pfad, sort, fehler)
    select p_ziel, quelle_url, pfad, sort + 100, fehler from public.objekt_bilder where objekt_id = p_quelle
    on conflict (objekt_id, quelle_url) do nothing;
  delete from public.objekt_bilder where objekt_id = p_quelle;
  insert into public.bewertungen (objekt_id, user_id, sterne, favorit, uninteressant, kommentar, tags)
    select p_ziel, user_id, sterne, favorit, uninteressant, kommentar, tags from public.bewertungen where objekt_id = p_quelle
    on conflict (objekt_id, user_id) do nothing;
  insert into public.kriterien_bewertungen (objekt_id, user_id, kriterium, wert)
    select p_ziel, user_id, kriterium, wert from public.kriterien_bewertungen where objekt_id = p_quelle
    on conflict (objekt_id, user_id, kriterium) do nothing;
  insert into public.pendelzeiten (objekt_id, user_id, minuten, umstiege, von_station, nach_station, fehler, berechnet_am)
    select p_ziel, user_id, minuten, umstiege, von_station, nach_station, fehler, berechnet_am from public.pendelzeiten where objekt_id = p_quelle
    on conflict (objekt_id, user_id) do nothing;

  update public.objekte set
    titel = coalesce(z.titel, q.titel),
    plz = coalesce(z.plz, q.plz),
    kanton = coalesce(z.kanton, q.kanton),
    adresse = case when z.adresse is null or (q.adresse is not null and z.adresse !~ '[0-9]' and q.adresse ~ '[0-9]') then q.adresse else z.adresse end,
    zimmer = coalesce(z.zimmer, q.zimmer),
    flaeche_m2 = coalesce(z.flaeche_m2, q.flaeche_m2),
    grundstueck_m2 = coalesce(z.grundstueck_m2, q.grundstueck_m2),
    baujahr = coalesce(z.baujahr, q.baujahr),
    preis_chf = coalesce(z.preis_chf, q.preis_chf),
    lage_hinweis = coalesce(z.lage_hinweis, q.lage_hinweis),
    notizen = case when q.notizen is null then z.notizen when z.notizen is null then q.notizen else z.notizen || E'\n' || q.notizen end,
    bild_url = coalesce(z.bild_url, q.bild_url),
    bild_pfad = coalesce(z.bild_pfad, q.bild_pfad),
    lat = coalesce(z.lat, q.lat), lng = coalesce(z.lng, q.lng),
    geo_genauigkeit = coalesce(z.geo_genauigkeit, q.geo_genauigkeit),
    geo_suchtext = coalesce(z.geo_suchtext, q.geo_suchtext),
    erstmals_gesehen = least(z.erstmals_gesehen, q.erstmals_gesehen),
    zuletzt_gesehen = greatest(z.zuletzt_gesehen, q.zuletzt_gesehen),
    markt_status = case when z.markt_status = 'aktiv' or q.markt_status = 'aktiv' then 'aktiv' else z.markt_status end
  where id = p_ziel;

  insert into public.snapshots (objekt_id, typ, neu, kommentar)
  values (p_ziel, 'dublette', q.ort || coalesce(', ' || q.adresse, ''), 'Manuell zusammengeführt (Quellen, Verlauf, Dokumente und Bewertungen übernommen)');
  delete from public.objekte where id = p_quelle;
  return p_ziel;
end $$;
revoke execute on function public.objekte_zusammenfuehren(uuid, uuid) from anon, public;
grant execute on function public.objekte_zusammenfuehren(uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- markiere_offline: Portal-Spiegel mitziehen
-- -----------------------------------------------------------------------------
create or replace function public.markiere_offline(p_makler text, p_stichtag date default current_date)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with q as (
    update public.objekt_quellen set status = 'offline', offline_seit = p_stichtag
     where status = 'aktiv' and zuletzt_gesehen < p_stichtag and (makler = p_makler or spiegel_von = p_makler)
    returning objekt_id
  )
  update public.objekte o set markt_status = 'offline', offline_seit = p_stichtag
   where o.id in (select objekt_id from q)
     and o.markt_status = 'aktiv'
     and not exists (select 1 from public.objekt_quellen x where x.objekt_id = o.id and x.status = 'aktiv');
  get diagnostics n = row_count;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- upsert_inserat mit Status (aktiv | reserviert | verkauft) und Spiegel-Quellen
-- -----------------------------------------------------------------------------
create or replace function public.upsert_inserat(
  p_makler text, p_externe_id text, p_url text, p_ort text, p_adresse text, p_typ text,
  p_zimmer numeric, p_flaeche_m2 int, p_preis_chf bigint, p_gesehen date,
  p_kanton text, p_lage_hinweis text, p_titel text, p_bild_url text, p_status text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_quelle public.objekt_quellen%rowtype;
  v_objekt_id uuid;
  v_status text := case when p_status in ('aktiv','reserviert','verkauft') then p_status else 'aktiv' end;
begin
  if not public.ist_direktlink(p_url) then
    raise exception 'upsert_inserat: p_url muss die Direkt-URL der Inserat-Detailseite sein (erhalten: %). Detailseite öffnen und deren URL verwenden.', coalesce(p_url, 'null');
  end if;

  if p_externe_id is not null then
    select * into v_quelle from public.objekt_quellen where makler = p_makler and externe_id = p_externe_id;
  end if;
  if v_quelle.id is null then
    select * into v_quelle from public.objekt_quellen where makler = p_makler and url = p_url;
  end if;

  if v_quelle.id is not null then
    update public.objekt_quellen
       set zuletzt_gesehen = greatest(zuletzt_gesehen, p_gesehen),
           preis_chf = coalesce(p_preis_chf, preis_chf),
           status = v_status,
           url = p_url,
           externe_id = coalesce(externe_id, p_externe_id)
     where id = v_quelle.id;
    update public.objekt_quellen set status = v_status, zuletzt_gesehen = greatest(zuletzt_gesehen, p_gesehen)
     where objekt_id = v_quelle.objekt_id and spiegel_von = p_makler;
    update public.objekte
       set zuletzt_gesehen = greatest(zuletzt_gesehen, p_gesehen),
           preis_chf = coalesce(p_preis_chf, preis_chf),
           flaeche_m2 = coalesce(p_flaeche_m2, flaeche_m2),
           zimmer = coalesce(p_zimmer, zimmer),
           adresse = coalesce(adresse, p_adresse),
           bild_url = coalesce(bild_url, p_bild_url),
           markt_status = case
             when v_status = 'aktiv' and markt_status in ('offline','unbekannt','reserviert') then 'aktiv'
             when v_status <> 'aktiv' and markt_status = 'aktiv'
                  and not exists (select 1 from public.objekt_quellen x where x.objekt_id = v_quelle.objekt_id and x.status = 'aktiv') then v_status
             else markt_status end
     where id = v_quelle.objekt_id;
    return v_quelle.objekt_id;
  end if;

  select o.id into v_objekt_id
    from public.objekte o
   where lower(o.ort) = lower(p_ort)
     and o.zimmer is not distinct from p_zimmer
     and (o.flaeche_m2 is null or p_flaeche_m2 is null or abs(o.flaeche_m2 - p_flaeche_m2) <= 3)
     and (o.preis_chf is null or p_preis_chf is null or abs(o.preis_chf - p_preis_chf)::numeric / greatest(o.preis_chf, 1) <= 0.02)
     and (p_adresse is null or o.adresse is null or lower(o.adresse) = lower(p_adresse))
     and not exists (select 1 from public.objekt_quellen x where x.objekt_id = o.id and x.makler = p_makler)
   order by o.erstmals_gesehen
   limit 1;

  if v_objekt_id is not null then
    insert into public.objekt_quellen (objekt_id, makler, externe_id, url, preis_chf, erstmals_gesehen, zuletzt_gesehen, status)
    values (v_objekt_id, p_makler, p_externe_id, p_url, p_preis_chf, p_gesehen, p_gesehen, v_status);
    insert into public.snapshots (objekt_id, typ, neu, kommentar, datum)
    values (v_objekt_id, 'neue_quelle', p_makler || coalesce(' ' || p_externe_id, ''), 'Als Dublette erkannt und zusammengeführt', p_gesehen::timestamptz);
    update public.objekte
       set zuletzt_gesehen = greatest(zuletzt_gesehen, p_gesehen),
           adresse = coalesce(adresse, p_adresse),
           preis_chf = coalesce(preis_chf, p_preis_chf),
           bild_url = coalesce(bild_url, p_bild_url),
           markt_status = case when v_status = 'aktiv' and markt_status in ('offline','unbekannt') then 'aktiv' else markt_status end
     where id = v_objekt_id;
    return v_objekt_id;
  end if;

  insert into public.objekte (titel, ort, kanton, adresse, typ, zimmer, flaeche_m2, preis_chf, erstmals_gesehen, zuletzt_gesehen, lage_hinweis, bild_url, markt_status)
  values (p_titel, p_ort, p_kanton, p_adresse, coalesce(p_typ, 'wohnung'), p_zimmer, p_flaeche_m2, p_preis_chf, p_gesehen, p_gesehen, p_lage_hinweis, p_bild_url, v_status)
  returning id into v_objekt_id;
  insert into public.objekt_quellen (objekt_id, makler, externe_id, url, preis_chf, erstmals_gesehen, zuletzt_gesehen, status)
  values (v_objekt_id, p_makler, p_externe_id, p_url, p_preis_chf, p_gesehen, p_gesehen, v_status);
  update public.snapshots set datum = p_gesehen::timestamptz where objekt_id = v_objekt_id and typ = 'erfasst';
  return v_objekt_id;
end $$;

-- 14-Parameter-Variante leitet weiter (Status aktiv)
create or replace function public.upsert_inserat(
  p_makler text, p_externe_id text, p_url text, p_ort text, p_adresse text, p_typ text,
  p_zimmer numeric, p_flaeche_m2 int, p_preis_chf bigint, p_gesehen date,
  p_kanton text, p_lage_hinweis text, p_titel text, p_bild_url text
) returns uuid language sql security definer set search_path = public as $$
  select public.upsert_inserat(p_makler, p_externe_id, p_url, p_ort, p_adresse, p_typ, p_zimmer, p_flaeche_m2, p_preis_chf, p_gesehen, p_kanton, p_lage_hinweis, p_titel, p_bild_url, 'aktiv');
$$;
revoke execute on function public.upsert_inserat(text,text,text,text,text,text,numeric,int,bigint,date,text,text,text,text,text) from anon, public;
grant execute on function public.upsert_inserat(text,text,text,text,text,text,numeric,int,bigint,date,text,text,text,text,text) to authenticated, service_role;

-- Spiegel-Quelle (Originalportal) zu einem bestehenden Objekt anlegen
create or replace function public.spiegel_quelle(p_objekt_id uuid, p_makler text, p_url text, p_spiegel_von text, p_externe_id text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_src public.objekt_quellen%rowtype;
begin
  select * into v_src from public.objekt_quellen where objekt_id = p_objekt_id and makler = p_spiegel_von limit 1;
  insert into public.objekt_quellen (objekt_id, makler, externe_id, url, preis_chf, status, erstmals_gesehen, zuletzt_gesehen, spiegel_von)
  values (p_objekt_id, p_makler, p_externe_id, p_url, v_src.preis_chf, coalesce(v_src.status, 'aktiv'), coalesce(v_src.erstmals_gesehen, current_date), coalesce(v_src.zuletzt_gesehen, current_date), p_spiegel_von)
  on conflict (makler, externe_id) do update set url = excluded.url, spiegel_von = excluded.spiegel_von
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.spiegel_quelle(uuid, text, text, text, text) from anon, public;
grant execute on function public.spiegel_quelle(uuid, text, text, text, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.konfig enable row level security;
alter table public.haushalt enable row level security;
alter table public.pendelzeiten enable row level security;
alter table public.gemeinden enable row level security;
alter table public.ortschaften enable row level security;
alter table public.kriterien enable row level security;
alter table public.kriterien_bewertungen enable row level security;
alter table public.objekt_besuche enable row level security;
alter table public.objekt_bilder enable row level security;
alter table public.push_abos enable row level security;
alter table public.expose_extrakte enable row level security;

do $$
declare t text;
begin
  foreach t in array array['konfig','haushalt','pendelzeiten','gemeinden','ortschaften','kriterien','objekt_bilder','expose_extrakte']
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_auth_all') then
      execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_auth_all', t);
    end if;
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'kriterien_bewertungen' and policyname = 'kb_select') then
    create policy kb_select on public.kriterien_bewertungen for select to authenticated using (true);
    create policy kb_write_own on public.kriterien_bewertungen for insert to authenticated with check (user_id = auth.uid());
    create policy kb_update_own on public.kriterien_bewertungen for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
    create policy kb_delete_own on public.kriterien_bewertungen for delete to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objekt_besuche' and policyname = 'besuche_select') then
    create policy besuche_select on public.objekt_besuche for select to authenticated using (true);
    create policy besuche_write_own on public.objekt_besuche for insert to authenticated with check (user_id = auth.uid());
    create policy besuche_update_own on public.objekt_besuche for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'push_abos' and policyname = 'push_own') then
    create policy push_own on public.push_abos for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- View: bestehende Spalten unverändert, neue am Ende
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
  coalesce((select jsonb_object_agg(k.user_id, k.score) from (select kb.user_id, round(avg(kb.wert)::numeric, 2) as score from public.kriterien_bewertungen kb where kb.objekt_id = o.id group by kb.user_id) k), '{}'::jsonb) as kriterien_scores,
  (select round(avg(kb.wert)::numeric, 2) from public.kriterien_bewertungen kb where kb.objekt_id = o.id) as score_gesamt,
  coalesce((select jsonb_object_agg(p.user_id, jsonb_build_object('minuten', p.minuten, 'umstiege', p.umstiege, 'von', p.von_station, 'nach', p.nach_station)) from public.pendelzeiten p where p.objekt_id = o.id and p.minuten is not null), '{}'::jsonb) as pendelzeiten,
  (select count(*) from public.objekt_bilder b where b.objekt_id = o.id and b.pfad is not null)::int as bilder_anzahl,
  (select max(a.datum) from public.aktivitaeten a where a.objekt_id = o.id and a.user_id is not null and a.typ in ('notiz','mail','telefon','besichtigung','termin')) as letzte_aktivitaet_am,
  (select a.user_id from public.aktivitaeten a where a.objekt_id = o.id and a.user_id is not null and a.typ in ('notiz','mail','telefon','besichtigung','termin') order by a.datum desc limit 1) as letzte_aktivitaet_user,
  (select v.zuletzt from public.objekt_besuche v where v.objekt_id = o.id and v.user_id = auth.uid()) as mein_besuch_am,
  g.name as gemeinde, g.kanton as gemeinde_kanton, g.steuerfuss, g.steuerfuss_jahr, g.steuer_index, g.steuer_beispiel_chf,
  (coalesce(o.offline_seit, current_date) - o.erstmals_gesehen)::int as tage_am_markt
from public.objekte o
join public.pipeline_stufen s on s.code = o.stufe_code
left join public.ortschaften ol on ol.ort = o.ort
left join public.gemeinden g on g.name = coalesce(ol.gemeinde, o.ort);

-- RSsearch: Schema v1
-- Immobilien-Tracker für zwei Personen. Alle Tabellen mit RLS, Zugriff nur für eingeloggte User.

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Profile (1:1 zu auth.users)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  kuerzel text not null,
  farbe text not null default '#1D5B84',
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Pipeline-Stufen (Stammdaten)
-- -----------------------------------------------------------------------------
create table if not exists public.pipeline_stufen (
  code text primary key,
  name text not null,
  phase int not null,
  phase_name text not null,
  sort int not null,
  terminal boolean not null default false,
  hinweis text
);

insert into public.pipeline_stufen (code, name, phase, phase_name, sort, terminal, hinweis) values
  ('neu',                    'Neu erfasst',                     1, 'Entdecken',              10, false, 'Vom täglichen Lauf eingespeist'),
  ('vorgemerkt',             'Vorgemerkt',                      1, 'Entdecken',              20, false, 'Mindestens eine Person interessiert'),
  ('doku_angefragt',         'Dokumentation angefragt',         2, 'Prüfen',                 30, false, 'Verkaufsdoku beim Makler bestellt'),
  ('doku_erhalten',          'Dokumentation erhalten',          2, 'Prüfen',                 40, false, 'Grundbuchauszug, STWE-Reglement, Erneuerungsfonds, GEAK'),
  ('besichtigung_angefragt', 'Besichtigung angefragt',          3, 'Besichtigen',            50, false, 'Termin beim Makler angefragt'),
  ('besichtigung_geplant',   'Besichtigung geplant',            3, 'Besichtigen',            60, false, 'Termin fix'),
  ('besichtigt',             'Besichtigt',                      3, 'Besichtigen',            70, false, 'Beide bewerten getrennt'),
  ('zweitbesichtigung',      'Zweitbesichtigung / Fachperson',  3, 'Besichtigen',            80, false, 'Optional mit Bauexperte oder Schätzer'),
  ('finanzierung_angefragt', 'Finanzierung angefragt',          4, 'Finanzierung & Angebot', 90, false, 'Bank prüft Tragbarkeit und Belehnung'),
  ('finanzierung_bestaetigt','Finanzierungsbestätigung',        4, 'Finanzierung & Angebot', 100, false, 'Wird mit dem Angebot eingereicht'),
  ('angebot_abgegeben',      'Kaufangebot abgegeben',           4, 'Finanzierung & Angebot', 110, false, 'Festpreis oder Gebot im Bieterverfahren'),
  ('zusage',                 'Zusage erhalten',                 4, 'Finanzierung & Angebot', 120, false, 'Verkäufer wählt uns als Käufer'),
  ('reservation',            'Reservation',                     5, 'Abschluss',              130, false, 'Reservationsvereinbarung und Anzahlung'),
  ('kaufvertrag_entwurf',    'Kaufvertragsentwurf',             5, 'Abschluss',              140, false, 'Vom Notar, Prüfung durch uns und Bank'),
  ('hypothek',               'Hypothek abgeschlossen',          5, 'Abschluss',              150, false, 'Modell und Laufzeit fixiert'),
  ('beurkundung',            'Beurkundung',                     5, 'Abschluss',              160, false, 'Notartermin, ab hier verbindlich'),
  ('grundbuch',              'Grundbucheintrag',                5, 'Abschluss',              170, false, 'Eigentumsübergang'),
  ('uebergabe',              'Schlüsselübergabe',               5, 'Abschluss',              180, true,  'Übergabeprotokoll, Mängelliste'),
  ('vom_markt',              'Vom Markt',                       9, 'Ausgeschieden',          190, true,  'Verkauft, reserviert oder offline'),
  ('abgesagt',               'Von uns abgesagt',                9, 'Ausgeschieden',          200, true,  'Mit Grund'),
  ('nicht_erhalten',         'Nicht erhalten',                  9, 'Ausgeschieden',          210, true,  'Anderer Käufer gewählt')
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Objekte (ein Datensatz pro physischem Objekt, Makler-Inserate hängen daran)
-- -----------------------------------------------------------------------------
create table if not exists public.objekte (
  id uuid primary key default gen_random_uuid(),
  titel text,
  ort text not null,
  plz text,
  kanton text,
  adresse text,
  typ text not null default 'wohnung' check (typ in ('wohnung','haus','andere')),
  zimmer numeric(4,1),
  flaeche_m2 int,
  grundstueck_m2 int,
  baujahr int,
  preis_chf bigint,
  markt_status text not null default 'aktiv' check (markt_status in ('aktiv','reserviert','verkauft','offline','unbekannt')),
  stufe_code text not null default 'neu' references public.pipeline_stufen (code),
  stufe_geaendert_am timestamptz not null default now(),
  erstmals_gesehen date not null default current_date,
  zuletzt_gesehen date not null default current_date,
  notizen text,
  lage_hinweis text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists objekte_stufe_idx on public.objekte (stufe_code);
create index if not exists objekte_markt_idx on public.objekte (markt_status);

-- -----------------------------------------------------------------------------
-- Makler-Inserate (Quellen). Dasselbe Objekt kann bei mehreren Maklern laufen.
-- -----------------------------------------------------------------------------
create table if not exists public.objekt_quellen (
  id uuid primary key default gen_random_uuid(),
  objekt_id uuid not null references public.objekte (id) on delete cascade,
  makler text not null,
  externe_id text,
  url text,
  preis_chf bigint,
  status text not null default 'aktiv' check (status in ('aktiv','reserviert','verkauft','offline','unbekannt')),
  erstmals_gesehen date not null default current_date,
  zuletzt_gesehen date not null default current_date,
  kontakt text,
  created_at timestamptz not null default now(),
  unique (makler, externe_id)
);
create index if not exists objekt_quellen_objekt_idx on public.objekt_quellen (objekt_id);

-- -----------------------------------------------------------------------------
-- Snapshots: jede erkannte Änderung (Preis, Status, Fläche ...)
-- -----------------------------------------------------------------------------
create table if not exists public.snapshots (
  id bigint generated always as identity primary key,
  objekt_id uuid not null references public.objekte (id) on delete cascade,
  quelle_id uuid references public.objekt_quellen (id) on delete set null,
  datum timestamptz not null default now(),
  typ text not null check (typ in ('erfasst','preis','status','flaeche','zimmer','bestaetigt','neue_quelle','dublette','sonstiges')),
  alt text,
  neu text,
  kommentar text
);
create index if not exists snapshots_objekt_idx on public.snapshots (objekt_id, datum desc);
create index if not exists snapshots_datum_idx on public.snapshots (datum desc);

-- -----------------------------------------------------------------------------
-- Aktivitäten: manuelle und automatische Timeline-Einträge
-- -----------------------------------------------------------------------------
create table if not exists public.aktivitaeten (
  id bigint generated always as identity primary key,
  objekt_id uuid not null references public.objekte (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  typ text not null default 'notiz' check (typ in ('notiz','mail','telefon','besichtigung','termin','stufe','system','dokument')),
  titel text not null,
  text text,
  datum timestamptz not null default now(),
  faellig_am timestamptz,
  erledigt boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists aktivitaeten_objekt_idx on public.aktivitaeten (objekt_id, datum desc);
create index if not exists aktivitaeten_faellig_idx on public.aktivitaeten (faellig_am) where erledigt = false and faellig_am is not null;

-- -----------------------------------------------------------------------------
-- Bewertungen pro Person
-- -----------------------------------------------------------------------------
create table if not exists public.bewertungen (
  objekt_id uuid not null references public.objekte (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  sterne int not null default 0 check (sterne between 0 and 5),
  favorit boolean not null default false,
  uninteressant boolean not null default false,
  kommentar text,
  tags text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (objekt_id, user_id)
);

-- -----------------------------------------------------------------------------
-- Dokumente (Dateien liegen im Storage-Bucket "dokumente")
-- -----------------------------------------------------------------------------
create table if not exists public.dokumente (
  id uuid primary key default gen_random_uuid(),
  objekt_id uuid not null references public.objekte (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  name text not null,
  storage_path text not null,
  groesse_bytes bigint,
  mime text,
  kategorie text default 'sonstiges' check (kategorie in ('expose','grundriss','grundbuch','stwe','finanzierung','vertrag','sonstiges')),
  created_at timestamptz not null default now()
);
create index if not exists dokumente_objekt_idx on public.dokumente (objekt_id);

-- -----------------------------------------------------------------------------
-- Standortfaktoren (auf Anfrage recherchiert, nur Anzeige in der App)
-- -----------------------------------------------------------------------------
create table if not exists public.standortfaktoren (
  id bigint generated always as identity primary key,
  objekt_id uuid not null references public.objekte (id) on delete cascade,
  titel text not null,
  text text,
  bewertung text not null default 'neutral' check (bewertung in ('positiv','neutral','negativ')),
  quelle_url text,
  stand date not null default current_date
);
create index if not exists standortfaktoren_objekt_idx on public.standortfaktoren (objekt_id);

-- -----------------------------------------------------------------------------
-- Lauf-Protokoll des täglichen Monitorings
-- -----------------------------------------------------------------------------
create table if not exists public.lauf_protokoll (
  id bigint generated always as identity primary key,
  gestartet_am timestamptz not null default now(),
  beendet_am timestamptz,
  makler text not null,
  geprueft boolean not null default true,
  anzahl_inserate int,
  neue int not null default 0,
  geaendert int not null default 0,
  fehler text
);
create index if not exists lauf_protokoll_datum_idx on public.lauf_protokoll (gestartet_am desc);

-- -----------------------------------------------------------------------------
-- Trigger: updated_at, Preis-/Status-Snapshots, Stufenwechsel-Aktivität
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists objekte_set_updated_at on public.objekte;
create trigger objekte_set_updated_at before update on public.objekte
for each row execute function public.set_updated_at();

create or replace function public.objekte_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.snapshots (objekt_id, typ, neu, kommentar)
  values (new.id, 'erfasst', new.preis_chf::text, coalesce(new.ort, '') || ' · ' || coalesce(new.zimmer::text, '?') || ' Zi · ' || coalesce(new.flaeche_m2::text, '?') || ' m²');
  return new;
end $$;

drop trigger if exists objekte_after_insert on public.objekte;
create trigger objekte_after_insert after insert on public.objekte
for each row execute function public.objekte_after_insert();

create or replace function public.objekte_track_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    return new;
  end if;
  if new.preis_chf is distinct from old.preis_chf then
    insert into public.snapshots (objekt_id, typ, alt, neu)
    values (new.id, 'preis', old.preis_chf::text, new.preis_chf::text);
  end if;
  if new.markt_status is distinct from old.markt_status then
    insert into public.snapshots (objekt_id, typ, alt, neu)
    values (new.id, 'status', old.markt_status, new.markt_status);
    -- Objekt ist vom Markt: automatisch in "Vom Markt" verschieben, falls noch nicht in einer Endstufe
    if new.markt_status in ('verkauft','offline','reserviert') and new.stufe_code not in ('vom_markt','abgesagt','nicht_erhalten','uebergabe','grundbuch','beurkundung') then
      new.stufe_code := 'vom_markt';
    end if;
  end if;
  if new.flaeche_m2 is distinct from old.flaeche_m2 then
    insert into public.snapshots (objekt_id, typ, alt, neu)
    values (new.id, 'flaeche', old.flaeche_m2::text, new.flaeche_m2::text);
  end if;
  if new.zimmer is distinct from old.zimmer then
    insert into public.snapshots (objekt_id, typ, alt, neu)
    values (new.id, 'zimmer', old.zimmer::text, new.zimmer::text);
  end if;
  if new.stufe_code is distinct from old.stufe_code then
    new.stufe_geaendert_am := now();
    insert into public.aktivitaeten (objekt_id, user_id, typ, titel, text)
    select new.id, auth.uid(), 'stufe', s.name, 'Stufe gewechselt von «' || o.name || '» zu «' || s.name || '»'
    from public.pipeline_stufen s, public.pipeline_stufen o
    where s.code = new.stufe_code and o.code = old.stufe_code;
  end if;
  return new;
end $$;

drop trigger if exists objekte_track_changes on public.objekte;
create trigger objekte_track_changes before insert or update on public.objekte
for each row execute function public.objekte_track_changes();

-- Vorgemerkt: sobald jemand Favorit setzt und das Objekt noch "neu" ist
create or replace function public.bewertung_vormerken()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.favorit or new.sterne > 0 then
    update public.objekte set stufe_code = 'vorgemerkt' where id = new.objekt_id and stufe_code = 'neu';
  end if;
  return new;
end $$;

drop trigger if exists bewertungen_vormerken on public.bewertungen;
create trigger bewertungen_vormerken before insert or update on public.bewertungen
for each row execute function public.bewertung_vormerken();

-- Profil automatisch anlegen, Name aus user_metadata
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, kuerzel, farbe)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'kuerzel', upper(left(coalesce(new.raw_user_meta_data->>'name', new.email), 1))),
    coalesce(new.raw_user_meta_data->>'farbe', '#1D5B84')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- RLS: nur eingeloggte User, beide sehen alles; Bewertungen nur eigene schreiben
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.pipeline_stufen enable row level security;
alter table public.objekte enable row level security;
alter table public.objekt_quellen enable row level security;
alter table public.snapshots enable row level security;
alter table public.aktivitaeten enable row level security;
alter table public.bewertungen enable row level security;
alter table public.dokumente enable row level security;
alter table public.standortfaktoren enable row level security;
alter table public.lauf_protokoll enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles','pipeline_stufen','objekte','objekt_quellen','snapshots','aktivitaeten','dokumente','standortfaktoren','lauf_protokoll']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_auth_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_auth_all', t);
  end loop;
end $$;

drop policy if exists bewertungen_select on public.bewertungen;
create policy bewertungen_select on public.bewertungen for select to authenticated using (true);
drop policy if exists bewertungen_write_own on public.bewertungen;
create policy bewertungen_write_own on public.bewertungen for insert to authenticated with check (user_id = auth.uid());
drop policy if exists bewertungen_update_own on public.bewertungen;
create policy bewertungen_update_own on public.bewertungen for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists bewertungen_delete_own on public.bewertungen;
create policy bewertungen_delete_own on public.bewertungen for delete to authenticated using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Storage: privater Bucket für Dokumente
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('dokumente', 'dokumente', false, 52428800)
on conflict (id) do nothing;

drop policy if exists dokumente_auth_select on storage.objects;
create policy dokumente_auth_select on storage.objects for select to authenticated using (bucket_id = 'dokumente');
drop policy if exists dokumente_auth_insert on storage.objects;
create policy dokumente_auth_insert on storage.objects for insert to authenticated with check (bucket_id = 'dokumente');
drop policy if exists dokumente_auth_delete on storage.objects;
create policy dokumente_auth_delete on storage.objects for delete to authenticated using (bucket_id = 'dokumente');

-- -----------------------------------------------------------------------------
-- View für die Übersicht: Objekt + Stufe + Quellen + Bewertungen + letzter Preis-Snapshot
-- -----------------------------------------------------------------------------
create or replace view public.v_objekte_uebersicht with (security_invoker = true) as
select
  o.*,
  s.name as stufe_name,
  s.phase as stufe_phase,
  s.phase_name as stufe_phase_name,
  s.sort as stufe_sort,
  s.terminal as stufe_terminal,
  coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'makler', q.makler, 'externe_id', q.externe_id, 'url', q.url, 'status', q.status, 'preis_chf', q.preis_chf) order by q.erstmals_gesehen)
            from public.objekt_quellen q where q.objekt_id = o.id), '[]'::jsonb) as quellen,
  coalesce((select jsonb_object_agg(b.user_id, jsonb_build_object('sterne', b.sterne, 'favorit', b.favorit, 'uninteressant', b.uninteressant))
            from public.bewertungen b where b.objekt_id = o.id), '{}'::jsonb) as bewertungen,
  (select p.alt::bigint from public.snapshots p where p.objekt_id = o.id and p.typ = 'preis' order by p.datum desc limit 1) as preis_vorher_chf,
  (select p.datum from public.snapshots p where p.objekt_id = o.id and p.typ = 'preis' order by p.datum desc limit 1) as preis_geaendert_am
from public.objekte o
join public.pipeline_stufen s on s.code = o.stufe_code;

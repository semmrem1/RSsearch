-- Neubau-Radar: Baugesuche (ZH, SZ, SG) und Neubauprojekte in der Zürichsee-Region.
-- Nur additiv (keine drop/delete).

-- 1) Gemeinden im Radar (unabhängig von public.gemeinden, damit auch Gemeinden ohne Steuerdaten drin sein können)
create table if not exists public.radar_gemeinden (
  name text primary key,
  kanton text not null check (kanton in ('ZH', 'SZ', 'SG')),
  bfs_nr int,
  aktiv boolean not null default true,
  hinweis text,
  updated_at timestamptz not null default now()
);

insert into public.radar_gemeinden (name, kanton, bfs_nr, aktiv, hinweis) values
  ('Kilchberg', 'ZH', 135, true, null),
  ('Rüschlikon', 'ZH', 139, true, null),
  ('Thalwil', 'ZH', 141, true, null),
  ('Oberrieden', 'ZH', 137, true, null),
  ('Horgen', 'ZH', 295, true, 'inkl. Hirzel'),
  ('Wädenswil', 'ZH', 293, true, 'inkl. Au, Schönenberg, Hütten'),
  ('Richterswil', 'ZH', 138, true, 'inkl. Samstagern'),
  ('Adliswil', 'ZH', 131, true, 'Hinterland linkes Ufer'),
  ('Langnau am Albis', 'ZH', 136, true, 'Hinterland linkes Ufer'),
  ('Zollikon', 'ZH', 161, true, 'inkl. Zollikerberg'),
  ('Küsnacht', 'ZH', 154, true, null),
  ('Erlenbach', 'ZH', 151, true, null),
  ('Herrliberg', 'ZH', 152, true, null),
  ('Meilen', 'ZH', 156, true, null),
  ('Uetikon am See', 'ZH', 159, true, null),
  ('Männedorf', 'ZH', 155, true, null),
  ('Stäfa', 'ZH', 158, true, 'inkl. Uerikon'),
  ('Hombrechtikon', 'ZH', 153, true, 'inkl. Feldbach'),
  ('Oetwil am See', 'ZH', 157, true, 'Hinterland rechtes Ufer'),
  ('Zumikon', 'ZH', 160, true, 'Hinterland rechtes Ufer'),
  ('Egg', 'ZH', 192, true, 'Hinterland rechtes Ufer'),
  ('Uster', 'ZH', 198, true, null),
  ('Pfäffikon ZH', 'ZH', 177, true, null),
  ('Wollerau', 'SZ', 1323, true, null),
  ('Freienbach', 'SZ', 1322, true, 'inkl. Pfäffikon SZ, Bäch, Wilen'),
  ('Feusisberg', 'SZ', 1321, true, 'inkl. Schindellegi'),
  ('Altendorf', 'SZ', 1341, true, null),
  ('Lachen', 'SZ', 1344, true, null),
  ('Galgenen', 'SZ', 1342, true, null),
  ('Wangen SZ', 'SZ', 1349, true, 'inkl. Nuolen'),
  ('Schübelbach', 'SZ', 1346, true, 'inkl. Siebnen, Buttikon'),
  ('Tuggen', 'SZ', 1347, true, null),
  ('Rapperswil-Jona', 'SG', 3340, true, null),
  ('Schmerikon', 'SG', 3338, true, null),
  ('Eschenbach SG', 'SG', 3342, true, 'inkl. Ermenswil, Goldingen'),
  ('Uznach', 'SG', 3339, true, null)
on conflict (name) do nothing;

-- 2) Neubauprojekte (Promotionen, auch vor der Vermarktung)
create table if not exists public.neubauprojekte (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gemeinde text,
  kanton text,
  adresse text,
  phase text not null default 'geplant' check (phase in ('geplant', 'vormerkung', 'verkauf', 'ausverkauft', 'miete', 'uninteressant')),
  typ text,                       -- z.B. 'Wohnungen', 'Reihenhäuser', 'Doppeleinfamilienhäuser', 'gemischt'
  einheiten int,
  zimmer_von numeric, zimmer_bis numeric,
  flaeche_von int, flaeche_bis int,
  preis_ab bigint, preis_bis bigint,
  bezug text,                     -- Freitext, z.B. 'Sommer 2028'
  bauherr text,
  vermarkter text,
  kontakt text,
  website text,
  quelle_url text,
  bild_url text,
  interessent_seit date,          -- wann wir uns auf die Interessentenliste gesetzt haben
  notiz text,
  zuletzt_geprueft date,
  erstellt_von uuid references public.profiles(id),
  erfasst_am timestamptz not null default now(),
  aktualisiert_am timestamptz not null default now()
);
create unique index if not exists neubauprojekte_website_idx on public.neubauprojekte (lower(website)) where website is not null;
create index if not exists neubauprojekte_gemeinde_idx on public.neubauprojekte (gemeinde);

-- 3) Baugesuche aus Amtsblatt ZH, Amtsblatt SZ, Publikationen SG
create table if not exists public.baugesuche (
  id uuid primary key default gen_random_uuid(),
  quelle text not null check (quelle in ('Amtsblatt ZH', 'Amtsblatt SZ', 'Publikationen SG', 'Manuell')),
  externe_id text not null,       -- Publikations-ID bzw. Publikationsnummer
  publ_nr text,
  publiziert_am date,
  frist_bis date,
  gemeinde text,
  kanton text,
  ortsteil text,
  adresse text,
  beschreibung text,
  bauherr text,                   -- nur Firmen/Körperschaften, keine Privatpersonen
  projektverfasser text,          -- nur Firmen
  url text,
  relevanz text not null default 'tief' check (relevanz in ('hoch', 'mittel', 'tief')),
  wohnungen int,
  status text not null default 'neu' check (status in ('neu', 'gesichtet', 'beobachten', 'irrelevant')),
  notiz text,
  neubauprojekt_id uuid references public.neubauprojekte(id) on delete set null,
  erfasst_am timestamptz not null default now(),
  aktualisiert_am timestamptz not null default now(),
  unique (quelle, externe_id)
);
create index if not exists baugesuche_publ_idx on public.baugesuche (publiziert_am desc);
create index if not exists baugesuche_gemeinde_idx on public.baugesuche (gemeinde);

-- 4) Ereignisse pro Projekt (Zeitachse und Push-Entscheid)
create table if not exists public.neubau_ereignisse (
  id bigint generated always as identity primary key,
  neubauprojekt_id uuid not null references public.neubauprojekte(id) on delete cascade,
  datum timestamptz not null default now(),
  typ text not null,              -- 'erfasst', 'phase', 'preis', 'baugesuch', 'notiz'
  alt text,
  neu text,
  user_id uuid references public.profiles(id)
);
create index if not exists neubau_ereignisse_idx on public.neubau_ereignisse (neubauprojekt_id, datum desc);

-- Inserate (Objekte) können zu einem Projekt gehören
alter table public.objekte add column if not exists neubauprojekt_id uuid references public.neubauprojekte(id) on delete set null;

-- 5) RLS wie die übrigen Tabellen: Mitglieder schreiben, Leser lesen
do $$
declare t text;
begin
  foreach t in array array['radar_gemeinden', 'neubauprojekte', 'baugesuche', 'neubau_ereignisse'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_auth_all') then
      execute format('create policy %I on public.%I for all to authenticated using (not public.ist_leser()) with check (not public.ist_leser())', t || '_auth_all', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_leser_select') then
      execute format('create policy %I on public.%I for select to authenticated using (public.ist_leser())', t || '_leser_select', t);
    end if;
  end loop;
end $$;

-- 6) Relevanz aus der Projektbeschreibung
create or replace function public.baugesuch_relevanz(p_text text) returns text
language sql immutable as $$
  select case
    when p_text is null then 'tief'
    when p_text ~* '(gestaltungsplan|arealüberbauung|wohnüberbauung)' then 'hoch'
    when p_text ~* '(neubau|ersatzneubau|neuerstellung|erstellung|überbauung|neubauten)'
     and p_text ~* '(mehrfamilienh|\mmfh\M|reihen|doppel|terrassenh|einfamilienhäuser|wohnhäuser|eigentumswohnung|wohnungen|wohneinheiten|stockwerkeigentum|mehrere.{0,20}einfamilienh|\d+\s*einfamilienh)'
     and p_text !~* '^\s*(umbau|anbau|aufstockung|sanierung|umnutzung)' then 'hoch'
    when p_text ~* '(neubau|ersatzneubau|neuerstellung|erstellung)' and p_text ~* '(einfamilienhaus|wohnhaus|zweifamilienhaus)' then 'mittel'
    else 'tief'
  end;
$$;

create or replace function public.baugesuch_wohnungen(p_text text) returns int
language sql immutable as $$
  select nullif((regexp_match(coalesce(p_text, ''), '(\d{1,3})\s*(?:eigentums)?(?:wohnungen|wohneinheiten|reihenh|reiheneinfamilienh|einfamilienh|doppel)', 'i'))[1], '')::int;
$$;

-- Import vom täglichen Lauf: p = [{quelle, externe_id, publ_nr, publiziert_am, frist_bis, gemeinde, kanton, ortsteil, adresse, beschreibung, bauherr, projektverfasser, url}, …]
-- Gibt die neu erfassten Zeilen zurück (für Push und Nachrecherche).
create or replace function public.baugesuche_import(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e jsonb; v_id uuid; v_neu boolean; v_out jsonb := '[]'::jsonb; v_rel text;
begin
  perform public.nur_mitglieder();
  for e in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    if coalesce(e->>'externe_id', '') = '' or coalesce(e->>'quelle', '') = '' then continue; end if;
    v_rel := public.baugesuch_relevanz(e->>'beschreibung');
    insert into public.baugesuche as b (quelle, externe_id, publ_nr, publiziert_am, frist_bis, gemeinde, kanton, ortsteil, adresse, beschreibung, bauherr, projektverfasser, url, relevanz, wohnungen)
    values (e->>'quelle', e->>'externe_id', e->>'publ_nr', nullif(e->>'publiziert_am', '')::date, nullif(e->>'frist_bis', '')::date,
            e->>'gemeinde', e->>'kanton', e->>'ortsteil', e->>'adresse', e->>'beschreibung', nullif(e->>'bauherr', ''), nullif(e->>'projektverfasser', ''), e->>'url',
            v_rel, public.baugesuch_wohnungen(e->>'beschreibung'))
    on conflict (quelle, externe_id) do update set
      publ_nr = coalesce(excluded.publ_nr, b.publ_nr),
      publiziert_am = coalesce(excluded.publiziert_am, b.publiziert_am),
      frist_bis = coalesce(excluded.frist_bis, b.frist_bis),
      gemeinde = coalesce(excluded.gemeinde, b.gemeinde),
      ortsteil = coalesce(excluded.ortsteil, b.ortsteil),
      adresse = coalesce(excluded.adresse, b.adresse),
      beschreibung = coalesce(excluded.beschreibung, b.beschreibung),
      bauherr = coalesce(excluded.bauherr, b.bauherr),
      projektverfasser = coalesce(excluded.projektverfasser, b.projektverfasser),
      url = coalesce(excluded.url, b.url),
      relevanz = excluded.relevanz,
      wohnungen = coalesce(excluded.wohnungen, b.wohnungen),
      aktualisiert_am = now()
    returning id, (xmax = 0) into v_id, v_neu;
    if v_neu then
      v_out := v_out || jsonb_build_object('id', v_id, 'gemeinde', e->>'gemeinde', 'adresse', e->>'adresse', 'relevanz', v_rel, 'beschreibung', left(e->>'beschreibung', 200), 'bauherr', e->>'bauherr');
    end if;
  end loop;
  return v_out;
end $$;

-- Ab welchem Datum ein Amtsblatt abgefragt werden soll (letzter erfolgreicher Lauf minus 3 Tage, sonst 365 Tage zurück)
create or replace function public.radar_seit(p_quelle text) returns date
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (max(gestartet_am) at time zone 'Europe/Zurich')::date - 3 from public.lauf_protokoll where makler = p_quelle and geprueft and fehler is null),
    current_date - 365);
$$;

-- Projekt anlegen oder aktualisieren (Lauf und App). Schlüssel: id, sonst Website, sonst Name + Gemeinde.
-- Felder werden nur überschrieben, wenn ein Wert mitkommt. Phase 'uninteressant' (von uns gesetzt) überschreibt der Lauf nicht.
create or replace function public.neubauprojekt_melden(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v public.neubauprojekte%rowtype; v_id uuid; v_phase text; v_preis bigint;
begin
  perform public.nur_mitglieder();
  if nullif(p->>'id', '') is not null then
    select * into v from public.neubauprojekte where id = (p->>'id')::uuid;
  end if;
  if v.id is null and nullif(p->>'website', '') is not null then
    select * into v from public.neubauprojekte where lower(website) = lower(p->>'website');
  end if;
  if v.id is null and nullif(p->>'name', '') is not null then
    select * into v from public.neubauprojekte where lower(name) = lower(p->>'name') and coalesce(gemeinde, '') = coalesce(p->>'gemeinde', '') limit 1;
  end if;

  if v.id is null then
    insert into public.neubauprojekte (name, gemeinde, kanton, adresse, phase, typ, einheiten, zimmer_von, zimmer_bis, flaeche_von, flaeche_bis, preis_ab, preis_bis, bezug, bauherr, vermarkter, kontakt, website, quelle_url, bild_url, notiz, zuletzt_geprueft, erstellt_von)
    values (coalesce(nullif(p->>'name', ''), 'Projekt ' || coalesce(p->>'adresse', p->>'gemeinde', '')), p->>'gemeinde', p->>'kanton', p->>'adresse', coalesce(nullif(p->>'phase', ''), 'geplant'), p->>'typ',
            nullif(p->>'einheiten', '')::int, nullif(p->>'zimmer_von', '')::numeric, nullif(p->>'zimmer_bis', '')::numeric, nullif(p->>'flaeche_von', '')::int, nullif(p->>'flaeche_bis', '')::int,
            nullif(p->>'preis_ab', '')::bigint, nullif(p->>'preis_bis', '')::bigint, p->>'bezug', p->>'bauherr', p->>'vermarkter', p->>'kontakt', nullif(p->>'website', ''), p->>'quelle_url', p->>'bild_url', p->>'notiz', current_date, auth.uid())
    returning id into v_id;
    insert into public.neubau_ereignisse (neubauprojekt_id, typ, neu, user_id) values (v_id, 'erfasst', coalesce(p->>'phase', 'geplant'), auth.uid());
    return v_id;
  end if;

  v_phase := coalesce(nullif(p->>'phase', ''), v.phase);
  if v.phase = 'uninteressant' and auth.uid() is null then v_phase := 'uninteressant'; end if;
  v_preis := coalesce(nullif(p->>'preis_ab', '')::bigint, v.preis_ab);

  update public.neubauprojekte set
    name = coalesce(nullif(p->>'name', ''), name),
    gemeinde = coalesce(nullif(p->>'gemeinde', ''), gemeinde),
    kanton = coalesce(nullif(p->>'kanton', ''), kanton),
    adresse = coalesce(nullif(p->>'adresse', ''), adresse),
    phase = v_phase,
    typ = coalesce(nullif(p->>'typ', ''), typ),
    einheiten = coalesce(nullif(p->>'einheiten', '')::int, einheiten),
    zimmer_von = coalesce(nullif(p->>'zimmer_von', '')::numeric, zimmer_von),
    zimmer_bis = coalesce(nullif(p->>'zimmer_bis', '')::numeric, zimmer_bis),
    flaeche_von = coalesce(nullif(p->>'flaeche_von', '')::int, flaeche_von),
    flaeche_bis = coalesce(nullif(p->>'flaeche_bis', '')::int, flaeche_bis),
    preis_ab = v_preis,
    preis_bis = coalesce(nullif(p->>'preis_bis', '')::bigint, preis_bis),
    bezug = coalesce(nullif(p->>'bezug', ''), bezug),
    bauherr = coalesce(nullif(p->>'bauherr', ''), bauherr),
    vermarkter = coalesce(nullif(p->>'vermarkter', ''), vermarkter),
    kontakt = coalesce(nullif(p->>'kontakt', ''), kontakt),
    website = coalesce(nullif(p->>'website', ''), website),
    quelle_url = coalesce(nullif(p->>'quelle_url', ''), quelle_url),
    bild_url = coalesce(nullif(p->>'bild_url', ''), bild_url),
    notiz = case when p ? 'notiz' then p->>'notiz' else notiz end,
    zuletzt_geprueft = current_date,
    aktualisiert_am = now()
  where id = v.id;

  if v_phase is distinct from v.phase then
    insert into public.neubau_ereignisse (neubauprojekt_id, typ, alt, neu, user_id) values (v.id, 'phase', v.phase, v_phase, auth.uid());
  end if;
  if v_preis is distinct from v.preis_ab and v.preis_ab is not null then
    insert into public.neubau_ereignisse (neubauprojekt_id, typ, alt, neu, user_id) values (v.id, 'preis', v.preis_ab::text, v_preis::text, auth.uid());
  end if;
  return v.id;
end $$;

-- Baugesuch einem Projekt zuordnen
create or replace function public.baugesuch_zuordnen(p_baugesuch uuid, p_projekt uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.nur_mitglieder();
  update public.baugesuche set neubauprojekt_id = p_projekt, status = case when status = 'neu' then 'beobachten' else status end, aktualisiert_am = now() where id = p_baugesuch;
  if p_projekt is not null then
    insert into public.neubau_ereignisse (neubauprojekt_id, typ, neu, user_id)
    select p_projekt, 'baugesuch', coalesce(b.adresse, '') || ': ' || left(coalesce(b.beschreibung, ''), 120), auth.uid() from public.baugesuche b where b.id = p_baugesuch;
  end if;
end $$;

revoke all on function public.baugesuche_import(jsonb) from public, anon;
revoke all on function public.neubauprojekt_melden(jsonb) from public, anon;
revoke all on function public.baugesuch_zuordnen(uuid, uuid) from public, anon;
revoke all on function public.radar_seit(text) from public, anon;
grant execute on function public.baugesuche_import(jsonb) to authenticated, service_role;
grant execute on function public.neubauprojekt_melden(jsonb) to authenticated, service_role;
grant execute on function public.baugesuch_zuordnen(uuid, uuid) to authenticated, service_role;
grant execute on function public.radar_seit(text) to authenticated, service_role;

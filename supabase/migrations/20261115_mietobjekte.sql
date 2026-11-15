-- Mietobjekte: gleiche Inseratsliste wie für den Kauf, getrennt über objekte.angebot.
-- Nur additiv (keine drop/delete). preis_chf ist bei Mietobjekten die Bruttomiete pro Monat.

alter table public.objekte add column if not exists angebot text not null default 'kauf';
alter table public.objekte add column if not exists verfuegbar_ab text;
alter table public.objekte add column if not exists nebenkosten_chf integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'objekte_angebot_check') then
    alter table public.objekte add constraint objekte_angebot_check check (angebot in ('kauf', 'miete'));
  end if;
end $$;

create index if not exists objekte_angebot_idx on public.objekte (angebot);

comment on column public.objekte.angebot is 'kauf oder miete. Bei miete ist preis_chf die Bruttomiete pro Monat.';
comment on column public.objekte.verfuegbar_ab is 'Mietobjekte: Bezugstermin laut Inserat (Text, z.B. 01.02.2027 oder nach Vereinbarung)';
comment on column public.objekte.nebenkosten_chf is 'Mietobjekte: Nebenkosten pro Monat, in preis_chf bereits enthalten';

-- ---------------------------------------------------------------------------
-- upsert_inserat mit p_angebot (16 Argumente). Die Variante mit 15 Argumenten bleibt und meldet Kaufobjekte.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_inserat(
  p_makler text, p_externe_id text, p_url text, p_ort text, p_adresse text, p_typ text, p_zimmer numeric, p_flaeche_m2 integer,
  p_preis_chf bigint, p_gesehen date, p_kanton text, p_lage_hinweis text, p_titel text, p_bild_url text, p_status text, p_angebot text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_quelle public.objekt_quellen%rowtype;
  v_objekt_id uuid;
  v_status text := case when p_status in ('aktiv','reserviert','verkauft') then p_status else 'aktiv' end;
  v_angebot text := case when p_angebot = 'miete' then 'miete' else 'kauf' end;
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

  -- Dublette nur innerhalb desselben Angebots (Kauf und Miete nie zusammenführen)
  select o.id into v_objekt_id
    from public.objekte o
   where o.angebot = v_angebot
     and lower(o.ort) = lower(p_ort)
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

  insert into public.objekte (titel, ort, kanton, adresse, typ, zimmer, flaeche_m2, preis_chf, erstmals_gesehen, zuletzt_gesehen, lage_hinweis, bild_url, markt_status, angebot)
  values (p_titel, p_ort, p_kanton, p_adresse, coalesce(p_typ, 'wohnung'), p_zimmer, p_flaeche_m2, p_preis_chf, p_gesehen, p_gesehen, p_lage_hinweis, p_bild_url, v_status, v_angebot)
  returning id into v_objekt_id;
  insert into public.objekt_quellen (objekt_id, makler, externe_id, url, preis_chf, erstmals_gesehen, zuletzt_gesehen, status)
  values (v_objekt_id, p_makler, p_externe_id, p_url, p_preis_chf, p_gesehen, p_gesehen, v_status);
  update public.snapshots set datum = p_gesehen::timestamptz where objekt_id = v_objekt_id and typ = 'erfasst';
  return v_objekt_id;
end $function$;

create or replace function public.upsert_inserat(
  p_makler text, p_externe_id text, p_url text, p_ort text, p_adresse text, p_typ text, p_zimmer numeric, p_flaeche_m2 integer,
  p_preis_chf bigint, p_gesehen date, p_kanton text, p_lage_hinweis text, p_titel text, p_bild_url text, p_status text)
returns uuid
language sql
security definer
set search_path to 'public'
as $function$
  select public.upsert_inserat(p_makler, p_externe_id, p_url, p_ort, p_adresse, p_typ, p_zimmer, p_flaeche_m2, p_preis_chf, p_gesehen, p_kanton, p_lage_hinweis, p_titel, p_bild_url, p_status, 'kauf');
$function$;

-- ---------------------------------------------------------------------------
-- markiere_offline pro Angebot. Die bisherige Variante (2 Argumente) betrifft nur noch Kaufobjekte,
-- damit ein unvollständiger Miet-Lauf keine Kaufinserate offline setzt und umgekehrt.
-- ---------------------------------------------------------------------------
create or replace function public.markiere_offline(p_makler text, p_stichtag date, p_angebot text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int;
  v_angebot text := case when p_angebot = 'miete' then 'miete' else 'kauf' end;
begin
  with q as (
    update public.objekt_quellen oq set status = 'offline', offline_seit = p_stichtag
     where oq.status = 'aktiv' and oq.zuletzt_gesehen < p_stichtag and (oq.makler = p_makler or oq.spiegel_von = p_makler)
       and exists (select 1 from public.objekte ob where ob.id = oq.objekt_id and ob.angebot = v_angebot)
    returning oq.objekt_id
  )
  update public.objekte o set markt_status = 'offline', offline_seit = p_stichtag
   where o.id in (select objekt_id from q)
     and o.markt_status = 'aktiv'
     and not exists (select 1 from public.objekt_quellen x where x.objekt_id = o.id and x.status = 'aktiv');
  get diagnostics n = row_count;
  return n;
end $function$;

create or replace function public.markiere_offline(p_makler text, p_stichtag date default current_date)
returns integer
language sql
security definer
set search_path to 'public'
as $function$
  select public.markiere_offline(p_makler, p_stichtag, 'kauf');
$function$;

revoke all on function public.upsert_inserat(text, text, text, text, text, text, numeric, integer, bigint, date, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.upsert_inserat(text, text, text, text, text, text, numeric, integer, bigint, date, text, text, text, text, text, text) to service_role;
revoke all on function public.markiere_offline(text, date, text) from public, anon, authenticated;
grant execute on function public.markiere_offline(text, date, text) to service_role;

-- ---------------------------------------------------------------------------
-- Score: Mietobjekte bekommen keinen Kauf-Score und zählen nicht in den Preisvergleich pro m².
-- ---------------------------------------------------------------------------
create or replace function public.objekt_score_rechnen(o public.objekte)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  r jsonb;
  berechnet int;
  wer text;
  hinweis text;
begin
  if o.angebot = 'miete' then
    return jsonb_build_object('score', null, 'faktoren', '[]'::jsonb, 'hinweise', jsonb_build_array('Mietobjekt: kein Kauf-Score'), 'stand', now());
  end if;
  r := public.objekt_score_berechnet(o);
  berechnet := (r->>'score')::int;
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
end $function$;

-- Preisvergleich pro m² in objekt_score_berechnet(): nur Kaufobjekte (Ersetzung auf der Live-Definition)
do $$
declare d text; n int; alt constant text := 'x.preis_chf > 0 and x.flaeche_m2 > 0';
begin
  d := pg_get_functiondef('public.objekt_score_berechnet(public.objekte)'::regprocedure);
  if position('x.angebot = ''kauf''' in d) = 0 then
    n := (length(d) - length(replace(d, alt, ''))) / length(alt);
    if n <> 3 then raise exception 'objekt_score_berechnet: Preisvergleich % mal gefunden statt 3 mal', n; end if;
    execute replace(d, alt, alt || ' and x.angebot = ''kauf''');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Übersicht: neue Spalten am Ende anhängen (bestehende Definition bleibt)
-- ---------------------------------------------------------------------------
do $$
declare d text;
begin
  d := pg_get_viewdef('public.v_objekte_uebersicht'::regclass, true);
  if position('o.angebot' in d) = 0 then
    d := regexp_replace(d, 'o\.score_auto_am\s+FROM objekte o', E'o.score_auto_am,\n    o.angebot,\n    o.verfuegbar_ab,\n    o.nebenkosten_chf\n   FROM objekte o');
    if position('o.angebot' in d) = 0 then raise exception 'v_objekte_uebersicht: Definition nicht wie erwartet'; end if;
    execute 'create or replace view public.v_objekte_uebersicht with (security_invoker = true) as ' || d;
  end if;
end $$;

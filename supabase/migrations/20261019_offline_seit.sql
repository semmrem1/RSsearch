-- RSsearch: Inserate, die der tägliche Lauf nicht mehr findet, sofort als offline markieren, mit Datum.
-- Rein additiv (kein drop).

alter table public.objekte add column if not exists offline_seit date;
alter table public.objekt_quellen add column if not exists offline_seit date;

-- Datum automatisch pflegen, egal ob Lauf, Funktion oder App den Status ändert
create or replace function public.offline_datum_setzen()
returns trigger language plpgsql set search_path = public as $$
declare v_status text;
begin
  if tg_table_name = 'objekte' then v_status := new.markt_status; else v_status := new.status; end if;
  if v_status in ('offline','verkauft') then
    new.offline_seit := coalesce(new.offline_seit, current_date);
  elsif v_status = 'aktiv' then
    new.offline_seit := null;
  end if;
  return new;
end $$;

create or replace trigger objekte_offline_datum before insert or update of markt_status, offline_seit on public.objekte
for each row execute function public.offline_datum_setzen();
create or replace trigger objekt_quellen_offline_datum before insert or update of status, offline_seit on public.objekt_quellen
for each row execute function public.offline_datum_setzen();
revoke execute on function public.offline_datum_setzen() from anon, authenticated, public;

-- Nicht mehr gefunden = offline ab dem Tag des Laufs (nur für vollständig geprüfte Makler aufrufen)
create or replace function public.markiere_offline(p_makler text, p_stichtag date default current_date)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with q as (
    update public.objekt_quellen set status = 'offline', offline_seit = p_stichtag
     where makler = p_makler and status = 'aktiv' and zuletzt_gesehen < p_stichtag
    returning objekt_id
  )
  update public.objekte o set markt_status = 'offline', offline_seit = p_stichtag
   where o.id in (select objekt_id from q)
     and o.markt_status = 'aktiv'
     and not exists (select 1 from public.objekt_quellen x where x.objekt_id = o.id and x.status = 'aktiv');
  get diagnostics n = row_count;
  return n;
end $$;

-- upsert_inserat: wieder gefundenes Objekt (auch über einen anderen Makler) wieder aktiv setzen
create or replace function public.upsert_inserat(
  p_makler text, p_externe_id text, p_url text, p_ort text, p_adresse text, p_typ text,
  p_zimmer numeric, p_flaeche_m2 int, p_preis_chf bigint, p_gesehen date,
  p_kanton text, p_lage_hinweis text, p_titel text, p_bild_url text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_quelle public.objekt_quellen%rowtype;
  v_objekt_id uuid;
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
           status = 'aktiv',
           url = p_url,
           externe_id = coalesce(externe_id, p_externe_id)
     where id = v_quelle.id;
    update public.objekte
       set zuletzt_gesehen = greatest(zuletzt_gesehen, p_gesehen),
           preis_chf = coalesce(p_preis_chf, preis_chf),
           flaeche_m2 = coalesce(p_flaeche_m2, flaeche_m2),
           zimmer = coalesce(p_zimmer, zimmer),
           adresse = coalesce(adresse, p_adresse),
           bild_url = coalesce(bild_url, p_bild_url),
           markt_status = case when markt_status in ('offline','unbekannt') then 'aktiv' else markt_status end
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
    insert into public.objekt_quellen (objekt_id, makler, externe_id, url, preis_chf, erstmals_gesehen, zuletzt_gesehen)
    values (v_objekt_id, p_makler, p_externe_id, p_url, p_preis_chf, p_gesehen, p_gesehen);
    insert into public.snapshots (objekt_id, typ, neu, kommentar, datum)
    values (v_objekt_id, 'neue_quelle', p_makler || coalesce(' ' || p_externe_id, ''), 'Als Dublette erkannt und zusammengeführt', p_gesehen::timestamptz);
    update public.objekte
       set zuletzt_gesehen = greatest(zuletzt_gesehen, p_gesehen),
           adresse = coalesce(adresse, p_adresse),
           preis_chf = coalesce(preis_chf, p_preis_chf),
           bild_url = coalesce(bild_url, p_bild_url),
           markt_status = case when markt_status in ('offline','unbekannt') then 'aktiv' else markt_status end
     where id = v_objekt_id;
    return v_objekt_id;
  end if;

  insert into public.objekte (titel, ort, kanton, adresse, typ, zimmer, flaeche_m2, preis_chf, erstmals_gesehen, zuletzt_gesehen, lage_hinweis, bild_url)
  values (p_titel, p_ort, p_kanton, p_adresse, coalesce(p_typ, 'wohnung'), p_zimmer, p_flaeche_m2, p_preis_chf, p_gesehen, p_gesehen, p_lage_hinweis, p_bild_url)
  returning id into v_objekt_id;
  insert into public.objekt_quellen (objekt_id, makler, externe_id, url, preis_chf, erstmals_gesehen, zuletzt_gesehen)
  values (v_objekt_id, p_makler, p_externe_id, p_url, p_preis_chf, p_gesehen, p_gesehen);
  update public.snapshots set datum = p_gesehen::timestamptz where objekt_id = v_objekt_id and typ = 'erfasst';
  return v_objekt_id;
end $$;

-- View: offline_seit ergänzen (am Ende angehängt), Quellen mit Status-Datum
create or replace view public.v_objekte_uebersicht with (security_invoker = true) as
select
  o.id, o.titel, o.ort, o.plz, o.kanton, o.adresse, o.typ, o.zimmer, o.flaeche_m2, o.grundstueck_m2, o.baujahr, o.preis_chf, o.markt_status, o.stufe_code, o.stufe_geaendert_am, o.erstmals_gesehen, o.zuletzt_gesehen, o.notizen, o.lage_hinweis, o.created_at, o.updated_at,
  s.name as stufe_name,
  s.phase as stufe_phase,
  s.phase_name as stufe_phase_name,
  s.sort as stufe_sort,
  s.terminal as stufe_terminal,
  coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'makler', q.makler, 'externe_id', q.externe_id, 'url', q.url, 'url_direkt', q.url_direkt, 'status', q.status, 'preis_chf', q.preis_chf, 'zuletzt_gesehen', q.zuletzt_gesehen, 'offline_seit', q.offline_seit) order by q.url_direkt desc, q.erstmals_gesehen)
            from public.objekt_quellen q where q.objekt_id = o.id), '[]'::jsonb) as quellen,
  coalesce((select jsonb_object_agg(b.user_id, jsonb_build_object('sterne', b.sterne, 'favorit', b.favorit, 'uninteressant', b.uninteressant))
            from public.bewertungen b where b.objekt_id = o.id), '{}'::jsonb) as bewertungen,
  (select p.alt::bigint from public.snapshots p where p.objekt_id = o.id and p.typ = 'preis' order by p.datum desc limit 1) as preis_vorher_chf,
  (select p.datum from public.snapshots p where p.objekt_id = o.id and p.typ = 'preis' order by p.datum desc limit 1) as preis_geaendert_am,
  o.lat, o.lng, o.geo_genauigkeit, o.geo_suchtext, o.bild_url, o.bild_pfad, o.bild_fehler,
  o.offline_seit
from public.objekte o
join public.pipeline_stufen s on s.code = o.stufe_code;

-- RSsearch: Karte, Bilder, Direktlinks
-- - objekte: Koordinaten (Geocoding via geo.admin.ch durch die App), Bild (Quell-URL + gesicherte Kopie im Storage)
-- - objekt_quellen: url_direkt (false, wenn nur eine Übersichts-/Suchseite hinterlegt ist)
-- - upsert_inserat: Direkt-URL ist Pflicht, optional p_bild_url

-- -----------------------------------------------------------------------------
-- Spalten
-- -----------------------------------------------------------------------------
alter table public.objekte add column if not exists lat double precision;
alter table public.objekte add column if not exists lng double precision;
alter table public.objekte add column if not exists geo_genauigkeit text check (geo_genauigkeit in ('adresse','ort','manuell'));
alter table public.objekte add column if not exists geo_suchtext text;
alter table public.objekte add column if not exists bild_url text;
alter table public.objekte add column if not exists bild_pfad text;
alter table public.objekte add column if not exists bild_fehler text;

-- -----------------------------------------------------------------------------
-- Direktlink-Erkennung
-- -----------------------------------------------------------------------------
create or replace function public.ist_direktlink(p_url text)
returns boolean language sql immutable set search_path = public as $$
  select p_url is not null
     and p_url ~* '^https?://[^/]+/.+'
     and p_url !~* '(walde\.ch/(en|de)/listing/?(\?.*)?$)'
     and p_url !~* '(streichan\.ch/kaufen/?$)'
     and p_url !~* '(moneypark\.ch/de/immobilien/kaufen/?(\?.*)?$)'
     and p_url !~* '(avora-immobilien\.ch/kaufen-mieten/?$)'
     and p_url !~* '(remax\.ch/de/immobilien/immobilien-suchen)'
     and p_url !~* '(engelvoelkers\.com/ch/de/region-)'
     and p_url !~* '(von-poll\.com/de/immobilien/[a-z-]+/?$)'
     and p_url !~* '(sothebysrealty\.com/eng/sales/[a-z-]+/?$)'
     and p_url !~* '(ginesta\.ch/objekte/immobilien-kaufen)'
     and p_url !~* '(hev-aargau\.ch/vermarktung/haus-kaufen)'
     and p_url !~* '(immo\.raiffeisen\.ch/?$)'
$$;

alter table public.objekt_quellen add column if not exists url_direkt boolean generated always as (public.ist_direktlink(url)) stored;

-- -----------------------------------------------------------------------------
-- Storage: öffentlicher Bucket für Objektbilder (Inseratfotos sind ohnehin öffentlich)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('objektbilder', 'objektbilder', true, 10485760, array['image/jpeg','image/png','image/webp','image/gif','image/avif'])
on conflict (id) do update set public = true;

create policy objektbilder_auth_insert on storage.objects for insert to authenticated with check (bucket_id = 'objektbilder');
create policy objektbilder_auth_update on storage.objects for update to authenticated using (bucket_id = 'objektbilder') with check (bucket_id = 'objektbilder');
create policy objektbilder_auth_delete on storage.objects for delete to authenticated using (bucket_id = 'objektbilder');

-- -----------------------------------------------------------------------------
-- upsert_inserat v2: Direkt-URL Pflicht, Bild-URL optional
-- -----------------------------------------------------------------------------
create or replace function public.upsert_inserat(
  p_makler text,
  p_externe_id text,
  p_url text,
  p_ort text,
  p_adresse text,
  p_typ text,
  p_zimmer numeric,
  p_flaeche_m2 int,
  p_preis_chf bigint,
  p_gesehen date,
  p_kanton text,
  p_lage_hinweis text,
  p_titel text,
  p_bild_url text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_quelle public.objekt_quellen%rowtype;
  v_objekt_id uuid;
begin
  if not public.ist_direktlink(p_url) then
    raise exception 'upsert_inserat: p_url muss die Direkt-URL der Inserat-Detailseite sein (erhalten: %). Detailseite öffnen und deren URL verwenden.', coalesce(p_url, 'null');
  end if;

  -- 1) Bekannte Quelle?
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

  -- 2) Gleiches Objekt bei anderem Makler?
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
           bild_url = coalesce(bild_url, p_bild_url)
     where id = v_objekt_id;
    return v_objekt_id;
  end if;

  -- 3) Neu
  insert into public.objekte (titel, ort, kanton, adresse, typ, zimmer, flaeche_m2, preis_chf, erstmals_gesehen, zuletzt_gesehen, lage_hinweis, bild_url)
  values (p_titel, p_ort, p_kanton, p_adresse, coalesce(p_typ, 'wohnung'), p_zimmer, p_flaeche_m2, p_preis_chf, p_gesehen, p_gesehen, p_lage_hinweis, p_bild_url)
  returning id into v_objekt_id;
  insert into public.objekt_quellen (objekt_id, makler, externe_id, url, preis_chf, erstmals_gesehen, zuletzt_gesehen)
  values (v_objekt_id, p_makler, p_externe_id, p_url, p_preis_chf, p_gesehen, p_gesehen);
  update public.snapshots set datum = p_gesehen::timestamptz where objekt_id = v_objekt_id and typ = 'erfasst';
  return v_objekt_id;
end $$;

-- Bisherige 13-Parameter-Variante bleibt aufrufbar und leitet weiter (gleiche Prüfung)
create or replace function public.upsert_inserat(
  p_makler text,
  p_externe_id text,
  p_url text,
  p_ort text,
  p_adresse text,
  p_typ text,
  p_zimmer numeric,
  p_flaeche_m2 int,
  p_preis_chf bigint,
  p_gesehen date default current_date,
  p_kanton text default null,
  p_lage_hinweis text default null,
  p_titel text default null
) returns uuid
language sql security definer set search_path = public as $$
  select public.upsert_inserat(p_makler, p_externe_id, p_url, p_ort, p_adresse, p_typ, p_zimmer, p_flaeche_m2, p_preis_chf, p_gesehen, p_kanton, p_lage_hinweis, p_titel, null::text);
$$;

revoke execute on function public.upsert_inserat(text,text,text,text,text,text,numeric,int,bigint,date,text,text,text,text) from anon, public;
grant execute on function public.upsert_inserat(text,text,text,text,text,text,numeric,int,bigint,date,text,text,text,text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- View: bisherige Spalten unverändert, neue Spalten am Ende (ohne drop)
-- -----------------------------------------------------------------------------
create or replace view public.v_objekte_uebersicht with (security_invoker = true) as
select
  o.id, o.titel, o.ort, o.plz, o.kanton, o.adresse, o.typ, o.zimmer, o.flaeche_m2, o.grundstueck_m2, o.baujahr, o.preis_chf, o.markt_status, o.stufe_code, o.stufe_geaendert_am, o.erstmals_gesehen, o.zuletzt_gesehen, o.notizen, o.lage_hinweis, o.created_at, o.updated_at,
  s.name as stufe_name,
  s.phase as stufe_phase,
  s.phase_name as stufe_phase_name,
  s.sort as stufe_sort,
  s.terminal as stufe_terminal,
  coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'makler', q.makler, 'externe_id', q.externe_id, 'url', q.url, 'url_direkt', q.url_direkt, 'status', q.status, 'preis_chf', q.preis_chf) order by q.url_direkt desc, q.erstmals_gesehen)
            from public.objekt_quellen q where q.objekt_id = o.id), '[]'::jsonb) as quellen,
  coalesce((select jsonb_object_agg(b.user_id, jsonb_build_object('sterne', b.sterne, 'favorit', b.favorit, 'uninteressant', b.uninteressant))
            from public.bewertungen b where b.objekt_id = o.id), '{}'::jsonb) as bewertungen,
  (select p.alt::bigint from public.snapshots p where p.objekt_id = o.id and p.typ = 'preis' order by p.datum desc limit 1) as preis_vorher_chf,
  (select p.datum from public.snapshots p where p.objekt_id = o.id and p.typ = 'preis' order by p.datum desc limit 1) as preis_geaendert_am,
  o.lat, o.lng, o.geo_genauigkeit, o.geo_suchtext, o.bild_url, o.bild_pfad, o.bild_fehler
from public.objekte o
join public.pipeline_stufen s on s.code = o.stufe_code;

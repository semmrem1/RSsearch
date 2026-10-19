-- Einspeise-Funktion für den täglichen Lauf (und Imports).
-- Dedup: 1) Makler + externe ID, 2) Ort + Zimmer + Fläche ±3 m² + Preis ±2 %, sonst neu.
-- Rückgabe: objekt_id. Aufruf z.B.:
--   select public.upsert_inserat('Walde', 'L19.120', 'https://…', 'Wädenswil', null, 'wohnung', 4.5, 130, 1810000, '2026-10-13', 'ZH', null, null);

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
language plpgsql security definer set search_path = public as $$
declare
  v_quelle public.objekt_quellen%rowtype;
  v_objekt_id uuid;
begin
  -- 1) Bekannte Quelle? (URL nur als Schlüssel, wenn der Makler keine ID liefert)
  if p_externe_id is not null then
    select * into v_quelle from public.objekt_quellen where makler = p_makler and externe_id = p_externe_id;
  elsif p_url is not null then
    select * into v_quelle from public.objekt_quellen where makler = p_makler and url = p_url and externe_id is null;
  end if;

  if v_quelle.id is not null then
    update public.objekt_quellen
       set zuletzt_gesehen = greatest(zuletzt_gesehen, p_gesehen),
           preis_chf = coalesce(p_preis_chf, preis_chf),
           status = 'aktiv',
           url = coalesce(p_url, url)
     where id = v_quelle.id;
    update public.objekte
       set zuletzt_gesehen = greatest(zuletzt_gesehen, p_gesehen),
           preis_chf = coalesce(p_preis_chf, preis_chf),
           flaeche_m2 = coalesce(p_flaeche_m2, flaeche_m2),
           zimmer = coalesce(p_zimmer, zimmer),
           adresse = coalesce(adresse, p_adresse),
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
           preis_chf = coalesce(preis_chf, p_preis_chf)
     where id = v_objekt_id;
    return v_objekt_id;
  end if;

  -- 3) Neu
  insert into public.objekte (titel, ort, kanton, adresse, typ, zimmer, flaeche_m2, preis_chf, erstmals_gesehen, zuletzt_gesehen, lage_hinweis)
  values (p_titel, p_ort, p_kanton, p_adresse, coalesce(p_typ, 'wohnung'), p_zimmer, p_flaeche_m2, p_preis_chf, p_gesehen, p_gesehen, p_lage_hinweis)
  returning id into v_objekt_id;
  insert into public.objekt_quellen (objekt_id, makler, externe_id, url, preis_chf, erstmals_gesehen, zuletzt_gesehen)
  values (v_objekt_id, p_makler, p_externe_id, p_url, p_preis_chf, p_gesehen, p_gesehen);
  update public.snapshots set datum = p_gesehen::timestamptz where objekt_id = v_objekt_id and typ = 'erfasst';
  return v_objekt_id;
end $$;

-- Quellen eines Maklers, die im Lauf nicht mehr gefunden wurden, als offline markieren
-- (nur wenn zuletzt_gesehen älter als 2 Tage, damit ein einzelner Fehl-Lauf nichts auslöst).
create or replace function public.markiere_offline(p_makler text, p_stichtag date default current_date)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with q as (
    update public.objekt_quellen set status = 'offline'
     where makler = p_makler and status = 'aktiv' and zuletzt_gesehen < p_stichtag - 1
    returning objekt_id
  )
  update public.objekte o set markt_status = 'offline'
   where o.id in (select objekt_id from q)
     and not exists (select 1 from public.objekt_quellen x where x.objekt_id = o.id and x.status = 'aktiv');
  get diagnostics n = row_count;
  return n;
end $$;

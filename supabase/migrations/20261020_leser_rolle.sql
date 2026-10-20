-- Rolle «leser»: darf alles lesen, aber nichts bewerten, ändern, hochladen oder auslösen.
-- Mitglieder (Remo, Pascale) behalten alle Rechte. Nur additiv: bestehende Richtlinien werden angepasst, nicht entfernt.

alter table public.profiles add column if not exists rolle text not null default 'mitglied';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_rolle_check') then
    alter table public.profiles add constraint profiles_rolle_check check (rolle in ('mitglied', 'leser'));
  end if;
end $$;

update public.profiles set rolle = 'leser', name = 'Dieter Semm', kuerzel = 'D' where id = '14868820-e856-47d5-b942-01c67ec32ef5';

-- Ist der angemeldete Benutzer ein Leser? (security definer, damit die Richtlinie auf profiles nicht rekursiv wird)
create or replace function public.ist_leser() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.rolle = 'leser' from public.profiles p where p.id = auth.uid()), false);
$$;
revoke all on function public.ist_leser() from public;
grant execute on function public.ist_leser() to authenticated, service_role;

-- Tabellen mit «alles für authenticated»: Schreiben nur für Mitglieder, Lesen für alle Angemeldeten
do $$
declare t text;
begin
  foreach t in array array['aktivitaeten','budget_posten','dokumente','expose_extrakte','gemeinden','haushalt','konfig','kriterien','lauf_protokoll','objekt_bilder','objekt_budget','objekt_quellen','objekte','ortschaften','pendelzeiten','pipeline_stufen','profiles','snapshots','standortfaktoren'] loop
    execute format('alter policy %I on public.%I using (not public.ist_leser()) with check (not public.ist_leser())', t || '_auth_all', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_leser_select') then
      execute format('create policy %I on public.%I for select to authenticated using (public.ist_leser())', t || '_leser_select', t);
    end if;
  end loop;
end $$;

-- Eigene Bewertungen, Kriterien, Besuche, Push-Abos: Schreiben nur für Mitglieder
alter policy bewertungen_write_own on public.bewertungen with check (user_id = auth.uid() and not public.ist_leser());
alter policy bewertungen_update_own on public.bewertungen using (user_id = auth.uid() and not public.ist_leser()) with check (user_id = auth.uid() and not public.ist_leser());
alter policy kb_write_own on public.kriterien_bewertungen with check (user_id = auth.uid() and not public.ist_leser());
alter policy kb_update_own on public.kriterien_bewertungen using (user_id = auth.uid() and not public.ist_leser()) with check (user_id = auth.uid() and not public.ist_leser());
alter policy besuche_write_own on public.objekt_besuche with check (user_id = auth.uid() and not public.ist_leser());
alter policy besuche_update_own on public.objekt_besuche using (user_id = auth.uid() and not public.ist_leser()) with check (user_id = auth.uid() and not public.ist_leser());
alter policy push_own on public.push_abos using (user_id = auth.uid() and not public.ist_leser()) with check (user_id = auth.uid() and not public.ist_leser());

-- Storage: Hochladen und Ändern nur für Mitglieder (Lesen bleibt)
alter policy dokumente_auth_insert on storage.objects with check (bucket_id = 'dokumente' and not public.ist_leser());
alter policy objektbilder_auth_insert on storage.objects with check (bucket_id = 'objektbilder' and not public.ist_leser());
alter policy objektbilder_auth_update on storage.objects using (bucket_id = 'objektbilder' and not public.ist_leser()) with check (bucket_id = 'objektbilder' and not public.ist_leser());

-- Security-Definer-Funktionen, die die App aufruft: Leser abweisen
create or replace function public.nur_mitglieder() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if public.ist_leser() then raise exception 'Nur Lesen: dieser Benutzer darf nichts ändern' using errcode = '42501'; end if;
end $$;
revoke all on function public.nur_mitglieder() from public;
grant execute on function public.nur_mitglieder() to authenticated, service_role;

create or replace function public.push_senden(p_titel text, p_text text, p_url text default '/', p_user_ids uuid[] default null)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  perform public.nur_mitglieder();
  return public.edge_aufruf('push-senden', jsonb_build_object('titel', p_titel, 'text', p_text, 'url', coalesce(p_url, '/'), 'user_ids', to_jsonb(p_user_ids)));
end $$;

create or replace function public.geheimnis_setzen(p_name text, p_wert text) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.nur_mitglieder();
  select id into v_id from vault.secrets where name = p_name order by created_at desc limit 1;
  if v_id is null then
    perform vault.create_secret(p_wert, p_name);
  else
    perform vault.update_secret(v_id, p_wert);
  end if;
end $$;

create or replace function public.objekte_zusammenfuehren(p_quelle uuid, p_ziel uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare q public.objekte%rowtype; z public.objekte%rowtype;
begin
  perform public.nur_mitglieder();
  if p_quelle = p_ziel then raise exception 'Quelle und Ziel sind dasselbe Objekt'; end if;
  select * into q from public.objekte where id = p_quelle;
  select * into z from public.objekte where id = p_ziel;
  if q.id is null or z.id is null then raise exception 'Objekt nicht gefunden'; end if;
  if z.zusammengefuehrt_in is not null then raise exception 'Ziel ist selbst bereits zusammengeführt'; end if;

  update public.objekt_quellen set objekt_id = p_ziel where objekt_id = p_quelle;
  update public.snapshots set objekt_id = p_ziel where objekt_id = p_quelle;
  update public.aktivitaeten set objekt_id = p_ziel where objekt_id = p_quelle;
  update public.dokumente set objekt_id = p_ziel where objekt_id = p_quelle;
  update public.standortfaktoren set objekt_id = p_ziel where objekt_id = p_quelle;
  update public.expose_extrakte set objekt_id = p_ziel where objekt_id = p_quelle;
  update public.objekt_bilder b set objekt_id = p_ziel, sort = b.sort + 100
   where b.objekt_id = p_quelle
     and not exists (select 1 from public.objekt_bilder x where x.objekt_id = p_ziel and x.quelle_url = b.quelle_url);
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

  -- Quelle bleibt als Hülle erhalten und wird in der App ausgeblendet
  update public.objekte set zusammengefuehrt_in = p_ziel, markt_status = 'unbekannt', stufe_code = 'abgesagt', notizen = 'Zusammengeführt in ' || p_ziel::text where id = p_quelle;
  return p_ziel;
end $$;

-- Funktionen für den täglichen Lauf (laufen als postgres/service_role) braucht die App nicht: kein Aufruf mehr über die API durch angemeldete Benutzer
revoke execute on function public.upsert_inserat(text, text, text, text, text, text, numeric, integer, bigint, date, text, text, text) from authenticated;
revoke execute on function public.upsert_inserat(text, text, text, text, text, text, numeric, integer, bigint, date, text, text, text, text) from authenticated;
revoke execute on function public.upsert_inserat(text, text, text, text, text, text, numeric, integer, bigint, date, text, text, text, text, text) from authenticated;
revoke execute on function public.markiere_offline(text, date) from authenticated;
revoke execute on function public.spiegel_quelle(uuid, text, text, text, text) from authenticated;
revoke execute on function public.bilder_hinzufuegen(uuid, text[]) from authenticated;
revoke execute on function public.edge_aufruf(text, jsonb) from authenticated;
revoke execute on function public.bilder_sichern() from authenticated;
revoke execute on function public.pendelzeiten_berechnen() from authenticated;

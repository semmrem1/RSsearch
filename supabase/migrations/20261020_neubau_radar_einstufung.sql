-- Neubau-Radar: jedes Baugesuch wird eingestuft (Kategorie, Bauherr-Typ, Vermarktung, Einstufung mit Begründung).
-- Erst per Regel beim Import, danach präziser per Claude API in der Edge Function baugesuche-abruf.
-- Manuelle Einstufungen (klassifiziert_von = 'manuell') werden nie überschrieben.
-- Nur additiv (keine drop/delete).

alter table public.baugesuche add column if not exists kategorie text;
alter table public.baugesuche add column if not exists bauherr_typ text;
alter table public.baugesuche add column if not exists vermarktung text;
alter table public.baugesuche add column if not exists einstufung text;
alter table public.baugesuche add column if not exists begruendung text;
alter table public.baugesuche add column if not exists klassifiziert_von text;
alter table public.baugesuche add column if not exists klassifiziert_am timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'baugesuche_kategorie_chk') then
    alter table public.baugesuche add constraint baugesuche_kategorie_chk check (kategorie is null or kategorie in ('mfh', 'reihen', 'mehrere_efh', 'efh', 'ueberbauung', 'umbau', 'nebenbau', 'nicht_wohnen'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'baugesuche_bauherr_typ_chk') then
    alter table public.baugesuche add constraint baugesuche_bauherr_typ_chk check (bauherr_typ is null or bauherr_typ in ('entwickler', 'architekt', 'privat', 'oeffentlich', 'gemeinnuetzig', 'firma', 'unbekannt'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'baugesuche_vermarktung_chk') then
    alter table public.baugesuche add constraint baugesuche_vermarktung_chk check (vermarktung is null or vermarktung in ('verkauf', 'offen', 'miete', 'eigenbedarf'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'baugesuche_einstufung_chk') then
    alter table public.baugesuche add constraint baugesuche_einstufung_chk check (einstufung is null or einstufung in ('fokus', 'pruefen', 'irrelevant'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'baugesuche_klassifiziert_von_chk') then
    alter table public.baugesuche add constraint baugesuche_klassifiziert_von_chk check (klassifiziert_von is null or klassifiziert_von in ('regel', 'claude', 'manuell'));
  end if;
end $$;
create index if not exists baugesuche_einstufung_idx on public.baugesuche (einstufung, publiziert_am desc);

-- Bauherr-Typ aus einem Firmennamen (Privatpersonen werden nie gespeichert, ihr Typ kommt vom Abruf)
create or replace function public.bauherr_typ_aus_name(p text) returns text
language sql immutable as $$
  select case
    when coalesce(trim(p), '') = '' then null
    when p ~* '(politische gemeinde|\mgemeinde\M|\mstadt\M|\mkanton\M|schulgemeinde|kirchgemeinde|kirchenpflege|primarschul|sekundarschul|zweckverband|korporation|\mbezirk\M|eidgenossenschaft|\msbb\M|armasuisse|wasserversorgung|elektrizitätswerk)' then 'oeffentlich'
    when p ~* '(genossenschaft|stiftung|pensionskasse|vorsorge|anlagefonds|\mfonds\M|fondation|swiss life|\maxa\M|helvetia|baloise|mobiliar|\mbvk\M|\mubs\M)' then 'gemeinnuetzig'
    when p ~* '(architekt|architektur|atelier|planung|\mplaner|raumfindung)' then 'architekt'
    when p ~* '(immobilien|real estate|development|entwicklung|invest|holding|liegenschaft|wohnbau|generalunternehm|totalunternehm|promotion|projekt|properties|estate|\mbau\M|bau ag|bau gmbh|bauunternehm|holzbau|zimmerei|baupartner|residenz)' then 'entwickler'
    else 'firma'
  end;
$$;

-- Regel-Einstufung (Fallback ohne Claude). p_typ: Bauherr-Typ vom Abruf, sonst aus dem Firmennamen.
create or replace function public.baugesuch_einstufen_regel(p_text text, p_bauherr text, p_typ text, p_einheiten int)
returns jsonb language plpgsql immutable as $$
declare
  t text := lower(coalesce(p_text, ''));
  k text; typ text; v text; e text; g text; n int := p_einheiten; zfh boolean := false;
begin
  typ := coalesce(nullif(p_typ, ''), public.bauherr_typ_aus_name(p_bauherr), 'unbekannt');
  if n is null then
    n := case
      when t ~ '\mzwei\s+(einfamilienh|zweifamilienh|efh|zfh|reihen|doppel|mehrfamilienh|mfh)' then 2
      when t ~ '\mdrei\s+(einfamilienh|zweifamilienh|efh|zfh|reihen|doppel|mehrfamilienh|mfh)' then 3
      when t ~ '\mvier\s+(einfamilienh|zweifamilienh|efh|zfh|reihen|doppel|mehrfamilienh|mfh)' then 4
      when t ~ '\mfünf\s+(einfamilienh|zweifamilienh|efh|zfh|reihen|doppel|mehrfamilienh|mfh)' then 5
      else null end;
  end if;

  -- Kategorie
  if t ~ '^\s*(\d+\.\s*projektänderung[^,;]*(umbau|sanierung|anbau)|umbau|anbau|aufstockung|sanierung|energetische|umnutzung|renovation|teilsanierung|innen|erweiterung|nutzungsänderung|fassaden)' and t !~ 'ersatzneubau' then
    k := 'umbau';
  elsif t ~ '(reihen|doppeleinfamilienh|doppelhaus|doppelhäuser|doppelwohnhaus|doppel-einfamilienh|terrassenh)' and t ~ '(neubau|neuerstellung|erstellung|neubauten|ersatzneubau|überbauung)' then
    k := 'reihen';
  elsif t ~ '(neubau|ersatzneubau|neuerstellung|erstellung|neubauten)[^.;]{0,60}(\m(zwei|drei|vier|fünf|sechs|\d+)\s+(einfamilienh|zweifamilienh|efh|zfh)|einfamilienhäuser|zweifamilienhäuser)' then
    k := 'mehrere_efh';
  elsif t ~ '(neubau|ersatzneubau|neuerstellung|erstellung|neubauten)[^.;]{0,60}(mehrfamilienh|\mmfh\M|wohnungen|wohneinheiten|eigentumswohnung|stockwerkeigentum|wohnhäuser|mehrfamilien)' then
    k := 'mfh';
  elsif t ~ '(gestaltungsplan|arealüberbauung|wohnüberbauung|sondernutzungsplan|überbauungsplan|^\s*["«„]?überbauung)' then
    k := 'ueberbauung';
  elsif t ~ '(neubau|ersatzneubau|neuerstellung|erstellung)[^.;]{0,40}(einfamilienhaus|\mefh\M|zweifamilienhaus|\mzfh\M|wohnhaus|tiny ?house)' then
    k := 'efh';
    zfh := t ~ '(zweifamilienhaus|\mzfh\M)';
  elsif t ~ '(wärmepumpe|photovoltaik|\mpv\M|solar|pool|schwimmbad|garage|carport|unterstand|mauer|velo|schopf|gartenhaus|pergola|sitzplatz|wintergarten|treppenlift|\mlift\M|klimaanlage|zaun|einfriedung|reklame|antenne|mobilfunk|erdsonde|erdwärme|parkplatz|terrain|umgebung|gartenanlage|dachfenster|lukarne|balkon)' then
    k := 'nebenbau';
  elsif t ~ '(einfamilienhaus|\mefh\M|mehrfamilienh|\mmfh\M|wohnhaus|wohngebäude|zweifamilienh)' then
    k := 'umbau';
  else
    k := 'nicht_wohnen';
  end if;

  -- Vermarktung und Einstufung
  if k in ('umbau', 'nebenbau', 'nicht_wohnen') then
    v := null; e := 'irrelevant';
    g := case k when 'umbau' then 'Umbau oder Sanierung, kein neuer Wohnraum zum Kauf' when 'nebenbau' then 'Nebenbau oder Technik' else 'Kein Wohnbau' end;
  elsif typ in ('oeffentlich', 'gemeinnuetzig') then
    v := 'miete'; e := 'irrelevant';
    g := case typ when 'oeffentlich' then 'Öffentliche Bauherrschaft, baut für Miete oder Eigenbedarf' else 'Genossenschaft, Stiftung oder Vorsorgeeinrichtung, baut fast immer für Miete' end;
  elsif typ in ('entwickler', 'architekt') then
    v := 'verkauf'; e := 'fokus';
    g := case typ when 'architekt' then 'Architekturbüro als Bauherr, Verkauf wahrscheinlich' else 'Entwickler oder Baufirma als Bauherr, Verkauf wahrscheinlich' end;
  elsif k = 'efh' then
    if typ = 'privat' and not zfh then v := 'eigenbedarf'; e := 'irrelevant'; g := 'Einzelnes Einfamilienhaus einer Privatperson, vermutlich Eigenbedarf';
    elsif typ = 'privat' then v := 'offen'; e := 'pruefen'; g := 'Zweifamilienhaus einer Privatperson, eine Einheit könnte verkauft werden';
    else v := 'offen'; e := 'pruefen'; g := 'Einfamilienhaus, Bauherrschaft unklar'; end if;
  elsif k in ('reihen', 'mehrere_efh') and typ = 'privat' then
    v := 'verkauf'; e := 'fokus'; g := 'Mehrere Häuser einer Privatperson, Verkauf wahrscheinlich';
  else
    v := 'offen'; e := 'pruefen';
    g := case when typ = 'privat' then 'Privatperson baut mehrere Wohnungen, Verkauf oder Miete offen' else 'Wohnbau, Bauherrschaft und Vermarktung unklar' end;
  end if;

  return jsonb_build_object('kategorie', k, 'bauherr_typ', typ, 'vermarktung', v, 'einstufung', e, 'begruendung', g, 'einheiten', n);
end $$;

-- Bestand per Regel einstufen (nur was nicht manuell gesetzt ist)
update public.baugesuche b set
  kategorie = r->>'kategorie', vermarktung = r->>'vermarktung', einstufung = r->>'einstufung', begruendung = r->>'begruendung',
  wohnungen = coalesce(b.wohnungen, nullif(r->>'einheiten', '')::int),
  klassifiziert_von = 'regel', klassifiziert_am = now()
from (select id, public.baugesuch_einstufen_regel(beschreibung, bauherr, bauherr_typ, wohnungen) r from public.baugesuche) x
where x.id = b.id and coalesce(b.klassifiziert_von, '') <> 'manuell';

-- Import: zusätzlich bauherr_typ (vom Abruf, ohne Namen von Privatpersonen) und Regel-Einstufung
create or replace function public.baugesuche_import(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e jsonb; v_id uuid; v_neu boolean; v_out jsonb := '[]'::jsonb; v_rel text; v_regel jsonb; v_wo int;
begin
  perform public.nur_mitglieder();
  for e in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    if coalesce(e->>'externe_id', '') = '' or coalesce(e->>'quelle', '') = '' then continue; end if;
    v_rel := public.baugesuch_relevanz(e->>'beschreibung');
    v_wo := public.baugesuch_wohnungen(e->>'beschreibung');
    v_regel := public.baugesuch_einstufen_regel(e->>'beschreibung', nullif(e->>'bauherr', ''), nullif(e->>'bauherr_typ', ''), v_wo);
    insert into public.baugesuche as b (quelle, externe_id, publ_nr, publiziert_am, frist_bis, gemeinde, kanton, ortsteil, adresse, beschreibung, bauherr, projektverfasser, url, relevanz, wohnungen,
                                        bauherr_typ, kategorie, vermarktung, einstufung, begruendung, klassifiziert_von, klassifiziert_am)
    values (e->>'quelle', e->>'externe_id', e->>'publ_nr', nullif(e->>'publiziert_am', '')::date, nullif(e->>'frist_bis', '')::date,
            e->>'gemeinde', e->>'kanton', e->>'ortsteil', e->>'adresse', e->>'beschreibung', nullif(e->>'bauherr', ''), nullif(e->>'projektverfasser', ''), e->>'url',
            v_rel, coalesce(v_wo, nullif(v_regel->>'einheiten', '')::int),
            v_regel->>'bauherr_typ', v_regel->>'kategorie', v_regel->>'vermarktung', v_regel->>'einstufung', v_regel->>'begruendung', 'regel', now())
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
      bauherr_typ = coalesce(nullif(e->>'bauherr_typ', ''), b.bauherr_typ),
      aktualisiert_am = now()
    returning id, (xmax = 0) into v_id, v_neu;
    if v_neu then
      v_out := v_out || jsonb_build_object('id', v_id, 'gemeinde', e->>'gemeinde', 'adresse', e->>'adresse', 'relevanz', v_rel, 'einstufung', v_regel->>'einstufung',
                                           'beschreibung', left(e->>'beschreibung', 200), 'bauherr', e->>'bauherr');
    end if;
  end loop;
  return v_out;
end $$;

-- Ergebnis der Claude-Einstufung speichern: p = [{id, kategorie, bauherr_typ, vermarktung, einstufung, begruendung, einheiten}, …]
-- Manuell gesetzte Einstufungen bleiben unverändert.
create or replace function public.baugesuche_einstufung_setzen(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; n int := 0; c int;
begin
  perform public.nur_mitglieder();
  for e in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    update public.baugesuche set
      kategorie = coalesce(nullif(e->>'kategorie', ''), kategorie),
      bauherr_typ = coalesce(nullif(e->>'bauherr_typ', ''), bauherr_typ),
      vermarktung = case when e ? 'vermarktung' then nullif(e->>'vermarktung', '') else vermarktung end,
      einstufung = coalesce(nullif(e->>'einstufung', ''), einstufung),
      begruendung = coalesce(nullif(e->>'begruendung', ''), begruendung),
      wohnungen = coalesce(nullif(e->>'einheiten', '')::int, wohnungen),
      klassifiziert_von = coalesce(nullif(e->>'von', ''), 'claude'),
      klassifiziert_am = now(),
      aktualisiert_am = now()
    where id = (e->>'id')::uuid and coalesce(klassifiziert_von, '') <> 'manuell';
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end $$;
revoke all on function public.baugesuche_einstufung_setzen(jsonb) from public, anon;
grant execute on function public.baugesuche_einstufung_setzen(jsonb) to authenticated, service_role;

-- Nur Bauherr-Typ nachtragen (Bestand, vom Abruf per Nachlesen der Publikation), ohne Namen von Privatpersonen
create or replace function public.baugesuche_bauherr_typ_setzen(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; n int := 0; c int;
begin
  perform public.nur_mitglieder();
  for e in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    update public.baugesuche set
      bauherr_typ = nullif(e->>'bauherr_typ', ''),
      bauherr = case when e->>'bauherr_typ' = 'privat' and public.bauherr_typ_aus_name(bauherr) is not null and bauherr ~* 'vertreten durch' then null else bauherr end,
      projektverfasser = coalesce(projektverfasser, nullif(e->>'vertreter', '')),
      aktualisiert_am = now()
    where id = (e->>'id')::uuid;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end $$;
revoke all on function public.baugesuche_bauherr_typ_setzen(jsonb) from public, anon;
grant execute on function public.baugesuche_bauherr_typ_setzen(jsonb) to authenticated, service_role;

revoke all on function public.baugesuch_einstufen_regel(text, text, text, int) from public, anon;
grant execute on function public.baugesuch_einstufen_regel(text, text, text, int) to authenticated, service_role;

-- Neubau-Radar: genauere Relevanz (Nähe von «Neubau» und Wohnbau-Begriff), täglicher Abruf per pg_cron.
-- Nur additiv.

create or replace function public.baugesuch_relevanz(p_text text) returns text
language sql immutable as $$
  select case
    when p_text is null then 'tief'
    when p_text ~* '(gestaltungsplan|sondernutzungsplan|überbauungsplan|arealüberbauung|wohnüberbauung)' then 'hoch'
    when p_text ~* '(^\s*["«„]?überbauung|überbauung\s+["«„])' then 'hoch'
    when p_text ~* '(neubau|ersatzneubau|neuerstellung|erstellung|neubauten)[^.;,]{0,40}(mehrfamilienh|\mmfh\M|reihen|doppeleinfamilienh|doppelhaus|doppelhäuser|terrassenh|einfamilienhäuser|wohnhäuser|eigentumswohnung|wohnungen|wohneinheiten|stockwerkeigentum|\d+\s*einfamilienh|zwei einfamilienh|drei einfamilienh|vier einfamilienh)' then 'hoch'
    when p_text ~* '(neubau|ersatzneubau|neuerstellung|erstellung)[^.;,]{0,25}(einfamilienhaus|wohnhaus|zweifamilienhaus)' then 'mittel'
    when p_text ~* '\mersatzneubau' then 'mittel'
    else 'tief'
  end;
$$;

update public.baugesuche set relevanz = public.baugesuch_relevanz(beschreibung) where relevanz is distinct from public.baugesuch_relevanz(beschreibung);

-- Abruf auslösen (asynchron über pg_net; die Edge Function schreibt Baugesuche, lauf_protokoll und sendet Push)
create or replace function public.baugesuche_abrufen(p_body jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform public.nur_mitglieder();
  return public.edge_aufruf('baugesuche-abruf', coalesce(p_body, '{}'::jsonb));
end $$;
revoke all on function public.baugesuche_abrufen(jsonb) from public, anon;
grant execute on function public.baugesuche_abrufen(jsonb) to authenticated, service_role;

-- Täglich 07:15 Schweizer Zeit (05:15 UTC im Sommer, 06:15 im Winter), vor dem Claude-Lauf um 10 Uhr
create extension if not exists pg_cron;
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'neubau-radar-baugesuche') then
    perform cron.schedule('neubau-radar-baugesuche', '15 5 * * *', 'select public.baugesuche_abrufen()');
  end if;
end $$;

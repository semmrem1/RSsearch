-- Korrektur: «Doppelgarage» zählt nicht als Doppelhaus

create or replace function public.baugesuch_relevanz(p_text text) returns text
language sql immutable as $$
  select case
    when p_text is null then 'tief'
    when p_text ~* '(gestaltungsplan|arealüberbauung|wohnüberbauung)' then 'hoch'
    when p_text ~* '(neubau|ersatzneubau|neuerstellung|erstellung|überbauung|neubauten)'
     and p_text ~* '(mehrfamilienh|\mmfh\M|reihen|doppeleinfamilienh|doppelhaus|doppelhäuser|doppelwohnhaus|terrassenh|einfamilienhäuser|wohnhäuser|eigentumswohnung|wohnungen|wohneinheiten|stockwerkeigentum|mehrere.{0,20}einfamilienh|\d+\s*einfamilienh)'
     and p_text !~* '^\s*(umbau|anbau|aufstockung|sanierung|umnutzung)' then 'hoch'
    when p_text ~* '(neubau|ersatzneubau|neuerstellung|erstellung)' and p_text ~* '(einfamilienhaus|wohnhaus|zweifamilienhaus)' then 'mittel'
    else 'tief'
  end;
$$;

create or replace function public.baugesuch_wohnungen(p_text text) returns int
language sql immutable as $$
  select nullif((regexp_match(coalesce(p_text, ''), '(\d{1,3})\s*(?:eigentums)?(?:wohnungen|wohneinheiten|reihenh|reiheneinfamilienh|einfamilienh|doppeleinfamilienh)', 'i'))[1], '')::int;
$$;

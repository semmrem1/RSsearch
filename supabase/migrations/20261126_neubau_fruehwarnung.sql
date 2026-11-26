-- Neubau-Frühwarnung (26.11.2026): Projekte in den Wunsch-Gemeinden schon beim Start der Vermarktung finden.
-- Anlass URSINIA Uster: Baugesuch 20.05.2026, Website online Ende Juli, Verkaufsdoku 21.09., erst am 24.11. gefunden
-- (Website nicht im Suchindex). Die Bauherrin listete das Projekt aber auf ihrer eigenen Website.
-- Nur additiv: neue Spalten, neue Tabelle, neue Funktionen, ein neuer pg_cron-Job.

-- ---------- Wunsch-Gemeinden und Domain-Stichworte ----------
alter table public.radar_gemeinden add column if not exists fruehwarnung boolean not null default false;
alter table public.radar_gemeinden add column if not exists domain_stichworte text[];

update public.radar_gemeinden set fruehwarnung = true
where name in ('Uster', 'Stäfa', 'Rapperswil-Jona', 'Freienbach', 'Pfäffikon ZH', 'Richterswil', 'Wädenswil', 'Männedorf', 'Meilen');

update public.radar_gemeinden g set domain_stichworte = s.w from (values
  ('Uster', array['uster', 'nanikon', 'nossikon', 'werrikon', 'wermatswil', 'riedikon']),
  ('Stäfa', array['staefa', 'stafa', 'uerikon']),
  ('Rapperswil-Jona', array['rapperswil', 'jona', 'kempraten', 'bollingen']),
  ('Freienbach', array['freienbach', 'pfaeffikon', 'pfaffikon', 'hurden']),
  ('Pfäffikon ZH', array['pfaeffikon', 'pfaffikon']),
  ('Richterswil', array['richterswil', 'samstagern']),
  ('Wädenswil', array['waedenswil', 'wadenswil']),
  ('Männedorf', array['maennedorf', 'mannedorf']),
  ('Meilen', array['meilen', 'feldmeilen', 'obermeilen'])
) as s(n, w)
where g.name = s.n and g.domain_stichworte is null;

-- ---------- Prognose und Prüfrhythmus pro Projekt ----------
alter table public.neubauprojekte add column if not exists vermarktung_prognose date;
alter table public.neubauprojekte add column if not exists pruefrhythmus text;
alter table public.neubauprojekte add column if not exists bauherr_projekte_url text;
alter table public.neubauprojekte add column if not exists fruehwarnung_geprueft_am date;
alter table public.neubauprojekte add column if not exists mail_entwurf_am timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'neubauprojekte_pruefrhythmus_check') then
    alter table public.neubauprojekte add constraint neubauprojekte_pruefrhythmus_check check (pruefrhythmus is null or pruefrhythmus in ('taeglich', 'woechentlich'));
  end if;
end $$;

comment on column public.neubauprojekte.vermarktung_prognose is 'Erwarteter Start der Vermarktung: frühestes Baugesuch + 2 Monate (Erfahrung URSINIA Uster)';
comment on column public.neubauprojekte.pruefrhythmus is 'taeglich: geplanter Mehrfamilienbau in einer Wunsch-Gemeinde, Baugesuch der letzten 12 Monate, nicht Miete/Eigenbedarf; sonst woechentlich';
comment on column public.neubauprojekte.bauherr_projekte_url is 'Projektseite von Bauherr, Totalunternehmer oder Architekt, die die Frühwarnung täglich abruft';

-- Rechnet Prognose und Prüfrhythmus für alle geplanten Projekte neu (täglich per pg_cron und zu Beginn des Frühwarnungs-Laufs)
create or replace function public.neubau_fruehwarnung_aktualisieren() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  with basis as (
    select p.id,
      (select min(b.publiziert_am) from public.baugesuche b where b.neubauprojekt_id = p.id) as erstes_gesuch,
      exists (select 1 from public.baugesuche b where b.neubauprojekt_id = p.id
              and (b.vermarktung in ('miete', 'eigenbedarf') or b.bauherr_typ in ('oeffentlich', 'gemeinnuetzig'))) as eher_miete,
      coalesce((select g.fruehwarnung from public.radar_gemeinden g where g.name = p.gemeinde and g.aktiv), false) as wunsch,
      public.neubau_mehrfamilien(p) as mfh,
      p.gwr_status, p.website
    from public.neubauprojekte p
    where p.phase = 'geplant'
  ), neu as (
    select id,
      case when erstes_gesuch is not null then (erstes_gesuch + interval '2 months')::date end as prognose,
      case when wunsch and mfh and not eher_miete and website is null
                and (coalesce(erstes_gesuch, current_date) >= current_date - interval '12 months' or gwr_status in (1002, 1003))
           then 'taeglich' else 'woechentlich' end as rhythmus
    from basis
  )
  update public.neubauprojekte p set vermarktung_prognose = n.prognose, pruefrhythmus = n.rhythmus
  from neu n
  where p.id = n.id and (p.vermarktung_prognose is distinct from n.prognose or p.pruefrhythmus is distinct from n.rhythmus);
  get diagnostics v_n = row_count;
  -- Projekte, die nicht mehr geplant sind, werden nicht mehr täglich geprüft
  update public.neubauprojekte set pruefrhythmus = null where phase <> 'geplant' and pruefrhythmus is not null;
  return v_n;
end $$;
revoke execute on function public.neubau_fruehwarnung_aktualisieren() from anon, public;
grant execute on function public.neubau_fruehwarnung_aktualisieren() to authenticated, service_role;

-- ---------- Domain-Radar: neue .ch-Domains mit Gemeindenamen (Zertifikatslogs) ----------
create table if not exists public.domain_funde (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  stichwort text,
  gemeinde text,
  zertifikat_ab timestamptz,
  erstmals_gesehen timestamptz not null default now(),
  quelle text not null default 'crt.sh',
  status text not null default 'neu' check (status in ('neu', 'neubau', 'irrelevant')),
  neubauprojekt_id uuid references public.neubauprojekte(id),
  notiz text,
  geprueft_am timestamptz
);
create index if not exists domain_funde_status_idx on public.domain_funde (status, erstmals_gesehen desc);
alter table public.domain_funde enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'domain_funde' and policyname = 'domain_funde_select') then
    create policy domain_funde_select on public.domain_funde for select to authenticated using (true);
    create policy domain_funde_update on public.domain_funde for update to authenticated using (not public.ist_leser()) with check (not public.ist_leser());
  end if;
end $$;
grant select, update on public.domain_funde to authenticated;
grant all on public.domain_funde to service_role;

-- Aufruf der Edge Function domain-radar (täglich per pg_cron), z.B. select public.domain_radar_abrufen();
create or replace function public.domain_radar_abrufen(p_tage integer default 3) returns bigint
language sql security definer set search_path = public as $$
  select public.edge_aufruf('domain-radar', jsonb_build_object('tage', p_tage));
$$;
revoke execute on function public.domain_radar_abrufen(integer) from anon, public;
grant execute on function public.domain_radar_abrufen(integer) to authenticated, service_role;

-- ---------- Tägliche Jobs ----------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'neubau-fruehwarnung-prognose') then
      perform cron.schedule('neubau-fruehwarnung-prognose', '40 5 * * *', 'select public.neubau_fruehwarnung_aktualisieren()');
    end if;
    if not exists (select 1 from cron.job where jobname = 'neubau-domain-radar') then
      perform cron.schedule('neubau-domain-radar', '0 5 * * *', 'select public.domain_radar_abrufen(3)');
    end if;
  end if;
end $$;

select public.neubau_fruehwarnung_aktualisieren();

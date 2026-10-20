-- Budgetrechnung: Nettolohn/Pensum pro Person, Standard-Ausgaben, Überschreibungen pro Objekt
alter table public.profiles add column if not exists nettolohn_100_monat bigint;
alter table public.profiles add column if not exists pensum_pct numeric(5,1) not null default 100;
alter table public.haushalt add column if not exists zins_effektiv numeric(4,2) not null default 1.5;
alter table public.haushalt add column if not exists weitere_einkuenfte_monat bigint not null default 0;

create table if not exists public.budget_posten (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  betrag_monat bigint not null default 0,
  kategorie text not null default 'fix' check (kategorie in ('fix','variabel','sparen')),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
-- Standardposten (Beträge 0, in der App ausfüllen)
insert into public.budget_posten (name, betrag_monat, kategorie, sort)
select * from (values
  ('Krankenkasse', 0, 'fix', 10), ('Steuern (Rückstellung)', 0, 'fix', 20), ('Versicherungen (Haushalt, Haftpflicht, Gebäude)', 0, 'fix', 30),
  ('Strom, Wasser, Heizung', 0, 'fix', 40), ('Telekom, Internet, TV', 0, 'fix', 50), ('Mobilität (Auto, ÖV)', 0, 'fix', 60), ('Kita, Betreuung', 0, 'fix', 70),
  ('Lebensmittel, Haushalt', 0, 'variabel', 80), ('Kleidung, Gesundheit', 0, 'variabel', 90), ('Freizeit, Ferien, Ausgang', 0, 'variabel', 100),
  ('Vorsorge 3a', 0, 'sparen', 110), ('Sparen, Reserven, Unterhalt Haus', 0, 'sparen', 120)
) as v(name, betrag_monat, kategorie, sort)
where not exists (select 1 from public.budget_posten);

create table if not exists public.objekt_budget (
  objekt_id uuid primary key references public.objekte (id) on delete cascade,
  daten jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.budget_posten enable row level security;
alter table public.objekt_budget enable row level security;
-- Policies <tabelle>_auth_all wie bei den übrigen Tabellen (siehe 20261019_ausbau.sql)

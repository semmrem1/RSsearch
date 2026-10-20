-- Kaufnebenkosten (Notar, Grundbuch, Handänderungssteuer) in Prozent des Kaufpreises, für den Mittelbedarf beim Kauf.
alter table public.haushalt add column if not exists kaufnebenkosten_pct numeric(4,2) not null default 1.5;

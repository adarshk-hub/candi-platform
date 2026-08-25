-- Run this against your existing Supabase Postgres (the one DATABASE_URL
-- already points to). It only touches the `clients` table — nothing else
-- changes shape yet. This DB becomes the "central registry": it still holds
-- everything for Candid Schools today, and going forward it's also where
-- every client's own connection string is looked up from.

alter table public.clients
  add column if not exists slug character varying,
  add column if not exists database_url_enc text;

-- Case-sensitive uniqueness isn't what you want for a login field — enforce
-- it on the lowercased value instead, and only when a slug is actually set.
create unique index if not exists idx_clients_slug_lower
  on public.clients (lower(slug))
  where slug is not null;

-- Backfill a slug for your existing client so login-by-name works
-- immediately. Adjust the WHERE clause if the row's name differs.
update public.clients
set slug = 'candid-schools'
where name = 'Candid Schools' and slug is null;

-- database_url_enc is intentionally left NULL here — it has to be set via
-- scripts/encrypt-value.js (below), not plain SQL, because it must be
-- encrypted with the exact same AES-256-CBC scheme lib/waEncryption.ts uses
-- to decrypt it at request time.

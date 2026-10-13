-- Kinly prototype storage: one JSON document per household.
-- Only the server (service role) touches this table; RLS is on with no
-- policies, so the public anon key cannot read elders' data.
create table if not exists public.households (
  id text primary key,
  pin_hash text not null,
  state jsonb not null,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.households enable row level security;

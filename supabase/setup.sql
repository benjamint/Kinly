-- One-shot setup for a fresh Supabase project: paste into SQL Editor and Run.
-- 1) Creates the households table (same as migrations/0001_init.sql).
-- 2) Creates a first household. CHANGE the code and PIN on the two marked lines.

create table if not exists public.households (
  id text primary key,
  pin_hash text not null,
  state jsonb not null,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.households enable row level security;

with input as (
  select
    'mama-ama'::text as code,   -- <== household code (lowercase letters, digits, dashes)
    '482913'::text   as pin     -- <== PIN, 6+ digits
)
insert into public.households (id, pin_hash, state)
select
  code,
  encode(sha256(convert_to(code || ':' || pin, 'UTF8')), 'hex'),
  jsonb_set(jsonb_set($json${
  "id": "mama-ama",
  "createdAt": "2026-10-13T12:25:56.257Z",
  "elder": {
    "name": "Ama",
    "language": "en",
    "timezone": "Africa/Accra",
    "speechSpeed": 0.9,
    "captionScale": 1,
    "showCaptions": true,
    "quietHours": {
      "start": "21:30",
      "end": "06:30"
    }
  },
  "family": [
    {
      "id": "f-esi",
      "name": "Esi",
      "relation": "daughter"
    },
    {
      "id": "f-kofi",
      "name": "Kofi",
      "relation": "son"
    }
  ],
  "reminders": [
    {
      "id": "r-bp",
      "kind": "medication",
      "label": "blood pressure tablet",
      "time": "08:00",
      "instructions": "One tablet with water, after breakfast.",
      "active": true
    },
    {
      "id": "r-lunch",
      "kind": "meal",
      "label": "lunch",
      "time": "13:00",
      "active": true
    },
    {
      "id": "r-diabetes",
      "kind": "medication",
      "label": "evening metformin",
      "time": "19:00",
      "instructions": "One tablet with dinner.",
      "active": true
    }
  ],
  "logs": [],
  "messages": [],
  "alerts": []
}$json$::jsonb, '{id}', to_jsonb(code)),
            '{createdAt}', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
from input
on conflict (id) do nothing;

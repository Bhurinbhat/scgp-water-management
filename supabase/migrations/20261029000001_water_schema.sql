-- SCGP Water Management — schema "water" (lives inside the scg-bcm-monitor Supabase project)
create schema if not exists water;

-- SCGP sites (24 locations / 27 companies) with zone, basin, upstream dams and tide station
create table if not exists water.sites (
  id          text primary key,
  name        text not null,
  zone        text not null check (zone in ('up','mid','down')),
  basin       text,
  province    text,
  district    text,
  lat         double precision not null,
  lng         double precision not null,
  site_type   text,
  dams        text[] not null default '{}',
  tide_station text,
  companies   text[] not null default '{}',
  updated_at  timestamptz not null default now()
);

-- BCM contacts kept out of the public GitHub repo and the public web page
create table if not exists water.site_contacts (
  site_id     text primary key references water.sites(id) on delete cascade,
  coordinator text,
  updated_at  timestamptz not null default now()
);

-- Trigger thresholds (one row per trigger; editable by the BCM team)
create table if not exists water.criteria (
  trigger_no  int primary key check (trigger_no between 1 and 7),
  name_th     text not null,
  method      text,
  watch       text,
  warning     text,
  critical    text,
  config      jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

-- History of what /api/water served (ThaiWater สสน. + กรมชลประทาน + กทม. + กฟผ.)
create table if not exists water.snapshots (
  id          bigint generated always as identity primary key,
  fetched_at  timestamptz not null,
  source      text not null default 'live',
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists snapshots_fetched_at_idx on water.snapshots (fetched_at desc);

-- Shared secret for the Vercel ingest call
create table if not exists water.app_secret (
  name  text primary key,
  value text not null
);

alter table water.sites enable row level security;
alter table water.site_contacts enable row level security;
alter table water.criteria enable row level security;
alter table water.snapshots enable row level security;
alter table water.app_secret enable row level security;
-- No policies: nothing in schema "water" is readable or writable through the public API.
revoke all on schema water from anon, authenticated;

-- Ingest: called by the Vercel function with the shared key; stores at most one snapshot per 30 minutes.
create or replace function public.water_ingest_snapshot(p_key text, p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last timestamptz;
begin
  if p_key is null or p_key <> (select value from water.app_secret where name = 'ingest_key') then
    raise exception 'invalid key' using errcode = '28000';
  end if;
  select max(fetched_at) into v_last from water.snapshots;
  if v_last is not null and v_last > now() - interval '30 minutes' then
    return 'skipped';
  end if;
  insert into water.snapshots (fetched_at, source, payload)
  values (coalesce((p_payload->>'fetchedAt')::timestamptz, now()), coalesce(p_payload->>'source', 'live'), p_payload);
  delete from water.snapshots where fetched_at < now() - interval '180 days';
  return 'stored';
end;
$$;

-- Fallback read: latest stored snapshot (public open data only, no contacts)
create or replace function public.water_latest_snapshot(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key is null or p_key <> (select value from water.app_secret where name = 'ingest_key') then
    raise exception 'invalid key' using errcode = '28000';
  end if;
  return (select payload from water.snapshots order by fetched_at desc limit 1);
end;
$$;

revoke all on function public.water_ingest_snapshot(text, jsonb) from public;
revoke all on function public.water_latest_snapshot(text) from public;
grant execute on function public.water_ingest_snapshot(text, jsonb) to anon, authenticated;
grant execute on function public.water_latest_snapshot(text) to anon, authenticated;

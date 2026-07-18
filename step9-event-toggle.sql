-- =====================================================================
-- STEP 9 — Event mission ON/OFF toggle
-- Single-row settings table. Admin flips mission_active; the missions
-- page reads it publicly and shows COMING SOON (locked) when false.
-- =====================================================================
create table if not exists event_settings (
  id            int primary key default 1,
  mission_active boolean not null default false,
  updated_at    timestamptz not null default now(),
  constraint event_settings_singleton check (id = 1)
);

insert into event_settings (id, mission_active)
values (1, false)
on conflict (id) do nothing;

alter table event_settings enable row level security;

-- public (anon) can read the flag
drop policy if exists event_settings_read on event_settings;
create policy event_settings_read on event_settings
  for select using (true);

-- only logged-in admin (Supabase Auth) can change it
drop policy if exists event_settings_write on event_settings;
create policy event_settings_write on event_settings
  for all to authenticated using (true) with check (true);

-- =====================================================================
-- STEP 12 - Event mission testers
--
-- Adds an address allowlist alongside the existing on/off flag. While
-- mission_active is false the missions page stays locked for everyone
-- except the wallets listed here, so the event can be exercised end to
-- end before it opens to the public.
--
-- Scope note: the missions page enforces this in the browser, exactly as
-- it already enforces mission_active. This controls what the page shows,
-- not what the API accepts. If the event needs to be genuinely closed,
-- the missions edge function has to make the same check server side.
-- =====================================================================

alter table event_settings
  add column if not exists test_addresses text[] not null default '{}';

-- Addresses are compared in lower case. Store them that way.
create or replace function event_settings_lower_addresses()
returns trigger language plpgsql as $$
begin
  new.test_addresses := (
    select coalesce(array_agg(distinct lower(btrim(a))), '{}')
    from unnest(new.test_addresses) as a
    where btrim(a) <> ''
  );
  return new;
end $$;

drop trigger if exists event_settings_lower_addresses_trg on event_settings;
create trigger event_settings_lower_addresses_trg
  before insert or update on event_settings
  for each row execute function event_settings_lower_addresses();

-- The existing read policy already exposes this row to anon, which is what
-- the missions page needs. Writing stays restricted to authenticated admin.

-- ---------------------------------------------------------------------
-- Usage
-- ---------------------------------------------------------------------

-- Add a tester (repeat the address argument to add several at once):
--   update event_settings
--      set test_addresses = test_addresses || array['0xYourWalletHere']
--    where id = 1;

-- Remove a tester:
--   update event_settings
--      set test_addresses = array_remove(test_addresses, lower('0xYourWalletHere'))
--    where id = 1;

-- Clear the list:
--   update event_settings set test_addresses = '{}' where id = 1;

-- Inspect:
--   select mission_active, test_addresses from event_settings where id = 1;

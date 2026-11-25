-- Front desk picks and admin days, set per day in the Schedule Builder.
--   front_desk_overrides  front desk seat index -> staff id, when picked by hand
--                         (e.g. Karla covering the front desk)
--   admin_ids             staff doing admin that day: working, but kept off the
--                         front desk and assisting (e.g. Ketki)
alter table public.schedules add column if not exists front_desk_overrides jsonb not null default '{}'::jsonb;
alter table public.schedules add column if not exists admin_ids integer[] not null default '{}';

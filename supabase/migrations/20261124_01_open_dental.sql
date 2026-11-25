-- Open Dental schedule sync.
--
-- The app writes two kinds of blockouts into Open Dental:
--   * one "Deccan App" blockout per day in the Notes column (just under the
--     team's own note, if there is one), in
--     its own blockout type/colour: warnings, the day's team, who is off,
--     events, birthdays, holidays and the rest of the month. The team's own
--     hand-typed Staff Schedules note is left alone;
--   * a booking-blocking blockout on a doctor's or hygienist's own columns
--     for each day of their approved leave.
--
-- Only blockouts the app created are ever changed or removed: every one is
-- recorded in od_blockouts with the ScheduleNum Open Dental gave it.
-- Lines the team adds to the Deccan App blockout in Open Dental are kept; if they
-- change one of the app's lines, the app stops updating that day's note and
-- flags it; if they delete the note, it stays deleted.
--
-- All four tables are read and written only by server routes (service role);
-- the public key has no access (see 20261122_02_lock_down_public_key.sql).

-- Single settings row (id is always 1).
create table if not exists public.od_settings (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default false,
  notes_operatory_num integer,          -- the "Notes" column
  staff_blockout_type integer,          -- definition.DefNum for the Deccan App blockout (its own colour)
  provider_blockout_type integer,       -- definition.DefNum for a provider's time off
  day_start text not null default '07:00',
  midday text not null default '12:00',
  day_end text not null default '18:00',
  row_minutes integer not null default 10,   -- one line of blockout text per row
  days_ahead integer not null default 60,
  updated_at timestamptz not null default now()
);
insert into public.od_settings (id) values (1) on conflict (id) do nothing;

-- How each staff member appears in Open Dental.
create table if not exists public.od_staff_links (
  employee_id integer primary key references public.staff(id) on delete cascade,
  display_name text not null default '',       -- e.g. "AC" for a doctor, "UNIQUE" for an assistant
  prov_num integer,                            -- Open Dental provider, for doctors and hygienists
  operatory_nums integer[] not null default '{}', -- columns blocked when this provider is out
  updated_at timestamptz not null default now()
);

-- Every blockout the app has created in Open Dental.
--   kind = 'staff'    the day's Deccan App blockout (employee_id null)
--   kind = 'provider' a provider's time-off blockout
create table if not exists public.od_blockouts (
  id uuid primary key default gen_random_uuid(),
  date text not null,
  kind text not null check (kind in ('staff', 'provider')),
  employee_id integer,
  schedule_num bigint not null,
  content_hash text not null,
  -- For the Deccan App blockout: the lines the app wrote last time. Lines the team
  -- adds in Open Dental are anything beyond these, and are kept.
  last_note text,
  -- The team deleted this note in Open Dental: it stays deleted.
  deleted_in_od boolean not null default false,
  synced_at timestamptz not null default now()
);
create unique index if not exists od_blockouts_unique
  on public.od_blockouts (date, kind, coalesce(employee_id, 0));

-- Result of the most recent sync of each date.
create table if not exists public.od_sync_days (
  date text primary key,
  status text not null check (status in ('ok', 'error', 'skipped_manual', 'edited_in_od', 'deleted_in_od')),
  message text,
  synced_at timestamptz not null default now()
);

-- One-off note for the day's floater, e.g. "help Jansten too".
alter table public.schedules add column if not exists floater_note text;

-- Changes made to a day's Deccan App blockout from the Schedule Builder:
--   od_extra_lines  extra lines added under the title (kept as the plan changes)
--   od_override     the whole text, written exactly as typed; null = automatic
alter table public.schedules add column if not exists od_extra_lines text;
alter table public.schedules add column if not exists od_override text;

-- Birthday as "MM-DD" (no year), shown on the Deccan App blockout on the day.
-- Staff can set or clear their own from their dashboard.
alter table public.staff add column if not exists birthday text
  check (birthday is null or birthday ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');

alter table public.od_settings enable row level security;
alter table public.od_staff_links enable row level security;
alter table public.od_blockouts enable row level security;
alter table public.od_sync_days enable row level security;
revoke all on public.od_settings, public.od_staff_links, public.od_blockouts, public.od_sync_days from anon, authenticated;

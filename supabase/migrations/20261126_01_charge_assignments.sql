-- The charge assistant for each day. Decided by the app (rotating fairly so
-- every assistant takes turns; see src/lib/charge.ts) or picked by hand
-- (manual). Read and written only by server routes.
create table if not exists public.charge_assignments (
  date text primary key,
  employee_id integer not null references public.staff(id) on delete cascade,
  manual boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.charge_assignments enable row level security;
revoke all on public.charge_assignments from anon, authenticated;

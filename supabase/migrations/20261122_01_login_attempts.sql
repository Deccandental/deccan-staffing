-- Step 1 — safe to run at any time, before or after the code is deployed.
-- Records wrong login codes so /api/auth/login can slow down PIN guessing.
create table if not exists public.login_attempts (
  id bigserial primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_ip_at on public.login_attempts (ip, at);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated;

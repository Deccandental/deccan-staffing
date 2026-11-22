-- Step 2 — run ONLY AFTER the new code is live in production.
--
-- Until now the browser read and wrote most tables directly with the public
-- (anon) key, and Row Level Security was off on 43 tables — so anyone with
-- that key (it ships in every page) could read or change payroll, bank data,
-- staff notes and every staff PIN. The new code sends every query through
-- /api/secure-data, which checks the caller's login and uses the service
-- role key. After this script the public key can't reach any table at all.
--
-- The service role key bypasses RLS, so the app's server routes are unaffected.

do $$
declare t record; p record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    -- Remove the old "Allow all" style policies.
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t.tablename loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t.tablename);
    end loop;
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on public.%I from anon, authenticated', t.tablename);
  end loop;
end $$;

revoke usage, select on all sequences in schema public from anon, authenticated;

-- Tables created later start out closed to the public key too.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Certificates: uploads now go through /api/certs/upload-url (signed, login
-- required). Existing files stay publicly viewable by their link.
drop policy if exists "Allow public uploads to certificates bucket" on storage.objects;

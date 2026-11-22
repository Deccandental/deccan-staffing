-- Step 3 — run after the two staff who currently share a PIN have been given
-- new ones (this will fail while a duplicate exists). Guarantees no two
-- people can ever have the same PIN, which the login relies on.
create unique index if not exists staff_pin_unique on public.staff (pin) where pin is not null and pin <> '';

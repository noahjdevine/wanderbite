-- Now that pin_hash is populated for every restaurant and no code reads or
-- writes the plaintext `pin` column, drop it.

alter table public.restaurants
  drop column if exists pin;

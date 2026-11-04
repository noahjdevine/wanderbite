-- Phase 1.4: an issued QR lasts REDEMPTION_TTL_MINUTES (src/lib/redemption-expiry.ts),
-- capped at challenge_items.redemption_deadline. Does not rewrite stored expires_at.
-- Not applied to hosted until Noah approves a db push.
-- No new table. Existing RLS policies are unchanged.
-- issue_challenge_redemption stays security invoker. Execute stays service_role only.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.redemptions
  alter column expires_at set default (now() + interval '15 minutes');

comment on column public.redemptions.expires_at is
  'Issued QR lifetime. Issuance passes REDEMPTION_TTL_MINUTES from src/lib/redemption-expiry.ts and this function caps it with least() at challenge_items.redemption_deadline. Rows already stored keep their expires_at. Verify requires expires_at > now(). The column default matches that 15-minute lifetime for inserts that omit the column.';

create index if not exists redemptions_issued_expires_at_idx
  on public.redemptions (expires_at, id)
  where status = 'issued';

create or replace function public.issue_challenge_redemption(
  p_user_id uuid,
  p_item_id uuid,
  p_token_hash text,
  p_encrypted_code text,
  p_code_iv text,
  p_expires_at timestamptz
)
returns table (
  outcome text,
  redemption_id uuid,
  challenge_item_id uuid,
  encrypted_code text,
  code_iv text,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  n integer;
  source public.challenge_items%rowtype;
  cycle public.challenge_cycles%rowtype;
  issued public.redemptions%rowtype;
  constraint_name text;
begin
  if p_user_id is null or p_item_id is null then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  select ci.* into source from public.challenge_items as ci where ci.id = p_item_id;
  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  select cc.* into cycle from public.challenge_cycles as cc where cc.id = source.cycle_id for update;
  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;
  if cycle.user_id is distinct from p_user_id then
    return query select 'forbidden'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  select ci.* into source from public.challenge_items as ci where ci.id = p_item_id for update;
  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  if source.status = 'redeemed' then
    select rd.* into issued
    from public.redemptions as rd
    where rd.challenge_item_id = p_item_id
    for update;
    get diagnostics n = row_count;
    if n is distinct from 1 then
      return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
      return;
    end if;

    -- Verified visits stay verified. A live issued code is returned unchanged,
    -- including codes stored before the 15-minute lifetime.
    if issued.status = 'verified'
       or (issued.status = 'issued' and issued.expires_at > now()) then
      if issued.encrypted_code is null or issued.code_iv is null then
        return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
        return;
      end if;
      return query select 'existing'::text, issued.id, issued.challenge_item_id, issued.encrypted_code, issued.code_iv, issued.created_at;
      return;
    end if;

    if issued.status is distinct from 'issued' and issued.status is distinct from 'expired' then
      return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
      return;
    end if;

    if source.redemption_deadline is not null and now() >= source.redemption_deadline then
      return query select 'past_deadline'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
      return;
    end if;

    if source.redemption_deadline is not null then
      p_expires_at := least(p_expires_at, source.redemption_deadline);
    end if;

    if p_token_hash is null
       or p_token_hash !~ '^[0-9a-f]{64}$'
       or p_encrypted_code is null
       or length(p_encrypted_code) = 0
       or p_code_iv is null
       or length(p_code_iv) = 0
       or p_expires_at is null
       or p_expires_at <= now()
    then
      raise exception 'OPS-02: invalid redemption token payload';
    end if;

    n := 0;
    begin
      update public.redemptions as rd
      set token_hash = p_token_hash,
          encrypted_code = p_encrypted_code,
          code_iv = p_code_iv,
          status = 'issued',
          expires_at = p_expires_at
      where rd.id = issued.id
        and rd.status in ('issued', 'expired')
        and (rd.status = 'expired' or rd.expires_at <= now())
      returning * into issued;
      get diagnostics n = row_count;
    exception
      when unique_violation then
        get stacked diagnostics constraint_name = constraint_name;
        if constraint_name = 'redemptions_token_hash_key' then
          return query select 'token_collision'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
          return;
        else
          raise;
        end if;
    end;

    if n is distinct from 1 then
      select rd.* into issued
      from public.redemptions as rd
      where rd.challenge_item_id = p_item_id;
      if issued.status = 'verified'
         or (issued.status = 'issued' and issued.expires_at > now()) then
        return query select 'existing'::text, issued.id, issued.challenge_item_id, issued.encrypted_code, issued.code_iv, issued.created_at;
        return;
      end if;
      raise exception 'OPS-02: redemption reissue expected 1 row, got %', n;
    end if;

    return query select 'reissued'::text, issued.id, issued.challenge_item_id, issued.encrypted_code, issued.code_iv, issued.created_at;
    return;
  end if;

  if source.status is distinct from 'assigned' then
    return query select 'not_assigned'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  if source.redemption_deadline is not null then
    if now() >= source.redemption_deadline then
      return query select 'past_deadline'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
      return;
    end if;
    p_expires_at := least(p_expires_at, source.redemption_deadline);
  end if;

  if p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_encrypted_code is null
     or length(p_encrypted_code) = 0
     or p_code_iv is null
     or length(p_code_iv) = 0
     or p_expires_at is null
     or p_expires_at <= now()
  then
    raise exception 'OPS-02: invalid redemption token payload';
  end if;

  begin
    insert into public.redemptions (
      user_id, restaurant_id, challenge_item_id, token_hash, encrypted_code, code_iv, status, expires_at
    ) values (
      p_user_id, source.restaurant_id, p_item_id, p_token_hash, p_encrypted_code, p_code_iv, 'issued', p_expires_at
    )
    returning * into issued;
  exception
    when unique_violation then
      get stacked diagnostics constraint_name = constraint_name;
      if constraint_name = 'redemptions_token_hash_key' then
        return query select 'token_collision'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
        return;
      elsif constraint_name = 'redemptions_challenge_item_id_key' then
        select rd.* into issued from public.redemptions as rd where rd.challenge_item_id = p_item_id;
        update public.challenge_items as ci set status = 'redeemed'
        where ci.id = p_item_id and ci.status = 'assigned';
        return query select 'existing'::text, issued.id, issued.challenge_item_id, issued.encrypted_code, issued.code_iv, issued.created_at;
        return;
      else
        raise;
      end if;
  end;

  update public.challenge_items as ci
  set status = 'redeemed'
  where ci.id = p_item_id and ci.status = 'assigned';
  get diagnostics n = row_count;
  if n is distinct from 1 then
    raise exception 'OPS-02: redemption item update expected 1 row, got %', n;
  end if;

  return query select 'created'::text, issued.id, issued.challenge_item_id, issued.encrypted_code, issued.code_iv, issued.created_at;
end;
$$;

comment on function public.issue_challenge_redemption(uuid, uuid, text, text, text, timestamptz) is
  'Issue one redemption per challenge item. expires_at is least(p_expires_at, redemption_deadline) when a visit window exists. An expired code on an open window rotates token_hash on the same row. A verified redemption is returned unchanged.';

revoke all on function public.issue_challenge_redemption(uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.issue_challenge_redemption(uuid, uuid, text, text, text, timestamptz)
  to service_role;

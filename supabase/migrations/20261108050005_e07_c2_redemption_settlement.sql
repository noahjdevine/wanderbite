-- E07-C2: store one Boost confirmation snapshot on a verified redemption.
-- Applied to hosted as 20261108050005 on 2026-11-09. Do not run supabase db push for this file.
-- E07_ARRIVAL_SESSIONS_ENABLED and E07_BILL_SCAN_AZURE_ENABLED stay unset.
-- Does not replace verify_redemption or verify_redemption_and_settle.
-- Those functions set status and verified_at only. New columns are nullable,
-- so an existing insert or update leaves them null.
-- Does not insert redemptions, set boost_arrival_sessions.redemption_id,
-- close an arrival session, or award a badge, XP, credit, or progress row.
-- A null sealed snapshot (kind use_sealed_base, both sealed cents null) is a
-- recorded miss. First write wins. One quote_id can be consumed once.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.redemptions
  add column settlement_kind text,
  add column settled_at timestamptz,
  add column quote_id uuid,
  add column quote_version integer,
  add column base_discount_cents integer,
  add column boost_discount_cents integer,
  add column total_discount_cents integer,
  add column eligible_subtotal_cents integer,
  add column below_minimum boolean,
  add column tier_id text,
  add column boost_id text,
  add column locked_boost_id text,
  add column quote_expires_at timestamptz,
  add column sealed_discount_amount_cents integer,
  add column sealed_min_spend_cents integer;

alter table public.redemptions
  add constraint redemptions_quote_id_fkey
    foreign key (quote_id)
    references public.boost_quotes (id)
    on delete restrict,
  add constraint redemptions_settlement_kind_check
    check (
      settlement_kind is null
      or settlement_kind in ('consume_quote', 'use_sealed_base')
    ),
  add constraint redemptions_settlement_pair_check
    check (
      (settlement_kind is null and settled_at is null)
      or (settlement_kind is not null and settled_at is not null)
    ),
  add constraint redemptions_settlement_empty_check
    check (
      settlement_kind is not null
      or (
        quote_id is null
        and quote_version is null
        and base_discount_cents is null
        and boost_discount_cents is null
        and total_discount_cents is null
        and eligible_subtotal_cents is null
        and below_minimum is null
        and tier_id is null
        and boost_id is null
        and locked_boost_id is null
        and quote_expires_at is null
        and sealed_discount_amount_cents is null
        and sealed_min_spend_cents is null
      )
    ),
  add constraint redemptions_settlement_consume_check
    check (
      settlement_kind is distinct from 'consume_quote'
      or (
        quote_id is not null
        and quote_version is not null
        and quote_version >= 1
        and base_discount_cents is not null
        and base_discount_cents >= 0
        and boost_discount_cents is not null
        and boost_discount_cents >= 0
        and total_discount_cents is not null
        and total_discount_cents >= 0
        and eligible_subtotal_cents is not null
        and eligible_subtotal_cents >= 0
        and below_minimum is not null
        and quote_expires_at is not null
        and base_discount_cents::bigint + boost_discount_cents::bigint
          = total_discount_cents::bigint
        and total_discount_cents <= eligible_subtotal_cents
        and sealed_discount_amount_cents is null
        and sealed_min_spend_cents is null
      )
    ),
  add constraint redemptions_settlement_sealed_check
    check (
      settlement_kind is distinct from 'use_sealed_base'
      or (
        quote_id is null
        and quote_version is null
        and base_discount_cents is null
        and boost_discount_cents is null
        and total_discount_cents is null
        and eligible_subtotal_cents is null
        and below_minimum is null
        and tier_id is null
        and boost_id is null
        and locked_boost_id is null
        and quote_expires_at is null
        and (
          (
            sealed_discount_amount_cents is null
            and sealed_min_spend_cents is null
          )
          or (
            sealed_discount_amount_cents is not null
            and sealed_min_spend_cents is not null
            and sealed_discount_amount_cents >= 0
            and sealed_min_spend_cents >= 0
          )
        )
      )
    );

create unique index redemptions_quote_id_consumed_key
  on public.redemptions (quote_id)
  where quote_id is not null;

comment on column public.redemptions.settlement_kind is
  'E07-C2 confirmation snapshot. Null until record_boost_settlement. consume_quote stores the quote parts. use_sealed_base stores SealedBase, or both sealed cents null for a recorded miss.';

-- Service role only. Updates one existing verified row. Does not insert.
create or replace function public.record_boost_settlement(
  p_redemption_id uuid,
  p_settlement_kind text,
  p_settled_at timestamptz,
  p_quote_id uuid,
  p_quote_version integer,
  p_base_discount_cents integer,
  p_boost_discount_cents integer,
  p_total_discount_cents integer,
  p_eligible_subtotal_cents integer,
  p_below_minimum boolean,
  p_tier_id text,
  p_boost_id text,
  p_locked_boost_id text,
  p_quote_expires_at timestamptz,
  p_sealed_discount_amount_cents integer,
  p_sealed_min_spend_cents integer
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  rec public.redemptions%rowtype;
  wrote boolean := false;
  n integer := 0;
  valid boolean := false;
begin
  select * into rec
  from public.redemptions
  where id = p_redemption_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if rec.status is distinct from 'verified' or rec.verified_at is null then
    return jsonb_build_object('status', 'not_verified');
  end if;

  if rec.settlement_kind is null then
    valid := case
      when p_settlement_kind = 'consume_quote' then (
        p_settled_at is not null
        and p_quote_id is not null
        and p_quote_version is not null
        and p_quote_version >= 1
        and p_base_discount_cents is not null
        and p_base_discount_cents >= 0
        and p_boost_discount_cents is not null
        and p_boost_discount_cents >= 0
        and p_total_discount_cents is not null
        and p_total_discount_cents >= 0
        and p_eligible_subtotal_cents is not null
        and p_eligible_subtotal_cents >= 0
        and p_below_minimum is not null
        and p_quote_expires_at is not null
        and p_base_discount_cents::bigint + p_boost_discount_cents::bigint
          = p_total_discount_cents::bigint
        and p_total_discount_cents <= p_eligible_subtotal_cents
        and p_sealed_discount_amount_cents is null
        and p_sealed_min_spend_cents is null
      )
      when p_settlement_kind = 'use_sealed_base' then (
        p_settled_at is not null
        and p_quote_id is null
        and p_quote_version is null
        and p_base_discount_cents is null
        and p_boost_discount_cents is null
        and p_total_discount_cents is null
        and p_eligible_subtotal_cents is null
        and p_below_minimum is null
        and p_tier_id is null
        and p_boost_id is null
        and p_locked_boost_id is null
        and p_quote_expires_at is null
        and (
          (
            p_sealed_discount_amount_cents is null
            and p_sealed_min_spend_cents is null
          )
          or (
            p_sealed_discount_amount_cents is not null
            and p_sealed_min_spend_cents is not null
            and p_sealed_discount_amount_cents >= 0
            and p_sealed_min_spend_cents >= 0
          )
        )
      )
      else false
    end;

    if not valid then
      return jsonb_build_object('status', 'invalid_snapshot');
    end if;

    if p_settlement_kind = 'consume_quote' then
      if not exists (
        select 1 from public.boost_quotes q where q.id = p_quote_id
      ) then
        return jsonb_build_object('status', 'invalid_snapshot');
      end if;
      if exists (
        select 1
        from public.redemptions other
        where other.quote_id = p_quote_id
          and other.id <> p_redemption_id
      ) then
        return jsonb_build_object('status', 'quote_already_consumed');
      end if;
    end if;

    begin
      update public.redemptions
      set
        settlement_kind = p_settlement_kind,
        settled_at = p_settled_at,
        quote_id = p_quote_id,
        quote_version = p_quote_version,
        base_discount_cents = p_base_discount_cents,
        boost_discount_cents = p_boost_discount_cents,
        total_discount_cents = p_total_discount_cents,
        eligible_subtotal_cents = p_eligible_subtotal_cents,
        below_minimum = p_below_minimum,
        tier_id = p_tier_id,
        boost_id = p_boost_id,
        locked_boost_id = p_locked_boost_id,
        quote_expires_at = p_quote_expires_at,
        sealed_discount_amount_cents = p_sealed_discount_amount_cents,
        sealed_min_spend_cents = p_sealed_min_spend_cents
      where id = p_redemption_id
        and settlement_kind is null
      returning * into rec;
      get diagnostics n = row_count;
      if n is distinct from 1 then
        return jsonb_build_object('status', 'unavailable');
      end if;
      wrote := true;
    exception
      when unique_violation then
        return jsonb_build_object('status', 'quote_already_consumed');
      when foreign_key_violation or check_violation then
        return jsonb_build_object('status', 'invalid_snapshot');
    end;
  end if;

  return jsonb_build_object(
    'status', case when wrote then 'created' else 'already_settled' end,
    'snapshot', jsonb_build_object(
      'settlement_kind', rec.settlement_kind,
      'settled_at', rec.settled_at,
      'quote_id', rec.quote_id,
      'quote_version', rec.quote_version,
      'base_discount_cents', rec.base_discount_cents,
      'boost_discount_cents', rec.boost_discount_cents,
      'total_discount_cents', rec.total_discount_cents,
      'eligible_subtotal_cents', rec.eligible_subtotal_cents,
      'below_minimum', rec.below_minimum,
      'tier_id', rec.tier_id,
      'boost_id', rec.boost_id,
      'locked_boost_id', rec.locked_boost_id,
      'quote_expires_at', rec.quote_expires_at,
      'sealed_discount_amount_cents', rec.sealed_discount_amount_cents,
      'sealed_min_spend_cents', rec.sealed_min_spend_cents
    )
  );
end;
$$;

revoke all on function public.record_boost_settlement(
  uuid, text, timestamptz, uuid, integer, integer, integer, integer, integer,
  boolean, text, text, text, timestamptz, integer, integer
) from public, anon, authenticated, service_role;

grant execute on function public.record_boost_settlement(
  uuid, text, timestamptz, uuid, integer, integer, integer, integer, integer,
  boolean, text, text, text, timestamptz, integer, integer
) to service_role;

comment on function public.record_boost_settlement(
  uuid, text, timestamptz, uuid, integer, integer, integer, integer, integer,
  boolean, text, text, text, timestamptz, integer, integer
) is
  'E07-C2 first write of a confirmation snapshot on one verified redemption. Service role only. Not a replacement for verify_redemption.';

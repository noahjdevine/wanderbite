-- E07-B2 private receipt storage and bill-scan proposals.
-- NOT applied to hosted. Do not run supabase db push for this file in this PR.
-- E07_BILL_SCAN_AZURE_ENABLED stays unset. E07_ARRIVAL_SESSIONS_ENABLED stays unset.
-- No member page, no cron, and no change to restaurant-photos or verify_redemption.
-- Receipt retention is a fourth clock. It does not reuse the 15-minute QR TTL,
-- the 840-hour visit deadline, or credit expiry.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bill-receipts',
  'bill-receipts',
  false,
  10000000,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
);

-- Service role only. No public, anon, or authenticated read of receipt objects.
create policy "service role insert bill-receipts"
  on storage.objects for insert
  to service_role
  with check (bucket_id = 'bill-receipts');

create policy "service role select bill-receipts"
  on storage.objects for select
  to service_role
  using (bucket_id = 'bill-receipts');

create policy "service role delete bill-receipts"
  on storage.objects for delete
  to service_role
  using (bucket_id = 'bill-receipts');

create table public.bill_scan_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete restrict,
  arrival_session_id uuid not null references public.boost_arrival_sessions (id) on delete restrict,
  object_path text not null,
  content_type text not null,
  byte_size integer not null,
  width integer not null,
  height integer not null,
  source text not null,
  proposal jsonb not null,
  confirmed_eligible_subtotal_cents integer,
  created_at timestamptz not null default now(),
  retain_until timestamptz not null,
  deleted_at timestamptz,
  constraint bill_scan_proposals_object_path_check
    check (object_path = user_id::text || '/' || id::text),
  constraint bill_scan_proposals_content_type_check
    check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  constraint bill_scan_proposals_byte_size_check
    check (byte_size between 1 and 10000000),
  constraint bill_scan_proposals_dimensions_check
    check (width between 1 and 8000 and height between 1 and 8000),
  constraint bill_scan_proposals_source_check
    check (source in ('fixture', 'manual', 'ocr_stub', 'azure_prebuilt_receipt')),
  constraint bill_scan_proposals_proposal_object
    check (
      jsonb_typeof(proposal) = 'object'
      and not (proposal ? 'total_discount_cents')
      and not (proposal ? 'tier_id')
      and not (proposal ? 'boost_id')
      and not (proposal ? 'base_discount_cents')
      and not (proposal ? 'boost_discount_cents')
      and not (proposal ? 'quote_version')
      and not (proposal ? 'locked_boost_id')
    ),
  constraint bill_scan_proposals_confirmed_check
    check (
      confirmed_eligible_subtotal_cents is null
      or confirmed_eligible_subtotal_cents >= 0
    ),
  constraint bill_scan_proposals_retain_check
    check (retain_until > created_at),
  constraint bill_scan_proposals_deleted_check
    check (deleted_at is null or deleted_at >= created_at)
);

create index bill_scan_proposals_user_id_idx
  on public.bill_scan_proposals (user_id);

create index bill_scan_proposals_session_id_idx
  on public.bill_scan_proposals (arrival_session_id);

create index bill_scan_proposals_retain_until_idx
  on public.bill_scan_proposals (retain_until)
  where deleted_at is null;

alter table public.bill_scan_proposals enable row level security;

revoke all on table public.bill_scan_proposals
  from public, anon, authenticated, service_role;

grant select, insert, update on table public.bill_scan_proposals to service_role;

create or replace function public.bill_scan_proposals_scope()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  sess_restaurant uuid;
  sess_status text;
  member_id uuid;
begin
  select s.restaurant_id, s.status, cc.user_id
    into sess_restaurant, sess_status, member_id
  from public.boost_arrival_sessions s
  join public.challenge_items ci on ci.id = s.challenge_item_id
  join public.challenge_cycles cc on cc.id = ci.cycle_id
  where s.id = new.arrival_session_id;

  if sess_restaurant is null then
    raise exception 'bill scan session missing' using errcode = '23514';
  end if;
  if sess_restaurant is distinct from new.restaurant_id then
    raise exception 'bill scan restaurant mismatch' using errcode = '23514';
  end if;
  if member_id is null or member_id is distinct from new.user_id then
    raise exception 'bill scan member mismatch' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and sess_status is distinct from 'open' then
    raise exception 'bill scan session not open' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.user_id is distinct from old.user_id
       or new.restaurant_id is distinct from old.restaurant_id
       or new.arrival_session_id is distinct from old.arrival_session_id
       or new.object_path is distinct from old.object_path
       or new.content_type is distinct from old.content_type
       or new.byte_size is distinct from old.byte_size
       or new.width is distinct from old.width
       or new.height is distinct from old.height
       or new.source is distinct from old.source
       or new.proposal is distinct from old.proposal
       or new.created_at is distinct from old.created_at
       or new.retain_until is distinct from old.retain_until then
      raise exception 'bill scan proposal columns are fixed' using errcode = '23514';
    end if;
    if old.confirmed_eligible_subtotal_cents is not null
       and new.confirmed_eligible_subtotal_cents is null then
      raise exception 'bill scan confirmation cannot be cleared' using errcode = '23514';
    end if;
    if old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at then
      raise exception 'bill scan deletion is permanent' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger bill_scan_proposals_scope
  before insert or update on public.bill_scan_proposals
  for each row execute function public.bill_scan_proposals_scope();

revoke all on function public.bill_scan_proposals_scope()
  from public, anon, authenticated, service_role;

comment on table public.bill_scan_proposals is
  'Private receipt proposal. object_path is the key in bucket bill-receipts. No image bytes. confirmed_eligible_subtotal_cents stays null until staff confirm. Service role only.';

-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E07-B2: private bill-receipts bucket, service-role grants, open-session scope.
begin;
set local statement_timeout = '15s';

do $$
declare
  member uuid := 'e07b0000-0000-4000-8000-000000000001';
  other_member uuid := 'e07b0000-0000-4000-8000-000000000002';
  grill uuid := 'e07b0000-0000-4000-8000-000000000011';
  other uuid := 'e07b0000-0000-4000-8000-000000000012';
  version_id uuid := 'e07b0000-0000-4000-8000-000000000021';
  cycle_id uuid := 'e07b0000-0000-4000-8000-000000000031';
  item_id uuid := 'e07b0000-0000-4000-8000-000000000041';
  proposal_id uuid := 'e07b0000-0000-4000-8000-000000000061';
  token_hash text := repeat('ab', 32);
  opened jsonb;
  opened_id uuid;
  stored_at timestamptz := '2026-11-06 15:00:00+00';
  keep_until timestamptz := '2026-11-13 15:00:00+00';
  proposal_json jsonb := jsonb_build_object(
    'ok', true,
    'proposed_eligible_subtotal_cents', 8200,
    'applied_exclusions', jsonb_build_object(
      'exclude_tax', true,
      'exclude_tip', true,
      'categories', '[]'::jsonb,
      'removed_cents', 1800
    ),
    'uncertainty_flags', '[]'::jsonb,
    'source', 'fixture'
  );
  receipt_path text;
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'bill-receipts'
      and public = false
      and file_size_limit = 10000000
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  ) then
    raise exception 'FAIL: bill-receipts bucket';
  end if;
  if not exists (
    select 1 from storage.buckets
    where id = 'restaurant-photos'
      and public
      and file_size_limit = 5242880
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  ) then
    raise exception 'FAIL: restaurant-photos bucket changed';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'public read of restaurant-photos'
  ) then
    raise exception 'FAIL: restaurant-photos read policy changed';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%bill-receipts%'
      and roles && array['public', 'anon', 'authenticated']::name[]
  ) then
    raise exception 'FAIL: client policy on bill-receipts';
  end if;
  if (
    select count(*) from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname in (
        'service role insert bill-receipts',
        'service role select bill-receipts',
        'service role delete bill-receipts'
      )
  ) <> 3 then
    raise exception 'FAIL: bill-receipts service policies';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.bill_scan_proposals'::regclass) then
    raise exception 'FAIL: bill scan RLS disabled';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'bill_scan_proposals'
  ) then
    raise exception 'FAIL: bill scan client policy exists';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bill_scan_proposals'
      and udt_name = 'bytea'
  ) then
    raise exception 'FAIL: image bytes column on bill_scan_proposals';
  end if;
  if has_table_privilege('anon', 'public.bill_scan_proposals', 'SELECT')
     or has_table_privilege('authenticated', 'public.bill_scan_proposals', 'SELECT')
     or has_table_privilege('authenticated', 'public.bill_scan_proposals', 'INSERT')
     or has_table_privilege('anon', 'public.bill_scan_proposals', 'UPDATE')
     or not has_table_privilege('service_role', 'public.bill_scan_proposals', 'SELECT')
     or not has_table_privilege('service_role', 'public.bill_scan_proposals', 'INSERT')
     or not has_table_privilege('service_role', 'public.bill_scan_proposals', 'UPDATE')
     or has_table_privilege('service_role', 'public.bill_scan_proposals', 'DELETE')
     or has_function_privilege('service_role', 'public.bill_scan_proposals_scope()', 'EXECUTE')
     or has_function_privilege('anon', 'public.bill_scan_proposals_scope()', 'EXECUTE') then
    raise exception 'FAIL: bill scan grants';
  end if;

  insert into auth.users (id) values (member), (other_member);
  insert into public.user_profiles (id, subscription_status, is_admin) values
    (member, 'active', false),
    (other_member, 'active', false);
  insert into public.restaurants (id, name, status) values
    (grill, 'E07 Receipt Grill', 'active'),
    (other, 'E07 Receipt Other', 'active');
  insert into public.offer_versions (
    id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
    capacity_timezone, capacity_window_kind, capacity_max_redemptions, boost_session_minutes
  ) values (
    version_id, grill, 'America/Chicago',
    '2026-09-01 05:00:00+00', '2026-12-01 06:00:00+00',
    '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    'America/Chicago', 'calendar_month', 20, null
  );
  insert into public.challenge_cycles (id, user_id, cycle_month, status) values
    (cycle_id, member, '2026-11-01', 'active');
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, offer_version_id, redemption_deadline
  ) values (
    item_id, cycle_id, grill, 1, 'assigned', version_id, '2026-12-01 00:00:00+00'
  );

  set local role service_role;
  opened := public.open_boost_arrival_session(
    grill, item_id, version_id, null, null, '2026-11-06 15:00:00+00', '2026-11-06 17:00:00+00',
    'receipt-key', token_hash, 'threshold:4000', 1000, null, 0, 1000, 8200, false, '["quoted"]'::jsonb
  );
  if opened ->> 'status' is distinct from 'created' then
    raise exception 'FAIL: open session for receipt was %', opened;
  end if;
  opened_id := (opened ->> 'session_id')::uuid;
  receipt_path := member::text || '/' || proposal_id::text;

  insert into public.bill_scan_proposals (
    id, user_id, restaurant_id, arrival_session_id, object_path, content_type,
    byte_size, width, height, source, proposal, created_at, retain_until
  ) values (
    proposal_id, member, grill, opened_id, receipt_path, 'image/jpeg',
    120, 64, 48, 'fixture', proposal_json, stored_at, keep_until
  );
  if (select p.object_path from public.bill_scan_proposals p where p.id = proposal_id) is distinct from receipt_path
     or (select p.confirmed_eligible_subtotal_cents from public.bill_scan_proposals p where p.id = proposal_id) is not null
     or (select p.retain_until - p.created_at from public.bill_scan_proposals p where p.id = proposal_id) <> interval '7 days'
     or (select p.proposal ? 'total_discount_cents' from public.bill_scan_proposals p where p.id = proposal_id) then
    raise exception 'FAIL: stored proposal shape';
  end if;

  begin
    insert into public.bill_scan_proposals (
      id, user_id, restaurant_id, arrival_session_id, object_path, content_type,
      byte_size, width, height, source, proposal, created_at, retain_until
    ) values (
      'e07b0000-0000-4000-8000-000000000062', other_member, grill, opened_id,
      other_member::text || '/e07b0000-0000-4000-8000-000000000062',
      'image/jpeg', 120, 64, 48, 'fixture', proposal_json, stored_at, keep_until
    );
    raise exception 'FAIL: other member stored a receipt';
  exception when check_violation then null; end;

  begin
    insert into public.bill_scan_proposals (
      id, user_id, restaurant_id, arrival_session_id, object_path, content_type,
      byte_size, width, height, source, proposal, created_at, retain_until
    ) values (
      'e07b0000-0000-4000-8000-000000000063', member, other, opened_id,
      member::text || '/e07b0000-0000-4000-8000-000000000063',
      'image/jpeg', 120, 64, 48, 'fixture', proposal_json, stored_at, keep_until
    );
    raise exception 'FAIL: wrong restaurant stored a receipt';
  exception when check_violation then null; end;

  begin
    insert into public.bill_scan_proposals (
      id, user_id, restaurant_id, arrival_session_id, object_path, content_type,
      byte_size, width, height, source, proposal, created_at, retain_until
    ) values (
      'e07b0000-0000-4000-8000-000000000064', member, grill, opened_id,
      'not-the-path', 'image/jpeg', 120, 64, 48, 'fixture', proposal_json, stored_at, keep_until
    );
    raise exception 'FAIL: free-form object path stored';
  exception when check_violation then null; end;

  reset role;
  update public.boost_arrival_sessions set status = 'closed' where id = opened_id;
  set local role service_role;

  update public.bill_scan_proposals
  set confirmed_eligible_subtotal_cents = 8100
  where id = proposal_id;
  if (select confirmed_eligible_subtotal_cents from public.bill_scan_proposals where id = proposal_id) <> 8100
     or (select p.proposal ->> 'proposed_eligible_subtotal_cents' from public.bill_scan_proposals p where p.id = proposal_id) <> '8200' then
    raise exception 'FAIL: staff confirm did not keep the proposal';
  end if;

  begin
    insert into public.bill_scan_proposals (
      id, user_id, restaurant_id, arrival_session_id, object_path, content_type,
      byte_size, width, height, source, proposal, created_at, retain_until
    ) values (
      'e07b0000-0000-4000-8000-000000000065', member, grill, opened_id,
      member::text || '/e07b0000-0000-4000-8000-000000000065',
      'image/jpeg', 120, 64, 48, 'fixture', proposal_json, stored_at, keep_until
    );
    raise exception 'FAIL: closed session stored a receipt';
  exception when check_violation then null; end;

  begin
    delete from public.bill_scan_proposals where id = proposal_id;
    raise exception 'FAIL: service_role deleted a proposal';
  exception when insufficient_privilege then null; end;

  reset role;
  set local role authenticated;
  begin
    insert into public.bill_scan_proposals (
      id, user_id, restaurant_id, arrival_session_id, object_path, content_type,
      byte_size, width, height, source, proposal, created_at, retain_until
    ) values (
      'e07b0000-0000-4000-8000-000000000066', member, grill, opened_id,
      member::text || '/e07b0000-0000-4000-8000-000000000066',
      'image/jpeg', 120, 64, 48, 'fixture', proposal_json, stored_at, keep_until
    );
    raise exception 'FAIL: authenticated insert';
  exception when insufficient_privilege then null; end;
  begin
    if exists (select 1 from public.bill_scan_proposals) then
      raise exception 'FAIL: authenticated select';
    end if;
  exception when insufficient_privilege then null; end;

  reset role;
  insert into storage.objects (bucket_id, name) values
    ('bill-receipts', member::text || '/' || proposal_id::text),
    ('restaurant-photos', 'public-photo');
  set local role authenticated;
  if exists (select 1 from storage.objects where bucket_id = 'bill-receipts') then
    raise exception 'FAIL: authenticated read bill-receipts';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'restaurant-photos') then
    raise exception 'FAIL: restaurant-photos public read changed';
  end if;
end $$;

rollback;

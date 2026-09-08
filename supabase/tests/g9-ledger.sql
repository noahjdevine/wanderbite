-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '15s';

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.stripe_events'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.webhook_outbox'::regclass)
  then
    raise exception 'FAIL: stripe ledger RLS disabled';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('stripe_events', 'webhook_outbox')
  ) then
    raise exception 'FAIL: stripe ledger client policy exists';
  end if;
  if exists (
    select 1
    from aclexplode(coalesce((
      select relacl from pg_class where oid = 'public.stripe_events'::regclass
    ), '{}'::aclitem[])) acl
    where acl.grantee = 0
       or acl.grantee in ('anon'::regrole, 'authenticated'::regrole)
  ) or exists (
    select 1
    from aclexplode(coalesce((
      select relacl from pg_class where oid = 'public.webhook_outbox'::regclass
    ), '{}'::aclitem[])) acl
    where acl.grantee = 0
       or acl.grantee in ('anon'::regrole, 'authenticated'::regrole)
  ) then
    raise exception 'FAIL: public, anon, or authenticated privileges remain on ledger tables';
  end if;
  if has_table_privilege('anon', 'public.stripe_events', 'SELECT')
    or has_table_privilege('authenticated', 'public.webhook_outbox', 'INSERT')
    or has_column_privilege('authenticated', 'public.user_profiles', 'stripe_subscription_id', 'UPDATE')
    or has_column_privilege('authenticated', 'public.user_profiles', 'stripe_subscription_id', 'INSERT')
  then
    raise exception 'FAIL: client privileges remain on ledger or stripe_subscription_id';
  end if;
  if not has_table_privilege('service_role', 'public.stripe_events', 'SELECT')
    or not has_table_privilege('service_role', 'public.stripe_events', 'INSERT')
    or not has_table_privilege('service_role', 'public.stripe_events', 'UPDATE')
    or has_table_privilege('service_role', 'public.stripe_events', 'DELETE')
    or not has_function_privilege('service_role', 'public.claim_stripe_event(text, uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.claim_stripe_event(text, uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.enqueue_webhook_outbox(text, text, text, jsonb)', 'EXECUTE')
  then
    raise exception 'FAIL: service_role/client execute or table grants are wrong';
  end if;
end $$;

insert into auth.users (id) values ('90000000-0000-4000-8000-000000000001');
insert into public.user_profiles (id, subscription_status)
  values ('90000000-0000-4000-8000-000000000001', 'inactive');

do $$ begin
  update public.user_profiles
    set subscription_status = 'trialing'
    where id = '90000000-0000-4000-8000-000000000001';
  update public.user_profiles
    set subscription_status = 'paused'
    where id = '90000000-0000-4000-8000-000000000001';
  update public.user_profiles
    set subscription_status = 'incomplete'
    where id = '90000000-0000-4000-8000-000000000001';

  begin
    update public.user_profiles
      set subscription_status = 'invalid-test-status'
      where id = '90000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: widened CHECK still accepts invalid status';
  exception when check_violation then null; end;
end $$;

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);
  begin
    perform event_id from public.stripe_events;
    raise exception 'FAIL: authenticated selected stripe_events';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.webhook_outbox (effect_key, effect_type, source_event_id)
      values ('x', 'subscription_started', 'evt');
    raise exception 'FAIL: authenticated inserted webhook_outbox';
  exception when insufficient_privilege then null; end;
  begin
    update public.user_profiles
      set stripe_subscription_id = 'sub_forged'
      where id = '90000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: member update of stripe_subscription_id was accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role service_role;

do $$
declare
  token_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  token_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  token_c uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  token_d uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  row public.stripe_events;
  inserted boolean;
  claimed boolean;
  completed boolean;
  failed boolean;
  err text;
begin
  row := public.insert_stripe_event(
    'evt_g9_1',
    'customer.subscription.updated',
    'sub_g9_1',
    true,
    '2026-01-01',
    now(),
    '{"id":"evt_g9_1"}'::jsonb
  );
  if row.status <> 'received' then
    raise exception 'FAIL: insert did not start received';
  end if;

  row := public.insert_stripe_event(
    'evt_g9_1',
    'customer.subscription.updated',
    'sub_g9_1',
    true,
    '2026-01-01',
    now(),
    '{"id":"evt_g9_1-dup"}'::jsonb
  );
  if row.payload->>'id' <> 'evt_g9_1' then
    raise exception 'FAIL: duplicate insert overwrote payload';
  end if;

  claimed := public.claim_stripe_event('evt_g9_1', token_a);
  if not claimed then
    raise exception 'FAIL: first event claim lost';
  end if;
  claimed := public.claim_stripe_event('evt_g9_1', token_b);
  if claimed then
    raise exception 'FAIL: fresh processing lock was stolen';
  end if;

  completed := public.complete_stripe_event('evt_g9_1', token_b);
  if completed then
    raise exception 'FAIL: stolen token completed the event';
  end if;
  completed := public.complete_stripe_event('evt_g9_1', token_a);
  if not completed then
    raise exception 'FAIL: owner token could not complete the event';
  end if;

  row := public.insert_stripe_event(
    'evt_g9_fail',
    'invoice.paid',
    'in_g9',
    true,
    '2026-01-01',
    now(),
    '{"id":"evt_g9_fail"}'::jsonb
  );
  perform public.claim_stripe_event('evt_g9_fail', token_a);
  failed := public.fail_stripe_event('evt_g9_fail', token_b, 'nope');
  if failed then
    raise exception 'FAIL: stolen token failed the event';
  end if;
  failed := public.fail_stripe_event(
    'evt_g9_fail',
    token_a,
    E'bad\u0001error ' || repeat('x', 600)
  );
  if not failed then
    raise exception 'FAIL: owner token could not fail the event';
  end if;
  select last_error into err from public.stripe_events where event_id = 'evt_g9_fail';
  if err is null or length(err) <> 500 or err like '%' || E'\u0001' || '%' then
    raise exception 'FAIL: last_error was not sanitized/truncated: %', err;
  end if;

  claimed := public.claim_stripe_event('evt_g9_fail', token_c);
  if not claimed then
    raise exception 'FAIL: failed event was not reclaimable';
  end if;
  perform public.complete_stripe_event('evt_g9_fail', token_c);

  row := public.insert_stripe_event(
    'evt_g9_stale',
    'invoice.paid',
    'in_g9_stale',
    true,
    '2026-01-01',
    now(),
    '{"id":"evt_g9_stale"}'::jsonb
  );
  perform public.claim_stripe_event('evt_g9_stale', token_a);
  update public.stripe_events
    set claimed_at = now() - interval '6 minutes'
    where event_id = 'evt_g9_stale';
  claimed := public.claim_stripe_event('evt_g9_stale', token_d);
  if not claimed then
    raise exception 'FAIL: stale processing event was not reclaimable';
  end if;
  completed := public.complete_stripe_event('evt_g9_stale', token_a);
  if completed then
    raise exception 'FAIL: stale worker finalized after lease was stolen';
  end if;
  perform public.complete_stripe_event('evt_g9_stale', token_d);

  perform public.insert_stripe_event(
    'evt_g9_a',
    'checkout.session.completed',
    'cs_a',
    true,
    '2026-01-01',
    now(),
    '{"id":"evt_g9_a"}'::jsonb
  );
  perform public.insert_stripe_event(
    'evt_g9_b',
    'invoice.paid',
    'in_b',
    true,
    '2026-01-01',
    now(),
    '{"id":"evt_g9_b"}'::jsonb
  );
  inserted := public.enqueue_webhook_outbox(
    'subscription-confirmation/sub_same',
    'subscription_confirmation_email',
    'evt_g9_a',
    '{"to":"a@example.com"}'::jsonb
  );
  if not inserted then
    raise exception 'FAIL: first outbox insert lost';
  end if;
  inserted := public.enqueue_webhook_outbox(
    'subscription-confirmation/sub_same',
    'subscription_confirmation_email',
    'evt_g9_b',
    '{"to":"b@example.com"}'::jsonb
  );
  if inserted then
    raise exception 'FAIL: duplicate effect_key inserted a second outbox row';
  end if;
  if (select count(*) from public.webhook_outbox where effect_key = 'subscription-confirmation/sub_same') <> 1 then
    raise exception 'FAIL: expected one outbox row for two event ids';
  end if;

  if (select count(*) from public.claim_webhook_outbox_batch(1, token_a)) <> 1 then
    raise exception 'FAIL: outbox batch claim missed pending row';
  end if;
  if (select count(*) from public.claim_webhook_outbox_batch(1, token_b)) <> 0 then
    raise exception 'FAIL: concurrent outbox claim stole a fresh lock';
  end if;
  completed := public.complete_webhook_outbox('subscription-confirmation/sub_same', token_b);
  if completed then
    raise exception 'FAIL: stolen outbox token marked sent';
  end if;
  completed := public.complete_webhook_outbox('subscription-confirmation/sub_same', token_a);
  if not completed then
    raise exception 'FAIL: owner outbox token could not mark sent';
  end if;

  perform public.enqueue_webhook_outbox(
    'subscription-started/sub_retry',
    'subscription_started',
    'evt_g9_a',
    '{}'::jsonb
  );
  perform public.claim_webhook_outbox_batch(1, token_a);
  perform public.fail_webhook_outbox('subscription-started/sub_retry', token_a, 'provider down');
  update public.webhook_outbox
    set available_at = now()
    where effect_key = 'subscription-started/sub_retry';
  if (select count(*) from public.claim_webhook_outbox_batch(1, token_c)) <> 1 then
    raise exception 'FAIL: failed outbox row was not reclaimable';
  end if;
  update public.webhook_outbox
    set status = 'processing',
        claimed_at = now() - interval '6 minutes',
        claim_token = token_c
    where effect_key = 'subscription-started/sub_retry';
  if (select count(*) from public.claim_webhook_outbox_batch(1, token_d)) <> 1 then
    raise exception 'FAIL: stale processing outbox row was not reclaimable';
  end if;
  completed := public.complete_webhook_outbox('subscription-started/sub_retry', token_c);
  if completed then
    raise exception 'FAIL: stale outbox worker finalized after lease was stolen';
  end if;
  perform public.complete_webhook_outbox('subscription-started/sub_retry', token_d);

  begin
    insert into public.webhook_outbox (effect_key, effect_type, source_event_id)
      values ('bad-type', 'not_an_effect', 'evt_g9_a');
    raise exception 'FAIL: invalid effect_type accepted';
  exception when check_violation then null; end;

  begin
    insert into public.stripe_events (
      event_id, event_type, livemode, stripe_created, payload, attempts
    ) values (
      'evt_neg', 'invoice.paid', true, now(), '{}'::jsonb, -1
    );
    raise exception 'FAIL: negative attempts accepted';
  exception when check_violation then null; end;
end $$;

reset role;

select 'PASS: G9 stripe ledger, outbox claim fencing, effect_key uniqueness, CHECK, grants; fixtures rolled back';
rollback;

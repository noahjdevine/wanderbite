-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '15s';

do $$
declare
  status_check text;
begin
  select conname into status_check
  from pg_constraint
  where conrelid = 'public.webhook_outbox'::regclass
    and contype = 'c'
    and conname = 'webhook_outbox_status_check';
  if status_check is distinct from 'webhook_outbox_status_check' then
    raise exception 'FAIL: webhook_outbox status check name is %', status_check;
  end if;
  if position('suppressed' in pg_get_constraintdef(
      (select oid from pg_constraint
        where conrelid = 'public.webhook_outbox'::regclass
          and conname = 'webhook_outbox_status_check')
    )) = 0
    or position('needs_reconciliation' in pg_get_constraintdef(
      (select oid from pg_constraint
        where conrelid = 'public.webhook_outbox'::regclass
          and conname = 'webhook_outbox_status_check')
    )) = 0
  then
    raise exception 'FAIL: new outbox statuses missing from webhook_outbox_status_check';
  end if;
  if position('suppressed' in pg_get_functiondef(
      'public.claim_webhook_outbox_batch(integer, uuid)'::regprocedure
    )) > 0
  then
    raise exception 'FAIL: claim_webhook_outbox_batch selects suppressed';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.email_suppressions'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.email_reminder_deliveries'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.email_topic_preferences'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.email_webhook_deliveries'::regclass)
  then
    raise exception 'FAIL: G15 RLS disabled';
  end if;

  if has_table_privilege('anon', 'public.email_suppressions', 'SELECT')
    or has_table_privilege('authenticated', 'public.email_suppressions', 'SELECT')
    or has_table_privilege('authenticated', 'public.email_reminder_deliveries', 'SELECT')
    or has_table_privilege('anon', 'public.email_webhook_deliveries', 'SELECT')
    or has_table_privilege('authenticated', 'public.email_topic_preferences', 'DELETE')
    or has_table_privilege('service_role', 'public.email_suppressions', 'UPDATE')
    or has_table_privilege('service_role', 'public.email_suppressions', 'DELETE')
    or has_table_privilege('service_role', 'public.email_webhook_deliveries', 'UPDATE')
    or not has_table_privilege('service_role', 'public.email_suppressions', 'INSERT')
    or not has_table_privilege('service_role', 'public.email_suppressions', 'SELECT')
    or not has_table_privilege('authenticated', 'public.email_topic_preferences', 'UPDATE')
    or not has_table_privilege('service_role', 'public.email_reminder_deliveries', 'UPDATE')
    or has_function_privilege('authenticated', 'public.claim_email_reminder_delivery(uuid, date, uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.apply_resend_webhook_suppression(text, text, text, text, text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.suppress_webhook_outbox(text, uuid)', 'EXECUTE')
  then
    raise exception 'FAIL: G15 grants';
  end if;
end $$;

insert into auth.users (id) values
  ('15000000-0000-4000-8000-000000000001'),
  ('15000000-0000-4000-8000-000000000002');
insert into public.user_profiles (id, email, subscription_status) values
  ('15000000-0000-4000-8000-000000000001', 'member@example.com', 'active'),
  ('15000000-0000-4000-8000-000000000002', 'other@example.com', 'active');

set local role service_role;

do $$
declare
  user_a uuid := '15000000-0000-4000-8000-000000000001';
  token_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  token_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  token_c uuid := 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  n integer;
  ok boolean;
  prev text;
  applied text;
  inserted boolean;
begin
  perform public.ensure_email_reminder_delivery(user_a, '2026-09-01');
  select count(*) into n from public.claim_email_reminder_delivery(user_a, '2026-09-01', token_a);
  if n <> 1 then raise exception 'FAIL: first reminder claim missed'; end if;
  select count(*) into n from public.claim_email_reminder_delivery(user_a, '2026-09-01', token_b);
  if n <> 0 then raise exception 'FAIL: overlapping reminder claim won'; end if;
  ok := public.complete_email_reminder_delivery(user_a, '2026-09-01', token_b, 'msg_lost');
  if ok then raise exception 'FAIL: lost claim token completed the reminder'; end if;
  if (select status from public.email_reminder_deliveries
      where user_id = user_a and cycle_month = '2026-09-01') <> 'processing' then
    raise exception 'FAIL: lost token changed reminder status';
  end if;

  update public.email_reminder_deliveries
    set claim_expires_at = now() - interval '1 second'
    where user_id = user_a and cycle_month = '2026-09-01';
  ok := public.complete_email_reminder_delivery(user_a, '2026-09-01', token_a, 'msg_late');
  if ok then raise exception 'FAIL: expired claim token completed the reminder'; end if;
  select previous_status into prev
    from public.claim_email_reminder_delivery(user_a, '2026-09-01', token_c);
  if prev is distinct from 'processing' then
    raise exception 'FAIL: expired processing row was not reclaimable';
  end if;
  ok := public.reconcile_email_reminder_delivery(user_a, '2026-09-01', token_a, 'stale');
  if ok then raise exception 'FAIL: old token reconciled after reclaim'; end if;
  ok := public.reconcile_email_reminder_delivery(user_a, '2026-09-01', token_c, 'uncertain_send');
  if not ok then raise exception 'FAIL: current token could not reconcile'; end if;
  select count(*) into n from public.claim_email_reminder_delivery(user_a, '2026-09-01', token_b);
  if n <> 0 then raise exception 'FAIL: reconciliation row was claimed again'; end if;

  perform public.ensure_email_reminder_delivery(user_a, '2026-10-01');
  select count(*) into n from public.claim_email_reminder_delivery(user_a, '2026-10-01', token_a);
  if n <> 1 then raise exception 'FAIL: second cycle claim missed'; end if;
  ok := public.release_email_reminder_delivery(user_a, '2026-10-01', token_a, 'EMAIL_UNSUBSCRIBE_SECRET not configured');
  if not ok then raise exception 'FAIL: release did not clear the claim'; end if;
  if (select claim_token from public.email_reminder_deliveries
      where user_id = user_a and cycle_month = '2026-10-01') is not null
    or (select status from public.email_reminder_deliveries
      where user_id = user_a and cycle_month = '2026-10-01') <> 'pending'
  then
    raise exception 'FAIL: released reminder is not claimable';
  end if;
  select count(*) into n from public.claim_email_reminder_delivery(user_a, '2026-10-01', token_b);
  if n <> 1 then raise exception 'FAIL: released reminder could not be claimed again'; end if;
  ok := public.skip_email_reminder_delivery(user_a, '2026-10-01', token_b, 'skipped_opt_out');
  if not ok then raise exception 'FAIL: opt-out skip was rejected'; end if;
  select count(*) into n from public.claim_email_reminder_delivery(user_a, '2026-10-01', token_a);
  if n <> 0 then raise exception 'FAIL: terminal opt-out was claimed'; end if;

  perform public.insert_stripe_event(
    'evt_g15_1', 'customer.subscription.updated', 'sub_g15', true, '2026-01-01', now(), '{}'::jsonb
  );
  inserted := public.enqueue_webhook_outbox(
    'subscription-confirmation/sub_g15',
    'subscription_confirmation_email',
    'evt_g15_1',
    '{"to":"member@example.com"}'::jsonb
  );
  if not inserted then raise exception 'FAIL: confirmation enqueue missed'; end if;
  inserted := public.enqueue_webhook_outbox(
    'subscription-confirmation/sub_g15',
    'subscription_confirmation_email',
    'evt_g15_1',
    '{"to":"other@example.com"}'::jsonb
  );
  if inserted then raise exception 'FAIL: confirmation effect key was not deduped'; end if;

  update public.webhook_outbox
    set status = 'suppressed'
    where effect_key = 'subscription-confirmation/sub_g15';
  select count(*) into n
    from public.claim_webhook_outbox_batch(10, token_a)
    where effect_key = 'subscription-confirmation/sub_g15';
  if n <> 0 then raise exception 'FAIL: suppressed outbox row was claimed'; end if;

  update public.webhook_outbox
    set status = 'pending', claim_token = null
    where effect_key = 'subscription-confirmation/sub_g15';
  select count(*) into n
    from public.claim_webhook_outbox_batch(10, token_a)
    where effect_key = 'subscription-confirmation/sub_g15';
  if n <> 1 then raise exception 'FAIL: pending confirmation was not claimed'; end if;
  ok := public.suppress_webhook_outbox('subscription-confirmation/sub_g15', token_b);
  if ok then raise exception 'FAIL: wrong token suppressed the confirmation'; end if;
  ok := public.suppress_webhook_outbox('subscription-confirmation/sub_g15', token_a);
  if not ok then raise exception 'FAIL: matching token did not suppress'; end if;
  if (select status from public.webhook_outbox
      where effect_key = 'subscription-confirmation/sub_g15') <> 'suppressed' then
    raise exception 'FAIL: confirmation did not become suppressed';
  end if;

  perform public.insert_stripe_event(
    'evt_g15_2', 'customer.subscription.updated', 'sub_g15b', true, '2026-01-01', now(), '{}'::jsonb
  );
  perform public.enqueue_webhook_outbox(
    'subscription-confirmation/sub_g15b',
    'subscription_confirmation_email',
    'evt_g15_2',
    '{}'::jsonb
  );
  perform public.claim_webhook_outbox_batch(10, token_b);
  ok := public.reconcile_webhook_outbox('subscription-confirmation/sub_g15b', token_a, 'expired');
  if ok then raise exception 'FAIL: wrong token reconciled the confirmation'; end if;
  ok := public.reconcile_webhook_outbox('subscription-confirmation/sub_g15b', token_b, 'idempotency_key_expired');
  if not ok then raise exception 'FAIL: matching token did not reconcile'; end if;
  select count(*) into n
    from public.claim_webhook_outbox_batch(10, token_c)
    where effect_key = 'subscription-confirmation/sub_g15b';
  if n <> 0 then raise exception 'FAIL: reconciled confirmation was claimed'; end if;

  applied := public.apply_resend_webhook_suppression(
    'delivery-1', 'email.bounced', 'em_1', 'member@example.com', 'permanent_bounce'
  );
  if applied <> 'applied' then raise exception 'FAIL: first suppression was not applied'; end if;
  applied := public.apply_resend_webhook_suppression(
    'delivery-1', 'email.bounced', 'em_1', 'member@example.com', 'permanent_bounce'
  );
  if applied <> 'duplicate' then raise exception 'FAIL: duplicate delivery was inserted again'; end if;
  if (select count(*) from public.email_suppressions) <> 1
    or (select count(*) from public.email_webhook_deliveries) <> 1
  then
    raise exception 'FAIL: duplicate delivery created another suppression';
  end if;
  applied := public.apply_resend_webhook_suppression(
    'delivery-2', 'email.complained', 'em_1', 'member@example.com', 'complaint'
  );
  if applied <> 'applied' then raise exception 'FAIL: second delivery was rejected'; end if;
  if (select count(*) from public.email_suppressions) <> 1
    or (select count(*) from public.email_webhook_deliveries) <> 2
  then
    raise exception 'FAIL: same address inserted a second suppression';
  end if;

  begin
    perform public.apply_resend_webhook_suppression(
      'delivery-bad', 'email.complained', 'em_bad', 'not-an-email', 'complaint'
    );
    raise exception 'FAIL: invalid address was stored';
  exception when check_violation then null;
  end;
  if exists (select 1 from public.email_webhook_deliveries where delivery_id = 'delivery-bad')
    or exists (select 1 from public.email_suppressions where normalized_address = 'not-an-email')
  then
    raise exception 'FAIL: failed suppression insert left a row';
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '15000000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $$
declare
  changed integer;
begin
  insert into public.email_topic_preferences (user_id, topic, opted_out)
    values (auth.uid(), 'adventure_reminders', true);
  update public.email_topic_preferences
    set opted_out = false
    where user_id = auth.uid() and topic = 'adventure_reminders';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'FAIL: owner could not update their topic row'; end if;

  update public.email_topic_preferences
    set opted_out = true
    where user_id = '15000000-0000-4000-8000-000000000002';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: member updated another topic row'; end if;

  begin
    delete from public.email_topic_preferences where user_id = auth.uid();
    raise exception 'FAIL: member deleted a topic row';
  exception when insufficient_privilege then null; end;

  begin
    perform 1 from public.email_reminder_deliveries;
    raise exception 'FAIL: member read reminder payloads';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.email_suppressions;
    raise exception 'FAIL: member read suppressions';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.email_suppressions (normalized_address, event_type, reason)
      values ('member@example.com', 'email.complained', 'forged');
    raise exception 'FAIL: member inserted a suppression';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.email_topic_preferences (user_id, topic, opted_out)
      values ('15000000-0000-4000-8000-000000000002', 'adventure_reminders', true);
    raise exception 'FAIL: member inserted another user topic row';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$ begin
  begin
    perform 1 from public.email_topic_preferences;
    raise exception 'FAIL: anon read topic preferences';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.email_suppressions;
    raise exception 'FAIL: anon read suppressions';
  exception when insufficient_privilege then null; end;
end $$;

rollback;
select 'PASS: G15 reminder claims, outbox suppression states, webhook dedup, topic RLS; fixtures rolled back';

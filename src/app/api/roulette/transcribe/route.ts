import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase/server';
import { allowBillableRoulette } from '@/lib/ratelimit';
import { isWanderbiteAiDisabled } from '@/lib/ai-kill-switch';
import { trustedClientIpFromHeaders } from '@/lib/client-ip';
import {
  AI_GUEST_COOKIE_NAME,
  guestCookieSetOptions,
  hasGuestSigningSecret,
  mintGuestCookieValue,
  parseGuestCookieValue,
} from '@/lib/ai-guest';
import { hashClientIp, hasIpHashSecret } from '@/lib/ai-ip-hash';
import { parseIdempotencyUuid, transcriptionIdempotencyKey } from '@/lib/ai-idempotency';
import { classifyRouletteAccounting } from '@/lib/ai-budget/accounting';
import {
  rpcAiCurrentVersions,
  rpcAiDispatch,
  rpcAiFailBeforeDispatch,
  rpcAiLoadResultPayload,
  rpcAiMarkAssumedSpent,
  rpcAiOpsHeadroom,
  rpcAiQuoteMaxCost,
  rpcAiReconcile,
  rpcAiRecoverStaleRequests,
  rpcAiReleaseCustomerAllowance,
  rpcAiReserve,
  rpcAiSettle,
  rpcAiStoreResultPayload,
} from '@/lib/ai-budget/rpcs';
import {
  DISCOVERY_ALLERGY_ERROR,
  DISCOVERY_PROFILE_ERROR,
  gateSignedInProfile,
} from '@/lib/discovery-turn';
import {
  buildStoredTranscriptPayload,
  globalHeadroomRemaining,
  inspectVoiceUpload,
  OPENAI_TRANSCRIBE_MODEL,
  OPENAI_TRANSCRIBE_PROVIDER,
  OPENAI_TRANSCRIBE_URL,
  readStoredTranscript,
  transcriptionFromProvider,
  transcriptionProviderAllowed,
  transcriptionReserveUnits,
  transcriptionSettleUnits,
  TRANSCRIPTION_TIMEOUT_MS,
  VOICE_BUDGET_ERROR,
  VOICE_MAX_BYTES,
  VOICE_UNAVAILABLE_ERROR,
  VOICE_UNREADABLE_ERROR,
  voiceUploadFilename,
} from '@/lib/voice/transcription';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TRANSCRIBE_MAX_BODY_BYTES = VOICE_MAX_BYTES + 16_384;

type DiscoveryProfileRow = {
  subscription_status: string | null;
  dietary_flags: string[] | null;
  allergy_flags: string[] | null;
};

function withGuestCookie(response: NextResponse, cookieValue: string | null): NextResponse {
  if (cookieValue) {
    response.cookies.set(AI_GUEST_COOKIE_NAME, cookieValue, guestCookieSetOptions());
  }
  return response;
}

function fallback(error: string, status: number, cookie: string | null): NextResponse {
  return withGuestCookie(
    NextResponse.json({ error, fallback: 'type' }, { status }),
    cookie,
  );
}

async function accountTranscription(args: {
  requestId: string;
  dispatched: boolean;
  transcript: string | null;
  usage: Record<string, number> | null;
}): Promise<void> {
  const action = classifyRouletteAccounting({
    dispatched: args.dispatched,
    pickValid: args.transcript !== null,
    usage: args.usage,
  });
  if (action === 'fail_before_dispatch') {
    await rpcAiFailBeforeDispatch(args.requestId);
    return;
  }
  if (action === 'assumed_spent_release') {
    await rpcAiMarkAssumedSpent(args.requestId);
    await rpcAiReleaseCustomerAllowance(args.requestId);
    return;
  }
  if (action === 'assumed_spent_reconcile') {
    await rpcAiMarkAssumedSpent(args.requestId);
    if (args.usage) await rpcAiReconcile(args.requestId, args.usage);
    return;
  }
  try {
    await rpcAiSettle(args.requestId, args.usage ?? {});
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.toLowerCase().includes('exceeds')) {
      console.error('[transcribe] actual exceeds quote', { requestId: args.requestId });
      await rpcAiMarkAssumedSpent(args.requestId);
      await rpcAiReleaseCustomerAllowance(args.requestId);
      return;
    }
    throw err;
  }
}

export async function POST(request: NextRequest) {
  let guestCookieToSet: string | null = null;
  try {
    const declared = Number(request.headers.get('content-length'));
    if (!Number.isFinite(declared) || declared <= 0 || declared > TRANSCRIBE_MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Request too large.', fallback: 'type' }, { status: 413 });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: VOICE_UNREADABLE_ERROR, fallback: 'type' }, { status: 400 });
    }

    const audio = form.get('audio');
    if (!(audio instanceof File)) {
      return NextResponse.json({ error: VOICE_UNREADABLE_ERROR, fallback: 'type' }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let accountTier: 'paid' | 'free' | 'guest' = 'guest';
    let featureClass: 'optional' | 'guest' = 'guest';
    let userId: string | null = null;
    let guestId: string | null = null;
    let subjectKey: string;

    if (user) {
      userId = user.id;
      featureClass = 'optional';
      subjectKey = `user:${user.id}`;
      const admin = getSupabaseAdmin();
      const { data: profileRow, error: profileError } = await admin
        .from('user_profiles')
        .select('subscription_status, dietary_flags, allergy_flags')
        .eq('id', user.id)
        .maybeSingle();
      const profileGate = gateSignedInProfile({
        profileError: Boolean(profileError),
        profile: profileRow as DiscoveryProfileRow | null,
        preferencesError: false,
        excludedCuisines: [],
      });
      if (!profileGate.ok && profileGate.reason === 'allergy') {
        return NextResponse.json({ error: DISCOVERY_ALLERGY_ERROR }, { status: 422 });
      }
      if (!profileGate.ok) {
        if (profileError) console.error('[transcribe] profile', profileError.message);
        return NextResponse.json({ error: DISCOVERY_PROFILE_ERROR, fallback: 'type' }, { status: 503 });
      }
      accountTier = profileGate.accountTier;
    } else {
      const existing = parseGuestCookieValue(request.cookies.get(AI_GUEST_COOKIE_NAME)?.value);
      if (existing) {
        guestId = existing;
      } else if (hasGuestSigningSecret()) {
        const minted = mintGuestCookieValue();
        guestCookieToSet = minted;
        guestId = minted ? parseGuestCookieValue(minted) : null;
      }
      subjectKey = guestId ? `guest:${guestId}` : 'guest:anon';
    }

    if (audio.size > VOICE_MAX_BYTES) {
      return fallback('That recording is too large. Type your request instead.', 413, guestCookieToSet);
    }

    const durationRaw = form.get('durationMs');
    const declaredDurationMs =
      typeof durationRaw === 'string' && durationRaw.trim() ? Number(durationRaw) : null;
    const bytes = new Uint8Array(await audio.arrayBuffer());
    const inspection = inspectVoiceUpload({
      bytes,
      mime: audio.type,
      declaredDurationMs,
    });
    if (!inspection.ok) {
      return fallback(inspection.error, inspection.status, guestCookieToSet);
    }

    const clientIp = trustedClientIpFromHeaders(request.headers);
    const ipHash = clientIp ? hashClientIp(clientIp) : null;
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const prerequisites =
      !isWanderbiteAiDisabled() &&
      Boolean(apiKey) &&
      hasGuestSigningSecret() &&
      hasIpHashSecret() &&
      Boolean(ipHash) &&
      (userId !== null || guestId !== null);

    if (!prerequisites || !ipHash || !apiKey) {
      return fallback(VOICE_UNAVAILABLE_ERROR, 503, guestCookieToSet);
    }

    const redisOk = await allowBillableRoulette(subjectKey, ipHash);
    if (!redisOk) {
      return fallback(VOICE_UNAVAILABLE_ERROR, 503, guestCookieToSet);
    }

    try {
      await rpcAiRecoverStaleRequests();
    } catch {
      // Recovery is best-effort and must not start a provider call by itself.
    }

    const usageUnits = transcriptionReserveUnits();
    const versions = await rpcAiCurrentVersions();
    const quoteMicrodollars = await rpcAiQuoteMaxCost({
      modelId: OPENAI_TRANSCRIBE_MODEL,
      priceVersionId: versions.price_version_id,
      provider: OPENAI_TRANSCRIBE_PROVIDER,
      usageUnits,
    });
    const headroom = await rpcAiOpsHeadroom();
    const headroomRemaining = globalHeadroomRemaining(headroom);
    const precheck = transcriptionProviderAllowed({
      aiDisabled: false,
      redisOk: true,
      headroomRemaining,
      quoteMicrodollars,
      reserveAcquired: true,
    });
    if (!precheck.call) {
      return fallback(precheck.error, 503, guestCookieToSet);
    }

    const clientUuid =
      parseIdempotencyUuid(request.headers.get('idempotency-key')) ?? randomUUID();
    const reserved = await rpcAiReserve({
      accountTier,
      configVersionId: versions.config_version_id,
      featureClass,
      guestId,
      idempotencyKey: transcriptionIdempotencyKey(subjectKey, clientUuid),
      modelId: OPENAI_TRANSCRIBE_MODEL,
      priceVersionId: versions.price_version_id,
      provider: OPENAI_TRANSCRIBE_PROVIDER,
      usageUnits,
      userId,
    });

    const replayTranscript = async (): Promise<string | null> => {
      const loaded = await rpcAiLoadResultPayload(reserved.request_id);
      return readStoredTranscript(loaded?.result_payload);
    };

    if (!reserved.acquired) {
      const existingText = await replayTranscript();
      if (existingText) {
        return withGuestCookie(NextResponse.json({ transcript: existingText }), guestCookieToSet);
      }
      const deny = reserved.deny_reason ?? '';
      const budgetDenied =
        deny === 'insufficient_budget' ||
        deny === 'guest_turns_exhausted' ||
        deny === 'paid_core_reserve' ||
        deny === 'zero_quote';
      return fallback(budgetDenied ? VOICE_BUDGET_ERROR : VOICE_UNAVAILABLE_ERROR, 503, guestCookieToSet);
    }

    const dispatched = await rpcAiDispatch(reserved.request_id);
    if (!dispatched.acquired) {
      const existingText = await replayTranscript();
      if (existingText) {
        return withGuestCookie(NextResponse.json({ transcript: existingText }), guestCookieToSet);
      }
      return fallback(VOICE_UNAVAILABLE_ERROR, 503, guestCookieToSet);
    }

    let timedOut = false;
    let httpOk = false;
    let providerBody = '';
    const controller = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TRANSCRIPTION_TIMEOUT_MS);
    try {
      const formData = new FormData();
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const mime = inspection.container === 'mp4' ? 'audio/mp4' : 'audio/webm';
      formData.append('file', new Blob([copy], { type: mime }), voiceUploadFilename(inspection.container));
      formData.append('model', OPENAI_TRANSCRIBE_MODEL);
      const providerRes = await fetch(OPENAI_TRANSCRIBE_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: formData,
        signal: controller.signal,
      });
      providerBody = await providerRes.text();
      httpOk = providerRes.ok;
      if (!providerRes.ok) {
        console.error('[transcribe] provider', providerRes.status);
      }
    } catch (err) {
      if (timedOut || (err instanceof Error && err.name === 'AbortError')) {
        timedOut = true;
      } else {
        console.error('[transcribe] provider failed');
      }
      httpOk = false;
      providerBody = '';
    } finally {
      clearTimeout(timer);
    }

    const outcome = transcriptionFromProvider({
      timedOut,
      httpOk,
      body: providerBody,
    });
    const usage = outcome.transcript ? transcriptionSettleUnits(inspection.durationMs) : null;
    await accountTranscription({
      requestId: reserved.request_id,
      dispatched: true,
      transcript: outcome.transcript,
      usage,
    });

    if (!outcome.transcript) {
      return fallback(outcome.error ?? VOICE_UNAVAILABLE_ERROR, 503, guestCookieToSet);
    }

    try {
      await rpcAiStoreResultPayload(reserved.request_id, buildStoredTranscriptPayload(outcome.transcript));
    } catch {
      // The caller still receives the transcript. Audio was not stored.
    }

    return withGuestCookie(
      NextResponse.json({ transcript: outcome.transcript }),
      guestCookieToSet,
    );
  } catch (err) {
    console.error('[transcribe] unhandled');
    if (err instanceof Error && process.env.NODE_ENV !== 'production') {
      console.error('[transcribe] detail', err.name);
    }
    return fallback(VOICE_UNAVAILABLE_ERROR, 503, guestCookieToSet);
  }
}

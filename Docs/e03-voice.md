# E03 voice — provider spike

Checked 2026-11-03 against current official docs and this repo's `package.json` (`next` 16.4.3, no `openai` package, no `ai` package, no `@anthropic-ai/sdk`). Discovery text already calls Anthropic with `fetch`. Voice does the same. No package was added.

## What was checked

- [Claude Haiku 4.5](https://platform.claude.com/docs/en/models/haiku-4-5/overview): model id `claude-haiku-4-5-20251001` is text and image input only. It is the model already priced in `ai_price_rates`. It cannot transcribe a recording.
- [Messages API](https://platform.claude.com/docs/en/api/http/messages): documents text and image content. No audio content block for this snapshot.
- [Speech to text](https://developers.openai.com/api/docs/guides/speech-to-text): file transcription is `POST https://api.openai.com/v1/audio/transcriptions`. The guide says to start with `gpt-transcribe`. `whisper-1`, `gpt-4o-transcribe`, and `gpt-4o-mini-transcribe` are deprecated. Supported file types include `mp4`, `m4a`, and `webm`. The limit there is 25 MB. This app caps uploads at 1,920,000 bytes (64 KB/s for 30 seconds) and 30 seconds.
- [GPT-Transcribe model](https://developers.openai.com/api/docs/models/gpt-transcribe): model id `gpt-transcribe`. The only snapshot listed is `gpt-transcribe`. Transcription endpoint is supported. Price is **$0.0045 per minute**.
- [Pricing](https://developers.openai.com/api/docs/pricing): the same **$0.0045 / minute** for `gpt-transcribe`. Input and output token cells are blank, so the registry uses audio duration, not tokens.

## Choice

Use **OpenAI `gpt-transcribe`** through `fetch` and `FormData`. Browser `SpeechRecognition` is not used. The response field read is `text`.

$0.0045 per minute is 75 microdollars per second. The new price version stores `audio_seconds` at **75,000,000 microdollars per million seconds**. A 30 second reservation is 2,250 microdollars ($0.00225). `ai_current_versions()` returns the newest price version, so the migration copies the existing Haiku rates into that version. Published rows are not updated.

`guest_voice_seconds_limit` is 30 in the seeded config and is not charged by `ai_reserve`. The adapter enforces 30 seconds on every clip. Dollar ceilings, the guest turn counter, Redis limits, `WANDERBITE_AI_DISABLED`, and `ai_ops_headroom` still apply. A denied reserve or an empty global headroom does not call OpenAI.

Raw audio is not written to storage, the ledger payload, or logs. A successful transcript may be stored on the existing `ai_requests.result_payload` so the same idempotency key can replay without a second provider call. Read-aloud is not in this change.

Chrome 148 MediaRecorder (`start` with a 1 second timeslice) writes webm with no Duration element, and `audio/mp4` as a fragmented file whose `mvhd` duration is 0. Those clips are accepted. Cluster timecodes and `moof`/`trun` sample durations still reject a clip that runs past 30 seconds. The client `durationMs` field is wall-clock milliseconds (`Date.now()` minus record start), not seconds, and it is not a bill: a successful transcription always settles the reserved 30 `audio_seconds`, which `ai_settle` allows because it is equal to the quote. A file larger than 64,000 bytes per claimed second, or larger than 1,920,000 bytes overall, is rejected as too large before the provider is called. That ceiling covers iOS Safari's default 192 kbps AAC plus fragmented-mp4 overhead. A 20,000 byte ceiling rejected those 3–6 second iPhone clips as longer than 30 seconds. Duration past 30 seconds is still a length error. `ai_quote_max_cost` and `ai_settle` did not need a migration change.

## Env

`OPENAI_API_KEY` (server only).

The price row is not live until the migration is applied. Until then the route fails closed to typed input.

```text
npx supabase db push --linked --yes
```

Do not run `npm run types:db` for this migration. It adds no columns.

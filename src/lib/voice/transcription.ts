/**
 * Push-to-talk limits and the OpenAI file-transcription adapter.
 * Billing uses ai_quote_max_cost. These checks run before any provider call.
 * Raw audio is not stored.
 */

export const VOICE_MAX_BYTES = 1_500_000;
/** Matches seeded guest_voice_seconds_limit. One clip, guests and signed-in users. */
export const VOICE_MAX_DURATION_MS = 30_000;
/** Client stops early so container timestamps stay inside the server cap. */
export const VOICE_CLIENT_STOP_MS = 29_500;
export const VOICE_MAX_TRANSCRIPT_CHARS = 2_000;

export const OPENAI_TRANSCRIBE_PROVIDER = 'openai';
/** Official file-transcription model. Not an alias and not a deprecated id. */
export const OPENAI_TRANSCRIBE_MODEL = 'gpt-transcribe';
export const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
export const TRANSCRIPTION_USAGE_KIND = 'audio_seconds';
export const TRANSCRIPTION_RESERVE_SECONDS = 30;
export const TRANSCRIPTION_TIMEOUT_MS = 12_000;

export const VOICE_TOO_LARGE_ERROR =
  'That recording is too large. Type your request instead.';
export const VOICE_TOO_LONG_ERROR =
  'That recording is longer than 30 seconds. Type your request instead.';
export const VOICE_UNSUPPORTED_ERROR =
  'That recording format is not supported. Type your request instead.';
export const VOICE_UNREADABLE_ERROR =
  'That recording could not be read. Type your request instead.';
export const VOICE_BUDGET_ERROR =
  'Voice is paused because the discovery allowance is used up. Type your request instead.';
export const VOICE_TIMEOUT_ERROR =
  'Transcription took too long. Type your request instead.';
export const VOICE_UNAVAILABLE_ERROR =
  'Voice transcription is unavailable right now. Type your request instead.';
export const VOICE_PERMISSION_MESSAGE =
  'Microphone access was denied. Type your request instead.';
export const VOICE_BROWSER_MESSAGE =
  'Voice input is not available in this browser. Type your request instead.';

const WEBM_MIME = /^audio\/webm\b/i;
const MP4_MIME = /^audio\/(?:mp4|m4a|aac)\b/i;
const SEGMENT_ID = 0x18538067;
const INFO_ID = 0x1549a966;
const TIMECODE_SCALE_ID = 0x2ad7b1;
const DURATION_ID = 0x4489;

export type VoiceContainer = 'webm' | 'mp4';

export type VoiceInspection =
  | { ok: true; container: VoiceContainer; durationMs: number; settleSeconds: number }
  | { ok: false; status: 400 | 413; error: string };

type EbmlElement = { id: number; start: number; end: number };

function mimeBase(mime: string): string {
  return mime.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

export function voiceContainerFromMime(mime: string): VoiceContainer | null {
  const base = mimeBase(mime);
  if (!base) return null;
  if (WEBM_MIME.test(base)) return 'webm';
  if (MP4_MIME.test(base)) return 'mp4';
  return null;
}

export function voiceContainerFromMagic(bytes: Uint8Array): VoiceContainer | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return 'webm';
  }
  if (bytes.length >= 8) {
    const brand = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
    if (brand === 'ftyp') return 'mp4';
  }
  return null;
}

function readU32(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function readU64(bytes: Uint8Array, offset: number): number | null {
  const high = readU32(bytes, offset);
  const low = readU32(bytes, offset + 4);
  if (high === null || low === null) return null;
  const value = high * 2 ** 32 + low;
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

function mp4DurationMs(bytes: Uint8Array): number | null {
  const readBoxes = (start: number, end: number, intoMoov: boolean): number | null => {
    let offset = start;
    while (offset + 8 <= end) {
      const size32 = readU32(bytes, offset);
      if (size32 === null || (size32 !== 0 && size32 !== 1 && size32 < 8)) return null;
      const type = String.fromCharCode(
        bytes[offset + 4]!,
        bytes[offset + 5]!,
        bytes[offset + 6]!,
        bytes[offset + 7]!,
      );
      let header = 8;
      let size = size32;
      if (size32 === 1) {
        const large = readU64(bytes, offset + 8);
        if (large === null || large < 16) return null;
        size = large;
        header = 16;
      }
      const boxEnd = size32 === 0 ? end : offset + size;
      if (boxEnd < offset + header || boxEnd > end) return null;
      const payload = offset + header;
      if (type === 'mvhd') {
        const version = bytes[payload];
        if (version === 0) {
          const timescale = readU32(bytes, payload + 12);
          const duration = readU32(bytes, payload + 16);
          if (!timescale || duration === null) return null;
          return Math.round((duration / timescale) * 1000);
        }
        if (version === 1) {
          const timescale = readU32(bytes, payload + 20);
          const duration = readU64(bytes, payload + 24);
          if (!timescale || duration === null) return null;
          return Math.round((duration / timescale) * 1000);
        }
        return null;
      }
      if (type === 'moov' || (intoMoov && (type === 'trak' || type === 'mdia' || type === 'minf'))) {
        const nested = readBoxes(payload, boxEnd, true);
        if (nested !== null) return nested;
      }
      offset = boxEnd;
    }
    return null;
  };
  return readBoxes(0, bytes.length, false);
}

function vintWidth(first: number): number | null {
  if (first === 0) return null;
  let width = 1;
  let mask = 0x80;
  while (width <= 8 && (first & mask) === 0) {
    width += 1;
    mask >>= 1;
  }
  return width <= 8 ? width : null;
}

function readVint(
  bytes: Uint8Array,
  offset: number,
  keepMarker: boolean,
): { length: number; value: number; unknown: boolean } | null {
  if (offset >= bytes.length) return null;
  const first = bytes[offset]!;
  const width = vintWidth(first);
  if (!width || offset + width > bytes.length) return null;
  let marker = 0x80;
  for (let i = 1; i < width; i += 1) marker >>= 1;
  let value = keepMarker ? first : first & (marker - 1);
  let unknown = !keepMarker && (first & (marker - 1)) === marker - 1;
  for (let i = 1; i < width; i += 1) {
    const byte = bytes[offset + i]!;
    value = value * 256 + byte;
    if (!keepMarker && byte !== 0xff) unknown = false;
  }
  if (!Number.isSafeInteger(value)) return null;
  return { length: width, value, unknown };
}

function readElements(bytes: Uint8Array, start: number, end: number): EbmlElement[] {
  const out: EbmlElement[] = [];
  let offset = start;
  while (offset + 2 <= end) {
    const id = readVint(bytes, offset, true);
    if (!id) break;
    const size = readVint(bytes, offset + id.length, false);
    if (!size) break;
    const dataStart = offset + id.length + size.length;
    const dataEnd = size.unknown ? end : dataStart + size.value;
    if (dataEnd < dataStart || dataEnd > end) break;
    out.push({ id: id.value, start: dataStart, end: dataEnd });
    if (size.unknown) break;
    offset = dataEnd;
  }
  return out;
}

function readUnsigned(bytes: Uint8Array, start: number, end: number): number | null {
  const length = end - start;
  if (length <= 0 || length > 6) return null;
  let value = 0;
  for (let i = start; i < end; i += 1) value = value * 256 + bytes[i]!;
  return value;
}

function readFloat(bytes: Uint8Array, start: number, end: number): number | null {
  const length = end - start;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (length === 4) return view.getFloat32(start);
  if (length === 8) return view.getFloat64(start);
  return null;
}

function webmDurationMs(bytes: Uint8Array): number | null {
  const segment = readElements(bytes, 0, bytes.length).find((el) => el.id === SEGMENT_ID);
  if (!segment) return null;
  const info = readElements(bytes, segment.start, segment.end).find((el) => el.id === INFO_ID);
  if (!info) return null;
  let scale = 1_000_000;
  let duration: number | null = null;
  for (const child of readElements(bytes, info.start, info.end)) {
    if (child.id === TIMECODE_SCALE_ID) {
      const next = readUnsigned(bytes, child.start, child.end);
      if (next) scale = next;
    } else if (child.id === DURATION_ID) {
      duration = readFloat(bytes, child.start, child.end);
    }
  }
  if (duration === null || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.round((duration * scale) / 1_000_000);
}

export function readVoiceDurationMs(bytes: Uint8Array, container: VoiceContainer): number | null {
  return container === 'webm' ? webmDurationMs(bytes) : mp4DurationMs(bytes);
}

export function settleSecondsForDuration(durationMs: number): number {
  return Math.min(TRANSCRIPTION_RESERVE_SECONDS, Math.max(1, Math.ceil(durationMs / 1000)));
}

export function transcriptionReserveUnits(): Record<string, number> {
  return { [TRANSCRIPTION_USAGE_KIND]: TRANSCRIPTION_RESERVE_SECONDS };
}

export function transcriptionSettleUnits(durationMs: number): Record<string, number> {
  return { [TRANSCRIPTION_USAGE_KIND]: settleSecondsForDuration(durationMs) };
}

export function inspectVoiceUpload(args: {
  bytes: Uint8Array;
  mime: string;
  declaredDurationMs?: number | null;
}): VoiceInspection {
  if (args.bytes.byteLength > VOICE_MAX_BYTES) {
    return { ok: false, status: 413, error: VOICE_TOO_LARGE_ERROR };
  }
  if (args.bytes.byteLength === 0) {
    return { ok: false, status: 400, error: VOICE_UNREADABLE_ERROR };
  }
  const declared = args.declaredDurationMs;
  if (typeof declared === 'number' && Number.isFinite(declared) && declared > VOICE_MAX_DURATION_MS) {
    return { ok: false, status: 400, error: VOICE_TOO_LONG_ERROR };
  }

  const fromMime = voiceContainerFromMime(args.mime);
  const fromMagic = voiceContainerFromMagic(args.bytes);
  if (!fromMagic || (fromMime !== null && fromMime !== fromMagic)) {
    return { ok: false, status: 400, error: VOICE_UNSUPPORTED_ERROR };
  }
  if (fromMime === null && args.mime.trim() !== '') {
    return { ok: false, status: 400, error: VOICE_UNSUPPORTED_ERROR };
  }

  const durationMs = readVoiceDurationMs(args.bytes, fromMagic);
  if (durationMs === null || durationMs <= 0) {
    return { ok: false, status: 400, error: VOICE_UNREADABLE_ERROR };
  }
  if (durationMs > VOICE_MAX_DURATION_MS) {
    return { ok: false, status: 400, error: VOICE_TOO_LONG_ERROR };
  }
  return {
    ok: true,
    container: fromMagic,
    durationMs,
    settleSeconds: settleSecondsForDuration(durationMs),
  };
}

export type TranscriptionFallback = 'type';

export function globalHeadroomRemaining(
  rows: readonly { bucket_kind: string; remaining_microdollars: number }[],
): number | null {
  const row = rows.find((item) => item.bucket_kind === 'global');
  if (!row || !Number.isFinite(row.remaining_microdollars) || row.remaining_microdollars < 0) {
    return null;
  }
  return row.remaining_microdollars;
}

export function transcriptionProviderAllowed(args: {
  aiDisabled: boolean;
  redisOk: boolean;
  headroomRemaining: number | null;
  quoteMicrodollars: number;
  reserveAcquired: boolean;
}): { call: false; error: string } | { call: true } {
  if (args.aiDisabled || !args.redisOk || args.headroomRemaining === null) {
    return { call: false, error: VOICE_UNAVAILABLE_ERROR };
  }
  if (args.headroomRemaining < args.quoteMicrodollars || !args.reserveAcquired) {
    return { call: false, error: VOICE_BUDGET_ERROR };
  }
  return { call: true };
}

export function parseTranscriptionResponse(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { text?: unknown };
    if (typeof parsed.text !== 'string') return null;
    const text = parsed.text.trim();
    if (!text) return null;
    return text.length <= VOICE_MAX_TRANSCRIPT_CHARS
      ? text
      : text.slice(0, VOICE_MAX_TRANSCRIPT_CHARS);
  } catch {
    return null;
  }
}

export function transcriptionFromProvider(args: {
  timedOut: boolean;
  httpOk: boolean;
  body: string;
}): { transcript: string | null; error: string | null } {
  if (args.timedOut) return { transcript: null, error: VOICE_TIMEOUT_ERROR };
  if (!args.httpOk) return { transcript: null, error: VOICE_UNAVAILABLE_ERROR };
  const transcript = parseTranscriptionResponse(args.body);
  if (!transcript) return { transcript: null, error: VOICE_UNAVAILABLE_ERROR };
  return { transcript, error: null };
}

export function buildStoredTranscriptPayload(text: string): { kind: 'transcript'; text: string } {
  return { kind: 'transcript', text };
}

export function readStoredTranscript(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const stored = payload as { kind?: unknown; text?: unknown; audio?: unknown };
  if (stored.kind !== 'transcript' || typeof stored.text !== 'string') return null;
  if ('audio' in stored) return null;
  const text = stored.text.trim();
  if (!text || text.length > VOICE_MAX_TRANSCRIPT_CHARS) return null;
  return text;
}

export function voiceUploadFilename(container: VoiceContainer): string {
  return container === 'mp4' ? 'clip.mp4' : 'clip.webm';
}

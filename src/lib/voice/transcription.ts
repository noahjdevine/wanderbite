/**
 * Push-to-talk limits and the OpenAI file-transcription adapter.
 * Billing uses ai_quote_max_cost. These checks run before any provider call.
 * Raw audio is not stored.
 */

/**
 * Per-second size ceiling. A clip over VOICE_MAX_DURATION_MS is too long.
 * A clip over this rate, or over VOICE_MAX_BYTES, is too large.
 *
 * Chrome opus defaults to 128 kbps. iOS Safari does not set audioBitsPerSecond,
 * and WebKit's MediaRecorderPrivate defaults AAC to LargeAudioBitRate (192 kbps,
 * 24_000 bytes/s). A fragmented 5s iPhone-style AAC clip is about 24.5 KB/s
 * once moof overhead is included, so a 20_000 byte ceiling rejected real
 * 3–6s iPhone recordings as longer than 30 seconds. 64_000 bytes/s (512 kbps) covers
 * that 192 kbps default, WebKit's older 256 kbps AAC clamp, and short-clip
 * container headers, and still rejects a payload that cannot be 30 seconds.
 */
export const VOICE_MAX_BYTES_PER_SECOND = 64_000;
/** Matches seeded guest_voice_seconds_limit. One clip, guests and signed-in users. */
export const VOICE_MAX_DURATION_MS = 30_000;
export const VOICE_MAX_BYTES = VOICE_MAX_BYTES_PER_SECOND * (VOICE_MAX_DURATION_MS / 1000);
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
  | { ok: true; container: VoiceContainer; durationMs: number | null; settleSeconds: number }
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

type Mp4Box = { type: string; payload: number; end: number };

function nextMp4Box(bytes: Uint8Array, offset: number, end: number): Mp4Box | null {
  if (offset + 8 > end) return null;
  const size32 = readU32(bytes, offset);
  if (size32 === null || (size32 !== 0 && size32 !== 1 && size32 < 8)) return null;
  const type = String.fromCharCode(
    bytes[offset + 4]!,
    bytes[offset + 5]!,
    bytes[offset + 6]!,
    bytes[offset + 7]!,
  );
  if ([...type].some((char) => char < ' ' || char > '~')) return null;
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
  return { type, payload: offset + header, end: boxEnd };
}

function mdhdTimescale(bytes: Uint8Array): number | null {
  const visit = (start: number, end: number): number | null => {
    let offset = start;
    while (offset + 8 <= end) {
      const box = nextMp4Box(bytes, offset, end);
      if (!box) return null;
      if (box.type === 'mdhd') {
        const version = bytes[box.payload];
        const timescale = version === 0 ? readU32(bytes, box.payload + 12) : readU32(bytes, box.payload + 20);
        return timescale && timescale > 0 ? timescale : null;
      }
      if (box.type === 'moov' || box.type === 'trak' || box.type === 'mdia') {
        const nested = visit(box.payload, box.end);
        if (nested) return nested;
      }
      offset = box.end;
    }
    return null;
  };
  return visit(0, bytes.length);
}

function trafEndTicks(bytes: Uint8Array, start: number, end: number): number | null {
  let defaultDuration: number | null = null;
  let base: number | null = null;
  let sum = 0;
  let sawRun = false;
  let offset = start;
  while (offset + 8 <= end) {
    const box = nextMp4Box(bytes, offset, end);
    if (!box) return null;
    if (box.type === 'tfhd') {
      const flags = readU32(bytes, box.payload) ?? 0;
      let cursor = box.payload + 8;
      if (flags & 0x000001) cursor += 8;
      if (flags & 0x000002) cursor += 4;
      if (flags & 0x000008) {
        defaultDuration = readU32(bytes, cursor);
        cursor += 4;
      }
      if (cursor > box.end) return null;
    } else if (box.type === 'tfdt') {
      const version = bytes[box.payload];
      base = version === 1 ? readU64(bytes, box.payload + 4) : readU32(bytes, box.payload + 4);
      if (base === null) return null;
    } else if (box.type === 'trun') {
      const flags = (readU32(bytes, box.payload) ?? 0) & 0xffffff;
      const sampleCount = readU32(bytes, box.payload + 4);
      if (sampleCount === null) return null;
      let cursor = box.payload + 8;
      if (flags & 0x000001) cursor += 4;
      if (flags & 0x000004) cursor += 4;
      for (let i = 0; i < sampleCount; i += 1) {
        let duration = defaultDuration;
        if (flags & 0x000100) {
          duration = readU32(bytes, cursor);
          cursor += 4;
        }
        if (flags & 0x000200) cursor += 4;
        if (flags & 0x000400) cursor += 4;
        if (flags & 0x000800) cursor += 4;
        if (duration === null || cursor > box.end) return null;
        sum += duration;
      }
      sawRun = true;
    }
    offset = box.end;
  }
  if (!sawRun || base === null) return null;
  return base + sum;
}

/** Safari and Chrome MediaRecorder leave mvhd duration at 0 and store samples in moof/trun. */
function mp4FragmentDurationMs(bytes: Uint8Array): number | null {
  const timescale = mdhdTimescale(bytes);
  if (!timescale) return null;
  let maxEnd: number | null = null;
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const box = nextMp4Box(bytes, offset, bytes.length);
    if (!box) break;
    if (box.type === 'moof') {
      let fragment: number | null = null;
      let inner = box.payload;
      while (inner + 8 <= box.end) {
        const child = nextMp4Box(bytes, inner, box.end);
        if (!child) return null;
        if (child.type === 'traf') {
          const ticks = trafEndTicks(bytes, child.payload, child.end);
          if (ticks === null) return null;
          if (fragment === null || ticks > fragment) fragment = ticks;
        }
        inner = child.end;
      }
      if (fragment === null) return null;
      if (maxEnd === null || fragment > maxEnd) maxEnd = fragment;
    }
    offset = box.end;
  }
  if (maxEnd === null || maxEnd <= 0) return null;
  return Math.round((maxEnd / timescale) * 1000);
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
  if (unknown) return { length: width, value: 0, unknown: true };
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

function webmTimecodeScale(bytes: Uint8Array): number {
  const segment = readElements(bytes, 0, bytes.length).find((el) => el.id === SEGMENT_ID);
  if (!segment) return 1_000_000;
  const info = readElements(bytes, segment.start, segment.end).find((el) => el.id === INFO_ID);
  if (!info) return 1_000_000;
  for (const child of readElements(bytes, info.start, info.end)) {
    if (child.id !== TIMECODE_SCALE_ID) continue;
    const scale = readUnsigned(bytes, child.start, child.end);
    if (scale) return scale;
  }
  return 1_000_000;
}

function readI16(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > bytes.length) return null;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt16(offset);
}

/**
 * Chrome timesliced webm omits Duration and writes unknown-size Clusters.
 * The cluster timecode is a lower bound on how long the clip is.
 */
function webmClusterCeilingMs(bytes: Uint8Array): number | null {
  const clusters: number[] = [];
  for (let i = 0; i <= bytes.length - 4; i += 1) {
    if (bytes[i] === 0x1f && bytes[i + 1] === 0x43 && bytes[i + 2] === 0xb6 && bytes[i + 3] === 0x75) {
      clusters.push(i);
    }
  }
  if (clusters.length === 0) return null;
  const scale = webmTimecodeScale(bytes);
  let maxMs: number | null = null;
  for (let index = 0; index < clusters.length; index += 1) {
    const size = readVint(bytes, clusters[index]! + 4, false);
    if (!size) continue;
    const regionEnd = clusters[index + 1] ?? bytes.length;
    let offset = clusters[index]! + 4 + size.length;
    let timecode = 0;
    while (offset + 2 <= regionEnd) {
      const id = readVint(bytes, offset, true);
      if (!id) break;
      const elSize = readVint(bytes, offset + id.length, false);
      if (!elSize) break;
      const dataStart = offset + id.length + elSize.length;
      const dataEnd = elSize.unknown ? regionEnd : dataStart + elSize.value;
      if (dataEnd < dataStart || dataEnd > regionEnd) break;
      if (id.value === 0xe7) {
        const next = readUnsigned(bytes, dataStart, dataEnd);
        if (next !== null) {
          timecode = next;
          const ms = Math.round((timecode * scale) / 1_000_000);
          if (ms > 0 && (maxMs === null || ms > maxMs)) maxMs = ms;
        }
      } else if (id.value === 0xa3 || id.value === 0xa1) {
        const track = readVint(bytes, dataStart, false);
        const relative = track ? readI16(bytes, dataStart + track.length) : null;
        const tick = timecode + (relative !== null && relative > 0 ? relative : 0);
        const ms = Math.round((tick * scale) / 1_000_000);
        if (maxMs === null || ms > maxMs) maxMs = ms;
      }
      if (elSize.unknown) break;
      offset = dataEnd;
    }
  }
  return maxMs !== null && maxMs > 0 ? maxMs : null;
}

function longestDurationMs(values: Array<number | null>): number | null {
  let max: number | null = null;
  for (const value of values) {
    if (value === null || !Number.isFinite(value) || value <= 0) continue;
    if (max === null || value > max) max = value;
  }
  return max === null ? null : Math.round(max);
}

export function readVoiceDurationMs(bytes: Uint8Array, container: VoiceContainer): number | null {
  if (container === 'webm') {
    return longestDurationMs([webmDurationMs(bytes), webmClusterCeilingMs(bytes)]);
  }
  return longestDurationMs([mp4DurationMs(bytes), mp4FragmentDurationMs(bytes)]);
}

export function transcriptionReserveUnits(): Record<string, number> {
  return { [TRANSCRIPTION_USAGE_KIND]: TRANSCRIPTION_RESERVE_SECONDS };
}

/** Client duration is not a bill. The provider can charge the whole reserved clip. */
export function transcriptionSettleUnits(): Record<string, number> {
  return transcriptionReserveUnits();
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
  if (durationMs !== null && durationMs > VOICE_MAX_DURATION_MS) {
    return { ok: false, status: 400, error: VOICE_TOO_LONG_ERROR };
  }

  const claims = [VOICE_MAX_DURATION_MS];
  if (durationMs !== null && durationMs > 0) claims.push(durationMs);
  if (typeof declared === 'number' && Number.isFinite(declared) && declared > 0) {
    claims.push(declared);
  }
  const allowanceSeconds = Math.max(1, Math.ceil(Math.min(...claims) / 1000));
  if (args.bytes.byteLength > allowanceSeconds * VOICE_MAX_BYTES_PER_SECOND) {
    return { ok: false, status: 413, error: VOICE_TOO_LARGE_ERROR };
  }

  return {
    ok: true,
    container: fromMagic,
    durationMs,
    settleSeconds: TRANSCRIPTION_RESERVE_SECONDS,
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

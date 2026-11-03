'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  VOICE_BROWSER_MESSAGE,
  VOICE_CLIENT_STOP_MS,
  VOICE_MAX_BYTES,
  VOICE_PERMISSION_MESSAGE,
  VOICE_TOO_LARGE_ERROR,
  VOICE_UNAVAILABLE_ERROR,
} from '@/lib/voice/transcription';

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] as const;

type VoicePhase = 'idle' | 'recording' | 'sending';

function supportedMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null;
}

function voiceInputSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    supportedMime() !== null
  );
}

export function DiscoveryVoiceControls({
  disabled,
  onTranscript,
}: {
  disabled: boolean;
  onTranscript: (transcript: string) => void;
}) {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelRef.current = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function releaseStream() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function upload(blob: Blob, durationMs: number, mime: string) {
    if (mountedRef.current) setPhase('sending');
    if (blob.size <= 0) {
      if (mountedRef.current) {
        setNotice(VOICE_UNAVAILABLE_ERROR);
        setPhase('idle');
      }
      return;
    }
    if (blob.size > VOICE_MAX_BYTES) {
      if (mountedRef.current) {
        setNotice(VOICE_TOO_LARGE_ERROR);
        setPhase('idle');
      }
      return;
    }

    const body = new FormData();
    body.set('audio', blob, mime.includes('mp4') ? 'clip.mp4' : 'clip.webm');
    body.set('durationMs', String(Math.max(0, Math.round(durationMs))));
    try {
      const res = await fetch('/api/roulette/transcribe', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body,
      });
      const data = (await res.json()) as { transcript?: unknown; error?: unknown };
      if (!mountedRef.current) return;
      if (typeof data.transcript === 'string' && data.transcript.trim()) {
        onTranscript(data.transcript);
        const box = document.getElementById('discovery-message');
        if (box instanceof HTMLTextAreaElement) box.focus();
        setNotice(
          data.transcript.length > 500
            ? 'Transcript added. Shorten it to 500 characters, then choose Find a spot.'
            : 'Transcript added. Edit it, then choose Find a spot.',
        );
      } else {
        setNotice(typeof data.error === 'string' ? data.error : VOICE_UNAVAILABLE_ERROR);
      }
    } catch {
      if (mountedRef.current) setNotice(VOICE_UNAVAILABLE_ERROR);
    } finally {
      if (mountedRef.current) setPhase('idle');
    }
  }

  async function startRecording() {
    if (phase !== 'idle' || disabled || startingRef.current) return;
    startingRef.current = true;
    setNotice(null);
    if (!voiceInputSupported()) {
      startingRef.current = false;
      setNotice(VOICE_BROWSER_MESSAGE);
      return;
    }
    const mime = supportedMime();
    if (!mime) {
      startingRef.current = false;
      setNotice(VOICE_BROWSER_MESSAGE);
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      startingRef.current = false;
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotFoundError') {
        setNotice('No microphone was found. Type your request instead.');
      } else if (name === 'NotAllowedError' || name === 'SecurityError') {
        setNotice(VOICE_PERMISSION_MESSAGE);
      } else {
        setNotice(VOICE_BROWSER_MESSAGE);
      }
      return;
    }

    if (!mountedRef.current) {
      startingRef.current = false;
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime });
    } catch {
      startingRef.current = false;
      stream.getTracks().forEach((track) => track.stop());
      setNotice(VOICE_BROWSER_MESSAGE);
      return;
    }
    chunksRef.current = [];
    cancelRef.current = false;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const durationMs = Date.now() - startedAtRef.current;
      const blob = new Blob(chunksRef.current, { type: mime });
      chunksRef.current = [];
      releaseStream();
      recorderRef.current = null;
      startingRef.current = false;
      if (cancelRef.current) {
        if (mountedRef.current) setPhase('idle');
        return;
      }
      void upload(blob, durationMs, mime);
    };

    streamRef.current = stream;
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    try {
      recorder.start(1000);
    } catch {
      startingRef.current = false;
      recorderRef.current = null;
      releaseStream();
      setNotice(VOICE_BROWSER_MESSAGE);
      return;
    }
    setPhase('recording');
    timerRef.current = window.setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, VOICE_CLIENT_STOP_MS);
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
  }

  function cancelRecording() {
    cancelRef.current = true;
    setNotice(null);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      return;
    }
    releaseStream();
    setPhase('idle');
  }

  const busy = disabled || phase === 'sending';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {phase === 'recording' ? (
          <>
            <Button type="button" variant="outline" onClick={stopRecording} disabled={busy}>
              Stop
            </Button>
            <Button type="button" variant="ghost" onClick={cancelRecording} disabled={busy}>
              Cancel
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" onClick={() => void startRecording()} disabled={busy}>
            {phase === 'sending' ? 'Transcribing…' : 'Record'}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {phase === 'recording'
          ? 'Recording. Stop to fill the box, or Cancel to discard. Up to 30 seconds.'
          : (notice ?? 'Record a short request, edit the transcript, then choose Find a spot.')}
      </p>
    </div>
  );
}

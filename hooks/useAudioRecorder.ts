"use client";

import { useRef, useState, useCallback } from "react";

export interface AudioChunk {
  blob: Blob;       // the raw audio data for this interval, ready to send to Whisper
  timestamp: number; // when the chunk was flushed — used as the transcript chunk timestamp
}

// captures mic audio and emits a Blob every chunkIntervalMs milliseconds.
// the caller receives each blob and sends it to Whisper.
export function useAudioRecorder(onChunk: (chunk: AudioChunk) => void, chunkIntervalMs = 30000) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null); // the active MediaRecorder instance
  const streamRef = useRef<MediaStream | null>(null);           // the mic stream — stopped on recording end
  const intervalRef = useRef<NodeJS.Timeout | null>(null);      // the periodic flush timer
  const chunksRef = useRef<BlobPart[]>([]);                     // accumulates 1s blobs between flushes

  // builds a Blob from accumulated chunks and fires onChunk.
  // requestData() forces the recorder to emit any audio it has buffered but not yet
  // delivered via ondataavailable — without this the last ~1s of audio can be silently lost.
  // the 50ms setTimeout lets that data event fire and populate chunksRef before we read it.
  const flushChunk = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.requestData(); // triggers ondataavailable synchronously
    }
    setTimeout(() => {
      if (chunksRef.current.length === 0) return; // nothing to send — skip
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      chunksRef.current = []; // clear so the next interval starts fresh
      onChunk({ blob, timestamp: Date.now() });
    }, 50);
  }, [onChunk]);

  // requests mic access, creates the MediaRecorder, and starts the flush interval
  const start = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // prefer opus codec for better compression and quality; fall back to plain webm
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      // timeslice of 1000ms means the recorder emits a data event every second,
      // keeping chunksRef populated with small pieces rather than one giant blob at flush time
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(1000);
      setIsRecording(true);

      // flush accumulated audio to Whisper every chunkIntervalMs (default 30s)
      intervalRef.current = setInterval(flushChunk, chunkIntervalMs);
    } catch (err) {
      // covers both "Permission denied" and hardware errors
      setError(err instanceof Error ? err.message : "Microphone access denied");
    }
  }, [flushChunk, chunkIntervalMs]);

  // stops recording and releases the mic — order matters:
  // 1. clear interval so no more automatic flushes fire
  // 2. stop the recorder so it finalises its internal buffer
  // 3. stop all mic tracks so the browser removes the recording indicator
  // 4. flush once more after 200ms to capture any audio that arrived after stop()
  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    setTimeout(flushChunk, 200); // final flush — longer delay than normal to let stop() settle
    setIsRecording(false);
  }, [flushChunk]);

  // called by handleRefresh in page.tsx to immediately flush audio mid-recording
  // without waiting for the next interval tick
  const forceFlush = useCallback(() => {
    flushChunk();
  }, [flushChunk]);

  return { isRecording, error, start, stop, forceFlush };
}
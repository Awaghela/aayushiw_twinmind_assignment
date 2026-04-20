"use client";

import { useRef, useState, useCallback, useEffect } from "react";

export interface AudioChunk {
  blob: Blob;       // raw audio data ready to send to Whisper
  timestamp: number; // when the chunk was flushed — used as the transcript chunk timestamp
}

// captures mic audio and emits a Blob every chunkIntervalMs (default 30s).
// also emits a final blob on stop() if meaningful audio was recorded since the last interval.
export function useAudioRecorder(onChunk: (chunk: AudioChunk) => void, chunkIntervalMs = 30000) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const chunksRef = useRef<BlobPart[]>([]); // accumulates 1s blobs between flushes
  // saved in start() so flushChunk builds the Blob with the correct type —
  // mismatch between recorded type and Blob type causes Whisper to return 400
  const mimeTypeRef = useRef<string>("audio/webm");
  // tracks when the interval last flushed so stop() can skip if nothing new was recorded
  const lastIntervalFlushRef = useRef<number>(0);

  // always holds the latest onChunk callback so the setInterval closure never goes stale
  const onChunkRef = useRef(onChunk);
  useEffect(() => {
    onChunkRef.current = onChunk;
  }, [onChunk]);

  // builds a Blob from accumulated chunks and fires onChunk.
  // requestData() forces the recorder to emit any buffered audio before we read chunksRef —
  // without this the last ~1s of audio can be silently lost.
  // the 50ms setTimeout lets that ondataavailable event fire and populate chunksRef first.
  const flushChunk = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.requestData();
    }
    setTimeout(() => {
      if (chunksRef.current.length === 0) return; // nothing to send — skip
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
      chunksRef.current = []; // clear so the next interval starts fresh
      if (blob.size > 0) {
        onChunkRef.current({ blob, timestamp: Date.now() });
      }
    }, 50);
  }, []);

  // requests mic access, creates the MediaRecorder, and starts the flush interval
  const start = useCallback(async () => {
    try {
      setError(null);
      chunksRef.current = []; // clear any leftover chunks from previous session
      lastIntervalFlushRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // prefer opus codec for better quality and compression; fall back to plain webm
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      mimeTypeRef.current = mimeType; // save so flushChunk uses the correct type

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      // timeslice of 1000ms means the recorder emits a data event every second,
      // keeping chunksRef populated incrementally rather than one giant blob at flush time
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(1000);
      setIsRecording(true);

      intervalRef.current = setInterval(() => {
        lastIntervalFlushRef.current = Date.now(); // stamp the flush time before sending
        flushChunk();
      }, chunkIntervalMs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone access denied");
    }
  }, [flushChunk, chunkIntervalMs]);

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    // decide whether to flush on stop:
    // - if the interval fired within the last 5s, chunksRef has at most 1-2 stray 1s blobs
    //   that Whisper would reject as too short — skip to avoid the 400 error
    // - if lastIntervalFlushRef is 0 (interval never fired = short recording), always flush
    const timeSinceLastFlush = Date.now() - lastIntervalFlushRef.current;
    const hasNewAudio = chunksRef.current.length > 0 && (lastIntervalFlushRef.current === 0 || timeSinceLastFlush > 5000);

    if (hasNewAudio) {
      // flush BEFORE stopping the recorder — requestData() requires state === "recording"
      flushChunk();
      // stop recorder and release mic after the flush's 50ms tick completes
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }
      }, 150);
    } else {
      // nothing new to flush — stop immediately
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    }

    setIsRecording(false);
  }, [flushChunk]);

  // called by handleRefresh in page.tsx to immediately flush audio mid-recording
  // without waiting for the next interval tick
  const forceFlush = useCallback(() => {
    flushChunk();
  }, [flushChunk]);

  return { isRecording, error, start, stop, forceFlush };
}
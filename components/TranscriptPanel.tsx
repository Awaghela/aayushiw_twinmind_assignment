"use client";

import { useEffect, useRef } from "react";
import { Mic, MicOff, AlertCircle } from "lucide-react";
import type { TranscriptChunk } from "@/lib/types";

interface Props {
  isRecording: boolean;
  isTranscribing: boolean;  // true while a Whisper API call is in flight
  chunks: TranscriptChunk[]; // one chunk per ~30s audio flush, appended as recording continues
  error: string | null;      // mic permission error or Whisper API error — shown in the red banner
  onStart: () => void;
  onStop: () => void;
  hasApiKey: boolean;        // disables the mic button and changes empty state copy if false
}

// includes seconds so users can see exactly when each chunk was captured
function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// five animated bars that bounce while the mic is active — purely visual feedback
// that audio is being captured. styled and animated in globals.css via .audio-bar
function AudioBars() {
  return (
    <div className="audio-bars">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="audio-bar" />
      ))}
    </div>
  );
}

export function TranscriptPanel({ isRecording, isTranscribing, chunks, error, onStart, onStop, hasApiKey }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // scroll to the latest chunk whenever a new one is appended
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chunks]);

  return (
    <div className="flex flex-col h-full relative z-10">

      {/* header — shows animated bars while recording, shimmer "Transcribing…" while API call is pending */}
      <div className="flex items-center justify-between px-5 py-4 header-glow">
        <div className="flex items-center gap-3">
          <span className="font-display font-700 text-base tracking-widest uppercase text-[var(--muted)]">
            Transcript
          </span>
          {isRecording && <AudioBars />}
          {/* shimmer-text is a CSS animation defined in globals.css — distinct from the audio bars */}
          {isTranscribing && (
            <span className="shimmer-text font-mono text-[10px] font-500 tracking-wider uppercase">
              Transcribing…
            </span>
          )}
        </div>
        {/* chunk count — helps the user track how many audio flushes have happened */}
        <span className="font-mono text-[11px] text-[var(--dim)]">
          {chunks.length} chunk{chunks.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* scrollable transcript area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {chunks.length === 0 ? (
          // empty state — copy changes based on whether the user has an API key set
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="empty-state-icon">
              <Mic size={22} className="text-[var(--accent)]" style={{ opacity: 0.6 }} />
            </div>
            <div>
              <p className="text-base font-500 text-[var(--muted)]">No transcript yet</p>
              <p className="text-sm text-[var(--dim)] mt-1.5">
                {hasApiKey ? "Hit record to start capturing" : "Add your Groq API key in Settings"}
              </p>
            </div>
          </div>
        ) : (
          chunks.map((chunk, i) => (
            // animate-fade-in on each chunk so new chunks slide in softly rather than popping in
            <div key={chunk.id} className="animate-fade-in">
              <div className="transcript-chunk">
                {/* chunk metadata — timestamp and sequence number (#1, #2…) */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-[10px] text-[var(--dim)]">
                    {formatTime(chunk.timestamp)}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--dim)] opacity-40">·</span>
                  <span className="font-mono text-[10px] text-[var(--dim)]">#{i + 1}</span>
                </div>
                <p className="text-[15px] text-[var(--text)] leading-relaxed" style={{ opacity: 0.95 }}>
                  {chunk.text}
                </p>
              </div>
            </div>
          ))
        )}
        {/* invisible scroll anchor — useEffect scrolls here when a new chunk arrives */}
        <div ref={bottomRef} />
      </div>

      {/* error banner — shown for both mic permission errors and Whisper API errors */}
      {error && (
        <div className="mx-4 mb-3 flex items-center gap-2 px-4 py-3 rounded-xl"
          style={{ background: 'linear-gradient(135deg, rgba(255,92,117,0.08), rgba(255,138,92,0.04))', border: '1px solid rgba(255,92,117,0.15)' }}>
          <AlertCircle size={14} className="text-[var(--red)] shrink-0" />
          <span className="text-xs text-[var(--red)]">{error}</span>
        </div>
      )}

      {/* mic button — three visual states: disabled (no API key), recording, idle */}
      <div className="px-4 py-4">
        <button
          onClick={isRecording ? onStop : onStart}
          disabled={!hasApiKey}
          className={`
            relative w-full py-3.5 font-display font-600 text-sm tracking-wide transition-all duration-300
            ${!hasApiKey
              ? "opacity-30 cursor-not-allowed rounded-xl bg-[rgba(255,255,255,0.03)] text-[var(--dim)] border border-[rgba(255,255,255,0.05)]"
              : isRecording
                ? "btn-stop"
                : "btn-gradient"
            }
          `}
        >
          <span className="relative z-10 flex items-center justify-center gap-2.5">
            {isRecording ? (
              <>
                {/* pulsing white dot — same pattern as the REC indicator in the top bar */}
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                </span>
                Stop Recording
              </>
            ) : (
              <>
                <Mic size={15} />
                Start Recording
              </>
            )}
          </span>
        </button>
      </div>
    </div>
  );
}

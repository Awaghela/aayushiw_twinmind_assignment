"use client";

import { RefreshCw, Zap, Clock } from "lucide-react";
import type { SuggestionBatch, Suggestion, SuggestionType } from "@/lib/types";
import clsx from "clsx";

interface Props {
  batches: SuggestionBatch[];       // all batches so far, newest first
  isLoading: boolean;               // true while a suggestion generation call is in flight
  onRefresh: () => void;
  onSuggestionClick: (suggestion: Suggestion) => void;
  activeSuggestionId?: string;      // highlights the card that was last clicked
  countdown: number;                // seconds until next auto-refresh, shown in the header
  isRecording: boolean;             // countdown only shows while recording
  status?: "transcribing" | "generating" | "idle"; // drives the status bar below the header
}

// human-readable labels for each suggestion type tag
const TYPE_LABELS: Record<SuggestionType, string> = {
  question: "Question to Ask",
  "talking-point": "Talking Point",
  answer: "Answer",
  factcheck: "Fact Check",
  clarify: "Clarify",
};

// maps each type to its CSS class for color-coded tag styling (defined in globals.css)
const TYPE_TAG_CLASS: Record<SuggestionType, string> = {
  question: "tag-question",
  "talking-point": "tag-talking-point",
  answer: "tag-answer",
  factcheck: "tag-factcheck",
  clarify: "tag-clarify",
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// single suggestion card — animates in with a staggered slideDown only when it belongs
// to the newest batch (isNew). older batches render instantly with no animation.
function SuggestionCard({
  suggestion,
  isActive,
  onClick,
  isNew,
  index,
}: {
  suggestion: Suggestion;
  isActive: boolean;  // true when this card's detail is currently shown in the chat panel
  onClick: () => void;
  isNew: boolean;     // true only for the most recently generated batch
  index: number;      // 0–2 within a batch — used to stagger the slide-in animation
}) {
  return (
    <div
      onClick={onClick}
      className={clsx("suggestion-card", isActive && "active")}
      style={{
        // stagger each card by 80ms so they cascade in rather than popping in together
        animationDelay: isNew ? `${index * 80}ms` : "0ms",
        animation: isNew ? `slideDown 0.4s cubic-bezier(0.22,1,0.36,1) ${index * 80}ms backwards` : undefined,
      }}
    >
      <div className="relative z-10">
        {/* type badge — color tells the user at a glance what kind of suggestion this is */}
        <div className="flex items-center gap-2 mb-2.5">
          <span className={clsx("tag", TYPE_TAG_CLASS[suggestion.type])}>
            {TYPE_LABELS[suggestion.type]}
          </span>
        </div>
        {/* preview text — should be useful on its own without needing to click */}
        <p className="text-[13px] text-[var(--text)] leading-relaxed font-light" style={{ opacity: 0.95 }}>
          {suggestion.preview}
        </p>
        <div className="mt-3 flex items-center gap-1.5">
          <span className="text-xs font-mono text-[var(--dim)] group-hover:text-[var(--accent)] transition-colors">
            Tap for details →
          </span>
        </div>
      </div>
    </div>
  );
}

// placeholder card shown while suggestions are loading — mimics the shape of a real card
// with shimmer blocks so the layout doesn't jump when real cards arrive.
// index drives an animationDelay so skeletons also stagger in rather than appearing all at once.
function SkeletonCard({ index }: { index: number }) {
  return (
    <div
      className="rounded-[14px] px-[18px] py-[14px] border border-[rgba(255,255,255,0.04)]"
      style={{
        background: "linear-gradient(135deg, rgba(14,17,26,0.8), rgba(22,27,40,0.6))",
        animationDelay: `${index * 100}ms`,
      }}
    >
      {/* tag placeholder */}
      <div className="skeleton h-[16px] w-28 mb-2.5" />
      {/* preview text placeholder — two lines at different widths to look natural */}
      <div className="space-y-1.5">
        <div className="skeleton h-[13px] w-full" />
        <div className="skeleton h-[13px] w-3/4" />
      </div>
      {/* "Tap for details" placeholder */}
      <div className="skeleton h-[11px] w-16 mt-2.5" />
    </div>
  );
}

export function SuggestionsPanel({
  batches,
  isLoading,
  onRefresh,
  onSuggestionClick,
  activeSuggestionId,
  countdown,
  isRecording,
  status = "idle",
}: Props) {
  // used to identify which batch is newest so SuggestionCard knows whether to animate
  const newestBatchId = batches[0]?.id;

  return (
    <div className="flex flex-col h-full relative z-10">

      {/* ── header ── */}
      <div className="flex items-center justify-between px-5 py-4 header-glow">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-md flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, rgba(79,255,176,0.15), rgba(56,189,248,0.1))" }}>
            <Zap size={11} className="text-[var(--accent)]" />
          </div>
          <span className="font-display font-700 text-base tracking-widest uppercase text-[var(--muted)]">
            Suggestions
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          {/* countdown ring — only visible while recording and timer is ticking */}
          {isRecording && countdown > 0 && (
            <div className="countdown-ring">
              <Clock size={10} />
              <span>{countdown}s</span>
            </div>
          )}
          {/* refresh button — spins the icon and shows "Thinking…" while loading */}
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className={clsx(
              "flex items-center gap-1.5 px-3.5 py-2 text-xs font-display font-600 tracking-wide transition-all",
              isLoading
                ? "opacity-40 cursor-not-allowed btn-ghost"
                : "btn-accent-ghost"
            )}
          >
            <RefreshCw size={11} className={clsx(isLoading && "refresh-spin")} />
            {isLoading ? "Thinking…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── status bar ── only visible when transcribing or generating, hidden at idle */}
      {status !== "idle" && (
        <div className="flex items-center gap-2 px-5 py-2"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          {/* dot color: blue for transcribing, green for generating suggestions */}
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse2"
            style={{
              background: status === "transcribing"
                ? "var(--blue)"
                : "var(--accent)"
            }}
          />
          <span className="font-mono text-[11px] text-[var(--muted)]">
            {status === "transcribing"
              ? "Transcribing audio…"
              : "Generating suggestions…"}
          </span>
        </div>
      )}

      {/* ── suggestion list ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

        {/* first-load skeleton — shown only when loading with no batches yet */}
        {isLoading && batches.length === 0 && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <SkeletonCard key={i} index={i} />)}
          </div>
        )}

        {/* empty state — copy changes based on whether the mic is active */}
        {!isLoading && batches.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="empty-state-icon">
              <Zap size={22} className="text-[var(--accent)]" style={{ opacity: 0.6 }} />
            </div>
            <div>
              <p className="text-base font-500 text-[var(--muted)]">No suggestions yet</p>
              <p className="text-sm text-[var(--dim)] mt-1.5">
                {isRecording
                  ? "Suggestions appear after the first transcript chunk"
                  : "Start recording to get live AI suggestions"}
              </p>
            </div>
          </div>
        )}

        {batches.map((batch, batchIdx) => (
          <div
            key={batch.id}
            style={{
              // fade older batches to 45% opacity while a new one is loading,
              // so the user's eye goes to the skeleton cards at the top
              opacity: isLoading && batchIdx >= 1 ? 0.45 : 1,
              transition: "opacity 0.3s ease"
            }}
          >
            {/* batch header — timestamp on the left, "Latest" badge on the newest batch */}
            <div className="batch-divider mb-3">
              <span className="font-mono text-[10px] text-[var(--dim)] whitespace-nowrap">
                {formatTime(batch.timestamp)}
              </span>
              {batchIdx === 0 && (
                <span className="tag tag-talking-point">Latest</span>
              )}
            </div>

            {/* cards — replace with skeletons on the newest batch while loading,
                so the refresh feels responsive even before the API responds */}
            <div className="space-y-2.5">
              {isLoading && batchIdx === 0
                ? [0, 1, 2].map((i) => <SkeletonCard key={i} index={i} />)
                : batch.suggestions.map((s, sIdx) => (
                    <SuggestionCard
                      key={s.id}
                      suggestion={s}
                      isActive={s.id === activeSuggestionId}
                      onClick={() => onSuggestionClick(s)}
                      isNew={batch.id === newestBatchId && batchIdx === 0}
                      index={sIdx}
                    />
                  ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

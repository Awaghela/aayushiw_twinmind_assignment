"use client"; // needed — uses browser APIs (MediaRecorder, localStorage)

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Settings, Download, Brain, Sun, Moon } from "lucide-react";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { SuggestionsPanel } from "@/components/SuggestionsPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { SettingsModal } from "@/components/SettingsModal";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { transcribeAudio, generateSuggestions, streamDetailResponse, streamChatResponse } from "@/lib/groq";
import { exportSession } from "@/lib/export";
import { DEFAULT_SETTINGS } from "@/lib/types";
import type { TranscriptChunk, SuggestionBatch, ChatMessage, AppSettings, Suggestion } from "@/lib/types";

function uid() {
  return Math.random().toString(36).slice(2);
}

export default function Home() {
  // persisted across reloads; keyLoaded blocks render until localStorage is read
  const [apiKey, setApiKey, keyLoaded] = useLocalStorage("groq_api_key", "");
  const [settings, setSettings, settingsLoaded] = useLocalStorage<AppSettings>("app_settings", DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [transcriptChunks, setTranscriptChunks] = useState<TranscriptChunk[]>([]);
  const [suggestionBatches, setSuggestionBatches] = useState<SuggestionBatch[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | undefined>();
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    // flips CSS variables for the whole UI without re-rendering every component
    document.documentElement.setAttribute("data-theme", next);
  };

  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const [exportMenuPos, setExportMenuPos] = useState({ top: 0, right: 0 });
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  // derived on every render — not state, always computable from transcriptChunks
  const fullTranscript = transcriptChunks.map((c) => c.text).join("\n");

  // ref not state: state updates are async/batched — two rapid triggers could both
  // pass the guard before either sets isSuggesting, causing duplicate batches
  const isSuggestingRef = useRef(false);

  // set by handleRefresh; cleared in handleAudioChunk once the new chunk arrives,
  // ensuring suggestions always run against the freshest transcript
  const pendingRefreshRef = useRef(false);

  // set inside the state updater so it's guaranteed to be true when the useEffect
  // that watches transcriptChunks fires
  const shouldAutoSuggestRef = useRef(false);

  // receives each ~30s audio blob from the recorder, sends to Whisper, appends chunk
  const handleAudioChunk = useCallback(
    async (chunk: { blob: Blob; timestamp: number }) => {
      if (!apiKey) return;
      setIsTranscribing(true);
      setTranscriptError(null);
      try {
        const text = await transcribeAudio(apiKey, chunk.blob);
        if (text) {
          setTranscriptChunks((prev) => {
            const updated = [...prev, { id: uid(), timestamp: chunk.timestamp, text }];
            if (pendingRefreshRef.current) {
              pendingRefreshRef.current = false;
            }
            shouldAutoSuggestRef.current = true;
            return updated;
          });
        }
      } catch (e) {
        setTranscriptError(e instanceof Error ? e.message : "Transcription error");
      } finally {
        setIsTranscribing(false);
      }
    },
    [apiKey]
  );

  const { isRecording, error: micError, start, stop, forceFlush } = useAudioRecorder(
    handleAudioChunk,
    settings.refreshIntervalSeconds * 1000
  );

  // generates 3 suggestions; passes previous previews to avoid repeating last batch
  const runSuggestions = useCallback(
    async (transcript: string, batches: SuggestionBatch[]) => {
      if (!apiKey || isSuggestingRef.current) return;
      isSuggestingRef.current = true;
      setIsSuggesting(true);

      const previousPreviews = batches[0]?.suggestions.map((s) => s.preview) ?? [];

      try {
        const suggestions = await generateSuggestions(apiKey, transcript, settings, previousPreviews);
        if (suggestions.length > 0) {
          const batch: SuggestionBatch = {
            id: uid(),
            timestamp: Date.now(),
            suggestions,
            transcriptSnapshot: transcript,
          };
          setSuggestionBatches((prev) => [batch, ...prev]); // newest first
        }
      } catch (e) {
        console.error("Suggestions error:", e);
      } finally {
        isSuggestingRef.current = false;
        setIsSuggesting(false);
      }
    },
    [apiKey, settings]
  );

  // if recording: flushes audio and waits for handleAudioChunk to trigger suggestions
  // if not recording: runs suggestions immediately on current transcript
  const handleRefresh = useCallback(async () => {
    resetCountdown();
    if (isRecording) {
      pendingRefreshRef.current = true;
      forceFlush();
    } else {
      const transcript = transcriptChunks.map((c) => c.text).join("\n");
      runSuggestions(transcript, suggestionBatches);
    }
  }, [isRecording, forceFlush, transcriptChunks, suggestionBatches, runSuggestions]);

  function resetCountdown() {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setCountdown(settings.refreshIntervalSeconds);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  // auto-suggest after each new transcript chunk; flag pattern avoids stale closure issues
  useEffect(() => {
    if (shouldAutoSuggestRef.current && transcriptChunks.length > 0) {
      shouldAutoSuggestRef.current = false;
      const transcript = transcriptChunks.map((c) => c.text).join("\n");
      runSuggestions(transcript, suggestionBatches);
      resetCountdown();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptChunks]);

  // start/stop countdown in sync with recording state
  useEffect(() => {
    if (!isRecording) {
      if (countdownRef.current) clearInterval(countdownRef.current);
      setCountdown(0);
      return;
    }
    resetCountdown();
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, settings.refreshIntervalSeconds]);

  // prompt for API key on first visit
  useEffect(() => {
    if (keyLoaded && !apiKey) setSettingsOpen(true);
  }, [keyLoaded, apiKey]);

  // streams detail response token-by-token into chat; caches result on the suggestion
  // so re-clicking the same card replays instantly without a second API call
  const handleSuggestionClick = useCallback(
    async (suggestion: Suggestion) => {
      setActiveSuggestionId(suggestion.id);

      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: `[${suggestion.type.toUpperCase()}] ${suggestion.preview}`,
        timestamp: Date.now(),
      };

      const assistantId = uid();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        loading: true,
      };

      setChatMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsChatLoading(true);

      try {
        // cache hit — replay instantly
        if (suggestion.detail) {
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: suggestion.detail!, loading: false } : m
            )
          );
          return;
        }

        // cache miss — stream token-by-token; spinner drops on first token
        let accumulated = "";
        for await (const delta of streamDetailResponse(apiKey, suggestion, fullTranscript, settings)) {
          accumulated += delta;
          const snap = accumulated;
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: snap, loading: false } : m
            )
          );
        }

        // write completed text back so next click is a cache hit
        setSuggestionBatches((batches) =>
          batches.map((b) => ({
            ...b,
            suggestions: b.suggestions.map((s) =>
              s.id === suggestion.id ? { ...s, detail: accumulated } : s
            ),
          }))
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "Failed to get detail";
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: `Error: ${errMsg}`, loading: false } : m
          )
        );
      } finally {
        setIsChatLoading(false);
      }
    },
    [apiKey, fullTranscript, settings]
  );

  // streams chat response; sends last 10 messages as history for conversational context
  const handleChatSend = useCallback(
    async (text: string) => {
      if (!apiKey) return;

      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };

      const assistantId = uid();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        loading: true,
      };

      setChatMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsChatLoading(true);

      const history = chatMessages
        .filter((m) => !m.loading)
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        let accumulated = "";
        for await (const delta of streamChatResponse(apiKey, text, fullTranscript, history, settings)) {
          accumulated += delta;
          const snap = accumulated;
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: snap, loading: false } : m
            )
          );
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "Chat error";
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: `Error: ${errMsg}`, loading: false } : m
          )
        );
      } finally {
        setIsChatLoading(false);
      }
    },
    [apiKey, chatMessages, fullTranscript, settings]
  );

  const handleExport = (format: "json" | "text") => {
    exportSession(transcriptChunks, suggestionBatches, chatMessages, format);
    setExportMenuOpen(false);
  };

  const combinedError = micError || transcriptError;

  // wait for localStorage to load before rendering to avoid API key flash
  if (!keyLoaded || !settingsLoaded) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-[var(--muted)]">
          <Brain size={18} className="animate-pulse2 text-[var(--accent)]" />
          <span className="font-mono text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden relative z-10">
      <header className="flex items-center justify-between px-6 py-3.5 header-glow shrink-0 transition-colors duration-300"
        style={{
          background: theme === "dark" ? "rgba(6,8,13,0.85)" : "rgba(255,255,255,0.9)",
          backdropFilter: "blur(16px)"
        }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-[var(--accent)]" />
            <span className="font-display font-800 text-base tracking-tight logo-text">
              TwinMind
            </span>
          </div>
          <span className="text-[var(--dim)] opacity-30">·</span>
          <span className="font-mono text-sm text-[var(--dim)] hidden sm:block">Live Suggestions</span>
          {isRecording && (
            <div className="rec-indicator ml-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--red)] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--red)]" />
              </span>
              <span className="font-mono text-[11px] text-[var(--red)]">REC</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              ref={exportBtnRef}
              onClick={() => {
                if (!exportMenuOpen && exportBtnRef.current) {
                  // anchor dropdown to button position via portal
                  const rect = exportBtnRef.current.getBoundingClientRect();
                  setExportMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
                }
                setExportMenuOpen(!exportMenuOpen);
              }}
              disabled={transcriptChunks.length === 0}
              title="Export session"
              className="btn-ghost flex items-center gap-1.5 px-3.5 py-2 text-xs font-display font-600 tracking-wide disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:transform-none"
            >
              <Download size={11} />
              Export
            </button>
            {/* portal escapes header's stacking context so dropdown renders above everything */}
            {exportMenuOpen && createPortal(
              <>
                <div className="fixed inset-0 z-40" onClick={() => setExportMenuOpen(false)} />
                <div
                  className="fixed w-44 rounded-xl p-1.5 z-50 animate-fade-in"
                  style={{
                    top: exportMenuPos.top,
                    right: exportMenuPos.right,
                    background: theme === "dark"
                      ? "linear-gradient(180deg, rgba(14,17,26,0.97), rgba(10,12,18,0.99))"
                      : "rgba(255,255,255,0.98)",
                    border: theme === "dark"
                      ? "1px solid rgba(255,255,255,0.08)"
                      : "1px solid rgba(0,0,0,0.1)",
                    boxShadow: "0 12px 40px rgba(0,0,0,0.15)",
                    backdropFilter: "blur(20px)",
                  }}
                >
                  <button
                    onClick={() => handleExport("json")}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-display font-600 text-[var(--text)] hover:bg-[rgba(79,255,176,0.08)] transition-colors"
                  >
                    <span>JSON</span>
                    <span className="font-mono text-[10px] text-[var(--dim)]">.json</span>
                  </button>
                  <button
                    onClick={() => handleExport("text")}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-display font-600 text-[var(--text)] hover:bg-[rgba(79,255,176,0.08)] transition-colors"
                  >
                    <span>Plain Text</span>
                    <span className="font-mono text-[10px] text-[var(--dim)]">.txt</span>
                  </button>
                </div>
              </>,
              document.body
            )}
          </div>
          <button
            onClick={toggleTheme}
            title="Toggle theme"
            className="btn-ghost flex items-center gap-1.5 px-3.5 py-2 text-xs font-display font-600 tracking-wide"
          >
            {theme === "dark" ? <Sun size={11} /> : <Moon size={11} />}
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          {/* accent style when no key set — draws attention to required first step */}
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className={apiKey ? "btn-ghost flex items-center gap-1.5 px-3.5 py-2 text-xs font-display font-600 tracking-wide" : "btn-accent-ghost flex items-center gap-1.5 px-3.5 py-2 text-xs font-display font-600 tracking-wide"}
          >
            <Settings size={11} />
            {apiKey ? "Settings" : "Add API Key"}
          </button>
        </div>
      </header>

      {/* 3-column layout — each column scrolls independently */}
      <main className="flex flex-1 overflow-hidden">
        <div className="w-[28%] col-separator flex flex-col overflow-hidden">
          <TranscriptPanel
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            chunks={transcriptChunks}
            error={combinedError}
            onStart={start}
            onStop={stop}
            hasApiKey={!!apiKey}
          />
        </div>

        <div className="w-[36%] col-separator flex flex-col overflow-hidden">
          <SuggestionsPanel
            batches={suggestionBatches}
            isLoading={isSuggesting}
            onRefresh={handleRefresh}
            onSuggestionClick={handleSuggestionClick}
            activeSuggestionId={activeSuggestionId}
            countdown={countdown}
            isRecording={isRecording}
            status={isTranscribing ? "transcribing" : isSuggesting ? "generating" : "idle"}
          />
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <ChatPanel
            messages={chatMessages}
            onSend={handleChatSend}
            isLoading={isChatLoading}
          />
        </div>
      </main>

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        apiKey={apiKey}
        onApiKeyChange={setApiKey}
        settings={settings}
        onSettingsChange={setSettings}
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import { X, Settings, Eye, EyeOff, RotateCcw } from "lucide-react";
import type { AppSettings } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import clsx from "clsx";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  settings: AppSettings;
  onSettingsChange: (s: AppSettings) => void; // replaces the full settings object on every change
}

export function SettingsModal({ isOpen, onClose, apiKey, onApiKeyChange, settings, onSettingsChange }: Props) {
  const [showKey, setShowKey] = useState(false); // toggles API key between password and plain text
  const [tab, setTab] = useState<"api" | "prompts" | "context">("api"); // which tab is active

  // render nothing when closed — no portal needed since this mounts/unmounts cleanly
  if (!isOpen) return null;

  // generic field updater — spreads existing settings and overwrites just the changed key.
  // typed with keyof AppSettings so TypeScript catches any mismatched value types.
  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    onSettingsChange({ ...settings, [key]: value });
  }

  return (
    // full-screen backdrop — clicking the backdrop (not the modal) calls onClose
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* modal card — max 90vh so it scrolls on short screens instead of overflowing */}
      <div
        className="w-full max-w-2xl settings-modal animate-fade-in"
        style={{ maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        {/* header */}
        <div className="flex items-center justify-between px-6 py-5 header-glow">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, rgba(79,255,176,0.12), rgba(56,189,248,0.08))" }}>
              <Settings size={13} className="text-[var(--accent)]" />
            </div>
            <span className="font-display font-700 text-base tracking-tight text-[var(--text)]">Settings</span>
          </div>
          <button onClick={onClose} className="btn-ghost w-8 h-8 flex items-center justify-center">
            <X size={14} className="text-[var(--muted)]" />
          </button>
        </div>

        {/* tab bar — -mb-px on each button overlaps the border-bottom so active tab appears connected */}
        <div className="flex px-6 gap-1" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {(["api", "prompts", "context"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                "py-3 px-4 text-xs font-display font-600 tracking-widest uppercase -mb-px transition-colors relative",
                tab === t
                  ? "text-[var(--accent)] tab-active"
                  : "text-[var(--dim)] hover:text-[var(--muted)]"
              )}
            >
              {/* map internal key names to readable labels */}
              {t === "api" ? "API Key" : t === "prompts" ? "Prompts" : "Context"}
            </button>
          ))}
        </div>

        {/* scrollable tab content — flex-1 so it fills space between tabs and footer button */}
        <div className="overflow-y-auto flex-1 px-6 py-5">

          {/* ── API Key tab ── */}
          {tab === "api" && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-display font-600 tracking-widest uppercase text-[var(--muted)] mb-2.5">
                  Groq API Key
                </label>
                {/* password input with inline show/hide toggle button */}
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={e => onApiKeyChange(e.target.value)}
                    placeholder="gsk_..."
                    className="settings-input pr-10 font-mono text-sm"
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--dim)] hover:text-[var(--muted)] transition-colors"
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className="text-xs text-[var(--dim)] mt-2.5">
                  Get your key at{" "}
                  <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer"
                    className="text-[var(--accent)] hover:underline underline-offset-2">
                    console.groq.com
                  </a>
                  {/* reassure the user the key never leaves their device */}
                  . Stored only in your browser.
                </p>
              </div>

              {/* read-only model info panel — shows which models are in use */}
              <div className="rounded-xl p-4"
                style={{ background: "linear-gradient(135deg, rgba(79,255,176,0.04), rgba(56,189,248,0.03))", border: "1px solid rgba(79,255,176,0.08)" }}>
                <p className="text-xs font-display font-600 text-[var(--muted)] mb-2">Models Used</p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
                    <span className="font-mono text-xs text-[var(--dim)]">Transcription → whisper-large-v3</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--blue)" }} />
                    <span className="font-mono text-xs text-[var(--dim)]">Suggestions & Chat → openai/gpt-oss-120b</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Prompts tab ── */}
          {tab === "prompts" && (
            <div className="space-y-5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-[var(--dim)]">Edit prompts that drive AI responses.</p>
                {/* reset button restores only the three prompt fields, leaving other settings untouched */}
                <button
                  onClick={() => onSettingsChange({
                    ...settings,
                    suggestionPrompt: DEFAULT_SETTINGS.suggestionPrompt,
                    detailPrompt: DEFAULT_SETTINGS.detailPrompt,
                    chatPrompt: DEFAULT_SETTINGS.chatPrompt,
                  })}
                  className="flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
                >
                  <RotateCcw size={11} />
                  Reset all
                </button>
              </div>

              {/* render all three prompt textareas from a config array to avoid repetition.
                  rows prop sets the visible height — suggestion prompt is tallest (most complex). */}
              {([
                { key: "suggestionPrompt" as const, label: "Live Suggestion Prompt", rows: 10 },
                { key: "detailPrompt" as const, label: "Detail Answer Prompt", rows: 8 },
                { key: "chatPrompt" as const, label: "Chat System Prompt", rows: 5 },
              ]).map(({ key, label, rows }) => (
                <div key={key}>
                  <label className="block text-xs font-display font-600 tracking-widest uppercase text-[var(--muted)] mb-2">
                    {label}
                  </label>
                  <textarea
                    value={settings[key]}
                    onChange={e => update(key, e.target.value)}
                    rows={rows}
                    className="settings-input"
                  />
                </div>
              ))}
            </div>
          )}

          {/* ── Context tab ── */}
          {tab === "context" && (
            <div className="space-y-5">
              <p className="text-xs text-[var(--dim)]">Control how much transcript context is sent with each AI request.</p>

              {/* render all three numeric inputs from a config array.
                  min/max/step enforce sensible bounds — prevents e.g. 0-token context breaking the API call.
                  desc and default value shown below each input so users know what they're changing. */}
              {([
                { key: "suggestionContextTokens" as const, label: "Suggestion Context (tokens)", min: 200, max: 4000, step: 100, desc: "Recent transcript sent for suggestions" },
                { key: "detailContextTokens" as const, label: "Detail / Chat Context (tokens)", min: 500, max: 8000, step: 200, desc: "Full context sent for detail answers and chat" },
                { key: "refreshIntervalSeconds" as const, label: "Auto-Refresh Interval (sec)", min: 10, max: 120, step: 5, desc: "How often to auto-update transcript + suggestions" },
              ]).map(({ key, label, min, max, step, desc }) => (
                <div key={key}>
                  <label className="block text-xs font-display font-600 tracking-widest uppercase text-[var(--muted)] mb-2">
                    {label}
                  </label>
                  <input
                    type="number"
                    value={settings[key]}
                    onChange={e => update(key, parseInt(e.target.value) || 0)}
                    min={min} max={max} step={step}
                    className="settings-input"
                  />
                  {/* show the default value so users can tell how far they've deviated */}
                  <p className="text-xs text-[var(--dim)] mt-1.5">{desc}. Default: {DEFAULT_SETTINGS[key]}.</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* sticky footer — Save & Close writes nothing extra; all changes are live via onSettingsChange */}
        <div className="px-6 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={onClose} className="btn-gradient w-full py-3 font-display font-600 text-sm tracking-wide">
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
}

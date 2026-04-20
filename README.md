# TwinMind — Live Suggestions

An AI-powered meeting copilot that listens to live audio, transcribes it in real time, and surfaces 3 contextual suggestions every ~30 seconds. Clicking a suggestion streams a detailed answer into the chat panel.

## Live Demo

> **[AayushiW_TwinMind_Assignment.vercel.app](https://aayushiwtwinmindassignment.vercel.app/)** — paste your Groq API key in Settings to start

---

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, go to **Settings**, paste your [Groq API key](https://console.groq.com/keys), and click **Start Recording**.

No backend required. All API calls go directly from the browser to Groq.

---

## Stack

| Layer              | Choice                               | Why                                                                                  |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------------------ |
| Framework          | Next.js 14 (App Router)              | Easy Vercel deploy, no extra server needed                                           |
| Styling            | Tailwind CSS + CSS custom properties | Design tokens for dark/light mode, no runtime cost                                   |
| Transcription      | Groq — Whisper Large V3              | Required by spec. Fast and accurate                                                  |
| Suggestions + Chat | Groq — llama-3.3-70b-versatile       | Closest available model to the GPT-OSS 120B tier on Groq. ~200–400ms for suggestions |
| Audio capture      | Web MediaRecorder API                | Native browser, zero dependencies                                                    |
| State              | React `useState` + `useRef`          | No over-engineering — no Redux, no Zustand                                           |
| Persistence        | `localStorage`                       | API key and settings only. Session state is intentionally in-memory                  |

---

## Prompt Strategy

### Suggestion prompt

The suggestion prompt is the core of the product. The key decisions:

**Type taxonomy** — 5 types: `question`, `talking-point`, `answer`, `factcheck`, `clarify`. Enough to cover every meaningful meeting moment without giving the model too many choices. Each type has a clear trigger condition in the prompt so the model picks the right one situationally, not randomly.

**Recency over completeness** — only the most recent ~800 tokens (~3200 chars, tail of transcript) are sent. The model needs to react to what's happening _right now_, not summarize the whole meeting. Earlier context is background noise for suggestions.

**Word count as a signal** — the transcript word count is passed in the user message (`TRANSCRIPT (N words so far)`). This lets the model calibrate: early in the meeting it should surface broader exploratory suggestions; later it should go specific and in-the-weeds.

**Mix enforcement** — the prompt explicitly prohibits using the same type three times and requires at least one `answer` suggestion when a direct question was just asked. This was the hardest rule to get right — without it the model defaults to all `question` types regardless of context.

**Preview quality bar** — previews must be immediately actionable without clicking. The prompt instructs: reference a specific name, number, or claim from the transcript. Nothing generic. A suggestion that says "You might want to ask about their timeline" fails this bar. One that says "Ask why 6 weeks — industry standard for this scope is 2–3" passes it.

**Deduplication** — the previous batch's previews are passed in the user message as "do not repeat these." This prevents the model from surfacing the same talking points batch after batch when the transcript grows slowly.

**JSON-only output** — strict `[{type, preview}]` format. Markdown fences are stripped before parsing. Keeps the fast path clean.

### Detail prompt (on click)

When a suggestion card is clicked, the full transcript context (2000 tokens) is sent alongside the suggestion type and preview. The detail prompt is designed to give _actual depth_, not a longer version of the preview.

Type-specific format instructions are injected into the user message programmatically — not just mentioned in the system prompt — so the model applies them reliably:

| Type            | What the detail should do                                          |
| --------------- | ------------------------------------------------------------------ |
| `answer`        | Full answer immediately, then reasoning, then caveats              |
| `factcheck`     | Lead with the correction, explain why the original claim was wrong |
| `question`      | Explain what this question would reveal; strong vs weak answer     |
| `talking-point` | 2–3 supporting arguments + one concrete real-world example         |
| `clarify`       | State both interpretations; say which is more likely given context |

Detail responses stream token-by-token (same SSE pattern as chat) so the first word appears in ~200ms — no waiting for the full response to load.

### Chat prompt

Chat includes the full transcript as system context and the last 10 messages of conversation history. The prompt tells the model to lead with the answer (user is in an active meeting), reference specific things from the transcript, and stay under 150 words unless the question genuinely needs more.

Chat uses streaming throughout. First-token latency is ~200ms on Groq.

---

## Architecture

```
Browser
  ├── MediaRecorder → 1s blobs → flush every 30s
  │     └── Whisper Large V3 (Groq) → transcript chunk
  │
  ├── Suggestion engine (on each new chunk)
  │     ├── trimToTokens(transcript, 800) → tail context
  │     ├── + previousPreviews for dedup
  │     └── llama-3.3-70b → JSON[3 suggestions]
  │
  └── Chat / Detail panel
        ├── streamDetailResponse → SSE generator → token-by-token
        └── streamChatResponse   → SSE generator → token-by-token
```

**Key decisions:**

- **No backend proxy** — API calls go browser → Groq directly. Keeps latency low and deployment trivial. The tradeoff is the API key lives in localStorage, which is acceptable for a personal tool but not a multi-user product.

- **Ref-based suggestion lock** — `isSuggestingRef` (not state) guards against duplicate suggestion calls. React state batching means a state-based guard can fail across async boundaries; a ref is synchronous and reliable.

- **Pending refresh pattern** — manual Refresh flushes audio and sets `pendingRefreshRef = true`. Suggestions run only after the transcription callback fires with the new chunk — not after a hardcoded timeout. This means suggestions always reflect the latest audio.

- **`requestData()` before flush** — called on the MediaRecorder before building the Blob to force any buffered audio to emit via `ondataavailable`. Without this, the last ~1s of audio can be silently dropped.

- **Suggestion caching** — completed detail text is stored on the suggestion object in state. Re-clicking the same card replays instantly from cache with no API call.

- **Streaming for detail** — `streamDetailResponse` and `streamChatResponse` are both `AsyncGenerator<string>` functions using the same SSE reader loop. The suggestion click handler and the chat send handler are structurally identical — same `for await` pattern, same per-delta state update.

---

## Settings (all editable in-app)

| Setting            | Default            | What it controls                                         |
| ------------------ | ------------------ | -------------------------------------------------------- |
| Refresh interval   | 30s                | How often audio is flushed and suggestions regenerated   |
| Suggestion context | 800 tokens         | How much transcript tail is sent to the suggestion model |
| Detail context     | 2000 tokens        | How much transcript is sent when a suggestion is clicked |
| Suggestion prompt  | See `lib/types.ts` | Full system prompt for suggestion generation             |
| Detail prompt      | See `lib/types.ts` | System prompt for on-click detail responses              |
| Chat prompt        | See `lib/types.ts` | System prompt for freeform chat                          |

---

## Tradeoffs

**No persistence on reload** — session state (transcript, suggestions, chat) lives in memory only. The assignment didn't require persistence, and adding a database would be over-engineering for this scope.

**English-only transcription** — `language: "en"` is hardcoded in the Whisper call. Removing this line makes Whisper auto-detect language, but adds ~100ms latency.

**No speaker diarization** — Whisper doesn't distinguish speakers. The transcript is a single stream of text. For a production copilot this would be the next thing to add.

**localStorage for API key** — fine for a personal tool, not appropriate for a shared deployment. A production version would use a server-side proxy with user auth.

**30s suggestion window** — suggestions fire on each audio chunk (~30s). A tighter loop (10s) would feel more responsive but triple the API cost and risk rate limits.

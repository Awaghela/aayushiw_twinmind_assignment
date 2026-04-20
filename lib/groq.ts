import type { Suggestion, AppSettings, SuggestionType } from "./types";

const GROQ_BASE = "https://api.groq.com/openai/v1";
const CHAT_MODEL = "openai/gpt-oss-120b";

// keeps the transcript within the token budget by taking the tail (most recent content).
// recency matters more than completeness — suggestions should react to what's happening now,
// not summarise the whole meeting. 1 token ≈ 4 chars is a rough but reliable approximation.
function trimToTokens(text: string, approxTokens: number): string {
  const maxChars = approxTokens * 4;
  if (text.length <= maxChars) return text;
  return "...[earlier context truncated]...\n" + text.slice(-maxChars);
}

// injected into the user message for streamDetailResponse so the model gives the right
// kind of depth per type — not just a longer preview, but a structurally different response.
// placed in the user message (not only the system prompt) because models apply
// per-request instructions more reliably when they appear close to the actual request.
const TYPE_INSTRUCTIONS: Record<string, string> = {
  factcheck: "Correct any inaccuracies directly. Lead with the truth, then explain why the original claim was wrong or misleading.",
  answer: "Give the full answer immediately. Then explain the reasoning. Note any important caveats.",
  question: "Explain what this question would reveal. Describe what a strong vs. weak answer looks like.",
  "talking-point": "Give 2-3 supporting arguments plus one concrete real-world example.",
  clarify: "State the two possible interpretations clearly. Say which is more likely given the transcript context and why.",
};

// maps HTTP status codes to actionable messages the user can act on immediately.
// raw API error bodies are often verbose JSON blobs — this surfaces only what matters.
function getApiErrorMessage(status: number, body: string): string {
  if (status === 401) return "Invalid API key — check Settings and paste a valid Groq key.";
  if (status === 429) return "Rate limited by Groq — wait a moment and try again.";
  if (status === 503 || status === 502) return "Groq is temporarily unavailable — try again shortly.";
  return `API error ${status}: ${body}`;
}

// sends a ~30s audio blob to Whisper and returns the transcribed text.
// language is hardcoded to "en" — removing it enables auto-detect but adds ~100ms latency.
// response_format "text" returns a plain string instead of a JSON object, keeping parsing trivial.
export async function transcribeAudio(
  apiKey: string,
  audioBlob: Blob
): Promise<string> {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.webm");
  formData.append("model", "whisper-large-v3");
  formData.append("response_format", "text"); // plain string response — no JSON parsing needed
  formData.append("language", "en");

  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(getApiErrorMessage(res.status, body));
  }

  const text = await res.text();
  return text.trim(); // Whisper sometimes returns trailing whitespace or newlines
}

// generates exactly 3 suggestions from the current transcript tail.
// previousPreviews are passed in the user message so the model doesn't repeat
// the same talking points when the transcript hasn't changed much between refreshes.
// wordCount is included so the model calibrates depth: early meeting = broad suggestions,
// later in the meeting = specific, in-the-weeds suggestions.
export async function generateSuggestions(
  apiKey: string,
  transcript: string,
  settings: AppSettings,
  previousPreviews: string[] = []
): Promise<Suggestion[]> {
  const context = trimToTokens(transcript, settings.suggestionContextTokens);
  const wordCount = transcript.split(" ").filter(Boolean).length;

  // only added when there are prior suggestions — keeps the prompt clean on the first call
  const dedupeNote =
    previousPreviews.length > 0
      ? `\n\nPREVIOUS SUGGESTIONS (do not repeat these — generate fresh ones):\n${previousPreviews.map((p) => `- ${p}`).join("\n")}`
      : "";

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      max_tokens: 350, // 3 suggestions at ~100 tokens each — tight budget keeps latency low
      temperature: 0.7, // some variation so batches don't feel repetitive
      stream: false, // must be false — res.json() cannot parse an SSE stream
      messages: [
        {
          role: "system",
          content: settings.suggestionPrompt,
        },
        {
          role: "user",
          content: `TRANSCRIPT (${wordCount} words so far):\n${context || "(no transcript yet — meeting just started)"}${dedupeNote}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(getApiErrorMessage(res.status, body));
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "[]"; // default to empty array if model returns nothing

  let parsed: { type: SuggestionType; preview: string }[] = [];
  try {
    // model occasionally wraps the JSON in ```json fences despite being told not to — strip them
    const clean = raw.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(clean);
  } catch {
    console.error("Failed to parse suggestions JSON:", raw);
    return []; // return empty rather than crash — panel stays blank until next refresh
  }

  // slice(0, 3) guards against the model returning more than 3 items despite the prompt
  return parsed.slice(0, 3).map((s, i) => ({
    id: `${Date.now()}-${i}`, // timestamp prefix makes IDs unique across batches
    type: (s.type as SuggestionType) || "question", // fallback if model returns an unknown type
    preview: s.preview || "",
  }));
}

// streams a detailed response for a clicked suggestion token-by-token.
// uses a larger context window than suggestions (detailContextTokens) since the user
// clicked for depth — they can handle more transcript context here.
// TYPE_INSTRUCTIONS is appended to the user message so the model structures the response
// correctly for the specific suggestion type (factcheck vs answer vs clarify etc.)
export async function* streamDetailResponse(
  apiKey: string,
  suggestion: { type: string; preview: string },
  transcript: string,
  settings: AppSettings
): AsyncGenerator<string> {
  const context = trimToTokens(transcript, settings.detailContextTokens);

  // fallback instruction for any type not in TYPE_INSTRUCTIONS (shouldn't happen in practice)
  const typeInstruction =
    TYPE_INSTRUCTIONS[suggestion.type] ??
    "Give a detailed, actionable response specific to what was said.";

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      max_tokens: 800,
      temperature: 0.5, // lower than suggestions — detail responses should be precise, not creative
      stream: true,
      messages: [
        { role: "system", content: settings.detailPrompt },
        {
          role: "user",
          content: `TRANSCRIPT:\n${context}\n\nSUGGESTION CLICKED:\n[${suggestion.type.toUpperCase()}] ${suggestion.preview}\n\nRESPONSE FORMAT FOR THIS TYPE: ${typeInstruction}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(getApiErrorMessage(res.status, body));
  }

  // SSE reader — Groq streams responses as "data: {...}\n" lines.
  // each chunk from the reader may contain multiple lines, so we split and filter.
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

    for (const line of lines) {
      const data = line.slice(6); // strip the "data: " prefix
      if (data === "[DONE]") return; // Groq signals end of stream with this sentinel
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta; // yield each text token to the caller as it arrives
      } catch {
        // malformed chunks can occur at network boundaries — safe to skip
      }
    }
  }
}

// streams a freeform chat response using the full transcript as context.
// includes the last 10 messages of chat history so the model maintains conversational
// coherence without blowing up the context window with the full history.
export async function* streamChatResponse(
  apiKey: string,
  userMessage: string,
  transcript: string,
  chatHistory: { role: "user" | "assistant"; content: string }[],
  settings: AppSettings
): AsyncGenerator<string> {
  const context = trimToTokens(transcript, settings.detailContextTokens);

  // transcript is appended to the system prompt so the model always has meeting context,
  // even when the user asks a follow-up question with no explicit transcript reference
  const messages = [
    {
      role: "system" as const,
      content:
        settings.chatPrompt +
        `\n\nCURRENT TRANSCRIPT:\n${context || "(no transcript yet)"}`,
    },
    ...chatHistory.slice(-10), // last 10 keeps context manageable without losing conversational thread
    { role: "user" as const, content: userMessage },
  ];

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      max_tokens: 1000,
      temperature: 0.6,
      stream: true,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(getApiErrorMessage(res.status, body));
  }

  // identical SSE reader pattern to streamDetailResponse
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

    for (const line of lines) {
      const data = line.slice(6);
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
      }
    }
  }
}
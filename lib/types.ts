export type SuggestionType =
  | "question"      // a question worth asking the speaker
  | "talking-point" // a relevant point that hasn't been raised yet
  | "answer"        // a direct answer to a question just asked
  | "factcheck"     // a claim or number that seems worth verifying
  | "clarify";      // something said that could mean two different things

export interface Suggestion {
  id: string;
  type: SuggestionType;
  preview: string;   // shown on the card — must be useful without clicking
  detail?: string;   // populated after the card is clicked; undefined until then
  loading?: boolean; // true while the detail is streaming in — shows pulsing dots
}

// one batch = one generation call = 3 suggestions produced at the same moment.
// batches are stored newest-first so the latest always appears at the top of the panel.
export interface SuggestionBatch {
  id: string;
  timestamp: number;
  suggestions: Suggestion[];
  transcriptSnapshot: string; // the transcript text that was sent when this batch was generated
}

// one chunk = one ~30s audio flush that was transcribed by Whisper.
// chunks are appended in order and joined with newlines to form the full transcript.
export interface TranscriptChunk {
  id: string;
  timestamp: number; // when the audio was flushed — shown as the chunk's time label
  text: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  loading?: boolean; // true from when the message is added until the first streaming token arrives
}

export interface AppSettings {
  suggestionPrompt: string;      // system prompt sent with every suggestion generation call
  detailPrompt: string;          // system prompt sent when a suggestion card is clicked
  chatPrompt: string;            // system prompt sent with every freeform chat message
  suggestionContextTokens: number; // how many tokens of transcript tail to send for suggestions (default 800)
  detailContextTokens: number;     // how many tokens of transcript tail to send for detail + chat (default 2000)
  refreshIntervalSeconds: number;  // how often audio is flushed and suggestions regenerated (default 30)
}

// hardcoded defaults — loaded on first visit before any user changes are saved to localStorage.
// prompts are the core of the product; the decisions behind them are documented in README.md.
export const DEFAULT_SETTINGS: AppSettings = {
  refreshIntervalSeconds: 30,
  suggestionContextTokens: 800,  // ~3200 chars — enough for the last few minutes of conversation
  detailContextTokens: 2000,     // ~8000 chars — more context for deeper answers on click

  // instructs the model to pick the right suggestion type based on what just happened,
  // enforce mix (no three of the same type), reference specific things from the transcript,
  // and return a strict JSON array so parsing is reliable
  suggestionPrompt: `You are a real-time meeting copilot. Your job is to surface the 3 most useful things the listener could do or say right now, based on what was just said.

Read the transcript carefully. Focus on the final few exchanges — that's where the conversation is. Earlier context is background only.

Pick the suggestion type that fits what just happened:
- "question" — if the topic needs probing or the speaker made an assumption worth challenging
- "talking-point" — if there's a strong relevant point that hasn't been raised yet
- "answer" — if a question was just asked and you know a good answer
- "factcheck" — if a specific claim or number was stated that seems worth verifying
- "clarify" — if something was said that could mean two different things

A few things that matter:
- If a direct question was just asked, at least one suggestion should be an "answer"
- Don't repeat the same type three times
- Every suggestion must name something specific from the transcript — a person, a number, a claim. Nothing generic.
- The preview should be useful on its own. Someone should be able to read it and immediately know what to do or say, without needing to click for more.
- Write like a smart colleague texting you during the meeting, not like a corporate assistant.

Return only a JSON array with exactly 3 items. No other text:
[
  { "type": "...", "preview": "..." },
  { "type": "...", "preview": "..." },
  { "type": "...", "preview": "..." }
]`,

  // instructs the model to give actual depth (not a longer preview), reference specific
  // transcript content, and close with one concrete next action.
  // type-specific depth instructions are injected at call time via TYPE_INSTRUCTIONS in groq.ts
  detailPrompt: `The user clicked on a suggestion mid-conversation. Give them the full picture  not a longer version of the preview, but actual depth.

Get to the point immediately. No "Great question!" or "Based on the transcript...". Just the answer.

Be specific to what's in the transcript. Reference the actual names, claims, or numbers that were mentioned. If you're adding outside knowledge, make it feel naturally integrated, not bolted on.

Format for scannability: bold the key terms, use a short bullet list if there are multiple distinct points, but don't over-structure a simple answer.

Close with one concrete thing the user can do or say next — a follow-up question, a specific action, a number to look up.

Adjust depth by type:
- answer: full explanation with reasoning, note any caveats
- question: explain what this question would reveal and what a strong vs weak answer looks like
- factcheck: correct the record clearly, explain why the original claim was wrong or misleading
- talking-point: give it teeth — 2-3 supporting arguments plus one real-world example
- clarify: say exactly what's ambiguous and what the two possible interpretations are`,

  // instructs the model to lead with the answer (user is in an active meeting),
  // reference transcript content specifically, and stay concise (under 150 words)
  chatPrompt: `You are TwinMind, a meeting copilot with access to everything said in this conversation so far.

Answer questions directly. The user is in an active meeting — they don't have time for preamble. Lead with the answer, then the reasoning if needed.

Use the transcript as your primary source. When you reference something from it, be specific — quote or paraphrase the actual thing that was said. If the answer isn't in the transcript, draw on general knowledge and keep it brief.

Format: bold key terms, bullets for 3+ items, plain prose for everything else. Stay under 150 words unless the question genuinely needs more. If asked to summarize, use bullet points with times.`,
};
import type { TranscriptChunk, SuggestionBatch, ChatMessage } from "./types";

export type ExportFormat = "json" | "text";

// serialises the full session — transcript chunks, every suggestion batch, and chat history —
// into either a structured JSON file or a human readable plain text file, then triggers a download.
export function exportSession(
  chunks: TranscriptChunk[],
  batches: SuggestionBatch[],
  messages: ChatMessage[],
  format: ExportFormat = "json"
) {
  const timestamp = new Date().toISOString(); // single timestamp for the export, not per-item

  if (format === "json") {
    const data = {
      exported_at: timestamp,
      // unix timestamps converted to ISO strings so the JSON is human-readable and unambiguous
      transcript: chunks.map((c) => ({
        timestamp: new Date(c.timestamp).toISOString(),
        text: c.text,
      })),
      suggestion_batches: batches.map((b) => ({
        timestamp: new Date(b.timestamp).toISOString(),
        suggestions: b.suggestions.map((s) => ({
          type: s.type,
          preview: s.preview,
          detail: s.detail, // undefined if the card was never clicked — omitted from JSON output
        })),
      })),
      chat_history: messages.map((m) => ({
        timestamp: new Date(m.timestamp).toISOString(),
        role: m.role,
        content: m.content,
      })),
    };

    // null, 2 gives readable indentation — this file is read by evaluators, not just machines
    downloadFile(
      JSON.stringify(data, null, 2),
      `twinmind-session-${Date.now()}.json`,
      "application/json"
    );
    return;
  }

  // plain text format — three sections separated by dividers, readable without tooling
  const lines: string[] = [
    "TWINMIND SESSION EXPORT",
    `Exported: ${timestamp}`,
    "=".repeat(60),
    "",
    "TRANSCRIPT",
    "-".repeat(40),
  ];

  // each chunk gets a timestamp header and a blank line after for readability
  chunks.forEach((c) => {
    lines.push(`[${new Date(c.timestamp).toLocaleTimeString()}]`);
    lines.push(c.text);
    lines.push("");
  });

  lines.push("", "SUGGESTION BATCHES", "-".repeat(40));

  batches.forEach((b, i) => {
    lines.push(`\nBatch ${i + 1} — ${new Date(b.timestamp).toLocaleTimeString()}`);
    b.suggestions.forEach((s, j) => {
      lines.push(`  ${j + 1}. [${s.type.toUpperCase()}] ${s.preview}`);
      // detail is only included if the card was clicked — indented to sit under its suggestion
      if (s.detail) lines.push(`     Detail: ${s.detail.replace(/\n/g, "\n     ")}`);
      //                                       ↑ indent continuation lines so detail stays visually grouped
    });
  });

  lines.push("", "CHAT HISTORY", "-".repeat(40));

  messages.forEach((m) => {
    lines.push(`\n[${new Date(m.timestamp).toLocaleTimeString()}] ${m.role.toUpperCase()}`);
    lines.push(m.content);
  });

  downloadFile(
    lines.join("\n"),
    `twinmind-session-${Date.now()}.txt`,
    "text/plain"
  );
}

// creates a temporary object URL, clicks a hidden anchor to trigger the browser's
// save dialog, then immediately revokes the URL to free memory.
// no server required — the file is generated entirely in the browser.
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob); // temporary in-memory URL valid only for this session
  const link = document.createElement("a");
  link.href = url;
  link.download = filename; // tells the browser to download rather than navigate to the URL
  link.click();
  URL.revokeObjectURL(url); // release memory — the download is already queued by this point
}
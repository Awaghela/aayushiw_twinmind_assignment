"use client";

import React, { useRef, useEffect, useState, KeyboardEvent } from "react";
import { Send, MessageSquare, Bot, User } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import clsx from "clsx";

interface Props {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  isLoading: boolean; // true while a streaming response is in flight — disables send button
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";

  // splits on **bold** and `code` tokens — everything else passes through as plain text
  function renderInline(text: string) {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((p, i) => {
      if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
      if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
      return <span key={i}>{p}</span>;
    });
  }

  // renders markdown line-by-line: ## headings, - bullets, 1. numbered lists, blank spacers, plain text
  function renderContent(text: string) {
    const lines = text.split("\n");
    const elements: React.ReactNode[] = [];
    let key = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart(); // trimStart lets indented lines still match patterns

      if (trimmed.startsWith("### ")) {
        elements.push(<p key={key++} className="text-[13px] font-semibold text-[var(--text)] mt-3 mb-1">{renderInline(trimmed.slice(4))}</p>);
        continue;
      }
      if (trimmed.startsWith("## ")) {
        elements.push(<p key={key++} className="text-[14px] font-semibold text-[var(--text)] mt-3 mb-1">{renderInline(trimmed.slice(3))}</p>);
        continue;
      }
      if (trimmed.startsWith("- ") || trimmed.startsWith("\u2022 ")) {
        elements.push(
          <span key={key++} className="block pl-3 relative before:content-[\'\u2022\'] before:absolute before:left-0 before:text-[var(--accent)] mb-0.5">
            {renderInline(trimmed.replace(/^[-\u2022]\s*/, ""))}
          </span>
        );
        continue;
      }
      // capture digit so "1." "2." "3." render in order, not as generic bullets
      const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
      if (numberedMatch) {
        elements.push(
          // flex keeps number and text cleanly separated — absolute positioning caused overlap
          <span key={key++} className="flex gap-2 mb-0.5">
            <span className="text-[var(--accent)] font-mono text-[12px] shrink-0 mt-0.5">{numberedMatch[1]}.</span>
            <span>{renderInline(numberedMatch[2])}</span>
          </span>
        );
        continue;
      }
      // only add spacer after a non-empty line — prevents double-spacing at message start
      if (trimmed === "") {
        if (i > 0 && lines[i - 1].trim() !== "") elements.push(<div key={key++} className="h-2" />);
        continue;
      }
      elements.push(<span key={key++} className="block leading-relaxed">{renderInline(line)}</span>);
    }
    return elements;
  }

  return (
    <div className={clsx("chat-msg flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div className={clsx(
        "w-8 h-8 rounded-xl shrink-0 flex items-center justify-center mt-0.5",
        isUser
          ? "border border-[rgba(79,255,176,0.15)]"
          : "border border-[rgba(255,255,255,0.06)]"
      )}
        style={{
          background: isUser
            ? "linear-gradient(135deg, rgba(79,255,176,0.12), rgba(56,189,248,0.08))"
            : "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))"
        }}
      >
        {isUser
          ? <User size={13} className="text-[var(--accent)]" />
          : <Bot size={13} className="text-[var(--muted)]" />
        }
      </div>

      <div className={clsx("flex flex-col gap-1.5 max-w-[85%]", isUser && "items-end")}>
        <div className={clsx(
          "px-4 py-3 text-[15px] leading-relaxed chat-prose",
          isUser ? "msg-user" : "msg-assistant"
        )}>
          {/* loading is true from when the message is added until the first streaming token arrives */}
          {msg.loading ? (
            <span className="flex items-center gap-2 text-[var(--muted)]">
              <span className="inline-flex gap-1">
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full animate-pulse2"
                    style={{
                      animationDelay: `${i * 0.2}s`, // stagger so dots pulse sequentially
                      background: "var(--gradient-main)",
                      backgroundSize: "200% 200%",
                    }}
                  />
                ))}
              </span>
            </span>
          ) : (
            renderContent(msg.content)
          )}
        </div>
        <span className="text-[10px] font-mono text-[var(--dim)] px-1">
          {formatTime(msg.timestamp)}
        </span>
      </div>
    </div>
  );
}

export function ChatPanel({ messages, onSend, isLoading }: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null); // scroll anchor — always sits after the last message
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // scroll to latest message on every update — fires on new messages and on streaming deltas
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    onSend(text);
    if (textareaRef.current) textareaRef.current.style.height = "auto"; // reset height after send
  }

  // Enter sends; Shift+Enter inserts a newline
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // grows textarea to fit content as user types, capped at 120px (~5 lines)
  function handleInput() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto"; // reset first so scrollHeight reflects true content height
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  return (
    <div className="flex flex-col h-full relative z-10">
      <div className="flex items-center gap-2.5 px-5 py-4 header-glow">
        <div className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, rgba(167,139,250,0.12), rgba(56,189,248,0.08))" }}>
          <MessageSquare size={11} className="text-[var(--purple)]" />
        </div>
        <span className="font-display font-700 text-base tracking-widest uppercase text-[var(--muted)]">
          Chat
        </span>
        <span className="font-mono text-[11px] text-[var(--dim)] ml-auto">
          {messages.length} msg{messages.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="empty-state-icon"
              style={{ background: "linear-gradient(135deg, rgba(167,139,250,0.08), rgba(56,189,248,0.06))" }}>
              <MessageSquare size={22} className="text-[var(--purple)]" style={{ opacity: 0.6 }} />
            </div>
            <div>
              <p className="text-base font-500 text-[var(--muted)]">No messages yet</p>
              <p className="text-sm text-[var(--dim)] mt-1.5">
                Click a suggestion or type a question
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 py-4">
        <div className="chat-input-wrapper flex items-end gap-2 px-3.5 py-2.5">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); handleInput(); }}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about the conversation…"
            rows={1} // starts as single line; handleInput grows it as needed
            className="flex-1 bg-transparent text-[15px] text-[var(--text)] placeholder:text-[var(--dim)] outline-none resize-none py-1 leading-relaxed font-light"
            style={{ minHeight: "24px", maxHeight: "120px" }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading} // disabled when empty or while response is streaming
            className="send-btn w-8 h-8 flex items-center justify-center shrink-0 mb-0.5"
          >
            <Send size={13} />
          </button>
        </div>
        <p className="text-[10px] font-mono text-[var(--dim)] mt-2.5 text-center">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

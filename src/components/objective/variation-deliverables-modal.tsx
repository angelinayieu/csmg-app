"use client";

// ── Variation Deliverables Modal ──────────────────────────────────
//
// Phase 12 + 13 — a single modal surface that bundles the two
// "take this variation outside the canvas" deliverables:
//
//   1. HTML mockup (Phase 12) — what the interface might look like,
//      rendered in a sandboxed iframe via srcdoc.
//   2. Export Prompt (Phase 13) — a ready-to-paste markdown prompt
//      the user hands to ChatGPT/Claude/Cursor to bootstrap
//      implementation. Single copy button.
//
// Mounted from VariationCard's "Deliverables" pill on elected
// variations. Two tabs — Mockup | Prompt — so the user can flip
// between them without losing scroll position on either.
//
// Generation is lazy + on-demand: hitting the tab fires the route
// if the variation doesn't already have the artifact cached. The
// LLM calls live behind /api/brainstorm/item/variation/mockup and
// /export-prompt; both routes persist results so subsequent opens
// are instant.

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Copy, Loader2, RefreshCw, X } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

type Tab = "mockup" | "prompt";

interface Props {
  open: boolean;
  onClose: () => void;
  entityId: string;
  variationId: string;
  variationName: string;
  /** Initial cached values. The modal will hit the route only when
   *  the user lands on a tab with an empty value. */
  initialMockupHtml?: string;
  initialExportPrompt?: string;
}

export function VariationDeliverablesModal({
  open,
  onClose,
  entityId,
  variationId,
  variationName,
  initialMockupHtml,
  initialExportPrompt,
}: Props) {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<Tab>("mockup");
  const [mockupHtml, setMockupHtml] = useState<string>(initialMockupHtml ?? "");
  const [mockupBusy, setMockupBusy] = useState(false);
  const [mockupError, setMockupError] = useState<string | null>(null);
  const [exportPrompt, setExportPrompt] = useState<string>(
    initialExportPrompt ?? "",
  );
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchMockup = useCallback(
    async (force = false) => {
      setMockupBusy(true);
      setMockupError(null);
      try {
        const res = await fetch(
          "/api/brainstorm/item/variation/mockup",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              entityId,
              variationId,
              mode: force ? "force" : "default",
            }),
          },
        );
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          mockup_html?: string;
        };
        if (!res.ok) {
          setMockupError(j.error ?? "Mockup generation failed.");
          return;
        }
        if (typeof j.mockup_html === "string") setMockupHtml(j.mockup_html);
      } catch (err) {
        setMockupError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setMockupBusy(false);
      }
    },
    [entityId, variationId],
  );

  const fetchPrompt = useCallback(
    async (force = false) => {
      setPromptBusy(true);
      setPromptError(null);
      try {
        const res = await fetch(
          "/api/brainstorm/item/variation/export-prompt",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              entityId,
              variationId,
              mode: force ? "force" : "default",
            }),
          },
        );
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          export_prompt?: string;
        };
        if (!res.ok) {
          setPromptError(j.error ?? "Prompt generation failed.");
          return;
        }
        if (typeof j.export_prompt === "string")
          setExportPrompt(j.export_prompt);
      } catch (err) {
        setPromptError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setPromptBusy(false);
      }
    },
    [entityId, variationId],
  );

  // Lazy-fetch the active tab's artifact when it's empty.
  useEffect(() => {
    if (!open) return;
    if (tab === "mockup" && !mockupHtml && !mockupBusy && !mockupError) {
      void fetchMockup(false);
    }
    if (tab === "prompt" && !exportPrompt && !promptBusy && !promptError) {
      void fetchPrompt(false);
    }
  }, [
    open,
    tab,
    mockupHtml,
    mockupBusy,
    mockupError,
    exportPrompt,
    promptBusy,
    promptError,
    fetchMockup,
    fetchPrompt,
  ]);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const copyPrompt = useCallback(async () => {
    if (!exportPrompt) return;
    try {
      await navigator.clipboard.writeText(exportPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Soft-fail — clipboard can be blocked in some contexts.
    }
  }, [exportPrompt]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-50"
            style={{ background: "rgba(11,18,40,0.42)" }}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-label="Variation deliverables"
            initial={
              reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.985 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(960px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden"
            style={{
              background: appleVibe.surface.card,
              borderRadius: appleVibe.radius.xl,
              border: `1px solid ${appleVibe.stroke.hairline}`,
              boxShadow: "0 30px 60px -20px rgba(11,18,40,0.45)",
              fontFamily: appleVibe.font.stack,
            }}
          >
            <header
              className="flex items-center justify-between gap-3 px-5 py-4"
              style={{ borderBottom: `1px solid ${appleVibe.stroke.hairline}` }}
            >
              <div className="min-w-0 flex-1">
                <div
                  className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  Deliverables · {variationName}
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <TabPill
                    label="Mockup"
                    active={tab === "mockup"}
                    onClick={() => setTab("mockup")}
                  />
                  <TabPill
                    label="Export Prompt"
                    active={tab === "prompt"}
                    onClick={() => setTab("prompt")}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[rgba(15,23,42,0.04)]"
                aria-label="Close"
                style={{ color: appleVibe.text.secondary }}
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {tab === "mockup" && (
                <MockupTab
                  html={mockupHtml}
                  busy={mockupBusy}
                  error={mockupError}
                  onRegenerate={() => void fetchMockup(true)}
                />
              )}
              {tab === "prompt" && (
                <PromptTab
                  prompt={exportPrompt}
                  busy={promptBusy}
                  error={promptError}
                  copied={copied}
                  onCopy={copyPrompt}
                  onRegenerate={() => void fetchPrompt(true)}
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function TabPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center transition-[background,color] duration-150 ease-out"
      style={{
        background: active ? appleVibe.accent.primary : "transparent",
        color: active ? appleVibe.text.onAccent : appleVibe.text.secondary,
        border: `1px solid ${active ? appleVibe.accent.primary : appleVibe.stroke.medium}`,
        borderRadius: appleVibe.radius.pill,
        padding: "3px 10px",
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      {label}
    </button>
  );
}

function MockupTab({
  html,
  busy,
  error,
  onRegenerate,
}: {
  html: string;
  busy: boolean;
  error: string | null;
  onRegenerate: () => void;
}) {
  if (busy && !html) {
    return (
      <div className="flex h-[60vh] items-center justify-center gap-2">
        <Loader2
          className="h-4 w-4 animate-spin"
          style={{ color: appleVibe.text.tertiary }}
        />
        <span
          className="text-[12px] font-light italic"
          style={{ color: appleVibe.text.tertiary }}
        >
          Generating mockup… this takes ~10-20 seconds.
        </span>
      </div>
    );
  }
  if (error && !html) {
    return (
      <div className="px-3 py-4">
        <p
          className="mb-2 text-[12px]"
          style={{ color: "rgba(127,29,29,0.95)" }}
        >
          {error}
        </p>
        <button
          type="button"
          onClick={onRegenerate}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold"
          style={{
            background: appleVibe.accent.primary,
            color: appleVibe.text.onAccent,
          }}
        >
          <RefreshCw className="h-3 w-3" strokeWidth={2.4} />
          Retry
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-[60vh] flex-col gap-2">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onRegenerate}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-medium transition-opacity disabled:opacity-50"
          style={{
            color: appleVibe.text.tertiary,
            border: `1px solid ${appleVibe.stroke.medium}`,
          }}
        >
          {busy ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={2.4} />
          ) : (
            <RefreshCw className="h-2.5 w-2.5" strokeWidth={2.4} />
          )}
          Regenerate
        </button>
      </div>
      {/* Sandboxed iframe — sandbox="" denies ALL capabilities so
          even if a script slipped past the server sanitizer it
          can't run, fetch, or navigate. srcDoc renders the inline
          HTML without a network round trip. */}
      <iframe
        title="Variation mockup"
        srcDoc={html}
        sandbox=""
        className="h-full w-full rounded-2xl"
        style={{
          background: "#ffffff",
          border: `1px solid ${appleVibe.stroke.hairline}`,
        }}
      />
    </div>
  );
}

function PromptTab({
  prompt,
  busy,
  error,
  copied,
  onCopy,
  onRegenerate,
}: {
  prompt: string;
  busy: boolean;
  error: string | null;
  copied: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
}) {
  if (busy && !prompt) {
    return (
      <div className="flex h-[60vh] items-center justify-center gap-2">
        <Loader2
          className="h-4 w-4 animate-spin"
          style={{ color: appleVibe.text.tertiary }}
        />
        <span
          className="text-[12px] font-light italic"
          style={{ color: appleVibe.text.tertiary }}
        >
          Composing prompt…
        </span>
      </div>
    );
  }
  if (error && !prompt) {
    return (
      <div className="px-3 py-4">
        <p
          className="mb-2 text-[12px]"
          style={{ color: "rgba(127,29,29,0.95)" }}
        >
          {error}
        </p>
        <button
          type="button"
          onClick={onRegenerate}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold"
          style={{
            background: appleVibe.accent.primary,
            color: appleVibe.text.onAccent,
          }}
        >
          <RefreshCw className="h-3 w-3" strokeWidth={2.4} />
          Retry
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-[60vh] flex-col gap-2">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-medium transition-opacity"
          style={{
            background: copied
              ? `${appleVibe.stage.outcomes}14`
              : appleVibe.surface.card,
            color: copied ? appleVibe.stage.outcomes : appleVibe.text.secondary,
            border: `1px solid ${copied ? appleVibe.stage.outcomes : appleVibe.stroke.medium}`,
          }}
        >
          {copied ? (
            <Check className="h-2.5 w-2.5" strokeWidth={2.4} />
          ) : (
            <Copy className="h-2.5 w-2.5" strokeWidth={2.4} />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-medium transition-opacity disabled:opacity-50"
          style={{
            color: appleVibe.text.tertiary,
            border: `1px solid ${appleVibe.stroke.medium}`,
          }}
        >
          {busy ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={2.4} />
          ) : (
            <RefreshCw className="h-2.5 w-2.5" strokeWidth={2.4} />
          )}
          Regenerate
        </button>
      </div>
      <pre
        className="h-full w-full overflow-auto whitespace-pre-wrap rounded-2xl px-4 py-3 text-[12px] leading-snug"
        style={{
          background: appleVibe.surface.cardElevated,
          border: `1px solid ${appleVibe.stroke.hairline}`,
          fontFamily: appleVibe.font.stack,
          color: appleVibe.text.primary,
        }}
      >
        {prompt}
      </pre>
    </div>
  );
}

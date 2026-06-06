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
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  ChevronDown,
  Copy,
  FileText,
  Layout,
  Loader2,
  RefreshCw,
  Wand2,
  X,
} from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe, withAlpha } from "@/lib/apple-vibe-tokens";

type Tab = "doc" | "mockup" | "prompt";

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
  /** Op A — cached PR/FAQ description doc when previously generated. */
  initialDescriptionDoc?: string;
  /** Op B — cached round-trip optimization history when present. */
  initialExportPromptHistory?: PromptHistory;
}

/** Op B — round-trip history shape; mirrors the server's
 *  RoundTripResult so we can render it without parsing. */
export interface PromptHistory {
  prompt_v1: string;
  preview_v1: {
    output: string;
    judge_score: number;
    judge_verdict: "ship" | "revise";
    judge_critique: string;
  };
  prompt_v2?: string;
  preview_v2?: {
    output: string;
    judge_score: number;
    judge_verdict: "ship" | "revise";
    judge_critique: string;
  };
  final_prompt: string;
  iterations: number;
}

export function VariationDeliverablesModal({
  open,
  onClose,
  entityId,
  variationId,
  variationName,
  initialMockupHtml,
  initialExportPrompt,
  initialDescriptionDoc,
  initialExportPromptHistory,
}: Props) {
  const reduce = useReducedMotion();
  // Arc 1 fix — mounted guard for the portal. This modal is mounted
  // from inside the item-detail drawer's framer-motion <motion.aside>,
  // which carries a `transform`. A `position: fixed` element inside a
  // transformed ancestor anchors to that ancestor, NOT the viewport —
  // so without portaling, the modal clipped to the 480px drawer
  // ("cropped in the panel") when the transform was present and
  // escaped to full-screen when it cleared. Portaling to document.body
  // moves it out of the transformed subtree so `fixed` behaves.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  // Op A — Doc tab is the default landing surface. It's the narrative
  // human-readable explainer; Mockup + Prompt are the more specialized
  // artifacts. Lead with the most legible.
  const [tab, setTab] = useState<Tab>("doc");
  const [mockupHtml, setMockupHtml] = useState<string>(initialMockupHtml ?? "");
  const [mockupBusy, setMockupBusy] = useState(false);
  const [mockupError, setMockupError] = useState<string | null>(null);
  const [exportPrompt, setExportPrompt] = useState<string>(
    initialExportPrompt ?? "",
  );
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Op B — round-trip optimization state.
  const [promptOptimize, setPromptOptimize] = useState(false);
  const [promptHistory, setPromptHistory] = useState<PromptHistory | null>(
    initialExportPromptHistory ?? null,
  );
  // Op A — description doc state.
  const [descDoc, setDescDoc] = useState<string>(initialDescriptionDoc ?? "");
  const [descBusy, setDescBusy] = useState(false);
  const [descError, setDescError] = useState<string | null>(null);
  // Refine toggle — when on, the next regenerate fires the
  // critic+rewrite pass (1 extra LLM call, tighter language).
  const [descRefine, setDescRefine] = useState(false);
  const [docCopied, setDocCopied] = useState(false);

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
    async (force = false, optimize = false) => {
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
              optimize,
            }),
          },
        );
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          export_prompt?: string;
          export_prompt_history?: PromptHistory | null;
        };
        if (!res.ok) {
          setPromptError(j.error ?? "Prompt generation failed.");
          return;
        }
        if (typeof j.export_prompt === "string")
          setExportPrompt(j.export_prompt);
        if (j.export_prompt_history) setPromptHistory(j.export_prompt_history);
      } catch (err) {
        setPromptError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setPromptBusy(false);
      }
    },
    [entityId, variationId],
  );

  // Op A — description doc fetcher. Mirrors the mockup/prompt pattern.
  const fetchDoc = useCallback(
    async (force = false, refine = false) => {
      setDescBusy(true);
      setDescError(null);
      try {
        const res = await fetch(
          "/api/brainstorm/item/variation/description-doc",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              entityId,
              variationId,
              refine,
              mode: force ? "force" : "default",
            }),
          },
        );
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          description_doc?: string;
        };
        if (!res.ok) {
          setDescError(j.error ?? "Doc generation failed.");
          return;
        }
        if (typeof j.description_doc === "string") setDescDoc(j.description_doc);
      } catch (err) {
        setDescError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setDescBusy(false);
      }
    },
    [entityId, variationId],
  );

  // Lazy-fetch the active tab's artifact when it's empty.
  useEffect(() => {
    if (!open) return;
    if (tab === "doc" && !descDoc && !descBusy && !descError) {
      void fetchDoc(false, false);
    }
    if (tab === "mockup" && !mockupHtml && !mockupBusy && !mockupError) {
      void fetchMockup(false);
    }
    if (tab === "prompt" && !exportPrompt && !promptBusy && !promptError) {
      void fetchPrompt(false);
    }
  }, [
    open,
    tab,
    descDoc,
    descBusy,
    descError,
    mockupHtml,
    mockupBusy,
    mockupError,
    exportPrompt,
    promptBusy,
    promptError,
    fetchDoc,
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

  const copyDoc = useCallback(async () => {
    if (!descDoc) return;
    try {
      await navigator.clipboard.writeText(descDoc);
      setDocCopied(true);
      setTimeout(() => setDocCopied(false), 1800);
    } catch {
      // Soft-fail.
    }
  }, [descDoc]);

  // Don't render until mounted (portal needs document). Returning null
  // pre-mount is safe — the modal only opens on user click anyway.
  if (!mounted) return null;

  return createPortal(
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
                    label="Doc"
                    icon={FileText}
                    active={tab === "doc"}
                    onClick={() => setTab("doc")}
                  />
                  <TabPill
                    label="Mockup"
                    icon={Layout}
                    active={tab === "mockup"}
                    onClick={() => setTab("mockup")}
                  />
                  <TabPill
                    label="Export Prompt"
                    icon={Sparkle}
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
              {tab === "doc" && (
                <DocTab
                  doc={descDoc}
                  busy={descBusy}
                  error={descError}
                  copied={docCopied}
                  refine={descRefine}
                  onToggleRefine={() => setDescRefine((p) => !p)}
                  onCopy={copyDoc}
                  onRegenerate={() => void fetchDoc(true, descRefine)}
                />
              )}
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
                  history={promptHistory}
                  busy={promptBusy}
                  error={promptError}
                  copied={copied}
                  optimize={promptOptimize}
                  onToggleOptimize={() => setPromptOptimize((p) => !p)}
                  onCopy={copyPrompt}
                  onRegenerate={() => void fetchPrompt(true, promptOptimize)}
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// Tab pill — three tabs (Doc | Mockup | Prompt) with icons. Top-tier
// visual: subtle hover lift, accent fill on active, hairline border at
// rest. Icons keep the labels readable at small sizes.
function TabPill({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={active ? undefined : { y: -1, transition: { duration: 0.15 } }}
      whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
      className="inline-flex items-center gap-1.5 transition-[background,color] duration-150 ease-out"
      style={{
        background: active ? appleVibe.accent.primary : appleVibe.surface.card,
        color: active ? appleVibe.text.onAccent : appleVibe.text.secondary,
        border: `1px solid ${active ? appleVibe.accent.primary : appleVibe.stroke.medium}`,
        borderRadius: appleVibe.radius.pill,
        padding: "4px 11px",
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.02em",
        boxShadow: active ? appleVibe.shadow.chip : "none",
        fontFamily: appleVibe.font.stack,
      }}
    >
      <Icon className="h-3 w-3" strokeWidth={2.2} />
      {label}
    </motion.button>
  );
}

// ── Doc tab ─────────────────────────────────────────────────────
//
// Op A — PR/FAQ description doc rendered as styled markdown. The doc
// returns from the server with five fixed headings (## What it is,
// ## Who it serves, etc.) so we can render with a single typography
// scale without parsing the markdown — pre + line break heuristics
// give the user a clean reading experience that respects the source
// without dragging in a full markdown lib.

function DocTab({
  doc,
  busy,
  error,
  copied,
  refine,
  onToggleRefine,
  onCopy,
  onRegenerate,
}: {
  doc: string;
  busy: boolean;
  error: string | null;
  copied: boolean;
  refine: boolean;
  onToggleRefine: () => void;
  onCopy: () => void;
  onRegenerate: () => void;
}) {
  if (busy && !doc) {
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
          Composing description doc…
        </span>
      </div>
    );
  }
  if (error && !doc) {
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
    <div className="flex h-[60vh] flex-col gap-3">
      {/* Action bar — copy + refine toggle + regenerate. Top-tier:
          three pills, refine has its own affordance (the wand icon)
          so the user understands it's an OPTIONAL extra pass. */}
      <div className="flex items-center justify-end gap-1.5">
        <motion.button
          type="button"
          onClick={onToggleRefine}
          whileHover={{ y: -1, transition: { duration: 0.15 } }}
          whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-medium transition-[background,color]"
          style={{
            background: refine
              ? `${withAlpha(appleVibe.accent.primary, "14")}`
              : appleVibe.surface.card,
            color: refine ? appleVibe.accent.primary : appleVibe.text.secondary,
            border: `1px solid ${refine ? appleVibe.accent.primary : appleVibe.stroke.medium}`,
            fontFamily: appleVibe.font.stack,
          }}
          title={
            refine
              ? "Refine: ON — next regen does a critic+rewrite pass"
              : "Refine: OFF — turn on for a tighter second pass on regenerate (+1 LLM call)"
          }
        >
          <Wand2 className="h-2.5 w-2.5" strokeWidth={2.4} />
          Refine {refine ? "on" : "off"}
        </motion.button>
        <motion.button
          type="button"
          onClick={onCopy}
          whileHover={{ y: -1, transition: { duration: 0.15 } }}
          whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-medium transition-[background,color]"
          style={{
            background: copied
              ? `${withAlpha(appleVibe.stage.outcomes, "14")}`
              : appleVibe.surface.card,
            color: copied ? appleVibe.stage.outcomes : appleVibe.text.secondary,
            border: `1px solid ${copied ? appleVibe.stage.outcomes : appleVibe.stroke.medium}`,
            fontFamily: appleVibe.font.stack,
          }}
        >
          {copied ? (
            <Check className="h-2.5 w-2.5" strokeWidth={2.4} />
          ) : (
            <Copy className="h-2.5 w-2.5" strokeWidth={2.4} />
          )}
          {copied ? "Copied" : "Copy"}
        </motion.button>
        <motion.button
          type="button"
          onClick={onRegenerate}
          disabled={busy}
          whileHover={busy ? undefined : { y: -1, transition: { duration: 0.15 } }}
          whileTap={busy ? undefined : { y: 0.5, transition: { duration: 0.08 } }}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-medium transition-opacity disabled:opacity-50"
          style={{
            background: appleVibe.surface.card,
            color: appleVibe.text.tertiary,
            border: `1px solid ${appleVibe.stroke.medium}`,
            fontFamily: appleVibe.font.stack,
          }}
        >
          {busy ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={2.4} />
          ) : (
            <RefreshCw className="h-2.5 w-2.5" strokeWidth={2.4} />
          )}
          Regenerate
        </motion.button>
      </div>
      {/* Rendered doc — styled prose. We don't bring in a full markdown
          lib; instead we split on the five known headings and render
          each section with section-specific typography. This keeps the
          render layer dependency-free and lets us highlight the
          PR/FAQ headings consistently across docs. */}
      <DocRender doc={doc} />
    </div>
  );
}

// Markdown-lite renderer for the PR/FAQ doc. The generator produces
// five known headings (## What it is, ## Who it serves, ## How it
// works, ## What we'd need to find out, ## How we'd know it worked).
// We split on these, then render paragraphs as prose + bullet lines
// (starting with "- ") as <li>. Anything unexpected falls through as
// a generic paragraph block so we never blank-screen the user.

function DocRender({ doc }: { doc: string }) {
  // Split by heading markers but keep the heading text.
  const sections = doc
    .split(/^##\s+/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return (
    <article
      className="flex-1 overflow-y-auto rounded-2xl px-6 py-5"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {sections.map((section, i) => {
        const firstNewline = section.indexOf("\n");
        const heading =
          firstNewline === -1
            ? section.trim()
            : section.slice(0, firstNewline).trim();
        const body =
          firstNewline === -1 ? "" : section.slice(firstNewline + 1).trim();
        return (
          <section key={`${i}-${heading}`} className={i === 0 ? "" : "mt-5"}>
            <h3
              className="text-[10px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: appleVibe.accent.primary }}
            >
              {heading}
            </h3>
            <DocBody text={body} />
          </section>
        );
      })}
    </article>
  );
}

function DocBody({ text }: { text: string }) {
  // Split into paragraphs by blank line. Render bullet runs as <ul>.
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const isBulletBlock = lines.every((l) => /^\s*[-*]\s+/.test(l));
        if (isBulletBlock) {
          return (
            <ul
              key={i}
              className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed"
              style={{ color: appleVibe.text.primary }}
            >
              {lines.map((l, j) => (
                <li key={j}>{l.replace(/^\s*[-*]\s+/, "")}</li>
              ))}
            </ul>
          );
        }
        return (
          <p
            key={i}
            className="mt-2 text-[13.5px] leading-relaxed"
            style={{ color: appleVibe.text.primary }}
          >
            {block}
          </p>
        );
      })}
    </>
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
  history,
  busy,
  error,
  copied,
  optimize,
  onToggleOptimize,
  onCopy,
  onRegenerate,
}: {
  prompt: string;
  history: PromptHistory | null;
  busy: boolean;
  error: string | null;
  copied: boolean;
  optimize: boolean;
  onToggleOptimize: () => void;
  onCopy: () => void;
  onRegenerate: () => void;
}) {
  if (busy && !prompt) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-2 px-4">
        <Loader2
          className="h-4 w-4 animate-spin"
          style={{ color: appleVibe.text.tertiary }}
        />
        <span
          className="text-[12px] font-light italic"
          style={{ color: appleVibe.text.tertiary }}
        >
          {optimize
            ? "Composing → testing → judging → revising… ~30 seconds."
            : "Composing prompt…"}
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
      {/* Action bar — Optimize / Copy / Regenerate. The Optimize pill
          is the standout: when ON, the next regenerate fires the
          round-trip (generate → test → judge → revise). Distinct
          from Refine in Op A: this is a 4-call pipeline with cost
          implications, so we make it explicit. */}
      <div className="flex items-center justify-end gap-1.5">
        <motion.button
          type="button"
          onClick={onToggleOptimize}
          whileHover={{ y: -1, transition: { duration: 0.15 } }}
          whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-medium transition-[background,color]"
          style={{
            background: optimize
              ? `${withAlpha(appleVibe.accent.primary, "14")}`
              : appleVibe.surface.card,
            color: optimize
              ? appleVibe.accent.primary
              : appleVibe.text.secondary,
            border: `1px solid ${optimize ? appleVibe.accent.primary : appleVibe.stroke.medium}`,
            fontFamily: appleVibe.font.stack,
          }}
          title={
            optimize
              ? "Optimize: ON — next regen runs generate → test → judge → revise (~30s, +3 LLM calls)"
              : "Optimize: OFF — turn on for a round-trip tested + judge-graded prompt"
          }
        >
          <Wand2 className="h-2.5 w-2.5" strokeWidth={2.4} />
          Optimize {optimize ? "on" : "off"}
        </motion.button>
        <motion.button
          type="button"
          onClick={onCopy}
          whileHover={{ y: -1, transition: { duration: 0.15 } }}
          whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-medium transition-[background,color]"
          style={{
            background: copied
              ? `${withAlpha(appleVibe.stage.outcomes, "14")}`
              : appleVibe.surface.card,
            color: copied ? appleVibe.stage.outcomes : appleVibe.text.secondary,
            border: `1px solid ${copied ? appleVibe.stage.outcomes : appleVibe.stroke.medium}`,
            fontFamily: appleVibe.font.stack,
          }}
        >
          {copied ? (
            <Check className="h-2.5 w-2.5" strokeWidth={2.4} />
          ) : (
            <Copy className="h-2.5 w-2.5" strokeWidth={2.4} />
          )}
          {copied ? "Copied" : "Copy"}
        </motion.button>
        <motion.button
          type="button"
          onClick={onRegenerate}
          disabled={busy}
          whileHover={busy ? undefined : { y: -1, transition: { duration: 0.15 } }}
          whileTap={busy ? undefined : { y: 0.5, transition: { duration: 0.08 } }}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-medium transition-opacity disabled:opacity-50"
          style={{
            background: appleVibe.surface.card,
            color: appleVibe.text.tertiary,
            border: `1px solid ${appleVibe.stroke.medium}`,
            fontFamily: appleVibe.font.stack,
          }}
        >
          {busy ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={2.4} />
          ) : (
            <RefreshCw className="h-2.5 w-2.5" strokeWidth={2.4} />
          )}
          Regenerate
        </motion.button>
      </div>
      {/* History badge — when round-trip ran, surface the judge score
          + iteration count above the prompt so the user immediately
          sees "this was tested". */}
      {history && <PromptHistoryBadge history={history} />}
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
      {/* Round-trip details (output + critique) — collapsed under
          the prompt body so they don't crowd the headline artifact. */}
      {history && <PromptHistoryDetails history={history} />}
    </div>
  );
}

// ── Op B — round-trip history surface ────────────────────────────
//
// Two pieces:
//   PromptHistoryBadge — small inline pill above the prompt showing
//                        "Round-trip tested · score X/10 · N iter".
//                        Always visible when history is present.
//   PromptHistoryDetails — collapsible disclosure below the prompt
//                        showing what the test-runner produced + the
//                        judge's critique + (if revised) the diff
//                        between v1 and v2. Default closed.

function PromptHistoryBadge({ history }: { history: PromptHistory }) {
  const finalPreview = history.preview_v2 ?? history.preview_v1;
  const score = finalPreview.judge_score;
  const shipped = finalPreview.judge_verdict === "ship";
  const color = shipped
    ? appleVibe.stage.outcomes
    : "rgba(217,119,6,0.9)";
  return (
    <div
      className="inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-0.5 text-[10.5px] font-medium"
      style={{
        background: `${color}10`,
        color,
        border: `1px solid ${color}40`,
        fontFamily: appleVibe.font.stack,
      }}
      title={
        shipped
          ? "The judge model rated this prompt's test output as ship-ready."
          : "The judge model still flagged issues even after revision — preview output may need a manual review."
      }
    >
      <Sparkle className="h-2.5 w-2.5" strokeWidth={2.4} />
      Round-trip tested · {score.toFixed(1)}/10
      {history.iterations > 1 && ` · ${history.iterations} iter`}
      {!shipped && " · needs review"}
    </div>
  );
}

function PromptHistoryDetails({ history }: { history: PromptHistory }) {
  const [open, setOpen] = useState(false);
  const finalPreview = history.preview_v2 ?? history.preview_v1;
  return (
    <div className="flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: appleVibe.text.tertiary, fontFamily: appleVibe.font.stack }}
      >
        {open ? "Hide" : "Show"} optimization details
        <ChevronDown
          className="h-3 w-3 transition-transform"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
          strokeWidth={2.4}
        />
      </button>
      {open && (
        <div
          className="mt-2 flex flex-col gap-3 rounded-2xl px-4 py-3"
          style={{
            background: appleVibe.surface.cardElevated,
            border: `1px solid ${appleVibe.stroke.hairline}`,
          }}
        >
          <PreviewSection
            title="Test-runner output (what an external LLM produced)"
            text={finalPreview.output}
          />
          <CritiqueSection
            score={finalPreview.judge_score}
            verdict={finalPreview.judge_verdict}
            critique={finalPreview.judge_critique}
          />
          {history.iterations > 1 && history.preview_v1 && (
            <details>
              <summary
                className="cursor-pointer text-[10.5px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                v1 attempt (revised after judge critique)
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                <PreviewSection
                  title="v1 output"
                  text={history.preview_v1.output}
                  compact
                />
                <CritiqueSection
                  score={history.preview_v1.judge_score}
                  verdict={history.preview_v1.judge_verdict}
                  critique={history.preview_v1.judge_critique}
                  compact
                />
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function PreviewSection({
  title,
  text,
  compact = false,
}: {
  title: string;
  text: string;
  compact?: boolean;
}) {
  return (
    <div>
      <div
        className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: appleVibe.text.tertiary }}
      >
        {title}
      </div>
      <pre
        className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl px-3 py-2 text-[11.5px] leading-snug"
        style={{
          background: "rgba(15,23,42,0.025)",
          border: `1px solid ${appleVibe.stroke.hairline}`,
          color: appleVibe.text.secondary,
          fontFamily: appleVibe.font.stack,
          fontSize: compact ? "11px" : "11.5px",
        }}
      >
        {text}
      </pre>
    </div>
  );
}

function CritiqueSection({
  score,
  verdict,
  critique,
  compact = false,
}: {
  score: number;
  verdict: "ship" | "revise";
  critique: string;
  compact?: boolean;
}) {
  const color =
    verdict === "ship"
      ? appleVibe.stage.outcomes
      : "rgba(217,119,6,0.9)";
  return (
    <div>
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.12em]"
          style={{
            background: `${color}14`,
            color,
            border: `1px solid ${color}40`,
          }}
        >
          {verdict}
          <span style={{ opacity: 0.7 }}>· {score.toFixed(1)}/10</span>
        </span>
        <span
          className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Judge critique
        </span>
      </div>
      <p
        className={`mt-1 ${compact ? "text-[11px]" : "text-[12px]"} leading-snug italic`}
        style={{ color: appleVibe.text.secondary }}
      >
        {critique}
      </p>
    </div>
  );
}

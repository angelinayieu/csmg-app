"use client";

// ── /app/new ──
//
// The single starting surface for intake (locked 2026-04-20,
// project_intake_whiteboard). Full-viewport dark canvas with a centered
// prompt card. Submit → POST /api/intake/bootstrap, which creates the
// space + pipeline_run + intake:enter event synchronously and returns
// { spaceId, runId } in <500ms. We redirect immediately — the heavy
// decompose is already running in the background via `after()`, and
// the whiteboard's SSE subscription picks up entity_added events as
// they land. No more 60s "Analyzing…" spinner on a dead surface.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type ReasoningDepth = "quick" | "standard" | "deep";

const DEPTH_LABELS: Record<ReasoningDepth, { label: string; hint: string }> = {
  quick: { label: "Quick", hint: "Fast sketch, ~10s" },
  standard: { label: "Standard", hint: "Depth-tuned, ~60s" },
  deep: { label: "Deep", hint: "Multi-pass rigor, ~3 min" },
};

// Legacy modes (from the deprecated /app/analyze surface) map to depth.
// Keep the mapping so `?mode=sketch` links still land on a usable page.
function depthFromMode(mode: string | null): ReasoningDepth | null {
  if (mode === "sketch") return "quick";
  if (mode === "analyze") return "standard";
  if (mode === "deep") return "deep";
  return null;
}

export default function IntakeNewPage() {
  return (
    <Suspense fallback={null}>
      <IntakeNewInner />
    </Suspense>
  );
}

function IntakeNewInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSeed = searchParams.get("seed") ?? "";
  const initialDepth =
    depthFromMode(searchParams.get("mode")) ?? "standard";

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState(initialSeed);
  const [depth, setDepth] = useState<ReasoningDepth>(initialDepth);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinct credit-exhaustion state so we can render a specific
  // CTA (link to /app/credits) instead of a generic error message.
  // 402 is returned by pipeline routes when OpenAI/Anthropic report
  // insufficient_quota or credit_balance_too_low, OR when the user's
  // pre-flight reservation fails (insufficient account balance).
  const [creditExhausted, setCreditExhausted] = useState<null | {
    balance: number;
    required: number;
    tier: string;
  }>(null);

  // Autofocus the textarea on mount — single surface, single affordance.
  // If seed arrived via query param, cursor lands at the end so the
  // user can append/edit before submitting.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    if (initialSeed) {
      el.setSelectionRange(initialSeed.length, initialSeed.length);
    }
  }, [initialSeed]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed.length < 4 || submitting) return;

    setSubmitting(true);
    setError(null);
    setCreditExhausted(null);
    try {
      const res = await fetch("/api/intake/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          reasoningDepth: depth,
        }),
      });
      // 402 = provider quota exhausted (OpenAI insufficient_quota /
      // Anthropic credit balance too low). Detect BEFORE throwing a
      // generic error so we can render the specific credit-CTA state
      // instead of "Bootstrap failed (402)" noise.
      // Defensive JSON parse: if the server ever returns a non-JSON
      // response (e.g. a Next.js default HTML error page from an
      // unhandled throw), `res.json()` would die with "Unexpected
      // token <" and bubble a scary message. Read as text first,
      // then try to parse — fall back to a friendly generic error
      // when the body is HTML. Bootstrap itself now has an outer
      // try/catch that guarantees JSON, so this is defense in depth
      // for proxy/middleware/infrastructure failures beyond our
      // control.
      const rawText = await res.text();
      const asJson = (() => {
        try {
          return JSON.parse(rawText) as Record<string, unknown>;
        } catch {
          return null;
        }
      })();
      if (res.status === 402) {
        const creditShape = asJson as Record<string, unknown> | null;
        if (creditShape?.isCredit === true) {
          setCreditExhausted({
            balance: typeof creditShape.balance === "number" ? (creditShape.balance as number) : 0,
            required: typeof creditShape.required === "number" ? (creditShape.required as number) : 0,
            tier: typeof creditShape.tier === "string" ? (creditShape.tier as string) : depth,
          });
          setSubmitting(false);
          return;
        }
        throw new Error(
          (asJson?.error as string) ?? "Payment required",
        );
      }
      if (!res.ok) {
        if (!asJson) {
          // HTML (or other non-JSON) came back — usually a 500 with
          // an HTML error page from upstream. Show a readable
          // message instead of leaking the HTML parse failure.
          throw new Error(
            `Server returned an unexpected response (${res.status}). Please retry; if it persists, the pipeline service may be redeploying.`,
          );
        }
        throw new Error(
          (asJson.error as string) ?? `Bootstrap failed (${res.status})`,
        );
      }
      if (!asJson) {
        throw new Error("Unexpected non-JSON response from bootstrap.");
      }
      const data = asJson as unknown as {
        spaceId: string;
        runId: string | null;
      };
      const destination = data.runId
        ? `/app/space/${data.spaceId}/whiteboard?run=${data.runId}`
        : `/app/space/${data.spaceId}/whiteboard`;
      router.push(destination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bootstrap failed");
      setSubmitting(false);
    }
  }, [text, depth, submitting, router]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const canSubmit = text.trim().length >= 4 && !submitting;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at 30% 20%, #F8FAFF 0%, #F0F4FB 40%, #E9EEF8 100%)",
        backgroundImage:
          "radial-gradient(circle, rgba(20,30,50,0.05) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      {/* Centered prompt card — styled to feel like a card on a blank
          canvas, matching the tldraw aesthetic the user will land on
          post-submit. */}
      <div
        className="pointer-events-auto w-full max-w-[720px] rounded-3xl border border-gray-200/80 bg-white/90 p-8 shadow-xl backdrop-blur-md"
        style={{
          boxShadow:
            "0 32px 72px -24px rgba(8,60,180,0.18), 0 12px 30px -14px rgba(8,60,180,0.10), inset 0 1.5px 0 rgba(255,255,255,1)",
        }}
      >
        {/* Header */}
        <div className="mb-5 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-50 to-purple-50 ring-1 ring-blue-200">
            <Sparkles className="h-3.5 w-3.5 text-blue-600" />
          </div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">
            New whiteboard
          </div>
        </div>

        <h1 className="mb-2 text-[28px] font-semibold tracking-tight text-gray-900">
          What are you thinking about?
        </h1>
        <p className="mb-6 text-[13.5px] leading-relaxed text-gray-500">
          Describe a situation, question, or domain. The analysis unfurls as a
          tree on the whiteboard — entities, relationships, and cycles will
          materialize live as the pipeline runs.
        </p>

        {/* Prompt textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="e.g. I'm launching a B2B SaaS for mid-market CFOs and I'm trying to figure out the right early-stage growth loop…"
          rows={6}
          disabled={submitting}
          className="w-full resize-none rounded-xl border border-gray-200 bg-white/70 px-4 py-3 text-[14px] leading-relaxed text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-300 focus:bg-white disabled:opacity-60"
        />

        {/* Depth selector + submit */}
        <div className="mt-5 flex items-center justify-between">
          <div className="inline-flex items-center gap-1 rounded-lg bg-gray-100 p-[3px]">
            {(Object.keys(DEPTH_LABELS) as ReasoningDepth[]).map((d) => {
              const meta = DEPTH_LABELS[d];
              const active = depth === d;
              return (
                <button
                  key={d}
                  onClick={() => setDepth(d)}
                  disabled={submitting}
                  title={meta.hint}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-[11.5px] font-semibold transition-colors",
                    active
                      ? "bg-white text-gray-900 shadow-sm ring-1 ring-black/5"
                      : "text-gray-500 hover:text-gray-800",
                  )}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>

          <button
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all",
              canSubmit
                ? "bg-gradient-to-br from-blue-600 to-purple-600 text-white shadow-sm hover:-translate-y-px hover:shadow-md"
                : "bg-gray-100 text-gray-400 cursor-not-allowed",
            )}
            title="Analyze (⌘↵)"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowRight className="h-3.5 w-3.5" />
            )}
            {submitting ? "Opening whiteboard…" : "Open whiteboard"}
            <span className="ml-0.5 rounded border border-white/30 bg-white/10 px-1.5 py-0.5 font-mono text-[9.5px] text-white/80">
              ⌘↵
            </span>
          </button>
        </div>

        {creditExhausted && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50/60 px-4 py-3">
            <div className="mb-1 text-[12.5px] font-semibold text-amber-900">
              Not enough credits
            </div>
            <p className="mb-2.5 text-[11.5px] leading-relaxed text-amber-800">
              This{" "}
              <span className="font-semibold capitalize">
                {creditExhausted.tier}
              </span>{" "}
              analysis needs{" "}
              <span className="font-mono font-semibold tabular-nums">
                {creditExhausted.required}
              </span>{" "}
              credits — you have{" "}
              <span className="font-mono font-semibold tabular-nums">
                {creditExhausted.balance}
              </span>
              . Add credits to continue; your prompt is saved.
            </p>
            <a
              href="/app/credits"
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-sm hover:-translate-y-px hover:shadow-md transition-all"
            >
              Add credits →
            </a>
          </div>
        )}

        {error && !creditExhausted && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

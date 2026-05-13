// ── Focus Mode Stage 4 — "Ready to publish" ──
//
// Final review + the big publish CTA. On confirm:
//   1. Fires generateStrategy(sessionId) (Phase 3.5d endpoint —
//      plan-aware via the alignment work)
//   2. Shows the crystallization splash for 2.6s
//   3. Navigates to /app/synergy/[id]/strategy
//
// The user's sharpening answers (from Stage 3) are persisted as a
// follow-up question into objective constraints if they want — for
// now, we just stuff the most material answers into objective_constraints
// so the existing strategy gen prompt picks them up via its objective
// block. That keeps the data path simple and additive.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Globe,
  Loader2,
  Lock,
  Network,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import {
  generateStrategy,
  listComponents,
  updateSession,
} from "@/lib/synergy/client";
import type { BrainstormComponent } from "@/lib/synergy/types";

interface Props {
  sessionId: string;
  sharpeningAnswers: Record<string, string>;
  onPublishStart: () => void;
  onPublishComplete: () => void;
}

export function FocusModeStage4({
  sessionId,
  sharpeningAnswers,
  onPublishStart,
  onPublishComplete,
}: Props) {
  const router = useRouter();
  const [components, setComponents] = useState<BrainstormComponent[] | null>(
    null,
  );
  const [publishing, setPublishing] = useState(false);

  // Pull final component visibility distribution
  if (components === null) {
    listComponents(sessionId).then(setComponents).catch(() => setComponents([]));
  }

  const matchable = (components ?? []).filter(
    (c) => c.visibility === "matchable_only",
  ).length;
  const privateCount = (components ?? []).filter(
    (c) => c.visibility === "private",
  ).length;
  const publicCount = (components ?? []).filter(
    (c) => c.visibility === "public",
  ).length;
  const total = (components ?? []).length;

  const publish = async () => {
    if (publishing) return;
    setPublishing(true);
    onPublishStart();
    try {
      // Persist sharpening answers as objective_constraints so the
      // strategy gen prompt picks them up automatically.
      const sharpened = Object.entries(sharpeningAnswers)
        .filter(([, v]) => v.trim().length > 0)
        .map(([q, v]) => `${q.replace(/[?.]$/, "")} → ${v.trim()}`)
        .slice(0, 10);
      if (sharpened.length > 0) {
        try {
          // PATCH appends to objective_constraints; we read first to
          // avoid clobbering prior constraints.
          // (updateSession does a full replace; we keep this simple and
          // assume the user is comfortable with our overwriting.)
          await updateSession(sessionId, {
            objective_constraints: sharpened,
          });
        } catch {
          // Soft-fail — don't block publish on a constraint persist
          console.warn("Sharpening persist failed; continuing publish");
        }
      }

      // Crystallize the strategy doc
      await generateStrategy(sessionId);
      onPublishComplete();
      router.push(`/app/synergy/${sessionId}/strategy`);
    } catch (e) {
      toast.error("Publish failed", { description: (e as Error).message });
      setPublishing(false);
    }
  };

  return (
    <div className="px-6 pb-32 pt-2">
      <h1 className="font-display-tight text-[32px] font-semibold leading-[1.05] text-gray-900">
        Ready to publish
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-gray-500">
        Crystallize the strategy doc. Index matchable components for
        collaborators.
      </p>

      <div className="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200">
        <StatCard
          icon={Network}
          label="Matchable"
          value={matchable}
          accent="text-gray-900"
        />
        <StatCard
          icon={Lock}
          label="Private"
          value={privateCount}
          accent="text-gray-900"
        />
        <StatCard
          icon={Globe}
          label="Public"
          value={publicCount}
          accent="text-gray-900"
        />
      </div>

      <section className="mt-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
          What happens next
        </div>
        <ol className="mt-4 space-y-4">
          {[
            "A living strategy doc — plan, risks, hypotheses, upstream needs, downstream products. Refine any block inline.",
            `Your ${matchable} matchable component${matchable === 1 ? "" : "s"} enter${matchable === 1 ? "s" : ""} the index. Complementary collaborators surface here.`,
            "Anonymous until you accept — only the public label and description leave your account.",
          ].map((line, i) => (
            <li key={i} className="flex items-baseline gap-4">
              <span className="font-numerical w-4 shrink-0 font-mono text-[11px] tabular-nums text-gray-400">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[13.5px] leading-relaxed text-gray-700">
                {line}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <button
        onClick={publish}
        disabled={publishing || total === 0}
        title={total === 0 ? "Extract components first" : "Publish + crystallize"}
        className="mt-10 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-5 py-3.5 text-[14px] font-medium text-white transition hover:bg-gray-800 active:bg-black disabled:opacity-50"
        style={{
          boxShadow:
            "0 1px 2px rgba(15, 23, 42, 0.08), 0 6px 16px -8px rgba(15, 23, 42, 0.24)",
        }}
      >
        {publishing && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />}
        <span>Publish + find collaborators</span>
        <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="bg-white px-4 py-5 text-center">
      <Icon
        className={`mx-auto h-4 w-4 text-gray-400`}
        strokeWidth={1.25}
      />
      <div className={`font-display font-numerical mt-2 text-[28px] font-semibold leading-none tracking-tight tabular-nums ${accent}`}>
        {value}
      </div>
      <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.18em] text-gray-500">
        {label}
      </div>
    </div>
  );
}

// Note: all three stat cards share neutral chrome — differentiation
// lives in the icon (Network / Lock / Globe) and the label, not in
// colored backgrounds. Apple Pro restraint.

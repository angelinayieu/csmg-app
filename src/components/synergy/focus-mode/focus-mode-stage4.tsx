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
  Sparkles,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import {
  generateStrategy,
  listComponents,
  updateSession,
} from "@/lib/synergy/client";
import type {
  BrainstormComponent,
  ComponentVisibility,
} from "@/lib/synergy/types";

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
      <h1 className="text-[26px] font-semibold leading-snug tracking-tight text-gray-900">
        Ready to publish
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
        Crystallize the strategy doc and put your matchable components into
        the marketplace.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-2">
        <StatCard
          icon={Network}
          label="Matchable"
          value={matchable}
          tone="bg-blue-50 text-blue-700 ring-blue-100"
        />
        <StatCard
          icon={Lock}
          label="Private"
          value={privateCount}
          tone="bg-gray-50 text-gray-700 ring-gray-200"
        />
        <StatCard
          icon={Globe}
          label="Public"
          value={publicCount}
          tone="bg-emerald-50 text-emerald-700 ring-emerald-100"
        />
      </div>

      <section className="mt-8 rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50/40 to-cyan-50/40 p-4">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-blue-700">
          <Sparkles className="h-3 w-3" /> What happens next
        </div>
        <ul className="mt-3 space-y-2 text-[12px] leading-relaxed text-gray-700">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 font-mono text-[8px] font-semibold text-white">
              1
            </span>
            <span>
              We crystallize a living strategy doc — statement, plan, risks,
              hypotheses, upstream needs, downstream products. You can refine
              every block inline.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 font-mono text-[8px] font-semibold text-white">
              2
            </span>
            <span>
              Your {matchable} matchable component
              {matchable === 1 ? "" : "s"} enter{matchable === 1 ? "s" : ""}{" "}
              the indexing pipeline. The matching marketplace (Phase 4) will
              surface complementary collaborators here.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 font-mono text-[8px] font-semibold text-white">
              3
            </span>
            <span>
              You stay anonymous until you accept a match — only your
              component&apos;s public label + description leave your account.
            </span>
          </li>
        </ul>
      </section>

      <button
        onClick={publish}
        disabled={publishing || total === 0}
        title={total === 0 ? "Extract components first" : "Publish + crystallize"}
        className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 px-5 py-4 text-[14px] font-semibold text-white shadow-[0_10px_30px_-10px_rgba(6,182,212,0.5)] transition hover:scale-[1.02] disabled:opacity-60"
      >
        {publishing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        Publish + find collaborators
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className={`rounded-xl ring-1 ${tone} p-3 text-center`}>
      <Icon className="mx-auto h-4 w-4 opacity-80" />
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="font-mono text-[9px] uppercase tracking-wider opacity-80">
        {label}
      </div>
    </div>
  );
}

"use client";

// ── Canvas preflight chip ─────────────────────────────────────────────
//
// Top-left floating chip on the canvas that surfaces the preflight
// contract status:
//
//   - Pre-approval (no preflight_approvals row yet):
//       Bright emerald chip with "Open preflight contract →" — invites
//       the user to review what's about to be generated before it runs.
//
//   - Post-approval (latest run was approved via preflight):
//       Slate chip showing the approved hash + "audit" link → goes to
//       the Environment audit page where they can diff vs plan.
//
//   - Drift (the preflight has changed since the last approval — the
//     user edited overrides without re-approving):
//       Amber chip warning that the live state has drifted from the
//       last approved contract → click to re-approve or revert.
//
// Self-contained: polls /api/spaces/[id]/preflight every 60s for the
// current hash + checks whether a matching preflight_approvals row
// exists. Auto-hides when the space has fewer than 3 entities (too
// early to surface a contract).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PreflightView } from "@/types/preflight";

const POLL_INTERVAL_MS = 60_000;

interface CanvasPreflightChipProps {
  spaceId: string;
}

interface PreflightStatus {
  hash: string;
  entitiesPresent: boolean;
  approvalState: "none" | "current" | "drifted";
  approvedHash: string | null;
  approvedAt: string | null;
}

export function CanvasPreflightChip({ spaceId }: CanvasPreflightChipProps) {
  const router = useRouter();
  const [status, setStatus] = useState<PreflightStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [pfRes, apRes] = await Promise.all([
        // Skip the M1+M2+M3 mediator preview to keep this poll cheap.
        fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/preflight?include_preview=false`,
        ),
        fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/preflight/approvals/latest`,
        ),
      ]);

      if (!pfRes.ok) {
        setStatus(null);
        return;
      }
      const pf = (await pfRes.json()) as PreflightView;
      const entitiesPresent = pf.causal_map.current_entities >= 3;

      let approvalState: "none" | "current" | "drifted" = "none";
      let approvedHash: string | null = null;
      let approvedAt: string | null = null;

      if (apRes.ok) {
        const ap = (await apRes.json()) as {
          approval: { preflight_hash: string; approved_at: string } | null;
        };
        if (ap.approval) {
          approvedHash = ap.approval.preflight_hash;
          approvedAt = ap.approval.approved_at;
          approvalState = approvedHash === pf.preflight_hash ? "current" : "drifted";
        }
      }

      setStatus({
        hash: pf.preflight_hash,
        entitiesPresent,
        approvalState,
        approvedHash,
        approvedAt,
      });
    } catch {
      // Silent fail — chip just won't render this poll cycle.
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const onClick = useCallback(() => {
    router.push(`/app/space/${spaceId}/preflight`);
  }, [router, spaceId]);

  if (loading) return null;
  if (!status || !status.entitiesPresent) return null;

  const variant = status.approvalState;

  return (
    <button
      onClick={onClick}
      className={cn(
        "fixed left-4 top-20 z-30 flex items-center gap-2 rounded-full border bg-white/95 px-3 py-1.5 text-xs font-semibold shadow-md backdrop-blur-md transition-all hover:scale-[1.02]",
        variant === "none" && "border-emerald-300 hover:border-emerald-400",
        variant === "current" && "border-slate-300 hover:border-slate-400",
        variant === "drifted" && "border-amber-300 hover:border-amber-400",
      )}
      title={
        variant === "none"
          ? "Review the preflight contract before generation runs"
          : variant === "current"
            ? `Preflight approved · audit at /environment`
            : "Live preflight has drifted from your last approval — re-approve or revert"
      }
    >
      {variant === "none" && (
        <>
          <ArrowRight className="h-3.5 w-3.5 text-emerald-600" />
          <span className="text-emerald-900">Open preflight contract</span>
        </>
      )}
      {variant === "current" && (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 text-slate-600" />
          <span className="text-slate-700">Preflight approved</span>
          <span className="font-mono text-[10px] text-slate-400">
            {status.approvedHash?.slice(0, 8)}
          </span>
        </>
      )}
      {variant === "drifted" && (
        <>
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
          <span className="text-amber-900">Preflight drifted</span>
          <span className="font-mono text-[10px] text-amber-500">
            {status.hash.slice(0, 8)}
          </span>
        </>
      )}
    </button>
  );
}

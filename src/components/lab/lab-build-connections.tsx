"use client";

// Phase 28 — Build Connections affordance.
//
// Gives users a one-click way to populate a node lab that has no subunits
// yet, or probe for additional ones on a lab that's already populated.
// Wraps /api/canvas/recursive-decompose and refreshes the router so the
// newly-written entities + edges flow back in on the next render.
//
// Two visual variants:
//   - `full`  — big centered CTA, for the empty-state reagent bay slot
//   - `mini`  — compact chip, for the section header when subunits already exist

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";

export interface LabBuildConnectionsProps {
  spaceId: string;
  entityId: string;
  variant?: "full" | "mini";
}

export function LabBuildConnections({
  spaceId,
  entityId,
  variant = "full",
}: LabBuildConnectionsProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [count, setCount] = useState<number | null>(null);

  const onClick = async () => {
    setStatus("loading");
    setCount(null);
    try {
      const res = await fetch("/api/canvas/recursive-decompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, entityId }),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = (await res.json()) as {
        children?: Array<unknown>;
        edges?: Array<unknown>;
      };
      const n = data.children?.length ?? 0;
      setCount(n);
      setStatus("idle");
      // Refresh server component so new rows land in this render pass.
      router.refresh();
    } catch {
      setStatus("error");
    }
  };

  if (variant === "mini") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={status === "loading"}
        className="flex items-center gap-1 rounded-[2px] border border-[var(--lab-accent)] bg-[var(--lab-accent-tint)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.14em] text-[var(--lab-accent)] transition-colors hover:border-[var(--lab-accent)] hover:bg-[var(--lab-accent-tint)] disabled:cursor-wait disabled:opacity-60"
        title="Probe for more subunits + bonds"
      >
        {status === "loading" ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        ) : (
          <Sparkles className="h-2.5 w-2.5" />
        )}
        <span>{status === "loading" ? "Probing" : "Probe"}</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 rounded-[3px] border border-dashed border-[var(--lab-accent)] bg-[var(--lab-accent-tint)] px-3 py-4">
      <div className="text-center text-[10px] leading-relaxed text-[var(--lab-text-mid)]">
        No decomposed subunits yet.
        <br />
        <span className="text-[9px] text-[var(--lab-text-dim)]">
          Build connections and subcomponents from this specimen.
        </span>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={status === "loading"}
        className="flex items-center gap-1.5 rounded-[3px] border border-[var(--lab-accent)] bg-[var(--lab-accent-tint)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--lab-accent)] transition-colors hover:border-[var(--lab-accent)] hover:bg-[var(--lab-accent-tint)] disabled:cursor-wait disabled:opacity-60"
      >
        {status === "loading" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Sparkles className="h-3 w-3" />
        )}
        <span>
          {status === "loading" ? "Building…" : "Build Connections"}
        </span>
      </button>
      {status === "error" && (
        <div className="text-[9px] text-[var(--lab-danger)]">
          Couldn't decompose — try again.
        </div>
      )}
      {count !== null && count === 0 && (
        <div className="text-[9px] text-[var(--lab-warn)]">
          No new subunits found.
        </div>
      )}
    </div>
  );
}

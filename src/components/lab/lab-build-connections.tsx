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
        className="flex items-center gap-1 rounded-[2px] border border-[#4ade80]/30 bg-[#4ade80]/5 px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.14em] text-[#4ade80] transition-colors hover:border-[#4ade80]/60 hover:bg-[#4ade80]/10 disabled:cursor-wait disabled:opacity-60"
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
    <div className="flex flex-col items-center gap-2 rounded-[3px] border border-dashed border-[#4ade80]/25 bg-[#4ade80]/[0.03] px-3 py-4">
      <div className="text-center text-[10px] leading-relaxed text-[#94a3b8]">
        No decomposed subunits yet.
        <br />
        <span className="text-[9px] text-[#64748b]">
          Build connections and subcomponents from this specimen.
        </span>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={status === "loading"}
        className="flex items-center gap-1.5 rounded-[3px] border border-[#4ade80]/50 bg-[#4ade80]/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4ade80] transition-colors hover:border-[#4ade80]/80 hover:bg-[#4ade80]/20 disabled:cursor-wait disabled:opacity-60"
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
        <div className="text-[9px] text-[#f472b6]">
          Couldn't decompose — try again.
        </div>
      )}
      {count !== null && count === 0 && (
        <div className="text-[9px] text-[#fbbf24]">
          No new subunits found.
        </div>
      )}
    </div>
  );
}

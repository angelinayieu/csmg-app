"use client";

// ── RetagCardsButton ──────────────────────────────────────────────
//
// "Add layers & re-sort." One click → POST /layers/retag, which tags
// every Unplaced card (or all cards, in mode="all") with the layer it
// operates at, then refreshes the canvas so the cards drop onto their
// shelves. Self-contained so it can be dropped onto the Unplaced shelf
// without widening any shared component's prop surface.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Loader2 } from "lucide-react";

export function RetagCardsButton({
  spaceId,
  unplacedCount,
  mode = "untagged",
  label,
}: {
  spaceId: string;
  /** Drives the default label ("Sort N into layers"). */
  unplacedCount?: number;
  /** "untagged" (default) only places Unplaced cards; "all" re-sorts everything. */
  mode?: "untagged" | "all";
  /** Override the computed label. */
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/brainstorm/space/${spaceId}/layers/retag`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(j?.error || `Failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't sort the cards.");
    } finally {
      setBusy(false);
    }
  };

  const text =
    label ??
    (busy
      ? "Sorting into layers…"
      : unplacedCount && unplacedCount > 0
        ? `Sort ${unplacedCount} into ${unplacedCount === 1 ? "its layer" : "layers"}`
        : "Re-sort into layers");

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title="Assign each Unplaced card to the layer it operates at, in place."
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11.5,
          fontWeight: 600,
          letterSpacing: "0.01em",
          padding: "5px 11px",
          borderRadius: 999,
          cursor: busy ? "progress" : "pointer",
          color: busy ? "rgba(15,23,42,0.45)" : "rgba(15,23,42,0.82)",
          background: "rgba(255,255,255,0.9)",
          border: "1px solid rgba(15,23,42,0.12)",
          boxShadow: "0 1px 2px rgba(11,18,40,0.06)",
        }}
      >
        {busy ? (
          <Loader2 size={12.5} className="animate-spin" />
        ) : (
          <Layers size={12.5} strokeWidth={2.1} />
        )}
        {text}
      </button>
      {err && (
        <span style={{ fontSize: 10.5, color: "#e11d48" }}>{err}</span>
      )}
    </div>
  );
}

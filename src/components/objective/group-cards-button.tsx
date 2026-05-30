"use client";

// ── GroupCardsButton ──────────────────────────────────────────────
//
// Runs the nesting pass: POST /cards/group organizes the flat card row
// into a 2-level tree (container cards holding their sub-features),
// writing improvement_goals.container_card_id. Then refreshes so the
// shelves re-render with the nesting. Self-contained, like the re-sort
// button. mode="clear" un-nests everything (the undo).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Loader2 } from "lucide-react";

export function GroupCardsButton({
  spaceId,
  mode = "default",
  label,
}: {
  spaceId: string;
  mode?: "default" | "clear";
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
        `/api/brainstorm/space/${spaceId}/cards/group`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j?.error || `Failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't group the cards.");
    } finally {
      setBusy(false);
    }
  };

  const text =
    label ??
    (busy
      ? mode === "clear"
        ? "Un-nesting…"
        : "Grouping…"
      : mode === "clear"
        ? "Flatten"
        : "Group into features");

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title="Nest sub-feature cards under the container card they belong to."
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
          <Boxes size={12.5} strokeWidth={2.1} />
        )}
        {text}
      </button>
      {err && <span style={{ fontSize: 10.5, color: "#e11d48" }}>{err}</span>}
    </div>
  );
}

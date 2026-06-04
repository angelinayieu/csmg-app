"use client";

// ── RoomPill ──
//
// The always-visible indicator of the current objective/room, with a ＋ to spin
// up a new one. Lives in the top-left nav cluster (see whiteboard-base). Title
// is read live from the on-board objective-card; ＋ creates the user's draft
// objective and navigates to it. Renders as an inline-flex row — the cluster
// positions it; this component owns no absolute coordinates.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useValue, type Editor } from "tldraw";
import { Plus, Compass, Loader2 } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export function RoomPill({ editor }: { editor: Editor }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  // Current objective title — live from the on-board objective-card.
  const title = useValue(
    "room-pill-title",
    () => {
      const obj = editor
        .getCurrentPageShapes()
        .find((s) => s.type === "objective-card");
      const t = (obj?.props as { title?: string } | undefined)?.title;
      return (t && t.trim()) || "Objective";
    },
    [editor],
  );

  async function newObjective() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/objective/draft", { method: "POST" });
      const j = res.ok ? ((await res.json()) as { spaceId?: string }) : null;
      if (j?.spaceId) router.push(`/app/objective/${j.spaceId}`);
    } catch {
      /* best-effort — a failed create just leaves the user where they are */
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={wrap}>
      <div style={pill} title={title}>
        <Compass
          style={{ width: 13, height: 13, color: appleVibe.text.tertiary, flexShrink: 0 }}
          strokeWidth={2.2}
        />
        <span style={label}>{title}</span>
      </div>
      <button
        type="button"
        title="New objective"
        aria-label="New objective"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={newObjective}
        style={plusBtn}
      >
        {creating ? (
          <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
        ) : (
          <Plus style={{ width: 15, height: 15 }} strokeWidth={2.4} />
        )}
      </button>
    </div>
  );
}

const wrap: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontFamily: appleVibe.font.stack,
};
const pill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  maxWidth: 220,
  padding: "7px 12px",
  borderRadius: appleVibe.radius.pill,
  border: "1px solid var(--glass-border)",
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  boxShadow: "inset 0 1px 0 var(--glass-highlight), 0 12px 30px -16px rgba(11,18,40,0.32)",
};
const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 650,
  letterSpacing: "-0.01em",
  color: appleVibe.text.primary,
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
};
const plusBtn: React.CSSProperties = {
  display: "inline-grid",
  placeItems: "center",
  width: 32,
  height: 32,
  borderRadius: 999,
  border: "1px solid var(--glass-border)",
  cursor: "pointer",
  color: appleVibe.text.secondary,
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  boxShadow: "inset 0 1px 0 var(--glass-highlight), 0 12px 30px -16px rgba(11,18,40,0.32)",
};

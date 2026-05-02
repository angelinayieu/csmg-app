"use client";

// ── Lab Room leaderboard chip ──────────────────────────────────────────
//
// Floating chip pinned to the top-right of the Lab Room. Shows the live
// count of variants ranked across all apps in the space, plus a click
// affordance that pops a panel listing the top entries with their
// quality + lift scores.
//
// Why a chip on the room (not in the strategy drawer): the user thinks
// of the leaderboard as a property OF the lab — the place where
// experiments compete. Putting the affordance literally on the Lab
// Room means the user discovers it by exploring the canvas, not by
// hunting through a side panel.
//
// The chip self-hides until the Lab Room exists on canvas (i.e., until
// the pipeline reaches stage="lab"). After that it follows the room's
// position via tldraw's reactive shape state.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEditor, useValue } from "tldraw";
import { Trophy, ChevronDown, Loader2 } from "lucide-react";

interface LeaderboardEntry {
  variantId: string;
  appId: string | null;
  appName: string | null;
  label: string;
  status: string;
  aggregateQuality: number | null;
  aggregateLift: number | null;
  isActive: boolean;
}

interface Props {
  spaceId: string;
}

export function LabLeaderboardChip({ spaceId }: Props) {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Reactively follow the lab room's screen-space position. We
  // recompute on every camera tick so the chip stays glued to the
  // room's top-right corner during pan/zoom.
  const labRoomRect = useValue<{ x: number; y: number; w: number } | null>(
    "lab-room-screen-rect",
    () => {
      if (!editor) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const labRoom = editor
        .getCurrentPageShapes()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .find((s: any) => s.type === "room" && s.props?.stage === "lab");
      if (!labRoom) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = labRoom as any;
      const tlx = editor.pageToScreen({ x: r.x, y: r.y });
      const tlz = editor.getZoomLevel();
      return {
        x: tlx.x,
        y: tlx.y,
        w: (r.props.w as number) * tlz,
      };
    },
    [editor],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/spaces/${spaceId}/leaderboard`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { variants: LeaderboardEntry[] };
      setEntries(Array.isArray(data.variants) ? data.variants : []);
    } catch (err) {
      console.warn("[lab-leaderboard] fetch failed:", err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  // Initial fetch when the lab room first appears, and refresh on
  // window focus so a re-run elsewhere shows up here.
  useEffect(() => {
    if (!labRoomRect) return;
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [labRoomRect, refresh]);

  // Auto-refresh on writer-path event signals (variant_proposed,
  // app_result_ready) so the leaderboard stays live during a run.
  useEffect(() => {
    function onSignal() {
      void refresh();
    }
    window.addEventListener("pipeline-event:variant_proposed", onSignal);
    window.addEventListener("pipeline-event:app_result_ready", onSignal);
    return () => {
      window.removeEventListener("pipeline-event:variant_proposed", onSignal);
      window.removeEventListener("pipeline-event:app_result_ready", onSignal);
    };
  }, [refresh]);

  const total = entries?.length ?? 0;
  const topEntries = useMemo(() => entries?.slice(0, 8) ?? [], [entries]);

  if (!labRoomRect) return null;
  if (!entries) return null; // first fetch still in flight; chip arrives with data

  return (
    <div
      style={{
        position: "fixed",
        // Anchor to the room's top-right corner with a small inset
        left: labRoomRect.x + labRoomRect.w - 220,
        top: labRoomRect.y + 12,
        zIndex: 25,
        pointerEvents: "none",
      }}
    >
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void refresh();
        }}
        disabled={loading}
        style={{
          pointerEvents: "auto",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          borderRadius: 999,
          background: "rgba(255,255,255,0.95)",
          border: "1px solid rgba(236,72,153,0.35)",
          fontSize: 11,
          fontWeight: 700,
          color: "#9d174d",
          cursor: "pointer",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          backdropFilter: "blur(8px)",
        }}
        title={`${total} variant${total === 1 ? "" : "s"} ranked across this space`}
      >
        {loading ? (
          <Loader2 size={11} strokeWidth={2.4} className="animate-spin" />
        ) : (
          <Trophy size={11} strokeWidth={2.4} />
        )}
        Leaderboard
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 20,
            height: 16,
            padding: "0 5px",
            borderRadius: 8,
            background: "#fce7f3",
            color: "#9d174d",
            fontSize: 10,
            fontWeight: 800,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {total}
        </span>
        <ChevronDown
          size={11}
          strokeWidth={2.4}
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 180ms ease",
          }}
        />
      </button>

      {open && (
        <div
          style={{
            pointerEvents: "auto",
            position: "absolute",
            top: 32,
            right: 0,
            width: 320,
            maxHeight: 380,
            overflowY: "auto",
            background: "rgba(255,255,255,0.97)",
            border: "1px solid rgba(15,23,42,0.10)",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(15,23,42,0.10)",
            padding: 8,
            backdropFilter: "blur(12px)",
          }}
        >
          {topEntries.length === 0 && !loading && (
            <div
              style={{
                padding: "16px 12px",
                fontSize: 11.5,
                color: "rgba(15,23,42,0.55)",
                textAlign: "center",
              }}
            >
              No variants scored yet — variants appear here as the lab
              stage scores them.
            </div>
          )}
          {topEntries.map((e, i) => (
            <LeaderRow key={e.variantId} entry={e} rank={i + 1} />
          ))}
          {entries.length > topEntries.length && (
            <div
              style={{
                padding: "8px 12px 4px",
                fontSize: 10.5,
                color: "rgba(15,23,42,0.45)",
              }}
            >
              + {entries.length - topEntries.length} more …
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LeaderRow({ entry, rank }: { entry: LeaderboardEntry; rank: number }) {
  const quality = entry.aggregateQuality;
  const lift = entry.aggregateLift;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 8,
        background: entry.isActive ? "#fef3c7" : "transparent",
      }}
    >
      <span
        style={{
          width: 18,
          textAlign: "center",
          fontSize: 10,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: entry.isActive ? "#92400e" : "rgba(15,23,42,0.45)",
        }}
      >
        {rank}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: "#0a1020",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={entry.label}
        >
          {entry.label}
          {entry.isActive && (
            <span
              style={{
                marginLeft: 6,
                padding: "1px 5px",
                fontSize: 8.5,
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                background: "#fcd34d",
                color: "#78350f",
                borderRadius: 4,
              }}
            >
              Champ
            </span>
          )}
        </div>
        {entry.appName && (
          <div
            style={{
              fontSize: 10,
              color: "rgba(15,23,42,0.5)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={entry.appName}
          >
            {entry.appName}
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: "rgba(15,23,42,0.65)",
        }}
      >
        {typeof quality === "number" && (
          <span title="Aggregate quality (0–1)">{(quality * 100).toFixed(0)}q</span>
        )}
        {typeof lift === "number" && (
          <span
            title="Aggregate lift (%)"
            style={{ color: lift >= 0 ? "#047857" : "#b91c1c" }}
          >
            {lift > 0 ? "+" : ""}
            {lift.toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}

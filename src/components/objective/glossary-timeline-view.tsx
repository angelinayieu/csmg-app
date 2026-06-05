// ── GlossaryTimelineView ────────────────────────────────────────────
//
// "How your glossary was built" — a vertical, time-ordered story of how the
// space's understanding accreted. Self-contained: pass `events` directly
// (preflight / static) OR a `spaceId` to fetch from
// /api/objective/[spaceId]/glossary-timeline.
//
// The user's TASTE events (answers they gave, terms they own) are the heroes —
// rendered warm + emphasized; AI/derived steps recede. Mirrors the app's
// yours / grounded / ai provenance language.

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  HelpCircle,
  Link2,
  Mic,
  Keyboard,
  Wand2,
  CheckCircle2,
  Boxes,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  GlossaryTimelineEvent,
  GlossaryTimelinePhase,
} from "@/lib/objective-canvas/glossary-timeline";

const WARM = "#C2593B"; // the user's own voice / taste
const PHASE: Record<
  GlossaryTimelinePhase,
  { color: string; Icon: LucideIcon; label: string }
> = {
  sharpen: { color: "#475569", Icon: Sparkles, label: "Sharpened" },
  map: { color: "#D97706", Icon: HelpCircle, label: "Ambiguities" },
  reference: { color: "#0D9488", Icon: Link2, label: "Reference" },
  resolve: { color: WARM, Icon: Mic, label: "You answered" },
  define: { color: "#2563EB", Icon: Tag, label: "Term" },
  apply: { color: "#16A34A", Icon: CheckCircle2, label: "Applied" },
  decompose: { color: "#2563EB", Icon: Boxes, label: "Decomposed" },
};

const SOURCE_LABEL: Record<string, string> = {
  user: "yours",
  annotation: "grounded",
  entity: "derived",
  llm: "ai",
  manual: "typed",
  voice: "spoke",
  ai: "AI decided",
  reference: "reference",
  prior_idea: "your idea",
};

/** A row that genuinely carries the user's taste — emphasize it. An
 *  AI-decided resolution is NOT the user's taste (they accepted a default), so
 *  it doesn't get the warm treatment; a typed/spoken answer or a pinned term
 *  does. Keeps the "shaped by you" count honest. */
function isTaste(e: GlossaryTimelineEvent): boolean {
  if (e.phase === "resolve") return e.source !== "ai";
  if (e.phase === "define") return e.provenance === "yours";
  return e.source === "manual" || e.source === "voice";
}

function fmtDay(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}
function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function GlossaryTimelineView({
  events: eventsProp,
  spaceId,
  title = "How your glossary was built",
}: {
  events?: GlossaryTimelineEvent[];
  spaceId?: string;
  title?: string;
}) {
  const [fetched, setFetched] = useState<GlossaryTimelineEvent[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (eventsProp || !spaceId) return;
    let alive = true;
    setLoading(true);
    fetch(`/api/objective/${spaceId}/glossary-timeline`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((j) => {
        if (alive) setFetched(Array.isArray(j.events) ? j.events : []);
      })
      .catch(() => alive && setFetched([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [eventsProp, spaceId]);

  const events = eventsProp ?? fetched ?? [];

  // Day headers: insert a label row whenever the calendar day changes.
  const rows = useMemo(() => {
    const out: Array<
      | { kind: "day"; key: string; label: string }
      | { kind: "event"; key: string; e: GlossaryTimelineEvent }
    > = [];
    let lastDay = "";
    events.forEach((e, i) => {
      const day = fmtDay(e.at);
      if (day && day !== lastDay) {
        lastDay = day;
        out.push({ kind: "day", key: `d-${i}`, label: day });
      }
      out.push({ kind: "event", key: `e-${i}`, e });
    });
    return out;
  }, [events]);

  const tasteCount = useMemo(() => events.filter(isTaste).length, [events]);

  return (
    <div
      style={{
        fontFamily: appleVibe.font.stack,
        color: appleVibe.text.primary,
        maxWidth: 560,
      }}
    >
      <div style={{ marginBottom: 4, fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>
        {title}
      </div>
      <div style={{ marginBottom: 18, fontSize: 12, color: appleVibe.text.tertiary }}>
        {events.length} step{events.length === 1 ? "" : "s"}
        {tasteCount > 0 && (
          <>
            {" · "}
            <span style={{ color: WARM, fontWeight: 600 }}>{tasteCount} shaped by you</span>
          </>
        )}
      </div>

      {loading && events.length === 0 ? (
        <div style={{ fontSize: 13, color: appleVibe.text.tertiary }}>Loading…</div>
      ) : events.length === 0 ? (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: appleVibe.text.tertiary,
            padding: "16px 0",
          }}
        >
          No timeline yet — sharpen an objective and answer a few ambiguities, and
          the story of how each term got its meaning shows up here.
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          {/* the spine */}
          <div
            style={{
              position: "absolute",
              left: 13,
              top: 6,
              bottom: 6,
              width: 2,
              background: appleVibe.stroke.soft,
              borderRadius: 2,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((row) =>
              row.kind === "day" ? (
                <div
                  key={row.key}
                  style={{
                    marginLeft: 40,
                    marginTop: 8,
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: appleVibe.text.faint,
                  }}
                >
                  {row.label}
                </div>
              ) : (
                <EventRow key={row.key} e={row.e} />
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EventRow({ e }: { e: GlossaryTimelineEvent }) {
  const meta = PHASE[e.phase] ?? PHASE.define;
  const taste = isTaste(e);
  // The resolve/voice icon swaps to reflect HOW the user answered.
  const Icon =
    e.phase === "resolve"
      ? e.source === "voice"
        ? Mic
        : e.source === "ai"
          ? Wand2
          : Keyboard
      : meta.Icon;
  const srcLabel = e.source ? SOURCE_LABEL[e.source] ?? e.source : null;

  return (
    <div style={{ position: "relative", display: "flex", gap: 14, alignItems: "flex-start" }}>
      {/* node */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: 999,
          background: appleVibe.surface.card,
          border: `2px solid ${meta.color}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: taste ? `0 0 0 4px ${WARM}1a` : appleVibe.shadow.chip,
        }}
      >
        <Icon style={{ width: 14, height: 14, color: meta.color }} strokeWidth={2.4} />
      </div>

      {/* card */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          background: taste ? `${WARM}0d` : appleVibe.surface.chip,
          border: `1px solid ${taste ? `${WARM}33` : appleVibe.stroke.hairline}`,
          borderRadius: appleVibe.radius.sm,
          padding: "8px 12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: appleVibe.text.primary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {e.title}
          </span>
          <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 10.5, color: appleVibe.text.faint }}>
            {fmtTime(e.at)}
          </span>
        </div>
        {e.detail && (
          <div
            style={{
              marginTop: 3,
              fontSize: 12,
              lineHeight: 1.45,
              color: appleVibe.text.secondary,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {e.detail}
          </div>
        )}
        {srcLabel && (
          <div style={{ marginTop: 5 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.02em",
                textTransform: "uppercase",
                color: taste ? WARM : appleVibe.text.tertiary,
                background: taste ? `${WARM}1a` : appleVibe.surface.chipHover,
                padding: "2px 7px",
                borderRadius: 999,
              }}
            >
              {srcLabel}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

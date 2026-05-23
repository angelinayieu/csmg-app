"use client";

// Probe trail side panel — slides in from the right edge when the
// user clicks Probe on a card. Without a tldraw canvas to host the
// probe-trail shape, we render the trail as a compact tree: origin
// node at top, decompose-step beneath, search-step branches below,
// result-terminal at bottom.
//
// Each search-step node is clickable — clicking fires the standard
// /api/pipeline/research-deep endpoint so the user can deepen any
// branch. Result text streams back into the same node.

import { useEffect, useState } from "react";
import type {
  ProbeTrail,
  ProbeTrailNode,
} from "@/lib/pipeline/probe-orchestrator";
import { colors, tracking } from "./tokens";

interface ProbeTrailSidePanelProps {
  trail: ProbeTrail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

interface ResearchResult {
  status: "idle" | "running" | "done" | "error";
  text?: string;
  message?: string;
}

export function ProbeTrailSidePanel({
  trail,
  loading,
  error,
  onClose,
}: ProbeTrailSidePanelProps) {
  // Per-node research result state — keyed by node id so multiple
  // branches can run independently.
  const [results, setResults] = useState<Record<string, ResearchResult>>({});

  // Esc to dismiss
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Kick off research-deep for a search-step node
  const runResearchDeep = async (node: ProbeTrailNode) => {
    if (!node.question) return;
    setResults((prev) => ({ ...prev, [node.id]: { status: "running" } }));
    try {
      const res = await fetch("/api/pipeline/research-deep", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          focus_areas: [node.question],
          temporal_dimension: node.temporal_dimension ?? undefined,
        }),
      });
      if (!res.ok) {
        setResults((prev) => ({
          ...prev,
          [node.id]: {
            status: "error",
            message: `Research failed (HTTP ${res.status})`,
          },
        }));
        return;
      }
      const body = (await res.json()) as { summary?: string; findings?: unknown };
      setResults((prev) => ({
        ...prev,
        [node.id]: {
          status: "done",
          text:
            body.summary ??
            (Array.isArray(body.findings)
              ? `${body.findings.length} findings landed`
              : "Research complete"),
        },
      }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [node.id]: {
          status: "error",
          message: err instanceof Error ? err.message : "Request threw",
        },
      }));
    }
  };

  // Sort nodes by kind so the visual order is origin → decompose →
  // search → terminal regardless of how the orchestrator stored them.
  const KIND_ORDER: Record<ProbeTrailNode["kind"], number> = {
    "probe-origin": 0,
    "decompose-step": 1,
    "search-step": 2,
    "result-terminal": 3,
  };
  const orderedNodes = trail
    ? [...trail.nodes].sort((a, b) => {
        const ko = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
        if (ko !== 0) return ko;
        return a.id.localeCompare(b.id);
      })
    : [];

  return (
    <div
      className="fixed right-0 top-0 z-40 flex h-full flex-col border-l shadow-2xl"
      style={{
        width: 380,
        background: "white",
        borderColor: colors.neutral.borderFaint,
        boxShadow: colors.neutral.cardShadowFloating,
        // Slide-in transform animated via CSS — see globals.css note;
        // we omit the keyframe here because the right-0 + z-40 already
        // visually anchors. Add a class-based slide animation later.
      }}
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between border-b px-4 py-3"
        style={{ borderColor: colors.neutral.borderFaint }}
      >
        <div>
          <div
            className="text-[9.5px] font-bold uppercase"
            style={{
              color: colors.brand.fg,
              letterSpacing: tracking.eyebrow,
            }}
          >
            ? Probe trail
          </div>
          {trail && (
            <div
              className="mt-0.5 text-[12px] font-semibold text-slate-900"
              title={trail.root_question}
            >
              {trail.source_entity_name}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-[10px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          ✕ Close
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && (
          <div className="text-[11px] text-slate-500">
            Generating probe trail…
          </div>
        )}
        {error && (
          <div
            className="rounded-md px-3 py-2 text-[11px]"
            style={{
              background: colors.state.bottleneckSoft,
              color: colors.state.bottleneckFg,
            }}
          >
            {error}
          </div>
        )}
        {trail && !loading && (
          <div className="flex flex-col gap-2">
            {orderedNodes.map((node) => (
              <TrailNodeCard
                key={node.id}
                node={node}
                result={results[node.id]}
                onResearch={() => runResearchDeep(node)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Single node card ─────────────────────────────────────────────────
function TrailNodeCard({
  node,
  result,
  onResearch,
}: {
  node: ProbeTrailNode;
  result: ResearchResult | undefined;
  onResearch: () => void;
}) {
  const KIND_LABEL: Record<ProbeTrailNode["kind"], string> = {
    "probe-origin": "ORIGIN",
    "decompose-step": "DECOMPOSE",
    "search-step": "QUESTION",
    "result-terminal": "RESULT",
  };
  const KIND_TONE: Record<
    ProbeTrailNode["kind"],
    { bg: string; fg: string; border: string }
  > = {
    "probe-origin": {
      bg: colors.brand.bgChip,
      fg: colors.brand.fgDark,
      border: colors.brand.haloSoft,
    },
    "decompose-step": {
      bg: colors.state.infoChip,
      fg: colors.state.infoFg,
      border: "rgba(8, 145, 178, 0.25)",
    },
    "search-step": {
      bg: colors.state.leverageChip,
      fg: colors.state.leverageFgDark,
      border: "rgba(245, 158, 11, 0.25)",
    },
    "result-terminal": {
      bg: colors.state.okSoft,
      fg: colors.state.okFg,
      border: "rgba(13, 148, 136, 0.25)",
    },
  };
  const t = KIND_TONE[node.kind];
  const isSearch = node.kind === "search-step";

  return (
    <div
      className="overflow-hidden rounded-lg border bg-white"
      style={{ borderColor: t.border }}
    >
      <div className="px-3 py-2">
        <div className="mb-0.5 flex items-center gap-1.5">
          <span
            className="rounded px-1.5 text-[8.5px] font-bold uppercase tracking-wider"
            style={{ background: t.bg, color: t.fg }}
          >
            {KIND_LABEL[node.kind]}
          </span>
          {node.temporal_dimension && node.temporal_dimension !== "none" && (
            <span className="text-[9px] uppercase tracking-wider text-slate-400">
              {node.temporal_dimension}
            </span>
          )}
        </div>
        <div className="text-[11.5px] font-semibold leading-snug text-slate-900">
          {node.label}
        </div>
        {node.question && node.question !== node.label && (
          <div className="mt-1 text-[10.5px] leading-relaxed text-slate-600">
            {node.question}
          </div>
        )}

        {/* Research-deep affordance for search-step nodes */}
        {isSearch && (
          <div className="mt-2">
            {(!result || result.status === "idle") && (
              <button
                type="button"
                onClick={onResearch}
                className="rounded px-2 py-1 text-[10px] font-bold transition-colors"
                style={{
                  background: colors.brand.bgChip,
                  color: colors.brand.fgDark,
                }}
              >
                → Research deep
              </button>
            )}
            {result?.status === "running" && (
              <div className="text-[10px] text-slate-500">
                Searching literature… (may take 30-60s)
              </div>
            )}
            {result?.status === "done" && (
              <div
                className="rounded-md px-2 py-1.5 text-[10.5px] leading-relaxed"
                style={{
                  background: colors.state.okSoft,
                  color: colors.state.okFg,
                }}
              >
                {result.text}
              </div>
            )}
            {result?.status === "error" && (
              <div
                className="rounded-md px-2 py-1.5 text-[10.5px]"
                style={{
                  background: colors.state.bottleneckSoft,
                  color: colors.state.bottleneckFg,
                }}
              >
                {result.message ?? "Research failed"}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

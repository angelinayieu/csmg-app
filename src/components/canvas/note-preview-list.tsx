"use client";

import { FileText } from "lucide-react";
import type { HydratedGroup, HydratedSpan } from "./proposal-rail";
import { canvasScopeColors, type CanvasScopeToken } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

/**
 * Left-column note preview for the proposals page. For each note that has
 * pending proposals, renders the note's anchored spans with inline
 * underlines. The underline color matches the scope of the canvas where
 * the candidate entity lives — so multi-concept notes get visibly
 * distinct colors per concept.
 *
 * This component is intentionally read-only. All actions happen in the
 * ProposalRail on the right. Clicking an underlined span scrolls the
 * rail to the matching card (future enhancement — Sprint 4 wires this
 * with refs).
 *
 * The full tldraw note text isn't available here (the snapshot is opaque
 * client-side JSON), so we reconstruct a synthetic preview from the span
 * offsets + anchored_text. This is good enough for the "which piece of
 * my note is being proposed for what" question; the canvas editor in
 * Sprint 4 will supply the real text and let the rail highlight in place.
 */

export function NotePreviewList({
  groups,
  canvasScope,
}: {
  groups: HydratedGroup[];
  canvasScope: CanvasScopeToken;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 py-14 text-center">
        <FileText className="mx-auto h-6 w-6 text-gray-400" />
        <p className="mt-3 text-sm text-gray-700">
          No pending proposals on this canvas.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Type in a sticky note on the canvas — if the text matches any
          concepts in your memory, proposals will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <NotePreview
          key={group.note_id}
          group={group}
          canvasScope={canvasScope}
        />
      ))}
    </div>
  );
}

function NotePreview({
  group,
  canvasScope,
}: {
  group: HydratedGroup;
  canvasScope: CanvasScopeToken;
}) {
  const pendingSpans = group.spans.filter((s) =>
    s.proposals.some((p) => p.status === "pending"),
  );
  if (pendingSpans.length === 0) return null;

  // Sort spans by start_offset so the preview reads in natural order.
  const sortedSpans = [...pendingSpans].sort(
    (a, b) => (a.start_offset ?? 0) - (b.start_offset ?? 0),
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
        <FileText className="h-3 w-3" />
        Note
        <span className="font-mono text-[10px] text-gray-400">
          {group.note_id.replace(/^shape:/, "").slice(0, 10)}
        </span>
      </div>
      <div className="space-y-3 text-[14px] leading-relaxed text-gray-800">
        {sortedSpans.map((span) => (
          <SpanLine
            key={`${span.start_offset ?? "n"}:${span.end_offset ?? "n"}`}
            span={span}
            canvasScope={canvasScope}
          />
        ))}
      </div>
    </div>
  );
}

function SpanLine({
  span,
  canvasScope,
}: {
  span: HydratedSpan;
  canvasScope: CanvasScopeToken;
}) {
  const pending = span.proposals.filter((p) => p.status === "pending");
  if (pending.length === 0) return null;

  // The underline color reflects the TARGET concept's canvas scope — but
  // target_canvas_title is the most we have server-side. For Sprint 3 we
  // approximate: if target_canvas_id is set, the candidate entity lives
  // on a different canvas, so use project-scope color (most common); if
  // not, use the current canvas's scope color.
  //
  // Sprint 4 will carry target_canvas.scope through so this is exact.
  const underlineScope: CanvasScopeToken = pending.some(
    (p) => !!p.target_canvas_id,
  )
    ? "project"
    : canvasScope;
  const color = canvasScopeColors[underlineScope];

  const text = span.anchored_text ?? "";
  const candidateCount = pending.length;

  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: color.dot }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <span
          className={cn(
            "relative cursor-default",
            "border-b-2",
          )}
          style={{
            borderColor: color.dot,
            background: color.tintBg,
            paddingInline: 2,
            borderRadius: 2,
          }}
          title={pending.map((p) => p.entity_name ?? p.proposed_entity_name ?? "").filter(Boolean).join(" · ")}
        >
          {text}
        </span>
        <div className="mt-1 flex flex-wrap gap-1">
          {pending.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]"
              style={{
                background: color.tintBg,
                color: color.text,
                border: `1px solid ${color.tintBorder}`,
              }}
            >
              <span
                className="inline-block h-1 w-1 rounded-full"
                style={{ background: color.dot }}
              />
              {p.entity_name ?? p.proposed_entity_name ?? "Unknown"}
              {p.entity_space_name && (
                <span className="opacity-60">· {p.entity_space_name}</span>
              )}
            </span>
          ))}
        </div>
        {candidateCount > 1 && (
          <div className="mt-1 text-[10px] text-gray-400">
            {candidateCount} candidates on this span — accept the right one,
            reject the rest.
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

// ── TechSpecCardShape ──
//
// The terminal artifact of a SpecForge run — now an inline-expandable
// document on the whiteboard.
//
//   Collapsed (default): tiny summary card. Same look as before plus an
//   "Expand" chevron.
//
//   Expanded: full spec rendered in place — title + every section as a
//   readable block with a header chip (§Name · v#), per-section [Refine]
//   button, and three op chips: [? Ask] [⇆ Variations] [✨ Improve]. The
//   ops read the user's current text selection inside that section (or
//   whole-section if nothing's selected) and fire SECTION_OP_EVENT, which
//   WhiteboardBase translates into a spec-feedback-card connected back.
//
// Per-section state (pending improvements, version history, last-refined
// timestamp) lives in `sectionMeta` — a JSON-stringified
// Partial<Record<TechSpecSectionId, SectionMeta>>. The Refine button reads
// it; the diff flash uses lastChangedSection + lastChangedAt.
//
// Self-contained (board-bus CustomEvents). Heavy logic stays in
// WhiteboardBase.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import {
  FileText,
  Wand2,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  RotateCw,
  HelpCircle,
  Shuffle,
  Sparkles,
  Send,
  X,
  ExternalLink,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  SECTION_IDS,
  SECTION_LABEL,
  parseSectionMeta,
  sectionToText,
  type TechSpecSectionId,
  type SectionMetaMap,
} from "@/lib/objective-canvas/tech-spec/sections";
import type { TechSpec } from "@/lib/objective-canvas/tech-spec/types";
import type { SpecFeedbackKind } from "./spec-feedback-card-shape";

export const OPEN_TECH_SPEC_EVENT = "objective-board:open-tech-spec";
export const BUILD_PROTOTYPE_EVENT = "objective-board:build-prototype";
export const TOGGLE_TECH_SPEC_EXPAND_EVENT = "objective-board:toggle-tech-spec-expand";
export const REFINE_SECTION_EVENT = "objective-board:refine-section";
export const SECTION_OP_EVENT = "objective-board:section-op";

export interface OpenTechSpecDetail {
  specJson: string;
  markdown: string;
  title: string;
  /** The tech-spec card's id, so the prototype anchors near it. */
  shapeId: string;
}

export interface ToggleTechSpecExpandDetail {
  shapeId: string;
  /** Target value — caller decides; render reads current shape.expanded. */
  expanded: boolean;
}

export interface RefineSectionDetail {
  specCardId: string;
  sectionId: TechSpecSectionId;
  sectionLabel: string;
}

export interface SectionOpDetail {
  specCardId: string;
  sectionId: TechSpecSectionId;
  sectionLabel: string;
  kind: SpecFeedbackKind;
  /** The user's selected text inside the section (may be empty → whole-section). */
  selection: string;
  /** Optional free-text from the user (for ask: the question; else: extra intent). */
  prompt: string;
}

export type TechSpecCardShape = TLBaseShape<
  "tech-spec-card",
  {
    w: number;
    h: number;
    title: string;
    /** Stringified TechSpec (kept as a string prop to avoid a giant validator). */
    specJson: string;
    markdown: string;
    featureCount: number;
    phaseCount: number;
    /** Toggles the collapsed vs. inline-expanded layout. */
    expanded: boolean;
    /** JSON-stringified Partial<Record<TechSpecSectionId, SectionMeta>>. */
    sectionMeta: string;
    /** Which section last got refined — drives the diff flash. */
    lastChangedSection: string;
    /** ms epoch of the last refine — flash decays after ~2s. */
    lastChangedAt: number;
  }
>;

const COLLAPSED_W = 308;
const COLLAPSED_H = 184;
const EXPANDED_W = 640;
const EXPANDED_H = 640;

export class TechSpecCardShapeUtil extends BaseBoxShapeUtil<TechSpecCardShape> {
  static override type = "tech-spec-card" as const;
  static override props: RecordProps<TechSpecCardShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    specJson: T.string,
    markdown: T.string,
    featureCount: T.number,
    phaseCount: T.number,
    expanded: T.boolean,
    sectionMeta: T.string,
    lastChangedSection: T.string,
    lastChangedAt: T.number,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: TechSpecCardShape, info: TLResizeInfo<TechSpecCardShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): TechSpecCardShape["props"] {
    return {
      w: COLLAPSED_W,
      h: COLLAPSED_H,
      title: "Technical Specification",
      specJson: "",
      markdown: "",
      featureCount: 0,
      phaseCount: 0,
      expanded: false,
      sectionMeta: "",
      lastChangedSection: "",
      lastChangedAt: 0,
    };
  }

  component(shape: TechSpecCardShape) {
    return shape.props.expanded ? (
      <ExpandedRenderer shape={shape} />
    ) : (
      <CollapsedRenderer shape={shape} />
    );
  }

  indicator(shape: TechSpecCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

// ── Shared event helpers ─────────────────────────────────────────────

function fireToggleExpand(shapeId: string, current: boolean) {
  window.dispatchEvent(
    new CustomEvent<ToggleTechSpecExpandDetail>(TOGGLE_TECH_SPEC_EXPAND_EVENT, {
      detail: { shapeId, expanded: !current },
    }),
  );
}

function fireOpenSpec(shape: TechSpecCardShape) {
  window.dispatchEvent(
    new CustomEvent<OpenTechSpecDetail>(OPEN_TECH_SPEC_EVENT, {
      detail: {
        specJson: shape.props.specJson,
        markdown: shape.props.markdown,
        title: shape.props.title,
        shapeId: shape.id,
      },
    }),
  );
}

function fireBuildPrototype(shape: TechSpecCardShape) {
  window.dispatchEvent(
    new CustomEvent<OpenTechSpecDetail>(BUILD_PROTOTYPE_EVENT, {
      detail: {
        specJson: shape.props.specJson,
        markdown: shape.props.markdown,
        title: shape.props.title,
        shapeId: shape.id,
      },
    }),
  );
}

// ── Collapsed view (existing summary card) ───────────────────────────

function CollapsedRenderer({ shape }: { shape: TechSpecCardShape }) {
  const { title, featureCount, phaseCount } = shape.props;
  const accent = appleVibe.accent.primary;

  const chips = [
    featureCount > 0 ? `${featureCount} features` : null,
    phaseCount > 0 ? `${phaseCount} phases` : null,
    "UI plan",
  ].filter(Boolean) as string[];

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(248,250,252,0.97) 100%)",
          border: `1px solid ${accent}33`,
          boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 18px 48px -16px ${accent}55, 0 8px 22px -10px rgba(11,18,40,0.16)`,
          padding: "15px 16px 13px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Eyebrow */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <FileText
              style={{ width: 13, height: 13, color: accent }}
              strokeWidth={2.2}
            />
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "0.03em",
                textTransform: "uppercase",
                color: accent,
              }}
            >
              Tech Spec
            </span>
          </div>
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={(e) => {
              e.stopPropagation();
              fireToggleExpand(shape.id, shape.props.expanded);
            }}
            title="Expand on the board"
            aria-label="Expand spec"
            style={{
              padding: 4,
              borderRadius: 8,
              border: "none",
              background: "transparent",
              color: appleVibe.text.tertiary,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <ChevronDown style={{ width: 14, height: 14 }} strokeWidth={2.2} />
          </button>
        </div>

        <div
          style={{
            marginTop: 9,
            fontSize: 16,
            fontWeight: 700,
            lineHeight: 1.22,
            color: appleVibe.text.primary,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {title}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 9 }}>
          {chips.map((c, i) => (
            <span
              key={i}
              style={{
                padding: "3px 9px",
                borderRadius: 999,
                background: `${accent}12`,
                color: appleVibe.text.secondary,
                fontSize: 10.5,
                fontWeight: 600,
              }}
            >
              {c}
            </span>
          ))}
        </div>

        <div style={{ marginTop: "auto", paddingTop: 12, display: "flex", gap: 7 }}>
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={(e) => {
              e.stopPropagation();
              fireToggleExpand(shape.id, shape.props.expanded);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "7px 13px",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              background: accent,
              color: "white",
              fontSize: 11.5,
              fontWeight: 650,
              boxShadow: `0 4px 12px -3px ${accent}88`,
            }}
          >
            Open inline
            <ChevronDown style={{ width: 12, height: 12 }} strokeWidth={2.6} />
          </button>
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={(e) => {
              e.stopPropagation();
              fireBuildPrototype(shape);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "7px 13px",
              borderRadius: 999,
              border: `1px solid ${accent}40`,
              cursor: "pointer",
              background: "rgba(255,255,255,0.7)",
              color: accent,
              fontSize: 11.5,
              fontWeight: 650,
            }}
          >
            <Wand2 style={{ width: 12, height: 12 }} strokeWidth={2.4} />
            Build prototype
          </button>
        </div>
      </div>
    </HTMLContainer>
  );
}

// ── Expanded view: inline document with per-section interaction ──────

function parseSpec(specJson: string): TechSpec | null {
  if (!specJson) return null;
  try {
    return JSON.parse(specJson) as TechSpec;
  } catch {
    return null;
  }
}

function ExpandedRenderer({ shape }: { shape: TechSpecCardShape }) {
  const accent = appleVibe.accent.primary;
  const spec = useMemo(() => parseSpec(shape.props.specJson), [shape.props.specJson]);
  const sectionMeta = useMemo<SectionMetaMap>(
    () => parseSectionMeta(shape.props.sectionMeta),
    [shape.props.sectionMeta],
  );

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(250,251,253,0.98) 100%)",
          border: `1px solid ${accent}22`,
          boxShadow: `0 1px 2px rgba(11,18,40,0.04), 0 24px 64px -20px ${accent}44, 0 12px 32px -16px rgba(11,18,40,0.14)`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "13px 16px 11px",
            borderBottom: `1px solid ${accent}10`,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FileText
              style={{ width: 14, height: 14, color: accent }}
              strokeWidth={2.2}
            />
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: accent,
              }}
            >
              Tech Spec
            </span>
            <span style={{ color: "rgba(15,23,42,0.18)", fontSize: 11 }}>·</span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 650,
                color: appleVibe.text.primary,
                maxWidth: shape.props.w - 240,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {shape.props.title}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={(e) => {
                e.stopPropagation();
                fireOpenSpec(shape);
              }}
              title="Open as full-screen page"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "5px 9px",
                borderRadius: 8,
                border: `1px solid ${accent}28`,
                background: "rgba(255,255,255,0.7)",
                color: appleVibe.text.secondary,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <ExternalLink style={{ width: 11, height: 11 }} strokeWidth={2.2} />
              Page
            </button>
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={(e) => {
                e.stopPropagation();
                fireBuildPrototype(shape);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "5px 10px",
                borderRadius: 8,
                border: "none",
                background: accent,
                color: "white",
                fontSize: 11,
                fontWeight: 650,
                cursor: "pointer",
                boxShadow: `0 3px 10px -2px ${accent}66`,
              }}
            >
              <Wand2 style={{ width: 11, height: 11 }} strokeWidth={2.4} />
              Prototype
            </button>
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={(e) => {
                e.stopPropagation();
                fireToggleExpand(shape.id, shape.props.expanded);
              }}
              title="Collapse"
              aria-label="Collapse spec"
              style={{
                padding: 4,
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: appleVibe.text.tertiary,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <ChevronUp style={{ width: 15, height: 15 }} strokeWidth={2.2} />
            </button>
          </div>
        </div>

        {/* Sections */}
        <div
          onPointerDown={stopEventPropagation}
          onWheelCapture={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 18px 22px",
          }}
        >
          {spec ? (
            SECTION_IDS.map((id) => (
              <SectionBlock
                key={id}
                spec={spec}
                sectionId={id}
                meta={sectionMeta[id]}
                shape={shape}
                accent={accent}
              />
            ))
          ) : (
            <div
              style={{
                color: appleVibe.text.tertiary,
                fontSize: 13,
                padding: "20px 0",
              }}
            >
              (No spec data — open the page view to inspect.)
            </div>
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}

// ── Section block (per-section header + body + ops) ───────────────────

const KIND_META: Record<
  SpecFeedbackKind,
  { label: string; color: string; Icon: typeof HelpCircle; needsPrompt: boolean }
> = {
  ask: { label: "Ask", color: "#3B82F6", Icon: HelpCircle, needsPrompt: true },
  variations: { label: "Variations", color: "#8B5CF6", Icon: Shuffle, needsPrompt: false },
  improve: { label: "Improve", color: "#10B981", Icon: Sparkles, needsPrompt: false },
};

function SectionBlock({
  spec,
  sectionId,
  meta,
  shape,
  accent,
}: {
  spec: TechSpec;
  sectionId: TechSpecSectionId;
  meta: SectionMetaMap[TechSpecSectionId];
  shape: TechSpecCardShape;
  accent: string;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState("");
  const [pendingOp, setPendingOp] = useState<SpecFeedbackKind | null>(null);

  const text = useMemo(() => sectionToText(spec, sectionId), [spec, sectionId]);
  const version = meta?.versions.length ?? 0;
  const pendingCount = meta?.pending.length ?? 0;
  const isChanged =
    shape.props.lastChangedSection === sectionId &&
    Date.now() - shape.props.lastChangedAt < 2000;

  // Decay the diff flash by forcing a re-render after 2s.
  const [, force] = useState(0);
  useEffect(() => {
    if (!isChanged) return;
    const t = setTimeout(() => force((n) => n + 1), 2050);
    return () => clearTimeout(t);
  }, [isChanged]);

  const readSelection = useCallback((): string => {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!sel || sel.isCollapsed) return "";
    const text = sel.toString().trim();
    if (!text) return "";
    // Only count if the selection's anchor is inside this section's body.
    const node = sel.anchorNode;
    if (node && bodyRef.current && bodyRef.current.contains(node)) {
      return text;
    }
    return "";
  }, []);

  const fireOp = useCallback(
    (kind: SpecFeedbackKind, prompt: string) => {
      const selection = readSelection();
      window.dispatchEvent(
        new CustomEvent<SectionOpDetail>(SECTION_OP_EVENT, {
          detail: {
            specCardId: shape.id,
            sectionId,
            sectionLabel: SECTION_LABEL[sectionId],
            kind,
            selection,
            prompt,
          },
        }),
      );
      setPendingOp(kind);
      setAskOpen(false);
      setAskText("");
      // Clear pending indicator after a short delay (the actual feedback card
      // arrives via WhiteboardBase; this is just a UI ack).
      setTimeout(() => setPendingOp(null), 1200);
    },
    [readSelection, shape.id, sectionId],
  );

  function onRefine(e: React.MouseEvent) {
    e.stopPropagation();
    if (!pendingCount) return;
    window.dispatchEvent(
      new CustomEvent<RefineSectionDetail>(REFINE_SECTION_EVENT, {
        detail: {
          specCardId: shape.id,
          sectionId,
          sectionLabel: SECTION_LABEL[sectionId],
        },
      }),
    );
  }

  return (
    <section
      data-section-id={sectionId}
      style={{
        marginTop: 16,
        padding: "10px 12px 12px",
        borderRadius: 14,
        background: isChanged ? "rgba(16,185,129,0.07)" : "transparent",
        border: isChanged
          ? `1px solid rgba(16,185,129,0.28)`
          : "1px solid transparent",
        transition: "background 1.6s ease-out, border-color 1.6s ease-out",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: accent,
          }}
        >
          §{SECTION_LABEL[sectionId]}
        </span>
        {version > 0 && (
          <span
            style={{
              padding: "1.5px 7px",
              borderRadius: 999,
              background: appleVibe.surface.chip,
              color: appleVibe.text.tertiary,
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            v{version + 1}
          </span>
        )}
        {pendingCount > 0 && (
          <span
            style={{
              padding: "1.5px 7px",
              borderRadius: 999,
              background: "rgba(16,185,129,0.12)",
              color: "#0F8F5C",
              fontSize: 10,
              fontWeight: 700,
            }}
            title={`${pendingCount} improvement${pendingCount === 1 ? "" : "s"} queued`}
          >
            +{pendingCount} pending
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onPointerDown={stopEventPropagation}
          onClick={onRefine}
          disabled={!pendingCount}
          title={
            pendingCount
              ? `Refine §${SECTION_LABEL[sectionId]} (apply ${pendingCount} pending)`
              : "No pending improvements"
          }
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 9px",
            borderRadius: 999,
            border: `1px solid ${pendingCount ? accent + "30" : "rgba(15,23,42,0.06)"}`,
            background: pendingCount ? "rgba(255,255,255,0.92)" : "transparent",
            color: pendingCount ? accent : appleVibe.text.faint,
            fontSize: 10.5,
            fontWeight: 650,
            cursor: pendingCount ? "pointer" : "not-allowed",
            opacity: pendingCount ? 1 : 0.55,
          }}
        >
          <RotateCw style={{ width: 11, height: 11 }} strokeWidth={2.3} />
          Refine
        </button>
        {/* Op chips */}
        {(["ask", "variations", "improve"] as const).map((k) => {
          const m = KIND_META[k];
          const Icon = m.Icon;
          const active = pendingOp === k;
          return (
            <button
              key={k}
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={(e) => {
                e.stopPropagation();
                if (m.needsPrompt) {
                  setAskOpen((v) => !v);
                } else {
                  fireOp(k, "");
                }
              }}
              title={
                k === "ask"
                  ? "Ask a question about this section (selection used if present)"
                  : k === "variations"
                    ? "Generate 2–3 alternative formulations"
                    : "Propose a concrete improvement"
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                padding: "4px 8px",
                borderRadius: 999,
                border: `1px solid ${m.color}30`,
                background: active ? `${m.color}18` : "rgba(255,255,255,0.92)",
                color: m.color,
                fontSize: 10.5,
                fontWeight: 650,
                cursor: "pointer",
              }}
            >
              <Icon style={{ width: 10.5, height: 10.5 }} strokeWidth={2.3} />
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Ask input */}
      {askOpen && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 8,
            padding: "5px 6px 5px 10px",
            borderRadius: 12,
            border: `1px solid ${KIND_META.ask.color}30`,
            background: "rgba(255,255,255,0.96)",
          }}
        >
          <HelpCircle
            style={{ width: 12, height: 12, color: KIND_META.ask.color }}
            strokeWidth={2.3}
          />
          <input
            type="text"
            value={askText}
            onChange={(e) => setAskText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (askText.trim()) fireOp("ask", askText.trim());
              } else if (e.key === "Escape") {
                e.preventDefault();
                setAskOpen(false);
                setAskText("");
              }
            }}
            onPointerDown={stopEventPropagation}
            placeholder={`Ask about §${SECTION_LABEL[sectionId]}…`}
            autoFocus
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 12,
              color: appleVibe.text.primary,
              fontFamily: appleVibe.font.stack,
              minWidth: 0,
            }}
          />
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={(e) => {
              e.stopPropagation();
              if (askText.trim()) fireOp("ask", askText.trim());
            }}
            disabled={!askText.trim()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: 5,
              borderRadius: 8,
              border: "none",
              background: askText.trim() ? KIND_META.ask.color : "rgba(15,23,42,0.05)",
              color: askText.trim() ? "white" : appleVibe.text.faint,
              cursor: askText.trim() ? "pointer" : "not-allowed",
            }}
          >
            <Send style={{ width: 11, height: 11 }} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={(e) => {
              e.stopPropagation();
              setAskOpen(false);
              setAskText("");
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: 5,
              borderRadius: 8,
              border: "none",
              background: "transparent",
              color: appleVibe.text.tertiary,
              cursor: "pointer",
            }}
          >
            <X style={{ width: 11, height: 11 }} strokeWidth={2.4} />
          </button>
        </div>
      )}

      {/* Body */}
      <div
        ref={bodyRef}
        style={{
          marginTop: 9,
          fontSize: 13,
          lineHeight: 1.55,
          color: appleVibe.text.primary,
          whiteSpace: "pre-wrap",
          userSelect: "text",
        }}
      >
        {text || (
          <span style={{ color: appleVibe.text.faint, fontStyle: "italic" }}>
            (empty section)
          </span>
        )}
      </div>
    </section>
  );
}

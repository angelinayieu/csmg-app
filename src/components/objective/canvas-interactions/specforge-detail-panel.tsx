"use client";

// ── SpecForge Side Panel (right-edge glass drawer) ───────────────────
//
// Per specforge_side_panel_interaction_system.md §5: the panel structure
// is consistent across every node — Header → Why It Matters → Current
// Content → Layer Context → Constraints → Actions → Quality status.
//
// Open via OPEN_SPECFORGE_DETAIL_EVENT { shapeId }, fired by:
//   - specforge-card double-click
//   - operation-lane row "Inspect" button
//
// Reads everything from the shape props + shape.meta — no API call, no
// dependency on Phase A's migration (which may not be applied yet).
// Soft-degrades when a card lacks engineRunId or critic data.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Editor, TLShapeId } from "tldraw";
import { X, ArrowRight, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { SpecForgeCardShape } from "../shapes/specforge-card-shape";
import {
  ENGINE_LABEL,
  PHASE_LABEL,
  PHASE_OF_ENGINE,
  STAGE_META,
  type SpecForgeEngineId,
  type SpecForgeStage,
} from "@/lib/objective-canvas/specforge/types";
import {
  OPEN_SPECFORGE_DETAIL_EVENT,
  PANEL_ACTIONS,
  SPECFORGE_PANEL_ACTION_EVENT,
  WHY_IT_MATTERS,
  type PanelAction,
  type PanelActionDetail,
} from "@/lib/objective-canvas/specforge/panel-actions";

const PANEL_WIDTH = 380;

interface OpenDetail {
  shapeId: string;
}

interface PanelState {
  shape: SpecForgeCardShape | null;
  engine: SpecForgeEngineId | null;
}

/** Read SpecForge metadata defensively — `meta` is unknown JSON so each
 *  field is narrowed before use. Returns nulls on missing data instead
 *  of throwing. */
interface SpecForgeMeta {
  engine: SpecForgeEngineId | null;
  gateStatus: "passed" | "repaired" | "failed" | null;
  gateScore: number | null;
}
function readMeta(shape: SpecForgeCardShape): SpecForgeMeta {
  const m = (shape.meta ?? {}) as Record<string, unknown>;
  const engine = typeof m.engine === "string" ? (m.engine as SpecForgeEngineId) : null;
  const gateRaw = typeof m.gateStatus === "string" ? m.gateStatus : null;
  const gateStatus =
    gateRaw === "passed" || gateRaw === "repaired" || gateRaw === "failed"
      ? gateRaw
      : null;
  const gateScore = typeof m.gateScore === "number" ? m.gateScore : null;
  return { engine, gateStatus, gateScore };
}

export function SpecForgeDetailPanel({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PanelState>({ shape: null, engine: null });
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Open via event — re-reads the shape fresh each time so the panel
  // never shows a stale snapshot if the user navigated between cards.
  useEffect(() => {
    function onOpen(e: Event) {
      const d = (e as CustomEvent<OpenDetail>).detail;
      if (!d?.shapeId) return;
      const shape = editor.getShape(d.shapeId as TLShapeId);
      if (!shape || shape.type !== "specforge-card") return;
      const sf = shape as SpecForgeCardShape;
      const { engine } = readMeta(sf);
      if (!engine) return;
      setState({ shape: sf, engine });
      setOpen(true);
      // Focus the close button so Escape closes via keyboard immediately.
      window.setTimeout(() => closeBtnRef.current?.focus(), 40);
    }
    window.addEventListener(OPEN_SPECFORGE_DETAIL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SPECFORGE_DETAIL_EVENT, onOpen);
  }, [editor]);

  // Esc to close (matches existing drawer / popup conventions on the board).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Close if the selected shape is deleted from the board (board → panel sync).
  useEffect(() => {
    if (!open || !state.shape) return;
    const id = state.shape.id;
    const t = window.setInterval(() => {
      if (!editor.getShape(id)) setOpen(false);
    }, 500);
    return () => window.clearInterval(t);
  }, [open, state.shape, editor]);

  const actions = useMemo<PanelAction[]>(() => {
    if (!state.engine) return [];
    return PANEL_ACTIONS[state.engine];
  }, [state.engine]);

  const fire = useCallback(
    (action: PanelAction) => {
      if (!state.shape || !state.engine || !action.enabled) return;
      setBusyAction(action.id);
      const detail: PanelActionDetail = {
        shapeId: String(state.shape.id),
        engine: state.engine,
        engineRunId: state.shape.props.engineRunId || null,
        actionId: action.id,
      };
      window.dispatchEvent(new CustomEvent(action.eventName, { detail }));
      // Visual "fired" feedback — handlers come in a follow-up; for now
      // we just let the user see the click landed.
      window.setTimeout(() => setBusyAction(null), 600);
    },
    [state.shape, state.engine],
  );

  if (!open || !state.shape || !state.engine) return null;

  const meta = readMeta(state.shape);
  const stage = state.shape.props.stage as SpecForgeStage;
  const stageMeta = STAGE_META[stage] ?? STAGE_META.input;
  const phase = PHASE_OF_ENGINE[state.engine];
  const phaseLabel = PHASE_LABEL[phase];

  const bodyLines = state.shape.props.body
    ? state.shape.props.body
        .split("\n")
        .map((l) => l.replace(/^•\s*/, "").trim())
        .filter(Boolean)
    : [];

  return (
    <div
      role="dialog"
      aria-label={`Inspect ${ENGINE_LABEL[state.engine]}`}
      style={panelStyle}
    >
      {/* Accent strip mirrors the card's stage color so the panel reads
          as a continuation of the selected card, not a separate surface. */}
      <div style={{ ...accentStrip, background: stageMeta.color }} />

      {/* Header — title + close button + engine label + act/phase */}
      <div style={headerRow}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ ...stageDot, background: stageMeta.color }} />
            <span style={engineEyebrow}>{ENGINE_LABEL[state.engine]}</span>
          </div>
          <div style={titleStyle}>{state.shape.props.title || "Decision"}</div>
          <div style={subtitleMeta}>
            <span>{phaseLabel}</span>
            <span style={metaDot} />
            <span>{stageMeta.label}</span>
            {meta.gateStatus && (
              <>
                <span style={metaDot} />
                <GateChip status={meta.gateStatus} score={meta.gateScore} />
              </>
            )}
          </div>
        </div>
        <button
          ref={closeBtnRef}
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close inspect panel"
          style={closeBtn}
        >
          <X style={{ width: 16, height: 16 }} strokeWidth={2.4} />
        </button>
      </div>

      {/* Scrollable content */}
      <div style={scrollWrap}>
        {/* Why It Matters — spec §7 */}
        <Section title="Why this matters">
          <p style={bodyText}>{WHY_IT_MATTERS[state.engine]}</p>
        </Section>

        {/* Current content — spec §8 */}
        {state.shape.props.subtitle && (
          <Section title="Headline">
            <p style={{ ...bodyText, color: appleVibe.text.primary, fontWeight: 540 }}>
              {state.shape.props.subtitle}
            </p>
          </Section>
        )}

        {bodyLines.length > 0 && (
          <Section title="Current content">
            <ul style={bulletList}>
              {bodyLines.slice(0, 8).map((line, i) => (
                <li key={i} style={bulletItem}>
                  {line}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Layer context — spec §9 */}
        <Section title="Layer">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <ChainSpine engine={state.engine} accent={stageMeta.color} />
          </div>
        </Section>

        {/* Actions — spec §12–§23. All actions render with a "next" pill
            until their handler ships; honest UX over false positives. */}
        <Section title={actions.some((a) => a.enabled) ? "Actions" : "Actions · coming next"}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {actions.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={!a.enabled || busyAction === a.id}
                onClick={() => fire(a)}
                style={{
                  ...actionRow,
                  opacity: a.enabled ? 1 : 0.55,
                  cursor: a.enabled ? "pointer" : "default",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                  <div style={actionLabel}>{a.label}</div>
                  {a.hint && <div style={actionHint}>{a.hint}</div>}
                </div>
                {busyAction === a.id ? (
                  <Loader2
                    className="animate-spin"
                    style={{ width: 14, height: 14, color: appleVibe.text.faint }}
                  />
                ) : !a.enabled ? (
                  <span style={soonPill}>next</span>
                ) : (
                  <ArrowRight
                    style={{ width: 14, height: 14, color: appleVibe.text.tertiary }}
                    strokeWidth={2}
                  />
                )}
              </button>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={sectionLabel}>{title}</div>
      {children}
    </section>
  );
}

function GateChip({
  status,
  score,
}: {
  status: "passed" | "repaired" | "failed";
  score: number | null;
}) {
  const palette = {
    passed: { bg: "rgba(34,197,94,0.12)", fg: "#15803D", icon: ShieldCheck },
    repaired: { bg: "rgba(245,158,11,0.14)", fg: "#B45309", icon: AlertTriangle },
    failed: { bg: "rgba(239,68,68,0.14)", fg: "#B91C1C", icon: AlertTriangle },
  }[status];
  const Icon = palette.icon;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 6px",
        borderRadius: 999,
        background: palette.bg,
        color: palette.fg,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.02em",
      }}
    >
      <Icon style={{ width: 9, height: 9 }} strokeWidth={2.6} />
      {status === "passed"
        ? `PASSED${score !== null ? ` · ${Math.round(score)}` : ""}`
        : status === "repaired"
          ? `REPAIRED${score !== null ? ` · ${Math.round(score)}` : ""}`
          : `FLAGGED`}
    </span>
  );
}

/** Tiny breadcrumb of the engine's neighbors in the chain — gives the
 *  user "where am I in the spec" without leaving the panel. */
function ChainSpine({ engine, accent }: { engine: SpecForgeEngineId; accent: string }) {
  const phase = PHASE_OF_ENGINE[engine];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 10px",
        borderRadius: 10,
        background: "rgba(15,23,42,0.04)",
      }}
    >
      <span style={{ ...chainDot, background: accent }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: appleVibe.text.primary }}>
        {PHASE_LABEL[phase]}
      </span>
      <span style={{ fontSize: 11, color: appleVibe.text.tertiary }}>
        / {ENGINE_LABEL[engine]}
      </span>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const panelStyle: CSSProperties = {
  position: "absolute",
  right: 18,
  top: 80,
  bottom: 24,
  width: PANEL_WIDTH,
  zIndex: 95,
  display: "flex",
  flexDirection: "column",
  borderRadius: 18,
  background: "var(--glass-float-bg, rgba(255,255,255,0.96))",
  backdropFilter: "blur(var(--blur-float, 22px)) saturate(1.6)",
  WebkitBackdropFilter: "blur(var(--blur-float, 22px)) saturate(1.6)",
  border: "1px solid rgba(15,23,42,0.08)",
  boxShadow: "0 16px 40px -10px rgba(15,23,42,0.18), 0 6px 14px -6px rgba(15,23,42,0.08)",
  overflow: "hidden",
};

const accentStrip: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  bottom: 0,
  width: 3,
  borderRadius: "999px 0 0 999px",
};

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "16px 14px 14px 18px",
  borderBottom: "1px solid rgba(15,23,42,0.05)",
};

const stageDot: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: 999,
  flexShrink: 0,
};

const chainDot: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 999,
  flexShrink: 0,
};

const engineEyebrow: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  color: appleVibe.text.tertiary,
};

const titleStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 620,
  lineHeight: 1.3,
  color: appleVibe.text.primary,
  overflow: "hidden",
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
};

const subtitleMeta: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  color: appleVibe.text.tertiary,
  fontWeight: 500,
};

const metaDot: CSSProperties = {
  width: 3,
  height: 3,
  borderRadius: 999,
  background: appleVibe.text.faint,
};

const closeBtn: CSSProperties = {
  flexShrink: 0,
  width: 28,
  height: 28,
  borderRadius: 8,
  border: "none",
  background: "transparent",
  color: appleVibe.text.tertiary,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const scrollWrap: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "14px 18px 18px 18px",
};

const sectionLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: appleVibe.text.faint,
  marginBottom: 6,
};

const bodyText: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  color: appleVibe.text.secondary,
  margin: 0,
};

const bulletList: CSSProperties = {
  margin: 0,
  paddingLeft: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: 5,
};

const bulletItem: CSSProperties = {
  position: "relative",
  paddingLeft: 14,
  fontSize: 12.5,
  lineHeight: 1.45,
  color: appleVibe.text.secondary,
};

const actionRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "9px 12px",
  borderRadius: 11,
  border: "1px solid rgba(15,23,42,0.07)",
  background: "rgba(255,255,255,0.7)",
  textAlign: "left",
  transition: "all 140ms ease-out",
};

const actionLabel: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 580,
  color: appleVibe.text.primary,
  lineHeight: 1.3,
};

const actionHint: CSSProperties = {
  fontSize: 11,
  color: appleVibe.text.tertiary,
  lineHeight: 1.35,
};

const soonPill: CSSProperties = {
  padding: "1px 7px",
  borderRadius: 999,
  background: "rgba(15,23,42,0.06)",
  color: appleVibe.text.faint,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

"use client";

// ── PowerupRail ──
//
// The persistent right-edge home for the canvas AI actions + a view of finished
// artifacts. One filterable list: "Flows" (composite multi-step actions, hero
// Forge included) pinned above "Operations" (single-shot transforms on the
// selection). Modeled on LibraryLauncher (launcher pill → closable right-aligned
// rail). Mounted once in WhiteboardBase.

import { useEffect, useState, type CSSProperties } from "react";
import { usePanel, setPanel } from "@/lib/objective-canvas/board-panel-signal";
import { useValue, type Editor } from "tldraw";
import {
  Wand2,
  Shuffle,
  HelpCircle,
  ListChecks,
  Loader2,
  Package,
  X,
} from "@/lib/cute-icons";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  type OperationTarget,
} from "@/lib/objective-canvas/canvas-operations";
import { VERBS } from "@/lib/objective-canvas/verbs";
import { executeCardOperation } from "./operation-executor";
import { shapeToScanTarget } from "./shape-node-adapter";
import { labelFor } from "@/components/objective/favorites-sidebar";
import {
  getAiSettings,
  AI_SETTINGS_EVENT,
  type AiSettings,
} from "@/lib/objective-canvas/ai-settings";
import { pushRightPanel } from "@/lib/objective-canvas/right-panel-signal";

/** Fired by the rail's Forge button → WhiteboardBase runs the SpecForge chain
 *  on the current selection (handleForge lives there, with editor + state). */
export const FORGE_REQUEST_EVENT = "objective-board:forge-request";
/** Dispatched by WhiteboardBase with `detail: { running: boolean }` so the rail
 *  can mirror Forge busy-state — disable the button + show a spinner — without
 *  having to share React state across the editor/rail boundary. */
export const FORGE_STATE_EVENT = "objective-board:forge-state";

// ── The five verbs (issue #17) ──
// The rail no longer carries its own vocabulary. It renders the registry in
// lib/objective-canvas/verbs.ts: four thinking moves that ARE the diamond,
// plus Make. Widen/Focus resolve to the diverge/converge ops — those stay
// `hidden` in the catalog (so the legacy scanner rows don't double up), but
// executeCardOperation dispatches by id and ignores `hidden`, so the verb
// layer drives them directly.
const THINK_VERBS = VERBS.filter((v) => !v.gated);
const MAKE_VERB = VERBS.find((v) => v.id === "make")!;

const VERB_ICON: Record<string, typeof Package> = {
  widen: Shuffle,
  focus: ListChecks,
  deepen: Package,
  test: HelpCircle,
  make: Wand2,
};

// Only the two diamond verbs carry a tint — Widen opens the space, Focus
// closes it. Deepen/Test are phase-neutral and stay neutral. Reuses the stage
// tokens rather than inventing a phase palette.
const VERB_TINT: Record<string, CSSProperties> = {
  widen: {
    background: "color-mix(in srgb, var(--av-stage-features) 13%, transparent)",
    color: "var(--av-stage-features)",
  },
  focus: {
    background: "color-mix(in srgb, var(--av-stage-process) 13%, transparent)",
    color: "var(--av-stage-process)",
  },
};

// Accent for the hero (Forge) — the one tinted color in the rail. A muted
// indigo so it reads as "primary action" without screaming. Reserved for the
// hero; every other surface stays neutral so the hero is the only colored row.
const ACCENT = "rgb(79, 70, 229)"; // indigo-600
const ACCENT_SOFT = "rgba(79, 70, 229, 0.08)";
const ACCENT_BORDER = "rgba(79, 70, 229, 0.32)";
const ACCENT_GLOW =
  "0 0 0 1px rgba(79,70,229,0.18) inset, 0 14px 32px -14px rgba(79,70,229,0.45)";

export function PowerupRail({
  spaceId,
  editor,
}: {
  spaceId: string;
  editor: Editor;
}) {
  // Open state is shared via the board-panel signal — the trigger now lives in
  // BoardTopRightBar (which also reflects this as an active highlight) and the
  // rail opens below that bar. No more shoving the style palette aside.
  const open = usePanel("powerups");
  const setOpen = (v: boolean) => setPanel("powerups", v);

  // Live selection — WHAT the actions will run on (single or multi/lasso).
  const sel = useValue(
    "powerup-selection",
    () => {
      const shapes = editor.getSelectedShapes();
      const targets = shapes
        .map(shapeToScanTarget)
        .filter((t): t is OperationTarget => !!t);
      // Single-card selection: surface the source kind so the rail can hide
      // ops that don't fit (e.g. Variations on a mechanism step). A multi-
      // selection collapses to "mixed" → no kind-filter applies (full list).
      const sourceKind =
        targets.length === 1 ? targets[0].sourceKind : undefined;
      return {
        labels: shapes.map((s) => labelFor(s)),
        text: targets.map((t) => t.text).join("\n\n"),
        anchorId: targets[0]?.shapeId,
        count: targets.length,
        sourceKind,
      };
    },
    [editor],
  );


  // AI settings (live — shared with the popup + top bar).
  const [settings, setSettings] = useState<AiSettings>(() => getAiSettings());
  useEffect(() => {
    const h = () => setSettings(getAiSettings());
    window.addEventListener(AI_SETTINGS_EVENT, h);
    return () => window.removeEventListener(AI_SETTINGS_EVENT, h);
  }, []);

  // While open, signal the other right-edge chrome (Notebook pill) to hide.
  useEffect(() => {
    if (!open) return;
    return pushRightPanel();
  }, [open]);

  // Forge busy mirror — WhiteboardBase owns the actual SpecForge run; we
  // listen so the button can disable itself + show a spinner. Optimistically
  // flip true on click so a fast double-click can't queue a second run before
  // WhiteboardBase's state catches up.
  const [forging, setForging] = useState(false);
  useEffect(() => {
    const onState = (e: Event) => {
      const ce = e as CustomEvent<{ running?: boolean }>;
      setForging(!!ce.detail?.running);
    };
    window.addEventListener(FORGE_STATE_EVENT, onState);
    return () => window.removeEventListener(FORGE_STATE_EVENT, onState);
  }, []);

  // New objective → drop a fresh chatbox-card onto the board (the SAME card
  // intake mounts). The user types into it directly; on submit the chatbox
  const [running, setRunning] = useState<string | null>(null);
  function runOp(opId: string, prompt?: string) {
    if (sel.count === 0 || running) return;
    const target: OperationTarget = {
      text: sel.text,
      shapeId: sel.anchorId,
      sourceKind: sel.sourceKind,
    };
    setRunning(opId);
    void executeCardOperation(editor, target, opId, {
      temperature: settings.temperature,
      depth: settings.depth,
      questionCount: settings.complexity,
      webSearch: settings.webSearch,
      prompt,
      spaceId,
    }).finally(() => setRunning((c) => (c === opId ? null : c)));
  }

  // Headless when closed — the trigger lives in BoardTopRightBar.
  if (!open) return null;

  const hasSel = sel.count > 0;
  return (
    <div onPointerDown={(e) => e.stopPropagation()} style={rail}>
      <div style={header}>
        <Sparkle
          style={{ width: 15, height: 15, color: appleVibe.text.secondary }}
          strokeWidth={2.2}
        />
        <span style={titleText}>Actions</span>
        <button
          type="button"
          title="Close"
          onClick={() => setOpen(false)}
          style={{ ...iconBtn, marginLeft: "auto" }}
        >
          <X style={{ width: 15, height: 15 }} strokeWidth={2.2} />
        </button>
      </div>

      <div style={scroll}>
        {/* Single muted helper — replaces the old "APPLIES TO" caps eyebrow +
            its second helper sentence. One line of meta, not two. */}
        <div style={helperLine}>
          {hasSel
            ? `${sel.count} item${sel.count === 1 ? "" : "s"} selected`
            : "Select cards, then run an action."}
        </div>
        {hasSel && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
            {sel.labels.slice(0, 8).map((l, i) => (
              <span key={i} style={chip}>
                {l}
              </span>
            ))}
            {sel.labels.length > 8 && (
              <span style={chip}>+{sel.labels.length - 8}</span>
            )}
          </div>
        )}

        {/* THINK — the four thinking moves. These ARE the diamond: Widen
            opens the space, Focus closes it, Deepen and Test work either
            half. Each row resolves to an existing canvas op via the verb
            registry, so the rail stopped inventing its own vocabulary. */}
        <div style={{ marginTop: hasSel ? 14 : 12 }}>
          <div style={sectionLabel}>THINK</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {THINK_VERBS.map((v) => {
              const opId = v.target.kind === "op" ? v.target.op : "";
              const Icon = VERB_ICON[v.id] ?? Sparkle;
              const isRunning = running === opId;
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={!hasSel || !!running}
                  title={hasSel ? v.prompt : "Select a card first"}
                  onClick={() => runOp(opId)}
                  style={{ ...opRow, opacity: hasSel ? 1 : 0.55 }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = appleVibe.surface.chipHover)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span style={{ ...opIconWrap, ...(VERB_TINT[v.id] ?? {}) }}>
                    {isRunning ? (
                      <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
                    ) : (
                      <Icon style={{ width: 13, height: 13 }} strokeWidth={2} />
                    )}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={opLabel}>{v.label}</span>
                    <span style={opIntent}>{v.prompt}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* BUILD — Make. Keeps the accent-tinted hero treatment Forge had:
            the one coloured row in the panel. The maturity gate ("you do not
            get to build until you understand") lands with the global-questions
            slice; until those exist there is nothing to gate on, so Make
            behaves exactly as Forge did and this slice regresses nothing. */}
        <div style={hairline} />
        <div style={sectionLabel}>BUILD</div>
        <button
          type="button"
          disabled={!hasSel || forging}
          aria-busy={forging}
          title={forging ? "Working…" : MAKE_VERB.prompt}
          onClick={() => {
            if (forging || !hasSel) return;
            setForging(true);
            window.dispatchEvent(new CustomEvent(FORGE_REQUEST_EVENT));
          }}
          style={{
            ...forgeBtn,
            opacity: !hasSel ? 0.55 : forging ? 0.85 : 1,
            cursor: forging ? "progress" : !hasSel ? "not-allowed" : "pointer",
          }}
        >
          <span style={forgeIcon}>
            {forging ? (
              <Loader2 className="animate-spin" style={{ width: 15, height: 15 }} strokeWidth={2.2} />
            ) : (
              <Wand2 style={{ width: 15, height: 15 }} strokeWidth={2.2} />
            )}
          </span>
          <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
            <span style={forgeTitle}>{forging ? "Working…" : MAKE_VERB.label}</span>
            <span style={forgeSub}>
              {forging ? "~30s — please wait" : MAKE_VERB.prompt}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}


// ── styles ──
const rail: CSSProperties = {
  // Opens BELOW the unified top-right bar (top:16, ~38px tall) so the bar +
  // this rail's own close ✕ stay visible together; right-aligned to the bar.
  position: "absolute",
  top: 64,
  bottom: 12,
  right: 16,
  width: 300,
  zIndex: 92,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  borderRadius: appleVibe.radius.lg,
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  border: "1px solid var(--glass-border)",
  boxShadow: "inset 0 1px 0 var(--glass-highlight), 0 28px 60px -24px rgba(11,18,40,0.38)",
  fontFamily: appleVibe.font.stack,
};
const header: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "11px 12px 9px",
  borderBottom: "1px solid var(--glass-border)",
};
const titleText: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: "-0.01em",
  color: appleVibe.text.primary,
};
const iconBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: appleVibe.radius.sm,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: appleVibe.text.tertiary,
};
const scroll: CSSProperties = { flex: 1, overflowY: "auto", padding: "10px 14px 16px", minHeight: 0 };
const helperLine: CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.4,
  color: appleVibe.text.tertiary,
  letterSpacing: "-0.005em",
};
const hairline: CSSProperties = {
  height: 1,
  background: "var(--glass-border)",
  margin: "14px 0 10px",
};
const sectionLabel: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: appleVibe.text.tertiary,
  marginBottom: 6,
};
const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 22,
  padding: "0 9px",
  borderRadius: appleVibe.radius.pill,
  background: appleVibe.surface.chip,
  fontSize: 11.5,
  fontWeight: 600,
  color: appleVibe.text.secondary,
  maxWidth: 200,
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
};
// Forge — the hero. The ONLY tinted row in the panel: 6% accent fill, 1px
// tinted border, soft accent glow. Reserves gray for inactive states.
const forgeBtn: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "11px 12px",
  borderRadius: appleVibe.radius.md,
  border: `1px solid ${ACCENT_BORDER}`,
  cursor: "pointer",
  background: ACCENT_SOFT,
  boxShadow: ACCENT_GLOW,
  fontFamily: appleVibe.font.stack,
};
const forgeIcon: CSSProperties = {
  display: "inline-flex",
  width: 28,
  height: 28,
  flexShrink: 0,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 9,
  background: ACCENT,
  color: "white",
  boxShadow: "0 4px 12px -4px rgba(79,70,229,0.55)",
};
const forgeTitle: CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 650,
  letterSpacing: "-0.01em",
  color: appleVibe.text.primary,
  textAlign: "left",
};
const forgeSub: CSSProperties = {
  display: "block",
  marginTop: 1,
  fontSize: 11,
  lineHeight: 1.3,
  color: appleVibe.text.tertiary,
  textAlign: "left",
};
// Flow row — every flow other than Forge. Reads as the same "list item" shape
// as the Operations list below, just with a soft chip background so the group
// reads as a single unit.
const opRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  width: "100%",
  textAlign: "left",
  padding: "7px 10px",
  borderRadius: appleVibe.radius.sm,
  border: "1px solid transparent",
  cursor: "pointer",
  background: "transparent",
  fontFamily: appleVibe.font.stack,
};
const opIconWrap: CSSProperties = {
  display: "inline-flex",
  width: 22,
  height: 22,
  flexShrink: 0,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 7,
  background: appleVibe.surface.chip,
  color: appleVibe.text.secondary,
};
const opLabel: CSSProperties = {
  display: "block",
  fontSize: 12.5,
  fontWeight: 600,
  color: appleVibe.text.primary,
  letterSpacing: "-0.01em",
};
const opIntent: CSSProperties = {
  display: "block",
  marginTop: 1,
  fontSize: 11,
  lineHeight: 1.3,
  color: appleVibe.text.tertiary,
};

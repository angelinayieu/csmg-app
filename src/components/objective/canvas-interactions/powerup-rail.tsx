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
import { Send } from "lucide-react";
import {
  Wand2,
  TreeStructure,
  Shuffle,
  HelpCircle,
  ListChecks,
  Blueprint,
  Loader2,
  AppWindow,
  Pencil,
  Package,
  X,
} from "@/lib/cute-icons";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  CANVAS_OPERATIONS,
  operationFitsKind,
  type OperationTarget,
} from "@/lib/objective-canvas/canvas-operations";
import { executeCardOperation } from "./operation-executor";
import { shapeToScanTarget } from "./shape-node-adapter";
import { labelFor } from "@/components/objective/favorites-sidebar";
import {
  getAiSettings,
  setAiSetting,
  AI_SETTINGS_EVENT,
  UI_PLAN_COUNT_MIN,
  UI_PLAN_COUNT_MAX,
  type AiSettings,
} from "@/lib/objective-canvas/ai-settings";
import { BUILD_UI_PLANS_EVENT, type BuildUiPlansDetail } from "@/components/objective/shapes/ui-plan-card-shape";
import { pushRightPanel } from "@/lib/objective-canvas/right-panel-signal";
import {
  requestDecomposeIntoCards,
  DECOMPOSE_DONE_EVENT,
} from "./deploy-oc-cards";
import { deployChatboxOnBoard } from "./intake-board";

/** Fired by the rail's Forge button → WhiteboardBase runs the SpecForge chain
 *  on the current selection (handleForge lives there, with editor + state). */
export const FORGE_REQUEST_EVENT = "objective-board:forge-request";
/** Dispatched by WhiteboardBase with `detail: { running: boolean }` so the rail
 *  can mirror Forge busy-state — disable the button + show a spinner — without
 *  having to share React state across the editor/rail boundary. */
export const FORGE_STATE_EVENT = "objective-board:forge-state";
// Mirror tech-spec-card-shape.tsx event names — kept local so this rail doesn't
// pull the shape util into its bundle (and can't form an import cycle).
const BUILD_PROTOTYPE_EVENT = "objective-board:build-prototype";

const OP_ICON: Record<string, typeof Package> = {
  decompose: Package,
  variations: Shuffle,
  questions: HelpCircle,
  make_plan: ListChecks,
  make_technical: Blueprint,
};

// Local label/intent overrides — terser, verb-first names that read better in a
// dense list. The registry (canvas-operations.ts) keeps the longer copy because
// it's also used in the scanner panel + card menus where verbosity is fine.
//
// NB: ops "decompose" → "Unpack". The original verb collided with the top
// BUILD action "Decompose objective" (which creates real typed Feature &
// Variable cards). Unpack is honest about what this actually does: it returns
// four lenses (principles · variations · causes · effects) as throwaway
// suggestion chips below the selected card. No structural commit.
const OP_OVERRIDES: Record<string, { label?: string; intent?: string }> = {
  decompose: { label: "Unpack", intent: "principles · variations · causes · effects" },
  variations: { intent: "Alternative angles" },
  questions: { label: "Clarify", intent: "Questions to answer first" },
  make_plan: { label: "Action plan", intent: "Turn this into a plan" },
  make_technical: { label: "Technical spec", intent: "Mechanism, components, data flow" },
};

// Rail-only: hide ops that have been folded into other rows. The op stays
// runnable by id (executor + scanner still see it); just no row in the rail.
//   layers   → folded into Unpack (both are vertical decompositions)
//   data_flow → folded into Technical spec (make_technical already returns it)
const RAIL_HIDDEN_OPS = new Set(["layers", "data_flow"]);

// The operations list = every wired, visible text op (converge/diverge are
// hidden — they're the popup verbs; sub_objective/entity ops aren't wired).
const POWERUPS = CANVAS_OPERATIONS.filter(
  (o) =>
    o.contract === "text" && o.wired && !o.hidden && !RAIL_HIDDEN_OPS.has(o.id),
);

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

  // The wired text-op rail, pruned by the selected card's kind so a "mechanism"
  // step doesn't offer Variations / Make-it-technical (it already IS one rung
  // in a mechanism). When nothing is selected (or selection is mixed), the
  // full rail shows — matches the prior behavior.
  const powerups = POWERUPS.filter((o) => operationFitsKind(o, sel.sourceKind));

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

  // Objective-level decompose (whole objective → Feature/Variable cards). Not
  // selection-dependent; the board listens for the request + signals done.
  const [decomposing, setDecomposing] = useState(false);
  useEffect(() => {
    const done = () => setDecomposing(false);
    window.addEventListener(DECOMPOSE_DONE_EVENT, done);
    return () => window.removeEventListener(DECOMPOSE_DONE_EVENT, done);
  }, []);

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
  // promotes in-place to an objective-card and the Sharpening fork fires —
  // the existing chatbox → promote pipeline handles all of it.
  function spawnNewObjectiveChatbox() {
    deployChatboxOnBoard(editor, { spaceId, seedText: "" }, { force: true });
    // Step out of the way so the new chatbox is in view.
    setOpen(false);
  }

  const [running, setRunning] = useState<string | null>(null);
  function runOp(opId: string, prompt?: string) {
    if (sel.count === 0 || running) return;
    const target: OperationTarget = { text: sel.text, shapeId: sel.anchorId };
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

  // Custom instruction — run the user's own prompt over the selection.
  const [showCustom, setShowCustom] = useState(false);
  const [customText, setCustomText] = useState("");
  function runCustom() {
    const p = customText.trim();
    if (!p || sel.count === 0 || running) return;
    runOp("custom", p);
    setCustomText("");
    setShowCustom(false);
  }

  // Build prototype — see in-context comment in the JSX block.
  function buildPrototype() {
    if (sel.count === 0 || running) return;
    const shapes = editor.getSelectedShapes();
    const techSpec = shapes.find((s) => s.type === "tech-spec-card");
    if (techSpec) {
      const p = techSpec.props as { specJson?: string; markdown?: string; title?: string };
      window.dispatchEvent(
        new CustomEvent(BUILD_PROTOTYPE_EVENT, {
          detail: {
            specJson: p.specJson ?? "",
            markdown: p.markdown ?? "",
            title: p.title ?? "Tech spec",
            shapeId: techSpec.id,
          },
        }),
      );
      return;
    }
    if (!sel.anchorId || !sel.text.trim()) return;
    setRunning("ui-plans");
    const detail: BuildUiPlansDetail = {
      sourceShapeId: sel.anchorId,
      sourceText: sel.text,
      sourceLabel: sel.labels[0],
      count: settings.uiPlanCount,
      temperature: settings.temperature,
    };
    window.dispatchEvent(
      new CustomEvent<BuildUiPlansDetail>(BUILD_UI_PLANS_EVENT, { detail }),
    );
    window.setTimeout(() => setRunning((c) => (c === "ui-plans" ? null : c)), 600);
  }

  // Headless when closed — the trigger lives in BoardTopRightBar.
  if (!open) return null;

  const hasSel = sel.count > 0;
  const selHasTechSpec = editor
    .getSelectedShapes()
    .some((s) => s.type === "tech-spec-card");
  const buildingPlans = running === "ui-plans";

  // Build the rendered op list with overrides applied. Uses the kind-pruned
  // `powerups` (Variations / Make-it-technical drop off when the selected card
  // already IS a mechanism step), not the raw POWERUPS catalog.
  const opRows = powerups.map((op) => {
    const ov = OP_OVERRIDES[op.id] ?? {};
    return {
      id: op.id,
      label: ov.label ?? op.label,
      intent: ov.intent ?? op.intent,
    };
  }).concat([
    { id: "custom", label: "Custom", intent: "Run your own prompt" },
  ]);
  const visibleOps = opRows;

  // Flows — composite, multi-step actions. Forge is the hero; the rest are
  // "do something the operations list can't do in a single shot."
  type Flow = {
    id: "forge" | "prototype" | "decompose_objective" | "new_objective";
    label: string;
    intent: string;
  };
  const flows: Flow[] = [
    { id: "forge", label: "Scope the build", intent: "Idea → MVPs → first build" },
    {
      id: "decompose_objective",
      label: "Decompose product system",
      intent: "Whole objective → Feature & Variable cards",
    },
    {
      id: "prototype",
      label: "Build prototype",
      intent: selHasTechSpec
        ? "Clickable UI from this tech spec"
        : `Fork ${settings.uiPlanCount} UI plans, pick one`,
    },
    {
      id: "new_objective",
      label: "New objective",
      intent: "Drop a fresh typing card on the board",
    },
  ];
  const visibleFlows = flows;

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

        {/* Flows — composite actions; Forge is the hero (the one accent-tinted
            row in the panel). Reserved gray would have read as "disabled".
            BUILD label names the section: these all make REAL persistent objects
            on the board (cards, specs, prototypes, objectives). Sets up the
            contrast with EXPLORE below (throwaway suggestion chips). */}
        {visibleFlows.length > 0 && (
          <div style={{ marginTop: hasSel ? 14 : 12 }}>
            <div style={sectionLabel}>BUILD</div>
            {visibleFlows.map((f) => {
              if (f.id === "forge") {
                return (
                  <button
                    key="forge"
                    type="button"
                    disabled={!hasSel || forging}
                    aria-busy={forging}
                    title={forging ? "Forging spec…" : undefined}
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
                        <Loader2
                          className="animate-spin"
                          style={{ width: 15, height: 15 }}
                          strokeWidth={2.2}
                        />
                      ) : (
                        <Wand2 style={{ width: 15, height: 15 }} strokeWidth={2.2} />
                      )}
                    </span>
                    <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                      <span style={forgeTitle}>
                        {forging ? "Forging spec…" : f.label}
                      </span>
                      <span style={forgeSub}>
                        {forging ? "~30s — please wait" : f.intent}
                      </span>
                    </span>
                  </button>
                );
              }
              if (f.id === "prototype") {
                return (
                  <div key="prototype" style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button
                      type="button"
                      disabled={!hasSel || buildingPlans}
                      title={
                        !hasSel
                          ? "Select a card to build a prototype from"
                          : selHasTechSpec
                            ? "Build a clickable prototype straight from this Tech Spec"
                            : `Fork ${settings.uiPlanCount} UI-plan variants, then pick one to prototype`
                      }
                      onClick={buildPrototype}
                      style={{ ...flowRow, flex: 1, minWidth: 0, opacity: hasSel ? 1 : 0.55 }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = appleVibe.surface.chipHover)
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = appleVibe.surface.chip)
                      }
                    >
                      <span style={flowIconWrap}>
                        {buildingPlans ? (
                          <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
                        ) : (
                          <AppWindow style={{ width: 13, height: 13 }} strokeWidth={2} />
                        )}
                      </span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={opLabel}>{f.label}</span>
                        <span style={opIntent}>{f.intent}</span>
                      </span>
                    </button>
                    {!selHasTechSpec && (
                      <PlanCountChip
                        value={settings.uiPlanCount}
                        onChange={(n) =>
                          setAiSetting(
                            "uiPlanCount",
                            Math.max(UI_PLAN_COUNT_MIN, Math.min(UI_PLAN_COUNT_MAX, n)),
                          )
                        }
                      />
                    )}
                  </div>
                );
              }
              if (f.id === "decompose_objective") {
                const busy = decomposing;
                return (
                  <button
                    key="decompose_objective"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (busy) return;
                      setDecomposing(true);
                      requestDecomposeIntoCards();
                    }}
                    style={{ ...flowRow, marginTop: 6 }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = appleVibe.surface.chipHover)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = appleVibe.surface.chip)
                    }
                  >
                    <span style={flowIconWrap}>
                      {busy ? (
                        <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
                      ) : (
                        <TreeStructure size={13} />
                      )}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={opLabel}>{busy ? "Decomposing…" : f.label}</span>
                      <span style={opIntent}>{f.intent}</span>
                    </span>
                  </button>
                );
              }
              // new_objective — drops a fresh typing card on the board (no
              // inline composer). Same shape intake uses; submitting it
              // promotes to an objective-card + fires Sharpening.
              return (
                <button
                  key="new_objective"
                  type="button"
                  onClick={spawnNewObjectiveChatbox}
                  style={{ ...flowRow, marginTop: 6 }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = appleVibe.surface.chipHover)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = appleVibe.surface.chip)
                  }
                >
                  <span style={flowIconWrap}>
                    <Sparkle style={{ width: 13, height: 13 }} strokeWidth={2} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={opLabel}>{f.label}</span>
                    <span style={opIntent}>{f.intent}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Hairline + Operations — single-shot transforms on the selection.
            EXPLORE label + inline hint tie these rows to the per-card ‹ ›
            diverge/converge buttons — same verbs, longer-form menu. The hint
            stops users from feeling like the rail is a separate vocabulary. */}
        {visibleOps.length > 0 && (
          <>
            <div style={hairline} />
            <div style={sectionLabel}>EXPLORE</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {visibleOps.map((op) => {
                const Icon = op.id === "custom" ? Pencil : (OP_ICON[op.id] ?? Sparkle);
                const isRunning = running === op.id;
                if (op.id === "custom") {
                  return (
                    <div key="custom">
                      <button
                        type="button"
                        disabled={!hasSel || !!running}
                        onClick={() => setShowCustom((v) => !v)}
                        style={{ ...opRow, opacity: hasSel ? 1 : 0.55 }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = appleVibe.surface.chipHover)
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        <span style={opIconWrap}>
                          {running === "custom" ? (
                            <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
                          ) : (
                            <Icon style={{ width: 13, height: 13 }} strokeWidth={2} />
                          )}
                        </span>
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={opLabel}>{op.label}</span>
                          <span style={opIntent}>{op.intent}</span>
                        </span>
                      </button>
                      {showCustom && (
                        <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                          <input
                            autoFocus
                            value={customText}
                            onChange={(e) => setCustomText(e.target.value)}
                            onPointerDown={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") runCustom();
                            }}
                            placeholder="Tell the AI what to do…"
                            style={customInput}
                          />
                          <button
                            type="button"
                            disabled={!customText.trim() || !hasSel || !!running}
                            onClick={runCustom}
                            title="Run"
                            style={{
                              display: "inline-grid",
                              placeItems: "center",
                              width: 32,
                              flexShrink: 0,
                              borderRadius: appleVibe.radius.sm,
                              border: "none",
                              cursor: customText.trim() ? "pointer" : "default",
                              background: customText.trim() ? ACCENT : appleVibe.surface.chip,
                              color: customText.trim() ? appleVibe.text.onAccent : appleVibe.text.tertiary,
                            }}
                          >
                            <Send style={{ width: 13, height: 13 }} strokeWidth={2.4} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <button
                    key={op.id}
                    type="button"
                    disabled={!hasSel || !!running}
                    onClick={() => runOp(op.id)}
                    style={{ ...opRow, opacity: hasSel ? 1 : 0.55 }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = appleVibe.surface.chipHover)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <span style={opIconWrap}>
                      {isRunning ? (
                        <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
                      ) : (
                        <Icon style={{ width: 13, height: 13 }} strokeWidth={2} />
                      )}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={opLabel}>{op.label}</span>
                      <span style={opIntent}>{op.intent}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

      </div>
    </div>
  );
}

// Small inline N-chip — replaces the +/− stepper-in-a-pill. Click to cycle,
// shift-click to step backwards. Far less control mixed with typography than
// the old inline stepper sat next to the Build-prototype label.
function PlanCountChip({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <button
      type="button"
      title={`${value} UI plan${value === 1 ? "" : "s"} — click to change`}
      onClick={(e) => {
        const next = e.shiftKey ? value - 1 : value + 1;
        const wrapped =
          next > UI_PLAN_COUNT_MAX
            ? UI_PLAN_COUNT_MIN
            : next < UI_PLAN_COUNT_MIN
              ? UI_PLAN_COUNT_MAX
              : next;
        onChange(wrapped);
      }}
      style={planChip}
    >
      ×{value}
    </button>
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
const flowRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  width: "100%",
  textAlign: "left",
  padding: "8px 10px",
  borderRadius: appleVibe.radius.sm,
  border: "1px solid transparent",
  background: appleVibe.surface.chip,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const flowIconWrap: CSSProperties = {
  display: "inline-flex",
  width: 22,
  height: 22,
  flexShrink: 0,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 7,
  background: "rgba(255,255,255,0.7)",
  color: appleVibe.text.secondary,
};
const customInput: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "7px 10px",
  borderRadius: appleVibe.radius.sm,
  border: "1px solid var(--glass-border)",
  background: "rgba(255,255,255,0.6)",
  fontSize: 12.5,
  color: appleVibe.text.primary,
  fontFamily: appleVibe.font.stack,
  outline: "none",
};
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
const planChip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 32,
  padding: "0 8px",
  borderRadius: appleVibe.radius.sm,
  border: "1px solid var(--glass-border)",
  background: appleVibe.surface.chip,
  fontSize: 11.5,
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
  color: appleVibe.text.secondary,
  fontFamily: appleVibe.font.stack,
  cursor: "pointer",
  flexShrink: 0,
};

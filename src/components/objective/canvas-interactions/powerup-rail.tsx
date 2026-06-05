"use client";

// ── PowerupRail ──
//
// The persistent right-edge home for the canvas AI actions + a view of finished
// artifacts. One filterable list: "Flows" (composite multi-step actions, hero
// Forge included) pinned above "Operations" (single-shot transforms on the
// selection). Modeled on LibraryLauncher (launcher pill → closable right-aligned
// rail). Mounted once in WhiteboardBase.

import { useEffect, useState, type CSSProperties } from "react";
import { useValue, type Editor, type TLShapeId } from "tldraw";
import {
  Wand2,
  Split,
  Shuffle,
  HelpCircle,
  ListChecks,
  Wrench,
  Layers3,
  Workflow,
  Loader2,
  FileCode2,
  MapPin,
  AppWindow,
  Pencil,
  Send,
  Search,
  X,
} from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  CANVAS_OPERATIONS,
  type OperationTarget,
} from "@/lib/objective-canvas/canvas-operations";
import { executeCardOperation } from "./operation-executor";
import { shapeToScanTarget } from "./shape-node-adapter";
import { labelFor, panToShape } from "@/components/objective/favorites-sidebar";
import {
  getAiSettings,
  setAiSetting,
  AI_SETTINGS_EVENT,
  UI_PLAN_COUNT_MIN,
  UI_PLAN_COUNT_MAX,
  type AiSettings,
} from "@/lib/objective-canvas/ai-settings";
import { BUILD_UI_PLANS_EVENT, type BuildUiPlansDetail } from "@/components/objective/shapes/ui-plan-card-shape";
import { OPEN_CARD_DETAIL_EVENT } from "./object-detail-drawer";
import { deploySharpeningCard } from "@/components/objective/board-bus";
import type { ObjectiveCardShape } from "@/components/objective/shapes/objective-card-shape";
import { pushRightPanel } from "@/lib/objective-canvas/right-panel-signal";
import {
  requestDecomposeIntoCards,
  DECOMPOSE_DONE_EVENT,
} from "./deploy-oc-cards";

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
const OPEN_TECH_SPEC_EVENT = "objective-board:open-tech-spec";

const OP_ICON: Record<string, typeof Split> = {
  decompose: Split,
  variations: Shuffle,
  questions: HelpCircle,
  make_plan: ListChecks,
  make_technical: Wrench,
  layers: Layers3,
  data_flow: Workflow,
};

// Local label/intent overrides — terser, verb-first names that read better in a
// dense list. The registry (canvas-operations.ts) keeps the longer copy because
// it's also used in the scanner panel + card menus where verbosity is fine.
const OP_OVERRIDES: Record<string, { label?: string; intent?: string }> = {
  decompose: { intent: "Break into principles & parts" },
  variations: { intent: "Alternative angles" },
  questions: { label: "Clarify", intent: "Questions to answer first" },
  make_plan: { label: "Action plan", intent: "Turn this into a plan" },
  make_technical: { label: "Technical spec", intent: "Mechanism + components" },
  layers: { label: "Layer stack", intent: "Substrate → outcome" },
  data_flow: { label: "Data flow", intent: "Upstream → downstream" },
};

// The operations list = every wired, visible text op (converge/diverge are
// hidden — they're the popup verbs; sub_objective/entity ops aren't wired).
const POWERUPS = CANVAS_OPERATIONS.filter(
  (o) => o.contract === "text" && o.wired && !o.hidden,
);

// Accent for the hero (Forge) — the one tinted color in the rail. A muted
// indigo so it reads as "primary action" without screaming. Reserved for the
// hero; every other surface stays neutral so the hero is the only colored row.
const ACCENT = "rgb(79, 70, 229)"; // indigo-600
const ACCENT_SOFT = "rgba(79, 70, 229, 0.08)";
const ACCENT_BORDER = "rgba(79, 70, 229, 0.32)";
const ACCENT_GLOW =
  "0 0 0 1px rgba(79,70,229,0.18) inset, 0 14px 32px -14px rgba(79,70,229,0.45)";

interface ArtifactRow {
  id: TLShapeId;
  title: string;
  kind: string;
}

export function PowerupRail({
  spaceId,
  editor,
}: {
  spaceId: string;
  editor: Editor;
}) {
  const [open, setOpen] = useState(false);

  // While the panel is open, push the top-right style palette left of it (the
  // rail is 360px at right:12) so the palette can't cover the panel's close
  // button. Reset to the corner when closed/unmounted.
  useEffect(() => {
    const el = document.documentElement;
    el.style.setProperty("--oc-style-panel-right", open ? "388px" : "12px");
    return () => el.style.setProperty("--oc-style-panel-right", "12px");
  }, [open]);

  // Live selection — WHAT the actions will run on (single or multi/lasso).
  const sel = useValue(
    "powerup-selection",
    () => {
      const shapes = editor.getSelectedShapes();
      const targets = shapes
        .map(shapeToScanTarget)
        .filter((t): t is OperationTarget => !!t);
      return {
        labels: shapes.map((s) => labelFor(s)),
        text: targets.map((t) => t.text).join("\n\n"),
        anchorId: targets[0]?.shapeId,
        count: targets.length,
      };
    },
    [editor],
  );

  // Artifacts on the board (tech-spec + prototype cards are ephemeral shapes).
  const boardArtifacts = useValue(
    "powerup-board-artifacts",
    () =>
      editor
        .getCurrentPageShapes()
        .filter((s) => s.type === "tech-spec-card" || s.type === "prototype-card")
        .map((s) => ({
          id: s.id as TLShapeId,
          kind: s.type === "prototype-card" ? "Prototype" : "Tech spec",
          title:
            (s.props as { title?: string }).title ||
            (s.type === "prototype-card" ? "Prototype" : "Tech spec"),
        })) as ArtifactRow[],
    [editor],
  );

  // Polished / included library objects (fetched on open).
  const [included, setIncluded] = useState<
    { id: string; title: string; type: string }[] | null
  >(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch(`/api/brainstorm/space/${spaceId}/library/objects?in_spec=true`)
      .then((r) => (r.ok ? r.json() : { objects: [] }))
      .then((j) => {
        if (!alive) return;
        const objs = Array.isArray(j.objects) ? j.objects : [];
        setIncluded(
          objs.map((o: { id: string; title?: string; object_type?: string }) => ({
            id: String(o.id),
            title: o.title || "Untitled",
            type: o.object_type || "object",
          })),
        );
      })
      .catch(() => {
        if (alive) setIncluded([]);
      });
    return () => {
      alive = false;
    };
  }, [open, spaceId]);

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

  // New objective → set + refine: the user types a fresh objective, we persist
  // it + run prompt refinement (the sharpening agent), then drop its card on the
  // board (same artifact → deploySharpeningCard mapping as the intake mount).
  const [showNewObj, setShowNewObj] = useState(false);
  const [newObjText, setNewObjText] = useState("");
  const [refining, setRefining] = useState(false);
  // Create-or-refresh the OBJECTIVE card on the board — the SAME card intake
  // produces. One objective per board, so update it in place if present; the
  // sharpening card then lands below it (deploySharpeningCard anchors to it).
  function placeObjectiveCard(text: string) {
    const shortTitle =
      text.length > 64 ? text.slice(0, 63).trimEnd() + "…" : text;
    const existing = editor
      .getCurrentPageShapes()
      .find((s) => s.type === "objective-card");
    if (existing) {
      editor.updateShape<ObjectiveCardShape>({
        id: existing.id,
        type: "objective-card",
        props: { spaceId, title: shortTitle, objective: text },
      });
      return;
    }
    const vp = editor.getViewportPageBounds();
    editor.createShape<ObjectiveCardShape>({
      type: "objective-card",
      x: vp.center.x - 170,
      y: vp.center.y - 240,
      props: {
        w: 340,
        h: 168,
        spaceId,
        title: shortTitle,
        objective: text,
        color: appleVibe.stage.objective,
      },
    });
  }
  async function refineNewObjective() {
    const text = newObjText.trim();
    if (!text || refining) return;
    setRefining(true);
    placeObjectiveCard(text);
    setShowNewObj(false);
    setNewObjText("");
    try {
      const res = await fetch(`/api/objective/${spaceId}/prompt-sharpening`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objective: text }),
      });
      const json = (await res.json().catch(() => null)) as { artifact?: any } | null;
      const a = json?.artifact;
      if (a) {
        const ranked: any[] = Array.isArray(a.ranked_ambiguities) ? a.ranked_ambiguities : [];
        deploySharpeningCard({
          spaceId,
          title: a.distilled_title ?? "",
          sharpenedPrompt: a.sharpened_prompt ?? "",
          chips: ranked
            .slice(0, 3)
            .map((r) => String(r?.ambiguity_type || r?.ambiguity || "Ambiguity")),
          heatmapJson: JSON.stringify(a.ambiguity_heatmap ?? {}),
          rankedJson: JSON.stringify(ranked),
        });
      }
    } catch {
      /* soft-fail — the user can retry */
    } finally {
      setRefining(false);
    }
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

  function openArtifact(id: TLShapeId) {
    const shape = editor.getShape(id);
    if (shape?.type === "tech-spec-card") {
      const p = shape.props as { specJson?: string; markdown?: string; title?: string };
      window.dispatchEvent(
        new CustomEvent(OPEN_TECH_SPEC_EVENT, {
          detail: {
            specJson: p.specJson ?? "",
            markdown: p.markdown ?? "",
            title: p.title ?? "Tech spec",
            shapeId: id,
          },
        }),
      );
    }
    panToShape(editor, id);
  }
  function openIncluded(id: string) {
    window.dispatchEvent(
      new CustomEvent(OPEN_CARD_DETAIL_EVENT, { detail: { objectId: id } }),
    );
  }

  // Search/filter across Flows + Operations. Lowercased substring match against
  // label + intent — covers "decompose", "spec", "data", etc.
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  function matches(label: string, intent: string) {
    if (!q) return true;
    return label.toLowerCase().includes(q) || intent.toLowerCase().includes(q);
  }

  if (!open) {
    return (
      <button
        type="button"
        title="Actions — run AI on your selection + see artifacts"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen(true)}
        style={launcherPill}
      >
        <Sparkle style={{ width: 14, height: 14 }} strokeWidth={2.2} />
        Actions
      </button>
    );
  }

  const hasSel = sel.count > 0;
  const selHasTechSpec = editor
    .getSelectedShapes()
    .some((s) => s.type === "tech-spec-card");
  const buildingPlans = running === "ui-plans";

  // Build the rendered op list with overrides applied.
  const opRows = POWERUPS.map((op) => {
    const ov = OP_OVERRIDES[op.id] ?? {};
    return {
      id: op.id,
      label: ov.label ?? op.label,
      intent: ov.intent ?? op.intent,
    };
  }).concat([
    { id: "custom", label: "Custom", intent: "Run your own prompt" },
  ]);
  const visibleOps = opRows.filter((o) => matches(o.label, o.intent));

  // Flows — composite, multi-step actions. Forge is the hero; the rest are
  // "do something the operations list can't do in a single shot."
  type Flow = {
    id: "forge" | "prototype" | "decompose_objective" | "new_objective";
    label: string;
    intent: string;
  };
  const flows: Flow[] = [
    { id: "forge", label: "Forge full spec", intent: "Idea → root cause → MVPs → first build" },
    {
      id: "prototype",
      label: "Build prototype",
      intent: selHasTechSpec
        ? "Clickable UI from this tech spec"
        : `Fork ${settings.uiPlanCount} UI plans, pick one`,
    },
    {
      id: "decompose_objective",
      label: "Decompose objective",
      intent: "Whole objective → Feature & Variable cards",
    },
    {
      id: "new_objective",
      label: "New objective",
      intent: "Type a new objective, refine it",
    },
  ];
  const visibleFlows = flows.filter((f) => matches(f.label, f.intent));

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

      {/* Search — thin filter for both Flows + Operations. */}
      <div style={searchWrap}>
        <Search style={searchIcon} strokeWidth={2} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="Filter actions"
          style={searchInput}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            style={searchClear}
            aria-label="Clear filter"
          >
            <X style={{ width: 11, height: 11 }} strokeWidth={2.4} />
          </button>
        )}
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
            row in the panel). Reserved gray would have read as "disabled". */}
        {visibleFlows.length > 0 && (
          <div style={{ marginTop: hasSel ? 14 : 12 }}>
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
                        <Split style={{ width: 13, height: 13 }} strokeWidth={2} />
                      )}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={opLabel}>{busy ? "Decomposing…" : f.label}</span>
                      <span style={opIntent}>{f.intent}</span>
                    </span>
                  </button>
                );
              }
              // new_objective — toggle opens a small composer inline.
              return (
                <div key="new_objective">
                  <button
                    type="button"
                    onClick={() => setShowNewObj((v) => !v)}
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
                  {showNewObj && (
                    <div style={{ marginTop: 6 }}>
                      <textarea
                        autoFocus
                        value={newObjText}
                        onChange={(e) => setNewObjText(e.target.value)}
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                            e.preventDefault();
                            void refineNewObjective();
                          }
                        }}
                        placeholder="Type a new objective to refine…"
                        rows={3}
                        style={composerArea}
                      />
                      <button
                        type="button"
                        disabled={!newObjText.trim() || refining}
                        onClick={() => void refineNewObjective()}
                        style={{
                          ...flowRow,
                          marginTop: 6,
                          justifyContent: "center",
                          opacity: newObjText.trim() && !refining ? 1 : 0.55,
                        }}
                      >
                        {refining ? (
                          <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
                        ) : (
                          <Wand2 style={{ width: 13, height: 13 }} strokeWidth={2.2} />
                        )}
                        <span style={opLabel}>
                          {refining ? "Refining…" : "Refine → card"}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Hairline + Operations — single-shot transforms on the selection. */}
        {visibleOps.length > 0 && (
          <>
            <div style={hairline} />
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

        {/* Empty-filter state — only if BOTH groups are filtered to nothing. */}
        {q && visibleFlows.length === 0 && visibleOps.length === 0 && (
          <div style={{ ...helperLine, marginTop: 14 }}>
            No actions match “{query}”.
          </div>
        )}

        {/* Artifacts — finished / polished outputs. */}
        <div style={hairline} />
        <div style={artifactsHead}>
          <FileCode2 style={{ width: 12, height: 12 }} strokeWidth={2} />
          <span>Artifacts</span>
        </div>
        {boardArtifacts.length === 0 && (included?.length ?? 0) === 0 ? (
          <div style={{ ...helperLine, marginTop: 6 }}>
            Polished specs &amp; included objects land here.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
            {boardArtifacts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => openArtifact(a.id)}
                style={artifactRow}
                title={`Find "${a.title}" on the board`}
              >
                <MapPin style={artifactArrow} strokeWidth={2.2} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={opLabel}>{a.title}</span>
                  <span style={opIntent}>{a.kind} · on board</span>
                </span>
              </button>
            ))}
            {(included ?? []).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => openIncluded(o.id)}
                style={artifactRow}
                title={`Open "${o.title}"`}
              >
                <FileCode2 style={artifactArrow} strokeWidth={2.2} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={opLabel}>{o.title}</span>
                  <span style={opIntent}>{o.type} · in spec</span>
                </span>
              </button>
            ))}
          </div>
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
const launcherPill: CSSProperties = {
  // Unified right toolbar baseline (top:16) — third stop in the row:
  // palette · Share · Actions · Library · Saved · collaborators.
  position: "absolute",
  top: 16,
  right: 158,
  zIndex: 66,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "7px 12px",
  borderRadius: appleVibe.radius.pill,
  border: "1px solid var(--glass-border)",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
  fontSize: 11.5,
  fontWeight: 650,
  color: appleVibe.text.secondary,
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  boxShadow: "inset 0 1px 0 var(--glass-highlight), 0 12px 30px -16px rgba(11,18,40,0.32)",
};
const rail: CSSProperties = {
  position: "absolute",
  top: 12,
  bottom: 12,
  right: 12,
  width: 360,
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
const searchWrap: CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  margin: "10px 12px 0",
  height: 30,
  borderRadius: appleVibe.radius.sm,
  background: appleVibe.surface.chip,
  border: "1px solid var(--glass-border)",
  paddingLeft: 28,
  paddingRight: 6,
};
const searchIcon: CSSProperties = {
  position: "absolute",
  left: 8,
  width: 12,
  height: 12,
  color: appleVibe.text.tertiary,
};
const searchInput: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: "100%",
  border: "none",
  background: "transparent",
  fontSize: 12.5,
  color: appleVibe.text.primary,
  fontFamily: appleVibe.font.stack,
  outline: "none",
  padding: 0,
};
const searchClear: CSSProperties = {
  display: "inline-grid",
  placeItems: "center",
  width: 18,
  height: 18,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: appleVibe.text.tertiary,
  flexShrink: 0,
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
const composerArea: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  resize: "vertical",
  padding: "8px 10px",
  borderRadius: appleVibe.radius.sm,
  border: "1px solid var(--glass-border)",
  background: "rgba(255,255,255,0.6)",
  fontSize: 12.5,
  lineHeight: 1.45,
  color: appleVibe.text.primary,
  fontFamily: appleVibe.font.stack,
  outline: "none",
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
const artifactsHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11.5,
  fontWeight: 600,
  color: appleVibe.text.secondary,
  letterSpacing: "-0.005em",
};
const artifactRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  textAlign: "left",
  padding: "7px 9px",
  borderRadius: appleVibe.radius.sm,
  border: "1px solid transparent",
  background: appleVibe.surface.chip,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const artifactArrow: CSSProperties = {
  width: 13,
  height: 13,
  color: appleVibe.text.tertiary,
  flexShrink: 0,
};

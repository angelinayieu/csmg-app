"use client";

// ── PowerupRail ──
//
// The persistent right-edge home for the canvas AI "powerups" + a view of the
// finished artifacts. Splits the old scanner popup: the popup keeps only the
// converge/diverge verbs (beside the selection); EVERY other operation lives
// here, always one click away, showing WHAT it will run on (the live selection)
// and the artifacts produced. Modeled on LibraryLauncher (launcher pill →
// closable right-aligned rail). Mounted once in WhiteboardBase.
//
// Sections: Applies-to (live selection) · Powerups (ops + Forge) · AI settings ·
// Artifacts (board tech-spec/prototype cards + library objects included-in-spec).

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
  Thermometer,
  FileCode2,
  MapPin,
  AppWindow,
  Pencil,
  Send,
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
  DEPTH_MIN,
  DEPTH_MAX,
  COMPLEXITY_MIN,
  COMPLEXITY_MAX,
  type AiSettings,
} from "@/lib/objective-canvas/ai-settings";
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

// The powerups = every wired, visible text op (converge/diverge are hidden —
// they're the popup verbs; sub_objective/entity ops aren't executor-wired).
const POWERUPS = CANVAS_OPERATIONS.filter(
  (o) => o.contract === "text" && o.wired && !o.hidden,
);

// Plain-language value words so the sliders read for anyone — "Very focused"
// instead of "0.00", "Deep" instead of "4". The number is still what drives
// the model; these just translate it.
function creativityWord(t: number): string {
  if (t <= 0.2) return "Very focused";
  if (t <= 0.45) return "Focused";
  if (t <= 0.7) return "Balanced";
  if (t <= 0.9) return "Creative";
  return "Wild";
}
function depthWord(d: number): string {
  if (d <= 1) return "Quick look";
  if (d <= 2) return "Light";
  if (d <= 3) return "Normal";
  if (d <= 4) return "Deep";
  return "Very deep";
}

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

  // Live selection — WHAT the powerups will run on (single or multi/lasso).
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
    // Drop the objective card immediately (like intake) + collapse the
    // composer; the sharpening card fills in below it as the agent runs.
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
        setShowNewObj(false);
        setNewObjText("");
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

  // Build prototype — turn the Forge's Tech Spec into a live screen app. Acts on
  // the selected tech-spec card, else the most recent one on the board (fires
  // the same event the card's own "Build prototype" button does).
  function buildPrototype() {
    const cards = editor
      .getCurrentPageShapes()
      .filter((s) => s.type === "tech-spec-card");
    if (!cards.length) return;
    const selected = new Set(editor.getSelectedShapeIds());
    const card = cards.find((c) => selected.has(c.id)) ?? cards[cards.length - 1];
    const p = card.props as { specJson?: string; markdown?: string; title?: string };
    window.dispatchEvent(
      new CustomEvent(BUILD_PROTOTYPE_EVENT, {
        detail: {
          specJson: p.specJson ?? "",
          markdown: p.markdown ?? "",
          title: p.title ?? "Tech spec",
          shapeId: card.id,
        },
      }),
    );
  }

  function openArtifact(id: TLShapeId) {
    const shape = editor.getShape(id);
    // A tech-spec card → open its full spec panel; otherwise just reveal it.
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

  if (!open) {
    return (
      <button
        type="button"
        title="Powerups — run AI on your selection + see artifacts"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen(true)}
        style={launcherPill}
      >
        <Sparkle style={{ width: 14, height: 14 }} strokeWidth={2.2} />
        Powerups
      </button>
    );
  }

  const hasSel = sel.count > 0;
  const hasTechSpec = boardArtifacts.some((a) => a.kind === "Tech spec");

  return (
    <div onPointerDown={(e) => e.stopPropagation()} style={rail}>
      <div style={header}>
        <Sparkle
          style={{ width: 15, height: 15, color: appleVibe.text.secondary }}
          strokeWidth={2.2}
        />
        <span style={titleText}>Powerups</span>
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
        {/* Applies to — the live selection. */}
        <div style={sectionLabel}>Applies to</div>
        {hasSel ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
            {sel.labels.slice(0, 8).map((l, i) => (
              <span key={i} style={chip}>
                {l}
              </span>
            ))}
            {sel.labels.length > 8 && (
              <span style={chip}>+{sel.labels.length - 8}</span>
            )}
          </div>
        ) : (
          <div style={{ ...muted, marginTop: 6 }}>
            Select one or more cards to act on.
          </div>
        )}

        {/* Forge — the hero. */}
        <button
          type="button"
          disabled={!hasSel}
          onClick={() => window.dispatchEvent(new CustomEvent(FORGE_REQUEST_EVENT))}
          style={{ ...forgeBtn, opacity: hasSel ? 1 : 0.5, marginTop: 12 }}
        >
          <span style={forgeIcon}>
            <Wand2 style={{ width: 15, height: 15 }} strokeWidth={2.2} />
          </span>
          <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
            <span style={forgeTitle}>Forge full spec</span>
            <span style={forgeSub}>Idea → root cause → MVPs → first build</span>
          </span>
        </button>

        {/* Build prototype — the Forge's Tech Spec → a live, clickable screen
            app. Needs a spec on the board first (run Forge above). */}
        <button
          type="button"
          disabled={!hasTechSpec}
          title={
            hasTechSpec
              ? "Build a clickable prototype from your Tech Spec"
              : "Forge a spec first — then build the prototype"
          }
          onClick={buildPrototype}
          style={{ ...secondaryBtn, marginTop: 8, opacity: hasTechSpec ? 1 : 0.5 }}
        >
          <AppWindow style={{ width: 14, height: 14 }} strokeWidth={2.2} />
          Build prototype
        </button>

        {/* Objective-level decompose — break the whole objective into Feature
            & Variable cards (no selection needed). Was the bottom-left float. */}
        <button
          type="button"
          disabled={decomposing}
          onClick={() => {
            if (decomposing) return;
            setDecomposing(true);
            requestDecomposeIntoCards();
          }}
          style={{ ...secondaryBtn, marginTop: 8 }}
        >
          {decomposing ? (
            <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
          ) : (
            <Split style={{ width: 14, height: 14 }} strokeWidth={2.2} />
          )}
          {decomposing ? "Decomposing…" : "Decompose objective → cards"}
        </button>

        {/* New objective → spawn a fresh objective card + run prompt refinement.
            Types straight into a textarea, POSTs to the sharpening agent (which
            persists input_text + regenerates), then drops the sharpening card on
            the board via the same bus the intake mount uses. */}
        <button
          type="button"
          onClick={() => setShowNewObj((v) => !v)}
          style={{ ...secondaryBtn, marginTop: 8 }}
        >
          <Sparkle style={{ width: 14, height: 14 }} strokeWidth={2.2} />
          New objective + refine
        </button>
        {showNewObj && (
          <div style={{ marginTop: 8 }}>
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
              style={{
                width: "100%",
                boxSizing: "border-box",
                resize: "vertical",
                padding: "8px 10px",
                borderRadius: appleVibe.radius.sm,
                border: "1px solid var(--glass-border)",
                background: appleVibe.surface.chip,
                fontSize: 12.5,
                lineHeight: 1.45,
                color: appleVibe.text.primary,
                fontFamily: appleVibe.font.stack,
                outline: "none",
              }}
            />
            <button
              type="button"
              disabled={!newObjText.trim() || refining}
              onClick={() => void refineNewObjective()}
              style={{
                ...secondaryBtn,
                marginTop: 6,
                opacity: newObjText.trim() && !refining ? 1 : 0.5,
              }}
            >
              {refining ? (
                <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
              ) : (
                <Wand2 style={{ width: 14, height: 14 }} strokeWidth={2.2} />
              )}
              {refining ? "Refining…" : "Refine objective → card"}
            </button>
          </div>
        )}

        {/* Powerups — the remaining operations. */}
        <div style={{ ...sectionLabel, marginTop: 16 }}>Operations</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 6 }}>
          {POWERUPS.map((op) => {
            const Icon = OP_ICON[op.id] ?? Sparkle;
            const isRunning = running === op.id;
            return (
              <button
                key={op.id}
                type="button"
                disabled={!hasSel || !!running}
                onClick={() => runOp(op.id)}
                style={{ ...opRow, opacity: hasSel ? 1 : 0.5 }}
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
          {/* Custom instruction — the user's own prompt on the selection. */}
          <button
            type="button"
            disabled={!hasSel || !!running}
            onClick={() => setShowCustom((v) => !v)}
            style={{ ...opRow, opacity: hasSel ? 1 : 0.5 }}
            onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span style={opIconWrap}>
              {running === "custom" ? (
                <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
              ) : (
                <Pencil style={{ width: 13, height: 13 }} strokeWidth={2} />
              )}
            </span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={opLabel}>Custom instruction</span>
              <span style={opIntent}>Run your own prompt on this</span>
            </span>
          </button>
        </div>

        {showCustom && (
          <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
            <input
              autoFocus
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") runCustom();
              }}
              placeholder="Tell the AI what to do with the selection…"
              style={{
                flex: 1,
                minWidth: 0,
                padding: "8px 10px",
                borderRadius: appleVibe.radius.sm,
                border: "1px solid var(--glass-border)",
                background: appleVibe.surface.chip,
                fontSize: 12.5,
                color: appleVibe.text.primary,
                fontFamily: appleVibe.font.stack,
                outline: "none",
              }}
            />
            <button
              type="button"
              disabled={!customText.trim() || !hasSel || !!running}
              onClick={runCustom}
              title="Run"
              style={{
                display: "inline-grid",
                placeItems: "center",
                width: 36,
                flexShrink: 0,
                borderRadius: appleVibe.radius.sm,
                border: "none",
                cursor: customText.trim() ? "pointer" : "default",
                background: customText.trim() ? appleVibe.accent.primary : appleVibe.surface.chip,
                color: customText.trim() ? appleVibe.text.onAccent : appleVibe.text.tertiary,
              }}
            >
              <Send style={{ width: 14, height: 14 }} strokeWidth={2.4} />
            </button>
          </div>
        )}

        {/* AI settings — plain language so anyone can tune them. */}
        <div style={{ ...sectionLabel, marginTop: 16, display: "flex", alignItems: "center", gap: 6 }}>
          <Thermometer style={{ width: 12, height: 12 }} strokeWidth={2} /> How the AI thinks
        </div>
        <div style={{ marginTop: 8 }}>
          <Knob
            label="Creativity"
            hint="Low = careful & on-topic. High = wild & surprising."
            value={settings.temperature}
            min={0}
            max={1}
            step={0.05}
            display={creativityWord(settings.temperature)}
            onChange={(v) => setAiSetting("temperature", v)}
          />
          <Knob
            label="Thinking depth"
            hint="How far down it breaks the idea apart."
            value={settings.depth}
            min={DEPTH_MIN}
            max={DEPTH_MAX}
            step={1}
            display={depthWord(settings.depth)}
            onChange={(v) => setAiSetting("depth", Math.round(v))}
          />
          <Knob
            label="Angles explored"
            hint="How many questions the AI asks + answers itself to stretch each idea."
            value={settings.complexity}
            min={COMPLEXITY_MIN}
            max={COMPLEXITY_MAX}
            step={1}
            display={`${settings.complexity}`}
            onChange={(v) => setAiSetting("complexity", Math.round(v))}
          />
          <button
            type="button"
            onClick={() => setAiSetting("webSearch", !settings.webSearch)}
            style={{
              ...toggleRow,
              alignItems: "flex-start",
              color: settings.webSearch
                ? appleVibe.text.primary
                : appleVibe.text.tertiary,
            }}
          >
            <span
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 1,
                minWidth: 0,
              }}
            >
              <span>Look things up online</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  lineHeight: 1.3,
                  color: appleVibe.text.faint,
                }}
              >
                Pull in real facts from the web (a bit slower).
              </span>
            </span>
            <span
              style={{
                ...pip,
                marginTop: 2,
                background: settings.webSearch
                  ? appleVibe.accent.primary
                  : appleVibe.surface.chip,
              }}
            />
          </button>
        </div>

        {/* Artifacts — finished / polished outputs. */}
        <div style={{ ...sectionLabel, marginTop: 16, display: "flex", alignItems: "center", gap: 6 }}>
          <FileCode2 style={{ width: 12, height: 12 }} strokeWidth={2} /> Artifacts
        </div>
        {boardArtifacts.length === 0 && (included?.length ?? 0) === 0 ? (
          <div style={{ ...muted, marginTop: 6 }}>
            Polished tech specs &amp; included objects land here.
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

function Knob({
  label,
  hint,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 11 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: hint ? 1 : 4,
        }}
      >
        <span style={{ fontSize: 11.5, fontWeight: 600, color: appleVibe.text.secondary }}>
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            color: appleVibe.text.primary,
          }}
        >
          {display}
        </span>
      </div>
      {hint && (
        <div
          style={{
            fontSize: 10,
            lineHeight: 1.3,
            color: appleVibe.text.faint,
            marginBottom: 5,
          }}
        >
          {hint}
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", height: 4, cursor: "pointer", accentColor: appleVibe.accent.primary }}
      />
    </div>
  );
}

// ── styles ──
const launcherPill: CSSProperties = {
  position: "absolute",
  top: 108,
  right: 16,
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
const scroll: CSSProperties = { flex: 1, overflowY: "auto", padding: "12px 14px 16px", minHeight: 0 };
const sectionLabel: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: appleVibe.text.tertiary,
};
const muted: CSSProperties = { fontSize: 12, color: appleVibe.text.tertiary };
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
const forgeBtn: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "10px 11px",
  borderRadius: appleVibe.radius.md,
  border: "1px solid rgba(255,255,255,0.14)",
  cursor: "pointer",
  background:
    "linear-gradient(135deg, rgba(28,33,48,0.98) 0%, rgba(15,20,33,0.99) 100%)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14), 0 12px 28px -14px rgba(11,18,40,0.55)",
};
const forgeIcon: CSSProperties = {
  display: "inline-flex",
  width: 28,
  height: 28,
  flexShrink: 0,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 9,
  background: "rgba(255,255,255,0.14)",
  color: "white",
};
const forgeTitle: CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 650,
  letterSpacing: "-0.01em",
  color: "white",
};
const forgeSub: CSSProperties = {
  display: "block",
  marginTop: 1,
  fontSize: 11,
  lineHeight: 1.3,
  color: "rgba(255,255,255,0.62)",
};
const secondaryBtn: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  justifyContent: "center",
  padding: "9px 11px",
  borderRadius: appleVibe.radius.md,
  border: "1px solid var(--glass-border)",
  background: appleVibe.surface.chip,
  cursor: "pointer",
  fontSize: 12.5,
  fontWeight: 600,
  color: appleVibe.text.primary,
  fontFamily: appleVibe.font.stack,
};
const opRow: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 9,
  width: "100%",
  textAlign: "left",
  padding: "8px 9px",
  borderRadius: appleVibe.radius.sm,
  border: "1px solid transparent",
  cursor: "pointer",
  background: "transparent",
};
const opIconWrap: CSSProperties = {
  display: "inline-flex",
  marginTop: 0.5,
  width: 23,
  height: 23,
  flexShrink: 0,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 8,
  background: appleVibe.surface.chip,
  color: appleVibe.text.secondary,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
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
  marginTop: 1.5,
  fontSize: 11,
  lineHeight: 1.32,
  color: appleVibe.text.tertiary,
};
const toggleRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  width: "100%",
  padding: "6px 2px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 11.5,
  fontWeight: 600,
  fontFamily: appleVibe.font.stack,
};
const pip: CSSProperties = {
  width: 30,
  height: 16,
  borderRadius: 999,
  flexShrink: 0,
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

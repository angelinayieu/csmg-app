"use client";

// ── ArtifactDock ──
//
// The persistent left-edge dock of gradient circles — the home for TERMINAL
// deliverables ("final products"), separate from the power-up rail (which
// transforms canvas content into more cards). Pick a selection, tap a circle,
// the engine runs its plan→create pipeline and drops a persistent artifact
// (ARTIFACTS_DOCK_PLAN.md §2–3).
//
// Phase 2 wires two engines end-to-end:
//   • Prototype — reuses the existing build-prototype pipeline (UI-plan fork
//     or, if a tech-spec card is selected, straight to prototype).
//   • Notebook  — produces a Notebook artifact on demand from the space's
//     voice notes (persisted via /artifacts run_notebook) + drops the journal
//     card. (Journals are no longer auto-fired — not everyone wants one.)
// The pinned set is curated via the "+" catalog. image/social/custom are
// catalog-visible but land in a later phase.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useValue, type Editor } from "tldraw";
import {
  Boxes,
  NotebookPen,
  Image as ImageIcon,
  Megaphone,
  Wand2,
  Plus,
  Check,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { shapeToScanTarget } from "./shape-node-adapter";
import { labelFor } from "@/components/objective/favorites-sidebar";
import type { OperationTarget } from "@/lib/objective-canvas/canvas-operations";
import {
  ARTIFACT_ENGINES,
  readPinnedEngines,
  writePinnedEngines,
  type ArtifactEngineDef,
  type ArtifactEngineKey,
} from "@/lib/objective-canvas/artifact-engines";
import { getAiSettings } from "@/lib/objective-canvas/ai-settings";
import { deployJournalCard, openNotebook } from "@/components/objective/board-bus";
import {
  BUILD_UI_PLANS_EVENT,
  type BuildUiPlansDetail,
} from "@/components/objective/shapes/ui-plan-card-shape";
import { BUILD_PROTOTYPE_EVENT } from "@/components/objective/shapes/tech-spec-card-shape";

const ENGINE_ICON: Record<ArtifactEngineKey, LucideIcon> = {
  build_prototype: Boxes,
  notebook: NotebookPen,
  image: ImageIcon,
  social_post: Megaphone,
  custom: Wand2,
};

type Toast = { text: string; tone: "info" | "error" } | null;

export function ArtifactDock({
  spaceId,
  editor,
}: {
  spaceId: string;
  editor: Editor;
}) {
  const [pinned, setPinned] = useState<ArtifactEngineKey[]>(() =>
    readPinnedEngines(spaceId),
  );
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [running, setRunning] = useState<ArtifactEngineKey | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    setPinned(readPinnedEngines(spaceId));
  }, [spaceId]);

  // Live selection — WHAT the engines run on.
  const sel = useValue(
    "artifact-dock-selection",
    () => {
      const shapes = editor.getSelectedShapes();
      const targets = shapes
        .map(shapeToScanTarget)
        .filter((t): t is OperationTarget => !!t);
      return {
        count: targets.length,
        text: targets.map((t) => t.text).join("\n\n"),
        anchorId: targets[0]?.shapeId,
        label: shapes.length ? labelFor(shapes[0]) : undefined,
        hasTechSpec: shapes.some((s) => s.type === "tech-spec-card"),
      };
    },
    [editor],
  );

  const pinnedEngines = useMemo(
    () =>
      pinned
        .map((k) => ARTIFACT_ENGINES.find((e) => e.key === k))
        .filter((e): e is ArtifactEngineDef => !!e),
    [pinned],
  );

  const flash = useCallback((text: string, tone: "info" | "error" = "info") => {
    setToast({ text, tone });
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const togglePin = useCallback(
    (key: ArtifactEngineKey) => {
      setPinned((prev) => {
        const next = prev.includes(key)
          ? prev.filter((k) => k !== key)
          : [...prev, key];
        writePinnedEngines(spaceId, next);
        return next;
      });
    },
    [spaceId],
  );

  // ── Engine runners ─────────────────────────────────────────────────
  const runPrototype = useCallback(() => {
    if (sel.count === 0) {
      flash("Select a card or some text first.", "error");
      return;
    }
    const settings = getAiSettings();
    // Tech-spec card selected → straight to prototype (it carries its UI plan).
    if (sel.hasTechSpec) {
      const techSpec = editor
        .getSelectedShapes()
        .find((s) => s.type === "tech-spec-card");
      if (techSpec) {
        const p = techSpec.props as {
          specJson?: string;
          markdown?: string;
          title?: string;
        };
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
        flash("Building prototype from the tech spec…");
        return;
      }
    }
    if (!sel.anchorId || !sel.text.trim()) {
      flash("Selection has no text to build from.", "error");
      return;
    }
    const detail: BuildUiPlansDetail = {
      sourceShapeId: sel.anchorId,
      sourceText: sel.text,
      sourceLabel: sel.label,
      count: settings.uiPlanCount,
      temperature: settings.temperature,
    };
    window.dispatchEvent(
      new CustomEvent<BuildUiPlansDetail>(BUILD_UI_PLANS_EVENT, { detail }),
    );
    flash(`Forking ${settings.uiPlanCount} UI-plan variants — pick one to build.`);
  }, [editor, sel, flash]);

  const runNotebook = useCallback(async () => {
    setRunning("notebook");
    // Any selected cards become "From board" quote blocks in the notebook.
    const quotes = editor.getSelectedShapes().reduce<
      { text: string; sourceObjectId?: string | null }[]
    >((acc, s) => {
      const t = shapeToScanTarget(s);
      const text = t?.text?.trim();
      if (text) {
        const objectId = (s.props as { objectId?: string }).objectId ?? null;
        acc.push({ text, sourceObjectId: objectId });
      }
      return acc;
    }, []);
    // Optimistic — show the journal card "synthesizing" instantly.
    deployJournalCard({
      spaceId,
      title: "Notebook",
      sectionsJson: "[]",
      pageCount: 1,
      status: "regenerating",
    });
    try {
      const res = await fetch(`/api/objective/${spaceId}/artifacts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run_notebook", quotes }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        deployJournalCard({
          spaceId,
          title: "Notebook",
          sectionsJson: "[]",
          pageCount: 1,
          status: "fresh",
        });
        flash(j.error || "Nothing to weave yet — record a note first.", "error");
        return;
      }
      const json = (await res.json()) as {
        title?: string;
        sections?: Array<{ heading?: string; body?: string }>;
        pageCount?: number;
      };
      deployJournalCard({
        spaceId,
        title: json.title || "Notebook",
        sectionsJson: JSON.stringify(json.sections ?? []),
        pageCount: json.pageCount ?? 1,
        status: "fresh",
      });
      flash(quotes.length ? "Added to your notebook." : "Notebook woven from your notes.");
      // Land the user in the editable panel.
      openNotebook({ spaceId });
    } catch {
      flash("Could not build the notebook.", "error");
    } finally {
      setRunning((c) => (c === "notebook" ? null : c));
    }
  }, [spaceId, editor, flash]);

  const runEngine = useCallback(
    (engine: ArtifactEngineDef) => {
      if (running) return;
      if (engine.status === "soon") {
        flash(`${engine.label} is coming soon.`);
        return;
      }
      if (engine.needsSelection && sel.count === 0) {
        flash(`Select something for ${engine.label} first.`, "error");
        return;
      }
      if (engine.key === "build_prototype") runPrototype();
      else if (engine.key === "notebook") void runNotebook();
    },
    [running, sel.count, flash, runPrototype, runNotebook],
  );

  return (
    <div
      className="fixed left-3 top-1/2 z-[60] flex flex-col items-center gap-2.5"
      style={{ transform: "translateY(-50%)" }}
    >
      {pinnedEngines.map((engine) => {
        const Icon = ENGINE_ICON[engine.key];
        const isRunning = running === engine.key;
        const disabled =
          isRunning ||
          (engine.needsSelection && sel.count === 0 && engine.status === "ready");
        const count =
          engine.needsSelection && sel.count > 0 ? sel.count : undefined;
        return (
          <div key={engine.key} className="group relative flex items-center">
            <button
              type="button"
              onClick={() => runEngine(engine)}
              disabled={isRunning}
              aria-label={engine.label}
              style={{
                width: 46,
                height: 46,
                borderRadius: 999,
                border: "1px solid var(--glass-border)",
                background: `linear-gradient(140deg, ${engine.gradient[0]}, ${engine.gradient[1]})`,
                color: "white",
                display: "grid",
                placeItems: "center",
                cursor: isRunning ? "default" : "pointer",
                opacity: disabled ? 0.5 : 1,
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.35), 0 10px 24px -10px rgba(11,18,40,0.45)",
                transition: "transform 160ms var(--ease-spring-soft, ease), opacity 160ms",
              }}
              onMouseEnter={(e) => {
                if (!isRunning) e.currentTarget.style.transform = "scale(1.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              {isRunning ? (
                <Loader2 className="animate-spin" style={{ width: 19, height: 19 }} strokeWidth={2.4} />
              ) : (
                <Icon style={{ width: 19, height: 19 }} strokeWidth={2.2} />
              )}
            </button>

            {/* Selection-count badge */}
            {count !== undefined && (
              <span
                style={{
                  position: "absolute",
                  top: -3,
                  right: -3,
                  minWidth: 17,
                  height: 17,
                  padding: "0 4px",
                  borderRadius: 999,
                  background: "#0F172A",
                  color: "white",
                  fontSize: 10,
                  fontWeight: 700,
                  display: "grid",
                  placeItems: "center",
                  boxShadow: "0 0 0 2px var(--glass-float-bg)",
                }}
              >
                {count}
              </span>
            )}

            {/* Hover label */}
            <span
              className="pointer-events-none opacity-0 group-hover:opacity-100"
              style={{
                position: "absolute",
                left: 56,
                whiteSpace: "nowrap",
                padding: "4px 9px",
                borderRadius: 8,
                background: "var(--glass-float-bg)",
                backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
                WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
                border: "1px solid var(--glass-border)",
                color: appleVibe.text.primary,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: appleVibe.font.stack,
                boxShadow: appleVibe.shadow.card,
                transition: "opacity 140ms",
              }}
            >
              {engine.label}
              {engine.status === "soon" && (
                <span style={{ color: appleVibe.text.faint }}> · soon</span>
              )}
            </span>
          </div>
        );
      })}

      {/* Add / catalog */}
      <div className="relative flex items-center">
        <button
          type="button"
          onClick={() => setCatalogOpen((v) => !v)}
          aria-label="Add an artifact engine"
          style={{
            width: 40,
            height: 40,
            borderRadius: 999,
            border: "1px dashed var(--glass-border)",
            background: "var(--glass-float-bg)",
            backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
            WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
            color: appleVibe.text.tertiary,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
          }}
        >
          <Plus style={{ width: 17, height: 17 }} strokeWidth={2.4} />
        </button>

        {catalogOpen && (
          <div
            style={{
              position: "absolute",
              left: 52,
              bottom: 0,
              width: 256,
              padding: 8,
              borderRadius: 16,
              background: "var(--glass-modal-bg, var(--glass-float-bg))",
              backdropFilter: "blur(var(--blur-modal, 28px)) saturate(1.7)",
              WebkitBackdropFilter: "blur(var(--blur-modal, 28px)) saturate(1.7)",
              border: "1px solid var(--glass-border)",
              boxShadow: appleVibe.shadow.cardHover ?? appleVibe.shadow.card,
              fontFamily: appleVibe.font.stack,
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: appleVibe.text.faint,
                padding: "4px 8px 8px",
              }}
            >
              Artifact engines
            </div>
            {ARTIFACT_ENGINES.map((engine) => {
              const Icon = ENGINE_ICON[engine.key];
              const isPinned = pinned.includes(engine.key);
              return (
                <button
                  key={engine.key}
                  type="button"
                  onClick={() => togglePin(engine.key)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px",
                    borderRadius: 10,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "rgba(15,23,42,0.05)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      flexShrink: 0,
                      borderRadius: 999,
                      background: `linear-gradient(140deg, ${engine.gradient[0]}, ${engine.gradient[1]})`,
                      color: "white",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <Icon style={{ width: 15, height: 15 }} strokeWidth={2.2} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12.5,
                        fontWeight: 650,
                        color: appleVibe.text.primary,
                      }}
                    >
                      {engine.label}
                      {engine.status === "soon" && (
                        <span style={{ color: appleVibe.text.faint, fontWeight: 500 }}>
                          {" "}
                          · soon
                        </span>
                      )}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: 11,
                        lineHeight: 1.35,
                        color: appleVibe.text.tertiary,
                      }}
                    >
                      {engine.blurb}
                    </span>
                  </span>
                  <span
                    style={{
                      flexShrink: 0,
                      width: 20,
                      height: 20,
                      borderRadius: 999,
                      border: isPinned
                        ? "none"
                        : `1.5px solid ${appleVibe.stroke.medium ?? appleVibe.stroke.soft}`,
                      background: isPinned ? appleVibe.accent.primary : "transparent",
                      color: "white",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {isPinned && <Check style={{ width: 13, height: 13 }} strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "absolute",
            left: 56,
            top: "50%",
            transform: "translateY(-50%)",
            whiteSpace: "nowrap",
            padding: "7px 12px",
            borderRadius: 10,
            background:
              toast.tone === "error" ? "rgba(220,38,38,0.95)" : "rgba(15,23,42,0.92)",
            color: "white",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: appleVibe.font.stack,
            boxShadow: "0 12px 30px -12px rgba(11,18,40,0.5)",
          }}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

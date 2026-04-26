"use client";

import { type ReactNode, useMemo, useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { MessageCircle, X, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SpaceDataProvider,
  useSpaceData,
  type SpaceDataProps,
} from "@/contexts/space-data-context";
import { useDeepRefresh } from "@/lib/hooks/use-deep-refresh";
import { useExpansion } from "@/lib/hooks/use-expansion";
import { SpaceHeader } from "@/components/space/space-header";
import { SpaceChat } from "@/components/chat/space-chat";
import { FloatingGlassSidebar } from "@/components/layout/floating-glass-sidebar";
import { ProjectionPanel } from "@/components/layout/projection-panel";
import { WhiteboardBackdrop } from "@/components/layout/whiteboard-backdrop";
import { KGMiniMap } from "@/components/layout/kg-mini-map";
import { KGHighlightProvider, useKGHighlight } from "@/components/layout/kg-highlight-context";
import { NodeDetail } from "@/components/graph/node-detail";
import { ExpansionShell } from "@/components/graph/expansion-shell";
import { ObjectiveReviewFlow } from "@/components/objectives/objective-review-flow";
import { GoalSetter } from "@/components/dashboard/goal-setter";
import { createClient } from "@/lib/supabase/client";
import type { ImprovementGoal } from "@/types/goals";
import type { InteractionField } from "@/types/interactions";

export function SpaceShell({
  children,
  ...data
}: SpaceDataProps & { children: ReactNode }) {
  return (
    <SpaceDataProvider {...data}>
      <KGHighlightProvider>
        <SpaceShellInner>{children}</SpaceShellInner>
      </KGHighlightProvider>
    </SpaceDataProvider>
  );
}

function SpaceShellInner({ children }: { children: ReactNode }) {
  const ctx = useSpaceData();
  const router = useRouter();
  const pathname = usePathname();
  const deepRefresh = useDeepRefresh(ctx.space.id);
  const expansion = useExpansion({ spaceId: ctx.space.id });

  // ── Projection shell state ──────────────────────────────────────────
  // The projection is open for every route EXCEPT the whiteboard (which
  // gets the full canvas to itself). Origin rect tracks the active
  // sidebar button — captured on click and re-synced on every active-
  // route change so direct URL loads still anchor the tail correctly.
  const whiteboardHref = `/app/space/${ctx.space.id}/whiteboard`;
  const isWhiteboardRoute = pathname === whiteboardHref;
  const [originRect, setOriginRect] = useState<DOMRect | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // Hover-peek: when the panel is fullscreen the sidebar slides off
  // the left edge and reappears when the user hovers the edge zone.
  const [sidebarPeek, setSidebarPeek] = useState(false);

  const handleSidebarActivate = useCallback(
    ({
      rect,
      dismissProjection,
    }: {
      rect: DOMRect;
      id: string;
      href: string;
      dismissProjection: boolean;
    }) => {
      setOriginRect(rect);
      if (dismissProjection) {
        // Whiteboard button: leaving the projection entirely also drops
        // fullscreen so the next projection opens at normal inset.
        setFullscreen(false);
      }
    },
    [],
  );

  const handleActiveRectChange = useCallback((rect: DOMRect | null) => {
    setOriginRect(rect);
  }, []);

  const handleClosePanel = useCallback(() => {
    setFullscreen(false);
    router.push(whiteboardHref);
  }, [router, whiteboardHref]);

  // Entity map for NodeDetail
  const entityMap = useMemo(
    () => new Map(ctx.entities.map((e) => [e.entity_id, e])),
    [ctx.entities]
  );

  // ── Mini-map highlight: focused entity + 1-hop neighborhood ────────
  // Whenever the user opens a NodeDetail (by clicking the mini-map, the
  // graph, or any other surface that calls setSelectedEntity), light up
  // the focused node together with its directly-connected neighbors.
  // This makes the rail behave like a "you are here" minimap — the
  // user's current focus + its immediate causal/structural context, no
  // matter where on the page they triggered the focus from.
  //
  // Layered above app-detail and plan-drawer in the highlight stack
  // (last-pushed wins), so opening a node temporarily overrides those;
  // closing the detail panel pops back to the underlying highlight.
  const { setHighlight, clearHighlight } = useKGHighlight();
  useEffect(() => {
    const focused = ctx.selectedEntity;
    if (!focused) {
      clearHighlight("node-detail");
      return;
    }
    // Build 1-hop neighborhood. Edges reference entity_id (slug), so
    // collect neighboring entity_ids first then map back to UUIDs.
    const focusEntityId = focused.entity_id;
    const neighborEntityIds = new Set<string>();
    for (const e of ctx.edges) {
      if (e.source_entity_id === focusEntityId) neighborEntityIds.add(e.target_entity_id);
      else if (e.target_entity_id === focusEntityId) neighborEntityIds.add(e.source_entity_id);
    }
    const ids = new Set<string>([focused.id]);
    for (const ent of ctx.entities) {
      if (neighborEntityIds.has(ent.entity_id)) ids.add(ent.id);
    }
    const neighborCount = ids.size - 1;
    setHighlight("node-detail", {
      ids,
      reason: `Focus · ${focused.name}${neighborCount > 0 ? ` + ${neighborCount} neighbor${neighborCount === 1 ? "" : "s"}` : ""}`,
    });
    return () => clearHighlight("node-detail");
  }, [ctx.selectedEntity, ctx.entities, ctx.edges, setHighlight, clearHighlight]);

  // Graph changed callback
  const handleGraphChanged = useCallback(() => {
    router.refresh();
  }, [router]);

  // The sidebar is visible on every route — it's the navigation
  // affordance. The only time it slides off-screen is when the
  // projection is fullscreen AND the user isn't hovering the peek
  // zone. On /whiteboard the sidebar floats over the canvas so the
  // user can return to any section without going "back".
  const sidebarHidden = fullscreen && !sidebarPeek && !isWhiteboardRoute;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Always-mounted whiteboard-ish backdrop — the product's base
          layer. Kept lightweight (no tldraw here) so routing between
          sections doesn't pay the canvas boot cost. The real tldraw
          editor only loads on the /whiteboard route. */}
      <WhiteboardBackdrop />

      {/* Left-edge hover hit-zone that brings the sidebar back when
          the projection is fullscreen. Wider (28px) than the visible
          rail so users don't have to be pixel-precise. */}
      {!isWhiteboardRoute && fullscreen && (
        <div
          onMouseEnter={() => setSidebarPeek(true)}
          onMouseLeave={() => setSidebarPeek(false)}
          className="fixed left-0 top-0 z-[55] h-full w-7"
          aria-hidden
        />
      )}

      {/* Floating glass sidebar — always mounted, slides off-screen
          when fullscreen + not peeking. The hide animation lives on
          the motion element itself (no transformed wrapper) so its
          position:fixed resolves against the viewport. */}
      <div
        onMouseEnter={() => fullscreen && setSidebarPeek(true)}
        onMouseLeave={() => fullscreen && setSidebarPeek(false)}
      >
        <FloatingGlassSidebar
          spaceId={ctx.space.id}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          useCaseTemplateId={(ctx.space as any).use_case_template_id ?? null}
          onActivate={handleSidebarActivate}
          onActiveRectChange={handleActiveRectChange}
          hidden={sidebarHidden}
          compact={fullscreen}
          // On the whiteboard route, collapse to a thin glass strip so
          // it doesn't fight the canvas tool dock for left-edge real
          // estate. Hover expands it and the dock slides right.
          railMode={isWhiteboardRoute}
        />
      </div>

      {/* Whiteboard route: children render at root so WhiteboardPage's
          own `fixed inset-0` overlay can take the full viewport. The
          projection panel stays closed (no card, no backdrop) so the
          tldraw canvas isn't competing with anything but the floating
          sidebar above it. */}
      {isWhiteboardRoute && children}

      {/* Every other route: children render inside the projection card.
          The card holds the SpaceHeader, the routed main, the KG mini-
          map, and the chat overlay. AnimatePresence handles enter/exit
          so closing returns to the bare canvas with a smooth fade. */}
      <ProjectionPanel
        open={!isWhiteboardRoute}
        originRect={originRect}
        fullscreen={fullscreen}
        onToggleFullscreen={() => setFullscreen((v) => !v)}
        onClose={handleClosePanel}
      >
        <div className="flex h-full min-h-full flex-col">
          <div className="flex-shrink-0 px-6 pt-5 pb-2 pr-28">
            <SpaceHeader
              space={ctx.space}
              liveCounts={ctx.liveCounts}
              deepRefresh={deepRefresh}
            />
          </div>

          <div className="relative flex flex-1 min-h-0 overflow-hidden">
            <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
            <KGMiniMap />

            {ctx.chatOpen && (
              <div
                className={cn(
                  "absolute top-2 right-3 z-30 flex flex-col rounded-xl border border-gray-200 bg-white shadow-lg transition-all duration-300 overflow-hidden",
                  ctx.chatExpanded
                    ? "w-[480px] h-[calc(100%-16px)]"
                    : "w-[360px] h-[420px]"
                )}
              >
                <div className="absolute top-2.5 right-2 z-10 flex items-center gap-0.5">
                  <button
                    onClick={() => ctx.setChatExpanded(!ctx.chatExpanded)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                    title={ctx.chatExpanded ? "Shrink" : "Expand"}
                  >
                    {ctx.chatExpanded ? (
                      <Minimize2 className="h-3 w-3" />
                    ) : (
                      <Maximize2 className="h-3 w-3" />
                    )}
                  </button>
                  <button
                    onClick={() => ctx.setChatOpen(false)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                    title="Close chat"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <SpaceChat
                  spaceId={ctx.space.id}
                  entities={ctx.entities}
                  onGraphChanged={handleGraphChanged}
                  mode="inline"
                  onChatReady={ctx.handleChatReady}
                />
              </div>
            )}

            {!ctx.chatOpen && (
              <button
                onClick={() => ctx.setChatOpen(true)}
                className="absolute bottom-4 right-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-[color:rgb(var(--accent-rgb,6_145_154))] shadow-[0_6px_20px_-6px_rgba(15,23,42,0.18)] border border-black/5 backdrop-blur hover:bg-white transition-colors"
                title="Open chat"
              >
                <MessageCircle className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </ProjectionPanel>

      {/* Node detail slide-out */}
      {ctx.selectedEntity && (
        <NodeDetail
          entity={ctx.selectedEntity}
          edges={ctx.edges}
          entityMap={entityMap}
          cycles={ctx.cycles}
          spaceId={ctx.space.id}
          interactionField={(() => {
            const meta = (
              ctx.space.synthesis_data as Record<string, unknown>
            )?.interaction_metadata;
            if (!meta || typeof meta !== "object") return null;
            const fields = (meta as Record<string, unknown>)
              .fields as InteractionField[];
            if (!fields) return null;
            return (
              fields.find(
                (f) => f.entity_id === ctx.selectedEntity!.entity_id
              ) ?? null
            );
          })()}
          onClose={() => ctx.setSelectedEntity(null)}
          onExpand={(entity) => {
            expansion.expand(entity);
            ctx.setSelectedEntity(null);
          }}
          onNavigateToSection={(sectionIdSpec) => {
            const candidates = sectionIdSpec.split("|");
            const tryScroll = (attempts: number) => {
              for (const id of candidates) {
                const el = document.getElementById(id);
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "start" });
                  return;
                }
              }
              if (attempts > 0) {
                requestAnimationFrame(() =>
                  setTimeout(() => tryScroll(attempts - 1), 80)
                );
              }
            };
            requestAnimationFrame(() => setTimeout(() => tryScroll(10), 50));
          }}
          onRunReasoning={() => {
            // Navigate to graph page for reasoning operations
            router.push(`/app/space/${ctx.space.id}/graph`);
          }}
        />
      )}

      {/* Shell expansion overlay */}
      {expansion.isOpen && expansion.activeExpansion && (
        <ExpansionShell
          expansion={expansion.activeExpansion}
          breadcrumbs={expansion.breadcrumbs}
          budget={expansion.budget}
          loading={expansion.loading}
          error={expansion.error}
          onDrillInto={(sc) => {
            if (expansion.activeExpansion) {
              expansion.drillInto(sc, expansion.activeExpansion);
            }
          }}
          onGoBack={expansion.goBack}
          onGoToLevel={expansion.goToLevel}
          onClose={expansion.close}
        />
      )}

      {/* Objective review flow */}
      {!ctx.objectivesReviewed && ctx.pendingObjectives.length > 0 && (
        <ObjectiveReviewFlow
          objectives={ctx.pendingObjectives}
          spaceId={ctx.space.id}
          spaceName={ctx.space.name}
          onComplete={async (approved, ultimate) => {
            ctx.setObjectivesReviewed(true);

            // 1) Create the ultimate (parent) goal FIRST so sub-objectives can be
            //    linked via parent_goal_id. This is the goal the dashboard shows
            //    as "Main Objective" — without it, the banner stays "No goal set".
            let ultimateGoal: ImprovementGoal | null = null;
            try {
              const res = await fetch("/api/goals", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  space_id: ctx.space.id,
                  title: ultimate.title,
                  description: ultimate.description,
                  metric_name: ultimate.metric_name,
                  metric_unit: ultimate.metric_unit ?? null,
                  target_value: ultimate.target_value,
                  baseline_value: ultimate.baseline_value,
                  objective_type: ultimate.objective_type,
                  source: "auto_detected",
                  parent_goal_id: null,
                }),
              });
              if (res.ok) {
                const data = await res.json();
                ultimateGoal = (data.goal ?? data) as ImprovementGoal;
                ctx.setGoalList((prev) => [ultimateGoal as ImprovementGoal, ...prev]);
                ctx.setActiveGoal(ultimateGoal);
              }
            } catch (err) {
              console.error("Failed to create ultimate goal:", err);
            }

            // 2) Create each approved sub-objective as a child of the ultimate goal.
            for (const obj of approved) {
              try {
                const res = await fetch("/api/goals", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    space_id: ctx.space.id,
                    title: obj.title,
                    description: obj.description,
                    metric_name: obj.metric_name,
                    metric_unit: obj.metric_unit ?? null,
                    target_value: obj.target_estimate ?? 100,
                    baseline_value: obj.baseline_estimate ?? 0,
                    objective_type: obj.objective_type,
                    source: "auto_detected",
                    parent_goal_id: ultimateGoal?.id ?? obj.parent_goal_id ?? null,
                    benchmark: obj.benchmark ?? null,
                  }),
                });
                if (res.ok) {
                  const data = await res.json();
                  const newGoal = (data.goal ?? data) as ImprovementGoal;
                  ctx.setGoalList((prev) => [newGoal, ...prev]);
                }
              } catch (err) {
                console.error("Failed to create goal from objective:", err);
              }
            }
            // Clear the pending review flag
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const supabase = createClient() as any;
              const { data: freshSpace } = await supabase
                .from("spaces")
                .select("synthesis_data")
                .eq("id", ctx.space.id)
                .single();
              if (freshSpace?.synthesis_data) {
                const sd =
                  typeof freshSpace.synthesis_data === "string"
                    ? JSON.parse(freshSpace.synthesis_data)
                    : freshSpace.synthesis_data;
                await supabase
                  .from("spaces")
                  .update({
                    synthesis_data: {
                      ...sd,
                      objectives_pending_review: false,
                    },
                  })
                  .eq("id", ctx.space.id);
              }
            } catch (err) {
              console.error("Failed to clear objectives_pending_review:", err);
            }
            router.refresh();
          }}
          onSkip={async () => {
            ctx.setObjectivesReviewed(true);
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const supabase = createClient() as any;
              const { data: freshSpace } = await supabase
                .from("spaces")
                .select("synthesis_data")
                .eq("id", ctx.space.id)
                .single();
              if (freshSpace?.synthesis_data) {
                const sd =
                  typeof freshSpace.synthesis_data === "string"
                    ? JSON.parse(freshSpace.synthesis_data)
                    : freshSpace.synthesis_data;
                await supabase
                  .from("spaces")
                  .update({
                    synthesis_data: {
                      ...sd,
                      objectives_pending_review: false,
                    },
                  })
                  .eq("id", ctx.space.id);
              }
            } catch (err) {
              console.error(
                "Failed to clear objectives_pending_review on skip:",
                err
              );
            }
            router.refresh();
          }}
        />
      )}

      {/* Goal setter modal */}
      {ctx.showGoalSetter && (
        <GoalSetter
          spaceId={ctx.space.id}
          prefill={ctx.goalPrefill}
          onCreated={(goal) => {
            const newGoal = goal as ImprovementGoal;
            ctx.setGoalList((prev) => [newGoal, ...prev]);
            ctx.setActiveGoal(newGoal);
            ctx.setShowGoalSetter(false);
            ctx.setGoalPrefill(null);
          }}
          onClose={() => {
            ctx.setShowGoalSetter(false);
            ctx.setGoalPrefill(null);
          }}
        />
      )}
    </div>
  );
}

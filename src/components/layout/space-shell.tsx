"use client";

import { type ReactNode, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
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
import { SpaceSectionNav } from "@/components/layout/space-section-nav";
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
      <SpaceShellInner>{children}</SpaceShellInner>
    </SpaceDataProvider>
  );
}

function SpaceShellInner({ children }: { children: ReactNode }) {
  const ctx = useSpaceData();
  const router = useRouter();
  const deepRefresh = useDeepRefresh(ctx.space.id);
  const expansion = useExpansion({ spaceId: ctx.space.id });

  // Entity map for NodeDetail
  const entityMap = useMemo(
    () => new Map(ctx.entities.map((e) => [e.entity_id, e])),
    [ctx.entities]
  );

  // Graph changed callback
  const handleGraphChanged = useCallback(() => {
    router.refresh();
  }, [router]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* HEADER — persists across all section pages */}
      <div className="flex-shrink-0 px-6 pt-4 pb-2">
        <SpaceHeader
          space={ctx.space}
          liveCounts={ctx.liveCounts}
          deepRefresh={deepRefresh}
        />
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        {/* LEFT: Section navigation sidebar */}
        <SpaceSectionNav
          spaceId={ctx.space.id}
          hasSynthesis={ctx.hasSynthesis}
          entityCount={ctx.entities.length}
          hasStrategy={
            !!(ctx.space.synthesis_data as Record<string, unknown>)
              ?.strategic_recommendation
          }
          hasGoal={!!ctx.activeGoal}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          useCaseTemplateId={(ctx.space as any).use_case_template_id ?? null}
        />

        {/* CENTER: Routed content */}
        <main className="flex-1 overflow-y-auto min-w-0">{children}</main>

        {/* TOP-RIGHT: Chat Panel — expandable overlay */}
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

        {/* Chat toggle button — shown when chat is closed */}
        {!ctx.chatOpen && (
          <button
            onClick={() => ctx.setChatOpen(true)}
            className="absolute top-3 right-4 z-30 flex h-9 w-9 items-center justify-center rounded-lg bg-interaxis-50 text-interaxis-600 hover:bg-interaxis-100 shadow-sm border border-interaxis-100 transition-colors"
            title="Open chat"
          >
            <MessageCircle className="h-4 w-4" />
          </button>
        )}
      </div>

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

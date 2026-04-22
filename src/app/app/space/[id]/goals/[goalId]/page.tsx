// Wave D L2.1 — Goal detail page.
//
// Route: /app/space/[id]/goals/[goalId]
//
// Purpose: until Wave D, goals had no detail surface. The
// entity_objectives junction built in Wave A had exactly one reader
// (the staleness cascade); users could approve a goal in the review UI
// but then couldn't ever open it and see "this goal is served by
// entities X, Y, Z" or "these apps serve this goal."
//
// This page closes that gap. It renders:
//   - Goal header: title, description, status, metric, target, progress
//   - Auto-detection provenance (rationale + confidence + input type)
//     when the goal was auto-materialised by decompose (Wave A)
//   - "Served by" entities from entity_objectives (Wave A junction)
//   - Apps that serve this goal (via apps.serves_goal_id)
//   - Active interventions under those apps, each with the Wave D
//     InterventionStatusCard so users can complete/abandon them
//
// Apple Vision Pro vibes:
//   - Layered glass panels (reusing .glass-card-dashboard)
//   - Depth on hover (existing pattern)
//   - Section headers with tiny dot + uppercase-tracked labels
//   - Subtle motion on arrival, no harsh transitions

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Target,
  Sparkles,
  Activity,
  Layers,
  TrendingUp,
} from "lucide-react";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { GoalDetailClient } from "@/components/goals/goal-detail-client";

export const dynamic = "force-dynamic";

interface GoalRow {
  id: string;
  space_id: string;
  user_id: string;
  parent_goal_id: string | null;
  title: string;
  description: string | null;
  objective_type: string | null;
  status: string;
  source: string | null;
  metric_name: string | null;
  metric_unit: string | null;
  target_value: number | null;
  baseline_value: number | null;
  current_value: number | null;
  deadline: string | null;
  created_at: string;
  auto_detection_rationale: string | null;
  auto_detection_confidence: string | null;
  auto_detection_input_type: string | null;
  proposed_at: string | null;
  resolved_at: string | null;
}

interface LinkedEntity {
  entity_id: string;
  name: string;
  description: string | null;
  entity_category: string | null;
  importance: string | null;
  confidence: number;
  rationale: string | null;
}

interface LinkedApp {
  id: string;
  name: string;
  description: string | null;
  status: string;
  health_score: number | null;
  stale_reason: string | null;
  intervention_count: number;
  interventions_completed: number;
}

interface InterventionRow {
  id: string;
  app_id: string | null;
  title: string;
  description: string | null;
  status: "proposed" | "active" | "completed" | "superseded" | "abandoned";
  priority: number | null;
  effort: string | null;
  impact: string | null;
  timeframe: string | null;
  metric_name: string | null;
  metric_target: string | null;
}

export default async function GoalDetailPage({
  params,
}: {
  params: Promise<{ id: string; goalId: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const { id: spaceId, goalId } = await params;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // 1. Goal + ownership check
  const { data: goal } = (await db
    .from("improvement_goals")
    .select("*")
    .eq("id", goalId)
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle()) as { data: GoalRow | null };

  if (!goal) notFound();

  // 2. entity_objectives junction → hydrated linked entities
  const linkedEntities: LinkedEntity[] = await (async () => {
    const { data: junction } = (await db
      .from("entity_objectives")
      .select("entity_id, confidence, rationale")
      .eq("goal_id", goalId)
      .order("confidence", { ascending: false })
      .limit(20)) as {
      data: Array<{
        entity_id: string;
        confidence: number;
        rationale: string | null;
      }> | null;
    };
    const links = junction ?? [];
    if (links.length === 0) return [];

    const { data: entityRows } = (await db
      .from("entities")
      .select("id, name, description, entity_category, importance")
      .in(
        "id",
        links.map((l) => l.entity_id),
      )) as {
      data: Array<{
        id: string;
        name: string;
        description: string | null;
        entity_category: string | null;
        importance: string | null;
      }> | null;
    };
    const byId = new Map((entityRows ?? []).map((e) => [e.id, e]));
    return links
      .map((l) => {
        const e = byId.get(l.entity_id);
        if (!e) return null;
        return {
          entity_id: l.entity_id,
          name: e.name,
          description: e.description,
          entity_category: e.entity_category,
          importance: e.importance,
          confidence: l.confidence,
          rationale: l.rationale,
        };
      })
      .filter((x): x is LinkedEntity => x !== null);
  })();

  // 3. Apps serving this goal
  const linkedApps: LinkedApp[] = await (async () => {
    const { data: appRows } = (await db
      .from("apps")
      .select(
        "id, name, description, status, health_score, stale_reason, dominant_entity_ids",
      )
      .eq("serves_goal_id", goalId)
      .neq("status", "retired")) as {
      data: Array<{
        id: string;
        name: string;
        description: string | null;
        status: string;
        health_score: number | null;
        stale_reason: string | null;
      }> | null;
    };
    const apps = appRows ?? [];
    if (apps.length === 0) return [];

    // Intervention counts per app
    const appIds = apps.map((a) => a.id);
    const { data: ivCounts } = (await db
      .from("interventions")
      .select("app_id, status")
      .in("app_id", appIds)) as {
      data: Array<{ app_id: string; status: string }> | null;
    };
    const counts = new Map<string, { total: number; completed: number }>();
    for (const r of ivCounts ?? []) {
      const b = counts.get(r.app_id) ?? { total: 0, completed: 0 };
      b.total += 1;
      if (r.status === "completed") b.completed += 1;
      counts.set(r.app_id, b);
    }

    return apps.map((a) => ({
      ...a,
      intervention_count: counts.get(a.id)?.total ?? 0,
      interventions_completed: counts.get(a.id)?.completed ?? 0,
    }));
  })();

  // 4. Active interventions under any of those apps
  const activeInterventions: InterventionRow[] = await (async () => {
    if (linkedApps.length === 0) return [];
    const { data } = (await db
      .from("interventions")
      .select(
        "id, app_id, title, description, status, priority, effort, impact, timeframe, metric_name, metric_target",
      )
      .in(
        "app_id",
        linkedApps.map((a) => a.id),
      )
      .in("status", ["proposed", "active"])
      .order("priority", { ascending: true })
      .limit(20)) as {
      data: InterventionRow[] | null;
    };
    return data ?? [];
  })();

  // ── UI ────────────────────────────────────────────────────────────
  const progressPct =
    goal.target_value && goal.baseline_value !== null
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(
              (((goal.current_value ?? goal.baseline_value ?? 0) -
                (goal.baseline_value ?? 0)) /
                (goal.target_value - (goal.baseline_value ?? 0) || 1)) *
                100,
            ),
          ),
        )
      : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link
        href={`/app/space/${spaceId}/objectives`}
        className="inline-flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to objectives
      </Link>

      {/* Header */}
      <header className="mt-4 rounded-2xl border border-gray-200/60 bg-white/55 p-5 backdrop-blur-md"
        style={{
          boxShadow:
            "0 16px 40px -14px rgba(8, 60, 180, 0.08), 0 6px 14px -8px rgba(8, 60, 180, 0.04), inset 0 1px 0 rgba(255, 255, 255, 1)",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-interaxis-600">
              <Target className="h-3 w-3" />
              Objective
              <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-gray-600">
                {goal.status}
              </span>
              {goal.source === "auto_detected" && (
                <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-interaxis-50 px-1.5 py-0.5 text-interaxis-700">
                  <Sparkles className="h-2.5 w-2.5" />
                  auto-detected
                </span>
              )}
            </div>
            <h1 className="mt-1 text-[22px] font-semibold text-gray-900">
              {goal.title}
            </h1>
            {goal.description && (
              <p className="mt-1 text-[13px] text-gray-600">
                {goal.description}
              </p>
            )}
          </div>

          {progressPct !== null && (
            <div className="flex-shrink-0 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                Progress
              </div>
              <div className="mt-0.5 text-2xl font-semibold text-gray-900 tabular-nums">
                {progressPct}
                <span className="text-[12px] text-gray-500">%</span>
              </div>
            </div>
          )}
        </div>

        {/* Metric strip */}
        {goal.metric_name && (
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <Stat
              label="Metric"
              value={`${goal.metric_name}${goal.metric_unit ? ` (${goal.metric_unit})` : ""}`}
            />
            {goal.baseline_value !== null && (
              <Stat label="Baseline" value={`${goal.baseline_value}`} />
            )}
            {goal.current_value !== null && (
              <Stat label="Current" value={`${goal.current_value}`} />
            )}
            {goal.target_value !== null && (
              <Stat label="Target" value={`${goal.target_value}`} />
            )}
          </div>
        )}

        {/* Auto-detection provenance */}
        {goal.source === "auto_detected" && goal.auto_detection_rationale && (
          <div className="mt-4 rounded-xl border-l-2 border-interaxis-400 bg-interaxis-50/40 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-interaxis-700">
              <Sparkles className="h-3 w-3" />
              Detected from your intake
              {goal.auto_detection_confidence && (
                <span className="ml-1 rounded-full bg-white px-1.5 py-0.5 text-gray-600">
                  {goal.auto_detection_confidence} confidence
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[12px] italic text-gray-700">
              {goal.auto_detection_rationale}
            </p>
            {goal.auto_detection_input_type && (
              <div className="mt-1 text-[10px] text-gray-500">
                Input type: {goal.auto_detection_input_type}
              </div>
            )}
          </div>
        )}
      </header>

      {/* Served-by entities */}
      <section className="mt-6">
        <SectionHeader
          icon={<Layers className="h-3 w-3" />}
          label="Served by"
          subtitle={`${linkedEntities.length} entit${linkedEntities.length === 1 ? "y" : "ies"} from your knowledge graph`}
        />
        {linkedEntities.length === 0 ? (
          <EmptyMessage
            text="No entities linked yet. When decompose runs, the LLM tagger populates this list automatically."
          />
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {linkedEntities.map((e) => (
              <EntityTile key={e.entity_id} entity={e} spaceId={spaceId} />
            ))}
          </div>
        )}
      </section>

      {/* Apps serving this goal */}
      <section className="mt-6">
        <SectionHeader
          icon={<TrendingUp className="h-3 w-3" />}
          label="Apps serving this goal"
          subtitle={`${linkedApps.length} app${linkedApps.length === 1 ? "" : "s"}`}
        />
        {linkedApps.length === 0 ? (
          <EmptyMessage
            text="No apps materialised yet. When strategy-refresh runs, matching apps link here via serves_goal_id."
          />
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {linkedApps.map((a) => (
              <AppTile key={a.id} app={a} spaceId={spaceId} />
            ))}
          </div>
        )}
      </section>

      {/* Active interventions */}
      <section className="mt-6">
        <SectionHeader
          icon={<Activity className="h-3 w-3" />}
          label="Active interventions"
          subtitle={`${activeInterventions.length} in flight`}
        />
        {activeInterventions.length === 0 ? (
          <EmptyMessage text="No active interventions under apps serving this goal." />
        ) : (
          <GoalDetailClient interventions={activeInterventions} />
        )}
      </section>
    </div>
  );
}

// ── Presentational subcomponents (server-safe) ───────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-gray-100/70 px-2 py-0.5">
      <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500">
        {label}
      </span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}

function SectionHeader({
  icon,
  label,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-interaxis-600">{icon}</span>
      <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-700">
        {label}
      </h2>
      <span className="text-[11px] text-gray-400">· {subtitle}</span>
    </div>
  );
}

function EmptyMessage({ text }: { text: string }) {
  return (
    <div className="mt-3 rounded-xl border border-dashed border-gray-200 bg-white/40 p-4 text-center text-[12px] text-gray-500">
      {text}
    </div>
  );
}

function EntityTile({
  entity,
  spaceId,
}: {
  entity: LinkedEntity;
  spaceId: string;
}) {
  const catColor =
    entity.entity_category === "process"
      ? "#fbbf24"
      : entity.entity_category === "abstract"
        ? "#a78bfa"
        : entity.entity_category === "relational"
          ? "#22d3ee"
          : entity.entity_category === "epistemic"
            ? "#f472b6"
            : "#0c8f44";

  return (
    <Link
      href={`/app/space/${spaceId}/entity/${entity.entity_id}/lab`}
      className="group block rounded-xl border border-gray-200/60 bg-white/60 p-3 backdrop-blur-sm transition-all hover:border-gray-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ background: catColor }}
            />
            <div className="truncate text-[13px] font-semibold text-gray-900">
              {entity.name}
            </div>
          </div>
          {entity.description && (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-600">
              {entity.description}
            </p>
          )}
        </div>
        <span
          className="flex-shrink-0 tabular-nums text-[10px] font-semibold"
          style={{ color: catColor }}
          title={`LLM tagger confidence ${Math.round(entity.confidence * 100)}%`}
        >
          {Math.round(entity.confidence * 100)}%
        </span>
      </div>
      {entity.rationale && (
        <p className="mt-1.5 line-clamp-2 text-[10.5px] italic text-gray-500">
          {entity.rationale}
        </p>
      )}
    </Link>
  );
}

function AppTile({
  app,
  spaceId,
}: {
  app: LinkedApp;
  spaceId: string;
}) {
  const isStale = !!app.stale_reason;
  return (
    <Link
      href={`/app/space/${spaceId}/app/${app.id}`}
      className="group relative block overflow-hidden rounded-xl border border-gray-200/60 bg-white/60 p-3 backdrop-blur-sm transition-all hover:border-gray-300 hover:shadow-md"
    >
      {isStale && (
        <span
          className="absolute right-2 top-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700"
          title={`Stale: ${app.stale_reason}`}
        >
          stale
        </span>
      )}
      <div className="text-[13px] font-semibold text-gray-900">{app.name}</div>
      {app.description && (
        <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-600">
          {app.description}
        </p>
      )}
      <div className="mt-2.5 flex items-center gap-2 text-[10px] text-gray-500">
        {app.health_score !== null && (
          <span className="tabular-nums">
            {Math.round(app.health_score)}% healthy
          </span>
        )}
        <span>·</span>
        <span>
          {app.interventions_completed}/{app.intervention_count} done
        </span>
      </div>
    </Link>
  );
}

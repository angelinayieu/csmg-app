import { createClient, getAuthUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import type { KGMetricsSnapshotRow, LoopCycleRecordRow } from "@/types/loop-metrics";

export default async function AnalyticsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Fetch user's spaces
  const { data: spaces } = await db
    .from("spaces")
    .select("id, title, synthesis_data, entity_count, edge_count, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  // Fetch metrics snapshots (last 90 days)
  const spaceIds = (spaces ?? []).map((s: { id: string }) => s.id);
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: snapshots }, { data: cycles }] = await Promise.all([
    spaceIds.length > 0
      ? db
          .from("kg_metrics_snapshots")
          .select("*")
          .in("space_id", spaceIds)
          .gte("captured_at", cutoff)
          .order("captured_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    spaceIds.length > 0
      ? db
          .from("loop_cycle_records")
          .select("*")
          .in("space_id", spaceIds)
          .order("started_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50/50">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            Analytics
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Track knowledge graph growth, research effectiveness, and goal contribution
          </p>
        </div>
        <AnalyticsDashboard
          spaces={spaces ?? []}
          snapshots={(snapshots ?? []) as KGMetricsSnapshotRow[]}
          cycles={(cycles ?? []) as LoopCycleRecordRow[]}
        />
      </div>
    </div>
  );
}

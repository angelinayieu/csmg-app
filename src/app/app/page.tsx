import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SpaceCard } from "@/components/dashboard/space-card";
import { Constellation } from "@/components/dashboard/constellation";
import type { Space, Bridge } from "@/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from("spaces")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(20);

  const spaces = (data ?? []) as Space[];

  if (spaces.length === 0) {
    return <EmptyState />;
  }

  // Fetch bridges for constellation view
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const spaceIds = spaces.map((s) => s.id);
  let bridges: Bridge[] = [];
  if (spaceIds.length > 1 && user) {
    const { data: bridgesData } = await db
      .from("bridges")
      .select("*")
      .in("source_space_id", spaceIds);
    bridges = (bridgesData ?? []) as Bridge[];
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Your Analysis Landscape</h1>
      <p className="mt-1 text-sm text-gray-500">
        {spaces.length} space{spaces.length > 1 ? "s" : ""}
        {bridges.length > 0 && ` · ${bridges.length} bridge${bridges.length > 1 ? "s" : ""}`}
      </p>

      {/* Constellation view for 2+ spaces */}
      {spaces.length >= 2 && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4" style={{ height: 300 }}>
          <Constellation spaces={spaces} bridges={bridges} />
        </div>
      )}

      {/* Space cards grid */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {spaces.map((space) => (
          <SpaceCard key={space.id} space={space} />
        ))}
      </div>
    </div>
  );
}

import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SpaceCard } from "@/components/dashboard/space-card";
import type { Space } from "@/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("spaces")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(20);

  const spaces = (data ?? []) as Space[];

  if (spaces.length === 0) {
    return <EmptyState />;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Your Spaces</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {spaces.map((space) => (
          <SpaceCard key={space.id} space={space} />
        ))}
      </div>
    </div>
  );
}

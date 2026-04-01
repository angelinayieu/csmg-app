import { createClient } from "@/lib/supabase/server";
import { MetaGraph } from "@/components/meta/meta-graph";
import type { Space, Bridge } from "@/types";

export default async function MetaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: spacesData } = await db
    .from("spaces")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const spaces = (spacesData ?? []) as Space[];
  const spaceIds = spaces.map((s) => s.id);

  let bridges: Bridge[] = [];
  if (spaceIds.length > 0) {
    const { data: bridgesData } = await db
      .from("bridges")
      .select("*")
      .in("source_space_id", spaceIds);
    bridges = (bridgesData ?? []) as Bridge[];
  }

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Meta-Graph</h1>
        <p className="mt-1 text-sm text-gray-600">
          All your spaces and their connections. Click a space to navigate to it.
        </p>
      </div>
      <div className="flex-1 min-h-[400px] rounded-xl border border-gray-200 bg-white">
        <MetaGraph spaces={spaces} bridges={bridges} />
      </div>
    </div>
  );
}

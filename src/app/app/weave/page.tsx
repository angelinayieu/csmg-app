import { createClient } from "@/lib/supabase/server";
import { WeavingPanel } from "@/components/weaving/weaving-panel";
import type { Space } from "@/types";

export default async function WeavePage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("spaces")
    .select("*")
    .order("updated_at", { ascending: false });

  const spaces = (data ?? []) as Space[];

  return <WeavingPanel spaces={spaces} />;
}

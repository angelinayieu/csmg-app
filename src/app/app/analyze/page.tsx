import { createClient } from "@/lib/supabase/server";
import { InputPanel } from "@/components/analysis/input-panel";

export default async function AnalyzePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let creditBalance = 10;
  if (user) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("profiles")
      .select("credit_balance")
      .eq("id", user.id)
      .single();
    creditBalance = (data as { credit_balance?: number } | null)?.credit_balance ?? 10;
  }

  return <InputPanel creditBalance={creditBalance} />;
}

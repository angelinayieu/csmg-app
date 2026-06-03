// /app/connect/tabs — tab-sync setup
//
// Get-or-creates the user's pairing token (server-side, RLS-scoped) and
// renders the connect instructions. Linked from the chatbox "tabs" chip.

import { redirect } from "next/navigation";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { TabsConnect } from "@/components/home/tabs-connect";

export const dynamic = "force-dynamic";

export default async function ConnectTabsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let pairingToken = "";
  const { data: existing } = await db
    .from("user_integrations")
    .select("pairing_token")
    .eq("user_id", user.id)
    .eq("provider", "browser_tabs")
    .maybeSingle();

  if (existing?.pairing_token) {
    pairingToken = existing.pairing_token as string;
  } else {
    const token = crypto.randomUUID();
    const { error } = await db.from("user_integrations").upsert(
      {
        user_id: user.id,
        provider: "browser_tabs",
        status: "pending",
        pairing_token: token,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    );
    if (!error) pairingToken = token;
  }

  return <TabsConnect pairingToken={pairingToken} />;
}

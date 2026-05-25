// /app/distill — single-page thought distiller.
//
// Server shell: auth gate only. The real surface is the client
// DistillWorkspace component which owns the textarea + 4-layer
// cascade and debounces calls to /api/distill.

import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { DistillWorkspace } from "@/components/distill/distill-workspace";

export const dynamic = "force-dynamic";

export default async function DistillPage() {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");
  return <DistillWorkspace />;
}

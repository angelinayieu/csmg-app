// ── /app/strategy/new — generate a strategy from a prompt ──
//
// Auth-gated. The page itself is just a shell; the client component
// owns the prompt input + the multi-stage crystallization UI + the
// final navigation to /app/synergy/[session_id]/strategy.

import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { StrategyNewClient } from "./strategy-new-client";

interface PageProps {
  searchParams: Promise<{ prompt?: string }>;
}

export default async function StrategyNewPage({ searchParams }: PageProps) {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const { prompt } = await searchParams;
  return <StrategyNewClient initialPrompt={prompt ?? ""} />;
}

// GET /api/health/supabase
//
// Health endpoint for the service-degradation UI banner. Returns the
// current state of the Supabase circuit breaker (closed | open) plus
// a count of recent transient failures and (when open) the cooldown
// expiry time. Polled by ServiceDegradationBanner every 10s while
// any 5xx has been seen recently, every 60s on the green path.
//
// Cheap — no Supabase calls. Reads in-memory module state from
// supabase-retry.ts. maxDuration=2 because if even a 2s read fails
// we have bigger problems.

import { NextResponse } from "next/server";
import { getCircuitStatus } from "@/lib/supabase-retry";

export const runtime = "nodejs";
export const maxDuration = 2;

export async function GET() {
  const status = getCircuitStatus();
  return NextResponse.json(
    {
      degraded: status.open,
      recentFailureCount: status.recentFailureCount,
      // ms remaining until the breaker auto-closes; null when closed
      cooldownRemainingMs: status.openUntilMs
        ? Math.max(0, status.openUntilMs - Date.now())
        : null,
      checkedAt: new Date().toISOString(),
    },
    {
      // Cache-control disabled so the banner sees fresh state on
      // every poll. Vercel's edge cache will respect this.
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    },
  );
}

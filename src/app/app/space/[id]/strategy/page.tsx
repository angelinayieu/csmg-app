"use client";

import { StrategyGlassPage } from "@/components/strategy/v2/strategy-glass-page";
import { LegacyStrategyPage } from "@/components/strategy/legacy/legacy-strategy-page";

// NEXT_PUBLIC_STRATEGY_V1_FALLBACK=1 renders the previous 1559-line implementation
// for instant rollback without a deploy. Remove after v2 QA signoff.
const FALLBACK = process.env.NEXT_PUBLIC_STRATEGY_V1_FALLBACK === "1";

export default function StrategyPage() {
  if (FALLBACK) return <LegacyStrategyPage />;
  return <StrategyGlassPage />;
}

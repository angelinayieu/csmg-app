"use client";

import { useParams } from "next/navigation";
import { CalculationTraceView } from "@/components/causal-chains/calculation-trace-view";

export default function TracePage() {
  const params = useParams<{ id: string; chainId: string }>();
  const chainId = params?.chainId;
  if (!chainId) return null;
  return <CalculationTraceView chainId={chainId} />;
}

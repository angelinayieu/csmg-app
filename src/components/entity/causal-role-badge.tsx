"use client";

import { cn } from "@/lib/utils";

const ROLE_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  truth: { label: "Truth", bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
  evidence: { label: "Evidence", bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200" },
  deliverable: { label: "Deliverable", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  application: { label: "Application", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  outcome: { label: "Outcome", bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  goal: { label: "Goal", bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
};

export function CausalRoleBadge({ role }: { role: string | null | undefined }) {
  if (!role) return null;
  const config = ROLE_CONFIG[role];
  if (!config) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        config.bg,
        config.text,
        config.border
      )}
    >
      {config.label}
    </span>
  );
}

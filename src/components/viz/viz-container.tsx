"use client";

// ── Viz container ──────────────────────────────────────────────────────
//
// Thin data-viz wrapper on top of the existing `GlassCard` primitive so
// every chart shares the same radius, blur, ring, shadow, and inner
// highlight as the rest of the app. Without this, ad-hoc `bg-white/70
// rounded-xl` cards diverge from the dashboard's `glass-card-dashboard`
// treatment and the page reads as "two design systems."
//
// Owns only: the header chrome (icon + title + subtitle + right slot)
// and a min-height body slot. Leave background / blur / shadow entirely
// to GlassCard.

import type { ComponentType, ReactNode } from "react";
import { GlassCard, type GlassCardVariant } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";

interface VizContainerProps {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  /** Right-side slot for chips, toggles, action buttons. */
  rightSlot?: ReactNode;
  /** Forward to the outer glass card — e.g. "h-[480px]" for a fixed-height chart. */
  className?: string;
  /** Minimum body height so state transitions don't reflow the page. */
  minBodyHeight?: number;
  /** Which GlassCard treatment to use. Defaults to dashboard for data-viz. */
  variant?: GlassCardVariant;
  children: ReactNode;
}

export function VizContainer({
  icon: Icon,
  title,
  subtitle,
  rightSlot,
  className,
  minBodyHeight = 240,
  variant = "dashboard",
  children,
}: VizContainerProps) {
  return (
    <GlassCard variant={variant} className={cn("flex flex-col", className)}>
      <div className="p-5">
        <header className="flex items-center justify-between gap-3 mb-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            {Icon ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-50 to-indigo-100 ring-1 ring-white shrink-0">
                <Icon className="h-3.5 w-3.5 text-indigo-600" />
              </span>
            ) : null}
            <div className="min-w-0 leading-tight">
              <h3 className="text-[13px] font-semibold text-gray-900 truncate">
                {title}
              </h3>
              {subtitle ? (
                <p className="text-[11px] text-gray-500 truncate">{subtitle}</p>
              ) : null}
            </div>
          </div>
          {rightSlot ? (
            <div className="flex items-center gap-2 shrink-0">{rightSlot}</div>
          ) : null}
        </header>
        <div className="min-w-0" style={{ minHeight: minBodyHeight }}>
          {children}
        </div>
      </div>
    </GlassCard>
  );
}

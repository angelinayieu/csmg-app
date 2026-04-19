"use client";

// Shared primitives used by widgets. Kept tiny — the goal is a consistent
// visual language across every widget without each one inventing its own
// card chrome, title row, or muted-state treatment.

import { cn } from "@/lib/utils";

// ── Glass surface card ──
//
// The base "chrome" every widget sits on. Soft gradient + hairline border
// + subtle shadow. Matches the Vision-Pro / Figma aesthetic: no harsh
// lines, just tonal depth.

interface SurfaceProps {
  children: React.ReactNode;
  className?: string;
  /** Optional accent color (CSS color). Drives a faint left-edge glow. */
  accent?: string;
  /** Tone — "quiet" for background widgets, "loud" for heroes. */
  tone?: "quiet" | "loud";
  /** Internal padding — "comfortable" | "compact". */
  density?: "comfortable" | "compact";
}

export function Surface({
  children,
  className,
  accent,
  tone = "quiet",
  density = "comfortable",
}: SurfaceProps) {
  const pad = density === "compact" ? "p-3.5" : "p-5";
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border backdrop-blur-xl transition-all duration-300",
        tone === "loud"
          ? "border-white/60 bg-gradient-to-br from-white/90 via-white/70 to-white/50 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.18)]"
          : "border-gray-200/70 bg-gradient-to-br from-white/80 via-white/60 to-gray-50/60 shadow-[0_2px_10px_-6px_rgba(15,23,42,0.10)]",
        pad,
        className
      )}
    >
      {accent && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 h-full w-[2px] rounded-l-2xl"
          style={{
            background: `linear-gradient(to bottom, ${accent}00, ${accent}, ${accent}00)`,
          }}
        />
      )}
      {children}
    </div>
  );
}

// ── Widget header ──

interface WidgetTitleProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
  /** Subtle tone down for background widgets. */
  muted?: boolean;
}

export function WidgetTitle({
  eyebrow,
  title,
  subtitle,
  rightSlot,
  muted,
}: WidgetTitleProps) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
            {eyebrow}
          </div>
        )}
        <div
          className={cn(
            "truncate text-[15px] font-semibold tracking-tight",
            muted ? "text-gray-600" : "text-gray-900"
          )}
        >
          {title}
        </div>
        {subtitle && (
          <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-gray-500">
            {subtitle}
          </div>
        )}
      </div>
      {rightSlot && <div className="flex-shrink-0">{rightSlot}</div>}
    </div>
  );
}

// ── Muted empty / loading states ──

export function WidgetSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-3 w-1/3 rounded-full bg-gray-200/60" />
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-3 rounded-full bg-gray-100",
            i === lines - 1 ? "w-2/3" : "w-full"
          )}
        />
      ))}
    </div>
  );
}

export function WidgetEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200/80 bg-gray-50/40 px-4 py-5 text-[12.5px] text-gray-400">
      {children}
    </div>
  );
}

// ── Action button ──
//
// Consistent visual for widget-emitted actions. Tone matches context:
// "primary" = filled, "secondary" = ghost, "subtle" = inline link.

interface ActionButtonProps {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary" | "subtle";
  disabled?: boolean;
  compact?: boolean;
}

export function ActionButton({
  label,
  onClick,
  variant = "secondary",
  disabled,
  compact,
}: ActionButtonProps) {
  const base =
    "rounded-full font-medium transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed";
  const pad = compact ? "px-3 py-1 text-[11.5px]" : "px-3.5 py-1.5 text-[12.5px]";
  const tone =
    variant === "primary"
      ? "bg-gray-900 text-white shadow-sm hover:bg-gray-800"
      : variant === "secondary"
      ? "bg-white/80 text-gray-700 border border-gray-200/80 hover:bg-white hover:border-gray-300"
      : "text-blue-600 hover:text-blue-700";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(base, pad, tone)}
    >
      {label}
    </button>
  );
}

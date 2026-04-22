import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export type GlassCardVariant = "default" | "dashboard" | "icon" | "hero";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Visual treatment.
   * - default:   light glass-card (existing .glass-card token)
   * - dashboard: stronger body + soft blue shadow (lifted from .gd-card)
   * - icon:      heavier blur for icon tiles (.glass-card-icon)
   * - hero:      strongest blur + saturate for landing/hero surfaces (.glass-hero)
   */
  variant?: GlassCardVariant;
  /** Adds subtle hover lift. Skip for static informational cards. */
  interactive?: boolean;
}

const VARIANT_CLASS: Record<GlassCardVariant, string> = {
  default: "glass-card",
  dashboard: "glass-card-dashboard",
  icon: "glass-card-icon",
  hero: "glass-hero",
};

/**
 * Single glass surface primitive. Wraps the CSS tokens in globals.css so we
 * stop copy-pasting `bg-white/55 backdrop-blur` ad-hoc and so dashboard cards,
 * intake screens, and twin proposals share one design language.
 */
export function GlassCard({
  className,
  variant = "default",
  interactive = false,
  children,
  ...props
}: GlassCardProps) {
  return (
    <div
      className={cn(
        VARIANT_CLASS[variant],
        "rounded-[20px] overflow-hidden",
        interactive && "is-interactive cursor-pointer",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

import { cn } from "@/lib/utils";

type BadgeVariant =
  | "active"
  | "waiting"
  | "theory"
  | "blocked"
  | "stated"
  | "inferred"
  | "predicted"
  | "positive"
  | "negative"
  | "balancing"
  | "strong"
  | "moderate"
  | "speculative"
  | "fundamental"
  | "critical"
  | "important";

interface StatusBadgeProps {
  variant: BadgeVariant;
  dot?: boolean;
  children?: React.ReactNode;
  className?: string;
}

const variantStyles: Record<
  BadgeVariant,
  { text: string; bg: string; border?: string; label?: string }
> = {
  // Maturity states
  active: { text: "text-green-700", bg: "bg-green-50", label: "Active" },
  waiting: { text: "text-amber-700", bg: "bg-amber-50", label: "Waiting" },
  theory: { text: "text-purple-700", bg: "bg-purple-50", label: "Theoretical" },
  blocked: { text: "text-red-700", bg: "bg-red-50", label: "Blocked" },

  // Source tags
  stated: { text: "text-blue-700", bg: "bg-blue-50", label: "Stated" },
  inferred: { text: "text-amber-700", bg: "bg-amber-50", label: "Inferred" },
  predicted: { text: "text-purple-700", bg: "bg-purple-50", label: "Predicted" },

  // Cycle classification
  positive: { text: "text-green-700", bg: "bg-green-50", label: "Reinforcing (+)" },
  negative: { text: "text-red-700", bg: "bg-red-50", label: "Reinforcing (-)" },
  balancing: { text: "text-blue-700", bg: "bg-blue-50", label: "Balancing" },

  // Connection strength
  strong: { text: "text-green-700", bg: "bg-green-50", label: "Strong" },
  moderate: { text: "text-amber-700", bg: "bg-amber-50", label: "Moderate" },
  speculative: { text: "text-purple-700", bg: "bg-purple-50", label: "Speculative" },

  // Importance
  fundamental: { text: "text-red-700", bg: "bg-red-50", label: "Fundamental" },
  critical: { text: "text-amber-700", bg: "bg-amber-50", label: "Critical" },
  important: { text: "text-blue-700", bg: "bg-blue-50", label: "Important" },
};

const dotColors: Record<BadgeVariant, string> = {
  active: "bg-green-500",
  waiting: "bg-amber-500",
  theory: "bg-purple-500",
  blocked: "bg-red-500",
  stated: "bg-blue-500",
  inferred: "bg-amber-500",
  predicted: "bg-purple-500",
  positive: "bg-green-500",
  negative: "bg-red-500",
  balancing: "bg-blue-500",
  strong: "bg-green-500",
  moderate: "bg-amber-500",
  speculative: "bg-purple-500",
  fundamental: "bg-red-500",
  critical: "bg-amber-500",
  important: "bg-blue-500",
};

export function StatusBadge({
  variant,
  dot = false,
  children,
  className,
}: StatusBadgeProps) {
  const styles = variantStyles[variant];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-[7px] py-[2px] text-[10px] font-medium",
        styles.text,
        styles.bg,
        className
      )}
    >
      {dot && (
        <span
          className={cn("h-[5px] w-[5px] rounded-full", dotColors[variant])}
        />
      )}
      {children ?? styles.label}
    </span>
  );
}

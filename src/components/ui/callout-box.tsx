import { cn } from "@/lib/utils";

type CalloutType =
  | "insight"
  | "action"
  | "mechanism"
  | "mitigation"
  | "chain"
  | "intervention"
  | "warning";

interface CalloutBoxProps {
  type: CalloutType;
  label?: string;
  children: React.ReactNode;
  className?: string;
  /** Compact mode — smaller padding and text for use in dense panels */
  compact?: boolean;
}

const typeStyles: Record<
  CalloutType,
  { border: string; bg: string; labelColor: string; defaultLabel: string }
> = {
  insight: {
    border: "border-l-blue-500",
    bg: "bg-blue-50/60",
    labelColor: "text-blue-600",
    defaultLabel: "Insight",
  },
  action: {
    border: "border-l-green-600",
    bg: "bg-green-50/60",
    labelColor: "text-green-700",
    defaultLabel: "Action",
  },
  mechanism: {
    border: "border-l-red-500",
    bg: "bg-red-50/60",
    labelColor: "text-red-600",
    defaultLabel: "Mechanism",
  },
  mitigation: {
    border: "border-l-green-600",
    bg: "bg-green-50/60",
    labelColor: "text-green-700",
    defaultLabel: "Mitigation",
  },
  chain: {
    border: "border-l-gray-400",
    bg: "bg-gray-50/60",
    labelColor: "text-gray-500",
    defaultLabel: "Chain",
  },
  intervention: {
    border: "border-l-green-600",
    bg: "bg-green-50/60",
    labelColor: "text-green-700",
    defaultLabel: "Intervention",
  },
  warning: {
    border: "border-l-amber-500",
    bg: "bg-amber-50/60",
    labelColor: "text-amber-600",
    defaultLabel: "Warning",
  },
};

export function CalloutBox({
  type,
  label,
  children,
  className,
  compact,
}: CalloutBoxProps) {
  const styles = typeStyles[type] ?? typeStyles.insight;

  return (
    <div
      className={cn(
        "rounded-[9px] border-l-[2.5px]",
        compact ? "px-3 py-1.5" : "px-[14px] py-[11px]",
        styles.border,
        styles.bg,
        className
      )}
    >
      <p
        className={cn(
          "mb-1 font-semibold tracking-[-0.01em]",
          compact ? "text-[9px]" : "text-[12px]",
          styles.labelColor
        )}
      >
        {label ?? styles.defaultLabel}
      </p>
      <div className={cn(
        "leading-[1.55] text-gray-700",
        compact ? "text-[11px]" : "text-[15px]",
      )}>
        {children}
      </div>
    </div>
  );
}

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
}

const typeStyles: Record<
  CalloutType,
  { border: string; bg: string; labelColor: string; defaultLabel: string }
> = {
  insight: {
    border: "border-l-blue-500",
    bg: "bg-blue-50/60",
    labelColor: "text-blue-600",
    defaultLabel: "INSIGHT",
  },
  action: {
    border: "border-l-green-600",
    bg: "bg-green-50/60",
    labelColor: "text-green-700",
    defaultLabel: "RECOMMENDED ACTION",
  },
  mechanism: {
    border: "border-l-red-500",
    bg: "bg-red-50/60",
    labelColor: "text-red-600",
    defaultLabel: "MECHANISM",
  },
  mitigation: {
    border: "border-l-green-600",
    bg: "bg-green-50/60",
    labelColor: "text-green-700",
    defaultLabel: "MITIGATION",
  },
  chain: {
    border: "border-l-gray-400",
    bg: "bg-gray-50/60",
    labelColor: "text-gray-500",
    defaultLabel: "CHAIN",
  },
  intervention: {
    border: "border-l-green-600",
    bg: "bg-green-50/60",
    labelColor: "text-green-700",
    defaultLabel: "INTERVENTION POINT",
  },
  warning: {
    border: "border-l-amber-500",
    bg: "bg-amber-50/60",
    labelColor: "text-amber-600",
    defaultLabel: "WARNING",
  },
};

export function CalloutBox({
  type,
  label,
  children,
  className,
}: CalloutBoxProps) {
  const styles = typeStyles[type] ?? typeStyles.insight;

  return (
    <div
      className={cn(
        "rounded-[9px] border-l-[2.5px] px-[14px] py-[11px]",
        styles.border,
        styles.bg,
        className
      )}
    >
      <p
        className={cn(
          "mb-1 text-[10px] font-semibold uppercase tracking-[0.05em]",
          styles.labelColor
        )}
      >
        {label ?? styles.defaultLabel}
      </p>
      <div className="text-[13px] leading-[1.55] text-gray-700">
        {children}
      </div>
    </div>
  );
}

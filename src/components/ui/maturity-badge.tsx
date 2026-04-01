import { cn } from "@/lib/utils";

const maturityConfig: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  actionable_now: { label: "Active", bg: "bg-green-50", text: "text-green-700" },
  waiting_on_dependency: { label: "Waiting", bg: "bg-amber-50", text: "text-amber-700" },
  theoretical: { label: "Theory", bg: "bg-purple-50", text: "text-purple-700" },
  blocked: { label: "Blocked", bg: "bg-red-50", text: "text-red-700" },
};

export function MaturityBadge({
  maturity,
  className,
}: {
  maturity: string;
  className?: string;
}) {
  const config = maturityConfig[maturity] ?? maturityConfig.theoretical;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
        config.bg,
        config.text,
        className
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          backgroundColor:
            maturity === "actionable_now"
              ? "#34C759"
              : maturity === "waiting_on_dependency"
                ? "#FF9500"
                : maturity === "theoretical"
                  ? "#AF52DE"
                  : "#FF3B30",
        }}
      />
      {config.label}
    </span>
  );
}

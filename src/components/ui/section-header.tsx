import { cn } from "@/lib/utils";

type SectionColor =
  | "blue"
  | "red"
  | "green"
  | "amber"
  | "purple"
  | "gray";

interface SectionHeaderProps {
  label: string;
  color: SectionColor;
  subtitle?: string;
  className?: string;
}

const dotColors: Record<SectionColor, string> = {
  blue: "bg-blue-500",
  red: "bg-red-500",
  green: "bg-green-500",
  amber: "bg-amber-500",
  purple: "bg-purple-500",
  gray: "bg-gray-400",
};

export function SectionHeader({
  label,
  color,
  subtitle,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        className={cn("h-1.5 w-1.5 rounded-full", dotColors[color])}
      />
      <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-gray-500">
        {label}
      </span>
      {subtitle && (
        <span className="ml-auto text-[11px] text-gray-400">
          {subtitle}
        </span>
      )}
    </div>
  );
}

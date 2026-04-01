import { cn } from "@/lib/utils";

interface IntensityDotProps {
  level: "high" | "mid" | "low";
  className?: string;
}

const colors = {
  high: "bg-red-500",
  mid: "bg-amber-500",
  low: "bg-green-500",
};

export function IntensityDot({ level, className }: IntensityDotProps) {
  return (
    <div
      className={cn(
        "mt-[5px] h-[6px] w-[6px] flex-shrink-0 rounded-full",
        colors[level],
        className
      )}
    />
  );
}

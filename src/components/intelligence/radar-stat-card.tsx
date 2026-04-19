"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export interface RadarStatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  iconBg?: string;
  iconColor?: string;
  trend?: {
    direction: "up" | "down" | "flat";
    value: string;
  };
  target?: string;
  className?: string;
}

export function RadarStatCard({
  label,
  value,
  icon,
  iconBg = "bg-blue-50",
  iconColor = "text-blue-600",
  trend,
  target,
  className,
}: RadarStatCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm",
        className
      )}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <div
          className={cn(
            "flex h-[22px] w-[22px] items-center justify-center rounded-[7px]",
            iconBg,
            iconColor
          )}
        >
          {icon}
        </div>
        <span className="text-xs font-medium text-gray-500">{label}</span>
      </div>
      <div className="text-[30px] font-semibold leading-none tracking-tight text-gray-900">
        {value}
      </div>
      <div className="mt-3.5 flex items-center justify-between">
        {target && (
          <span className="text-[11px] text-gray-400">{target}</span>
        )}
        {!target && <span />}
        {trend && <TrendBadge direction={trend.direction} value={trend.value} />}
      </div>
    </div>
  );
}

function TrendBadge({
  direction,
  value,
}: {
  direction: "up" | "down" | "flat";
  value: string;
}) {
  const Icon =
    direction === "up"
      ? TrendingUp
      : direction === "down"
        ? TrendingDown
        : Minus;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-[7px] py-[3px] text-[11px] font-semibold",
        direction === "up" && "bg-green-50 text-green-700",
        direction === "down" && "bg-red-50 text-red-700",
        direction === "flat" && "bg-gray-100 text-gray-500"
      )}
    >
      <Icon className="h-3 w-3" />
      {value}
    </span>
  );
}

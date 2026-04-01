"use client";

import { useEffect, useState } from "react";
import { getRingColor } from "@/lib/design-tokens";

interface RingProps {
  value: number; // 0-1
  size?: number; // default 44
  delay?: number; // ms, for staggered entrance
  showValue?: boolean; // show percentage text in center
}

export function Ring({
  value,
  size = 44,
  delay = 0,
  showValue = true,
}: RingProps) {
  const [animated, setAnimated] = useState(false);
  const strokeWidth = size > 40 ? 4 : 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - (animated ? value : 0));
  const color = getRingColor(value);
  const percent = Math.round(value * 100);

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), delay + 50);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(0,0,0,0.06)"
          strokeWidth={strokeWidth}
        />
        {/* Filled arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: `stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
          }}
        />
      </svg>
      {showValue && (
        <span
          className="absolute text-center font-semibold"
          style={{
            fontSize: size > 40 ? 11 : 9,
            color,
          }}
        >
          {percent}
        </span>
      )}
    </div>
  );
}

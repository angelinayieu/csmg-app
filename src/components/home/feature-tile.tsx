"use client";

import { useRef } from "react";
import type { LucideIcon } from "lucide-react";

// Feature tile with 3D mouse-tilt for visionOS depth feel
export function FeatureTile({
  Icon,
  title,
  description,
  delay,
  gridColumn,
  gridRow,
}: {
  Icon: LucideIcon;
  title: string;
  description: string;
  delay: string;
  gridColumn: number;
  gridRow: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rotY = (px - 0.5) * 8;
    const rotX = (0.5 - py) * 6;
    el.style.transform = `perspective(700px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-4px) scale(1.02)`;
  };

  const handleLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "";
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={`anim-fade-up ${delay} glass-tile`}
      style={{ gridColumn, gridRow }}
    >
      <div className="feature-icon-box">
        <Icon className="h-[18px] w-[18px] text-interaxis-600" strokeWidth={1.6} />
      </div>
      <div
        className="text-[12px] leading-snug text-gray-600 font-medium"
        style={{ letterSpacing: "-0.005em" }}
      >
        <strong className="text-gray-800 font-semibold">{title}</strong>
        <br />
        {description}
      </div>
    </div>
  );
}

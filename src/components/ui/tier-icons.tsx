import { cn } from "@/lib/utils";

interface TierIconProps {
  className?: string;
  size?: number;
  active?: boolean;
}

/**
 * Quick: Single node with a scan pulse — one pass, fast read
 * A circle with a horizontal scan line sweeping through
 */
export function QuickIcon({ className, size = 28, active }: TierIconProps) {
  const color = active ? "#00ACC1" : "#9CA3AF";
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" className={className}>
      {/* Central node */}
      <circle cx="14" cy="14" r="5" fill={`${color}20`} stroke={color} strokeWidth="1.5" />
      {/* Scan pulse line */}
      <line x1="4" y1="14" x2="24" y2="14" stroke={color} strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
      {/* Pulse dot moving along scan */}
      <circle cx="20" cy="14" r="1.5" fill={color} opacity="0.8">
        {active && <animate attributeName="cx" values="8;20;8" dur="2s" repeatCount="indefinite" />}
      </circle>
      {/* Small satellite nodes */}
      <circle cx="6" cy="8" r="2" fill={`${color}15`} stroke={color} strokeWidth="0.8" opacity="0.4" />
      <circle cx="22" cy="20" r="2" fill={`${color}15`} stroke={color} strokeWidth="0.8" opacity="0.4" />
    </svg>
  );
}

/**
 * Standard: Two overlapping graph clusters with validation checkmarks
 * Shows structural validation catching gaps
 */
export function StandardIcon({ className, size = 28, active }: TierIconProps) {
  const color = active ? "#00ACC1" : "#9CA3AF";
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" className={className}>
      {/* Primary cluster */}
      <circle cx="10" cy="10" r="3.5" fill={`${color}15`} stroke={color} strokeWidth="1.2" />
      <circle cx="17" cy="8" r="2.5" fill={`${color}15`} stroke={color} strokeWidth="1.2" />
      <circle cx="8" cy="17" r="2.5" fill={`${color}15`} stroke={color} strokeWidth="1.2" />
      {/* Edges */}
      <line x1="10" y1="10" x2="17" y2="8" stroke={color} strokeWidth="0.8" opacity="0.6" />
      <line x1="10" y1="10" x2="8" y2="17" stroke={color} strokeWidth="0.8" opacity="0.6" />
      {/* Validation: discovered edge (dashed, being added) */}
      <line x1="17" y1="8" x2="8" y2="17" stroke={color} strokeWidth="1" strokeDasharray="2 1.5" opacity="0.8" />
      {/* Checkmark badge */}
      <circle cx="21" cy="20" r="4.5" fill={active ? "#D1FAE5" : "#F3F4F6"} stroke={active ? "#059669" : "#9CA3AF"} strokeWidth="1" />
      <path d="M19 20l1.5 1.5L23 19" stroke={active ? "#059669" : "#9CA3AF"} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/**
 * Deep: Three intersecting planes/clusters with bridge connections
 * Shows multi-space with cross-domain connections
 */
export function DeepIcon({ className, size = 28, active }: TierIconProps) {
  const color = active ? "#00ACC1" : "#9CA3AF";
  const bridge = active ? "#EF9F27" : "#D1D5DB";
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" className={className}>
      {/* Cluster A (top-left) */}
      <circle cx="7" cy="7" r="2.5" fill={`${color}20`} stroke={color} strokeWidth="1" />
      <circle cx="12" cy="5" r="2" fill={`${color}15`} stroke={color} strokeWidth="0.8" />
      <line x1="7" y1="7" x2="12" y2="5" stroke={color} strokeWidth="0.7" opacity="0.5" />

      {/* Cluster B (right) */}
      <circle cx="22" cy="10" r="2.5" fill={`${color}20`} stroke={color} strokeWidth="1" />
      <circle cx="20" cy="15" r="2" fill={`${color}15`} stroke={color} strokeWidth="0.8" />
      <line x1="22" y1="10" x2="20" y2="15" stroke={color} strokeWidth="0.7" opacity="0.5" />

      {/* Cluster C (bottom) */}
      <circle cx="10" cy="21" r="2.5" fill={`${color}20`} stroke={color} strokeWidth="1" />
      <circle cx="16" cy="23" r="2" fill={`${color}15`} stroke={color} strokeWidth="0.8" />
      <line x1="10" y1="21" x2="16" y2="23" stroke={color} strokeWidth="0.7" opacity="0.5" />

      {/* Bridge connections (gold dashed — cross-space discovery) */}
      <line x1="12" y1="5" x2="22" y2="10" stroke={bridge} strokeWidth="1" strokeDasharray="2 2" opacity="0.7" />
      <line x1="20" y1="15" x2="10" y2="21" stroke={bridge} strokeWidth="1" strokeDasharray="2 2" opacity="0.7" />
      <line x1="7" y1="7" x2="10" y2="21" stroke={bridge} strokeWidth="1" strokeDasharray="2 2" opacity="0.7" />

      {/* Central synthesis point */}
      <circle cx="14" cy="13" r="2" fill={active ? "#EF9F2740" : "#E5E7EB"} stroke={bridge} strokeWidth="1" />
    </svg>
  );
}

/**
 * Comprehensive: Full dense network with reasoning pulses
 * Shows exhaustive analysis with every connection found
 */
export function ComprehensiveIcon({ className, size = 28, active }: TierIconProps) {
  const color = active ? "#00ACC1" : "#9CA3AF";
  const pulse = active ? "#7C3AED" : "#D1D5DB";
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" className={className}>
      {/* Dense network — 6 nodes */}
      <circle cx="14" cy="5" r="2.5" fill={`${color}20`} stroke={color} strokeWidth="1" />
      <circle cx="23" cy="10" r="2.5" fill={`${color}20`} stroke={color} strokeWidth="1" />
      <circle cx="21" cy="21" r="2.5" fill={`${color}20`} stroke={color} strokeWidth="1" />
      <circle cx="7" cy="21" r="2.5" fill={`${color}20`} stroke={color} strokeWidth="1" />
      <circle cx="5" cy="10" r="2.5" fill={`${color}20`} stroke={color} strokeWidth="1" />
      <circle cx="14" cy="14" r="3" fill={`${color}25`} stroke={color} strokeWidth="1.2" />

      {/* Fully connected edges */}
      <line x1="14" y1="5" x2="23" y2="10" stroke={color} strokeWidth="0.5" opacity="0.3" />
      <line x1="23" y1="10" x2="21" y2="21" stroke={color} strokeWidth="0.5" opacity="0.3" />
      <line x1="21" y1="21" x2="7" y2="21" stroke={color} strokeWidth="0.5" opacity="0.3" />
      <line x1="7" y1="21" x2="5" y2="10" stroke={color} strokeWidth="0.5" opacity="0.3" />
      <line x1="5" y1="10" x2="14" y2="5" stroke={color} strokeWidth="0.5" opacity="0.3" />

      {/* Hub connections to center */}
      <line x1="14" y1="14" x2="14" y2="5" stroke={color} strokeWidth="0.7" opacity="0.5" />
      <line x1="14" y1="14" x2="23" y2="10" stroke={color} strokeWidth="0.7" opacity="0.5" />
      <line x1="14" y1="14" x2="21" y2="21" stroke={color} strokeWidth="0.7" opacity="0.5" />
      <line x1="14" y1="14" x2="7" y2="21" stroke={color} strokeWidth="0.7" opacity="0.5" />
      <line x1="14" y1="14" x2="5" y2="10" stroke={color} strokeWidth="0.7" opacity="0.5" />

      {/* Reasoning pulse rings (purple, radiating from center) */}
      <circle cx="14" cy="14" r="6" fill="none" stroke={pulse} strokeWidth="0.5" opacity="0.3">
        {active && <animate attributeName="r" values="4;8;4" dur="3s" repeatCount="indefinite" />}
        {active && <animate attributeName="opacity" values="0.5;0.1;0.5" dur="3s" repeatCount="indefinite" />}
      </circle>
      <circle cx="14" cy="14" r="10" fill="none" stroke={pulse} strokeWidth="0.5" opacity="0.15">
        {active && <animate attributeName="r" values="8;12;8" dur="3s" repeatCount="indefinite" />}
        {active && <animate attributeName="opacity" values="0.3;0.05;0.3" dur="3s" repeatCount="indefinite" />}
      </circle>
    </svg>
  );
}

/** Map tier ID to icon component */
export const TierIcons: Record<string, React.FC<TierIconProps>> = {
  quick: QuickIcon,
  standard: StandardIcon,
  deep: DeepIcon,
  comprehensive: ComprehensiveIcon,
};

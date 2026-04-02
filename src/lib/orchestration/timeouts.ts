/**
 * Per-Space Timeout Utilities
 * 
 * Prevents one slow/stuck space from cascading to entire tier failure.
 * 
 * Strategy:
 * - Each space gets its own timeout (default: 30s)
 * - If space exceeds timeout, it's marked as failed but others continue
 * - Failed spaces are excluded from database insertion and weaving
 * - System continues with valid spaces only
 * 
 * Impact:
 * 🔴 CRITICAL: Prevents cascading failures
 * Allows partial results when one space hangs
 * Better UX: "Got 2/3 spaces, 1 timed out" vs "Complete failure"
 */

export interface TimeoutConfig {
  spaceTimeout: number; // ms per space (default: 30000 = 30s)
  decompositionTimeout?: number; // ms for decompose phase (default: 20s)
  structuringTimeout?: number; // ms for structure phase (default: 15s)
  criticTimeout?: number; // ms for critique phase (default: 20s)
  augmentTimeout?: number; // ms for augment phase (default: 15s)
}

export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  spaceTimeout: 30000, // 30s per space (Vercel limit is 120s, safe margin)
  decompositionTimeout: 20000, // Decompose is usually the slowest
  structuringTimeout: 15000,
  criticTimeout: 20000,
  augmentTimeout: 15000,
};

/**
 * Wraps a promise with a timeout
 * Returns: { success: true, data } | { success: false, error: string }
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string = "operation"
): Promise<{ success: true; data: T } | { success: false; error: string; timedOut: boolean }> {
  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    const result = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${operationName} timeout (${timeoutMs}ms exceeded)`));
        }, timeoutMs);
      }),
    ]);

    if (timeoutHandle) clearTimeout(timeoutHandle);
    return { success: true, data: result };
  } catch (err) {
    if (timeoutHandle) clearTimeout(timeoutHandle);

    const errorMsg = err instanceof Error ? err.message : String(err);
    const timedOut = errorMsg.includes("timeout");

    return {
      success: false,
      error: errorMsg,
      timedOut,
    };
  }
}

/**
 * Helper: Create a timeout-wrapped space processing function
 * 
 * Usage:
 * ```typescript
 * const processWithTimeout = createSpaceTimeout("decomposition", 20000);
 * const result = await processWithTimeout(() => runDecomposer(input, space, context));
 * if (result.success) {
 *   // Use result.data
 * } else {
 *   console.warn(`Space failed: ${result.error}`);
 * }
 * ```
 */
export function createSpaceTimeout(operationName: string, timeoutMs: number) {
  return async <T>(fn: () => Promise<T>) => {
    return withTimeout(fn(), timeoutMs, operationName);
  };
}

/**
 * Logs timeout info for monitoring
 */
export function logTimeoutEvent(
  spaceIndex: number,
  spaceName: string,
  operation: string,
  result: { success: boolean; error?: string; timedOut?: boolean }
) {
  if (!result.success) {
    const severity = result.timedOut ? "TIMEOUT" : "ERROR";
    console.warn(
      `[Space ${spaceIndex} "${spaceName}"] ${operation} ${severity}: ${result.error}`
    );
  }
}

/**
 * Calculates per-tier timeout budget
 * 
 * Vercel limit: 120s
 * Safe margin: 10s (for final operations)
 * Available: ~110s
 * 
 * Usage budget by tier:
 * - Quick: 5-10s total
 * - Standard: 30-40s total (decompose + structure + critique + augment)
 * - Deep: 60-70s total (scope + 3 spaces × parallel + weave + synth)
 * - Comprehensive: 80-100s total (Deep + reasoning)
 */
export function getTierTimeoutBudget(tier: string): {
  totalBudget: number; // ms for entire tier
  perSpaceBudget: number; // ms per space
  phaseBreakdown: Record<string, number>;
} {
  switch (tier) {
    case "quick":
      return {
        totalBudget: 10000,
        perSpaceBudget: 10000,
        phaseBreakdown: {
          decomposition: 5000,
          structuring: 5000,
        },
      };

    case "standard":
      return {
        totalBudget: 45000,
        perSpaceBudget: 45000,
        phaseBreakdown: {
          decomposition: 15000,
          structuring: 10000,
          critique: 10000,
          augment: 10000,
        },
      };

    case "deep":
      return {
        totalBudget: 75000,
        perSpaceBudget: 25000, // 3 spaces in parallel
        phaseBreakdown: {
          scope: 3000,
          decomposition: 20000, // Parallel across 3 spaces
          structuring: 15000,
          weaving: 10000,
          synthesizing: 15000,
          external: 10000,
          bridge: 2000,
        },
      };

    case "comprehensive":
      return {
        totalBudget: 100000,
        perSpaceBudget: 25000,
        phaseBreakdown: {
          scope: 3000,
          decomposition: 20000,
          structuring: 15000,
          critique: 15000, // Added: Deep doesn't do this
          augment: 10000, // Added: Deep doesn't do this
          weaving: 10000,
          synthesizing: 15000,
          external: 10000,
          bridge: 2000,
        },
      };

    default:
      return {
        totalBudget: 10000,
        perSpaceBudget: 10000,
        phaseBreakdown: {},
      };
  }
}

/**
 * Monitors elapsed time for a tier
 */
export class TierTimer {
  private startTime: number;
  private tier: string;
  private budget: number;

  constructor(tier: string) {
    this.tier = tier;
    this.budget = getTierTimeoutBudget(tier).totalBudget;
    this.startTime = Date.now();
  }

  /**
   * Get elapsed ms since timer start
   */
  elapsed(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get remaining ms before timeout
   */
  remaining(): number {
    return Math.max(0, this.budget - this.elapsed());
  }

  /**
   * Check if we're running low on time
   */
  isLowOnTime(threshold: number = 0.2): boolean {
    return this.remaining() < threshold * this.budget;
  }

  /**
   * Log timer status
   */
  logStatus(_operation: string): void {
    // No-op in production (debug logging removed)
  }
}

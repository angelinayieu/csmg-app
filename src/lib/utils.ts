import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Batch insert items into a Supabase table
 * - Breaks array into chunks to avoid N queries (performance: 1000 edges in 1 batch = 2s vs 50s sequential)
 * - Handles partial failures gracefully (continues with remaining batches)
 * - Logs timing and success/failure counts
 * - Returns warning if failure rate exceeds threshold
 */
export async function batchInsert(
  db: any,
  table: string,
  items: any[],
  options?: {
    batchSize?: number;
    failureThreshold?: number; // % of failures to trigger warning (default 10%)
    emitWarning?: (msg: string) => void; // Callback for high failure rate
  }
): Promise<{
  inserted: number;
  failed: number;
  failureRate: number; // 0-1
  failedItems?: any[];
  timeMs: number;
  warning?: string;
}> {
  const batchSize = options?.batchSize ?? 100;
  const failureThreshold = options?.failureThreshold ?? 0.1;
  const emitWarning = options?.emitWarning;

  if (items.length === 0) {
    return { inserted: 0, failed: 0, failureRate: 0, timeMs: 0 };
  }

  const startTime = Date.now();
  let totalInserted = 0;
  let totalFailed = 0;
  const failedItems: any[] = [];

  // Process items in batches
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    try {
      const { error } = await db.from(table).insert(batch);

      if (error) {
        console.error(
          `[BatchInsert] ${table} batch ${Math.floor(i / batchSize) + 1} failed:`,
          error.message
        );
        totalFailed += batch.length;
        failedItems.push(...batch);
      } else {
        totalInserted += batch.length;
      }
    } catch (err) {
      console.error(
        `[BatchInsert] ${table} batch exception:`,
        err instanceof Error ? err.message : String(err)
      );
      totalFailed += batch.length;
      failedItems.push(...batch);
    }
  }

  const timeMs = Date.now() - startTime;
  const failureRate = items.length > 0 ? totalFailed / items.length : 0;

  let warning: string | undefined;
  if (failureRate > failureThreshold) {
    warning = `${table}: High failure rate (${(failureRate * 100).toFixed(1)}% failed)`;
    console.warn(`[BatchInsert] ${warning}`);
    if (emitWarning) emitWarning(warning);
  }


  return {
    inserted: totalInserted,
    failed: totalFailed,
    failureRate,
    failedItems: failedItems.length > 0 ? failedItems : undefined,
    timeMs,
    warning,
  };
}

// ── Per-space runtime settings — read/write helpers + due-check logic ──
//
// Centralizes the rules that the agent-runtime cron and the predictions-
// resolve cron use to decide "should I act on this space right now?"
// Pure functions over the persisted shape — no DB access here, callers
// pass in the raw row (or null) and we coerce it through defaults.
//
// The design is deliberately conservative: when in doubt, run. Missing
// settings, malformed JSON, and unknown shapes all collapse to "use
// defaults," which means the cron keeps doing what it does today. The
// user has to explicitly disable or throttle to deviate.
//
// Last-run timestamps are stored in TOP-LEVEL columns
// (`spaces.last_agent_runtime_at`, `spaces.last_predictions_resolve_at`)
// rather than inside this JSONB so concurrent crons can stamp them
// atomically. The helper APIs take them as separate inputs to keep that
// boundary clear.

export type CronKind = "agent_runtime" | "predictions_resolve";

export interface RuntimeCronSetting {
  /** Master toggle. False → cron skips this space entirely. */
  enabled: boolean;
  /** Minimum hours between runs for THIS space. The global cron still
   *  ticks at its own schedule (e.g., agent-runtime fires every 2h
   *  globally), but this gate blocks per-space runs that are too soon
   *  after the previous one. */
  cadence_hours: number;
  /** Temporary pause. ISO timestamp; if in the past, treated as null
   *  (auto-expires). For "pause for the rest of the week" UX. Only
   *  agent_runtime supports this in v1; predictions_resolve has just
   *  enabled + cadence. */
  paused_until?: string | null;
}

export interface RuntimeSettings {
  agent_runtime: RuntimeCronSetting;
  predictions_resolve: RuntimeCronSetting;
}

/**
 * Last-run timestamps for the two gated crons. Stored as top-level
 * columns on `spaces`, NOT inside RuntimeSettings JSONB — see migration
 * 20260703_runtime_last_run_columns.sql for the rationale (concurrent
 * cron stamps would otherwise race on JSONB merge).
 */
export interface RuntimeLastRuns {
  agent_runtime: string | null;
  predictions_resolve: string | null;
}

// Defaults match the current global cron cadence so the migration is
// behavior-preserving — a space with NULL settings runs exactly as it
// does today.
const DEFAULTS: RuntimeSettings = {
  agent_runtime: {
    enabled: true,
    cadence_hours: 2,
    paused_until: null,
  },
  predictions_resolve: {
    enabled: true,
    cadence_hours: 1,
  },
};

// Bounds — enforced when the API PATCH writes user-supplied values, NOT
// applied retroactively to existing rows. Keeps users from setting
// "every 0.5 hours" (cron can't run faster than its global tick) or
// "every 720 hours" (effectively disabled but pretending to be running).
export const CADENCE_HOURS_MIN: Record<CronKind, number> = {
  agent_runtime: 2,
  predictions_resolve: 1,
};
export const CADENCE_HOURS_MAX: Record<CronKind, number> = {
  agent_runtime: 168, // 1 week
  predictions_resolve: 168,
};

/**
 * Coerce a raw `space.runtime_settings` JSONB into a fully-populated
 * RuntimeSettings, filling missing keys with defaults. Always returns
 * a usable object — null/undefined input → all defaults; partial input
 * → fill-in defaults for missing fields.
 *
 * Tolerant of malformed JSON: any unparseable structure returns DEFAULTS
 * so the cron can never crash on a bad row.
 *
 * Note: this function does NOT read `last_runs` even if the legacy
 * Phase-A row shape included it — that field has moved to top-level
 * columns. Callers must pass last-run timestamps separately.
 */
export function readRuntimeSettings(raw: unknown): RuntimeSettings {
  if (!raw || typeof raw !== "object") return cloneDefaults();
  const r = raw as Record<string, unknown>;
  const ar = (r.agent_runtime ?? {}) as Record<string, unknown>;
  const pr = (r.predictions_resolve ?? {}) as Record<string, unknown>;
  return {
    agent_runtime: {
      enabled: typeof ar.enabled === "boolean" ? ar.enabled : DEFAULTS.agent_runtime.enabled,
      cadence_hours:
        typeof ar.cadence_hours === "number" && ar.cadence_hours > 0
          ? ar.cadence_hours
          : DEFAULTS.agent_runtime.cadence_hours,
      paused_until: typeof ar.paused_until === "string" ? ar.paused_until : null,
    },
    predictions_resolve: {
      enabled: typeof pr.enabled === "boolean" ? pr.enabled : DEFAULTS.predictions_resolve.enabled,
      cadence_hours:
        typeof pr.cadence_hours === "number" && pr.cadence_hours > 0
          ? pr.cadence_hours
          : DEFAULTS.predictions_resolve.cadence_hours,
    },
  };
}

function cloneDefaults(): RuntimeSettings {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

export function defaultRuntimeSettings(): RuntimeSettings {
  return cloneDefaults();
}

/**
 * Should the cron act on this space at this moment?
 *
 *   false IF the master toggle is off
 *   false IF a paused_until ISO is set and still in the future
 *   false IF the last run was less than cadence_hours ago
 *   true otherwise
 *
 * Reason returned is human-readable; cron logs it on skip.
 */
export interface DueCheck {
  due: boolean;
  reason: string;
  /** Seconds until the next run becomes due. -1 if disabled or paused indefinitely. */
  seconds_until_due: number;
}

export function isCronDue(
  settings: RuntimeSettings,
  cron: CronKind,
  lastRuns: RuntimeLastRuns,
  now: Date = new Date(),
): DueCheck {
  const cfg = cron === "agent_runtime" ? settings.agent_runtime : settings.predictions_resolve;

  if (!cfg.enabled) {
    return { due: false, reason: "disabled by user", seconds_until_due: -1 };
  }

  if (cfg.paused_until) {
    const pausedUntilMs = Date.parse(cfg.paused_until);
    if (!Number.isNaN(pausedUntilMs) && pausedUntilMs > now.getTime()) {
      return {
        due: false,
        reason: `paused until ${cfg.paused_until}`,
        seconds_until_due: Math.ceil((pausedUntilMs - now.getTime()) / 1000),
      };
    }
  }

  const lastRun = lastRuns[cron];
  if (!lastRun) {
    return { due: true, reason: "first run for this space", seconds_until_due: 0 };
  }

  const lastRunMs = Date.parse(lastRun);
  if (Number.isNaN(lastRunMs)) {
    return { due: true, reason: "malformed last_run timestamp; treating as first run", seconds_until_due: 0 };
  }

  const cadenceMs = cfg.cadence_hours * 60 * 60 * 1000;
  const elapsedMs = now.getTime() - lastRunMs;
  if (elapsedMs >= cadenceMs) {
    return { due: true, reason: `cadence elapsed (${cfg.cadence_hours}h)`, seconds_until_due: 0 };
  }

  return {
    due: false,
    reason: `cadence not elapsed (${Math.round((cadenceMs - elapsedMs) / 60000)}m to go)`,
    seconds_until_due: Math.ceil((cadenceMs - elapsedMs) / 1000),
  };
}

/** Column name on `spaces` for the last-run timestamp of a given cron. */
export function lastRunColumn(cron: CronKind): "last_agent_runtime_at" | "last_predictions_resolve_at" {
  return cron === "agent_runtime" ? "last_agent_runtime_at" : "last_predictions_resolve_at";
}

/**
 * Validate + clamp a partial user-supplied update before writing. Drops
 * keys not in our schema, clamps numeric ranges, normalizes paused_until
 * (rejects past timestamps + non-ISO strings).
 */
export interface RuntimeSettingsPatch {
  agent_runtime?: Partial<RuntimeCronSetting>;
  predictions_resolve?: Partial<RuntimeCronSetting>;
}

export function applyUserPatch(
  current: RuntimeSettings,
  patch: RuntimeSettingsPatch,
): RuntimeSettings {
  const next: RuntimeSettings = {
    agent_runtime: { ...current.agent_runtime },
    predictions_resolve: { ...current.predictions_resolve },
  };

  if (patch.agent_runtime) {
    const p = patch.agent_runtime;
    if (typeof p.enabled === "boolean") next.agent_runtime.enabled = p.enabled;
    if (typeof p.cadence_hours === "number") {
      next.agent_runtime.cadence_hours = clamp(
        p.cadence_hours,
        CADENCE_HOURS_MIN.agent_runtime,
        CADENCE_HOURS_MAX.agent_runtime,
      );
    }
    if (p.paused_until === null) {
      next.agent_runtime.paused_until = null;
    } else if (typeof p.paused_until === "string") {
      const ms = Date.parse(p.paused_until);
      if (!Number.isNaN(ms) && ms > Date.now()) {
        next.agent_runtime.paused_until = new Date(ms).toISOString();
      } else {
        next.agent_runtime.paused_until = null;
      }
    }
  }

  if (patch.predictions_resolve) {
    const p = patch.predictions_resolve;
    if (typeof p.enabled === "boolean") next.predictions_resolve.enabled = p.enabled;
    if (typeof p.cadence_hours === "number") {
      next.predictions_resolve.cadence_hours = clamp(
        p.cadence_hours,
        CADENCE_HOURS_MIN.predictions_resolve,
        CADENCE_HOURS_MAX.predictions_resolve,
      );
    }
  }

  return next;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

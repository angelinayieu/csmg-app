"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clampParameters,
  getEntityParameters,
  type InstrumentParameters,
  type SubjectLabContext,
} from "@/lib/lab-formulas";

export interface UseEntityParametersOptions {
  entityId: string;
  /** When the entity is synthesized (Universe / Space lab focal), skip
   * the network round-trip — there's no row to load/save against. */
  remote: boolean;
  /** Used to seed defaults before the network reply lands. */
  initialParameters?: Record<string, unknown> | null;
  initialCategory?: string | null;
  debounceMs?: number;
  /** Subject context — when provided, the returned `parameters` are
   *  the EFFECTIVE values (entity defaults → subject override →
   *  conditions modulator) rather than the raw entity values. The
   *  setter still writes to the entity row's `parameters` JSONB
   *  (global default); per-subject overrides flow through subject
   *  PATCH separately. */
  subjectContext?: SubjectLabContext | null;
}

export interface UseEntityParametersResult {
  /** Effective parameters — already includes subject overrides +
   *  conditions modulation when subjectContext is supplied. */
  parameters: InstrumentParameters;
  /** Raw parameters as stored on the entity row. Useful when a UI
   *  needs to show "default" alongside "effective." Falls back to
   *  `parameters` when no subject context is in scope. */
  baseParameters: InstrumentParameters;
  /** Client-side update — applies optimistically + schedules debounced save.
   *  Note: writes to the ENTITY's stored params (global default),
   *  NOT to subject overrides. Use the subject PATCH for those. */
  set: (next: Partial<InstrumentParameters>) => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
}

/**
 * Loads parameters for an entity, exposes a setter that updates the local
 * state immediately + debounces a PUT to the server. Synthetic focals
 * (universe / space lab) get an in-memory-only experience so the dials
 * still work even when there's no DB row to write to.
 */
export function useEntityParameters({
  entityId,
  remote,
  initialParameters,
  initialCategory,
  debounceMs = 400,
  subjectContext,
}: UseEntityParametersOptions): UseEntityParametersResult {
  // `parameters` state holds the RAW entity-level values (what the
  // setter writes to). The `effective` view applies the subject
  // context on top before returning to the consumer.
  const [parameters, setParameters] = useState<InstrumentParameters>(() =>
    getEntityParameters({
      parameters: initialParameters ?? null,
      entity_category: initialCategory ?? null,
    }),
  );
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const ctrlRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial fetch
  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    fetch(`/api/entities/${entityId}/parameters`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: { parameters: InstrumentParameters }) => {
        if (!cancelled) setParameters(clampParameters(json.parameters));
      })
      .catch(() => {
        // Keep the locally-resolved defaults — UX still works.
      });
    return () => {
      cancelled = true;
    };
  }, [entityId, remote]);

  const set = useCallback(
    (next: Partial<InstrumentParameters>) => {
      setParameters((prev) => {
        const merged = clampParameters({ ...prev, ...next });
        // Schedule debounced save (only when remote)
        if (remote) {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(async () => {
            ctrlRef.current?.abort();
            const ctrl = new AbortController();
            ctrlRef.current = ctrl;
            setSaveStatus("saving");
            try {
              const res = await fetch(`/api/entities/${entityId}/parameters`, {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ parameters: merged }),
                signal: ctrl.signal,
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              setSaveStatus("saved");
            } catch (err) {
              if ((err as { name?: string }).name === "AbortError") return;
              setSaveStatus("error");
            }
          }, debounceMs);
        }
        return merged;
      });
    },
    [entityId, remote, debounceMs],
  );

  // Effective view — re-derived whenever raw params or subject
  // context changes. When no subject context is supplied this is
  // identity (returns `parameters` as-is).
  const effective = useMemo<InstrumentParameters>(() => {
    if (!subjectContext) return parameters;
    return getEntityParameters(
      {
        parameters: parameters as unknown as Record<string, unknown>,
        entity_category: initialCategory ?? null,
      },
      subjectContext,
    );
  }, [
    parameters,
    initialCategory,
    subjectContext,
  ]);

  return {
    parameters: effective,
    baseParameters: parameters,
    set,
    saveStatus,
  };
}

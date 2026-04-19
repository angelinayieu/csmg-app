"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AnalysisJob, JobEvent } from "@/types";

interface JobStreamState {
  job: AnalysisJob | null;
  events: JobEvent[];
  phase: string | null;
  artifactsReady: string[];
  spaceId: string | null;
  status: AnalysisJob["status"] | null;
  loading: boolean;
  error: string | null;
}

/**
 * Subscribe to a live analysis job via Supabase Realtime.
 *
 * On mount: GET /api/job/:id to prime state.
 * On subscribe: INSERT events into job_events and UPDATEs on analysis_jobs
 * push to the client over a WebSocket channel.
 *
 * On connection drop: a 15-second no-event watchdog re-primes via HTTP.
 */
export function useJobStream(jobId: string | null): JobStreamState {
  const [state, setState] = useState<JobStreamState>({
    job: null,
    events: [],
    phase: null,
    artifactsReady: [],
    spaceId: null,
    status: null,
    loading: !!jobId,
    error: null,
  });

  const lastEventAtRef = useRef<number>(Date.now());
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!jobId) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }

    let cancelled = false;

    async function primeState(id: string) {
      try {
        const res = await fetch(`/api/job/${id}`, { cache: "no-store" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          if (!cancelled) {
            setState((s) => ({
              ...s,
              loading: false,
              error: err.error ?? `Failed to load job (${res.status})`,
            }));
          }
          return;
        }
        const data = (await res.json()) as { job: AnalysisJob; events: JobEvent[] };
        if (cancelled) return;
        setState({
          job: data.job,
          events: data.events,
          phase: data.job.current_phase ?? null,
          artifactsReady: data.job.artifacts_ready ?? [],
          spaceId: data.job.space_id ?? null,
          status: data.job.status,
          loading: false,
          error: null,
        });
        lastEventAtRef.current = Date.now();
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      }
    }

    primeState(jobId);

    // Realtime subscription
    const supabase = createClient();
    const channel = supabase
      .channel(`job:${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "job_events",
          filter: `job_id=eq.${jobId}`,
        },
        (payload) => {
          const newEvent = payload.new as JobEvent;
          setState((s) => ({ ...s, events: [...s.events, newEvent] }));
          lastEventAtRef.current = Date.now();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "analysis_jobs",
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          const next = payload.new as AnalysisJob;
          setState((s) => ({
            ...s,
            job: next,
            phase: next.current_phase ?? s.phase,
            artifactsReady: next.artifacts_ready ?? s.artifactsReady,
            spaceId: next.space_id ?? s.spaceId,
            status: next.status,
          }));
          lastEventAtRef.current = Date.now();
        }
      )
      .subscribe();

    // Watchdog — if we receive no Realtime events for 15s and the job is still
    // running, re-prime via HTTP to catch up. Defense-in-depth for missed events.
    watchdogRef.current = setInterval(() => {
      if (cancelled) return;
      const quiet = Date.now() - lastEventAtRef.current;
      if (quiet > 15000 && state.status !== "completed" && state.status !== "failed") {
        primeState(jobId);
      }
    }, 5000);

    return () => {
      cancelled = true;
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  return state;
}

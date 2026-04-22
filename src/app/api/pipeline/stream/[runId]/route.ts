// ── Pipeline event SSE endpoint ──
// GET /api/pipeline/stream/[runId]
//
// Streams structural events for a pipeline run to the canvas. On
// connect, replays every event already persisted for that run
// (catch-up), then polls pipeline_run_events every 500ms for new rows
// until the run status flips to 'completed' or 'failed'.
//
// Framing: one `event: structural\ndata: <json>\n\n` block per event
// row. A final `event: done\ndata: <status-json>\n\n` when the run
// ends, then the stream closes.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type {
  PipelineRunEventRow,
  PipelineRunRow,
  StructuralEvent,
} from "@/types/pipeline-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 500;
const MAX_STREAM_DURATION_MS = 15 * 60 * 1000; // 15 min hard cap

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check.
  const { data: run } = (await db
    .from("pipeline_runs")
    .select("id, created_by, status")
    .eq("id", runId)
    .maybeSingle()) as { data: Pick<PipelineRunRow, "id" | "created_by" | "status"> | null };

  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (run.created_by !== user.id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const encoder = new TextEncoder();

  // Lifted here so `cancel()` can terminate the poll + heartbeat cleanly
  // when the client disconnects — otherwise setTimeout recurses forever
  // and we'd keep hammering the DB until MAX_STREAM_DURATION_MS.
  let closed = false;
  let heartbeatId: ReturnType<typeof setInterval> | null = null;
  let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now();
      let lastSeq = 0;

      const safeClose = () => {
        if (closed) return;
        closed = true;
        if (heartbeatId) clearInterval(heartbeatId);
        if (pollTimeoutId) clearTimeout(pollTimeoutId);
        try { controller.close(); } catch { /* already closed */ }
      };

      const send = (eventName: string, payload: unknown) => {
        if (closed) return;
        const chunk = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
        try { controller.enqueue(encoder.encode(chunk)); } catch { closed = true; }
      };

      const sendRows = (rows: PipelineRunEventRow[]) => {
        for (const r of rows) {
          send("structural", {
            sequence: r.sequence,
            emittedAt: r.emitted_at,
            event: r.payload as StructuralEvent,
          });
          lastSeq = Math.max(lastSeq, r.sequence);
        }
      };

      // Initial replay.
      try {
        const { data: backlog } = (await db
          .from("pipeline_run_events")
          .select("*")
          .eq("run_id", runId)
          .order("sequence", { ascending: true })) as {
          data: PipelineRunEventRow[] | null;
        };
        if (backlog) sendRows(backlog);
      } catch (err) {
        send("error", { message: "backlog fetch failed" });
        console.warn("[pipeline/stream] backlog failed:", err);
      }

      // Heartbeat every 15s to keep proxies from closing idle connections.
      heartbeatId = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { closed = true; }
      }, 15_000);

      const poll = async () => {
        if (closed) return;
        if (Date.now() - startedAt > MAX_STREAM_DURATION_MS) {
          send("done", { status: "timeout" });
          safeClose();
          return;
        }

        try {
          const { data: newEvents } = (await db
            .from("pipeline_run_events")
            .select("*")
            .eq("run_id", runId)
            .gt("sequence", lastSeq)
            .order("sequence", { ascending: true })) as {
            data: PipelineRunEventRow[] | null;
          };
          if (newEvents && newEvents.length > 0) sendRows(newEvents);

          const { data: current } = (await db
            .from("pipeline_runs")
            .select("status, completed_at, error_message")
            .eq("id", runId)
            .single()) as {
            data: Pick<PipelineRunRow, "status" | "completed_at" | "error_message"> | null;
          };

          if (current && current.status !== "running") {
            // Drain any final events that landed between queries.
            const { data: tail } = (await db
              .from("pipeline_run_events")
              .select("*")
              .eq("run_id", runId)
              .gt("sequence", lastSeq)
              .order("sequence", { ascending: true })) as {
              data: PipelineRunEventRow[] | null;
            };
            if (tail && tail.length > 0) sendRows(tail);

            send("done", {
              status: current.status,
              completedAt: current.completed_at,
              errorMessage: current.error_message,
            });
            safeClose();
            return;
          }
        } catch (err) {
          console.warn("[pipeline/stream] poll failed:", err);
        }

        if (!closed) pollTimeoutId = setTimeout(poll, POLL_INTERVAL_MS);
      };

      poll();
    },
    cancel() {
      // Client disconnected. Kill poll + heartbeat so we stop hammering
      // the DB. DB writes for the run itself continue; a reconnect would
      // replay the full event log via the backlog path.
      closed = true;
      if (heartbeatId) clearInterval(heartbeatId);
      if (pollTimeoutId) clearTimeout(pollTimeoutId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

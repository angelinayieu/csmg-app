/**
 * Ask: cross-whiteboard synthesis
 *
 * Trigger: "ask/cross-space.requested" (fired by POST /api/ask/start)
 *
 * Pipeline:
 *   1. Retrieval — FTS across all of the user's non-ask spaces via
 *      public.search_user_entities RPC.
 *   2. Synthesis — single LLM call with the retrieved entities as context,
 *      returning { title, answer, cited_entity_ids }.
 *   3. Ghost-clone — insert a reference entity per cited source into the
 *      ask space (is_reference=true, origin_entity_id+origin_space_id set).
 *      The canvas renders these as KG nodes automatically.
 *   4. Persist — answer → spaces.synthesis_text; spaces.synthesis_data
 *      carries the structured {title, cited_entity_ids} for drawer consumers.
 *
 * Progress is emitted via the existing analysis_jobs + job_events bus, so the
 * ask space page can subscribe with the same hook the analyze flow uses.
 */

import { inngest } from "../client";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { llmGenerate } from "@/lib/llm";
import {
  emitJobEvent,
  setJobPhase,
  markArtifactReady,
  finalizeJob,
} from "../job-writer";

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Supabase env missing for Inngest function");
  return createServiceClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface RetrievedEntity {
  id: string;
  space_id: string;
  space_name: string;
  entity_id: string;
  name: string;
  description: string | null;
  entity_type: string;
  entity_category: string;
  importance: string | null;
  is_leverage_point: boolean;
  is_risk_point: boolean;
  rank: number;
}

export const askCrossSpace = inngest.createFunction(
  {
    id: "ask-cross-space",
    name: "Ask: cross-whiteboard synthesis",
    retries: 1,
    triggers: [{ event: "ask/cross-space.requested" }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onFailure: async ({ event, error }: { event: any; error: unknown }) => {
      const originalData = event.data?.event?.data ?? {};
      const { jobId } = originalData as { jobId?: string };
      if (!jobId) return;
      const db = svc();
      await finalizeJob(db, jobId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: { event: any; step: any }) => {
    const { jobId, userId, spaceId, query } = event.data as {
      jobId: string;
      userId: string;
      spaceId: string;
      query: string;
    };
    const db = svc();

    // ── Phase A: mark running ──
    await step.run("mark-running", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any)
        .from("analysis_jobs")
        .update({
          status: "running",
          current_phase: "running",
          inngest_run_id: event.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      await emitJobEvent(db, jobId, "phase_started", { payload: { phase: "running" } });
    });

    // ── Phase B: retrieve top entities across user's whiteboards ──
    const retrieved: RetrievedEntity[] = await step.run("retrieve-entities", async () => {
      await setJobPhase(db, jobId, "researching");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (db as any).rpc("search_user_entities", {
        p_user_id: userId,
        p_query: query,
        p_limit: 20,
        p_exclude_space_id: spaceId,
      });
      if (error) {
        await emitJobEvent(db, jobId, "warning", {
          payload: { message: `Retrieval failed: ${error.message}` },
        });
        return [];
      }
      const rows = (data as RetrievedEntity[]) ?? [];
      await emitJobEvent(db, jobId, "retrieval_done", { payload: { count: rows.length } });
      return rows;
    });

    // ── Phase C: synthesize answer ──
    const synthesis = await step.run("synthesize", async () => {
      await setJobPhase(db, jobId, "synthesizing");

      // No prior knowledge found — fall back to a plain answer so the user
      // still sees a useful response and a nudge to build a proper analysis.
      if (retrieved.length === 0) {
        const text = await llmGenerate({
          system:
            "You are InterAxis, a knowledge-graph reasoning assistant. The user asked a question, but no relevant entities were found across their whiteboards. Answer helpfully from general knowledge and note that this topic isn't yet mapped in their workspace — suggest starting a new analysis to build one.",
          user: query,
          temperature: 0.4,
          maxTokens: 1200,
        });
        return {
          title: null as string | null,
          answer: text,
          citedEntityIds: [] as string[],
        };
      }

      const contextBlock = retrieved
        .map((e, i) => {
          const flags = [
            e.is_leverage_point ? "leverage" : null,
            e.is_risk_point ? "risk" : null,
            e.importance,
          ]
            .filter(Boolean)
            .join(", ");
          return `[${i + 1}] ENTITY_ID=${e.id} whiteboard="${e.space_name}"
    name: ${e.name}
    type: ${e.entity_type} (${e.entity_category})${flags ? `\n    flags: ${flags}` : ""}${
            e.description ? `\n    description: ${e.description}` : ""
          }`;
        })
        .join("\n\n");

      const system = `You are InterAxis, a knowledge-graph reasoning assistant with read access to every whiteboard the user has built. The user is asking a question and you have retrieved the ${retrieved.length} most relevant entities across all their whiteboards.

Your job: answer the question crisply, grounded in the retrieved context. When you reference an entity, cite it inline as [^ENTITY_ID] using the UUIDs from the context. Cite only entities you actually used.

Return STRICT JSON with this exact shape (no prose outside the JSON):
{
  "title": "short 3-6 word title of the answer",
  "answer": "markdown body, using [^uuid] inline citations",
  "cited_entity_ids": ["uuid", "uuid", ...]
}`;

      const raw = await llmGenerate({
        system,
        user: `USER QUESTION:\n${query}\n\nRETRIEVED CONTEXT:\n${contextBlock}`,
        temperature: 0.35,
        maxTokens: 2000,
      });

      // Tolerate code-fenced or trailing prose — extract the outermost {..} block.
      let parsed: { title?: string; answer?: string; cited_entity_ids?: string[] } = {};
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : { answer: raw };
      } catch {
        parsed = { answer: raw };
      }

      const retrievedIdSet = new Set(retrieved.map((r) => r.id));
      const citedIds = Array.isArray(parsed.cited_entity_ids)
        ? parsed.cited_entity_ids.filter(
            (id): id is string => typeof id === "string" && retrievedIdSet.has(id)
          )
        : [];
      return {
        title: parsed.title ?? null,
        answer: parsed.answer ?? raw,
        citedEntityIds: citedIds,
      };
    });

    // ── Phase D: ghost-clone the cited source entities into the ask space ──
    const clonedEntityIds: string[] = await step.run("clone-cited-entities", async () => {
      if (synthesis.citedEntityIds.length === 0) return [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: origins } = await (db as any)
        .from("entities")
        .select(
          "id, space_id, name, description, entity_type, entity_category, importance, confidence, is_leverage_point, is_risk_point, is_master_bottleneck, knowledge_layer, authority_level, provenance"
        )
        .in("id", synthesis.citedEntityIds);

      const originRows = (origins ?? []) as Array<{
        id: string;
        space_id: string;
        name: string;
        description: string | null;
        entity_type: string | null;
        entity_category: string | null;
        importance: string | null;
        confidence: number | null;
        is_leverage_point: boolean | null;
        is_risk_point: boolean | null;
        is_master_bottleneck: boolean | null;
        knowledge_layer: string | null;
        authority_level: string | null;
        provenance: Record<string, unknown> | null;
      }>;
      if (originRows.length === 0) return [];

      const VALID_CATS = ["concrete", "abstract", "process", "relational", "epistemic"] as const;
      const VALID_IMP = ["fundamental", "critical", "important", "moderate"] as const;
      const VALID_KL = ["internal", "conceptual", "external", "bridge"] as const;
      const VALID_AL = ["high", "moderate", "low", "unverified"] as const;
      type Cat = (typeof VALID_CATS)[number];
      type Imp = (typeof VALID_IMP)[number];
      type Kl = (typeof VALID_KL)[number];
      type Al = (typeof VALID_AL)[number];

      const inserts = originRows.map((o, i) => ({
        space_id: spaceId,
        entity_id: `REF${i + 1}`,
        name: o.name,
        description: o.description,
        source_tag: "explicit" as const,
        entity_type: o.entity_type ?? "concept",
        entity_category: (VALID_CATS.includes((o.entity_category ?? "") as Cat)
          ? (o.entity_category as Cat)
          : "abstract") as Cat,
        importance: (o.importance && VALID_IMP.includes(o.importance as Imp)
          ? (o.importance as Imp)
          : "moderate") as Imp,
        confidence: o.confidence ?? 0.8,
        is_leverage_point: o.is_leverage_point ?? false,
        is_risk_point: o.is_risk_point ?? false,
        is_master_bottleneck: o.is_master_bottleneck ?? false,
        knowledge_layer: (VALID_KL.includes((o.knowledge_layer ?? "") as Kl)
          ? (o.knowledge_layer as Kl)
          : "internal") as Kl,
        authority_level: (VALID_AL.includes((o.authority_level ?? "") as Al)
          ? (o.authority_level as Al)
          : "moderate") as Al,
        is_reference: true,
        origin_entity_id: o.id,
        origin_space_id: o.space_id,
        provenance: {
          ...(o.provenance ?? {}),
          reference_of: o.id,
          reference_source_space: o.space_id,
          ask_whiteboard: spaceId,
        },
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: inserted, error: insertErr } = await (db as any)
        .from("entities")
        .insert(inserts)
        .select("id");
      if (insertErr) {
        await emitJobEvent(db, jobId, "warning", {
          payload: { message: `Ref entity insert failed: ${insertErr.message}` },
        });
        return [];
      }
      const ids = ((inserted ?? []) as Array<{ id: string }>).map((r) => r.id);
      await emitJobEvent(db, jobId, "entities_cloned", { payload: { count: ids.length } });
      return ids;
    });

    // ── Phase E: persist answer onto spaces row ──
    await step.run("persist-answer", async () => {
      await setJobPhase(db, jobId, "committing");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any)
        .from("spaces")
        .update({
          synthesis_text: synthesis.answer,
          synthesis_data: {
            ask_answer: {
              title: synthesis.title,
              body: synthesis.answer,
              cited_entity_ids: synthesis.citedEntityIds,
              question: query,
            },
          },
          entity_count: clonedEntityIds.length,
          updated_at: new Date().toISOString(),
        })
        .eq("id", spaceId);

      await markArtifactReady(db, jobId, "synthesis", { spaceId });
      await markArtifactReady(db, jobId, "entities", {
        spaceId,
        count: clonedEntityIds.length,
      });
    });

    // ── Phase F: finalize ──
    await step.run("mark-complete", async () => {
      await finalizeJob(db, jobId, { status: "completed", spaceId });
    });

    return { jobId, spaceId, refCount: clonedEntityIds.length };
  }
);

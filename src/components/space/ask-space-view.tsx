"use client";

/**
 * AskSpaceView — the landing view for an ask-kind whiteboard.
 *
 * Replaces the full analysis dashboard (production sequence, twin, metric
 * landscape, etc.) with a single-purpose layout:
 *
 *   - the original question (input_text)
 *   - the synthesized answer as a foregrounded markdown card
 *   - a grid of reference entity chips, each linking back to its origin
 *     whiteboard so the user can trace any claim to its source
 *
 * Renders when `space.kind === 'ask'`. All other space kinds continue
 * through the normal dashboard path.
 *
 * Progress state: if the inngest job is still running, the answer will be
 * empty on first load. We surface a subtle "thinking" affordance that
 * auto-refreshes when the space's synthesis_text lands.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  MessageCircleQuestion,
  Sparkles,
  ArrowUpRight,
  ExternalLink,
  Loader2,
} from "lucide-react";
import Markdown from "react-markdown";
import { useRouter } from "next/navigation";
import { useSpaceData } from "@/contexts/space-data-context";
import type { Entity } from "@/types";

interface AskAnswer {
  title?: string | null;
  body?: string | null;
  cited_entity_ids?: string[];
  question?: string | null;
}

export function AskSpaceView() {
  const { space, entities } = useSpaceData();
  const router = useRouter();

  const question = space.input_text ?? "";
  const askPayload = readAskAnswer(space.synthesis_data);
  const answerBody = (space.synthesis_text ?? askPayload?.body ?? "").trim();
  const answerTitle = askPayload?.title ?? null;
  const loading = answerBody.length === 0;

  // Poll the route while the answer hasn't landed yet — refresh() re-runs
  // the server component which reloads the space row. 3s cadence matches
  // the analyze flow's SSE-adjacent experience without needing a WS.
  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(id);
  }, [loading, router]);

  // Only reference entities are relevant on an ask whiteboard; filter
  // defensively in case the user drops non-ref entities onto this space.
  const refs = entities.filter((e) => {
    return (e as Entity & { is_reference?: boolean }).is_reference === true;
  });

  return (
    <div className="mx-auto w-full max-w-[880px] px-6 py-10">
      {/* Question block */}
      <div className="mb-6 flex items-start gap-3">
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-interaxis-50 text-interaxis-700">
          <MessageCircleQuestion className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-interaxis-700">
            Asked across your whiteboards
          </div>
          <h1
            className="mt-1 text-[22px] font-semibold leading-snug text-gray-900"
            style={{ letterSpacing: "-0.015em" }}
          >
            {question || "(no question recorded)"}
          </h1>
        </div>
      </div>

      {/* Answer card */}
      <div className="relative rounded-2xl border border-gray-200 bg-white p-7 shadow-[0_12px_40px_-24px_rgba(0,40,120,0.22)]">
        <div
          aria-hidden
          className="absolute left-0 right-0 top-0 h-[3px] rounded-t-2xl"
          style={{
            background:
              "linear-gradient(90deg, #0a6aee 0%, #7c3aed 55%, #ec4899 100%)",
          }}
        />
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-interaxis-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-interaxis-700">
          <Sparkles className="h-2.5 w-2.5" />
          {answerTitle ?? "Answer"}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-[13px] text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-interaxis-600" />
            Searching across your whiteboards and composing an answer…
          </div>
        ) : (
          <div className="prose prose-sm max-w-none text-[14px] leading-relaxed text-gray-800">
            <Markdown>{answerBody}</Markdown>
          </div>
        )}

        {refs.length > 0 && (
          <div className="mt-4 flex items-center gap-1.5 text-[10.5px] text-gray-500">
            <span className="font-semibold">{refs.length}</span>
            <span>
              {refs.length === 1 ? "referenced entity" : "referenced entities"} —
              click any card below to jump to its source whiteboard.
            </span>
          </div>
        )}
      </div>

      {/* Reference entity cards */}
      {refs.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500">
              References
            </h2>
            <div className="h-px flex-1 bg-gray-200/70" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {refs.map((entity) => (
              <ReferenceCard key={entity.id} entity={entity} />
            ))}
          </div>
        </div>
      )}

      {/* Follow-up hint — opens a new ask with context of this one */}
      <div className="mt-10 text-center text-[11px] text-gray-400">
        Want to go deeper?{" "}
        <Link
          href="/app"
          className="font-semibold text-interaxis-600 hover:text-interaxis-700"
        >
          Ask another question
        </Link>{" "}
        or drag any reference into a new analysis.
      </div>
    </div>
  );
}

function ReferenceCard({ entity }: { entity: Entity }) {
  const [originName, setOriginName] = useState<string | null>(null);
  const ext = entity as Entity & {
    origin_entity_id?: string | null;
    origin_space_id?: string | null;
  };
  const originSpaceId = ext.origin_space_id ?? null;
  const originEntityId = ext.origin_entity_id ?? null;

  // Fetch the origin whiteboard's name once, per-card. Best-effort — if the
  // lookup fails the chip still renders with a neutral "source" label.
  useEffect(() => {
    if (!originSpaceId) return;
    let cancelled = false;
    fetch(`/api/spaces/${originSpaceId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { name?: string } | null) => {
        if (!cancelled && d?.name) setOriginName(d.name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [originSpaceId]);

  const href = originSpaceId
    ? `/app/space/${originSpaceId}${originEntityId ? `?highlight=${originEntityId}` : ""}`
    : "#";

  const importance = entity.importance ?? "moderate";
  const flagColor = entity.is_leverage_point
    ? "bg-blue-500"
    : entity.is_risk_point
      ? "bg-red-500"
      : entity.is_master_bottleneck
        ? "bg-amber-500"
        : "bg-gray-300";

  return (
    <Link
      href={href}
      className="group relative block rounded-xl border border-gray-200 bg-white p-3.5 transition-all hover:border-interaxis-300 hover:shadow-[0_6px_16px_-8px_rgba(0,40,120,0.2)]"
    >
      <div className="flex items-center gap-2">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${flagColor}`} />
        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-500">
          {entity.entity_category}
        </span>
        <span className="text-[9px] text-gray-300">·</span>
        <span className="text-[9px] font-medium text-gray-500">{importance}</span>
        <ExternalLink className="ml-auto h-3 w-3 text-gray-300 transition-colors group-hover:text-interaxis-600" />
      </div>
      <h3
        className="mt-1.5 text-[13px] font-semibold leading-tight text-gray-900 group-hover:text-interaxis-700"
        style={{ letterSpacing: "-0.01em" }}
      >
        {entity.name}
      </h3>
      {entity.description && (
        <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-gray-600">
          {entity.description}
        </p>
      )}
      <div className="mt-2.5 flex items-center gap-1 text-[10px] text-gray-400">
        <ArrowUpRight className="h-2.5 w-2.5" />
        <span className="truncate">
          source: <span className="font-medium text-gray-600">{originName ?? "whiteboard"}</span>
        </span>
      </div>
    </Link>
  );
}

/** Safely extract the ask payload from spaces.synthesis_data (JSON or string). */
function readAskAnswer(raw: unknown): AskAnswer | null {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const data = parsed as { ask_answer?: AskAnswer };
    return data?.ask_answer ?? null;
  } catch {
    return null;
  }
}

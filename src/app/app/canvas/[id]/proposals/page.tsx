// Proposals view for a canvas — /app/canvas/[id]/proposals
//
// Sprint 3 — dedicated surface for accepting / rejecting concept proposals
// detected by ambient scanning on the canvas. Reachable from the CanvasCard
// "N pending" chip and from the editor (Sprint 4 will mount the rail
// directly alongside tldraw).
//
// Layout:
//   - Left column: note preview list. For each note with pending proposals,
//     shows the anchored_text spans with inline underlines colored per scope.
//   - Right column: the ProposalRail.

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  ProposalRail,
  type HydratedProposal,
  type HydratedGroup,
  type HydratedSpan,
} from "@/components/canvas/proposal-rail";
import { NotePreviewList } from "@/components/canvas/note-preview-list";
import { AcceptedSection } from "@/components/canvas/accepted-section";
import { getCanvasScopeColor } from "@/lib/design-tokens";
import type { Canvas } from "@/types";

export const dynamic = "force-dynamic";

export default async function CanvasProposalsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const { id } = await params;
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: canvas } = (await db
    .from("canvases")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle()) as { data: Canvas | null };

  if (!canvas) notFound();

  // SSR-fetch proposals grouped by note. We reuse the same query shape the
  // GET endpoint returns so hydration matches exactly.
  const { data: proposals } = (await db
    .from("concept_proposals")
    .select("*")
    .eq("owner_id", user.id)
    .eq("canvas_id", id)
    .eq("status", "pending")
    .order("note_id", { ascending: true })
    .order("start_offset", { ascending: true, nullsFirst: false })
    .order("confidence", { ascending: false })) as {
    data: Array<HydratedProposal> | null;
  };

  const rawProposals = proposals ?? [];

  // Hydrate entity + target canvas names
  const entityIds = Array.from(
    new Set(rawProposals.map((p) => p.entity_id).filter((x): x is string => !!x)),
  );
  const targetCanvasIds = Array.from(
    new Set(rawProposals.map((p) => p.target_canvas_id).filter((x): x is string => !!x)),
  );

  const entityById = new Map<
    string,
    { name: string; space_name: string | null }
  >();
  if (entityIds.length > 0) {
    const { data: ents } = (await db
      .from("entities")
      .select("id, name, space_id")
      .in("id", entityIds)) as {
      data: Array<{ id: string; name: string; space_id: string }> | null;
    };
    const spaceIds = Array.from(new Set((ents ?? []).map((e) => e.space_id)));
    const { data: spaces } = (await db
      .from("spaces")
      .select("id, name")
      .in("id", spaceIds)) as {
      data: Array<{ id: string; name: string }> | null;
    };
    const spaceNameById = new Map((spaces ?? []).map((s) => [s.id, s.name]));
    for (const e of ents ?? []) {
      entityById.set(e.id, {
        name: e.name,
        space_name: spaceNameById.get(e.space_id) ?? null,
      });
    }
  }

  const canvasTitleById = new Map<string, string>();
  if (targetCanvasIds.length > 0) {
    const { data: tc } = (await db
      .from("canvases")
      .select("id, title")
      .in("id", targetCanvasIds)) as {
      data: Array<{ id: string; title: string }> | null;
    };
    for (const c of tc ?? []) canvasTitleById.set(c.id, c.title);
  }

  const hydrated: HydratedProposal[] = rawProposals.map((p) => {
    const e = p.entity_id ? entityById.get(p.entity_id) ?? null : null;
    return {
      ...p,
      entity_name: e?.name ?? p.proposed_entity_name ?? null,
      entity_space_name: e?.space_name ?? null,
      target_canvas_title: p.target_canvas_id
        ? canvasTitleById.get(p.target_canvas_id) ?? null
        : null,
    };
  });

  // Group
  const byNote = new Map<string, HydratedGroup>();
  for (const p of hydrated) {
    let g = byNote.get(p.note_id);
    if (!g) {
      g = { note_id: p.note_id, note_text: "", spans: [] };
      byNote.set(p.note_id, g);
    }
    const spanKey = `${p.start_offset ?? "n"}:${p.end_offset ?? "n"}`;
    let s = g.spans.find(
      (x) => `${x.start_offset ?? "n"}:${x.end_offset ?? "n"}` === spanKey,
    );
    if (!s) {
      s = {
        start_offset: p.start_offset,
        end_offset: p.end_offset,
        anchored_text: p.anchored_text,
        proposals: [],
      };
      g.spans.push(s);
    }
    s.proposals.push(p);
  }
  const groups: HydratedGroup[] = Array.from(byNote.values());

  // Sprint 5 — also load recently accepted proposals so users can deepen them.
  // Cap to last 30 days & last 50 rows to keep the list short; a "See more"
  // affordance can come later.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: acceptedRaw } = (await db
    .from("concept_proposals")
    .select("id, entity_id, anchored_text, resolved_at, start_offset, end_offset, note_id")
    .eq("owner_id", user.id)
    .eq("canvas_id", id)
    .eq("status", "accepted")
    .gte("resolved_at", thirtyDaysAgo)
    .order("resolved_at", { ascending: false })
    .limit(50)) as {
    data: Array<{
      id: string;
      entity_id: string | null;
      anchored_text: string | null;
      resolved_at: string | null;
      start_offset: number | null;
      end_offset: number | null;
      note_id: string;
    }> | null;
  };
  const acceptedRows = acceptedRaw ?? [];

  const acceptedEntityIds = Array.from(
    new Set(
      acceptedRows
        .map((r) => r.entity_id)
        .filter((x): x is string => !!x),
    ),
  );
  const acceptedEntityById = new Map<
    string,
    { id: string; name: string; space_name: string | null; is_decomposable: boolean }
  >();
  if (acceptedEntityIds.length > 0) {
    const { data: ents } = (await db
      .from("entities")
      .select("id, name, space_id, is_decomposable")
      .in("id", acceptedEntityIds)) as {
      data: Array<{
        id: string;
        name: string;
        space_id: string;
        is_decomposable: boolean;
      }> | null;
    };
    const spaceIds = Array.from(new Set((ents ?? []).map((e) => e.space_id)));
    const { data: spaces } = (await db
      .from("spaces")
      .select("id, name")
      .in("id", spaceIds)) as {
      data: Array<{ id: string; name: string }> | null;
    };
    const spaceNameById = new Map((spaces ?? []).map((s) => [s.id, s.name]));
    for (const e of ents ?? []) {
      acceptedEntityById.set(e.id, {
        id: e.id,
        name: e.name,
        space_name: spaceNameById.get(e.space_id) ?? null,
        is_decomposable: e.is_decomposable,
      });
    }
  }

  const accepted = acceptedRows
    .map((r) => {
      const e = r.entity_id ? acceptedEntityById.get(r.entity_id) : null;
      if (!e) return null;
      return {
        proposal_id: r.id,
        entity_id: e.id,
        entity_name: e.name,
        entity_space_name: e.space_name,
        anchored_text: r.anchored_text,
        resolved_at: r.resolved_at,
      };
    })
    .filter(
      (r): r is NonNullable<typeof r> => r !== null,
    );

  const scopeColor = getCanvasScopeColor(canvas.scope);

  return (
    <div className="-mx-6 -my-6 flex h-[calc(100vh-2rem)]">
      {/* Left: note previews with inline span highlights */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-2xl">
          <Link
            href={`/app/canvas/${canvas.id}`}
            className="inline-flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-800"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to canvas
          </Link>

          <div className="mt-4 flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: scopeColor.dot }}
            />
            <span
              className="text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: scopeColor.text }}
            >
              {scopeColor.label} canvas
            </span>
          </div>

          <h1 className="mt-1 text-[22px] font-semibold text-gray-900">
            {canvas.title}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Review concept proposals detected in your notes. Accepted proposals
            become anchored spans — each underlined inline with the scope
            color of the linked concept.
          </p>

          <div className="mt-6">
            <NotePreviewList groups={groups} canvasScope={canvas.scope} />
          </div>

          {accepted.length > 0 && (
            <div className="mt-8">
              <AcceptedSection accepted={accepted} />
            </div>
          )}
        </div>
      </div>

      {/* Right: the ProposalRail */}
      <ProposalRail canvasId={canvas.id} initialGroups={groups} />
    </div>
  );
}

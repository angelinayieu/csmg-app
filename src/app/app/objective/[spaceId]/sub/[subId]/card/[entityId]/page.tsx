// ── /app/objective/[spaceId]/sub/[subId]/card/[entityId] — Card room ──
//
// The persistent full-page "room" for a single card. Every card can be
// opened here (URL-addressable, server-rendered) instead of only as the
// transient drawer overlay.
//
//   • FEATURE cards already have a full room — the Lab. We redirect there
//     so there's ONE feature surface, not a duplicate.
//   • PAIN / OUTCOME cards render CardRoomView (their definition + fields)
//     as a real page.
//
// Mirrors the Lab route's auth + ownership + URL self-heal so the two
// behave identically and fold together cleanly once the Lab route
// (currently mid-rewrite by a parallel workstream) frees up.

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { HomeTabNav } from "@/components/app/home-tab-nav";
import { CardRoomView } from "@/components/objective/card-room-view";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { ExpandedItemDetail } from "@/lib/objective-canvas/expand-item-detail";

export const dynamic = "force-dynamic";

interface RouteParams {
  spaceId: string;
  subId: string;
  entityId: string;
}

export default async function CardRoomPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { spaceId, subId, entityId } = await params;
  const user = await getAuthUser();
  if (!user) {
    redirect(
      `/sign-in?next=/app/objective/${spaceId}/sub/${subId}/card/${entityId}`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // ── Load entity + ownership check ──
  const { data: entity } = await supabase
    .from("entities")
    .select(
      "id, name, entity_type, space_id, parent_sub_objective_id, causal_chain, expanded_detail",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) notFound();

  const { data: space } = await supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== user.id) notFound();

  // URL self-heal — canonical path uses the entity's real space + sub.
  if (space.id !== spaceId) {
    redirect(
      `/app/objective/${space.id}/sub/${entity.parent_sub_objective_id ?? subId}/card/${entityId}`,
    );
  }
  if (
    entity.parent_sub_objective_id &&
    entity.parent_sub_objective_id !== subId
  ) {
    redirect(
      `/app/objective/${spaceId}/sub/${entity.parent_sub_objective_id}/card/${entityId}`,
    );
  }

  // Features already have a dedicated full room — the Lab. Reuse it
  // rather than duplicating the evaluation surface here.
  if (entity.entity_type === "feature") {
    redirect(`/app/objective/${spaceId}/sub/${subId}/lab/${entityId}`);
  }

  // ── Room title for the breadcrumb ──
  let subObjectiveTitle = "Room";
  if (entity.parent_sub_objective_id) {
    const { data: sub } = await supabase
      .from("improvement_goals")
      .select("title")
      .eq("id", entity.parent_sub_objective_id)
      .maybeSingle();
    if (sub && typeof sub.title === "string" && sub.title.trim()) {
      subObjectiveTitle = sub.title;
    }
  }

  const expanded =
    (entity.expanded_detail as ExpandedItemDetail | null) ?? null;

  return (
    <>
      <HomeTabNav />

      <div className="pb-12" style={{ fontFamily: appleVibe.font.stack }}>
        {/* Breadcrumb strip — matches the Lab page's chrome. */}
        <div
          className="border-b"
          style={{ borderColor: appleVibe.stroke.hairline }}
        >
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-3">
            <Link
              href={`/app/objective/${spaceId}/sub/${subId}`}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium transition-colors hover:text-[rgba(15,23,42,0.92)]"
              style={{ color: appleVibe.text.tertiary }}
              aria-label="Back to room"
            >
              <ArrowLeft className="h-3 w-3" strokeWidth={2.4} />
              Back to room
            </Link>
            <span className="text-[11px]" style={{ color: appleVibe.text.faint }}>
              /
            </span>
            <Link
              href={`/app/objective/${spaceId}/sub/${subId}`}
              className="truncate text-[11px] font-medium transition-colors hover:text-[rgba(15,23,42,0.92)]"
              style={{ color: appleVibe.text.tertiary }}
              title={subObjectiveTitle}
            >
              {subObjectiveTitle}
            </Link>
            <span className="text-[11px]" style={{ color: appleVibe.text.faint }}>
              /
            </span>
            <span
              className="text-[11px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: appleVibe.accent.primary }}
            >
              Card
            </span>
          </div>
        </div>

        <CardRoomView
          spaceId={spaceId}
          subObjectiveId={subId}
          entityId={entityId}
          entityName={entity.name}
          entityType={entity.entity_type}
          causalChain={entity.causal_chain ?? null}
          expandedDetail={expanded}
        />
      </div>
    </>
  );
}

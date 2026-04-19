// Canvas Library — /app/library
//
// Server-rendered shell that fetches:
//   (1) every non-archived canvas for the current user + scope_ref names
//       + pending-proposal counts (the CanvasCardData shape),
//   (2) the user's spaces / objectives / apps so the CreateCanvasModal
//       can offer scope-specific ref pickers without a client round-trip
//       on first open.
//
// The client component (CanvasLibrary) owns the interactive surface:
// scope tabs, pin toggle, archive, create modal, empty states.

import { createClient, getAuthUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { resolveScopeRefNames } from "@/lib/canvas/scope-ref";
import { CanvasLibrary } from "@/components/library/canvas-library";
import type {
  Canvas,
  CanvasCardData,
  CanvasScopeRefType,
} from "@/types";

export const dynamic = "force-dynamic";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const { archived } = await searchParams;
  const showArchived = archived === "1";

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Parallel: canvases + the three ref-source tables used by the modal.
  const [canvasRes, spacesRes, goalsRes, appsRes] = await Promise.all([
    db
      .from("canvases")
      .select("*")
      .eq("owner_id", user.id)
      .eq("archived", showArchived)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false }),
    db
      .from("spaces")
      .select("id, name")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    db
      .from("improvement_goals")
      .select("id, title")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    db
      .from("apps")
      .select("id, name, space_id")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
  ]);

  const canvases = (canvasRes.data ?? []) as Canvas[];
  const spaceOptions = (spacesRes.data ?? []) as Array<{
    id: string;
    name: string;
  }>;
  const goalOptions = (goalsRes.data ?? []) as Array<{
    id: string;
    title: string;
  }>;
  const appOptions = (appsRes.data ?? []) as Array<{
    id: string;
    name: string;
    space_id: string;
  }>;

  // Resolve scope-ref names + pending-proposal counts for the cards.
  const refs = canvases
    .filter(
      (c): c is Canvas & {
        scope_ref_type: CanvasScopeRefType;
        scope_ref_id: string;
      } => !!c.scope_ref_type && !!c.scope_ref_id,
    )
    .map((c) => ({
      scope_ref_type: c.scope_ref_type as CanvasScopeRefType,
      scope_ref_id: c.scope_ref_id as string,
    }));
  const nameByRef = await resolveScopeRefNames(db, refs);

  const canvasIds = canvases.map((c) => c.id);
  const pendingByCanvas = new Map<string, number>();
  if (canvasIds.length > 0) {
    const { data: propRows } = (await db
      .from("concept_proposals")
      .select("canvas_id")
      .eq("status", "pending")
      .in("canvas_id", canvasIds)) as {
      data: Array<{ canvas_id: string }> | null;
    };
    for (const r of propRows ?? []) {
      pendingByCanvas.set(
        r.canvas_id,
        (pendingByCanvas.get(r.canvas_id) ?? 0) + 1,
      );
    }
  }

  const hydrated: CanvasCardData[] = canvases.map((c) => ({
    ...c,
    scope_ref_name:
      c.scope_ref_type && c.scope_ref_id
        ? nameByRef.get(`${c.scope_ref_type}:${c.scope_ref_id}`) ?? null
        : null,
    pending_proposals: pendingByCanvas.get(c.id) ?? 0,
  }));

  return (
    <CanvasLibrary
      initialCanvases={hydrated}
      spaceOptions={spaceOptions}
      goalOptions={goalOptions}
      appOptions={appOptions}
      showArchived={showArchived}
    />
  );
}

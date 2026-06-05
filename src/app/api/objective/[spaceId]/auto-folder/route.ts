// POST /api/objective/[spaceId]/auto-folder
//   { onlyUnfiled?: boolean } → AI-cluster the space's library_objects into
//   2–6 cohesive FOLDERS and persist each object's `subsystem`.
//
// This is the "ai auto foldering for relevant connected things" path. It reuses
// the SAME `subsystem` column the decompose LLM seeds (the Library groups by it)
// — so manual moves (the objects route's "subsystem" action) and this auto pass
// are one model, not parallel systems. "Connected things" is fed to the model
// literally: existing `object_links` adjacency is included so manually-linked
// cards bias toward the same folder. Soft-fails to an empty assignment.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import { setObjectSubsystem } from "@/lib/objective-canvas/library-objects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ spaceId: string }> };

interface ObjRow {
  id: string;
  title: string | null;
  summary: string | null;
  object_type: string | null;
  subsystem: string | null;
}

const titleCase = (s: string) =>
  s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export async function POST(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let onlyUnfiled = false;
  try {
    const b = (await req.json()) as { onlyUnfiled?: unknown };
    onlyUnfiled = b?.onlyUnfiled === true;
  } catch {
    /* no body → cluster everything */
  }

  const { data: space } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.user_id !== user.id)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const { data: rows } = await db
    .from("library_objects")
    .select("id, title, summary, object_type, subsystem")
    .eq("space_id", spaceId);

  // Provenance plumbing (context_anchor/_concept) isn't a user idea card — skip.
  const all: ObjRow[] = (rows ?? []).filter(
    (o: ObjRow) =>
      o.object_type !== "context_anchor" && o.object_type !== "context_concept",
  );
  // The model sees EVERY card (so it can keep good existing folders), but we
  // only re-file the requested scope. Cap to keep the prompt bounded.
  const objects = all.slice(0, 120);
  const refileSet = new Set(
    (onlyUnfiled
      ? objects.filter((o) => !o.subsystem || !o.subsystem.trim())
      : objects
    ).map((o) => o.id),
  );
  if (objects.length < 2 || refileSet.size === 0) {
    return NextResponse.json({ assignments: {}, folders: [] });
  }

  // Stable index → id (the model assigns by index so it can't mangle UUIDs).
  const idByIndex = objects.map((o) => o.id);
  const lines = objects
    .map((o, i) => {
      const t = (o.title ?? "Untitled").slice(0, 90);
      const s = (o.summary ?? "").replace(/\s+/g, " ").slice(0, 140);
      const cur = o.subsystem?.trim() ? ` [now: ${o.subsystem.trim()}]` : "";
      return `${i}. (${titleCase(o.object_type ?? "object")})${cur} ${t}${s ? ` — ${s}` : ""}`;
    })
    .join("\n");

  // "relevant connected things" — manual/auto object_links as adjacency hints.
  const idSet = new Set(objects.map((o) => o.id));
  const indexById = new Map(objects.map((o, i) => [o.id, i]));
  const { data: links } = await db
    .from("object_links")
    .select("from_object_id, to_object_id")
    .eq("space_id", spaceId);
  const edges = (links ?? [])
    .filter(
      (l: { from_object_id: string; to_object_id: string }) =>
        idSet.has(l.from_object_id) && idSet.has(l.to_object_id),
    )
    .map(
      (l: { from_object_id: string; to_object_id: string }) =>
        `${indexById.get(l.from_object_id)}-${indexById.get(l.to_object_id)}`,
    )
    .slice(0, 200);

  const system =
    "You organize a product strategy library into folders. Group the cards into " +
    "2–6 cohesive FOLDERS — each a functional part of the plan (e.g. " +
    '"Onboarding", "Content Engine", "Retention Loop", "Trust & Safety"). ' +
    "Give each folder a short Title Case name (≤ 3 words). Cards that are " +
    "CONNECTED (see connections) almost always belong in the same folder. Keep a " +
    "good existing folder name when it still fits. Every card index must appear " +
    "in exactly one folder. Return ONLY the JSON.";
  const userMsg = `CARDS (index. (type) [now: current folder] title — summary):\n${lines}\n\nCONNECTIONS (indexA-indexB, same cluster):\n${edges.length ? edges.join(", ") : "(none)"}\n\nReturn folders covering every index 0..${objects.length - 1}.`;

  let result: { folders: { name: string; item_indexes: number[] }[] };
  try {
    result = await llmJSON<{ folders: { name: string; item_indexes: number[] }[] }>({
      system,
      user: userMsg,
      maxTokens: 1400,
      temperature: 0.2,
      responseSchema: {
        name: "object_folders",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            folders: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  item_indexes: { type: "array", items: { type: "number" } },
                },
                required: ["name", "item_indexes"],
              },
            },
          },
          required: ["folders"],
        },
      },
      fallback: { folders: [] },
    });
  } catch (err) {
    console.warn("[auto-folder] llm failed (soft):", err);
    return NextResponse.json({ assignments: {}, folders: [] });
  }

  // index → folder name, then persist subsystem for the in-scope cards only.
  const assignments: Record<string, string> = {};
  const folderNames = new Set<string>();
  for (const f of result.folders ?? []) {
    const name = String(f?.name ?? "").trim().slice(0, 40);
    if (!name) continue;
    folderNames.add(name);
    for (const idx of f?.item_indexes ?? []) {
      const id = idByIndex[Math.round(Number(idx))];
      if (id && refileSet.has(id)) assignments[id] = name;
    }
  }

  await Promise.all(
    Object.entries(assignments).map(([id, folder]) =>
      setObjectSubsystem(db, id, folder),
    ),
  );

  return NextResponse.json({
    assignments,
    folders: Array.from(folderNames),
    count: Object.keys(assignments).length,
  });
}

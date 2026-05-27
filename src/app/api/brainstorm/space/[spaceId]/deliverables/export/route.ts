// ── GET /api/brainstorm/space/[spaceId]/deliverables/export ───────
//
// Bulk markdown bundle for an Objective Canvas — concatenates every
// elected variation's three artifacts (description doc, HTML mockup,
// export prompt) into one document the user can paste into ChatGPT /
// Claude or save as .md.
//
// Only includes variations that pass all 5 auto-gen gates (ready=true).
// Variations that are elected but missing prereqs are omitted from
// the bundle — the strip already nags the user about those.
//
// Sets Content-Disposition: attachment so the browser downloads.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { getElectedReadyVariations } from "@/lib/objective-canvas/elected-ready-variations";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Re-fetch ready rows AND the full variation payloads in parallel.
  // We need the actual doc/mockup/prompt strings, not just presence
  // flags from the aggregator.
  const rows = await getElectedReadyVariations({
    db,
    spaceId,
    userId: auth.user.id,
    includeNotReady: false,
  });

  // Pull all entity blobs in one batch — JSONB read is cheap, much
  // less work than per-row queries.
  const entityIds = Array.from(new Set(rows.map((r) => r.entity_id)));
  let entityById = new Map<
    string,
    {
      id: string;
      name: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expanded_detail: any;
    }
  >();
  if (entityIds.length > 0) {
    const { data: ents } = await db
      .from("entities")
      .select("id, name, expanded_detail")
      .in("id", entityIds);
    for (const e of (ents ?? []) as Array<{
      id: string;
      name: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expanded_detail: any;
    }>) {
      entityById.set(e.id, e);
    }
  }

  // ── Compose the bundle ──
  const objective: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "(no objective text)";
  const now = new Date().toISOString();
  const lines: string[] = [];

  lines.push(`# Canvas Deliverables Bundle`);
  lines.push("");
  lines.push(`Generated: ${now}`);
  lines.push("");
  lines.push(`## Objective`);
  lines.push("");
  lines.push(objective);
  lines.push("");
  lines.push(
    `This bundle contains ${rows.length} elected variation${rows.length === 1 ? "" : "s"} across the canvas. For each, you'll find the description doc, the HTML interface mockup, and the ready-to-paste AI prompt. Paste this whole file into Claude / ChatGPT to brief them with full context.`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // Group rows by room so the user reads "everything from Room X
  // together" rather than interleaved.
  const byRoom = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byRoom.get(r.sub_objective_id) ?? [];
    list.push(r);
    byRoom.set(r.sub_objective_id, list);
  }

  for (const [, list] of byRoom.entries()) {
    if (list.length === 0) continue;
    const first = list[0];
    lines.push(`## Room: ${first.sub_objective_title}`);
    lines.push("");

    for (const r of list) {
      const ent = entityById.get(r.entity_id);
      const detail = (ent?.expanded_detail ?? null) as
        | {
            variations?: Array<{
              id?: string;
              name?: string;
              description?: string;
              description_doc?: string;
              mockup_html?: string;
              export_prompt?: string;
            }>;
          }
        | null;
      const v = detail?.variations?.find((vv) => vv.id === r.variation_id);
      if (!v) continue;

      lines.push(`### ${v.name ?? r.variation_name}`);
      lines.push("");
      lines.push(`Mechanism: **${r.entity_name}**`);
      if (typeof r.effectiveness_score === "number") {
        lines.push(
          `Effectiveness score: ${(r.effectiveness_score * 100).toFixed(0)}/100${r.evaluation_method ? ` · method: ${r.evaluation_method}` : ""}`,
        );
      }
      lines.push("");

      if (typeof v.description === "string" && v.description.length > 0) {
        lines.push(`> ${v.description}`);
        lines.push("");
      }

      // Description doc (Op A) — full PR/FAQ markdown.
      if (typeof v.description_doc === "string" && v.description_doc.length > 0) {
        lines.push(`#### Description doc`);
        lines.push("");
        lines.push(v.description_doc);
        lines.push("");
      }

      // Mockup (Phase 12) — fence as html so consumers can render it.
      if (typeof v.mockup_html === "string" && v.mockup_html.length > 0) {
        lines.push(`#### Interface mockup (HTML)`);
        lines.push("");
        lines.push("```html");
        lines.push(v.mockup_html);
        lines.push("```");
        lines.push("");
      }

      // Export prompt (Phase 13 / Op B) — the ready-to-paste artifact.
      if (typeof v.export_prompt === "string" && v.export_prompt.length > 0) {
        lines.push(`#### AI export prompt`);
        lines.push("");
        lines.push("```markdown");
        lines.push(v.export_prompt);
        lines.push("```");
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }
  }

  const body = lines.join("\n");
  // Build a tidy filename: canvas-deliverables-YYYY-MM-DD.md.
  const datePart = now.slice(0, 10);
  const filename = `canvas-deliverables-${datePart}.md`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

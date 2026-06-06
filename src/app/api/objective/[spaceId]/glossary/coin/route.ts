// ── POST /api/objective/[spaceId]/glossary/coin ────────────────────
//
// The "coinage moment" endpoint — the act that converts an AI-extracted
// concept into the user's OWN vocabulary. Called from:
//   - SourcesView (rail) chip "Coin" button
//   - ImageEvidencePanel (drawer) "Coin this" affordance
//   - Future: any AI-surfaced term chip in any surface
//
// Idempotent on concept_slug — re-coining updates the term in place
// rather than duplicating. Sets source='user' + pinned=true so the
// next regenerate pass never overwrites it.
//
// Body:
//   {
//     term: string,                       // user-facing label
//     definition: string,                 // canonical meaning
//     conceptSlug: string,                // cross-surface join key
//     layerTag?: string,                  // optional pain/feature/outcome
//     aliases?: string[],                 // additional surface forms
//     // Provenance trail (preserved in synthesis_data so future glossary
//     // surfaces can render "from your image: foo.png" affordance):
//     sourceIngestedFileId?: string,
//     sourcePhrase?: string,
//   }
//
// Stores into spaces.synthesis_data.glossary (JSONB) — same home as the
// rest of the glossary; merge-don't-clobber.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { slugifyConcept } from "@/lib/objective-canvas/normalize-annotations";
import {
  asGlossaryKind,
  type GlossaryTerm,
  type GlossaryKind,
} from "@/lib/objective-canvas/generate-glossary";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ spaceId: string }>;
}

interface CoinBody {
  term?: string;
  definition?: string;
  conceptSlug?: string;
  layerTag?: string | null;
  aliases?: string[];
  /** Grammatical category (entity/operation/quality/pattern/role/
   *  constraint/outcome). Lets the user categorize on coin instead of
   *  forcing a follow-up PATCH. Coerced to null if invalid. */
  kind?: GlossaryKind | null;
  sourceIngestedFileId?: string;
  sourcePhrase?: string;
}

/** Glossary v2 row with the additive coinage-provenance fields. The base
 *  GlossaryTerm interface doesn't carry coined_from_*; we extend it here
 *  rather than mutate the interface (other writers/readers don't need
 *  these fields). The JSONB blob holds whatever we put in it. */
interface CoinedGlossaryTerm extends GlossaryTerm {
  coined_from_image_id?: string;
  coined_from_phrase?: string;
  coined_at?: string;
}

function readGlossary(synthesisData: unknown): CoinedGlossaryTerm[] {
  if (!synthesisData || typeof synthesisData !== "object") return [];
  const g = (synthesisData as Record<string, unknown>).glossary;
  if (!Array.isArray(g)) return [];
  return g.filter(
    (t): t is CoinedGlossaryTerm =>
      t !== null &&
      typeof t === "object" &&
      typeof (t as { term?: unknown }).term === "string",
  );
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { spaceId } = await ctx.params;

  const { data: body, error: parseErr } = await safeJsonParse<CoinBody>(req);
  if (parseErr) return parseErr;

  const term = typeof body?.term === "string" ? body.term.trim() : "";
  const definition =
    typeof body?.definition === "string" ? body.definition.trim() : "";
  if (!term || !definition) {
    return NextResponse.json(
      { error: "term + definition required" },
      { status: 400 },
    );
  }
  // Derive slug from body when omitted; ensures the cross-surface join
  // key is always present even if a caller forgets to send it.
  const conceptSlug =
    (typeof body?.conceptSlug === "string" && body.conceptSlug.trim()) ||
    slugifyConcept(term);
  if (!conceptSlug) {
    return NextResponse.json(
      { error: "could not derive concept_slug" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const glossary = readGlossary(space.synthesis_data);
  const now = new Date().toISOString();

  // Match by concept_slug first (the strong, stable identity), fall back
  // to a case-insensitive term match for legacy rows that don't have a
  // slug yet.
  const idx = glossary.findIndex((t) => {
    const slug =
      (typeof t.concept_slug === "string" && t.concept_slug) ||
      slugifyConcept(t.term);
    if (slug === conceptSlug) return true;
    return t.term.toLowerCase() === term.toLowerCase();
  });

  const aliases = Array.isArray(body?.aliases)
    ? body!.aliases!.filter((a): a is string => typeof a === "string").slice(0, 8)
    : [];

  // Kind precedence: explicit body.kind wins; otherwise preserve the
  // existing row's kind (if any); otherwise null. The user can coin
  // and classify in one tap.
  const requestedKind = body?.kind !== undefined ? asGlossaryKind(body.kind) : undefined;
  const nextKind =
    requestedKind !== undefined
      ? requestedKind
      : idx >= 0
        ? (glossary[idx].kind ?? null)
        : null;

  const next: CoinedGlossaryTerm = {
    ...(idx >= 0 ? glossary[idx] : {}),
    term: term.slice(0, 80),
    definition: definition.slice(0, 320),
    aliases:
      aliases.length > 0 ? aliases : idx >= 0 ? glossary[idx].aliases ?? [] : [],
    source: "user",
    pinned: true,
    kind: nextKind,
    concept_slug: conceptSlug,
    layer_tag:
      typeof body?.layerTag === "string"
        ? body.layerTag
        : idx >= 0
          ? glossary[idx].layer_tag ?? null
          : null,
    updated_at: now,
  };
  if (typeof body?.sourceIngestedFileId === "string") {
    next.coined_from_image_id = body.sourceIngestedFileId;
  }
  if (typeof body?.sourcePhrase === "string") {
    next.coined_from_phrase = body.sourcePhrase.slice(0, 240);
  }
  if (idx < 0 || !next.coined_at) {
    next.coined_at = now;
  }

  // A coined term is the user's OWN — shed any cross-space inheritance
  // hint so it stops reading as "inherited from <App>".
  delete (next as { cross_space_origin?: unknown }).cross_space_origin;
  delete (next as { cross_space_origin_title?: unknown }).cross_space_origin_title;

  if (idx >= 0) {
    glossary[idx] = next;
  } else {
    glossary.push(next);
  }

  const nextSynthesis: Record<string, unknown> = {
    ...((space.synthesis_data as Record<string, unknown> | null) ?? {}),
    glossary,
  };
  const { error: updateErr } = await db
    .from("spaces")
    .update({ synthesis_data: nextSynthesis })
    .eq("id", spaceId);
  if (updateErr) {
    return NextResponse.json(
      { error: "persist failed", detail: updateErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ term: next, coined: idx < 0 });
}

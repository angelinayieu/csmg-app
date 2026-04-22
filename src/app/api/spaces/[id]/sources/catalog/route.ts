// GET /api/spaces/[id]/sources/catalog
//
// Phase 2D — unified "Sources" catalog powering the library's
// external-inputs folder. Merges three real data streams with a
// static list of integration placeholders:
//
//   1. evidence_items        (from deep-research runs)
//   2. external entities     (knowledge_layer = "external")
//   3. integration providers (static — Gmail, Slack, Drive, …)
//
// The static integration tiles show provider name + status. Their
// status is currently always "coming_soon" — we haven't shipped
// OAuth. Once `user_integrations` lands, we'll swap the static
// list for a query against that table and flip status to either
// "connected" or "available".
//
// A future follow-up will add "ingested_files" as a fourth stream
// once /api/ingest starts persisting uploaded files.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { Space, Entity } from "@/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export type SourceType =
  | "evidence"
  | "external_entity"
  | "file"
  | "url"
  | "integration_placeholder";

export type IntegrationProvider =
  | "gmail"
  | "slack"
  | "drive"
  | "notion"
  | "github"
  | "apple_notes"
  | "arxiv"
  | "web"
  | "file_upload";

export interface SourceCatalogEntry {
  id: string;
  space_id: string;
  type: SourceType;
  title: string;
  snippet: string;
  url: string | null;
  domain: string | null;
  provider: IntegrationProvider;
  /** "connected" for working providers, "coming_soon" for placeholders,
   *  "available" for providers a user could connect but hasn't. */
  status: "connected" | "available" | "coming_soon";
  /** 0-1 from evidence_items.reliability_prior; null for non-evidence. */
  reliability: number | null;
  created_at: string | null;
  /** Count of items associated with this provider — only meaningful
   *  on integration_placeholder rows so the UI can say "12 items". */
  item_count?: number;
  /** Hex accent used by the drawer + the source-card shape. Provider-
   *  branded when known; generic gray otherwise. */
  accent: string;
}

export interface SourcesCatalogResponse {
  sources: SourceCatalogEntry[];
  /** Integration tiles (always first in sources[], but also exposed
   *  separately so the UI can render a header grid cleanly). */
  integrations: SourceCatalogEntry[];
  /** Real ingested content (evidence + external entities). */
  items: SourceCatalogEntry[];
  computed_at: string;
  space_name: string;
}

// ── Integration placeholder catalog ───────────────────────────────
//
// Static for now. Each entry renders as an empty-state tile with a
// Connect button that currently does nothing (status: coming_soon).
// Brand colors calibrated so the tiles have identity without being
// loud on a white drawer.

interface IntegrationDef {
  provider: IntegrationProvider;
  label: string;
  tagline: string;
  accent: string;
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    provider: "gmail",
    label: "Gmail",
    tagline: "Threads, messages, attachments.",
    accent: "#EA4335",
  },
  {
    provider: "slack",
    label: "Slack",
    tagline: "Channels, DMs, threads.",
    accent: "#4A154B",
  },
  {
    provider: "drive",
    label: "Google Drive",
    tagline: "Docs, sheets, PDFs.",
    accent: "#1A73E8",
  },
  {
    provider: "notion",
    label: "Notion",
    tagline: "Pages, databases, blocks.",
    accent: "#000000",
  },
  {
    provider: "github",
    label: "GitHub",
    tagline: "Issues, PRs, code.",
    accent: "#24292E",
  },
  {
    provider: "apple_notes",
    label: "Apple Notes",
    tagline: "iCloud notes + Spotlight.",
    accent: "#F5A623",
  },
  {
    provider: "arxiv",
    label: "arXiv",
    tagline: "Papers by topic or author.",
    accent: "#B31B1B",
  },
  {
    provider: "file_upload",
    label: "Upload file",
    tagline: "PDF, DOCX, image, or URL.",
    accent: "#64748B",
  },
];

function accentForProvider(p: IntegrationProvider): string {
  const def = INTEGRATIONS.find((i) => i.provider === p);
  return def?.accent ?? "#64748B";
}

function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Classify an external entity into an integration provider based on
 * its source metadata. Best-effort heuristic — future improvement:
 * store provider explicitly on the entity row.
 */
function inferProviderFromEntity(e: Entity): IntegrationProvider {
  const provenance = (e as unknown as { provenance?: unknown }).provenance;
  const source_url =
    provenance &&
    typeof provenance === "object" &&
    "source_url" in provenance &&
    typeof (provenance as { source_url?: unknown }).source_url === "string"
      ? ((provenance as { source_url: string }).source_url as string)
      : null;

  if (!source_url) return "web";
  const domain = domainFromUrl(source_url)?.toLowerCase() ?? "";
  if (domain.includes("arxiv")) return "arxiv";
  if (domain.includes("drive.google") || domain.includes("docs.google"))
    return "drive";
  if (domain.includes("notion")) return "notion";
  if (domain.includes("github")) return "github";
  if (domain.includes("slack")) return "slack";
  if (domain.includes("mail.google") || domain.includes("gmail"))
    return "gmail";
  return "web";
}

export async function GET(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [spaceRes, evidenceRes, externalEntitiesRes] = await Promise.all([
    db
      .from("spaces")
      .select("id, name, user_id")
      .eq("id", spaceId)
      .maybeSingle(),
    db
      .from("evidence_items")
      .select(
        "id, url, title, quote, source_type, reliability_prior, recency_score, published_at, created_at",
      )
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("entities")
      .select("*")
      .eq("space_id", spaceId)
      .eq("knowledge_layer", "external")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (!spaceRes?.data) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if ((spaceRes.data as Space).user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const spaceName = (spaceRes.data as Space).name;
  const evidence = (evidenceRes.data ?? []) as Array<{
    id: string;
    url: string | null;
    title: string | null;
    quote: string | null;
    source_type: string | null;
    reliability_prior: number | null;
    recency_score: number | null;
    published_at: string | null;
    created_at: string | null;
  }>;
  const externalEntities = (externalEntitiesRes.data ?? []) as Entity[];

  // ── Evidence items → SourceCatalogEntry ─────────────────────────
  const evidenceEntries: SourceCatalogEntry[] = evidence.map((e) => {
    const domain = domainFromUrl(e.url);
    const provider: IntegrationProvider = domain?.includes("arxiv")
      ? "arxiv"
      : "web";
    return {
      id: `evidence:${e.id}`,
      space_id: spaceId,
      type: "evidence",
      title: e.title ?? domain ?? "Untitled source",
      snippet: (e.quote ?? "").slice(0, 240),
      url: e.url,
      domain,
      provider,
      status: "connected",
      reliability: e.reliability_prior,
      created_at: e.created_at,
      accent: accentForProvider(provider),
    };
  });

  // ── External entities → SourceCatalogEntry ──────────────────────
  const entityEntries: SourceCatalogEntry[] = externalEntities.map((e) => {
    const provider = inferProviderFromEntity(e);
    const provenance = (e as unknown as { provenance?: unknown }).provenance;
    const source_url =
      provenance &&
      typeof provenance === "object" &&
      "source_url" in provenance
        ? ((provenance as { source_url?: unknown }).source_url as
            | string
            | undefined)
        : null;
    return {
      id: `entity:${e.id}`,
      space_id: spaceId,
      type: "external_entity",
      title: e.name,
      snippet: (e.description ?? "").slice(0, 240),
      url: source_url ?? null,
      domain: domainFromUrl(source_url),
      provider,
      status: "connected",
      reliability: null,
      created_at: (e as unknown as { created_at?: string | null }).created_at ??
        null,
      accent: accentForProvider(provider),
    };
  });

  // ── Integration placeholders ────────────────────────────────────
  //
  // Counts reflect items in THIS space that match the provider, so
  // "Gmail · 0 items" prompts the user to connect; "Web · 14" tells
  // them they've already ingested web sources.
  const countsByProvider = new Map<IntegrationProvider, number>();
  for (const item of [...evidenceEntries, ...entityEntries]) {
    countsByProvider.set(
      item.provider,
      (countsByProvider.get(item.provider) ?? 0) + 1,
    );
  }
  const integrationEntries: SourceCatalogEntry[] = INTEGRATIONS.map(
    (def) => ({
      id: `integration:${def.provider}`,
      space_id: spaceId,
      type: "integration_placeholder",
      title: def.label,
      snippet: def.tagline,
      url: null,
      domain: null,
      provider: def.provider,
      status: "coming_soon",
      reliability: null,
      created_at: null,
      item_count: countsByProvider.get(def.provider) ?? 0,
      accent: def.accent,
    }),
  );

  // Merge: integrations first (anchor the folder), then items sorted
  // by recency. Drawer consumers can split on `type` if they want
  // distinct treatments (grid for integrations, list for items).
  const items = [...evidenceEntries, ...entityEntries].sort((a, b) => {
    const at = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bt - at;
  });

  const payload: SourcesCatalogResponse = {
    sources: [...integrationEntries, ...items],
    integrations: integrationEntries,
    items,
    computed_at: new Date().toISOString(),
    space_name: spaceName,
  };
  return NextResponse.json(payload);
}

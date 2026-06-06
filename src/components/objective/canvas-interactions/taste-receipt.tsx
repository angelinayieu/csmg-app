"use client";

// ── TasteReceipt — the primitive that shows under every AI output ───
//
// "Honored: edge-layer · cache-miss · resilient
//  From: [thumb] architecture.png"
//
// The receipt strip. Tells the user which pieces of their substrate
// shaped a given AI output — the cited testimony, not a guess. Drop
// it under any AI-generated text (card body, brief section, plan
// step) and it self-renders.
//
// Modes:
//   1. Inferred (default): scans `text` against the space glossary
//      (word-boundary match) and the image-concept index by slug. No
//      LLM cooperation needed — works on any AI output.
//   2. Asserted (when `hits` is passed): the upstream LLM returned a
//      structured `taste_hits` array; we render exactly those, no
//      text-matching. This is the future state once the prompts are
//      updated to emit their citations.
//
// Self-contained: fetches its own glossary + image-concept index
// against /api/brainstorm/space/[id]/glossary and
// /api/objective/[id]/image-concepts. Skip both fetches by passing the
// preloaded versions via props.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { Sparkles, ImageIcon } from "@/lib/cute-icons";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { slugifyConcept } from "@/lib/objective-canvas/normalize-annotations";
import { OPEN_CARD_DETAIL_EVENT } from "./object-detail-drawer";
import type { ImageConceptRow } from "@/app/api/objective/[spaceId]/image-concepts/route";

export interface TasteReceiptTerm {
  term: string;
  aliases?: string[];
  provenance?: "yours" | "grounded" | "ai";
  definition?: string;
  concept_slug?: string;
}

export interface TasteReceiptHitAsserted {
  /** A concept slug the upstream agent claims to have honored. */
  concept_slug: string;
  /** Optional verbatim term — falls back to the resolved glossary entry. */
  term?: string;
}

interface Props {
  /** The AI-output text. Used for inferred mode (word-boundary match
   *  against glossary terms + aliases). Pass empty to skip text match. */
  text: string;
  spaceId: string;
  /** Pre-loaded glossary. When omitted, fetched once on mount. */
  glossary?: TasteReceiptTerm[];
  /** Pre-loaded image-concept index. When omitted, fetched once on mount. */
  imageIndex?: ImageConceptRow[];
  /** Asserted mode — render exactly these slugs as honored terms. */
  hits?: TasteReceiptHitAsserted[];
  /** Cap chip count. Default 6. */
  maxTerms?: number;
  /** Visual variant — "strip" = thin under-output line; "panel" = card. */
  variant?: "strip" | "panel";
}

interface InferredHit {
  term: string;
  conceptSlug: string;
  provenance: "yours" | "grounded" | "ai";
  /** Source images this concept came from (slug match against image_concepts). */
  imageThumbs: Array<{
    ingestedFileId: string;
    name: string;
    thumbUrl: string | null;
  }>;
}

/** Word-boundary match — same discipline as tasteHitsFor in the drawer. */
function isWordBoundaryHit(hay: string, needle: string): boolean {
  const i = hay.indexOf(needle);
  if (i === -1) return false;
  const before = i === 0 ? " " : hay[i - 1];
  const after = i + needle.length >= hay.length ? " " : hay[i + needle.length];
  return /[^a-z0-9]/.test(before) && /[^a-z0-9]/.test(after);
}

export function TasteReceipt({
  text,
  spaceId,
  glossary: glossaryProp,
  imageIndex: imageIndexProp,
  hits,
  maxTerms = 6,
  variant = "strip",
}: Props) {
  const [glossary, setGlossary] = useState<TasteReceiptTerm[]>(
    glossaryProp ?? [],
  );
  const [imageIndex, setImageIndex] = useState<ImageConceptRow[]>(
    imageIndexProp ?? [],
  );

  // Fetch glossary if not provided.
  useEffect(() => {
    if (glossaryProp) return;
    let cancelled = false;
    fetch(`/api/brainstorm/space/${spaceId}/glossary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        if (Array.isArray(j.glossary)) setGlossary(j.glossary);
      })
      .catch(() => {
        /* soft */
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId, glossaryProp]);

  // Fetch image-concept index if not provided.
  useEffect(() => {
    if (imageIndexProp) return;
    let cancelled = false;
    fetch(`/api/objective/${spaceId}/image-concepts`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        if (Array.isArray(j.images)) setImageIndex(j.images);
      })
      .catch(() => {
        /* soft */
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId, imageIndexProp]);

  // Build slug → images map once per imageIndex change.
  const slugToImages = useMemo(() => {
    const m = new Map<
      string,
      Array<{ ingestedFileId: string; name: string; thumbUrl: string | null }>
    >();
    for (const img of imageIndex) {
      for (const c of img.concepts) {
        const arr = m.get(c.conceptSlug) ?? [];
        arr.push({
          ingestedFileId: img.ingestedFileId,
          name: img.sourceName ?? "Image",
          thumbUrl: img.imageUrl,
        });
        m.set(c.conceptSlug, arr);
      }
    }
    return m;
  }, [imageIndex]);

  // Compute hits — asserted path wins.
  const finalHits: InferredHit[] = useMemo(() => {
    if (hits && hits.length > 0) {
      // Asserted: resolve each slug against glossary; otherwise fall back to term.
      const out: InferredHit[] = [];
      const seen = new Set<string>();
      for (const h of hits) {
        if (!h.concept_slug || seen.has(h.concept_slug)) continue;
        seen.add(h.concept_slug);
        const g = glossary.find(
          (t) =>
            t.concept_slug === h.concept_slug ||
            slugifyConcept(t.term) === h.concept_slug,
        );
        const term = g?.term ?? h.term ?? h.concept_slug;
        const provenance = g?.provenance ?? "ai";
        out.push({
          term,
          conceptSlug: h.concept_slug,
          provenance,
          imageThumbs: slugToImages.get(h.concept_slug) ?? [],
        });
        if (out.length >= maxTerms) break;
      }
      return out;
    }

    // Inferred: word-boundary match against glossary terms + aliases.
    if (!text || !text.trim() || glossary.length === 0) return [];
    const hay = text.toLowerCase();
    const out: InferredHit[] = [];
    const seenTerm = new Set<string>();
    for (const t of glossary) {
      if (!t.term) continue;
      if (t.provenance === "ai" || !t.provenance) continue; // user-shaped only
      const surfaces = [t.term, ...(t.aliases ?? [])]
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const hit = surfaces.some((s) => isWordBoundaryHit(hay, s));
      const key = t.term.toLowerCase();
      if (hit && !seenTerm.has(key)) {
        seenTerm.add(key);
        const slug = t.concept_slug ?? slugifyConcept(t.term);
        out.push({
          term: t.term,
          conceptSlug: slug,
          provenance: t.provenance,
          imageThumbs: slug ? slugToImages.get(slug) ?? [] : [],
        });
        if (out.length >= maxTerms) break;
      }
    }
    return out;
  }, [hits, text, glossary, slugToImages, maxTerms]);

  if (finalHits.length === 0) return null;

  // Distinct images (dedupe across hits — one image is one chip even if
  // it contributed multiple concepts).
  const imageDedupe = new Map<
    string,
    { ingestedFileId: string; name: string; thumbUrl: string | null }
  >();
  for (const h of finalHits) {
    for (const t of h.imageThumbs) {
      if (!imageDedupe.has(t.ingestedFileId)) imageDedupe.set(t.ingestedFileId, t);
    }
  }
  const imageStrip = Array.from(imageDedupe.values()).slice(0, 4);

  const isPanel = variant === "panel";
  return (
    <div style={isPanel ? wrapperPanel : wrapperStrip}>
      <div style={lineStyle}>
        <Sparkles
          style={{
            width: 11,
            height: 11,
            color: appleVibe.accent.primary,
            flexShrink: 0,
          }}
          strokeWidth={2.4}
        />
        <span style={lineLabel}>Honored</span>
        <div style={chipWrap}>
          {finalHits.map((h) => (
            <TermChip key={h.conceptSlug + h.term} hit={h} />
          ))}
        </div>
      </div>
      {imageStrip.length > 0 && (
        <div style={lineStyle}>
          <ImageIcon
            style={{
              width: 11,
              height: 11,
              color: appleVibe.text.tertiary,
              flexShrink: 0,
            }}
            strokeWidth={2.4}
          />
          <span style={lineLabel}>From</span>
          <div style={thumbRow}>
            {imageStrip.map((t) => (
              <SourceThumb key={t.ingestedFileId} thumb={t} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TermChip({ hit }: { hit: InferredHit }) {
  const openConcept = useCallback(() => {
    // Reuse the existing drawer-open mechanism by dispatching on the
    // concept-slug-keyed event. The drawer resolves to whichever
    // library_object has this slug (context_concept lands when image
    // was the source).
    if (!hit.conceptSlug) return;
    window.dispatchEvent(
      new CustomEvent(OPEN_CARD_DETAIL_EVENT, {
        // Drawer accepts { objectId } primarily — if we know the slug
        // only, host listeners can resolve it. For now, dispatch the
        // term as a hint; surfaces that need exact navigation pass
        // pre-resolved objectIds via `hits`.
        detail: { conceptSlug: hit.conceptSlug, term: hit.term },
      }),
    );
  }, [hit.conceptSlug, hit.term]);

  const palette =
    hit.provenance === "yours"
      ? { bg: appleVibe.accent.primary, fg: appleVibe.text.onAccent }
      : hit.provenance === "grounded"
        ? { bg: appleVibe.surface.chip, fg: appleVibe.text.primary }
        : { bg: appleVibe.surface.chip, fg: appleVibe.text.tertiary };

  return (
    <button
      type="button"
      onClick={openConcept}
      title={
        hit.provenance === "yours"
          ? "Your coined term"
          : hit.provenance === "grounded"
            ? "Grounded by your sources"
            : "AI-suggested"
      }
      style={{
        ...chipStyle,
        background: palette.bg,
        color: palette.fg,
      }}
    >
      {hit.term}
    </button>
  );
}

function SourceThumb({
  thumb,
}: {
  thumb: { ingestedFileId: string; name: string; thumbUrl: string | null };
}) {
  if (!thumb.thumbUrl) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumb.thumbUrl}
      alt={thumb.name}
      title={thumb.name}
      style={thumbStyle}
    />
  );
}

// ── styles ──────────────────────────────────────────────────────────

const wrapperStrip: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "6px 0",
  borderTop: `1px solid ${appleVibe.stroke.hairline}`,
  marginTop: 8,
};

const wrapperPanel: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 10,
  borderRadius: 12,
  background: appleVibe.surface.chip,
  border: `1px solid ${appleVibe.stroke.hairline}`,
};

const lineStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
};

const lineLabel: CSSProperties = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 600,
  color: appleVibe.text.faint,
  fontFamily: appleVibe.font.stack,
};

const chipWrap: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
};

const chipStyle: CSSProperties = {
  padding: "2px 8px",
  fontSize: 10.5,
  borderRadius: 999,
  fontFamily: appleVibe.font.stack,
  border: `1px solid ${appleVibe.stroke.hairline}`,
  cursor: "pointer",
};

const thumbRow: CSSProperties = {
  display: "flex",
  gap: 4,
};

const thumbStyle: CSSProperties = {
  width: 24,
  height: 24,
  objectFit: "cover",
  borderRadius: 6,
  border: `1px solid ${appleVibe.stroke.soft}`,
};

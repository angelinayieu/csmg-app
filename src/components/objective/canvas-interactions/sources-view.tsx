"use client";

// ── SourcesView — the "From your sources" rail panel ─────────────────
//
// First surface dedicated to INPUT objects (currently images; future:
// pasted files, voice notes, drive docs). One card per analyzed image,
// each showing its taste-aware narrative + the concept chips it
// contributed to the space's namespace.
//
// The killer interaction: every chip has a "Coin" button. Tapping it
// converts that AI-extracted concept into a USER-COINED glossary term
// — source='user' + pinned=true + provenance trail to the source image.
// That's the "coinage moment" in the UX plan: the act that turns AI
// content into the user's owned vocabulary.
//
// Soft-fail: empty state when no images / no concepts. Reads GET
// /api/objective/[spaceId]/image-concepts.

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Loader2, Sparkles, Check, RefreshCw } from "@/lib/cute-icons";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { OPEN_CARD_DETAIL_EVENT } from "./object-detail-drawer";
import type { ImageConceptRow } from "@/app/api/objective/[spaceId]/image-concepts/route";

interface Props {
  spaceId: string;
}

export function SourcesView({ spaceId }: Props) {
  const [rows, setRows] = useState<ImageConceptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [coinedSlugs, setCoinedSlugs] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/objective/${spaceId}/image-concepts`);
      if (r.ok) {
        const j = (await r.json()) as { images?: ImageConceptRow[] };
        setRows(j.images ?? []);
      }
    } catch {
      /* soft */
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && rows.length === 0) {
    return (
      <div style={loadingState}>
        <Loader2
          style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }}
          strokeWidth={2.4}
        />
        <span>Loading sources…</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div style={emptyState}>
        <Sparkles
          style={{ width: 24, height: 24, color: appleVibe.text.faint }}
          strokeWidth={2}
        />
        <div style={emptyTitle}>No sources yet</div>
        <p style={emptyHint}>
          Drop an image on the board and we&rsquo;ll analyze it — every
          discrete thing in the image becomes a chip you can{" "}
          <strong>coin</strong> into your glossary.
        </p>
      </div>
    );
  }

  return (
    <div style={listScroll}>
      <div style={listHeader}>
        <span style={listHeaderLabel}>From your images</span>
        <button
          type="button"
          onClick={() => void load()}
          style={refreshBtn}
          title="Refresh sources"
        >
          <RefreshCw style={{ width: 12, height: 12 }} strokeWidth={2.4} />
        </button>
      </div>
      {rows.map((row) => (
        <SourceCard
          key={row.ingestedFileId}
          row={row}
          spaceId={spaceId}
          coinedSlugs={coinedSlugs}
          onCoined={(slug) =>
            setCoinedSlugs((prev) => {
              const next = new Set(prev);
              next.add(slug);
              return next;
            })
          }
        />
      ))}
    </div>
  );
}

interface CardProps {
  row: ImageConceptRow;
  spaceId: string;
  coinedSlugs: Set<string>;
  onCoined: (slug: string) => void;
}

function SourceCard({ row, spaceId, coinedSlugs, onCoined }: CardProps) {
  const hasConcepts = row.concepts.length > 0;
  return (
    <div style={cardStyle}>
      <div style={cardHead}>
        {row.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.imageUrl}
            alt={row.sourceName ?? "Source image"}
            style={thumbStyle}
          />
        ) : (
          <div style={thumbPlaceholder} />
        )}
        <div style={cardHeadText}>
          {row.sourceName && (
            <div style={sourceName}>{row.sourceName}</div>
          )}
          <p style={narrative}>
            {row.narrative ?? row.description ?? "Analyzing…"}
          </p>
        </div>
      </div>
      {hasConcepts && (
        <div style={chipRow}>
          {row.concepts.map((c) => (
            <ConceptChip
              key={c.objectId}
              spaceId={spaceId}
              ingestedFileId={row.ingestedFileId}
              concept={c}
              coined={coinedSlugs.has(c.conceptSlug)}
              onCoined={() => onCoined(c.conceptSlug)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ChipProps {
  spaceId: string;
  ingestedFileId: string;
  concept: ImageConceptRow["concepts"][number];
  coined: boolean;
  onCoined: () => void;
}

function ConceptChip({
  spaceId,
  ingestedFileId,
  concept,
  coined,
  onCoined,
}: ChipProps) {
  const [busy, setBusy] = useState(false);

  const coin = useCallback(async () => {
    if (busy || coined) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/objective/${spaceId}/glossary/coin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          term: concept.title,
          definition: concept.summary ?? concept.title,
          conceptSlug: concept.conceptSlug,
          sourceIngestedFileId: ingestedFileId,
          sourcePhrase: concept.summary ?? null,
        }),
      });
      if (r.ok) onCoined();
    } catch {
      /* soft */
    } finally {
      setBusy(false);
    }
  }, [busy, coined, concept, ingestedFileId, onCoined, spaceId]);

  const openDrawer = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent(OPEN_CARD_DETAIL_EVENT, {
        detail: { objectId: concept.objectId },
      }),
    );
  }, [concept.objectId]);

  return (
    <div style={chipShell}>
      <button
        type="button"
        onClick={openDrawer}
        style={chipLabel}
        title={concept.summary ?? "Open concept"}
      >
        {concept.title}
      </button>
      <button
        type="button"
        onClick={coin}
        disabled={busy || coined}
        style={coined ? chipCoinedBtn : chipCoinBtn}
        title={
          coined
            ? "You've coined this term — it's in your glossary"
            : "Coin this — adds it to your glossary as your term"
        }
      >
        {coined ? (
          <>
            <Check style={{ width: 10, height: 10 }} strokeWidth={2.6} />
            Coined
          </>
        ) : busy ? (
          <Loader2
            style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }}
            strokeWidth={2.6}
          />
        ) : (
          <>
            <Sparkles style={{ width: 10, height: 10 }} strokeWidth={2.6} />
            Coin
          </>
        )}
      </button>
    </div>
  );
}

// ── styles ──────────────────────────────────────────────────────────

const listScroll: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "14px 14px 24px",
  overflowY: "auto",
  flex: 1,
};

const listHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  paddingBottom: 4,
};

const listHeaderLabel: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 600,
  color: appleVibe.text.tertiary,
  fontFamily: appleVibe.font.stack,
};

const refreshBtn: CSSProperties = {
  width: 22,
  height: 22,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  color: appleVibe.text.tertiary,
  cursor: "pointer",
  borderRadius: 6,
};

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 12,
  borderRadius: 14,
  background: appleVibe.surface.card,
  border: `1px solid ${appleVibe.stroke.soft}`,
  boxShadow: appleVibe.shadow.chip,
};

const cardHead: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
};

const thumbStyle: CSSProperties = {
  width: 64,
  height: 64,
  objectFit: "cover",
  borderRadius: 10,
  border: `1px solid ${appleVibe.stroke.soft}`,
  flexShrink: 0,
};

const thumbPlaceholder: CSSProperties = {
  ...thumbStyle,
  background: appleVibe.surface.chip,
};

const cardHeadText: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  minWidth: 0,
  flex: 1,
};

const sourceName: CSSProperties = {
  fontSize: 10.5,
  color: appleVibe.text.faint,
  fontFamily: appleVibe.font.stack,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const narrative: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.45,
  color: appleVibe.text.primary,
  fontFamily: appleVibe.font.stack,
};

const chipRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};

const chipShell: CSSProperties = {
  display: "inline-flex",
  alignItems: "stretch",
  gap: 1,
  borderRadius: 999,
  overflow: "hidden",
  border: `1px solid ${appleVibe.stroke.soft}`,
  background: appleVibe.surface.chip,
};

const chipLabel: CSSProperties = {
  background: "transparent",
  border: "none",
  padding: "3px 10px",
  fontSize: 11.5,
  color: appleVibe.text.primary,
  fontFamily: appleVibe.font.stack,
  cursor: "pointer",
};

const chipCoinBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  padding: "3px 8px",
  fontSize: 10.5,
  fontWeight: 600,
  color: appleVibe.text.onAccent,
  background: appleVibe.accent.primary,
  border: "none",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};

const chipCoinedBtn: CSSProperties = {
  ...chipCoinBtn,
  background: appleVibe.surface.chip,
  color: appleVibe.text.tertiary,
  cursor: "default",
};

const loadingState: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: 24,
  color: appleVibe.text.tertiary,
  fontSize: 12,
  fontFamily: appleVibe.font.stack,
};

const emptyState: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: "48px 24px",
  textAlign: "center",
};

const emptyTitle: CSSProperties = {
  fontSize: 13.5,
  fontWeight: 600,
  color: appleVibe.text.primary,
  fontFamily: appleVibe.font.stack,
};

const emptyHint: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
  color: appleVibe.text.tertiary,
  maxWidth: 280,
  fontFamily: appleVibe.font.stack,
};

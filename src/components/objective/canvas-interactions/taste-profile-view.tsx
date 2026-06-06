"use client";

// ── TasteProfileView — the rail panel for the user's taste profile ──
//
// One-page synthesis of who the user is for this objective. Five
// sections — Voice, Vocabulary, Sources, Tensions, No-gos — each
// independently pinnable + editable. Driven by GET/POST/PATCH
// /api/objective/[id]/taste-profile.
//
// Design intent: this is the surface the user reaches for to teach the
// agent who they are. Pinned sections are durable — never overwritten
// by regenerate. The "Regenerate" button refreshes everything that
// isn't pinned, plus always-refresh deterministic sections (vocabulary,
// sources).

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Loader2,
  Pencil,
  Pin,
  RefreshCw,
  Sparkles,
  Check,
} from "@/lib/cute-icons";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  TasteProfileSnapshot,
  TasteSection,
  TasteVocabEntry,
} from "@/lib/objective-canvas/taste-profile";
import { GLOSSARY_KINDS, type GlossaryKind } from "@/lib/objective-canvas/generate-glossary";

interface Props {
  spaceId: string;
}

export function TasteProfileView({ spaceId }: Props) {
  const [snap, setSnap] = useState<TasteProfileSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/objective/${spaceId}/taste-profile`, {
        cache: "no-store",
      });
      if (r.ok) {
        const j = (await r.json()) as { snapshot: TasteProfileSnapshot | null };
        setSnap(j.snapshot);
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

  const regenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      const r = await fetch(`/api/objective/${spaceId}/taste-profile`, {
        method: "POST",
      });
      if (r.ok) {
        const j = (await r.json()) as { snapshot: TasteProfileSnapshot };
        setSnap(j.snapshot);
      }
    } catch {
      /* soft */
    } finally {
      setRegenerating(false);
    }
  }, [spaceId]);

  const patchSection = useCallback(
    async (
      section: TasteSection,
      value: unknown | undefined,
      pinned?: boolean,
    ) => {
      try {
        const r = await fetch(`/api/objective/${spaceId}/taste-profile`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section, value, pinned }),
        });
        if (r.ok) {
          const j = (await r.json()) as { snapshot: TasteProfileSnapshot };
          setSnap(j.snapshot);
        }
      } catch {
        /* soft */
      }
    },
    [spaceId],
  );

  if (loading && !snap) {
    return (
      <div style={loadingState}>
        <Loader2
          style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }}
          strokeWidth={2.4}
        />
        <span>Loading taste…</span>
      </div>
    );
  }

  if (!snap || snap.thin_signal) {
    return (
      <div style={emptyState}>
        <Sparkles
          style={{ width: 24, height: 24, color: appleVibe.text.faint }}
          strokeWidth={2}
        />
        <div style={emptyTitle}>No taste profile yet</div>
        <p style={emptyHint}>
          Add an objective, drop a source, or coin a few terms — then
          generate to synthesize who you are for this work.
        </p>
        <button
          type="button"
          onClick={() => void regenerate()}
          disabled={regenerating}
          style={primaryCta}
        >
          {regenerating ? (
            <>
              <Loader2
                style={{
                  width: 12,
                  height: 12,
                  animation: "spin 1s linear infinite",
                }}
                strokeWidth={2.6}
              />
              Generating…
            </>
          ) : (
            <>
              <Sparkles style={{ width: 12, height: 12 }} strokeWidth={2.6} />
              Generate
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div style={scrollArea}>
      <div style={headerRow}>
        <div>
          <div style={pageEyebrow}>Your taste</div>
          <div style={pageTitle}>
            {snap.voice.tone || "Synthesized from your work"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void regenerate()}
          disabled={regenerating}
          style={regenBtn}
          title="Regenerate the un-pinned sections from your latest substrate"
        >
          {regenerating ? (
            <Loader2
              style={{
                width: 12,
                height: 12,
                animation: "spin 1s linear infinite",
              }}
              strokeWidth={2.6}
            />
          ) : (
            <RefreshCw style={{ width: 12, height: 12 }} strokeWidth={2.6} />
          )}
          Regenerate
        </button>
      </div>

      <VoiceSection
        voice={snap.voice}
        pinned={!!snap.pinned.voice}
        onEdit={(v) => void patchSection("voice", v)}
        onPin={(p) => void patchSection("voice", undefined, p)}
      />

      <VocabularySection vocabulary={snap.vocabulary} />

      <ListSection
        title="Tensions"
        hint="The real tradeoffs your work surfaces. Edit to override."
        items={snap.tensions}
        pinned={!!snap.pinned.tensions}
        onEdit={(items) => void patchSection("tensions", items)}
        onPin={(p) => void patchSection("tensions", undefined, p)}
      />

      <SourcesSection sources={snap.sources} />

      <ListSection
        title="No-gos"
        hint="Approaches you've ruled out — keep the agent off them."
        items={snap.no_gos}
        pinned={!!snap.pinned.no_gos}
        onEdit={(items) => void patchSection("no_gos", items)}
        onPin={(p) => void patchSection("no_gos", undefined, p)}
      />

      <div style={footerNote}>
        Last generated {timeAgo(snap.generated_at) ?? "—"}. Pinned sections
        stay yours across regenerations.
      </div>
    </div>
  );
}

// ── voice ─────────────────────────────────────────────────────────────

function VoiceSection({
  voice,
  pinned,
  onEdit,
  onPin,
}: {
  voice: { tone: string; style: string };
  pinned: boolean;
  onEdit: (v: { tone: string; style: string }) => void;
  onPin: (p: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [tone, setTone] = useState(voice.tone);
  const [style, setStyle] = useState(voice.style);
  useEffect(() => {
    if (!editing) {
      setTone(voice.tone);
      setStyle(voice.style);
    }
  }, [voice.tone, voice.style, editing]);

  return (
    <SectionShell title="Voice" pinned={pinned} onPin={onPin}>
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            placeholder="Direct, technical, MVP-first"
            style={inputStyle}
          />
          <textarea
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="A sentence or two about how you write/decide."
            rows={3}
            style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => {
                onEdit({ tone, style });
                setEditing(false);
              }}
              style={primaryCta}
            >
              <Check style={{ width: 11, height: 11 }} strokeWidth={2.6} />
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              style={ghostCta}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <p style={sectionBody}>
            {voice.style || (
              <em style={{ color: appleVibe.text.faint }}>
                No voice synthesized yet.
              </em>
            )}
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={inlineEditBtn}
          >
            <Pencil style={{ width: 10, height: 10 }} strokeWidth={2.6} />
            Edit
          </button>
        </div>
      )}
    </SectionShell>
  );
}

// ── vocabulary (deterministic — no edit) ─────────────────────────────

// Display labels for each kind. Mirrors the GLOSSARY_KINDS source-of-truth
// order so the rail reads top→bottom in the same hierarchy as the agent's
// consumption model (entities first → outcomes last).
const KIND_LABEL: Record<GlossaryKind, string> = {
  entity: "Entities",
  operation: "Operations",
  quality: "Qualities",
  pattern: "Patterns",
  role: "Roles",
  constraint: "Constraints",
  outcome: "Outcomes",
};

function VocabularySection({
  vocabulary,
}: {
  vocabulary: { coined: TasteVocabEntry[]; grounded: TasteVocabEntry[]; ai: TasteVocabEntry[] };
}) {
  const total =
    vocabulary.coined.length +
    vocabulary.grounded.length +
    vocabulary.ai.length;
  return (
    <SectionShell title="Vocabulary" subtitle={`${total} terms`}>
      <p style={vocabHint}>
        <strong>{vocabulary.coined.length} coined</strong> ·{" "}
        {vocabulary.grounded.length} grounded · {vocabulary.ai.length}{" "}
        ai-suggested
      </p>
      {vocabulary.coined.length > 0 && (
        <ProvenanceBlock label="Yours" entries={vocabulary.coined} tone="yours" />
      )}
      {vocabulary.grounded.length > 0 && (
        <ProvenanceBlock label="Grounded" entries={vocabulary.grounded} tone="grounded" />
      )}
      {vocabulary.ai.length > 0 && (
        <ProvenanceBlock label="AI" entries={vocabulary.ai} tone="ai" />
      )}
    </SectionShell>
  );
}

/** A provenance block sub-grouped by kind. Each kind renders as its own
 *  small chip row with the kind label as a quiet header. Un-classified
 *  entries (kind=null) collect into a final "Other" group so nothing is
 *  silently hidden. */
function ProvenanceBlock({
  label,
  entries,
  tone,
}: {
  label: string;
  entries: TasteVocabEntry[];
  tone: "yours" | "grounded" | "ai";
}) {
  // Group by kind, preserving the canonical kind order. Un-classified
  // entries collect under "other" — rendered last.
  const byKind = new Map<GlossaryKind | "other", string[]>();
  for (const e of entries) {
    const key: GlossaryKind | "other" = e.kind ?? "other";
    const arr = byKind.get(key) ?? [];
    arr.push(e.term);
    byKind.set(key, arr);
  }
  // Build ordered groups: known kinds first (in canonical order), then "other".
  const ordered: Array<{ key: GlossaryKind | "other"; label: string; terms: string[] }> = [];
  for (const k of GLOSSARY_KINDS) {
    const terms = byKind.get(k);
    if (terms && terms.length > 0) ordered.push({ key: k, label: KIND_LABEL[k], terms });
  }
  const other = byKind.get("other");
  if (other && other.length > 0) ordered.push({ key: "other", label: "Other", terms: other });

  return (
    <div style={{ marginTop: 8 }}>
      <div style={chipRowLabel}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
        {ordered.map((g) => (
          <KindChipRow key={g.key} label={g.label} terms={g.terms} tone={tone} />
        ))}
      </div>
    </div>
  );
}

function KindChipRow({
  label,
  terms,
  tone,
}: {
  label: string;
  terms: string[];
  tone: "yours" | "grounded" | "ai";
}) {
  const palette =
    tone === "yours"
      ? { bg: appleVibe.accent.primary, fg: appleVibe.text.onAccent }
      : tone === "grounded"
        ? { bg: appleVibe.surface.chip, fg: appleVibe.text.primary }
        : { bg: appleVibe.surface.chip, fg: appleVibe.text.tertiary };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={kindGroupLabel}>{label}</span>
      <div style={chipWrap}>
        {terms.map((t) => (
          <span
            key={t}
            style={{
              ...chipStyle,
              background: palette.bg,
              color: palette.fg,
            }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── sources (deterministic) ──────────────────────────────────────────

function SourcesSection({
  sources,
}: {
  sources: TasteProfileSnapshot["sources"];
}) {
  if (sources.length === 0) {
    return (
      <SectionShell title="Sources" subtitle="0">
        <p style={emptyHint}>
          Drop an image to add a source. Its concepts will appear here.
        </p>
      </SectionShell>
    );
  }
  return (
    <SectionShell title="Sources" subtitle={`${sources.length}`}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {sources.map((s) => (
          <div key={s.ingestedFileId} style={sourceTile} title={s.name}>
            {s.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.thumbUrl} alt={s.name} style={sourceThumb} />
            ) : (
              <div style={{ ...sourceThumb, background: appleVibe.surface.chip }} />
            )}
            <div style={sourceCaption}>{s.name}</div>
            {s.conceptSlugs.length > 0 && (
              <div style={sourceCount}>
                +{s.conceptSlugs.length} concept
                {s.conceptSlugs.length === 1 ? "" : "s"}
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

// ── reusable list section (tensions + no-gos) ────────────────────────

function ListSection({
  title,
  hint,
  items,
  pinned,
  onEdit,
  onPin,
}: {
  title: string;
  hint: string;
  items: string[];
  pinned: boolean;
  onEdit: (next: string[]) => void;
  onPin: (p: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(items.join("\n"));
  useEffect(() => {
    if (!editing) setDraft(items.join("\n"));
  }, [items, editing]);

  return (
    <SectionShell title={title} pinned={pinned} onPin={onPin}>
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="One per line"
            rows={4}
            style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => {
                const parsed = draft
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean);
                onEdit(parsed);
                setEditing(false);
              }}
              style={primaryCta}
            >
              <Check style={{ width: 11, height: 11 }} strokeWidth={2.6} />
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              style={ghostCta}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <ul style={listStyle}>
            {items.map((t, i) => (
              <li key={i} style={listItem}>
                {t}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={inlineEditBtn}
          >
            <Pencil style={{ width: 10, height: 10 }} strokeWidth={2.6} />
            Edit
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <p style={emptyHint}>{hint}</p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={inlineEditBtn}
          >
            <Pencil style={{ width: 10, height: 10 }} strokeWidth={2.6} />
            Add
          </button>
        </div>
      )}
    </SectionShell>
  );
}

// ── section shell ────────────────────────────────────────────────────

function SectionShell({
  title,
  subtitle,
  pinned,
  onPin,
  children,
}: {
  title: string;
  subtitle?: string;
  pinned?: boolean;
  onPin?: (p: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section style={sectionStyle}>
      <header style={sectionHeader}>
        <span style={sectionTitle}>
          {title}
          {subtitle && <span style={sectionSubtitle}> · {subtitle}</span>}
        </span>
        {onPin && (
          <button
            type="button"
            onClick={() => onPin(!pinned)}
            style={pinned ? pinBtnActive : pinBtn}
            title={
              pinned
                ? "Pinned — regenerate won't overwrite"
                : "Pin to lock against regeneration"
            }
          >
            <Pin style={{ width: 10, height: 10 }} strokeWidth={2.6} />
            {pinned ? "Pinned" : "Pin"}
          </button>
        )}
      </header>
      <div style={sectionBodyWrap}>{children}</div>
    </section>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

function timeAgo(iso?: string): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diff = Date.now() - t;
  const s = Math.round(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

// ── styles ───────────────────────────────────────────────────────────

const scrollArea: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  padding: "16px 14px 28px",
  overflowY: "auto",
  flex: 1,
};

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
};

const pageEyebrow: CSSProperties = {
  fontSize: 10.5,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  fontWeight: 600,
  color: appleVibe.text.tertiary,
  fontFamily: appleVibe.font.stack,
};

const pageTitle: CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: appleVibe.text.primary,
  fontFamily: appleVibe.font.display,
  marginTop: 2,
  lineHeight: 1.3,
};

const regenBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 600,
  color: appleVibe.text.primary,
  background: appleVibe.surface.chip,
  border: `1px solid ${appleVibe.stroke.soft}`,
  borderRadius: 999,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 12,
  borderRadius: 14,
  background: appleVibe.surface.card,
  border: `1px solid ${appleVibe.stroke.soft}`,
  boxShadow: appleVibe.shadow.chip,
};

const sectionHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const sectionTitle: CSSProperties = {
  fontSize: 11.5,
  textTransform: "uppercase",
  letterSpacing: "0.09em",
  fontWeight: 600,
  color: appleVibe.text.secondary,
  fontFamily: appleVibe.font.stack,
};

const sectionSubtitle: CSSProperties = {
  fontWeight: 400,
  color: appleVibe.text.faint,
  textTransform: "none",
  letterSpacing: 0,
  fontSize: 11,
};

const sectionBodyWrap: CSSProperties = {
  marginTop: 4,
};

const sectionBody: CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.5,
  color: appleVibe.text.primary,
  fontFamily: appleVibe.font.stack,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  fontSize: 12.5,
  border: `1px solid ${appleVibe.stroke.soft}`,
  borderRadius: 8,
  background: appleVibe.surface.base,
  color: appleVibe.text.primary,
  fontFamily: appleVibe.font.stack,
  boxSizing: "border-box",
};

const inlineEditBtn: CSSProperties = {
  alignSelf: "flex-start",
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  padding: "2px 8px",
  fontSize: 10.5,
  color: appleVibe.text.tertiary,
  background: "transparent",
  border: `1px solid ${appleVibe.stroke.soft}`,
  borderRadius: 999,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
  marginTop: 4,
};

const pinBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  padding: "2px 8px",
  fontSize: 10,
  color: appleVibe.text.tertiary,
  background: "transparent",
  border: `1px solid ${appleVibe.stroke.soft}`,
  borderRadius: 999,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};

const pinBtnActive: CSSProperties = {
  ...pinBtn,
  color: appleVibe.text.onAccent,
  background: appleVibe.accent.primary,
  borderColor: appleVibe.accent.primary,
};

const primaryCta: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "5px 10px",
  fontSize: 11.5,
  fontWeight: 600,
  color: appleVibe.text.onAccent,
  background: appleVibe.accent.primary,
  border: "none",
  borderRadius: 999,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};

const ghostCta: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "5px 10px",
  fontSize: 11.5,
  fontWeight: 600,
  color: appleVibe.text.tertiary,
  background: "transparent",
  border: `1px solid ${appleVibe.stroke.soft}`,
  borderRadius: 999,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};

const vocabHint: CSSProperties = {
  margin: 0,
  fontSize: 11.5,
  color: appleVibe.text.tertiary,
  fontFamily: appleVibe.font.stack,
};

const chipRowLabel: CSSProperties = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: appleVibe.text.faint,
  marginBottom: 4,
  fontFamily: appleVibe.font.stack,
};

/** Sub-group label inside a provenance block ("Entities", "Patterns" …). */
const kindGroupLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: appleVibe.text.tertiary,
  fontFamily: appleVibe.font.stack,
};

const chipWrap: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
};

const chipStyle: CSSProperties = {
  padding: "2px 8px",
  fontSize: 11,
  borderRadius: 999,
  fontFamily: appleVibe.font.stack,
  border: `1px solid ${appleVibe.stroke.hairline}`,
};

const sourceTile: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  width: 84,
};

const sourceThumb: CSSProperties = {
  width: 84,
  height: 64,
  objectFit: "cover",
  borderRadius: 8,
  border: `1px solid ${appleVibe.stroke.soft}`,
};

const sourceCaption: CSSProperties = {
  fontSize: 10.5,
  color: appleVibe.text.secondary,
  fontFamily: appleVibe.font.stack,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const sourceCount: CSSProperties = {
  fontSize: 9.5,
  color: appleVibe.text.faint,
  fontFamily: appleVibe.font.stack,
};

const listStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 16,
  display: "flex",
  flexDirection: "column",
  gap: 3,
};

const listItem: CSSProperties = {
  fontSize: 12.5,
  lineHeight: 1.4,
  color: appleVibe.text.primary,
  fontFamily: appleVibe.font.stack,
};

const footerNote: CSSProperties = {
  marginTop: 4,
  fontSize: 10.5,
  color: appleVibe.text.faint,
  fontFamily: appleVibe.font.stack,
  textAlign: "center",
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
  fontSize: 11.5,
  lineHeight: 1.5,
  color: appleVibe.text.tertiary,
  maxWidth: 280,
  fontFamily: appleVibe.font.stack,
};

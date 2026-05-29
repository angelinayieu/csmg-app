"use client";

// ── Card Room View ────────────────────────────────────────────────
//
// The persistent, URL-addressable full page for a single PAIN or
// OUTCOME card — the "every card is a room" surface. Features already
// have their own full room (the Lab); this is the equivalent for the
// other card types, so clicking a card can expand from the quick
// drawer preview into a real place that loads on its own route.
//
// Server-rendered data in (causal_chain + expanded_detail); no client
// generation, so it loads fast and the content is stable/persistent
// rather than regenerated on each drawer open.
//
// Standalone (NEW file) on purpose: the Lab route + its view + the
// drawer are all mid-rewrite by a parallel workstream. This renders
// the room body; the route wraps it in the shared room-window shell.
// When the Lab route frees up, this folds into it (one card-room
// system), reusing the Lab for features as it does today.

import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { ExpandedItemDetail } from "@/lib/objective-canvas/expand-item-detail";

interface Props {
  spaceId: string;
  subObjectiveId: string;
  entityId: string;
  entityName: string;
  entityType: string;
  causalChain: Record<string, unknown> | null;
  expandedDetail: ExpandedItemDetail | null;
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function CardRoomView({
  entityName,
  entityType,
  causalChain,
  expandedDetail,
}: Props) {
  const cc = causalChain ?? {};
  const isPain = entityType === "pain_point";
  const isOutcome = entityType === "outcome";
  const accent = isPain
    ? appleVibe.stage.pain
    : isOutcome
      ? appleVibe.stage.outcomes
      : appleVibe.stage.features;
  const typeLabel = isPain ? "Problem" : isOutcome ? "Result" : entityType;

  const definition = str(expandedDetail?.definition);
  const negativeOutcome = str(cc.negative_outcome);
  const rootCauses = strArr(cc.root_causes);
  const measuredBy = str(cc.measured_by);
  const indicators = strArr(cc.indicators);

  const hasBody =
    !!definition ||
    (isPain && (!!negativeOutcome || rootCauses.length > 0)) ||
    (isOutcome && (!!measuredBy || indicators.length > 0));

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      {/* ── Header — title + type badge ── */}
      <header className="mb-7">
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ background: `${accent}14`, color: accent }}
        >
          {typeLabel}
        </span>
        <h1
          className="mt-2.5 text-[26px] font-semibold tracking-tight"
          style={{
            color: appleVibe.text.primary,
            fontFamily: appleVibe.font.display,
            letterSpacing: "-0.015em",
          }}
        >
          {entityName}
        </h1>
      </header>

      {!hasBody && (
        <div
          className="rounded-2xl px-6 py-10 text-center"
          style={{
            background: appleVibe.surface.card,
            border: `1px dashed ${appleVibe.stroke.medium}`,
            borderRadius: appleVibe.radius.xl,
          }}
        >
          <p
            className="text-[13px] font-light italic"
            style={{ color: appleVibe.text.tertiary }}
          >
            This card hasn&rsquo;t been expanded yet — open it in the room
            drawer to generate its detail, then it&rsquo;ll show here.
          </p>
        </div>
      )}

      {definition && (
        <Section title="Definition">
          <p
            className="text-[13px] leading-relaxed"
            style={{ color: appleVibe.text.primary }}
          >
            {definition}
          </p>
        </Section>
      )}

      {isPain && negativeOutcome && (
        <Section title="Negative outcome">
          <p
            className="text-[13px] leading-relaxed"
            style={{ color: appleVibe.text.primary }}
          >
            {negativeOutcome}
          </p>
        </Section>
      )}

      {isPain && rootCauses.length > 0 && (
        <Section title="Root causes">
          <FieldList items={rootCauses} accent={accent} />
        </Section>
      )}

      {isOutcome && measuredBy && (
        <Section title="Measured by">
          <p
            className="text-[13px] leading-relaxed"
            style={{ color: appleVibe.text.primary }}
          >
            {measuredBy}
          </p>
        </Section>
      )}

      {isOutcome && indicators.length > 0 && (
        <Section title="Proxy indicators">
          <FieldList items={indicators} accent={accent} />
        </Section>
      )}
    </main>
  );
}

// ── Building blocks ───────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2
        className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: appleVibe.text.tertiary }}
      >
        {title}
      </h2>
      <div
        className="rounded-2xl px-4 py-3"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.hairline}`,
          borderRadius: appleVibe.radius.md,
        }}
      >
        {children}
      </div>
    </section>
  );
}

function FieldList({ items, accent }: { items: string[]; accent: string }) {
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li
          key={`${i}-${it.slice(0, 24)}`}
          className="flex items-start gap-2 text-[12.5px] leading-snug"
          style={{ color: appleVibe.text.primary }}
        >
          <span
            className="mt-[6px] inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ background: accent }}
            aria-hidden
          />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

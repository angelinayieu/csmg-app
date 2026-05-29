"use client";

// ── Strategy Brief View ────────────────────────────────────────────
//
// Document-first design discipline:
//
//   • Single column, max 680px content width, generous padding.
//   • Typography does the work: tight letter-spacing on display,
//     1.65 line-height on body. Heading sizes step generously.
//   • Restrained color — slate hierarchy for 95% of the surface,
//     ONE accent for emphasis (purple), red ONLY for open conflicts,
//     green ONLY for elected. No card-on-card stacks.
//   • Print-ready: @media print hides the action bar, removes
//     backgrounds, locks color, allows page breaks between sections.
//   • Section dividers are thin rules separated by real whitespace,
//     not full-bleed cards.
//
// The user reads this like a strategy memo. The data is the design.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  Printer,
  Sparkles,
  RefreshCw,
  AlertCircle,
  ArrowUpRight,
} from "lucide-react";
import {
  renderStrategyBriefMarkdown,
  type StrategyBrief,
  type BriefRoom,
} from "@/lib/objective-canvas/build-strategy-brief";
import { IndicatorValidityMatrix } from "@/components/objective/indicator-validity-matrix";

// ── Style tokens — local to this view ──
//
// Hardcoded rather than imported from apple-vibe-tokens so the brief's
// typographic discipline can deviate from the rest of the app. The
// brief is a DOCUMENT; the app is an EDITOR. Different rules.

const COLOR = {
  ink: "rgba(15,23,42,0.92)",
  inkSoft: "rgba(15,23,42,0.72)",
  inkMuted: "rgba(15,23,42,0.55)",
  inkFaint: "rgba(15,23,42,0.40)",
  rule: "rgba(15,23,42,0.10)",
  bg: "#fafafa",
  paper: "#ffffff",
  accent: "rgba(124,58,237,0.92)", // purple
  accentSoft: "rgba(124,58,237,0.10)",
  conflict: "rgba(220,38,38,0.92)",
  conflictSoft: "rgba(220,38,38,0.06)",
  conflictBorder: "rgba(220,38,38,0.22)",
  elected: "rgba(22,163,74,0.92)",
  electedSoft: "rgba(22,163,74,0.08)",
};

const FONT = {
  display:
    'Pretendard, -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
  body:
    'Pretendard, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
};

interface Props {
  spaceId: string;
  brief: StrategyBrief;
  /** Polish exists but is stale (state_hash drifted). UI surfaces
   *  this as a soft hint so the user knows to re-polish. */
  polishStale: boolean;
}

export function StrategyBriefView({ spaceId, brief, polishStale }: Props) {
  const router = useRouter();
  const [localTldr, setLocalTldr] = useState<string | null>(brief.ai_tldr);
  const [polishing, setPolishing] = useState(false);
  const [polishError, setPolishError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset copied flag after 2s.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopy = useCallback(async () => {
    const md = renderStrategyBriefMarkdown({
      ...brief,
      ai_tldr: localTldr,
    });
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
    } catch {
      // Fallback: legacy execCommand.
      const ta = document.createElement("textarea");
      ta.value = md;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
      } catch {
        // No-op.
      }
      document.body.removeChild(ta);
    }
  }, [brief, localTldr]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handlePolish = useCallback(
    async (force = false) => {
      setPolishing(true);
      setPolishError(null);
      try {
        const res = await fetch("/api/brainstorm/space/brief/polish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spaceId,
            mode: force ? "force" : "default",
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setPolishError(json?.error ?? "Polish failed.");
          return;
        }
        if (typeof json?.tldr === "string" && json.tldr.length > 0) {
          setLocalTldr(json.tldr);
          router.refresh();
        }
      } catch (err) {
        setPolishError(
          err instanceof Error ? err.message : "Network error.",
        );
      } finally {
        setPolishing(false);
      }
    },
    [spaceId, router],
  );

  return (
    <div
      className="brief-root"
      style={{
        minHeight: "100vh",
        background: COLOR.bg,
        fontFamily: FONT.body,
      }}
    >
      <style>{PRINT_STYLES}</style>
      {/* ── Action bar (sticky, thin, prints hidden) ── */}
      <div
        className="brief-action-bar print-hide"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "rgba(250,250,250,0.92)",
          borderBottom: `1px solid ${COLOR.rule}`,
          backdropFilter: "blur(10px)",
        }}
      >
        <div
          className="mx-auto flex items-center justify-between gap-4 px-6 py-3"
          style={{ maxWidth: 940 }}
        >
          <Link
            href={`/app/objective/${spaceId}`}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium"
            style={{ color: COLOR.inkMuted }}
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} />
            Back to canvas
          </Link>
          <div className="flex items-center gap-2">
            <ActionBtn
              onClick={handleCopy}
              icon={copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              label={copied ? "Copied" : "Copy markdown"}
            />
            <ActionBtn
              onClick={() => handlePolish(polishStale)}
              icon={
                polishing ? (
                  <Sparkles className="h-3 w-3 animate-pulse" />
                ) : localTldr ? (
                  <RefreshCw className="h-3 w-3" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )
              }
              label={
                polishing
                  ? "Writing…"
                  : localTldr
                    ? polishStale
                      ? "Re-polish"
                      : "Re-polish"
                    : "Polish with AI"
              }
              accent
            />
            <ActionBtn
              onClick={handlePrint}
              icon={<Printer className="h-3 w-3" />}
              label="Print"
            />
          </div>
        </div>
      </div>

      {/* ── Document body ── */}
      <article
        className="brief-article mx-auto px-8 pb-32 pt-16"
        style={{
          maxWidth: 680,
          color: COLOR.ink,
          background: COLOR.paper,
          boxShadow: "0 1px 0 rgba(15,23,42,0.04)",
          marginTop: 32,
          marginBottom: 64,
          borderRadius: 12,
        }}
      >
        {/* ── Title block ── */}
        <header>
          <div
            className="text-[10.5px] font-semibold uppercase"
            style={{
              color: COLOR.inkFaint,
              letterSpacing: "0.18em",
            }}
          >
            Strategy Brief
          </div>
          <h1
            className="mt-3 text-[30px] font-semibold leading-[1.15]"
            style={{
              color: COLOR.ink,
              letterSpacing: "-0.022em",
              fontFamily: FONT.display,
            }}
          >
            {brief.objective_text}
          </h1>
          <div
            className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
            style={{ color: COLOR.inkMuted }}
          >
            <Caption>{plural(brief.totals.rooms, "room")}</Caption>
            <CaptionDot />
            <Caption>{plural(brief.totals.items, "item")}</Caption>
            {brief.totals.elected_variations > 0 && (
              <>
                <CaptionDot />
                <Caption>
                  {brief.totals.elected_variations} elected
                </Caption>
              </>
            )}
            {brief.totals.composed_designs > 0 && (
              <>
                <CaptionDot />
                <Caption>
                  {brief.totals.composed_designs} composed
                </Caption>
              </>
            )}
            {brief.totals.experiments_planned > 0 && (
              <>
                <CaptionDot />
                <Caption>
                  {plural(brief.totals.experiments_planned, "experiment")}
                </Caption>
              </>
            )}
            {brief.totals.expansion_nodes > 0 && (
              <>
                <CaptionDot />
                <Caption>
                  {brief.totals.expansion_nodes} deep{" "}
                  {brief.totals.expansion_nodes === 1 ? "dive" : "dives"}
                </Caption>
              </>
            )}
            {brief.totals.open_conflicts > 0 && (
              <>
                <CaptionDot />
                <Caption style={{ color: COLOR.conflict }}>
                  {plural(brief.totals.open_conflicts, "open conflict")}
                </Caption>
              </>
            )}
          </div>
        </header>

        {/* ── Executive summary (AI polish, optional) ── */}
        {localTldr && (
          <Section>
            <p
              className="text-[16px] leading-[1.65]"
              style={{
                color: COLOR.ink,
                fontFamily: FONT.body,
                fontWeight: 400,
              }}
            >
              {localTldr}
            </p>
            {polishStale && (
              <p
                className="mt-3 text-[11.5px] italic"
                style={{ color: COLOR.inkFaint }}
              >
                The state has shifted since this summary was written.
                Click <span style={{ color: COLOR.accent }}>Re-polish</span> to refresh.
              </p>
            )}
          </Section>
        )}
        {!localTldr && polishError && (
          <p
            className="mt-6 text-[12px]"
            style={{ color: COLOR.conflict }}
          >
            {polishError}
          </p>
        )}

        {/* ── Operating context ── */}
        {brief.constraints && (
          <Section>
            <SectionLabel>Operating context</SectionLabel>
            <dl
              className="mt-4 grid grid-cols-1 gap-y-2.5 sm:grid-cols-[140px_1fr]"
              style={{ rowGap: "10px" }}
            >
              <Term>Time horizon</Term>
              <Def>{TIME_LABEL[brief.constraints.time_horizon]}</Def>
              <Term>Budget</Term>
              <Def>{BUDGET_LABEL[brief.constraints.budget_tier]}</Def>
              <Term>Team</Term>
              <Def>{TEAM_LABEL[brief.constraints.team_size]}</Def>
              <Term>Risk tolerance</Term>
              <Def>{RISK_LABEL[brief.constraints.risk_tolerance]}</Def>
              {brief.constraints.compliance_requirements.length > 0 && (
                <>
                  <Term>Compliance</Term>
                  <Def>
                    {brief.constraints.compliance_requirements.join(", ")}
                  </Def>
                </>
              )}
            </dl>
          </Section>
        )}

        {/* ── Strategic threads (themes) ── */}
        {brief.themes.length > 0 && (
          <Section>
            <SectionLabel>Strategic threads</SectionLabel>
            <div className="mt-5 flex flex-col gap-7">
              {brief.themes.map((t, i) => (
                <div key={i}>
                  <h3
                    className="text-[18px] font-semibold leading-tight"
                    style={{
                      color: COLOR.ink,
                      letterSpacing: "-0.012em",
                      fontFamily: FONT.display,
                    }}
                  >
                    {t.name}
                  </h3>
                  <p
                    className="mt-2 text-[14.5px] leading-[1.6]"
                    style={{ color: COLOR.inkSoft }}
                  >
                    {t.description}
                  </p>
                  {t.why_it_recurs && (
                    <p
                      className="mt-2 text-[13.5px] italic leading-[1.6]"
                      style={{ color: COLOR.inkMuted }}
                    >
                      Why it recurs: {t.why_it_recurs}
                    </p>
                  )}
                  {t.evidence.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-1.5 pl-0">
                      {t.evidence.slice(0, 3).map((e, idx) => (
                        <li
                          key={idx}
                          className="text-[13px] italic leading-[1.55]"
                          style={{
                            color: COLOR.inkMuted,
                            paddingLeft: "1rem",
                            position: "relative",
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              position: "absolute",
                              left: 0,
                              color: COLOR.inkFaint,
                            }}
                          >
                            “
                          </span>
                          {e}
                        </li>
                      ))}
                    </ul>
                  )}
                  {t.spawned_sub_objective_id ? (
                    <Link
                      href={`/app/objective/${spaceId}/sub/${t.spawned_sub_objective_id}`}
                      className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold"
                      style={{ color: COLOR.elected }}
                    >
                      <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
                      Spawned into a room
                    </Link>
                  ) : t.room_ids.length > 0 ? (
                    <p
                      className="mt-3 text-[12px] font-light"
                      style={{ color: COLOR.inkMuted }}
                    >
                      Surfaces in {t.room_ids.length}{" "}
                      {t.room_ids.length === 1 ? "room" : "rooms"}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Sub-objectives ── */}
        {brief.rooms.length > 0 && (
          <Section>
            <SectionLabel>Sub-objectives</SectionLabel>
            <div className="mt-5 flex flex-col gap-10">
              {brief.rooms.map((r, i) => (
                <RoomBlock
                  key={r.id}
                  room={r}
                  index={i + 1}
                  spaceId={spaceId}
                />
              ))}
            </div>
          </Section>
        )}

        {/* ── Next move ── */}
        {brief.next_move && (
          <Section>
            <SectionLabel>Next move</SectionLabel>
            <p
              className="mt-4 text-[17px] font-semibold leading-[1.4]"
              style={{
                color: COLOR.ink,
                letterSpacing: "-0.008em",
                fontFamily: FONT.display,
              }}
            >
              {brief.next_move.action}
            </p>
            {brief.next_move.rationale && (
              <p
                className="mt-3 text-[14.5px] leading-[1.65]"
                style={{ color: COLOR.inkSoft }}
              >
                {brief.next_move.rationale}
              </p>
            )}
            {brief.next_move.next_steps.length > 0 && (
              <ol className="mt-5 flex flex-col gap-2">
                {brief.next_move.next_steps.map((s, idx) => (
                  <li
                    key={idx}
                    className="flex gap-3 text-[14px] leading-[1.55]"
                    style={{ color: COLOR.ink }}
                  >
                    <span
                      className="flex-shrink-0 font-mono text-[12.5px]"
                      style={{ color: COLOR.inkFaint, lineHeight: "1.55" }}
                    >
                      {idx + 1}.
                    </span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            )}
            {(brief.next_move.estimated_effort ||
              brief.next_move.what_youll_learn) && (
              <div
                className="mt-5 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px]"
                style={{ color: COLOR.inkMuted }}
              >
                {brief.next_move.estimated_effort && (
                  <span>
                    <span
                      style={{
                        color: COLOR.inkFaint,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        fontSize: "10.5px",
                        marginRight: 6,
                      }}
                    >
                      Effort
                    </span>
                    {brief.next_move.estimated_effort}
                  </span>
                )}
                {brief.next_move.what_youll_learn && (
                  <span className="italic">
                    You&rsquo;ll know: {brief.next_move.what_youll_learn}
                  </span>
                )}
              </div>
            )}
          </Section>
        )}

        {/* ── Open items ── */}
        {brief.open_items.length > 0 && (
          <Section>
            <SectionLabel>Open items</SectionLabel>
            <p
              className="mt-2 text-[12.5px] italic leading-relaxed"
              style={{ color: COLOR.inkMuted }}
            >
              Unresolved — surfaced here so they don&rsquo;t slip.
            </p>
            <ul className="mt-4 flex flex-col gap-3.5">
              {brief.open_items.map((o, i) => (
                <li key={i} className="flex gap-3">
                  <span
                    className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{
                      background:
                        o.severity === "critical" || o.severity === "high"
                          ? COLOR.conflict
                          : COLOR.inkFaint,
                    }}
                    aria-hidden
                  />
                  <div>
                    <div
                      className="text-[13.5px] font-semibold leading-[1.4]"
                      style={{ color: COLOR.ink }}
                    >
                      {o.title}
                    </div>
                    <p
                      className="mt-0.5 text-[13px] leading-[1.55]"
                      style={{ color: COLOR.inkSoft }}
                    >
                      {o.summary}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ── Footer caption — version stamp ── */}
        <div
          className="mt-20 border-t pt-6 text-[11px]"
          style={{
            borderColor: COLOR.rule,
            color: COLOR.inkFaint,
            letterSpacing: "0.04em",
          }}
        >
          Generated {formatDate(brief.generated_at)} ·{" "}
          <Link
            href={`/app/objective/${spaceId}`}
            style={{ color: COLOR.inkMuted, textDecoration: "underline" }}
          >
            return to canvas
          </Link>
        </div>
      </article>
    </div>
  );
}

// ── Room block — the per-sub-objective document section ──

function RoomBlock({
  room,
  index,
  spaceId,
}: {
  room: BriefRoom;
  index: number;
  spaceId: string;
}) {
  const allOpenConflicts = useMemo(
    () => room.composed_designs.flatMap((cd) => cd.conflicts_open),
    [room.composed_designs],
  );

  return (
    <article>
      <div className="flex items-baseline gap-3">
        <span
          className="font-mono text-[13px]"
          style={{
            color: COLOR.inkFaint,
            letterSpacing: "0.04em",
          }}
        >
          {String(index).padStart(2, "0")}
        </span>
        <h3
          className="text-[20px] font-semibold leading-tight"
          style={{
            color: COLOR.ink,
            letterSpacing: "-0.015em",
            fontFamily: FONT.display,
          }}
        >
          <Link
            href={`/app/objective/${spaceId}/sub/${room.id}`}
            style={{ color: COLOR.ink, textDecoration: "none" }}
            className="hover:underline"
          >
            {room.title}
          </Link>
        </h3>
      </div>

      {room.top_negative_outcome && (
        <p
          className="mt-2 text-[13.5px] italic leading-[1.55]"
          style={{ color: COLOR.inkMuted, paddingLeft: "calc(13px + 0.75rem)" }}
        >
          Counters{" "}
          <span style={{ color: COLOR.inkSoft, fontStyle: "normal" }}>
            “{room.top_negative_outcome}”
          </span>
        </p>
      )}

      <div
        className="mt-5"
        style={{ paddingLeft: "calc(13px + 0.75rem)" }}
      >
        {/* ── Composed designs (narrative) ── */}
        {room.composed_designs.length > 0 && (
          <div className="mb-6">
            <SubLabel>Chosen design</SubLabel>
            <div className="mt-2 flex flex-col gap-4">
              {room.composed_designs.map((cd) => (
                <div key={cd.item_id}>
                  <div
                    className="mb-1 text-[12.5px] font-semibold uppercase"
                    style={{
                      color: COLOR.inkMuted,
                      letterSpacing: "0.06em",
                    }}
                  >
                    {cd.item_name}
                  </div>
                  <p
                    className="text-[14.5px] leading-[1.65]"
                    style={{ color: COLOR.ink }}
                  >
                    {cd.description}
                  </p>
                  {cd.integration_points.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {cd.integration_points.map((ip, idx) => (
                        <li
                          key={idx}
                          className="flex gap-2.5 text-[13.5px] leading-[1.55]"
                          style={{ color: COLOR.inkSoft }}
                        >
                          <span
                            aria-hidden
                            style={{
                              color: COLOR.inkFaint,
                              marginTop: 2,
                            }}
                          >
                            →
                          </span>
                          <span>{ip}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Open conflicts (loud) ── */}
        {allOpenConflicts.length > 0 && (
          <div
            className="mb-6 rounded-lg p-4"
            style={{
              background: COLOR.conflictSoft,
              border: `1px solid ${COLOR.conflictBorder}`,
            }}
          >
            <div
              className="flex items-center gap-1.5"
              style={{ color: COLOR.conflict }}
            >
              <AlertCircle className="h-3 w-3" strokeWidth={2} />
              <span
                className="text-[10.5px] font-semibold uppercase"
                style={{ letterSpacing: "0.14em" }}
              >
                Open conflicts you need to resolve
              </span>
            </div>
            <ul className="mt-2.5 flex flex-col gap-2">
              {allOpenConflicts.map((c, idx) => (
                <li
                  key={idx}
                  className="flex gap-2.5 text-[13.5px] leading-[1.55]"
                  style={{ color: "rgba(127,29,29,0.95)" }}
                >
                  <span aria-hidden style={{ color: COLOR.conflict }}>
                    ⚠
                  </span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Elected variations ── */}
        {room.elected_variations.length > 0 && (
          <div className="mb-6">
            <SubLabel>Elected variations</SubLabel>
            <ul className="mt-3 flex flex-col gap-2.5">
              {room.elected_variations.map((v) => (
                <li
                  key={v.variation_id}
                  className="flex gap-3 text-[13.5px] leading-[1.55]"
                  style={{ color: COLOR.inkSoft }}
                >
                  <span
                    className="mt-2 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ background: COLOR.elected }}
                    aria-hidden
                  />
                  <div>
                    <span
                      style={{ color: COLOR.ink, fontWeight: 500 }}
                    >
                      {v.variation_name}
                    </span>
                    <span
                      className="ml-2 text-[11.5px]"
                      style={{
                        color: COLOR.inkFaint,
                        letterSpacing: "0.02em",
                      }}
                    >
                      {KIND_HINT[v.variation_kind]}
                    </span>
                    <span
                      className="ml-1 text-[11.5px] font-light text-[var(--muted)]"
                      style={{ color: COLOR.inkMuted }}
                    >
                      · {v.item_name}
                    </span>
                    <p
                      className="mt-0.5 text-[12.5px] italic"
                      style={{ color: COLOR.inkMuted }}
                    >
                      {v.tradeoff}
                    </p>
                    {/* Phase 11.9a — inline IndicatorValidityMatrix
                        when the elected variation carries indicator
                        audit data. Compact mode so the matrix tucks
                        cleanly under each variation in the brief's
                        single-column layout. Renders nothing when
                        no audit data — graceful for un-scored
                        elections (legacy or fresh rooms). */}
                    {v.variation &&
                      Array.isArray(v.variation.indicator_scores) &&
                      v.variation.indicator_scores.length > 0 && (
                        <div className="mt-2">
                          <IndicatorValidityMatrix
                            variation={v.variation}
                            title={v.variation_name}
                            compact
                          />
                        </div>
                      )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Mechanism specs — the technical depth per feature ── */}
        {/* Each spec'd feature shows HOW it works (mechanism of action +
            falsifiable hypothesis), HOW it's built (chosen method) and
            HOW it'd be validated / killed — the brief is now the
            strategic AND technical document, not just the strategic one. */}
        {room.mechanism_specs.length > 0 && (
          <div className="mb-6">
            <SubLabel>How each mechanism works</SubLabel>
            <ul className="mt-3 flex flex-col gap-4">
              {room.mechanism_specs.map((s) => {
                const tierColor =
                  s.evidence_strength === "established"
                    ? COLOR.elected
                    : s.evidence_strength === "speculative"
                      ? COLOR.conflict
                      : COLOR.inkSoft;
                return (
                  <li key={s.item_id}>
                    {/* Eyebrow: feature name + honesty-tier badge */}
                    <div className="flex items-baseline gap-2">
                      <div
                        className="text-[12px] font-semibold uppercase"
                        style={{
                          color: COLOR.accent,
                          letterSpacing: "0.08em",
                        }}
                      >
                        {s.item_name}
                      </div>
                      <span
                        className="text-[10.5px] font-semibold uppercase"
                        style={{
                          color: tierColor,
                          letterSpacing: "0.1em",
                        }}
                      >
                        {s.evidence_strength}
                      </span>
                    </div>
                    {/* Lead sentence: the causal process. */}
                    <p
                      className="mt-1 text-[14px] leading-[1.55]"
                      style={{ color: COLOR.ink, fontWeight: 500 }}
                    >
                      {s.mechanism_of_action}
                    </p>
                    {/* Falsifiable hypothesis — woven inline so it reads
                        as a sentence, not a stack of labels. */}
                    <p
                      className="mt-1.5 text-[12.5px] leading-[1.55]"
                      style={{ color: COLOR.inkSoft }}
                    >
                      <span
                        className="mr-1 font-semibold uppercase"
                        style={{
                          color: COLOR.inkFaint,
                          fontSize: "10px",
                          letterSpacing: "0.1em",
                        }}
                      >
                        If
                      </span>
                      {s.hypothesis.if_do}
                      <span
                        className="mx-1 font-semibold uppercase"
                        style={{
                          color: COLOR.inkFaint,
                          fontSize: "10px",
                          letterSpacing: "0.1em",
                        }}
                      >
                        Then
                      </span>
                      {s.hypothesis.then_improves}
                      <span
                        className="mx-1 font-semibold uppercase"
                        style={{
                          color: COLOR.inkFaint,
                          fontSize: "10px",
                          letterSpacing: "0.1em",
                        }}
                      >
                        Because
                      </span>
                      {s.hypothesis.because}
                    </p>
                    {/* Build + validate meta row. */}
                    <div
                      className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px]"
                      style={{ color: COLOR.inkMuted }}
                    >
                      <span>
                        <span
                          className="mr-1 font-semibold uppercase"
                          style={{
                            color: COLOR.inkFaint,
                            fontSize: "10px",
                            letterSpacing: "0.1em",
                          }}
                        >
                          Build
                        </span>
                        {s.chosen_method}
                      </span>
                      <span>
                        <span
                          className="mr-1 font-semibold uppercase"
                          style={{
                            color: COLOR.inkFaint,
                            fontSize: "10px",
                            letterSpacing: "0.1em",
                          }}
                        >
                          Validate
                        </span>
                        {s.validation_experiment}
                      </span>
                    </div>
                    {/* Kill criteria — surface candidly, not as a footnote. */}
                    {s.kill_criteria.length > 0 && (
                      <div
                        className="mt-1 text-[12px]"
                        style={{ color: COLOR.inkMuted }}
                      >
                        <span
                          className="mr-1 font-semibold uppercase"
                          style={{
                            color: COLOR.inkFaint,
                            fontSize: "10px",
                            letterSpacing: "0.1em",
                          }}
                        >
                          Kill if
                        </span>
                        {s.kill_criteria.join(" · ")}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* ── Experiments planned ── */}
        {room.experiments.length > 0 && (
          <div className="mb-6">
            <SubLabel>Experiments planned</SubLabel>
            <ul className="mt-3 flex flex-col gap-4">
              {room.experiments.map((e, idx) => (
                <li key={idx}>
                  <div
                    className="text-[12px] font-semibold uppercase"
                    style={{
                      color: COLOR.accent,
                      letterSpacing: "0.08em",
                    }}
                  >
                    {e.artifact_type}
                  </div>
                  <p
                    className="mt-1 text-[14px] leading-[1.55]"
                    style={{ color: COLOR.ink, fontWeight: 500 }}
                  >
                    {e.hypothesis}
                  </p>
                  <div
                    className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px]"
                    style={{ color: COLOR.inkMuted }}
                  >
                    <span>
                      <span
                        style={{
                          color: COLOR.inkFaint,
                          textTransform: "uppercase",
                          fontSize: "10px",
                          letterSpacing: "0.1em",
                          marginRight: 4,
                        }}
                      >
                        Signal
                      </span>
                      {e.signal_to_watch}
                    </span>
                    <span>
                      <span
                        style={{
                          color: COLOR.inkFaint,
                          textTransform: "uppercase",
                          fontSize: "10px",
                          letterSpacing: "0.1em",
                          marginRight: 4,
                        }}
                      >
                        Effort
                      </span>
                      {e.build_estimate}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Deep dives (L3+ expansion-tree highlights) ── */}
        {room.expansion_highlights.length > 0 && (
          <div className="mb-2">
            <SubLabel>Deep dives</SubLabel>
            <p
              className="mt-2 text-[12.5px] italic leading-relaxed"
              style={{ color: COLOR.inkMuted }}
            >
              The L3+ surfaces you&rsquo;ve expanded — mechanism stories, data
              models, edge cases, calibration. Click through for the full body.
            </p>
            <ul className="mt-3 flex flex-col gap-4">
              {room.expansion_highlights.map((h, idx) => (
                <li key={idx}>
                  <div
                    className="text-[12.5px] font-semibold uppercase"
                    style={{
                      color: COLOR.inkMuted,
                      letterSpacing: "0.06em",
                    }}
                  >
                    <Link
                      href={`/app/objective/${spaceId}/sub/${room.id}?item=${h.item_id}`}
                      style={{ color: "inherit", textDecoration: "none" }}
                      className="hover:underline"
                    >
                      {h.item_name}
                    </Link>
                  </div>
                  <div
                    className="mt-0.5 text-[12.5px]"
                    style={{ color: COLOR.inkSoft }}
                  >
                    {ATTACH_LABEL[h.attach_kind]}{" "}
                    <span
                      style={{ color: COLOR.ink, fontWeight: 500 }}
                    >
                      {h.parent_title}
                    </span>
                  </div>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {h.nodes.map((n, nIdx) => (
                      <li
                        key={nIdx}
                        className="flex gap-2.5 text-[13px] leading-[1.55]"
                        style={{ color: COLOR.inkSoft }}
                      >
                        <span
                          aria-hidden
                          className="font-mono"
                          style={{
                            color: COLOR.inkFaint,
                            fontSize: "10.5px",
                            paddingTop: 3,
                            letterSpacing: "0.04em",
                            flexShrink: 0,
                          }}
                        >
                          L{n.depth}
                        </span>
                        <div>
                          <span style={{ color: COLOR.ink, fontWeight: 500 }}>
                            {n.title}
                          </span>
                          {n.excerpt && (
                            <span style={{ color: COLOR.inkMuted }}>
                              {" "}— {n.excerpt}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
}

// ── Bits ──────────────────────────────────────────────────────────

function ActionBtn({
  onClick,
  icon,
  label,
  accent = false,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors"
      style={{
        background: accent ? COLOR.accentSoft : "transparent",
        color: accent ? "rgba(76,29,149,0.95)" : COLOR.inkSoft,
        border: `1px solid ${accent ? "rgba(124,58,237,0.20)" : COLOR.rule}`,
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="brief-section mt-12"
      style={{
        borderTop: `1px solid ${COLOR.rule}`,
        paddingTop: "2.25rem",
      }}
    >
      {children}
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10.5px] font-semibold uppercase"
      style={{
        color: COLOR.inkFaint,
        letterSpacing: "0.18em",
      }}
    >
      {children}
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10.5px] font-semibold uppercase"
      style={{
        color: COLOR.inkFaint,
        letterSpacing: "0.14em",
      }}
    >
      {children}
    </div>
  );
}

function Term({ children }: { children: React.ReactNode }) {
  return (
    <dt
      className="text-[11.5px] font-semibold uppercase"
      style={{
        color: COLOR.inkFaint,
        letterSpacing: "0.12em",
      }}
    >
      {children}
    </dt>
  );
}

function Def({ children }: { children: React.ReactNode }) {
  return (
    <dd
      className="text-[14px] leading-[1.55]"
      style={{ color: COLOR.ink }}
    >
      {children}
    </dd>
  );
}

function Caption({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return <span style={style}>{children}</span>;
}

function CaptionDot() {
  return (
    <span
      style={{ color: COLOR.inkFaint }}
      aria-hidden
    >
      ·
    </span>
  );
}

// ── Static labels ──

const TIME_LABEL: Record<string, string> = {
  days: "Days (single week)",
  weeks: "Weeks (2-4)",
  months: "Months (1-3)",
  quarter: "A quarter (3 months)",
  year_plus: "A year or longer",
};

const BUDGET_LABEL: Record<string, string> = {
  zero: "Zero — time + existing tools",
  low: "Low — under $1k",
  moderate: "Moderate — $1k-$50k",
  substantial: "Substantial — $50k+",
};

const TEAM_LABEL: Record<string, string> = {
  solo: "Solo — 1 person",
  small: "Small — 2-5",
  medium: "Medium — 6-20",
  large: "Large — 20+",
};

const RISK_LABEL: Record<string, string> = {
  experimental: "Experimental — welcomes surprise",
  calibrated: "Calibrated — measured bets",
  conservative: "Conservative — proven patterns",
};

const KIND_HINT: Record<string, string> = {
  alternative: "alternative",
  additive: "additive",
  principle: "principle",
};

// Prefix word for each expansion attach kind, rendered before the
// parent_title so the user reads "Variation: Streak-based" rather than
// the bare slug. Kept ultra-short — the parent_title carries the noun.
const ATTACH_LABEL: Record<string, string> = {
  variation: "Variation:",
  open_question: "Question:",
  conflict_open: "",
  planning_risk: "",
  integration_point: "",
};

// ── Helpers ──

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

// ── Print styles ──
//
// When the user prints (or saves as PDF) the brief should look like
// a clean memo, not a screenshot of the app. Hide action bar, drop
// background tints, strip box-shadows, make sure no section breaks
// in the middle of a paragraph.

const PRINT_STYLES = `
  @media print {
    .brief-root {
      background: #fff !important;
      min-height: 0 !important;
    }
    .brief-action-bar,
    .print-hide {
      display: none !important;
    }
    .brief-article {
      margin: 0 !important;
      max-width: 100% !important;
      box-shadow: none !important;
      padding-top: 0 !important;
      padding-bottom: 0 !important;
      border-radius: 0 !important;
    }
    .brief-section {
      page-break-inside: avoid;
    }
    h1, h2, h3 {
      page-break-after: avoid;
    }
    a {
      color: inherit !important;
      text-decoration: none !important;
    }
    a[href]::after {
      content: "";
    }
  }
`;

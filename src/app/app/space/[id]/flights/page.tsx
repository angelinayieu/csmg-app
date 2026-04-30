// /app/space/[id]/flights — gallery + per-flight detail
//
// Phase 6 surface. Two views in one page driven by a `?flight=<id>`
// query param:
//   - default: grid of FlightCard components (matches reference
//     image 2 — categorized list of named multi-step pathways)
//   - ?flight=<id>: same gallery + a detail panel below with a
//     FlightTrajectoryChart and the score breakdown
//
// Auth: page redirects to /signin when unauthenticated; data load
// happens server-side via the routes added in Phase 6 step 1.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  FlightCard,
  type FlightCardEntity,
  type FlightRow,
} from "@/components/flights/flight-card";
import { FlightTrajectoryChart } from "@/components/flights/flight-trajectory-chart";

interface PhasePayload {
  phase: number;
  name: string;
  duration_weeks: number;
  entry_criteria: string | null;
  exit_criteria: string;
  step_entity_ids: string[];
}

function emptyScoreBreakdown(): LiveScoreBreakdown {
  return {
    total_peak_days: null,
    total_onset_days: null,
    min_persistence_days: null,
    joint_probability: null,
    evidence_count: 0,
    heterogeneity_i2: null,
    edges_with_temporal: 0,
    edges_total: 0,
  };
}

function isPhaseArray(v: unknown): v is PhasePayload[] {
  if (!Array.isArray(v)) return false;
  return v.every(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as Record<string, unknown>).phase === "number" &&
      typeof (p as Record<string, unknown>).name === "string",
  );
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ flight?: string; category?: string }>;
}

export default async function FlightsPage({ params, searchParams }: PageProps) {
  const { id: spaceId } = await params;
  const { flight: selectedFlightId, category } = await searchParams;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  // Verify ownership.
  const { data: space } = (await db
    .from("spaces")
    .select("id, name")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle()) as { data: { id: string; name: string } | null };
  if (!space) redirect("/app");

  // Load flights for the gallery.
  let flightsQ = db
    .from("flights")
    .select("*")
    .eq("space_id", spaceId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(50);
  if (category) flightsQ = flightsQ.eq("category", category);
  const { data: flights } = (await flightsQ) as { data: FlightRow[] | null };
  const rows = flights ?? [];

  // Hydrate every entity any flight references — one bulk fetch.
  const allEntityIds = Array.from(
    new Set(rows.flatMap((f) => f.steps_entity_ids ?? [])),
  );
  const entityById = new Map<string, FlightCardEntity>();
  if (allEntityIds.length > 0) {
    const { data: ents } = (await db
      .from("entities")
      .select("id, name, layer, entity_category")
      .in("id", allEntityIds)) as {
      data: Array<{
        id: string;
        name: string;
        layer: string | null;
        entity_category: string | null;
      }> | null;
    };
    for (const e of ents ?? []) {
      entityById.set(e.id, {
        id: e.id,
        name: e.name,
        layer: e.layer,
        category: e.entity_category,
      });
    }
  }

  // Categories present, for the filter pills.
  const categoriesPresent = Array.from(
    new Set(rows.map((f) => f.category).filter((c): c is string => !!c)),
  ).sort();

  // Selected flight (when ?flight=… is set).
  const selectedFlight =
    selectedFlightId
      ? rows.find((f) => f.id === selectedFlightId) ?? null
      : null;

  // Hydrate the selected flight's edges if a flight is selected.
  let selectedEdges: Awaited<ReturnType<typeof loadFlightEdges>> = {
    edges: [],
    entities: [],
    liveScoreBreakdown: emptyScoreBreakdown(),
  };
  if (selectedFlight) {
    selectedEdges = await loadFlightEdges(db, selectedFlight);
  }

  return (
    <div
      style={{
        width: "100%",
        minHeight: "calc(100vh - 64px)",
        background:
          "linear-gradient(135deg, #f5f7fa 0%, #e8ecf1 50%, #dfe6ed 100%)",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif",
        color: "#1d1d1f",
        padding: "32px 24px",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1
            style={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: -0.8,
              margin: "0 0 6px 0",
            }}
          >
            Flights
          </h1>
          <p style={{ fontSize: 15, color: "#86868b", margin: 0 }}>
            Mechanistic pathways showing how variables connect through
            cause-effect chains.
          </p>
        </div>

        {/* Category filter pills */}
        {categoriesPresent.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 24,
              flexWrap: "wrap",
            }}
          >
            <CategoryPill
              spaceId={spaceId}
              category={null}
              currentCategory={category ?? null}
              currentFlight={selectedFlightId ?? null}
              label="All"
            />
            {categoriesPresent.map((c) => (
              <CategoryPill
                key={c}
                spaceId={spaceId}
                category={c}
                currentCategory={category ?? null}
                currentFlight={selectedFlightId ?? null}
                label={c.replace(/_/g, " ")}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {rows.length === 0 ? (
          <div
            style={{
              padding: "48px 32px",
              background: "rgba(255,255,255,0.6)",
              borderRadius: 16,
              border: "1px dashed rgba(0,0,0,0.08)",
              textAlign: "center",
              color: "#86868b",
              fontSize: 14,
            }}
          >
            No flights yet. Cognition-template spaces ship 6 pre-baked flights;
            other templates can pre-bake their own via{" "}
            <code>seed_flights</code>. User-curated flights and auto-promoted
            critical paths land here too.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 14,
              marginBottom: selectedFlight ? 32 : 0,
            }}
          >
            {rows.map((f) => {
              const stepEntities = (f.steps_entity_ids ?? [])
                .map((id) => entityById.get(id))
                .filter((e): e is FlightCardEntity => !!e);
              return (
                <FlightCard
                  key={f.id}
                  flight={f}
                  stepEntities={stepEntities}
                  href={`/app/space/${spaceId}/flights?flight=${f.id}${category ? `&category=${category}` : ""}`}
                />
              );
            })}
          </div>
        )}

        {/* Selected flight detail panel */}
        {selectedFlight && (
          <FlightDetailPanel
            flight={selectedFlight}
            entities={selectedEdges.entities}
            edges={selectedEdges.edges}
            liveScoreBreakdown={selectedEdges.liveScoreBreakdown}
          />
        )}
      </div>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────

function CategoryPill({
  spaceId,
  category,
  currentCategory,
  currentFlight,
  label,
}: {
  spaceId: string;
  category: string | null;
  currentCategory: string | null;
  currentFlight: string | null;
  label: string;
}) {
  const active = category === currentCategory;
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (currentFlight) params.set("flight", currentFlight);
  const href = `/app/space/${spaceId}/flights${params.toString() ? `?${params}` : ""}`;
  return (
    <Link
      href={href}
      style={{
        padding: "8px 16px",
        borderRadius: 20,
        border: active ? "none" : "1px solid rgba(0,0,0,0.08)",
        background: active ? "#1d1d1f" : "rgba(255,255,255,0.6)",
        color: active ? "white" : "#86868b",
        fontSize: 12,
        fontWeight: 500,
        textTransform: "capitalize",
        textDecoration: "none",
        display: "inline-block",
      }}
    >
      {label}
    </Link>
  );
}

interface FlightDetailEntity {
  id: string;
  name: string;
  layer: string | null;
  category: string | null;
}

interface FlightDetailEdge {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  onset_days_p50: number | null;
  onset_days_p10: number | null;
  onset_days_p90: number | null;
  peak_days_p50: number | null;
  peak_days_p10: number | null;
  peak_days_p90: number | null;
  persistence_days_p50: number | null;
  decay_kinetics_modal:
    | "linear"
    | "exponential"
    | "sustained"
    | "biphasic"
    | "unknown"
    | null;
  temporal_evidence_count: number | null;
  temporal_heterogeneity_i2: number | null;
}

interface LiveScoreBreakdown {
  total_peak_days: number | null;
  total_onset_days: number | null;
  min_persistence_days: number | null;
  joint_probability: number | null;
  evidence_count: number;
  heterogeneity_i2: number | null;
  edges_with_temporal: number;
  edges_total: number;
}

function FlightDetailPanel({
  flight,
  entities,
  edges,
  liveScoreBreakdown,
}: {
  flight: FlightRow;
  entities: FlightDetailEntity[];
  edges: FlightDetailEdge[];
  liveScoreBreakdown: LiveScoreBreakdown | null;
}) {
  const phases = isPhaseArray(flight.phases) ? flight.phases : null;
  const trajectoryEntities = entities.map((e) => ({ id: e.id, name: e.name }));

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.78)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        borderRadius: 18,
        border: "1px solid rgba(0,0,0,0.06)",
        padding: "28px 32px",
        boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ marginBottom: 20 }}>
        <h2
          style={{
            fontSize: 22,
            fontWeight: 700,
            margin: "0 0 6px 0",
            letterSpacing: -0.4,
          }}
        >
          {flight.name}
        </h2>
        {flight.description && (
          <p
            style={{
              fontSize: 14,
              color: "#424245",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {flight.description}
          </p>
        )}
      </div>

      {/* Trajectory chart */}
      <div style={{ marginBottom: 24 }}>
        <FlightTrajectoryChart
          edges={edges}
          entities={trajectoryEntities}
          phases={phases?.map((p) => ({
            phase: p.phase,
            name: p.name,
            duration_weeks: p.duration_weeks,
          }))}
          height={360}
        />
      </div>

      {/* Live score breakdown */}
      {liveScoreBreakdown && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <ScoreCard
            label="Time to outcome"
            value={
              liveScoreBreakdown.total_peak_days !== null
                ? `${Math.round(liveScoreBreakdown.total_peak_days / 7)} wks`
                : "—"
            }
            subtext={
              liveScoreBreakdown.total_onset_days !== null
                ? `first effect ~${Math.round(liveScoreBreakdown.total_onset_days / 7)} wks`
                : ""
            }
          />
          <ScoreCard
            label="Persistence (min)"
            value={
              liveScoreBreakdown.min_persistence_days !== null
                ? `${Math.round(liveScoreBreakdown.min_persistence_days / 7)} wks`
                : "—"
            }
            subtext="weakest link in path"
          />
          <ScoreCard
            label="Joint probability"
            value={
              liveScoreBreakdown.joint_probability !== null
                ? liveScoreBreakdown.joint_probability.toFixed(2)
                : "—"
            }
            subtext={`${liveScoreBreakdown.edges_total} edges in path`}
          />
          <ScoreCard
            label="Evidence"
            value={`${liveScoreBreakdown.evidence_count} studies`}
            subtext={
              liveScoreBreakdown.heterogeneity_i2 !== null
                ? `I² = ${liveScoreBreakdown.heterogeneity_i2.toFixed(2)}`
                : `${liveScoreBreakdown.edges_with_temporal}/${liveScoreBreakdown.edges_total} edges timed`
            }
          />
        </div>
      )}

      {/* Phases roadmap */}
      {phases && phases.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1,
              color: "#86868b",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Phases
          </div>
          {phases.map((p) => (
            <div
              key={p.phase}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                padding: "12px 16px",
                borderRadius: 12,
                background: "rgba(0,0,0,0.02)",
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: "rgba(0,113,227,0.12)",
                  color: "#0071E3",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {p.phase}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    marginBottom: 2,
                    color: "#1d1d1f",
                  }}
                >
                  {p.name}{" "}
                  <span style={{ color: "#86868b", fontWeight: 400 }}>
                    ({p.duration_weeks} weeks)
                  </span>
                </div>
                {p.entry_criteria && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#424245",
                      marginBottom: 2,
                    }}
                  >
                    <strong style={{ color: "#86868b" }}>Entry:</strong>{" "}
                    {p.entry_criteria}
                  </div>
                )}
                <div style={{ fontSize: 12, color: "#424245" }}>
                  <strong style={{ color: "#86868b" }}>Exit:</strong>{" "}
                  {p.exit_criteria}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreCard({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string;
  subtext: string;
}) {
  return (
    <div
      style={{
        background: "rgba(0,0,0,0.02)",
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "#86868b",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#1d1d1f" }}>
        {value}
      </div>
      {subtext && (
        <div style={{ fontSize: 11, color: "#86868b", marginTop: 2 }}>
          {subtext}
        </div>
      )}
    </div>
  );
}

// ── Server-side data loader ──────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadFlightEdges(db: any, flight: FlightRow) {
  const stepEntityIds = (flight.steps_entity_ids ?? []) as string[];
  const stepEdgeIds = (flight.steps_edge_ids ?? []) as string[];
  const edgeSelectCols =
    "id, source_entity_id, target_entity_id, " +
    "onset_days_p50, onset_days_p10, onset_days_p90, " +
    "peak_days_p50, peak_days_p10, peak_days_p90, " +
    "persistence_days_p50, persistence_days_p10, persistence_days_p90, " +
    "decay_kinetics_modal, temporal_evidence_count, temporal_heterogeneity_i2, " +
    "strength, confidence";

  // Reuse the GET /api/flights/[id] logic inline (same DB; just
  // skip the auth wrapping since the server component already
  // verified ownership).
  let edges: FlightDetailEdge[] = [];
  if (stepEdgeIds.length > 0) {
    const { data } = (await db
      .from("edges")
      .select(edgeSelectCols)
      .in("id", stepEdgeIds)) as { data: FlightDetailEdge[] | null };
    edges = data ?? [];
  } else if (stepEntityIds.length >= 2) {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < stepEntityIds.length - 1; i++) {
      pairs.push([stepEntityIds[i], stepEntityIds[i + 1]]);
    }
    const allTouched = Array.from(new Set(pairs.flatMap(([a, b]) => [a, b])));
    if (allTouched.length > 0) {
      const { data } = (await db
        .from("edges")
        .select(edgeSelectCols)
        .eq("space_id", flight.space_id)
        .or(
          `source_entity_id.in.(${allTouched.join(",")}),target_entity_id.in.(${allTouched.join(",")})`,
        )) as { data: FlightDetailEdge[] | null };
      const allEdges = data ?? [];
      for (const [src, tgt] of pairs) {
        const direct = allEdges.find(
          (e) => e.source_entity_id === src && e.target_entity_id === tgt,
        );
        if (direct) {
          edges.push(direct);
          continue;
        }
        const reverse = allEdges.find(
          (e) => e.source_entity_id === tgt && e.target_entity_id === src,
        );
        if (reverse) edges.push(reverse);
      }
    }
  }

  let entities: FlightDetailEntity[] = [];
  if (stepEntityIds.length > 0) {
    const { data } = (await db
      .from("entities")
      .select("id, name, layer, entity_category")
      .in("id", stepEntityIds)) as {
      data: Array<{
        id: string;
        name: string;
        layer: string | null;
        entity_category: string | null;
      }> | null;
    };
    const byId = new Map((data ?? []).map((e) => [e.id, e]));
    entities = stepEntityIds
      .map((id) => byId.get(id))
      .filter((e): e is NonNullable<ReturnType<typeof byId.get>> => !!e)
      .map((e) => ({
        id: e.id,
        name: e.name,
        layer: e.layer,
        category: e.entity_category,
      }));
  }

  // Live score breakdown — same math as the GET route.
  let totalPeak = 0;
  let allPeakKnown = true;
  let totalOnset = 0;
  let allOnsetKnown = true;
  let minPersistence: number | null = null;
  let evidenceCount = 0;
  let i2Sum = 0;
  let i2Count = 0;
  let edgesWithTemporal = 0;
  let jointProb = 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const e of edges as any[]) {
    if (typeof e.peak_days_p50 === "number") totalPeak += e.peak_days_p50;
    else allPeakKnown = false;
    if (typeof e.onset_days_p50 === "number") totalOnset += e.onset_days_p50;
    else allOnsetKnown = false;
    if (typeof e.persistence_days_p50 === "number") {
      minPersistence =
        minPersistence === null
          ? e.persistence_days_p50
          : Math.min(minPersistence, e.persistence_days_p50);
    }
    evidenceCount += e.temporal_evidence_count ?? 0;
    if (typeof e.temporal_heterogeneity_i2 === "number") {
      i2Sum += e.temporal_heterogeneity_i2;
      i2Count++;
    }
    if (
      typeof e.peak_days_p50 === "number" ||
      typeof e.onset_days_p50 === "number" ||
      typeof e.persistence_days_p50 === "number"
    ) {
      edgesWithTemporal++;
    }
    const strength = typeof e.strength === "number" ? e.strength : 0.5;
    const confidence = typeof e.confidence === "number" ? e.confidence : 0.8;
    jointProb *= Math.max(0, Math.min(1, strength * confidence));
  }
  const liveScoreBreakdown: LiveScoreBreakdown = {
    total_peak_days: allPeakKnown && edges.length > 0 ? totalPeak : null,
    total_onset_days: allOnsetKnown && edges.length > 0 ? totalOnset : null,
    min_persistence_days: minPersistence,
    joint_probability: edges.length > 0 ? jointProb : null,
    evidence_count: evidenceCount,
    heterogeneity_i2: i2Count > 0 ? i2Sum / i2Count : null,
    edges_with_temporal: edgesWithTemporal,
    edges_total: edges.length,
  };

  return { edges, entities, liveScoreBreakdown };
}

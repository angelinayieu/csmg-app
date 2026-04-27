"use client";

// ── Canvas entity-detail drawer (Phase 2) ──
//
// Slides in from the right when the user clicks an entity in any
// graph view (currently: probability-space-shell mini-graphs). Shows
// a hydrated view of that entity:
//   - Name + description
//   - Kind chip (color-coded via kind-classifier)
//   - Layer chip (L0–L4 from layer-config)
//   - Canonical signature rings (NodeSignatureRing, existing component)
//   - "Deepen this signature" button → /api/pipeline/deepen-signature
//   - Edges in / out, polarity-coded
//
// Listens for the `shell-graph:focus` window event the
// probability-space-shell mini-graph dispatches on node click. Also
// honors `root-cause-tree:focus` so the existing root-cause atlas
// click target works again (it broke when we killed global ghosts).
//
// Stateless wrt to canvas — no tldraw editor reference. Hydrates
// purely from /api/entities/[id]/detail (returns entity + edges +
// claims). Closes on backdrop click or Esc.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Layers,
  Loader2,
  Network,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import type { Entity, Edge } from "@/types";
import type { NodeSignature } from "@/types/node-signature";
import {
  ENTITY_KIND_ACCENT,
  ENTITY_KIND_LABEL,
  classifyEntityKind,
} from "@/lib/entities/kind-classifier";
import {
  LAYERS,
  entityToLayerId,
  depthToLayerName,
} from "@/lib/whiteboard/layer-config";
import { NodeSignatureRing } from "@/components/signatures/node-signature-ring";
import { cn } from "@/lib/utils";

interface DetailPayload {
  entity: Entity;
  edges: Edge[];
  claims: unknown[];
  /** Phase 6 — partner entity rows for the ego-network view. May be
   *  empty when an entity has no incident edges, or absent if the
   *  drawer is talking to a pre-Phase-6 build of the API. */
  partner_entities?: Array<{
    id: string;
    name: string;
    entity_category: string | null;
  }>;
}

/** Which view of the entity is currently active in the body of the
 *  drawer. `list` is the original Phase 2 connections list; `ego` is
 *  the Phase 6 SVG ego-network. */
type DrawerTab = "list" | "ego";

interface OpenState {
  entityId: string;
  /** Optional friendly name shown in the header before fetch resolves
   *  (avoids "Loading…" with no context). The graph view passes its
   *  cached label since fetching can take 100-300ms. */
  prefetchedName?: string;
}

export function CanvasEntityDetailDrawer() {
  const [open, setOpen] = useState<OpenState | null>(null);
  const [payload, setPayload] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deepening, startDeepenTransition] = useTransition();
  const [deepenStatus, setDeepenStatus] = useState<string | null>(null);

  // Phase 4 — "Save neighborhood as system" gesture. Tri-state with
  // a transient saved/error display before resetting.
  const [saveSystemState, setSaveSystemState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveSystemError, setSaveSystemError] = useState<string | null>(null);

  // Phase 6 — body tab state ("list" classic connections | "ego"
  // SVG ego-network). Resets to "list" on every focus change so the
  // user starts each entity in the familiar layout.
  const [tab, setTab] = useState<DrawerTab>("list");
  useEffect(() => {
    setTab("list");
  }, [open]);

  // Listen for the focus events from any graph surface. Both events
  // carry { entityId } in detail; the optional `name` lets the
  // emitter prefill the header.
  useEffect(() => {
    const onFocus = (e: Event) => {
      const ce = e as CustomEvent<{ entityId?: string; name?: string }>;
      const id = ce.detail?.entityId;
      if (!id || typeof id !== "string") return;
      setOpen({ entityId: id, prefetchedName: ce.detail?.name });
      setDeepenStatus(null);
      setError(null);
    };
    window.addEventListener("shell-graph:focus", onFocus as EventListener);
    window.addEventListener(
      "root-cause-tree:focus",
      onFocus as EventListener,
    );
    return () => {
      window.removeEventListener("shell-graph:focus", onFocus as EventListener);
      window.removeEventListener(
        "root-cause-tree:focus",
        onFocus as EventListener,
      );
    };
  }, []);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Fetch on open
  useEffect(() => {
    if (!open) {
      setPayload(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/entities/${open.entityId}/detail`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`detail fetch failed: ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        setPayload(json as DetailPayload);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const close = useCallback(() => setOpen(null), []);

  // Phase 4 — promote {this entity + its 1-hop neighborhood} to a
  // saved system. Edge collection is auto-resolved server-side based
  // on the entity_ids we pass. Source-tagged as `user_lasso` since
  // this is a user-driven gesture (not an auto-discovered pattern).
  const onSaveAsSystem = useCallback(async () => {
    if (!payload?.entity || saveSystemState === "saving") return;
    const ent = payload.entity;
    // Neighborhood = self + every entity at the other end of an
    // incident edge. De-duped via Set in case the same neighbor
    // appears in multiple edges.
    const neighborIds = new Set<string>([ent.id]);
    for (const e of payload.edges) {
      if (e.source_entity_id !== ent.id) neighborIds.add(e.source_entity_id);
      if (e.target_entity_id !== ent.id) neighborIds.add(e.target_entity_id);
    }
    setSaveSystemState("saving");
    setSaveSystemError(null);
    try {
      const res = await fetch(`/api/spaces/${ent.space_id}/systems`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Around · ${ent.name}`,
          description:
            `Neighborhood of "${ent.name}" — ${neighborIds.size} entit` +
            `${neighborIds.size === 1 ? "y" : "ies"} (1-hop).`,
          entity_ids: Array.from(neighborIds),
          source_kind: "user_lasso",
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`save failed: ${res.status} ${txt}`);
      }
      setSaveSystemState("saved");
      window.setTimeout(() => setSaveSystemState("idle"), 1800);
    } catch (err) {
      setSaveSystemError(
        err instanceof Error ? err.message : String(err),
      );
      setSaveSystemState("error");
      window.setTimeout(() => setSaveSystemState("idle"), 2200);
    }
  }, [payload, saveSystemState]);

  const onDeepen = useCallback(() => {
    if (!payload?.entity || deepening) return;
    setDeepenStatus("deepening…");
    startDeepenTransition(() => {
      void fetch("/api/pipeline/deepen-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          space_id: payload.entity.space_id,
          entity_id: payload.entity.id,
        }),
      })
        .then(async (r) => {
          if (!r.ok) {
            const txt = await r.text().catch(() => "");
            throw new Error(`deepen failed: ${r.status} ${txt}`);
          }
          return r.json();
        })
        .then(
          (json: {
            signature: NodeSignature | null;
            added: unknown;
            stop_reason: string;
          }) => {
            // Patch the local payload so the new ring is visible
            // immediately without a refetch. node_signature is typed
            // as Json on Entity but is structurally NodeSignature; cast
            // through unknown to bridge the two views.
            setPayload((prev) =>
              prev && json.signature
                ? {
                    ...prev,
                    entity: {
                      ...prev.entity,
                      node_signature:
                        json.signature as unknown as Entity["node_signature"],
                    },
                  }
                : prev,
            );
            setDeepenStatus(
              json.added
                ? "ring added — signature deepened"
                : `pinned: ${json.stop_reason || "no further variable found"}`,
            );
          },
        )
        .catch((err) => {
          setDeepenStatus(
            `deepen failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    });
  }, [payload, deepening]);

  const entity = payload?.entity;
  // Phase 6 — partner-name map populated from the Phase 6 detail
  // API enrichment. Empty until detail loads; used by both the list
  // and ego views to render real partner names instead of UUIDs.
  // Must be declared before any early return to satisfy Rules of Hooks.
  const idToNameMap = useMemo(() => {
    const m = new Map<string, string>();
    if (entity?.id && entity?.name) m.set(entity.id, entity.name);
    for (const p of payload?.partner_entities ?? []) {
      if (p?.id && p?.name) m.set(p.id, p.name);
    }
    return m;
  }, [entity?.id, entity?.name, payload?.partner_entities]);

  if (!open) return null;

  const edges = payload?.edges ?? [];
  const incomingEdges = entity
    ? edges.filter((e) => e.target_entity_id === entity.id)
    : [];
  const outgoingEdges = entity
    ? edges.filter((e) => e.source_entity_id === entity.id)
    : [];
  const headerName = entity?.name ?? open.prefetchedName ?? "Loading…";
  const kind = entity ? classifyEntityKind(entity) : null;
  const kindAccent = kind ? ENTITY_KIND_ACCENT[kind] : "#64748b";
  const kindLabel = kind ? ENTITY_KIND_LABEL[kind] : null;
  const layerId = entity ? entityToLayerId(entity) : null;
  const layerConfig = layerId ? LAYERS[layerId] ?? null : null;
  const signature =
    (entity?.node_signature as unknown as NodeSignature | null) ?? null;

  return (
    <>
      {/* Backdrop — clicking it closes; canvas pan still blocked while open */}
      <div
        className="fixed inset-0 z-[60] bg-slate-900/15 backdrop-blur-[2px]"
        onClick={close}
        onPointerDown={(e) => e.stopPropagation()}
      />
      {/* Drawer */}
      <aside
        className="fixed right-0 top-0 z-[70] h-screen w-[440px] overflow-hidden border-l border-slate-200 bg-white shadow-[0_24px_48px_-16px_rgba(15,23,42,0.18)]"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Detail for ${headerName}`}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <header
            className="border-b border-slate-200 px-5 py-4"
            style={{
              background: `linear-gradient(180deg, color-mix(in srgb, ${kindAccent} 8%, transparent) 0%, transparent 100%)`,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div
                  className="text-[9px] font-bold uppercase tracking-[0.16em]"
                  style={{ color: kindAccent }}
                >
                  Entity
                </div>
                <h2 className="mt-1 line-clamp-2 text-[15px] font-semibold text-slate-900">
                  {headerName}
                </h2>
                {entity?.description && (
                  <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-slate-600">
                    {entity.description}
                  </p>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                {/* Phase 4 — save this entity + its 1-hop neighborhood
                    as a System the user can experiment against in the
                    lab. Disabled until the entity finishes loading
                    (need edges to compute the neighborhood). */}
                {entity && (
                  <button
                    type="button"
                    onClick={onSaveAsSystem}
                    disabled={saveSystemState === "saving"}
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-semibold transition",
                      saveSystemState === "saved"
                        ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                        : saveSystemState === "error"
                          ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                          : "bg-violet-600 text-white hover:bg-violet-700 disabled:cursor-wait disabled:opacity-70",
                    )}
                    title={
                      saveSystemError
                        ? `Save failed: ${saveSystemError}`
                        : `Save this entity + its 1-hop neighborhood as a System (browseable at /app/space/${entity.space_id}/systems).`
                    }
                  >
                    {saveSystemState === "saving" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : saveSystemState === "saved" ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Network className="h-3 w-3" />
                    )}
                    {saveSystemState === "saved"
                      ? "Saved"
                      : saveSystemState === "error"
                        ? "Failed"
                        : "Save as system"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={close}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {/* Kind + Layer chips */}
            {entity && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {kindLabel && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{
                      background: `color-mix(in srgb, ${kindAccent} 14%, transparent)`,
                      color: kindAccent,
                    }}
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ background: kindAccent }}
                    />
                    {kindLabel}
                  </span>
                )}
                {layerConfig && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{
                      background: `color-mix(in srgb, ${layerConfig.color} 14%, transparent)`,
                      color: layerConfig.color,
                    }}
                    title={`Depth ${entity.depth ?? "—"}: ${depthToLayerName(entity.depth ?? 2)}`}
                  >
                    <Layers className="h-3 w-3" />
                    {layerConfig.label}
                  </span>
                )}
                {entity.is_leverage_point && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    <Zap className="h-3 w-3" /> Leverage
                  </span>
                )}
              </div>
            )}
          </header>

          {/* Body — scrollable */}
          <div className="flex-1 overflow-y-auto">
            {loading && !entity && (
              <div className="flex items-center justify-center gap-2 px-5 py-12 text-[12px] text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading entity…
              </div>
            )}

            {error && (
              <div className="mx-5 my-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                {error}
              </div>
            )}

            {entity && (
              <>
                {/* Canonical signature section */}
                <section className="border-b border-slate-100 px-5 py-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                      Canonical signature
                    </h3>
                    <button
                      type="button"
                      onClick={onDeepen}
                      disabled={deepening}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold transition",
                        deepening
                          ? "cursor-wait bg-slate-100 text-slate-500"
                          : "bg-violet-600 text-white hover:bg-violet-700",
                      )}
                    >
                      {deepening ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      Deepen
                    </button>
                  </div>
                  {signature ? (
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0">
                        <NodeSignatureRing
                          signature={signature}
                          size={88}
                          showCode={false}
                        />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="font-mono text-[10.5px] text-slate-700">
                          {signature.canonical_code}
                        </div>
                        <div className="text-[10.5px] text-slate-600">
                          {signature.rings} ring
                          {signature.rings === 1 ? "" : "s"} ·{" "}
                          {Math.round(signature.residual_uncertainty * 100)}%
                          residual uncertainty
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Resolution {signature.resolution.zoom} ·{" "}
                          {signature.resolution.horizon}
                          {signature.resolution.pinned_because && (
                            <span className="ml-1 italic text-slate-400">
                              (pinned: {signature.resolution.pinned_because})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-[11px] text-slate-500">
                      No signature yet. Click <strong>Deepen</strong> to seed
                      one.
                    </div>
                  )}
                  {deepenStatus && (
                    <div className="mt-2 rounded bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
                      {deepenStatus}
                    </div>
                  )}
                </section>

                {/* Connections section — Phase 6 tabbed: list vs ego */}
                <section className="border-b border-slate-100 px-5 py-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                      Connections ({incomingEdges.length + outgoingEdges.length})
                    </h3>
                    {/* Tab switcher — only render when there are edges
                        worth viewing as a graph. */}
                    {incomingEdges.length + outgoingEdges.length > 0 && (
                      <div className="inline-flex overflow-hidden rounded-md border border-slate-200 text-[10px]">
                        <button
                          type="button"
                          onClick={() => setTab("list")}
                          className={cn(
                            "px-2 py-0.5 font-medium transition",
                            tab === "list"
                              ? "bg-slate-900 text-white"
                              : "bg-white text-slate-500 hover:bg-slate-50",
                          )}
                          title="Linear list of connections"
                        >
                          List
                        </button>
                        <button
                          type="button"
                          onClick={() => setTab("ego")}
                          className={cn(
                            "px-2 py-0.5 font-medium transition",
                            tab === "ego"
                              ? "bg-slate-900 text-white"
                              : "bg-white text-slate-500 hover:bg-slate-50",
                          )}
                          title="Ego-network view — see all upstream + downstream around this entity in one picture"
                        >
                          Ego
                        </button>
                      </div>
                    )}
                  </div>

                  {tab === "list" ? (
                    <>
                      {incomingEdges.length > 0 && (
                        <div className="mb-3">
                          <div className="mb-1.5 flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider text-slate-400">
                            <ArrowDownRight className="h-3 w-3" />
                            Upstream ({incomingEdges.length})
                          </div>
                          <ul className="space-y-1">
                            {incomingEdges.slice(0, 6).map((e) => (
                              <EdgeRow
                                key={e.id}
                                edge={e}
                                otherId={e.source_entity_id}
                                direction="incoming"
                                idToNameMap={idToNameMap}
                              />
                            ))}
                            {incomingEdges.length > 6 && (
                              <li className="px-1 text-[10px] italic text-slate-400">
                                +{incomingEdges.length - 6} more
                              </li>
                            )}
                          </ul>
                        </div>
                      )}

                      {outgoingEdges.length > 0 && (
                        <div>
                          <div className="mb-1.5 flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider text-slate-400">
                            <ArrowUpRight className="h-3 w-3" />
                            Downstream ({outgoingEdges.length})
                          </div>
                          <ul className="space-y-1">
                            {outgoingEdges.slice(0, 6).map((e) => (
                              <EdgeRow
                                key={e.id}
                                edge={e}
                                otherId={e.target_entity_id}
                                direction="outgoing"
                                idToNameMap={idToNameMap}
                              />
                            ))}
                            {outgoingEdges.length > 6 && (
                              <li className="px-1 text-[10px] italic text-slate-400">
                                +{outgoingEdges.length - 6} more
                              </li>
                            )}
                          </ul>
                        </div>
                      )}

                      {incomingEdges.length === 0 &&
                        outgoingEdges.length === 0 && (
                          <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-center text-[11px] text-slate-500">
                            No connections recorded yet.
                          </div>
                        )}
                    </>
                  ) : (
                    <EgoNetworkView
                      centerName={entity.name}
                      incoming={incomingEdges.map((e) => ({
                        edge: e,
                        otherId: e.source_entity_id,
                      }))}
                      outgoing={outgoingEdges.map((e) => ({
                        edge: e,
                        otherId: e.target_entity_id,
                      }))}
                      idToNameMap={idToNameMap}
                    />
                  )}
                </section>

                {/* Footer link to full entity page */}
                <section className="px-5 py-4">
                  <a
                    href={`/app/space/${entity.space_id}/entity/${entity.id}`}
                    className="block rounded-md border border-slate-200 px-3 py-2 text-center text-[11px] font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Open full entity page →
                  </a>
                </section>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function EdgeRow({
  edge,
  otherId,
  direction,
  idToNameMap,
}: {
  edge: Edge;
  otherId: string;
  direction: "incoming" | "outgoing";
  idToNameMap: Map<string, string>;
}) {
  const polarity = edge.polarity ?? "neutral";
  const polarityColor =
    polarity === "positive"
      ? "#16a34a"
      : polarity === "negative"
        ? "#dc2626"
        : polarity === "conditional"
          ? "#d97706"
          : "#94a3b8";
  const fallbackName = idToNameMap.get(otherId) ?? `${otherId.slice(0, 8)}…`;
  return (
    <li className="flex items-center gap-2 rounded px-1 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50">
      <span
        className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: polarityColor }}
        title={`${polarity} edge`}
      />
      <span className="font-medium text-slate-500">
        {direction === "incoming" ? "from" : "to"}
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-slate-800 hover:text-violet-600"
        onClick={() => {
          window.dispatchEvent(
            new CustomEvent("shell-graph:focus", {
              detail: { entityId: otherId },
            }),
          );
        }}
        title={`Open detail for ${fallbackName}`}
      >
        {fallbackName}
      </button>
      <span className="flex-shrink-0 text-[9.5px] italic text-slate-400">
        {edge.relationship_type ?? "related"}
      </span>
    </li>
  );
}

// ── Phase 6 — Ego-network view ────────────────────────────────────
//
// Center node + columns of upstream (left) and downstream (right).
// Polarity-coded edges, confidence-modulated opacity. Click any
// flanking node → re-fires `shell-graph:focus` so the drawer pivots
// onto that entity, letting the user "walk" the graph one hop at a
// time without leaving the drawer.
//
// Capped at 8 per side; overflow shows a "+N more" pill at the
// bottom of that column. Beyond 8 nodes per side the geometry gets
// too cramped to read at the drawer's 440px width.

interface EgoEdgeRow {
  edge: Edge;
  otherId: string;
}

const EGO_POLARITY_STROKE = {
  positive: "#16a34a",
  negative: "#dc2626",
  conditional: "#d97706",
  neutral: "#94a3b8",
} as const;

function EgoNetworkView({
  centerName,
  incoming,
  outgoing,
  idToNameMap,
}: {
  centerName: string;
  incoming: EgoEdgeRow[];
  outgoing: EgoEdgeRow[];
  idToNameMap: Map<string, string>;
}) {
  const MAX_PER_SIDE = 8;
  const visibleIn = incoming.slice(0, MAX_PER_SIDE);
  const visibleOut = outgoing.slice(0, MAX_PER_SIDE);
  const inOverflow = Math.max(0, incoming.length - visibleIn.length);
  const outOverflow = Math.max(0, outgoing.length - visibleOut.length);

  // SVG viewport sized to fit the drawer body width (drawer is 440px,
  // body padding leaves ~390px). Height grows with the larger column
  // so labels don't overlap.
  const W = 380;
  const ROW_H = 26;
  const TOP_PAD = 14;
  const BOT_PAD = 14;
  const sideRows = Math.max(visibleIn.length, visibleOut.length, 1);
  const H = TOP_PAD + sideRows * ROW_H + BOT_PAD;

  // Geometry — center node x, side columns x.
  const centerX = W / 2;
  const centerY = H / 2;
  const leftColX = 18;
  const rightColX = W - 18;
  const NODE_R = 5;

  // Compute y for each row in a column. When the column has fewer
  // rows than the other side, vertically center its rows so the
  // shorter column doesn't all bunch at the top.
  const yFor = (i: number, count: number) => {
    if (count <= 0) return centerY;
    const colTotalH = count * ROW_H;
    const colStartY = (H - colTotalH) / 2 + ROW_H / 2;
    return colStartY + i * ROW_H;
  };

  return (
    <div className="rounded-md border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-3">
      {visibleIn.length + visibleOut.length === 0 ? (
        <div className="px-2 py-3 text-center text-[11px] italic text-slate-400">
          No connections to render.
        </div>
      ) : (
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          style={{ display: "block", maxWidth: "100%" }}
        >
          {/* ── Edges ── */}
          {visibleIn.map((row, i) => {
            const y = yFor(i, visibleIn.length);
            const polarity = (row.edge.polarity ??
              "neutral") as keyof typeof EGO_POLARITY_STROKE;
            const stroke = EGO_POLARITY_STROKE[polarity];
            const op =
              0.45 +
              Math.max(
                0,
                Math.min(1, (row.edge.confidence as number) ?? 0.5),
              ) *
                0.55;
            return (
              <g key={`in-${row.edge.id}`}>
                <line
                  x1={leftColX + NODE_R}
                  y1={y}
                  x2={centerX - NODE_R - 4}
                  y2={centerY}
                  stroke={stroke}
                  strokeWidth={1.4}
                  opacity={op}
                  strokeDasharray={polarity === "conditional" ? "3 2" : undefined}
                />
                {/* arrow tip pointing toward center */}
                <polygon
                  points={`${centerX - NODE_R - 4},${centerY} ${centerX - NODE_R - 9},${centerY - 3} ${centerX - NODE_R - 9},${centerY + 3}`}
                  fill={stroke}
                  opacity={op}
                />
              </g>
            );
          })}
          {visibleOut.map((row, i) => {
            const y = yFor(i, visibleOut.length);
            const polarity = (row.edge.polarity ??
              "neutral") as keyof typeof EGO_POLARITY_STROKE;
            const stroke = EGO_POLARITY_STROKE[polarity];
            const op =
              0.45 +
              Math.max(
                0,
                Math.min(1, (row.edge.confidence as number) ?? 0.5),
              ) *
                0.55;
            return (
              <g key={`out-${row.edge.id}`}>
                <line
                  x1={centerX + NODE_R + 4}
                  y1={centerY}
                  x2={rightColX - NODE_R}
                  y2={y}
                  stroke={stroke}
                  strokeWidth={1.4}
                  opacity={op}
                  strokeDasharray={polarity === "conditional" ? "3 2" : undefined}
                />
                <polygon
                  points={`${rightColX - NODE_R},${y} ${rightColX - NODE_R - 5},${y - 3} ${rightColX - NODE_R - 5},${y + 3}`}
                  fill={stroke}
                  opacity={op}
                />
              </g>
            );
          })}
          {/* ── Center node ── */}
          <circle
            cx={centerX}
            cy={centerY}
            r={NODE_R + 3}
            fill="rgba(124, 58, 237, 0.18)"
          />
          <circle
            cx={centerX}
            cy={centerY}
            r={NODE_R + 1}
            fill="white"
            stroke="#7c3aed"
            strokeWidth={2}
          />
          <text
            x={centerX}
            y={centerY + NODE_R + 14}
            textAnchor="middle"
            fontSize={9.5}
            fontWeight={700}
            fill="#7c3aed"
          >
            {truncateLabel(centerName, 22)}
          </text>
          {/* ── Upstream nodes (left column) ── */}
          {visibleIn.map((row, i) => {
            const y = yFor(i, visibleIn.length);
            const name = idToNameMap.get(row.otherId) ?? row.otherId.slice(0, 8);
            return (
              <g
                key={`in-node-${row.edge.id}`}
                style={{ cursor: "pointer" }}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("shell-graph:focus", {
                      detail: { entityId: row.otherId },
                    }),
                  )
                }
              >
                <circle
                  cx={leftColX}
                  cy={y}
                  r={NODE_R}
                  fill="white"
                  stroke="rgba(15,23,42,0.45)"
                  strokeWidth={1.5}
                />
                <text
                  x={leftColX + NODE_R + 4}
                  y={y + 3}
                  textAnchor="start"
                  fontSize={10}
                  fill="#0f172a"
                >
                  {truncateLabel(name, 24)}
                </text>
                <title>
                  {`${name} → ${centerName} (${row.edge.relationship_type ?? "related"})`}
                </title>
              </g>
            );
          })}
          {/* ── Downstream nodes (right column) ── */}
          {visibleOut.map((row, i) => {
            const y = yFor(i, visibleOut.length);
            const name = idToNameMap.get(row.otherId) ?? row.otherId.slice(0, 8);
            return (
              <g
                key={`out-node-${row.edge.id}`}
                style={{ cursor: "pointer" }}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("shell-graph:focus", {
                      detail: { entityId: row.otherId },
                    }),
                  )
                }
              >
                <circle
                  cx={rightColX}
                  cy={y}
                  r={NODE_R}
                  fill="white"
                  stroke="rgba(15,23,42,0.45)"
                  strokeWidth={1.5}
                />
                <text
                  x={rightColX - NODE_R - 4}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={10}
                  fill="#0f172a"
                >
                  {truncateLabel(name, 24)}
                </text>
                <title>
                  {`${centerName} → ${name} (${row.edge.relationship_type ?? "related"})`}
                </title>
              </g>
            );
          })}
        </svg>
      )}
      {/* Column headers + overflow hints */}
      <div className="mt-2 flex items-center justify-between gap-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">
        <div className="flex items-center gap-1">
          <ArrowDownRight className="h-2.5 w-2.5" />
          Upstream {incoming.length}
          {inOverflow > 0 && (
            <span className="ml-1 italic text-slate-300">
              (+{inOverflow} hidden)
            </span>
          )}
        </div>
        <div className="text-center text-violet-500">click to walk</div>
        <div className="flex items-center gap-1">
          Downstream {outgoing.length}
          {outOverflow > 0 && (
            <span className="ml-1 italic text-slate-300">
              (+{outOverflow} hidden)
            </span>
          )}
          <ArrowUpRight className="h-2.5 w-2.5" />
        </div>
      </div>
    </div>
  );
}

function truncateLabel(s: string, n: number): string {
  if (!s) return "—";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

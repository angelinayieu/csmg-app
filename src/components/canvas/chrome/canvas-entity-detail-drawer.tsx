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
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileBarChart,
  Layers,
  Loader2,
  Network,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import type { Entity, Edge } from "@/types";
import type { NodeSignature } from "@/types/node-signature";
import type { EvidenceRegistryRow } from "@/types/evidence-registry";
import type { LayerOntologyRow } from "@/types/layer-ontology";
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
import { NodeSignatureBlock } from "@/components/signatures/node-signature-block";
import { cn } from "@/lib/utils";
import { useFullscreenDrawer } from "@/components/canvas/drawers/use-fullscreen-drawer";
import { DrawerFullscreenButton } from "@/components/canvas/drawers/drawer-fullscreen-button";

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
  /** Phase 3 — L2M evidence rows attached to this entity. Drives
   *  the rigor strip badge count + the Evidence section. Empty when
   *  no extracted evidence is bound. */
  evidence?: EvidenceRegistryRow[];
  /** Phase 3 — per-space layer_ontology row for entity.layer_ontology_id.
   *  Null when the entity uses the legacy knowledge_layer enum. */
  layer_ontology_row?: LayerOntologyRow | null;
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

  const { isFullscreen, toggleFullscreen } = useFullscreenDrawer(open !== null);

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
        className={cn(
          "fixed right-0 top-0 z-[70] h-screen overflow-hidden border-l border-slate-200 bg-white shadow-[0_24px_48px_-16px_rgba(15,23,42,0.18)] transition-[width] duration-200 ease-out",
          isFullscreen ? "w-screen" : "w-[440px]",
        )}
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
                <DrawerFullscreenButton
                  isFullscreen={isFullscreen}
                  onToggle={toggleFullscreen}
                />
                <button
                  type="button"
                  onClick={close}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                  title="Close"
                  aria-label="Close"
                >
                  <X className="h-3.5 w-3.5" />
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
                {/* P3 · cross-paper attribution. Click → popover lists
                    supporting papers. Hidden when the column is empty
                    (manual entities, decompose-emitted, template seeds). */}
                {Array.isArray(entity.literature_sources) &&
                  entity.literature_sources.filter(
                    (s) => typeof s === "string" && s.length > 0,
                  ).length > 0 && (
                    <EntityLiteratureBadge
                      entityId={entity.id}
                      count={
                        entity.literature_sources.filter(
                          (s) => typeof s === "string" && s.length > 0,
                        ).length
                      }
                    />
                  )}
                {/* Phase 3 — per-space layer ontology chip overrides
                    the legacy depth-based layer chip when an active
                    plan materialized a topic-adaptive ontology. */}
                {payload?.layer_ontology_row && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{
                      background: `color-mix(in srgb, ${payload.layer_ontology_row.color ?? "#94a3b8"} 14%, transparent)`,
                      color: payload.layer_ontology_row.color ?? "#475569",
                    }}
                    title={`Per-space layer ${payload.layer_ontology_row.ordinal}: ${payload.layer_ontology_row.description ?? ""}`}
                  >
                    <Layers className="h-3 w-3" />
                    {payload.layer_ontology_row.label}
                  </span>
                )}
              </div>
            )}
            {/* Phase 3 — Rigor strip. At-a-glance answer to "is this
                a trustworthy node?" Surfaces authority_level (trust
                tier), causal_role, source_tag, and the count of
                evidence rows attached to this entity. Each badge is
                title-tooltipped with its meaning. */}
            {entity && (
              <RigorStrip
                entity={entity}
                evidenceCount={payload?.evidence?.length ?? 0}
              />
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
                    <NodeSignatureBlock
                      variant="inline"
                      signature={signature}
                      size={88}
                      showResolution
                    />
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

                {/* Phase 3 — Evidence section. L2M-style provenance:
                    each row carries effect_size + CI + study design +
                    the LLM-half / parser-half trust boundary so the
                    user can audit "what backs this claim". */}
                <EvidenceSection rows={payload?.evidence ?? []} />

                {/* Phase 3 — Provenance section. Origin metadata: who
                    extracted the entity, from which source, with what
                    confidence. Renders entities.provenance JSONB and
                    related fields cleanly. */}
                <ProvenanceSection
                  entity={entity}
                  ontologyRow={payload?.layer_ontology_row ?? null}
                />

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

// ── Edge row with inline dynamics picker (Phase 6B) ──────────────
//
// Each row shows: polarity dot + direction + partner name +
// relationship type + dynamics badge. Clicking the dynamics badge
// opens an inline select with the 10-value enum. Save → PATCH
// /api/edges/[id]. When the edge has pooled metadata (Phase 6A),
// a tiny "pooled" badge appears next to the dynamics chip.

const EDGE_DYNAMICS_OPTIONS: Array<{
  value: string;
  label: string;
  hint: string;
}> = [
  { value: "linear", label: "Linear", hint: "Effect scales 1:1 with input." },
  { value: "hill", label: "Hill", hint: "Saturating S-curve (Hill / sigmoid)." },
  { value: "emax", label: "Emax", hint: "Hyperbolic saturation (E_max model)." },
  {
    value: "threshold",
    label: "Threshold",
    hint: "Step at a critical input level.",
  },
  {
    value: "compounding",
    label: "Compounding",
    hint: "Multiplicative / exponential gain.",
  },
  {
    value: "exponential",
    label: "Exponential",
    hint: "Exponential growth in input.",
  },
  {
    value: "logarithmic",
    label: "Logarithmic",
    hint: "Diminishing log returns.",
  },
  {
    value: "decay",
    label: "Decay",
    hint: "Effect fades over time / dose.",
  },
  {
    value: "step_function",
    label: "Step",
    hint: "Discrete step at a boundary.",
  },
  { value: "delayed", label: "Delayed", hint: "Lag before onset." },
];

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ee = edge as any;
  const initialDynamics = (ee.dynamics as string | null) ?? "linear";
  const dynProps = (ee.dynamics_properties as Record<string, unknown> | null) ?? null;
  const isPooled =
    dynProps &&
    typeof dynProps === "object" &&
    Object.prototype.hasOwnProperty.call(dynProps, "pooling_metadata");
  // P2 · D14 follow-up: literature_sources is text[] of asset ids that
  // support this edge. Empty for legacy edges; surfaces a paper count
  // badge when populated by the asset pipeline.
  const litSources = Array.isArray(edge.literature_sources)
    ? edge.literature_sources.filter((s) => typeof s === "string" && s.length > 0)
    : [];
  const litCount = litSources.length;
  const [dynamics, setDynamics] = useState<string>(initialDynamics);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSave = async (newValue: string) => {
    if (newValue === dynamics) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/edges/${edge.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dynamics: newValue }),
      });
      if (res.ok) {
        setDynamics(newValue);
      } else {
        console.warn("[edge dynamics] PATCH failed:", await res.text());
      }
    } catch (err) {
      console.warn("[edge dynamics] fetch failed:", err);
    } finally {
      setBusy(false);
      setEditing(false);
    }
  };

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
      {isPooled && (
        <span
          className="flex-shrink-0 rounded bg-emerald-50 px-1 py-0.5 text-[9px] font-semibold text-emerald-700"
          title="Edge strength pooled from evidence (REML τ²). See dynamics_properties.pooling_metadata for the full audit."
        >
          pooled
        </span>
      )}
      {litCount > 0 && (
        <EdgeLiteratureBadge edgeId={edge.id} count={litCount} />
      )}
      {editing ? (
        <select
          autoFocus
          disabled={busy}
          value={dynamics}
          onChange={(e) => onSave(e.target.value)}
          onBlur={() => setEditing(false)}
          className="flex-shrink-0 rounded border border-violet-300 bg-white px-1 py-0.5 text-[10px] font-semibold text-slate-700 focus:border-violet-500 focus:outline-none"
        >
          {EDGE_DYNAMICS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} title={o.hint}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex-shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-violet-700 transition hover:bg-violet-100"
          title="Edit response model (linear / hill / emax / …)"
        >
          {EDGE_DYNAMICS_OPTIONS.find((o) => o.value === dynamics)?.label ??
            dynamics}
        </button>
      )}
      <span className="flex-shrink-0 text-[9.5px] italic text-slate-400">
        {edge.relationship_type ?? "related"}
      </span>
    </li>
  );
}

// ── Edge literature-sources popover (P2 / D14 follow-up) ─────────
//
// Click the 📚 N badge → fetch /api/edges/[id]/sources → render a
// small list of supporting papers (source_name + asset_class +
// optional source_url link). Lazy-fetches on first open and caches
// the result for the lifetime of the badge.
//
// Visual: anchored absolute popover above the edge row. Closes on
// outside click via a backdrop layer. Keeps its own loading/error
// state — soft-fails to "no papers found" if the endpoint returns
// an empty list (shouldn't happen if the badge rendered, but cheap
// insurance against race conditions where the asset got deleted
// between read + click).

interface PaperMetadata {
  title: string | null;
  authors: string[];
  year: number | null;
  doi: string | null;
}

interface PaperRef {
  asset_id: string;
  source_name: string | null;
  source_url: string | null;
  asset_class: string | null;
  paper_metadata: PaperMetadata | null;
}

/** Format a paper's display name with metadata fallback chain:
 *  paper title → source_name (filename) → assetId prefix. */
function formatPaperLabel(p: PaperRef): string {
  if (p.paper_metadata?.title && p.paper_metadata.title.trim().length > 0) {
    return p.paper_metadata.title;
  }
  if (p.source_name && p.source_name.trim().length > 0) {
    return p.source_name;
  }
  return `${p.asset_id.slice(0, 8)}…`;
}

/** Format authors line: "Smith" → "Smith"; "Smith, Doe" → "Smith & Doe";
 *  3+ → "Smith et al." If empty, returns null. Year is appended when
 *  available: "Smith et al. 2023". */
function formatAuthorsLine(meta: PaperMetadata | null): string | null {
  if (!meta) return null;
  const yearStr = meta.year ? ` ${meta.year}` : "";
  const authors = meta.authors;
  if (authors.length === 0) {
    return yearStr.trim().length > 0 ? yearStr.trim() : null;
  }
  if (authors.length === 1) return `${authors[0]}${yearStr}`;
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}${yearStr}`;
  return `${authors[0]} et al.${yearStr}`;
}

function LiteratureBadge({
  endpoint,
  count,
  size = "edge",
}: {
  endpoint: string;
  count: number;
  /** "edge": tiny inline badge (used in EdgeRow). "chip": header-chip
   *  size matching kind/layer chips (used in entity drawer header). */
  size?: "edge" | "chip";
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [papers, setPapers] = useState<PaperRef[] | null>(null);
  const [errored, setErrored] = useState(false);

  const onToggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (papers !== null || loading) return;
    setLoading(true);
    setErrored(false);
    try {
      const res = await fetch(endpoint, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { papers?: PaperRef[] };
      setPapers(Array.isArray(data?.papers) ? data.papers : []);
    } catch (err) {
      console.warn(`[literature popover] fetch failed for ${endpoint}:`, err);
      setErrored(true);
      setPapers([]);
    } finally {
      setLoading(false);
    }
  };

  const buttonClass =
    size === "chip"
      ? "inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 transition hover:bg-violet-200"
      : "flex items-center gap-0.5 rounded bg-violet-50 px-1 py-0.5 text-[9px] font-semibold text-violet-700 transition hover:bg-violet-100";

  return (
    <span className="relative flex-shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void onToggle();
        }}
        className={buttonClass}
        title={`Supported by ${count} ingested paper${count === 1 ? "" : "s"} — click to view`}
      >
        <BookOpen className={size === "chip" ? "h-3 w-3" : "h-2.5 w-2.5"} />
        {count}
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className={cn(
              "absolute right-0 z-50 w-64 rounded-md border border-slate-200 bg-white p-2 text-[10px] shadow-lg",
              size === "chip" ? "top-full mt-1" : "bottom-full mb-1",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between border-b border-slate-100 pb-1">
              <span className="font-semibold uppercase tracking-wide text-slate-500">
                Supporting papers
              </span>
              <span className="text-slate-400">{count}</span>
            </div>
            {loading && (
              <div className="flex items-center gap-1.5 px-1 py-2 text-slate-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading…
              </div>
            )}
            {!loading && errored && (
              <div className="px-1 py-2 italic text-rose-600">
                Couldn&apos;t load papers.
              </div>
            )}
            {!loading && !errored && papers !== null && papers.length === 0 && (
              <div className="px-1 py-2 italic text-slate-400">
                No live papers (sources may have been removed).
              </div>
            )}
            {!loading && !errored && papers !== null && papers.length > 0 && (
              <ul className="space-y-1">
                {papers.map((p) => {
                  const label = formatPaperLabel(p);
                  const authorsLine = formatAuthorsLine(p.paper_metadata);
                  // Prefer DOI link when present (paper canonical); fall
                  // back to source_url (uploaded URL or signed asset url).
                  const doi = p.paper_metadata?.doi ?? null;
                  const externalHref = doi
                    ? doi.startsWith("http")
                      ? doi
                      : `https://doi.org/${encodeURIComponent(doi)}`
                    : p.source_url;
                  const externalTitle = doi
                    ? `Open DOI: ${doi}`
                    : "Open source URL";
                  return (
                    <li
                      key={p.asset_id}
                      className="flex items-start gap-1.5 rounded px-1 py-0.5 hover:bg-slate-50"
                    >
                      <BookOpen className="mt-0.5 h-2.5 w-2.5 flex-shrink-0 text-violet-500" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-slate-800">
                          {label}
                        </div>
                        {authorsLine && (
                          <div className="truncate text-[9.5px] text-slate-500">
                            {authorsLine}
                          </div>
                        )}
                        {p.asset_class && !authorsLine && (
                          <div className="text-[9px] uppercase tracking-wide text-slate-400">
                            {p.asset_class}
                          </div>
                        )}
                      </div>
                      {externalHref && (
                        <a
                          href={externalHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0 text-slate-400 hover:text-violet-600"
                          title={externalTitle}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </span>
  );
}

function EdgeLiteratureBadge({
  edgeId,
  count,
}: {
  edgeId: string;
  count: number;
}) {
  return (
    <LiteratureBadge
      endpoint={`/api/edges/${edgeId}/sources`}
      count={count}
      size="edge"
    />
  );
}

function EntityLiteratureBadge({
  entityId,
  count,
}: {
  entityId: string;
  count: number;
}) {
  return (
    <LiteratureBadge
      endpoint={`/api/entities/${entityId}/sources`}
      count={count}
      size="chip"
    />
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

// ── Rigor strip ───────────────────────────────────────────────────
//
// Phase 3 — at-a-glance trust + provenance metadata for a node.
// Renders below the kind/layer chips in the drawer header. Each
// badge is omitted when its underlying field is null so the row
// stays compact for sparse entities.

const AUTHORITY_BADGE: Record<
  string,
  { label: string; bg: string; fg: string; tip: string }
> = {
  high: {
    label: "Verified",
    bg: "bg-emerald-50",
    fg: "text-emerald-700",
    tip: "Authority: high — corroborated by reviewed evidence or expert sources.",
  },
  moderate: {
    label: "Likely",
    bg: "bg-blue-50",
    fg: "text-blue-700",
    tip: "Authority: moderate — plausible but not yet corroborated by reviewed evidence.",
  },
  low: {
    label: "Untested",
    bg: "bg-slate-100",
    fg: "text-slate-600",
    tip: "Authority: low — sourced from training-data prior, not from reviewed evidence.",
  },
  unverified: {
    label: "Unverified",
    bg: "bg-amber-50",
    fg: "text-amber-700",
    tip: "Authority: unverified — no source has substantiated this entity yet.",
  },
};

const CAUSAL_ROLE_BADGE: Record<string, { label: string; tip: string }> = {
  truth: { label: "Truth", tip: "Causal role: truth — a load-bearing claim." },
  evidence: {
    label: "Evidence",
    tip: "Causal role: evidence — supports or refutes other entities.",
  },
  deliverable: {
    label: "Deliverable",
    tip: "Causal role: deliverable — a buildable / shippable artifact.",
  },
  application: {
    label: "Application",
    tip: "Causal role: application — an intervention or capability deployed.",
  },
  outcome: {
    label: "Outcome",
    tip: "Causal role: outcome — a measurable result the user wants to change.",
  },
  goal: {
    label: "Goal",
    tip: "Causal role: goal — a stated objective for the system.",
  },
};

const SOURCE_TAG_BADGE: Record<string, { label: string; tip: string }> = {
  explicit: {
    label: "Explicit",
    tip: "Source tag: explicit — directly stated in the user's input or evidence.",
  },
  implicit: {
    label: "Implicit",
    tip: "Source tag: implicit — inferred from context but not stated.",
  },
  assumed: {
    label: "Assumed",
    tip: "Source tag: assumed — placeholder until corroborating evidence lands.",
  },
  stated: {
    label: "Stated",
    tip: "Source tag: stated.",
  },
  inferred: {
    label: "Inferred",
    tip: "Source tag: inferred.",
  },
  predicted: {
    label: "Predicted",
    tip: "Source tag: predicted.",
  },
};

function RigorStrip({
  entity,
  evidenceCount,
}: {
  entity: Entity;
  evidenceCount: number;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = entity as any;
  const authority = (e.authority_level as string | null) ?? null;
  const causalRole = (e.causal_role as string | null) ?? null;
  const sourceTag = (e.source_tag as string | null) ?? null;
  const confidence =
    typeof e.confidence === "number" && Number.isFinite(e.confidence)
      ? e.confidence
      : null;

  const authBadge = authority ? AUTHORITY_BADGE[authority] : null;
  const roleBadge = causalRole ? CAUSAL_ROLE_BADGE[causalRole] : null;
  const sourceBadge = sourceTag ? SOURCE_TAG_BADGE[sourceTag] : null;

  // Skip the row entirely when nothing to show — avoids an empty
  // strip on minimal entities.
  if (
    !authBadge &&
    !roleBadge &&
    !sourceBadge &&
    confidence === null &&
    evidenceCount === 0
  ) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {authBadge && (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            authBadge.bg,
            authBadge.fg,
          )}
          title={authBadge.tip}
        >
          <ShieldCheck className="h-3 w-3" />
          {authBadge.label}
        </span>
      )}
      {roleBadge && (
        <span
          className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700"
          title={roleBadge.tip}
        >
          {roleBadge.label}
        </span>
      )}
      {sourceBadge && (
        <span
          className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
          title={sourceBadge.tip}
        >
          {sourceBadge.label}
        </span>
      )}
      {confidence !== null && (
        <span
          className="inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
          title={`Confidence ${(confidence * 100).toFixed(0)}% — derived from extraction or LLM self-report.`}
        >
          {(confidence * 100).toFixed(0)}%
        </span>
      )}
      {evidenceCount > 0 && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-700"
          title={`${evidenceCount} evidence row${evidenceCount === 1 ? "" : "s"} attached. See Evidence section below.`}
        >
          <FileBarChart className="h-3 w-3" />
          {evidenceCount}
        </span>
      )}
    </div>
  );
}

// ── Evidence section ─────────────────────────────────────────────
//
// Per-entity rollup of evidence_registries rows where
// attached_entity_id = entity.id. Each row carries L2M-style full
// provenance: effect size + CI + study design + LLM label + parser
// extraction (the trust boundary). For v1 we render a compact row
// per evidence; clicking expands to show the verbatim source quote
// + parser provenance.

function EvidenceSection({ rows }: { rows: EvidenceRegistryRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <section className="border-b border-slate-100 px-5 py-4">
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
          Evidence
        </h3>
        <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-center text-[11px] text-slate-500">
          No evidence rows attached. Drop a paper on the canvas + run
          extraction to bind evidence to this entity.
        </div>
      </section>
    );
  }

  return (
    <section className="border-b border-slate-100 px-5 py-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
          Evidence ({rows.length})
        </h3>
      </div>
      <ul className="space-y-1.5">
        {rows.slice(0, 8).map((row) => {
          const isExpanded = expanded === row.id;
          const ci =
            row.ci_lower !== null && row.ci_upper !== null
              ? `[${row.ci_lower}, ${row.ci_upper}]`
              : null;
          const reviewBadge =
            row.status === "reviewed" ? (
              <span className="rounded bg-emerald-50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-700">
                reviewed
              </span>
            ) : row.status === "rejected" ? (
              <span className="rounded bg-red-50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-red-700">
                rejected
              </span>
            ) : (
              <span className="rounded bg-amber-50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700">
                needs review
              </span>
            );
          return (
            <li
              key={row.id}
              className="rounded-md border border-slate-100 bg-slate-50/50 px-3 py-2"
            >
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : row.id)}
                className="flex w-full items-start justify-between gap-2 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-[11.5px] font-semibold text-slate-800">
                      {row.effect_metric ?? "effect"}{" "}
                      {row.effect_size !== null ? row.effect_size : "—"}
                    </span>
                    {ci && (
                      <span className="font-mono text-[10.5px] text-slate-500">
                        {ci}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-600">
                    {row.outcome_label ?? row.intervention_label ?? "Untitled effect"}
                  </div>
                  {row.study_design && (
                    <div className="mt-0.5 text-[10px] text-slate-500">
                      {row.study_design}
                      {row.population_label ? ` · ${row.population_label}` : ""}
                      {row.followup_label ? ` · ${row.followup_label}` : ""}
                    </div>
                  )}
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  {reviewBadge}
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3 text-slate-400" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-slate-400" />
                  )}
                </div>
              </button>
              {isExpanded && (
                <div className="mt-2 space-y-1.5 border-t border-slate-200 pt-2">
                  {row.source_quote && (
                    <div>
                      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">
                        Source quote
                      </div>
                      <div className="mt-0.5 text-[11px] italic text-slate-700">
                        “{truncateLabel(row.source_quote, 220)}”
                      </div>
                    </div>
                  )}
                  {Array.isArray(row.flags) && row.flags.length > 0 && (
                    <div>
                      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">
                        Parser flags
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {row.flags.map((f) => (
                          <span
                            key={f}
                            className="rounded bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-700"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {row.parser_provenance && (
                    <div>
                      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">
                        Parser
                      </div>
                      <div className="mt-0.5 font-mono text-[10.5px] text-slate-600">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(row.parser_provenance as any).module ?? "(none)"}@
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(row.parser_provenance as any).version ?? "?"}
                      </div>
                    </div>
                  )}
                  {typeof row.extraction_confidence === "number" && (
                    <div className="text-[10.5px] text-slate-600">
                      Extraction confidence ·{" "}
                      {(row.extraction_confidence * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {rows.length > 8 && (
          <li className="px-1 text-[10px] italic text-slate-400">
            +{rows.length - 8} more — open the global Evidence drawer to review.
          </li>
        )}
      </ul>
    </section>
  );
}

// ── Provenance section ───────────────────────────────────────────
//
// Origin metadata: which agent/pass added the entity, what space it
// belongs to, what its layer in the per-space ontology is. Renders
// entities.provenance JSONB cleanly when present.

function ProvenanceSection({
  entity,
  ontologyRow,
}: {
  entity: Entity;
  ontologyRow: LayerOntologyRow | null;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = entity as any;
  const provenance = (e.provenance as Record<string, unknown> | null) ?? null;
  const provenanceEntries = provenance ? Object.entries(provenance) : [];

  // Skip the section entirely if there's nothing to show — avoids a
  // sparse "Provenance: —" rectangle on minimal entities.
  if (provenanceEntries.length === 0 && !ontologyRow) return null;

  return (
    <section className="border-b border-slate-100 px-5 py-4">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
        Provenance
      </h3>
      <div className="space-y-2">
        {ontologyRow && (
          <div className="rounded-md border border-slate-100 bg-slate-50/50 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Layer ontology
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                style={{ background: ontologyRow.color ?? "#94a3b8" }}
              />
              <span className="text-[11.5px] font-semibold text-slate-800">
                {ontologyRow.ordinal}. {ontologyRow.label}
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                {ontologyRow.slug}
              </span>
            </div>
            {ontologyRow.description && (
              <div className="mt-1 text-[11px] text-slate-600">
                {ontologyRow.description}
              </div>
            )}
            <div className="mt-1 text-[10px] text-slate-500">
              Source · {ontologyRow.ontology_source}
            </div>
          </div>
        )}
        {provenanceEntries.length > 0 && (
          <div className="rounded-md border border-slate-100 bg-slate-50/50 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Origin metadata
            </div>
            <dl className="mt-1 space-y-1">
              {provenanceEntries.slice(0, 8).map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-2">
                  <dt className="flex-shrink-0 text-[10.5px] font-semibold text-slate-500">
                    {k.replace(/_/g, " ")}
                  </dt>
                  <dd className="min-w-0 flex-1 truncate text-[10.5px] text-slate-700">
                    {typeof v === "string"
                      ? v
                      : typeof v === "number" || typeof v === "boolean"
                        ? String(v)
                        : JSON.stringify(v).slice(0, 120)}
                  </dd>
                </div>
              ))}
              {provenanceEntries.length > 8 && (
                <div className="text-[10px] italic text-slate-400">
                  +{provenanceEntries.length - 8} more fields
                </div>
              )}
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}

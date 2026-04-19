"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { Entity, Edge, Cycle } from "@/types";
import {
  ResearchAgentLogo, ArxivLogo, SemanticScholarLogo, GoogleScholarLogo,
  WikipediaLogo, WebSearchLogo, ClaudeOpusLogo, ChatGPTLogo, GeminiLogo,
  GmailLogo, GoogleCalendarLogo, GoogleDriveLogo, GoogleDocsLogo,
  SlackLogo, TeamsLogo, NotionLogo, FigmaLogo, GitHubLogo, LinearLogo,
  JiraLogo, DropboxLogo,
} from "./integration-logos";

/* ================================================================
   STYLES — glass-morphism + animated spheres
   ================================================================ */

const panelStyles = `
  @keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.35)} }
  @keyframes rise { to { opacity: 1; transform: translateY(0); } }

  .inv-panel {
    position: relative;
    background: rgba(255,255,255,0.45);
    backdrop-filter: blur(48px) saturate(185%);
    -webkit-backdrop-filter: blur(48px) saturate(185%);
    border: 1px solid rgba(255,255,255,0.85);
    border-radius: 24px;
    box-shadow: 0 32px 72px -24px rgba(8,60,180,0.22), 0 12px 30px -14px rgba(8,60,180,0.14), inset 0 1.5px 0 rgba(255,255,255,1), inset 0 0 0 1px rgba(255,255,255,0.35);
    overflow: hidden;
    opacity: 0; transform: translateY(12px);
    animation: rise 0.8s 0.2s forwards cubic-bezier(0.22,1,0.36,1);
  }
  .inv-panel::after {
    content: ''; position: absolute; inset: 0; border-radius: inherit;
    background: linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0) 55%);
    pointer-events: none;
  }
`;

/* ================================================================
   TYPES
   ================================================================ */

type StatusFilter = "all" | "verified" | "predicted" | "assumed";

const SOURCE_TAG_MAP: Record<string, StatusFilter> = {
  explicit: "verified",
  implicit: "predicted",
  assumed: "assumed",
};

const TAG_DISPLAY: Record<StatusFilter, { label: string; cls: string; dotCls: string }> = {
  all: { label: "All", cls: "", dotCls: "bg-[#1a7aff] shadow-[0_0_5px_#1a7aff]" },
  verified: { label: "Verified", cls: "bg-[rgba(36,195,110,0.14)] text-[#1a9553]", dotCls: "bg-[#24c36e] shadow-[0_0_5px_#24c36e]" },
  predicted: { label: "Predicted", cls: "bg-[rgba(255,149,0,0.14)] text-[#c77400]", dotCls: "bg-[#ff9500] shadow-[0_0_5px_#ff9500]" },
  assumed: { label: "Assumed", cls: "bg-[rgba(88,86,214,0.14)] text-[#3c44d9]", dotCls: "bg-[#5856d6] shadow-[0_0_5px_#5856d6]" },
};

/* ================================================================
   GLYPH ICONS (inline SVG for summary tiles)
   ================================================================ */

function FrameworkIcon() { return <svg viewBox="0 0 24 24" className="w-[17px] h-[17px] relative z-[1] text-[#0051ff]"><rect x="4" y="5" width="11" height="3.2" rx="1.4" fill="currentColor" opacity="0.55"/><rect x="7" y="10.4" width="11" height="3.2" rx="1.4" fill="currentColor" opacity="0.78"/><rect x="10" y="15.8" width="11" height="3.2" rx="1.4" fill="currentColor"/></svg>; }
function ConceptIcon() { return <svg viewBox="0 0 24 24" className="w-[17px] h-[17px] relative z-[1] text-[#0051ff]"><line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="1.2" opacity="0.55" strokeLinecap="round"/><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="1.2" opacity="0.55" strokeLinecap="round"/><circle cx="12" cy="4.5" r="1.8" fill="currentColor"/><circle cx="12" cy="19.5" r="1.8" fill="currentColor"/><circle cx="4.5" cy="12" r="1.8" fill="currentColor"/><circle cx="19.5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg>; }
function SubcompIcon() { return <svg viewBox="0 0 24 24" className="w-[17px] h-[17px] relative z-[1] text-[#0051ff]"><path d="M12 3 L20 7.5 L20 16.5 L12 21 L4 16.5 L4 7.5 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M4 7.5 L12 12 L20 7.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M12 12 L12 21" stroke="currentColor" strokeWidth="1.5"/><path d="M12 12 L20 7.5 L20 16.5 L12 21 Z" fill="currentColor" opacity="0.32"/></svg>; }
function ExternalIcon() { return <svg viewBox="0 0 24 24" className="w-[17px] h-[17px] relative z-[1] text-[#0051ff]"><circle cx="12" cy="12" r="2.2" fill="currentColor"/><ellipse cx="12" cy="12" rx="8.5" ry="3.2" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.85"/><ellipse cx="12" cy="12" rx="3.2" ry="8.5" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.6"/><circle cx="12" cy="12" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.35"/></svg>; }
function ConnectionIcon() { return <svg viewBox="0 0 24 24" className="w-[17px] h-[17px] relative z-[1] text-[#0051ff]"><circle cx="5" cy="5" r="2.5" fill="currentColor"/><circle cx="19" cy="5" r="2.5" fill="currentColor"/><circle cx="12" cy="19" r="2.5" fill="currentColor"/><line x1="6.5" y1="6.5" x2="11" y2="17" stroke="currentColor" strokeWidth="1.5"/><line x1="17.5" y1="6.5" x2="13" y2="17" stroke="currentColor" strokeWidth="1.5"/><line x1="7" y1="5" x2="17" y2="5" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/></svg>; }
function VerifiedIcon() { return <svg viewBox="0 0 24 24" className="w-[17px] h-[17px] relative z-[1] text-[#0051ff]"><path d="M12 2 L4 5.5 V12 a10 10 0 0 0 8 9 a10 10 0 0 0 8 -9 V5.5 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M8.5 12 L11 14.5 L15.5 9.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function PredictedIcon() { return <svg viewBox="0 0 24 24" className="w-[17px] h-[17px] relative z-[1] text-[#0051ff]"><path d="M13 2 L3 14 H12 L11 22 L21 10 H12 L13 2 Z" fill="currentColor"/></svg>; }
function NeedsReviewIcon() { return <svg viewBox="0 0 24 24" className="w-[17px] h-[17px] relative z-[1] text-[#0051ff]"><path d="M12 2 L22 20 H2 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><line x1="12" y1="9" x2="12" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>; }
function ConnSmallIcon() { return <svg viewBox="0 0 24 24" className="w-[11px] h-[11px]"><circle cx="6" cy="6" r="2" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="18" cy="6" r="2" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="18" r="2" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M7.5 7.5 L10.5 16.5 M16.5 7.5 L13.5 16.5" stroke="currentColor" strokeWidth="1.5"/></svg>; }

/* ================================================================
   GAUGE component (confidence ring)
   ================================================================ */

function ConfGauge({ value, size = 32 }: { value: number; size?: number }) {
  const pct = Math.round(value * 100);
  const r = 13;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - value);
  const tier = pct >= 75 ? "high" : pct >= 50 ? "mid" : "low";
  const colors = { high: "#24c36e", mid: "#ff9500", low: "#ff4d4d" };
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 32" className="w-full h-full" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="16" cy="16" r={r} fill="none" stroke="rgba(10,30,80,0.08)" strokeWidth="3" />
        <circle cx="16" cy="16" r={r} fill="none" stroke={colors[tier]} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          style={{ filter: `drop-shadow(0 0 4px ${colors[tier]}80)`, transition: "stroke-dashoffset 1s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-[#0a1020] tracking-tight">{pct}</div>
    </div>
  );
}

/* ================================================================
   SUMMARY TILE
   ================================================================ */

function SummaryTile({ icon, name, count }: { icon: React.ReactNode; name: string; count: number }) {
  return (
    <div className="grid grid-cols-[36px_1fr] gap-[11px] items-center p-3 bg-white/55 border border-white/85 rounded-xl cursor-pointer backdrop-blur-[12px] transition-all duration-300 hover:bg-white/90 hover:-translate-y-0.5 shadow-[0_2px_8px_rgba(8,60,180,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] hover:shadow-[0_10px_26px_-10px_rgba(8,60,180,0.16),0_3px_10px_rgba(8,60,180,0.08),inset_0_1px_0_rgba(255,255,255,0.95)]">
      <div className="w-9 h-9 rounded-[10px] grid place-items-center bg-gradient-to-br from-white/92 via-[rgba(225,238,255,0.72)] to-[rgba(150,190,255,0.58)] border border-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),inset_0_-2px_5px_rgba(26,122,255,0.14),0_3px_8px_rgba(8,60,180,0.1)] relative overflow-hidden backdrop-blur-[14px]">
        {icon}
      </div>
      <div>
        <div className="text-[13.5px] font-bold text-[#0a1020] leading-tight tracking-[-0.015em]">{name}</div>
        <div className="text-[11.5px] text-[#556479] mt-0.5 font-medium"><strong className="text-[#0a1020] font-bold tabular-nums">{count}</strong> entities</div>
      </div>
    </div>
  );
}

/* ================================================================
   ENTITY TILE
   ================================================================ */

function EntityTile({ entity, connCount, onClick }: { entity: Entity; connCount: number; onClick: () => void }) {
  const status = SOURCE_TAG_MAP[entity.source_tag] ?? "assumed";
  const tagCfg = TAG_DISPLAY[status];
  const typeLabel = `${entity.entity_type ?? "concept"}${entity.entity_category ? ` · ${entity.entity_category}` : ""}`;

  return (
    <div
      onClick={onClick}
      className="relative bg-white/[0.62] border border-white/85 rounded-[14px] p-[14px_16px_12px] cursor-pointer backdrop-blur-[14px] transition-all duration-300 flex flex-col overflow-hidden shadow-[0_2px_8px_rgba(8,60,180,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] hover:bg-white/95 hover:-translate-y-0.5 hover:border-[rgba(26,122,255,0.3)] hover:shadow-[0_16px_32px_-12px_rgba(8,60,180,0.2),0_4px_12px_rgba(8,60,180,0.08),inset_0_1px_0_white]"
    >
      <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-br from-white/25 to-transparent pointer-events-none" />

      {/* Head: icon + gauge */}
      <div className="flex items-start justify-between gap-2.5 mb-[11px] relative z-[1]">
        <div className="w-9 h-9 rounded-[10px] grid place-items-center bg-gradient-to-br from-white/92 via-[rgba(225,238,255,0.72)] to-[rgba(150,190,255,0.58)] border border-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),inset_0_-2px_5px_rgba(26,122,255,0.14),0_3px_8px_rgba(8,60,180,0.1)] relative overflow-hidden backdrop-blur-[14px] flex-shrink-0">
          {entity.knowledge_layer === "external" ? <ExternalIcon /> : entity.entity_category === "process" ? <SubcompIcon /> : <ConceptIcon />}
        </div>
        <ConfGauge value={entity.confidence} />
      </div>

      {/* Name */}
      <div className="text-[14px] font-bold text-[#0a1020] tracking-[-0.015em] leading-[1.25] mb-1 line-clamp-2 min-h-[2.5em] relative z-[1]">
        {entity.name}
      </div>

      {/* Type */}
      <div className="text-[10.5px] font-semibold text-[#556479] tracking-[0.06em] uppercase mb-3 relative z-[1] truncate">
        {typeLabel}
      </div>

      {/* Foot */}
      <div className="mt-auto pt-[11px] border-t border-[rgba(10,30,80,0.06)] flex items-center justify-between gap-2 relative z-[1]">
        <span className={cn("inline-flex items-center gap-[5px] px-2 py-[3px] rounded-md text-[10.5px] font-bold tracking-[0.02em]", tagCfg.cls)}>
          <span className={cn("w-[5px] h-[5px] rounded-full", tagCfg.dotCls)} />
          {tagCfg.label}
        </span>
        <span className="inline-flex items-center gap-[5px] text-[11px] font-bold text-[#556479] tabular-nums">
          <ConnSmallIcon />{connCount}
        </span>
      </div>
    </div>
  );
}

/* ================================================================
   INTEGRATION ROW
   ================================================================ */

function Integration({ logo, name, sub, on }: { logo: React.ReactNode; name: string; sub: string; on: boolean }) {
  return (
    <div className="grid grid-cols-[34px_1fr_auto] gap-[11px] items-center py-2.5 px-[13px] bg-white/65 border border-white/85 rounded-xl cursor-pointer backdrop-blur-[10px] transition-all duration-300 hover:bg-white/95 hover:-translate-y-px shadow-[0_2px_8px_rgba(8,60,180,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] hover:shadow-[0_10px_26px_-10px_rgba(8,60,180,0.16),0_3px_10px_rgba(8,60,180,0.08),inset_0_1px_0_rgba(255,255,255,0.95)]">
      <div className="w-[34px] h-[34px] rounded-[10px] grid place-items-center bg-white border border-[rgba(10,30,80,0.08)] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] overflow-hidden">
        {logo}
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-bold text-[#0a1020] tracking-[-0.01em] truncate">{name}</div>
        <div className="text-[10.5px] text-[#556479] font-medium mt-0.5">{sub}</div>
      </div>
      <div className={cn(
        "w-2 h-2 rounded-full flex-shrink-0",
        on ? "bg-[#24c36e] shadow-[0_0_8px_#24c36e] animate-[pulse-dot_2.4s_infinite]" : "bg-[#b4bfd0]"
      )} />
    </div>
  );
}

function IntGroup({ label }: { label: string }) {
  return (
    <div className="mt-4 first:mt-0 flex items-center gap-2.5 px-1 pb-2.5 text-[10px] font-bold text-[#8592a8] tracking-[0.14em] uppercase">
      {label}
      <div className="flex-1 h-px bg-gradient-to-r from-[rgba(10,30,80,0.1)] to-transparent" />
    </div>
  );
}

/* ================================================================
   MAIN COMPONENT
   ================================================================ */

interface EntityInventoryPanelProps {
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  claims: Array<{ id: string; source_entity_id: string | null }>;
  onEntityClick?: (entity: Entity) => void;
}

export function EntityInventoryPanel({ entities, edges, cycles, claims, onEntityClick }: EntityInventoryPanelProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Compute connection counts per entity
  const connMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) {
      m.set(e.source_entity_id, (m.get(e.source_entity_id) ?? 0) + 1);
      m.set(e.target_entity_id, (m.get(e.target_entity_id) ?? 0) + 1);
    }
    return m;
  }, [edges]);

  // Status counts
  const counts = useMemo(() => {
    const c = { all: entities.length, verified: 0, predicted: 0, assumed: 0 };
    for (const e of entities) {
      const s = SOURCE_TAG_MAP[e.source_tag] ?? "assumed";
      c[s]++;
    }
    return c;
  }, [entities]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const c = { framework: 0, concept: 0, sub_component: 0, external: 0 };
    for (const e of entities) {
      if (e.knowledge_layer === "external") c.external++;
      else if (e.entity_type?.includes("framework") || e.entity_type?.includes("theory") || e.entity_type?.includes("model")) c.framework++;
      else if (e.entity_id?.startsWith("SC") || e.entity_type?.includes("sub_component") || e.entity_type?.includes("component")) c.sub_component++;
      else c.concept++;
    }
    return c;
  }, [entities]);

  // Filter entities
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entities.filter((e) => {
      if (statusFilter !== "all" && (SOURCE_TAG_MAP[e.source_tag] ?? "assumed") !== statusFilter) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q) || (e.entity_type ?? "").toLowerCase().includes(q);
    });
  }, [entities, search, statusFilter]);

  const intCount = 14; // static

  return (
    <>
      <style>{panelStyles}</style>

      <div className="inv-panel">
        {/* HEADER */}
        <div className="px-[26px] py-[22px] pb-5 border-b border-white/50 flex items-center justify-between relative z-[1]">
          <div className="flex items-center gap-3.5">
            <div className="w-[42px] h-[42px] rounded-xl grid place-items-center relative overflow-hidden"
              style={{
                background: "linear-gradient(145deg, #0a1020 0%, #152a6e 40%, #1e4fde 80%, #2d8cff 115%)",
                border: "1px solid rgba(255,255,255,0.18)",
                boxShadow: "inset 0 1px 0 rgba(190,220,255,0.4), inset 0 -3px 8px rgba(0,15,70,0.5), 0 6px 16px rgba(0,30,140,0.32), 0 1px 3px rgba(0,20,100,0.2)",
              }}>
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_28%_18%,rgba(255,255,255,0.6),rgba(255,255,255,0)_70%)] pointer-events-none" />
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px] relative z-[1] drop-shadow-[0_1px_2px_rgba(0,40,130,0.35)]">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>
            </div>
            <div>
              <div className="text-[10.5px] font-bold text-[#0051ff] tracking-[0.14em] uppercase flex items-center gap-[7px]">
                <span className="w-[5px] h-[5px] rounded-full bg-[#1a7aff] shadow-[0_0_6px_#1a7aff] animate-[pulse-dot_2s_infinite]" />
                Knowledge Storage
              </div>
              <div className="text-[22px] font-bold tracking-[-0.025em] text-[#0a1020] leading-none flex items-baseline gap-2.5">
                Entity Inventory
                <span className="text-sm font-medium text-[#556479] tracking-[-0.01em]">{entities.length} entities · {intCount} integrations</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {[
              <svg key="grid" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
              <svg key="list" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
              <svg key="filter" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>,
            ].map((icon, i) => (
              <button key={i} className="w-[34px] h-[34px] bg-white/50 border border-white/80 rounded-[10px] grid place-items-center text-[#556479] backdrop-blur-[10px] transition-all hover:bg-white/85 hover:text-[#0a1020] [&>svg]:w-3.5 [&>svg]:h-3.5">
                {icon}
              </button>
            ))}
          </div>
        </div>

        {/* CONTROLS */}
        <div className="px-[26px] py-4 grid grid-cols-[1fr_auto] gap-3.5 items-center border-b border-white/50 relative z-[1]">
          <div className="relative">
            <svg className="absolute left-[13px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#556479] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search entities, frameworks, sub-components..."
              className="w-full py-[9px] px-3.5 pl-[38px] bg-white/55 border border-white/80 rounded-[11px] text-[13px] text-[#0a1020] backdrop-blur-[10px] transition-all placeholder:text-[#8592a8] focus:bg-white focus:border-[#1a7aff] focus:outline-none focus:ring-[3px] focus:ring-[rgba(26,122,255,0.18)]"
              style={{ fontFamily: "inherit" }}
            />
          </div>
          <div className="flex gap-[3px] p-[3px] bg-white/55 border border-white/80 rounded-[10px] backdrop-blur-[10px]">
            {(["all", "verified", "predicted", "assumed"] as StatusFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "px-3 py-1.5 border-none rounded-[7px] text-xs font-semibold text-[#556479] cursor-pointer transition-all inline-flex items-center gap-1.5 tracking-[-0.005em]",
                  statusFilter === s && "bg-white text-[#0a1020] shadow-[0_2px_6px_rgba(0,80,220,0.12)]",
                  statusFilter !== s && "hover:text-[#0a1020]"
                )}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full", TAG_DISPLAY[s].dotCls)} />
                {TAG_DISPLAY[s].label}
                <span className={cn("text-[10.5px] font-bold ml-px tracking-[0.02em]", statusFilter === s ? "text-[#0051ff]" : "text-[#556479]")}>
                  {counts[s]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* BODY */}
        <div className="px-[26px] py-[22px] pb-[26px] relative z-[1] space-y-7">

          {/* BY CATEGORY */}
          <div>
            <div className="flex items-center justify-between mb-3.5">
              <div className="text-[11px] font-bold text-[#556479] tracking-[0.16em] uppercase">By Category</div>
              <div className="text-[11px] text-[#556479] font-medium"><strong className="text-[#0a1020] font-bold">8</strong> categories</div>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
              <SummaryTile icon={<FrameworkIcon />} name="Frameworks" count={categoryCounts.framework} />
              <SummaryTile icon={<ConceptIcon />} name="Concepts" count={categoryCounts.concept} />
              <SummaryTile icon={<SubcompIcon />} name="Sub-components" count={categoryCounts.sub_component} />
              <SummaryTile icon={<ExternalIcon />} name="External Knowledge" count={categoryCounts.external} />
              <SummaryTile icon={<ConnectionIcon />} name="Connections" count={edges.length} />
              <SummaryTile icon={<VerifiedIcon />} name="Verified" count={counts.verified} />
              <SummaryTile icon={<PredictedIcon />} name="Predicted" count={counts.predicted} />
              <SummaryTile icon={<NeedsReviewIcon />} name="Needs Review" count={counts.assumed} />
            </div>
          </div>

          {/* ENTITIES */}
          <div>
            <div className="flex items-center justify-between mb-3.5">
              <div className="text-[11px] font-bold text-[#556479] tracking-[0.16em] uppercase">
                {statusFilter === "all" ? "Recent Entities" : `${TAG_DISPLAY[statusFilter].label} Entities`}
              </div>
              <div className="text-[11px] text-[#556479] font-medium flex items-center gap-2">
                <span className="inline-flex items-center gap-[5px] px-[9px] py-[3px] rounded-full bg-[rgba(26,122,255,0.14)] text-[#0051ff] font-bold text-[10.5px] border border-[rgba(26,122,255,0.22)]">
                  {filtered.length} shown
                </span>
                <span>of <strong className="text-[#0a1020] font-bold">{entities.length}</strong></span>
              </div>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5">
              {filtered.map((e) => (
                <EntityTile
                  key={e.id}
                  entity={e}
                  connCount={connMap.get(e.id) ?? 0}
                  onClick={() => onEntityClick?.(e)}
                />
              ))}
            </div>
            {filtered.length === 0 && (
              <div className="py-12 text-center text-sm text-[#8592a8]">No entities match your search</div>
            )}
          </div>

          {/* INTEGRATIONS */}
          <div>
            <div className="flex items-center justify-between mb-3.5">
              <div className="text-[11px] font-bold text-[#556479] tracking-[0.16em] uppercase">Integrations</div>
              <div className="text-[11px] text-[#556479] font-medium flex items-center gap-2">
                <span className="inline-flex items-center gap-[5px] px-[9px] py-[3px] rounded-full bg-[rgba(255,149,0,0.14)] text-[#c77400] font-bold text-[10.5px] border border-[rgba(255,149,0,0.24)]">
                  {intCount} connected
                </span>
                <span>of <strong className="text-[#0a1020] font-bold">18</strong></span>
                <button className="w-[26px] h-[26px] rounded-[7px] bg-white/60 border border-white/85 grid place-items-center text-[#556479] transition-all hover:bg-white hover:text-[#0051ff]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-[11px] h-[11px]"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
              </div>
            </div>

            <IntGroup label="Research & Knowledge" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
              <Integration logo={<ResearchAgentLogo />} name="Research Agent" sub="ATLAS · live" on />
              <Integration logo={<ArxivLogo />} name="arXiv" sub="Preprints · papers" on />
              <Integration logo={<SemanticScholarLogo />} name="Semantic Scholar" sub="Citation graph" on />
              <Integration logo={<GoogleScholarLogo />} name="Google Scholar" sub="Academic index" on />
              <Integration logo={<WikipediaLogo />} name="Wikipedia" sub="Public knowledge" on />
              <Integration logo={<WebSearchLogo />} name="Web Search" sub="Real-time web" on />
            </div>

            <IntGroup label="AI & Reasoning" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
              <Integration logo={<ClaudeOpusLogo />} name="Claude Opus" sub="Reasoning · synthesis" on />
              <Integration logo={<ChatGPTLogo />} name="ChatGPT" sub="Available" on={false} />
              <Integration logo={<GeminiLogo />} name="Gemini" sub="Available" on={false} />
            </div>

            <IntGroup label="Google Workspace" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
              <Integration logo={<GmailLogo />} name="Gmail" sub="Mail threads" on />
              <Integration logo={<GoogleCalendarLogo />} name="Google Calendar" sub="Events · invites" on />
              <Integration logo={<GoogleDriveLogo />} name="Google Drive" sub="Files · docs" on />
              <Integration logo={<GoogleDocsLogo />} name="Google Docs" sub="Shared documents" on />
            </div>

            <IntGroup label="Collaboration" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
              <Integration logo={<SlackLogo />} name="Slack" sub="Channels · DMs" on />
              <Integration logo={<TeamsLogo />} name="MS Teams" sub="Meetings · chat" on />
              <Integration logo={<NotionLogo />} name="Notion" sub="Pages · databases" on />
              <Integration logo={<FigmaLogo />} name="Figma" sub="Design files" on />
            </div>

            <IntGroup label="Development & Tasks" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
              <Integration logo={<GitHubLogo />} name="GitHub" sub="Repos · issues" on />
              <Integration logo={<LinearLogo />} name="Linear" sub="Issues · cycles" on />
              <Integration logo={<JiraLogo />} name="Jira" sub="Sprints · tickets" on={false} />
              <Integration logo={<DropboxLogo />} name="Dropbox" sub="File sync" on={false} />
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

"use client";

import React, { useRef, useEffect, useMemo } from "react";
import type { KGMetricsSnapshotRow } from "@/types/loop-metrics";

interface KGGrowthChartProps {
  snapshots: KGMetricsSnapshotRow[];
}

const SERIES = [
  { key: "entity_count", label: "Entities", color: "#007AFF" },
  { key: "edge_count", label: "Edges", color: "#34C759" },
  { key: "cycle_count", label: "Cycles", color: "#FF9500" },
  { key: "bridge_count", label: "Bridges", color: "#AF52DE" },
] as const;

export function KGGrowthChart({ snapshots }: KGGrowthChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const data = useMemo(
    () =>
      snapshots.map((s) => ({
        date: new Date(s.captured_at),
        entity_count: s.metrics.entity_count,
        edge_count: s.metrics.edge_count,
        cycle_count: s.metrics.cycle_count,
        bridge_count: s.metrics.bridge_count,
      })),
    [snapshots]
  );

  useEffect(() => {
    if (!svgRef.current || data.length < 2) return;
    const svg = svgRef.current;
    const W = svg.clientWidth || 500;
    const H = svg.clientHeight || 260;
    const pad = { top: 20, right: 20, bottom: 30, left: 45 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;

    // Scales
    const minDate = data[0].date.getTime();
    const maxDate = data[data.length - 1].date.getTime();
    const dateRange = Math.max(1, maxDate - minDate);
    const xScale = (d: Date) => pad.left + ((d.getTime() - minDate) / dateRange) * chartW;

    const allValues = data.flatMap((d) =>
      SERIES.map((s) => d[s.key as keyof typeof d] as number)
    );
    const maxVal = Math.max(...allValues, 1);
    const yScale = (v: number) => pad.top + chartH - (v / maxVal) * chartH;

    // Clear
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // Grid lines
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (chartH * i) / 4;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      Object.entries({ x1: pad.left, x2: W - pad.right, y1: y, y2: y, stroke: "#f0f0f0", "stroke-width": "1" })
        .forEach(([k, v]) => line.setAttribute(k, String(v)));
      svg.appendChild(line);

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(pad.left - 8));
      text.setAttribute("y", String(y + 4));
      text.setAttribute("text-anchor", "end");
      text.setAttribute("font-size", "10");
      text.setAttribute("fill", "#9ca3af");
      text.textContent = String(Math.round(maxVal * (1 - i / 4)));
      svg.appendChild(text);
    }

    // Series
    for (const series of SERIES) {
      const points = data.map((d) => ({
        x: xScale(d.date),
        y: yScale(d[series.key as keyof typeof d] as number),
      }));

      const pathData = points
        .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
        .join(" ");

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", series.color);
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);

      // End dot
      const last = points[points.length - 1];
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(last.x));
      circle.setAttribute("cy", String(last.y));
      circle.setAttribute("r", "3");
      circle.setAttribute("fill", series.color);
      svg.appendChild(circle);
    }

    // X-axis date labels
    const labelCount = Math.min(data.length, 5);
    const step = Math.max(1, Math.floor(data.length / labelCount));
    for (let i = 0; i < data.length; i += step) {
      const d = data[i];
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(xScale(d.date)));
      text.setAttribute("y", String(H - 5));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "10");
      text.setAttribute("fill", "#9ca3af");
      text.textContent = d.date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      svg.appendChild(text);
    }
  }, [data]);

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
      <h3 className="text-[15px] font-semibold tracking-tight text-gray-900 mb-1">
        Knowledge Graph Growth
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        Entity, edge, cycle, and bridge counts over time
      </p>

      {/* Legend */}
      <div className="flex gap-4 mb-3">
        {SERIES.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <div
              className="h-2 w-2 rounded-full"
              style={{ background: s.color }}
            />
            <span className="text-[11px] text-gray-500">{s.label}</span>
          </div>
        ))}
      </div>

      {data.length >= 2 ? (
        <svg ref={svgRef} className="w-full" style={{ height: 260 }} />
      ) : (
        <div className="flex items-center justify-center h-[260px] text-xs text-gray-400">
          At least 2 snapshots needed to render the chart
        </div>
      )}
    </div>
  );
}

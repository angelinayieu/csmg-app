"use client";

import React, { useRef, useEffect, useMemo } from "react";
import type { KGMetricsSnapshotRow } from "@/types/loop-metrics";

interface CoverageChartProps {
  snapshots: KGMetricsSnapshotRow[];
}

export function CoverageChart({ snapshots }: CoverageChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const data = useMemo(
    () =>
      snapshots.map((s) => ({
        date: new Date(s.captured_at),
        coverage: s.metrics.coverage_score,
        entities: s.metrics.entity_count,
        bridges: s.metrics.bridge_count,
      })),
    [snapshots]
  );

  useEffect(() => {
    if (!svgRef.current || data.length < 2) return;
    const svg = svgRef.current;
    const W = svg.clientWidth || 500;
    const H = svg.clientHeight || 220;
    const pad = { top: 20, right: 20, bottom: 30, left: 45 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;

    // Scales
    const minDate = data[0].date.getTime();
    const maxDate = data[data.length - 1].date.getTime();
    const dateRange = Math.max(1, maxDate - minDate);
    const xScale = (d: Date) => pad.left + ((d.getTime() - minDate) / dateRange) * chartW;
    const yScale = (v: number) => pad.top + chartH - (v / 100) * chartH;

    // Clear
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // Y-axis labels (0%, 25%, 50%, 75%, 100%)
    for (let i = 0; i <= 4; i++) {
      const val = i * 25;
      const y = yScale(val);

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
      text.textContent = `${val}%`;
      svg.appendChild(text);
    }

    // Area fill
    const areaPoints = data.map((d) => `${xScale(d.date)},${yScale(d.coverage)}`);
    const areaPath = `M ${pad.left},${yScale(0)} L ${areaPoints.join(" L ")} L ${xScale(data[data.length - 1].date)},${yScale(0)} Z`;

    const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
    area.setAttribute("d", areaPath);
    area.setAttribute("fill", "rgba(0, 122, 255, 0.08)");
    svg.appendChild(area);

    // Line
    const linePoints = data.map((d) => `${xScale(d.date)},${yScale(d.coverage)}`);
    const linePath = `M ${linePoints.join(" L ")}`;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", linePath);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#007AFF");
    line.setAttribute("stroke-width", "2.5");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");
    svg.appendChild(line);

    // Dots
    for (const d of data) {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(xScale(d.date)));
      circle.setAttribute("cy", String(yScale(d.coverage)));
      circle.setAttribute("r", "3");
      circle.setAttribute("fill", "#007AFF");
      circle.setAttribute("stroke", "#fff");
      circle.setAttribute("stroke-width", "1.5");
      svg.appendChild(circle);
    }

    // Target line at 40%
    const targetY = yScale(40);
    const targetLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    Object.entries({
      x1: pad.left, x2: W - pad.right,
      y1: targetY, y2: targetY,
      stroke: "#34C759", "stroke-width": "1",
      "stroke-dasharray": "4,4",
    }).forEach(([k, v]) => targetLine.setAttribute(k, String(v)));
    svg.appendChild(targetLine);

    const targetLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    targetLabel.setAttribute("x", String(W - pad.right - 2));
    targetLabel.setAttribute("y", String(targetY - 5));
    targetLabel.setAttribute("text-anchor", "end");
    targetLabel.setAttribute("font-size", "10");
    targetLabel.setAttribute("fill", "#34C759");
    targetLabel.textContent = "Target 40%";
    svg.appendChild(targetLabel);

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

  // Current + first coverage for delta
  const current = data.length > 0 ? data[data.length - 1].coverage : 0;
  const first = data.length > 0 ? data[0].coverage : 0;
  const delta = current - first;

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-gray-900 mb-1">
            Coverage Evolution
          </h3>
          <p className="text-xs text-gray-500">
            External landscape coverage score over time
          </p>
        </div>
        {data.length >= 2 && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              delta > 0
                ? "bg-green-50 text-green-600"
                : delta < 0
                  ? "bg-red-50 text-red-500"
                  : "bg-gray-100 text-gray-500"
            }`}
          >
            {delta > 0 ? "+" : ""}
            {delta.toFixed(1)}%
          </span>
        )}
      </div>

      {data.length >= 2 ? (
        <svg ref={svgRef} className="w-full" style={{ height: 220 }} />
      ) : (
        <div className="flex items-center justify-center h-[220px] text-xs text-gray-400">
          At least 2 snapshots needed to render the chart
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useCanvasTransform } from "../hooks/use-canvas-transform";
import { useLabLayout } from "../hooks/use-lab-layout";
import { HealthRingGauge } from "./health-ring-gauge";
import { LabCard } from "./lab-card";
import { LabEdges } from "./lab-edge";
import { LabInspector } from "./lab-inspector";
import { CanvasControls } from "./canvas-controls";
import type {
  LabCard as LabCardType,
  OperatingTwinModel,
} from "@/types/operating-twin";

interface InfiniteCanvasProps {
  model: OperatingTwinModel;
  onLabClick: (lab: LabCardType) => void;
  onCoreClick?: () => void;
}

export function InfiniteCanvas({ model, onLabClick, onCoreClick }: InfiniteCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const { transform, zoomIn, zoomOut, reset, noTransition } = useCanvasTransform(canvasRef);

  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 780 });
  const [hoveredLab, setHoveredLab] = useState<LabCardType | null>(null);
  const [inspectorPos, setInspectorPos] = useState<{ x: number; y: number } | null>(null);

  // Measure canvas size
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCanvasSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute lab layout
  const { layouts, centerX, centerY } = useLabLayout(
    model.labs,
    canvasSize.width,
    canvasSize.height,
  );

  // Core radius for edge termination (ring visual = ~180px div, ring circle = 148 + 11 = 159)
  const coreRadius = 170;

  // Handle lab hover → position inspector
  const handleLabHover = (lab: LabCardType | null) => {
    setHoveredLab(lab);
    if (!lab) {
      setInspectorPos(null);
      return;
    }
    const layout = layouts.get(lab.id);
    if (!layout) return;
    // Position inspector below the card
    setInspectorPos({ x: layout.x, y: layout.y + 90 });
  };

  const totalLabs = model.labs.length;
  const totalFrames = model.active_frame ? 1 + (model.active_frame.contributing_labs_count ?? 0) : 0;

  // Stagger entrance — set animation delays
  const staggerDelays = useMemo(() => {
    const m = new Map<string, number>();
    model.labs.forEach((lab, i) => m.set(lab.id, 0.5 + i * 0.08));
    return m;
  }, [model.labs]);

  return (
    <div
      ref={canvasRef}
      className="operating-twin-canvas"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 1,
        cursor: "grab",
      }}
    >
      <div
        ref={innerRef}
        style={{
          position: "absolute",
          inset: 0,
          transformOrigin: "50% 50%",
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transition: noTransition ? "none" : "transform 0.18s cubic-bezier(0.4, 0, 0.2, 1)",
          willChange: "transform",
        }}
      >
        {/* Edges layer */}
        <LabEdges
          labs={model.labs}
          layouts={layouts}
          centerX={centerX}
          centerY={centerY}
          coreRadius={coreRadius}
          hoveredLabId={hoveredLab?.id ?? null}
          svgWidth={canvasSize.width}
          svgHeight={canvasSize.height}
        />

        {/* Center ring gauge */}
        <div
          onClick={onCoreClick}
          style={{ position: "absolute", left: centerX, top: centerY, transform: "translate(-50%,-50%)" }}
        >
          <HealthRingGauge
            score={model.health_score}
            totalLabs={totalLabs}
            totalFrames={totalFrames || 1}
            totalAtoms={model.identity.total_atoms}
            delta30d={model.health_delta_30d}
          />
        </div>

        {/* Lab cards */}
        {model.labs.map((lab) => {
          const layout = layouts.get(lab.id);
          if (!layout) return null;
          return (
            <div
              key={lab.id}
              style={{
                animation: `ot-card-fade-in 0.6s cubic-bezier(0.4, 0, 0.2, 1) ${staggerDelays.get(lab.id) ?? 0}s both`,
              }}
            >
              <LabCard
                lab={lab}
                x={layout.x}
                y={layout.y}
                dimmed={hoveredLab !== null && hoveredLab.id !== lab.id}
                onHover={handleLabHover}
                onClick={onLabClick}
              />
            </div>
          );
        })}

        {/* Inspector tooltip */}
        <LabInspector lab={hoveredLab} position={inspectorPos} />
      </div>

      {/* Canvas controls (outside inner transform) */}
      <CanvasControls
        zoom={transform.scale}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFit={reset}
      />

      {/* Inline keyframes */}
      <style jsx>{`
        @keyframes ot-card-fade-in {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

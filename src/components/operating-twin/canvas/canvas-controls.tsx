"use client";

interface CanvasControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

export function CanvasControls({ zoom, onZoomIn, onZoomOut, onFit }: CanvasControlsProps) {
  return (
    <div
      data-no-pan
      data-no-zoom
      style={{
        position: "absolute",
        bottom: 18,
        right: 18,
        display: "flex",
        alignItems: "stretch",
        background: "#fff",
        border: "0.5px solid rgba(10,11,15,0.08)",
        borderRadius: 11,
        boxShadow:
          "0 4px 14px rgba(10,11,15,0.06), 0 1px 3px rgba(10,11,15,0.04)",
        zIndex: 30,
        overflow: "hidden",
      }}
    >
      <button
        onClick={onZoomOut}
        title="Zoom out"
        className="hover:bg-gray-50 transition-colors"
        style={{
          padding: "9px 13px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: "#6e7079",
          fontSize: 14,
          fontWeight: 500,
          minWidth: 36,
        }}
      >
        −
      </button>
      <div
        className="font-mono"
        style={{
          padding: "9px 12px",
          fontSize: 11,
          fontWeight: 600,
          color: "#1d1f24",
          background: "#fafafa",
          minWidth: 58,
          textAlign: "center",
          borderLeft: "0.5px solid rgba(10,11,15,0.08)",
          borderRight: "0.5px solid rgba(10,11,15,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {Math.round(zoom * 100)}%
      </div>
      <button
        onClick={onZoomIn}
        title="Zoom in"
        className="hover:bg-gray-50 transition-colors"
        style={{
          padding: "9px 13px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: "#6e7079",
          fontSize: 14,
          fontWeight: 500,
          minWidth: 36,
        }}
      >
        +
      </button>
      <button
        onClick={onFit}
        title="Fit to view"
        className="hover:bg-gray-50 transition-colors font-mono"
        style={{
          padding: "9px 13px",
          border: "none",
          borderLeft: "0.5px solid rgba(10,11,15,0.08)",
          background: "transparent",
          cursor: "pointer",
          color: "#1d1f24",
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.05em",
          minWidth: 44,
        }}
      >
        FIT
      </button>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export function AnimatedBackground() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Mouse parallax — gentle drift of blob field toward cursor
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let rafId = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    const onMove = (e: MouseEvent) => {
      const nx = (e.clientX / window.innerWidth - 0.5) * 2; // -1..1
      const ny = (e.clientY / window.innerHeight - 0.5) * 2;
      targetX = nx * 24; // px
      targetY = ny * 16;
    };

    const tick = () => {
      currentX += (targetX - currentX) * 0.06;
      currentY += (targetY - currentY) * 0.06;
      root.style.setProperty("--parallax-x", `${currentX}px`);
      root.style.setProperty("--parallax-y", `${currentY}px`);
      rafId = requestAnimationFrame(tick);
    };

    window.addEventListener("mousemove", onMove);
    rafId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(rafId);
    };
  }, []);

  // Generate floating particles — only after mount to avoid SSR hydration mismatch
  const particles = useMemo(() => {
    if (!mounted) return [];
    return Array.from({ length: 14 }, (_, i) => {
      const size = 3 + Math.random() * 6;
      const left = Math.random() * 100;
      const top = 40 + Math.random() * 60;
      const dx = (Math.random() - 0.5) * 140;
      const dy = -120 - Math.random() * 240;
      const dur = 14 + Math.random() * 18;
      const delay = -Math.random() * dur;
      return { i, size, left, top, dx, dy, dur, delay };
    });
  }, [mounted]);

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        // Solid blue base — guarantees no white gaps where blobs/aurora fade out
        background:
          "linear-gradient(180deg, var(--accent-50) 0%, var(--gradient-page-mid) 40%, var(--accent-50) 100%)",
        transform: "translate3d(var(--parallax-x, 0px), var(--parallax-y, 0px), 0)",
        transition: "transform 0.08s linear",
      }}
    >
      {/* Aurora mesh base wash */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 15% 10%, rgba(var(--accent-rgb), 0.18) 0%, transparent 55%)," +
            "radial-gradient(ellipse 80% 70% at 85% 20%, rgba(var(--accent-rgb), 0.14) 0%, transparent 55%)," +
            "radial-gradient(ellipse 100% 60% at 50% 100%, rgba(var(--accent-rgb), 0.16) 0%, transparent 60%)",
          animation: "aurora-drift 18s ease-in-out infinite",
        }}
      />

      {/* Blob 1 — large left */}
      <div
        className="absolute rounded-full"
        style={{
          width: 640,
          height: 640,
          left: -180,
          top: "12%",
          background:
            "radial-gradient(circle at 30% 30%, var(--accent-200), var(--accent-400) 55%, transparent 72%)",
          filter: "blur(70px)",
          opacity: 0.78,
          animation: "blob-float-1 24s ease-in-out infinite",
        }}
      />
      {/* Blob 2 — large right */}
      <div
        className="absolute rounded-full"
        style={{
          width: 540,
          height: 540,
          right: -140,
          top: "4%",
          background:
            "radial-gradient(circle at 40% 40%, var(--accent-100), var(--accent-300) 55%, transparent 75%)",
          filter: "blur(68px)",
          opacity: 0.82,
          animation: "blob-float-2 28s ease-in-out infinite",
        }}
      />
      {/* Blob 3 — bottom left */}
      <div
        className="absolute rounded-full"
        style={{
          width: 480,
          height: 480,
          left: "12%",
          bottom: -180,
          background:
            "radial-gradient(circle at 50% 50%, var(--accent-50), var(--accent-200) 58%, transparent 78%)",
          filter: "blur(70px)",
          opacity: 0.8,
          animation: "blob-float-3 32s ease-in-out infinite",
        }}
      />
      {/* Blob 4 — small top right accent */}
      <div
        className="absolute rounded-full"
        style={{
          width: 360,
          height: 360,
          right: "6%",
          top: "38%",
          background:
            "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.7), var(--accent-100) 50%, transparent 78%)",
          filter: "blur(60px)",
          opacity: 0.7,
          animation: "blob-float-4 26s ease-in-out infinite",
        }}
      />
      {/* Blob 5 — middle depth */}
      <div
        className="absolute rounded-full"
        style={{
          width: 420,
          height: 420,
          left: "42%",
          top: "45%",
          background:
            "radial-gradient(circle at 50% 50%, var(--accent-100), var(--accent-200) 50%, transparent 75%)",
          filter: "blur(80px)",
          opacity: 0.55,
          animation: "blob-float-5 34s ease-in-out infinite",
        }}
      />
      {/* Blob 6 — lower right accent */}
      <div
        className="absolute rounded-full"
        style={{
          width: 300,
          height: 300,
          right: "14%",
          bottom: "8%",
          background:
            "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.8), var(--accent-100) 45%, transparent 76%)",
          filter: "blur(55px)",
          opacity: 0.75,
          animation: "blob-float-6 22s ease-in-out infinite",
        }}
      />

      {/* Mesh gradient overlay — adds subtle color depth */}
      <div className="mesh-gradient-layer" />

      {/* Floating light particles (visionOS-style dust) */}
      {particles.map((p) => (
        <span
          key={p.i}
          className="float-particle"
          style={
            {
              left: `${p.left}%`,
              top: `${p.top}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              animationDuration: `${p.dur}s`,
              animationDelay: `${p.delay}s`,
              ["--dx" as string]: `${p.dx}px`,
              ["--dy" as string]: `${p.dy}px`,
            } as React.CSSProperties
          }
        />
      ))}

      {/* Grain overlay */}
      <div className="grain-overlay absolute inset-0" />
    </div>
  );
}

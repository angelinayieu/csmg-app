"use client";

// ── Starburst 3D ──
//
// The hero "idea" node as a real WebGL object (vanilla three.js — same
// lifecycle/dispose pattern as lab-chamber-3d.tsx). It is a small turning
// constellation built from THREE connected concept-pairs:
//
//   Create Impactful Brainstorms  ⟷  Instant World-class Prototypes
//   Web Exploration on Canvas     ⟷  Flow-state Thinking
//   Model Ideas                   ⟷  Optimize Idea Quality
//
// Each pair is ONE line (a diameter) through the faceted center core; the
// line's two ends are the paired ideas. Hovering (or tapping) a line freezes
// the spin and pops BOTH ends into black pills with white text — the end
// spheres drift outward and "become" their label, so you literally see the
// two sides as connected. A couple of small rounded spikes add starburst
// life. Everything is rounded (capsule shafts, round tips); the spheres stay
// attached to their line and only drift on hover.
//
// Loaded via next/dynamic({ ssr:false }) so three.js is code-split off the
// initial bundle; falls back to the flat SVG for no-WebGL / reduced-motion.

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { StarburstSVG } from "./starburst-svg";

const INK = 0x0b0b0c;

// 3 axes = 3 connected pairs. dir points to the "a" end; "-dir" is the "b"
// end. Directions bias to the corners/sides (never straight up/down) so the
// pill labels land in the hero's whitespace, not on the headings.
interface Axis {
  dir: [number, number, number];
  len: number;
  a: string; // +dir end
  b: string; // −dir end
}
const AXES: Axis[] = [
  {
    dir: [0.82, 0.58, 0.32],
    len: 2.05,
    a: "Create Impactful Brainstorms",
    b: "Instant World-class Prototypes",
  },
  {
    dir: [-0.8, 0.6, -0.34],
    len: 2.0,
    a: "Web Exploration on Canvas",
    b: "Flow-state Thinking",
  },
  {
    dir: [1.0, -0.05, -0.46],
    len: 2.1,
    a: "Model Ideas",
    b: "Optimize Idea Quality",
  },
];
const LABELS: string[] = AXES.flatMap((ax) => [ax.a, ax.b]);

// ≤2 small decorative spikes (no labels) to keep a touch of starburst.
const SPIKES: { dir: [number, number, number]; len: number }[] = [
  { dir: [0.05, 1.0, -0.16], len: 1.2 },
  { dir: [-0.1, -1.0, 0.22], len: 1.12 },
];

const AXIS_R = 0.045; // main line thickness
const NODE_R = 0.12; // end-sphere radius
const HIT_R = 0.2; // invisible fat pick radius

interface Endpoint {
  sphere: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  base: THREE.Vector3; // local resting position (attached to line end)
  axisIdx: number;
  pillIdx: number;
  drift: number; // 0 = attached, 1 = drifted-out / morphed to pill
}

export default function Starburst3D() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const pillRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [degraded, setDegraded] = useState(false);

  const init = useCallback(() => {
    const host = hostRef.current;
    const mount = canvasMountRef.current;
    if (!host || !mount) return () => {};

    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setDegraded(true);
      return () => {};
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setDegraded(true);
      return () => {};
    }

    let w = host.clientWidth || 320;
    let h = host.clientHeight || 240;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xf7f8fa, 5.2, 11);

    const cam = new THREE.PerspectiveCamera(45, w / Math.max(1, h), 0.1, 100);
    cam.position.set(0, 0, 6.6);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);
    const el = renderer.domElement;

    // Lights only touch the faceted core (MeshStandard); lines/dots are
    // unlit MeshBasic so they stay pure ink.
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(3, 4, 5);
    scene.add(key);

    const root = new THREE.Group();
    scene.add(root);

    // ── Core (a plain solid ink dot — clean, like the flat mock) ──
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 28, 28),
      new THREE.MeshBasicMaterial({ color: INK }),
    );
    root.add(core);

    const yAxis = new THREE.Vector3(0, 1, 0);
    const hitMeshes: THREE.Mesh[] = [];
    const endpoints: Endpoint[] = [];

    // ── 3 axis lines (each a rounded diameter = one connected pair) ──
    AXES.forEach((axis, ai) => {
      const dir = new THREE.Vector3(...axis.dir).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);

      // Rounded shaft spanning −len … +len through the center.
      const total = axis.len * 2;
      const shaft = new THREE.Mesh(
        new THREE.CapsuleGeometry(AXIS_R, Math.max(0.01, total - AXIS_R * 2), 6, 18),
        new THREE.MeshBasicMaterial({ color: INK }),
      );
      shaft.quaternion.copy(q);
      root.add(shaft);

      // Fat invisible pick proxy along the whole diameter.
      const hit = new THREE.Mesh(
        new THREE.CylinderGeometry(HIT_R, HIT_R, total, 6),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hit.quaternion.copy(q);
      hit.userData.axisIdx = ai;
      root.add(hit);
      hitMeshes.push(hit);

      // Two end nodes, attached at the line tips.
      [1, -1].forEach((sign) => {
        const base = dir.clone().multiplyScalar(axis.len * sign);
        const mat = new THREE.MeshBasicMaterial({
          color: INK,
          transparent: true,
          opacity: 1,
        });
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(NODE_R, 22, 22),
          mat,
        );
        sphere.position.copy(base);
        root.add(sphere);
        endpoints.push({
          sphere,
          mat,
          base,
          axisIdx: ai,
          pillIdx: ai * 2 + (sign > 0 ? 0 : 1),
          drift: 0,
        });
      });
    });

    // ── ≤2 small rounded spikes (decorative, no labels) ──
    SPIKES.forEach((s) => {
      const dir = new THREE.Vector3(...s.dir).normalize();
      const g = new THREE.Group();
      g.quaternion.setFromUnitVectors(yAxis, dir);
      const r = 0.018;
      const shaft = new THREE.Mesh(
        new THREE.CapsuleGeometry(r, Math.max(0.01, s.len - r * 2), 4, 10),
        new THREE.MeshBasicMaterial({ color: INK }),
      );
      shaft.position.y = s.len / 2;
      g.add(shaft);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 14, 14),
        new THREE.MeshBasicMaterial({ color: INK }),
      );
      tip.position.y = s.len;
      g.add(tip);
      root.add(g);
    });

    // ── Pointer: drag to orbit, hover/tap a line to reveal its pair ──
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const tmp = new THREE.Vector3();
    const tmpCenter = new THREE.Vector3();

    let dragging = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;
    let dragYaw = 0;
    let dragPitch = 0;
    let resumeAt = 0;
    let hoveredAxis = -1;
    let pinnedAxis = -1;

    host.style.cursor = "grab";

    const pickAxis = (clientX: number, clientY: number): number => {
      const rect = el.getBoundingClientRect();
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, cam);
      const hits = raycaster.intersectObjects(hitMeshes, false);
      return hits.length > 0 ? (hits[0].object.userData.axisIdx as number) : -1;
    };

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      moved = false;
      lastX = downX = e.clientX;
      lastY = downY = e.clientY;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (dragging) {
        if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 5) {
          moved = true;
          pinnedAxis = -1; // a real drag clears any pinned pair
          host.style.cursor = "grabbing";
        }
        dragYaw += (e.clientX - lastX) * 0.01;
        dragPitch += (e.clientY - lastY) * 0.01;
        dragPitch = Math.max(-1, Math.min(1, dragPitch));
        lastX = e.clientX;
        lastY = e.clientY;
        hoveredAxis = -1;
        return;
      }
      hoveredAxis = pickAxis(e.clientX, e.clientY);
      host.style.cursor = hoveredAxis >= 0 ? "pointer" : "grab";
    };
    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      host.style.cursor = "grab";
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      if (!moved) {
        // A tap/click toggles a pinned pair (so it stays open on touch).
        const ax = pickAxis(e.clientX, e.clientY);
        pinnedAxis = ax >= 0 && ax === pinnedAxis ? -1 : ax;
      } else {
        resumeAt = performance.now() + 2000;
      }
    };
    const onPointerLeave = () => {
      hoveredAxis = -1;
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    el.addEventListener("pointerleave", onPointerLeave);

    const onResize = () => {
      w = host.clientWidth || w;
      h = host.clientHeight || h;
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);

    let visible = true;
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible && !running) start();
      },
      { threshold: 0.01 },
    );
    io.observe(host);

    // ── Animation loop ──
    let rotX = 0.18;
    let rotY = 0;
    let autoYaw = 0;
    let frame = 0;
    let raf = 0;
    let running = false;

    const loop = () => {
      if (!visible) {
        running = false;
        return;
      }
      frame++;
      const t = frame * 0.016;

      const activeAxis = hoveredAxis >= 0 ? hoveredAxis : pinnedAxis;
      const frozen = activeAxis >= 0; // hold still so labels are readable

      // Slow, calm turn — fully held still while a pair is open (so the
      // pills stay readable), and while you're dragging.
      const autoOn = !dragging && !frozen && performance.now() > resumeAt;
      if (autoOn) autoYaw += 0.0019;

      const targetY = frozen ? rotY : autoYaw + dragYaw;
      const targetX = frozen ? rotX : 0.17 + Math.sin(t * 0.26) * 0.05 + dragPitch;
      rotY += (targetY - rotY) * 0.08;
      rotX += (targetX - rotX) * 0.08;
      root.rotation.y = rotY;
      root.rotation.x = rotX;

      core.rotation.y += 0.005;
      core.rotation.x += 0.003;

      // End nodes: drift out + fade as their pill takes over.
      for (const ep of endpoints) {
        const target = ep.axisIdx === activeAxis ? 1 : 0;
        ep.drift += (target - ep.drift) * 0.18;
        ep.sphere.position.copy(ep.base).multiplyScalar(1 + 0.14 * ep.drift);
        ep.sphere.scale.setScalar(1 - 0.5 * ep.drift);
        ep.mat.opacity = 1 - 0.85 * ep.drift;
      }

      renderer.render(scene, cam);

      // Pills track the (now world-positioned) end nodes, then drift a touch
      // further OUT along the ray (radially from the burst center) so the
      // label floats clear of the line tip instead of sitting on it.
      tmpCenter.set(0, 0, 0).project(cam);
      const cx = (tmpCenter.x * 0.5 + 0.5) * w;
      const cy = (-tmpCenter.y * 0.5 + 0.5) * h;
      for (const ep of endpoints) {
        const pill = pillRefs.current[ep.pillIdx];
        if (!pill) continue;
        if (ep.drift > 0.01) {
          ep.sphere.getWorldPosition(tmp).project(cam);
          const sx = (tmp.x * 0.5 + 0.5) * w;
          const sy = (-tmp.y * 0.5 + 0.5) * h;
          const dx = sx - cx;
          const dy = sy - cy;
          const dlen = Math.hypot(dx, dy) || 1;
          // Float the label outward along its radial. Endpoints that project
          // near the hub (rays angled toward the camera — the "middle" pill)
          // get pushed to a guaranteed minimum clearance so they never sit on
          // the center; side labels (already far out) just drift a touch.
          const fullDist = Math.max(dlen + 26, 116);
          const dist = dlen + (fullDist - dlen) * ep.drift;
          pill.style.left = `${cx + (dx / dlen) * dist}px`;
          pill.style.top = `${cy + (dy / dlen) * dist}px`;
          pill.style.opacity = `${Math.min(1, ep.drift * 1.2)}`;
          pill.style.transform = `translate(-50%, -50%) scale(${0.86 + 0.14 * ep.drift})`;
        } else if (pill.style.opacity !== "0") {
          pill.style.opacity = "0";
        }
      }

      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    start();

    // ── Cleanup ──
    return () => {
      running = false;
      visible = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endDrag);
      el.removeEventListener("pointercancel", endDrag);
      el.removeEventListener("pointerleave", onPointerLeave);
      scene.traverse((obj) => {
        const o = obj as THREE.Mesh;
        o.geometry?.dispose?.();
        const m = o.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose?.());
        else m?.dispose?.();
      });
      renderer.dispose();
      if (el.parentElement) el.parentElement.removeChild(el);
    };
  }, []);

  useEffect(() => {
    const cleanup = init();
    return cleanup;
  }, [init]);

  if (degraded) return <StarburstSVG />;

  return (
    <div
      ref={hostRef}
      className="relative mx-auto select-none"
      style={{
        width: "100%",
        maxWidth: 480,
        aspectRatio: "4 / 3",
        touchAction: "none",
      }}
    >
      <div ref={canvasMountRef} className="absolute inset-0" />
      {/* Pill overlay — labels are React-rendered; the RAF loop positions
          them imperatively from each end node's projected screen point. */}
      <div
        className="absolute inset-0"
        style={{ overflow: "visible", pointerEvents: "none", zIndex: 2 }}
      >
        {LABELS.map((label, i) => (
          <div
            key={i}
            ref={(node) => {
              pillRefs.current[i] = node;
            }}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              opacity: 0,
              transform: "translate(-50%, -50%) scale(0.86)",
              background: "#0B0B0C",
              color: "#fff",
              padding: "5px 11px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 500,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
              boxShadow: "0 8px 22px -8px rgba(11,11,12,0.55)",
              pointerEvents: "none",
              willChange: "left, top, opacity, transform",
            }}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

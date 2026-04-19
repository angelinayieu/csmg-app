"use client";

// Phase 14 — Three.js molecular chamber.
//
// Drop-in replacement for LabChamber2D's Structure mode. Dynamic-imported
// by NodeLab so the Three.js bundle (~600KB) only lands on the lab route,
// not on the canvas.
//
// Visual composition (inspired by the user's reference HTML):
//   - Outer wireframe icosahedron shell (probability boundary)
//   - Inner translucent shell (structural container)
//   - Central nucleus (white-to-green emissive) with pulsing glow
//   - 3 tilted orbital rings (torus) around the nucleus
//   - Subunits placed in a tetrahedral-ish arrangement, each with:
//       - Main icosahedron ball (size ∝ importance)
//       - Orbiting satellite
//       - Outer glow sphere
//   - Internal bonds (line segments) between every pair of subunits
//   - Nucleus-to-subunit tethers (one per subunit)
//   - External bond satellites on upper/lower arcs:
//       - Upstream = cyan
//       - Downstream = amber
//   - 400-particle electron cloud (swirls slowly)
//
// Interaction:
//   - Drag → orbit (auto-rotate resumes after ~3s idle)
//   - Wheel → dolly in/out
//   - Hover subunit → emissive boost + synced with NodeLab's
//     hoveredSubunitId so the reagent-bay row lights up in lockstep
//   - Click subunit → toggles hover (stub for future lock-in)

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { Entity } from "@/types";
import { Info } from "lucide-react";

export interface LabChamber3DProps {
  focal: Entity;
  subunits: Entity[];
  upstreamPartners: Entity[];
  downstreamPartners: Entity[];
  hoveredSubunitId: string | null;
  onHoverSubunit: (id: string | null) => void;
  /** Phase 19: live throughput (0..100), driven by Control Panel sliders. */
  throughput?: number;
  /**
   * Phase 43: counterfactual ghost throughput. When present, the HUD
   * pill shows it as a secondary value next to live so users see the
   * "what if" effect without leaving the chamber.
   */
  ghostThroughput?: number | null;
  /**
   * Phase 20: when a reaction is focused (clicked in the footer), the
   * chamber spawns a particle stream flowing nucleus → reactant subunits
   * → nucleus, and pulses the reactant subunits' emissive intensity.
   * Pass the participant entity UUIDs (matching subunit.id where present).
   */
  focusedReactionEntityIds?: string[] | null;
  /**
   * Phase 23: probability of the focused reaction (0..1). Drives particle
   * stream density + intensity — strong reactions look like a torrent,
   * weak ones like a trickle. Ignored when no reaction is focused.
   */
  focusedReactionProbability?: number | null;
  /**
   * Phase 24: reaction type. Tints the particle stream so users can read
   * the *kind* of reaction at a glance. emergent=green, reinforcing=cyan,
   * tension=pink, trivial=gray. Mixed 70/30 with each target subunit's
   * color so individuality survives.
   */
  focusedReactionType?: "emergent" | "reinforcing" | "tension" | "trivial" | null;
  /**
   * Phase 22: when the Control Panel is tuning a specific subunit, the
   * chamber dollies to frame that subunit and paints an amber selection
   * halo so the user can see which dial they are turning. Selection
   * takes precedence over hover for camera focus; hover still works for
   * fast preview.
   */
  selectedSubunitId?: string | null;
}

const CATEGORY_COLOR: Record<string, number> = {
  concrete: 0x4ade80,
  abstract: 0xa78bfa,
  process: 0xfbbf24,
  relational: 0x22d3ee,
  epistemic: 0xf472b6,
  fault: 0xef4444,
};

function entityColor(e: Entity): number {
  const cat = (e.entity_category as string) ?? "concrete";
  return CATEGORY_COLOR[cat] ?? 0x4ade80;
}

function subunitSize(e: Entity): number {
  const imp = e.importance ?? "moderate";
  const base =
    imp === "fundamental" ? 1.5 : imp === "critical" ? 1.3 : imp === "important" ? 1.15 : 1.0;
  return base + ((e.confidence as number | null) ?? 0.7) * 0.4;
}

// Deterministic subunit positions — tetrahedral-ish for up to 4, then a
// tilted ring for more.
function subunitPositions(count: number): Array<[number, number, number]> {
  if (count <= 4) {
    const base: Array<[number, number, number]> = [
      [3.2, 2.2, 1.5],
      [-3.2, 2.2, -1.5],
      [3.2, -2.2, -1.5],
      [-3.2, -2.2, 1.5],
    ];
    return base.slice(0, count);
  }
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = 3.6;
    const y = Math.sin(a * 1.8) * 0.8;
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return out;
}

export default function LabChamber3D({
  focal,
  subunits,
  upstreamPartners,
  downstreamPartners,
  hoveredSubunitId,
  onHoverSubunit,
  throughput,
  ghostThroughput,
  focusedReactionEntityIds,
  focusedReactionProbability,
  focusedReactionType,
  selectedSubunitId,
}: LabChamber3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const subunitMeshesRef = useRef<
    Array<{
      id: string;
      ball: THREE.Mesh;
      sat: THREE.Mesh;
      glow: THREE.Mesh;
      baseEmissive: number;
      basePos: THREE.Vector3;
    }>
  >([]);
  const onHoverRef = useRef(onHoverSubunit);
  const hoveredRef = useRef<string | null>(null);
  // Phase 19: focus-on-hover. Animation loop reads from this ref each
  // frame and lerps the camera position toward the target. Default null
  // = orbit at the resting camera position.
  const focusTargetRef = useRef<THREE.Vector3 | null>(null);
  // Phase 20: reaction replay. Animation loop reads the active reactant
  // ids; if non-empty, it (a) pulses the matching subunit balls' emissive
  // and (b) animates a stream of particles flowing along their tethers.
  const reactantIdsRef = useRef<Set<string>>(new Set());
  // Phase 22: selected (tuned) subunit id. Drives camera dolly + amber halo.
  const selectedIdRef = useRef<string | null>(null);
  // Phase 23: focused reaction probability (0..1). Drives particle density.
  const reactionProbRef = useRef<number>(0.6);
  // Phase 24: focused reaction type tint as a THREE.Color. Mixed with each
  // target subunit's color when laying down the particle stream.
  const reactionTintRef = useRef<THREE.Color | null>(null);

  useEffect(() => {
    onHoverRef.current = onHoverSubunit;
  }, [onHoverSubunit]);

  useEffect(() => {
    hoveredRef.current = hoveredSubunitId;
    selectedIdRef.current = selectedSubunitId ?? null;
    const meshes = subunitMeshesRef.current;
    if (meshes.length === 0) return;
    for (const m of meshes) {
      const mat = m.ball.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity =
        m.id === hoveredSubunitId
          ? 0.95
          : m.id === selectedSubunitId
            ? 0.8
            : m.baseEmissive;
    }
    // Phase 22: selection takes precedence over hover for camera focus
    // so the chamber stays framed on the dial you're turning even when
    // your cursor wanders. When neither, return to resting position.
    const focusId = selectedSubunitId ?? hoveredSubunitId;
    if (focusId) {
      const sm = meshes.find((m) => m.id === focusId);
      if (sm) {
        focusTargetRef.current = sm.basePos.clone().multiplyScalar(0.6);
      }
    } else {
      focusTargetRef.current = null;
    }
  }, [hoveredSubunitId, selectedSubunitId]);

  // Phase 20: keep reactantIdsRef in sync with the focused reaction prop.
  // The animation loop reads this each frame so we don't need to rebuild
  // the scene when the reaction changes.
  useEffect(() => {
    reactantIdsRef.current = new Set(focusedReactionEntityIds ?? []);
  }, [focusedReactionEntityIds]);

  // Phase 23: keep probability ref in sync. Default 0.6 when null/undefined
  // so a reaction without an estimated probability still animates visibly.
  useEffect(() => {
    const p = focusedReactionProbability;
    reactionProbRef.current =
      typeof p === "number" && p > 0 ? Math.max(0.05, Math.min(1, p)) : 0.6;
  }, [focusedReactionProbability]);

  // Phase 24: keep reaction-type tint in sync. Null = no tint (use pure
  // target color, the Phase 20 default).
  useEffect(() => {
    if (!focusedReactionType) {
      reactionTintRef.current = null;
      return;
    }
    const hex =
      focusedReactionType === "emergent"
        ? 0x4ade80
        : focusedReactionType === "reinforcing"
          ? 0x22d3ee
          : focusedReactionType === "tension"
            ? 0xf472b6
            : 0x94a3b8;
    reactionTintRef.current = new THREE.Color(hex);
  }, [focusedReactionType]);

  // Main lifecycle: build scene, animate, dispose on unmount.
  const init = useCallback(() => {
    const host = hostRef.current;
    if (!host) return () => {};

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02050a, 0.015);

    const cam = new THREE.PerspectiveCamera(
      45,
      host.clientWidth / Math.max(1, host.clientHeight),
      0.1,
      1000,
    );
    cam.position.set(0, 3, 28);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    // ── Lighting ──
    scene.add(new THREE.AmbientLight(0x334466, 0.5));
    const key = new THREE.PointLight(0x4ade80, 1.2, 60);
    key.position.set(10, 8, 14);
    scene.add(key);
    const fill = new THREE.PointLight(0xf472b6, 0.5, 50);
    fill.position.set(-10, -6, 10);
    scene.add(fill);
    const rim = new THREE.PointLight(0x22d3ee, 0.4, 50);
    rim.position.set(0, 12, -12);
    scene.add(rim);

    const root = new THREE.Group();
    scene.add(root);

    // ── Probability shell (outer wireframe) ──
    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(7.5, 2),
      new THREE.MeshBasicMaterial({
        color: 0x4ade80,
        wireframe: true,
        transparent: true,
        opacity: 0.08,
      }),
    );
    root.add(shell);

    // Inner translucent shell
    const innerShell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(6.8, 4),
      new THREE.MeshStandardMaterial({
        color: 0x0a1f17,
        transparent: true,
        opacity: 0.15,
        roughness: 0.3,
        metalness: 0.5,
      }),
    );
    root.add(innerShell);

    // ── Central nucleus ──
    const nucleus = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.9, 3),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x4ade80,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.1,
      }),
    );
    root.add(nucleus);

    const nglow = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 32, 32),
      new THREE.MeshBasicMaterial({
        color: 0x4ade80,
        transparent: true,
        opacity: 0.15,
      }),
    );
    root.add(nglow);

    // ── Subunits ──
    const subunitGroup = new THREE.Group();
    const positions = subunitPositions(subunits.length);
    const subMeshes: Array<{
      id: string;
      ball: THREE.Mesh;
      sat: THREE.Mesh;
      glow: THREE.Mesh;
      baseEmissive: number;
      basePos: THREE.Vector3;
    }> = [];

    subunits.forEach((s, i) => {
      const pos = positions[i];
      if (!pos) return;
      const col = new THREE.Color(entityColor(s));
      const sz = subunitSize(s);

      const group = new THREE.Group();

      const ball = new THREE.Mesh(
        new THREE.IcosahedronGeometry(sz, 3),
        new THREE.MeshStandardMaterial({
          color: col,
          emissive: col,
          emissiveIntensity: 0.35,
          roughness: 0.4,
          metalness: 0.3,
        }),
      );
      ball.userData = { subId: s.id, base: sz };
      group.add(ball);

      const sat = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.28, 1),
        new THREE.MeshStandardMaterial({
          color: col,
          emissive: col,
          emissiveIntensity: 1,
        }),
      );
      sat.position.set(sz + 0.6, 0, 0);
      sat.userData = { phase: (i * Math.PI) / 2 };
      group.add(sat);

      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(sz * 1.6, 24, 24),
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.1,
        }),
      );
      group.add(glow);

      group.position.set(pos[0], pos[1], pos[2]);
      subunitGroup.add(group);
      subMeshes.push({
        id: s.id,
        ball,
        sat,
        glow,
        baseEmissive: 0.35,
        basePos: new THREE.Vector3(pos[0], pos[1], pos[2]),
      });
    });
    root.add(subunitGroup);
    subunitMeshesRef.current = subMeshes.map(
      ({ id, ball, sat, glow, baseEmissive, basePos }) => ({
        id,
        ball,
        sat,
        glow,
        baseEmissive,
        basePos,
      }),
    );

    // ── Internal bonds between every pair of subunits ──
    const bondGroup = new THREE.Group();
    for (let i = 0; i < subMeshes.length; i++) {
      for (let j = i + 1; j < subMeshes.length; j++) {
        const geo = new THREE.BufferGeometry().setFromPoints([
          subMeshes[i].basePos,
          subMeshes[j].basePos,
        ]);
        const line = new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({
            color: 0x4ade80,
            transparent: true,
            opacity: 0.35,
          }),
        );
        bondGroup.add(line);
      }
    }
    root.add(bondGroup);

    // ── Nucleus-to-subunit tethers ──
    const tetherGroup = new THREE.Group();
    subMeshes.forEach((sm) => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        sm.basePos,
      ]);
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color: entityColor(
            subunits.find((s) => s.id === sm.id) ?? { entity_category: "concrete" } as Entity,
          ),
          transparent: true,
          opacity: 0.6,
        }),
      );
      tetherGroup.add(line);
    });
    root.add(tetherGroup);

    // ── Orbital rings ──
    const ringGroup = new THREE.Group();
    const ringConfigs: Array<{ r: number; tube: number; tilt: [number, number, number]; col: number; op: number }> = [
      { r: 4.5, tube: 0.015, tilt: [0, 0, 0], col: 0x4ade80, op: 0.25 },
      { r: 5.2, tube: 0.012, tilt: [Math.PI / 3, 0, Math.PI / 4], col: 0x22d3ee, op: 0.18 },
      { r: 5.8, tube: 0.01, tilt: [-Math.PI / 4, Math.PI / 3, 0], col: 0xf472b6, op: 0.15 },
    ];
    ringConfigs.forEach((rc) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(rc.r, rc.tube, 8, 96),
        new THREE.MeshBasicMaterial({ color: rc.col, transparent: true, opacity: rc.op }),
      );
      ring.rotation.set(rc.tilt[0], rc.tilt[1], rc.tilt[2]);
      ringGroup.add(ring);
    });
    root.add(ringGroup);

    // ── External bond satellites ──
    const extGroup = new THREE.Group();
    const placeExternal = (
      partners: Entity[],
      colorHex: number,
      yBias: number,
      angleOffset: number,
    ) => {
      const n = partners.length;
      partners.forEach((b, i) => {
        const angle = (i / Math.max(1, n)) * Math.PI * 2 + angleOffset;
        const dist = 11.5;
        const pos = new THREE.Vector3(
          Math.cos(angle) * dist,
          yBias + i * 0.3,
          Math.sin(angle) * dist,
        );
        const col = new THREE.Color(colorHex);
        const mesh = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.45, 2),
          new THREE.MeshStandardMaterial({
            color: col,
            emissive: col,
            emissiveIntensity: 0.6,
          }),
        );
        mesh.position.copy(pos);
        mesh.userData = { ext: true, partnerId: b.id };
        extGroup.add(mesh);

        // curved connector
        const mid = pos.clone().multiplyScalar(0.5);
        mid.y += yBias > 0 ? 2 : -2;
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(0, 0, 0),
          mid,
          pos,
        );
        const pts = curve.getPoints(24);
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({
            color: colorHex,
            transparent: true,
            opacity: 0.4,
          }),
        );
        extGroup.add(line);
      });
    };
    placeExternal(upstreamPartners, 0x22d3ee, 4, 0);
    placeExternal(downstreamPartners, 0xfbbf24, -4, Math.PI / 3);
    root.add(extGroup);

    // ── Particle cloud (~250 for perf) ──
    const pCount = 250;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    const pCol = new Float32Array(pCount * 3);
    const pPhase = new Float32Array(pCount);
    for (let i = 0; i < pCount; i++) {
      const r = 2 + Math.random() * 5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(1 - 2 * Math.random());
      pPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pPos[i * 3 + 2] = r * Math.cos(phi);
      const colors = [0x4ade80, 0x22d3ee, 0xf472b6, 0xfbbf24];
      const c = new THREE.Color(colors[Math.floor(Math.random() * colors.length)]);
      pCol[i * 3] = c.r;
      pCol[i * 3 + 1] = c.g;
      pCol[i * 3 + 2] = c.b;
      pPhase[i] = Math.random() * Math.PI * 2;
    }
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
    const particles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({
        size: 0.08,
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    root.add(particles);

    // ── Phase 20: reaction replay particle stream ──
    // A ring buffer of particles whose positions are recomputed each frame
    // along the tethers from the nucleus to the currently-active reactant
    // subunits. When `reactantIdsRef.current` is empty the points are
    // hidden by setting opacity to 0; when non-empty they animate.
    const STREAM_COUNT = 80;
    const streamGeo = new THREE.BufferGeometry();
    const streamPos = new Float32Array(STREAM_COUNT * 3);
    const streamCol = new Float32Array(STREAM_COUNT * 3);
    // Persistent per-particle metadata so we can drive each one along a
    // tether deterministically (no new allocations per frame).
    const streamPhase = new Float32Array(STREAM_COUNT);
    const streamSpeed = new Float32Array(STREAM_COUNT);
    for (let i = 0; i < STREAM_COUNT; i++) {
      streamPhase[i] = Math.random();
      streamSpeed[i] = 0.012 + Math.random() * 0.014;
    }
    streamGeo.setAttribute("position", new THREE.BufferAttribute(streamPos, 3));
    streamGeo.setAttribute("color", new THREE.BufferAttribute(streamCol, 3));
    const streamMat = new THREE.PointsMaterial({
      size: 0.18,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const reactionStream = new THREE.Points(streamGeo, streamMat);
    root.add(reactionStream);

    // ── Orbit controls ──
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let rotX = 0.2;
    let rotY = 0;
    let targetRotX = 0.2;
    let targetRotY = 0;
    let autoRotY = true;
    let autoRotResumeAt = 0;

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      autoRotY = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      autoRotResumeAt = performance.now() + 3000;
      try {
        renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (dragging) {
        targetRotY += (e.clientX - lastX) * 0.008;
        targetRotX += (e.clientY - lastY) * 0.008;
        targetRotX = Math.max(-1.2, Math.min(1.2, targetRotX));
        lastX = e.clientX;
        lastY = e.clientY;
      } else {
        // Raycast-hover on subunit balls
        raycaster.setFromCamera(pointer, cam);
        const hits = raycaster.intersectObjects(subMeshes.map((m) => m.ball));
        const nextId = hits.length > 0 ? (hits[0].object.userData.subId as string) : null;
        if (nextId !== hoveredRef.current) {
          hoveredRef.current = nextId;
          onHoverRef.current?.(nextId);
        }
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.position.z = Math.max(12, Math.min(44, cam.position.z + e.deltaY * 0.02));
    };
    const onClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, cam);
      const hits = raycaster.intersectObjects(subMeshes.map((m) => m.ball));
      if (hits.length) {
        const id = hits[0].object.userData.subId as string;
        onHoverRef.current?.(hoveredRef.current === id ? null : id);
        hoveredRef.current = hoveredRef.current === id ? null : id;
      }
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerUp);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("click", onClick);

    const onResize = () => {
      if (!host) return;
      cam.aspect = host.clientWidth / Math.max(1, host.clientHeight);
      cam.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);

    // ── Animation loop ──
    let frame = 0;
    let raf = 0;
    const loop = () => {
      frame++;
      const t = frame * 0.01;

      if (!autoRotY && performance.now() > autoRotResumeAt && !dragging) {
        autoRotY = true;
      }
      if (autoRotY) targetRotY += 0.0025;
      rotX += (targetRotX - rotX) * 0.08;
      rotY += (targetRotY - rotY) * 0.08;
      root.rotation.x = rotX;
      root.rotation.y = rotY;

      const pulse = 1 + Math.sin(t * 3) * 0.05;
      nucleus.scale.setScalar(pulse);
      nglow.scale.setScalar(1 + Math.sin(t * 2) * 0.08);
      (nglow.material as THREE.MeshBasicMaterial).opacity = 0.12 + Math.sin(t * 2) * 0.05;

      shell.rotation.y = t * 0.15;
      shell.rotation.x = t * 0.08;
      innerShell.rotation.y = -t * 0.1;
      ringGroup.rotation.y = t * 0.2;
      ringGroup.rotation.x = Math.sin(t * 0.3) * 0.1;

      // Satellite orbits + breathing. Phase 20: when a reaction is
      // focused, reactant balls additionally pulse harder + brighter.
      // Phase 22: when a subunit is selected for tuning, paint an amber
      // halo so the user can tell which dial they're turning.
      const reactantIds = reactantIdsRef.current;
      const hasReaction = reactantIds.size > 0;
      const selectedId = selectedIdRef.current;
      subMeshes.forEach((sm, i) => {
        const phase = ((sm.sat.userData as { phase: number }).phase ?? 0) + 0.03;
        (sm.sat.userData as { phase: number }).phase = phase;
        const sz = (sm.ball.userData as { base: number }).base ?? 1;
        sm.sat.position.set(
          Math.cos(phase) * (sz + 0.6),
          Math.sin(phase * 1.3) * 0.4,
          Math.sin(phase) * (sz + 0.6),
        );
        const isReactant = hasReaction && reactantIds.has(sm.id);
        const breathBase = isReactant
          ? 1 + Math.sin(t * 5 + i) * 0.08
          : 1 + Math.sin(t * 2 + i) * 0.03;
        sm.ball.scale.setScalar(breathBase);
        if (isReactant) {
          const mat = sm.ball.material as THREE.MeshStandardMaterial;
          // Pulse emissive on top of hover/base — clamp at 1.4
          mat.emissiveIntensity = Math.min(
            1.4,
            (hoveredRef.current === sm.id ? 0.95 : sm.baseEmissive) +
              0.5 +
              Math.sin(t * 6) * 0.25,
          );
          (sm.glow.material as THREE.MeshBasicMaterial).opacity = 0.25 +
            Math.sin(t * 4) * 0.08;
        } else if (hasReaction) {
          // Other subunits dim slightly so reactants stand out
          const mat = sm.ball.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = sm.baseEmissive * 0.4;
          (sm.glow.material as THREE.MeshBasicMaterial).opacity = 0.05;
        }
        // Phase 22: amber selection halo. Painted on top of any other
        // glow treatment (it pulses at a different rate so the user can
        // tell selection from reaction state).
        if (sm.id === selectedId) {
          const halo = sm.glow.material as THREE.MeshBasicMaterial;
          halo.color.setHex(0xfbbf24);
          halo.opacity = 0.32 + Math.sin(t * 3) * 0.1;
        } else if (selectedId !== null || hasReaction) {
          // Reset color when another subunit is the selected one (or
          // when a reaction is active and we already touched opacity).
          // Use the entity's base color so the next non-selected frame
          // looks correct.
          const halo = sm.glow.material as THREE.MeshBasicMaterial;
          const base = subunits.find((s) => s.id === sm.id);
          if (base) halo.color.setHex(entityColor(base));
        }
      });

      // Particle swirl
      const posAttr = particles.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      for (let i = 0; i < pCount; i++) {
        const x = arr[i * 3];
        const y = arr[i * 3 + 1];
        const z = arr[i * 3 + 2];
        const r = Math.sqrt(x * x + y * y + z * z);
        const theta = Math.atan2(z, x) + 0.002 * (1 + 1 / Math.max(0.001, r));
        arr[i * 3] = r * Math.cos(theta);
        arr[i * 3 + 2] = r * Math.sin(theta);
        arr[i * 3 + 1] = y + Math.sin(t * 2 + pPhase[i]) * 0.005;
      }
      posAttr.needsUpdate = true;

      // Phase 20: reaction replay particle stream.
      // Distribute STREAM_COUNT particles evenly across the reactant
      // tethers. Each particle slides from nucleus → subunit → back, on
      // a per-particle phase that wraps. When no reaction is focused,
      // material opacity decays to 0.
      const streamPosAttr = streamGeo.getAttribute("position") as THREE.BufferAttribute;
      const streamColAttr = streamGeo.getAttribute("color") as THREE.BufferAttribute;
      const streamArr = streamPosAttr.array as Float32Array;
      const streamColArr = streamColAttr.array as Float32Array;

      if (hasReaction) {
        // Targets = subunits in the reaction (intersection of subMeshes
        // and reactantIds). Skip the focal id — that's the nucleus, no tether.
        const targets = subMeshes.filter((m) => reactantIds.has(m.id));
        if (targets.length > 0) {
          // Phase 23: probability drives density.
          // - active count: 15% of stream at p=0.05, full stream at p=1.0
          // - particle size: thicker for stronger reactions
          // - opacity ceiling: softer for low-confidence reactions
          const prob = reactionProbRef.current;
          const intensity = 0.15 + 0.85 * prob;
          const activeCount = Math.max(4, Math.floor(STREAM_COUNT * intensity));
          streamMat.size = 0.12 + 0.14 * prob;
          const opCap = 0.45 + 0.45 * prob;
          for (let i = 0; i < STREAM_COUNT; i++) {
            if (i >= activeCount) {
              // Park inactive particles at origin so they hide inside the
              // nucleus glow (no extra visual cost than a tiny halo).
              streamArr[i * 3] = 0;
              streamArr[i * 3 + 1] = 0;
              streamArr[i * 3 + 2] = 0;
              continue;
            }
            const target = targets[i % targets.length];
            // Slide: phase oscillates 0..1..0 (triangle wave). Stronger
            // reactions also flow slightly faster.
            const phase = (streamPhase[i] + t * streamSpeed[i] * 60 * (0.7 + prob * 0.6)) % 1;
            const slide = phase < 0.5 ? phase * 2 : 2 - phase * 2;
            // Position = lerp from nucleus (origin) to subunit basePos
            const sx = target.basePos.x * slide;
            const sy = target.basePos.y * slide;
            const sz = target.basePos.z * slide;
            // Tiny lateral jitter so particles don't fly in a single line
            const j = 0.08;
            streamArr[i * 3] = sx + (Math.sin(t * 3 + i) * j);
            streamArr[i * 3 + 1] = sy + (Math.cos(t * 3.7 + i) * j);
            streamArr[i * 3 + 2] = sz + (Math.sin(t * 4.1 + i) * j);
            // Color: 70% reaction-type tint + 30% target subunit color
            // when a tint is active; pure target color otherwise.
            const targetMat = target.ball.material as THREE.MeshStandardMaterial;
            const c = targetMat.color;
            const tint = reactionTintRef.current;
            if (tint) {
              streamColArr[i * 3] = tint.r * 0.7 + c.r * 0.3;
              streamColArr[i * 3 + 1] = tint.g * 0.7 + c.g * 0.3;
              streamColArr[i * 3 + 2] = tint.b * 0.7 + c.b * 0.3;
            } else {
              streamColArr[i * 3] = c.r;
              streamColArr[i * 3 + 1] = c.g;
              streamColArr[i * 3 + 2] = c.b;
            }
          }
          streamPosAttr.needsUpdate = true;
          streamColAttr.needsUpdate = true;
          // Fade in toward probability-scaled ceiling
          streamMat.opacity = Math.min(opCap, streamMat.opacity + 0.04);
        }
      } else {
        // Fade out
        streamMat.opacity = Math.max(0, streamMat.opacity - 0.04);
        if (streamMat.opacity === 0 && reactionStream.visible) {
          // Cheap optimization: hide once fully faded so we skip raster
          reactionStream.visible = false;
        }
      }
      if (hasReaction && !reactionStream.visible) reactionStream.visible = true;

      // Phase 19: focus-on-hover. Lerp the camera lookAt toward the
      // hovered subunit's local position, and dolly slightly closer.
      // On unhover (target null), return to origin/resting distance.
      const focus = focusTargetRef.current;
      const targetLook = focus ?? new THREE.Vector3(0, 0, 0);
      // Apply current root rotation to the local target so it stays
      // visually anchored to the hovered subunit as the scene rotates.
      const worldTarget = targetLook.clone().applyEuler(root.rotation);
      // Lerp current lookAt point (stored on cam.userData) toward target
      const stored = (cam.userData.lookAt as THREE.Vector3 | undefined) ??
        new THREE.Vector3(0, 0, 0);
      stored.lerp(worldTarget, 0.07);
      cam.userData.lookAt = stored;
      cam.lookAt(stored);
      // Dolly: when focused, pull camera in slightly; when not, restore.
      const targetZ = focus ? 22 : 28;
      cam.position.z += (targetZ - cam.position.z) * 0.05;

      renderer.render(scene, cam);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // Cleanup
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
      // Dispose all geometries + materials in the root scene
      scene.traverse((obj) => {
        const o = obj as THREE.Mesh | THREE.Line | THREE.Points;
        if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose?.();
        const mat = (o as THREE.Mesh).material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose?.());
        } else if (mat) {
          (mat as THREE.Material).dispose?.();
        }
      });
      subunitMeshesRef.current = [];
    };
    // Re-build only when the entity graph changes materially.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focal.id, subunits.length, upstreamPartners.length, downstreamPartners.length]);

  useEffect(() => {
    const cleanup = init();
    return cleanup;
  }, [init]);

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at center, rgba(74,222,128,0.04), transparent 60%), #02050a",
      }}
    >
      <div
        ref={hostRef}
        className="absolute inset-0"
        style={{ touchAction: "none" }}
      />

      {/* HUD readouts (kept 2D so they're always crisp) */}
      <div className="pointer-events-none absolute left-5 top-5 text-[9px] font-mono uppercase tracking-widest text-[#4ade80]/75">
        <div className="mb-1 flex gap-2.5">
          <span>CHAMBER</span>
          <b className="font-medium text-[#e8edf4]">REACTOR-01</b>
        </div>
        <div className="mb-1 flex gap-2.5">
          <span>FIELD</span>
          <b className="font-medium text-[#e8edf4]">STRUCTURE · 3D</b>
        </div>
        <div className="flex gap-2.5">
          <span>SUBUNITS</span>
          <b className="font-medium text-[#e8edf4]">{subunits.length}</b>
        </div>
      </div>

      <div className="pointer-events-none absolute right-5 top-5 text-right text-[9px] font-mono uppercase tracking-widest text-[#4ade80]/75">
        <div className="mb-1 flex justify-end gap-2.5">
          <span>BONDS</span>
          <b className="font-medium text-[#e8edf4]">
            {upstreamPartners.length + downstreamPartners.length}
          </b>
        </div>
        <div className="mb-1 flex justify-end gap-2.5">
          <span>DRAG</span>
          <b className="font-medium text-[#e8edf4]">ORBIT</b>
        </div>
        <div className="flex justify-end gap-2.5">
          <span>WHEEL</span>
          <b className="font-medium text-[#e8edf4]">DOLLY</b>
        </div>
      </div>

      {/* Phase 19: live probability index pill (driven by Control Panel).
          Phase 29: now hoverable — reveals formula breakdown so users know
          what the headline number means.
          Phase 43: when ghost throughput is present, render a counter-
          factual overlay next to the live value. */}
      {typeof throughput === "number" && (
        <ProbabilityIndexPill
          throughput={throughput}
          ghostThroughput={
            typeof ghostThroughput === "number" ? ghostThroughput : null
          }
        />
      )}

      {/* Phase 26: reaction-type legend, pinned bottom-left. Only renders
          when a reaction is focused — it's a contextual decoder for the
          particle stream color the user is actively watching. The active
          type is brightened; the others dim so the palette stays visible
          as a key. */}
      {focusedReactionType && (
        <div className="pointer-events-none absolute left-5 bottom-5 rounded-md border border-[#94a3b8]/[0.14] bg-[#0a0f17]/80 px-3 py-2 backdrop-blur-sm">
          <div className="mb-1.5 flex items-baseline justify-between gap-4">
            <span className="text-[8.5px] font-mono uppercase tracking-[0.18em] text-[#64748b]">
              Reaction Type
            </span>
            {typeof focusedReactionProbability === "number" && (
              <span className="text-[9px] font-mono tabular-nums text-[#94a3b8]">
                p={(focusedReactionProbability * 100).toFixed(0)}%
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            {([
              { key: "emergent", color: "#4ade80", label: "EMERGENT" },
              { key: "reinforcing", color: "#22d3ee", label: "REINFORCING" },
              { key: "tension", color: "#f472b6", label: "TENSION" },
              { key: "trivial", color: "#94a3b8", label: "TRIVIAL" },
            ] as const).map((row) => {
              const active = row.key === focusedReactionType;
              return (
                <div
                  key={row.key}
                  className="flex items-center gap-2 text-[9px] font-mono tracking-[0.12em]"
                  style={{ opacity: active ? 1 : 0.35 }}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{
                      background: row.color,
                      boxShadow: active ? `0 0 6px ${row.color}` : "none",
                    }}
                  />
                  <span
                    style={{
                      color: active ? row.color : "#94a3b8",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {row.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Focal label pinned at bottom-center */}
      <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-[#06090e]/80 px-3 py-1 text-[10px] font-semibold text-[#e8edf4] shadow-[0_0_12px_rgba(74,222,128,0.2)] backdrop-blur-sm">
        <span className="text-[#4ade80]">◉</span>{" "}
        {focal.name.length > 36 ? focal.name.slice(0, 36) + "…" : focal.name}
      </div>

      {/* Corner brackets (decorative) */}
      <div className="pointer-events-none absolute inset-[18px]">
        {[
          { top: 0, left: 0, borderTop: true, borderLeft: true },
          { top: 0, right: 0, borderTop: true, borderRight: true },
          { bottom: 0, left: 0, borderBottom: true, borderLeft: true },
          { bottom: 0, right: 0, borderBottom: true, borderRight: true },
        ].map((pos, i) => (
          <span
            key={i}
            className="absolute h-5 w-5"
            style={{
              top: pos.top as number | undefined,
              left: pos.left as number | undefined,
              right: pos.right as number | undefined,
              bottom: pos.bottom as number | undefined,
              borderColor: "#475569",
              borderTop: pos.borderTop ? "1px solid" : undefined,
              borderRight: pos.borderRight ? "1px solid" : undefined,
              borderBottom: pos.borderBottom ? "1px solid" : undefined,
              borderLeft: pos.borderLeft ? "1px solid" : undefined,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Phase 29 — Probability Index pill with an explainer popover.
 *
 * The headline 72% number is the single most prominent HUD element in the
 * chamber; pre-Phase-29 users had no way to know what it was measuring.
 * On hover (or focus for a11y) the pill unfurls a small card explaining
 * the throughput formula and showing each parameter's contribution to
 * the current value, so the number is self-documenting.
 */
function ProbabilityIndexPill({
  throughput,
  ghostThroughput,
}: {
  throughput: number;
  ghostThroughput: number | null;
}) {
  const [open, setOpen] = useState(false);
  const color =
    throughput >= 75 ? "#4ade80" : throughput >= 50 ? "#fbbf24" : "#f472b6";
  const band =
    throughput >= 75 ? "Strong" : throughput >= 50 ? "Moderate" : "Weak";
  // Phase 43 — ghost overlay.
  const ghostActive = typeof ghostThroughput === "number";
  const ghostDiff = ghostActive ? ghostThroughput - throughput : 0;
  const ghostDiffColor =
    !ghostActive
      ? "#64748b"
      : ghostDiff > 0.5
        ? "#4ade80"
        : ghostDiff < -0.5
          ? "#f472b6"
          : "#94a3b8";

  return (
    <div
      className="absolute right-5 bottom-5"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={
          ghostActive
            ? `Probability Index ${throughput.toFixed(1)} percent (${band}). Ghost ${ghostThroughput.toFixed(1)} percent. Hover to read formula.`
            : `Probability Index ${throughput.toFixed(1)} percent (${band}). Press to read formula.`
        }
        className="flex cursor-help items-start gap-2 rounded-md border bg-[#0a0f17]/80 px-3 py-2 text-left backdrop-blur-sm transition-colors"
        style={{
          borderColor: ghostActive
            ? "rgba(167, 139, 250, 0.35)"
            : "rgba(148, 163, 184, 0.14)",
          boxShadow: ghostActive
            ? "0 0 24px rgba(167, 139, 250, 0.15)"
            : undefined,
        }}
      >
        <div>
          <div className="flex items-center gap-1 text-[8.5px] font-mono uppercase tracking-[0.18em] text-[#64748b]">
            <span>Probability Index</span>
            <Info className="h-2.5 w-2.5 opacity-60" />
            {ghostActive && (
              <span
                className="ml-1 font-semibold"
                style={{ color: "#a78bfa" }}
                title="Counterfactual ghost active"
              >
                ∿ WHAT IF
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span
              className="font-mono text-[24px] font-semibold leading-none tabular-nums"
              style={{ color }}
            >
              {throughput.toFixed(1)}
            </span>
            <span className="text-[10px] font-mono text-[#64748b]">%</span>
            {!ghostActive && (
              <span
                className="ml-2 rounded-sm px-1 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-[0.14em]"
                style={{ color, background: `${color}22` }}
              >
                {band}
              </span>
            )}
          </div>
          {ghostActive && (
            <div className="mt-1 flex items-baseline gap-1.5 font-mono text-[10px] tabular-nums">
              <span className="text-[#a78bfa]">ghost</span>
              <span className="text-[#e8edf4]">
                {ghostThroughput.toFixed(1)}%
              </span>
              <span className="ml-1" style={{ color: ghostDiffColor }}>
                {ghostDiff >= 0 ? "+" : ""}
                {ghostDiff.toFixed(1)}
              </span>
            </div>
          )}
        </div>
      </button>

      {open && (
        <div
          role="tooltip"
          className="absolute bottom-full right-0 mb-2 w-[280px] rounded-md border border-[#94a3b8]/[0.14] bg-[#0a0f17]/95 p-3 font-mono text-[10px] leading-relaxed text-[#a8b3c4] shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-sm"
        >
          <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#4ade80]">
            How this is computed
          </div>
          <div className="mb-2 text-[10.5px] leading-snug text-[#e8edf4]">
            Effective capacity under the current regime, 0–100%.
          </div>
          <div className="space-y-1.5 border-l border-[#4ade80]/30 pl-2 text-[9.5px] text-[#94a3b8]">
            <div>
              <span className="text-[#e8edf4]">eff</span> = min(<b className="text-[#22d3ee]">K</b>,{" "}
              <b className="text-[#22d3ee]">α</b>+1)
              <div className="pl-3 text-[8.5px] text-[#64748b]">
                attention caps usable slots
              </div>
            </div>
            <div>
              <span className="text-[#e8edf4]">decay</span> = clamp(
              <b className="text-[#22d3ee]">τ</b>/15, 0.3, 1.5)
              <div className="pl-3 text-[8.5px] text-[#64748b]">
                short τ → low; long τ → saturating
              </div>
            </div>
            <div>
              <span className="text-[#e8edf4]">refresh</span> = 1 +{" "}
              <b className="text-[#22d3ee]">ρ</b> × 0.25
              <div className="pl-3 text-[8.5px] text-[#64748b]">
                refresh cadence boost
              </div>
            </div>
            <div className="pt-1 text-[10px] text-[#4ade80]">
              out = eff × decay × refresh × 12
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-[#94a3b8]/[0.08] pt-2 text-[8.5px] uppercase tracking-[0.14em]">
            <span className="text-[#64748b]">Bands</span>
            <span className="flex items-center gap-1.5">
              <Swatch c="#f472b6" t="<50" />
              <Swatch c="#fbbf24" t="50-74" />
              <Swatch c="#4ade80" t="≥75" />
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Swatch({ c, t }: { c: string; t: string }) {
  return (
    <span className="flex items-center gap-0.5">
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: c }}
      />
      <span style={{ color: c }}>{t}</span>
    </span>
  );
}

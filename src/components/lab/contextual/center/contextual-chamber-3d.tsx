"use client";

// ── ContextualChamber3D ──────────────────────────────────────────
//
// 4-component Three.js chamber matching the reference photo.
//
// Visual composition (verbatim from reference HTML's initThree):
//   - Nucleus (icosahedron, dark gradient)
//   - 4 subunit balls placed at corners of a flattened tetrahedron:
//       (+x +y +z)   β · Buffer    · green
//       (-x +y -z)   δ · Decay     · orange
//       (+x -y -z)   ρ · Rehearsal · blue
//       (-x -y +z)   α · Attention · pink
//   - Bond cylinders between every pair of subunits
//   - Nucleus → subunit tether lines
//   - Soft canvas-texture ground shadow
//   - Subunit halo opacity + ball scale tied to compWeights
//   - 200-sample population cloud (toggled visible in 'population' mode)
//
// Interaction:
//   - Drag → orbit
//   - Scroll → dolly
//   - Hover subunit → halo brighter
//   - Click subunit → onSubunitClick(componentId)
//
// Cleanup: disposes geometries / materials / removes DOM canvas.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { COMPONENTS } from "../lib/components-defs";
import type { Prediction } from "../lib/types";

export type ChamberMode = "structure" | "compare" | "population";

export interface ContextualChamber3DProps {
  compWeights: Prediction["compWeights"];
  mode: ChamberMode;
  /** Population samples (K, success) — only used in population mode. */
  populationSamples?: Array<{ K: number; success: number }>;
  onSubunitHover?: (componentId: string | null) => void;
  onSubunitClick?: (componentId: string) => void;
  hoveredSubunitId?: string | null;
}

interface SubunitRef {
  group: THREE.Group;
  ball: THREE.Mesh;
  halo: THREE.Mesh;
  id: string;
  basePos: THREE.Vector3;
}

interface SceneRefs {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  root: THREE.Group;
  subunits: SubunitRef[];
  bondGroup: THREE.Group;
  tethers: THREE.Group;
  cloudGroup: THREE.Group;
  nucleus: THREE.Mesh;
  ground: THREE.Mesh;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  // Mutable interaction state
  rotation: { rX: number; rY: number; tRX: number; tRY: number };
  drag: { active: boolean; lastX: number; lastY: number; auto: boolean };
  hoveredId: string | null;
  // Animation handle
  raf: number | null;
}

const SUBUNIT_POSITIONS: Array<[number, number, number]> = [
  [2.8, 2.0, 1.4], // buffer
  [-2.8, 2.0, -1.4], // decay
  [2.8, -2.0, -1.4], // rehearsal
  [-2.8, -2.0, 1.4], // attention
];

export function ContextualChamber3D({
  compWeights,
  mode,
  populationSamples,
  onSubunitHover,
  onSubunitClick,
  hoveredSubunitId,
}: ContextualChamber3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneRefs | null>(null);

  // ── Scene setup (mount-time, runs once) ─────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      42,
      host.clientWidth / Math.max(1, host.clientHeight),
      0.1,
      200,
    );
    camera.position.set(0, 2, 22);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    // Lights — ambient + key + fill + rim (matches reference).
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 0.75);
    key.position.set(6, 10, 8);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdbeafe, 0.3);
    fill.position.set(-8, 4, 5);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xfce7f3, 0.25);
    rim.position.set(0, -4, -10);
    scene.add(rim);

    const root = new THREE.Group();
    scene.add(root);

    // Soft ground shadow (canvas radial gradient as texture).
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = 256;
    shadowCanvas.height = 256;
    const sctx = shadowCanvas.getContext("2d");
    if (sctx) {
      const gg = sctx.createRadialGradient(128, 128, 10, 128, 128, 120);
      gg.addColorStop(0, "rgba(0,0,0,0.18)");
      gg.addColorStop(1, "rgba(0,0,0,0)");
      sctx.fillStyle = gg;
      sctx.fillRect(0, 0, 256, 256);
    }
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(9, 48),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(shadowCanvas),
        transparent: true,
        depthWrite: false,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -4.5;
    scene.add(ground);

    // Nucleus.
    const nucleus = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 2),
      new THREE.MeshStandardMaterial({
        color: 0x1d1d1f,
        roughness: 0.35,
        metalness: 0.2,
      }),
    );
    root.add(nucleus);

    // Subunit balls + halos.
    const subunits: SubunitRef[] = [];
    COMPONENTS.forEach((c, i) => {
      const [x, y, z] = SUBUNIT_POSITIONS[i];
      const basePos = new THREE.Vector3(x, y, z);
      const col = new THREE.Color(c.color);

      const grp = new THREE.Group();
      grp.position.copy(basePos);

      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(1.5, 32, 32),
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
        }),
      );
      grp.add(halo);

      const ball = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 4),
        new THREE.MeshStandardMaterial({
          color: col,
          roughness: 0.42,
          metalness: 0.08,
        }),
      );
      ball.userData = { id: c.id };
      grp.add(ball);

      root.add(grp);
      subunits.push({ group: grp, ball, halo, id: c.id, basePos });
    });

    // Bonds — every pair.
    const bondGroup = new THREE.Group();
    for (let i = 0; i < subunits.length; i++) {
      for (let j = i + 1; j < subunits.length; j++) {
        const a = subunits[i].basePos;
        const b = subunits[j].basePos;
        const len = b.clone().sub(a).length();
        const mid = a.clone().add(b).multiplyScalar(0.5);

        const tube = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.04, len, 8, 1),
          new THREE.MeshBasicMaterial({
            color: 0xd2d2d7,
            transparent: true,
            opacity: 0.7,
          }),
        );
        tube.position.copy(mid);
        tube.lookAt(b);
        tube.rotateX(Math.PI / 2);
        bondGroup.add(tube);
      }
    }
    root.add(bondGroup);

    // Tethers nucleus → subunits.
    const tethers = new THREE.Group();
    subunits.forEach((s) => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        s.basePos,
      ]);
      tethers.add(
        new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({
            color: 0xe5e5ea,
            transparent: true,
            opacity: 0.8,
          }),
        ),
      );
    });
    root.add(tethers);

    // Population cloud holder (initially empty + hidden).
    const cloudGroup = new THREE.Group();
    cloudGroup.visible = false;
    root.add(cloudGroup);

    // ── Interaction wiring ──────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const refs: SceneRefs = {
      scene,
      camera,
      renderer,
      root,
      subunits,
      bondGroup,
      tethers,
      cloudGroup,
      nucleus,
      ground,
      raycaster,
      pointer,
      rotation: { rX: 0.15, rY: 0, tRX: 0.15, tRY: 0 },
      drag: { active: false, lastX: 0, lastY: 0, auto: true },
      hoveredId: null,
      raf: null,
    };
    sceneRef.current = refs;

    // Event handlers — closures over `refs`.
    const dom = renderer.domElement;
    let dragStart: { x: number; y: number } | null = null;

    function onPointerDown(e: PointerEvent) {
      dragStart = { x: e.clientX, y: e.clientY };
      refs.drag.active = true;
      refs.drag.lastX = e.clientX;
      refs.drag.lastY = e.clientY;
      refs.drag.auto = false;
      dom.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
      if (refs.drag.active) {
        refs.rotation.tRY += (e.clientX - refs.drag.lastX) * 0.008;
        refs.rotation.tRX += (e.clientY - refs.drag.lastY) * 0.008;
        refs.rotation.tRX = Math.max(
          -1.1,
          Math.min(1.1, refs.rotation.tRX),
        );
        refs.drag.lastX = e.clientX;
        refs.drag.lastY = e.clientY;
      }
      // Hover detection.
      const rect = dom.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(
        refs.subunits.map((s) => s.ball),
      );
      const newHover = hits.length
        ? (hits[0].object.userData.id as string)
        : null;
      if (newHover !== refs.hoveredId) {
        refs.hoveredId = newHover;
        if (onSubunitHover) onSubunitHover(newHover);
        dom.style.cursor = newHover ? "pointer" : "";
      }
    }

    function onPointerUp(e: PointerEvent) {
      const dx = dragStart ? Math.abs(e.clientX - dragStart.x) : 0;
      const dy = dragStart ? Math.abs(e.clientY - dragStart.y) : 0;
      const wasDrag = dx + dy > 5;
      refs.drag.active = false;
      try {
        dom.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      // Resume auto-rotation after a delay.
      window.setTimeout(() => {
        if (!refs.drag.active) refs.drag.auto = true;
      }, 2500);

      if (!wasDrag && refs.hoveredId && onSubunitClick) {
        onSubunitClick(refs.hoveredId);
      }
      dragStart = null;
    }

    function onPointerLeave() {
      if (refs.hoveredId) {
        refs.hoveredId = null;
        if (onSubunitHover) onSubunitHover(null);
        dom.style.cursor = "";
      }
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      camera.position.z = Math.max(
        12,
        Math.min(36, camera.position.z + e.deltaY * 0.018),
      );
    }

    function onResize() {
      if (!hostRef.current) return;
      camera.aspect =
        hostRef.current.clientWidth /
        Math.max(1, hostRef.current.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(
        hostRef.current.clientWidth,
        hostRef.current.clientHeight,
      );
    }

    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("pointerleave", onPointerLeave);
    dom.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", onResize);

    // Animation loop.
    let frame = 0;
    function animate() {
      frame++;
      const t = frame * 0.01;
      const r = refs.rotation;
      if (refs.drag.auto) r.tRY += 0.002;
      r.rX += (r.tRX - r.rX) * 0.08;
      r.rY += (r.tRY - r.rY) * 0.08;
      refs.root.rotation.x = r.rX;
      refs.root.rotation.y = r.rY;

      // Subunit breath / hover boost.
      refs.subunits.forEach((s, i) => {
        const breath = 1 + Math.sin(t * 1.6 + i) * 0.02;
        const isHover = refs.hoveredId === s.id;
        const scaleTarget = (s.ball.userData.targetScale as number) ?? 1;
        const focusBoost = isHover ? 1.18 : 1;
        s.ball.scale.setScalar(breath * scaleTarget * focusBoost);

        const baseHalo =
          0.06 + ((s.halo.userData.targetHaloOpacity as number) ?? 0.02);
        if (isHover) {
          (s.halo.material as THREE.MeshBasicMaterial).opacity =
            baseHalo + 0.25 + Math.sin(t * 4) * 0.05;
        } else {
          (s.halo.material as THREE.MeshBasicMaterial).opacity = baseHalo;
        }
      });

      renderer.render(scene, camera);
      refs.raf = requestAnimationFrame(animate);
    }
    animate();

    // Cleanup on unmount.
    return () => {
      if (refs.raf !== null) cancelAnimationFrame(refs.raf);
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointerleave", onPointerLeave);
      dom.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
      try {
        host.removeChild(dom);
      } catch {
        /* host may already be detached */
      }
      // Dispose materials + geometries.
      scene.traverse((obj) => {
        const m = obj as unknown as {
          geometry?: { dispose?: () => void };
          material?:
            | { dispose?: () => void }
            | Array<{ dispose?: () => void }>;
        };
        m.geometry?.dispose?.();
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => mat.dispose?.());
        } else {
          m.material?.dispose?.();
        }
      });
      renderer.dispose();
      sceneRef.current = null;
    };
    // Mount-once. onSubunitHover/Click captured via closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Push compWeights into the live scene ────────────────────────
  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    refs.subunits.forEach((s) => {
      const w =
        (compWeights[s.id as keyof typeof compWeights] ?? 50) / 100;
      s.ball.userData.targetScale = 0.5 + w * 0.9;
      s.halo.userData.targetHaloOpacity = 0.02 + w * 0.2;
    });
  }, [compWeights]);

  // ── Mode + population cloud sync ────────────────────────────────
  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;

    const isPopulation = mode === "population";
    refs.cloudGroup.visible = isPopulation;
    refs.subunits.forEach((s) => (s.group.visible = !isPopulation));
    refs.bondGroup.visible = !isPopulation;
    refs.tethers.visible = !isPopulation;
    refs.nucleus.visible = !isPopulation;
    refs.ground.visible = !isPopulation;

    if (isPopulation && populationSamples) {
      // Rebuild cloud — clear children first.
      while (refs.cloudGroup.children.length) {
        const child = refs.cloudGroup.children[0];
        refs.cloudGroup.remove(child);
        const m = child as unknown as {
          geometry?: { dispose?: () => void };
          material?: { dispose?: () => void };
        };
        m.geometry?.dispose?.();
        m.material?.dispose?.();
      }
      populationSamples.forEach((c) => {
        const x = (c.K - 4) * 1.8;
        const y = (c.success - 0.5) * 6;
        const z = (Math.random() - 0.5) * 4;
        const color = new THREE.Color().setHSL(c.success * 0.35, 0.65, 0.55);
        const size = 0.12 + c.success * 0.18;
        const dot = new THREE.Mesh(
          new THREE.IcosahedronGeometry(size, 0),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.75,
          }),
        );
        dot.position.set(x, y, z);
        refs.cloudGroup.add(dot);
      });
    }
  }, [mode, populationSamples]);

  // ── External hover sync (e.g. left rail row hover) ─────────────
  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    refs.hoveredId = hoveredSubunitId ?? null;
  }, [hoveredSubunitId]);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 z-[1]"
      // Prevent the global text-cursor on canvas hover; the chamber
      // sets its own cursor in onPointerMove.
      style={{ cursor: "default" }}
    />
  );
}

// ── Scene picker ──
//
// Small popover that lets the user switch the page background preset
// without leaving the surface. Live preview: clicking a preset
// PATCHes synergy_profiles.background_preset and calls
// router.refresh() so the server-rendered SceneBackground updates
// in place.
//
// Visual: a single icon button (Image icon) that opens a 6-tile
// grid + a "Custom" slot. Each tile is a tiny preview swatch of the
// preset's gradient with a check overlay when active.
//
// Apple aesthetic: no labels on the tile grid itself (the label
// appears in the picker header when hovered, like Finder's
// view-options popover). Subtle border, soft shadow, click-outside
// to close.

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Image as ImageIcon } from "lucide-react";
import {
  SCENE_PRESETS,
  SCENE_PRESET_ORDER,
  type ScenePresetKey,
} from "@/lib/synergy/scene-presets";
import { toast } from "@/lib/hooks/use-toast";

interface Props {
  currentPreset: ScenePresetKey;
  hasCustom: boolean;
}

export function SynergyScenePicker({ currentPreset, hasCustom }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hovered, setHovered] = useState<ScenePresetKey | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const pick = async (key: ScenePresetKey) => {
    if (busy || key === currentPreset) return;
    if (key === "custom" && !hasCustom) {
      toast.info("Upload a custom image first in your profile.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/synergy/profiles/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ background_preset: key }),
      });
      if (!res.ok) {
        let msg = `${res.status}`;
        try {
          const body = await res.json();
          if (body.error) msg = body.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      router.refresh();
      setOpen(false);
    } catch (err) {
      toast.error("Couldn't save scene", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const activeLabel = SCENE_PRESETS[currentPreset]?.label ?? "Mist";
  const hoveredPreset = hovered ? SCENE_PRESETS[hovered] : null;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 transition hover:border-gray-300"
        title="Change scene background"
      >
        <ImageIcon className="h-3.5 w-3.5 text-gray-500" />
        Scene
        <span className="ml-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
          {activeLabel}
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 z-30 mt-2 w-[260px] rounded-2xl border border-gray-200 bg-white p-3"
          style={{
            boxShadow:
              "0 1px 2px rgba(15,23,42,0.04), 0 12px 32px -8px rgba(15,23,42,0.16)",
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
              Scene
            </div>
            {hoveredPreset && (
              <div className="text-[11px] font-medium text-gray-900">
                {hoveredPreset.label}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {SCENE_PRESET_ORDER.map((key) => {
              const p = SCENE_PRESETS[key];
              const active = key === currentPreset;
              const isCustom = key === "custom";
              const disabled = isCustom && !hasCustom;
              return (
                <button
                  key={key}
                  onClick={() => pick(key)}
                  onMouseEnter={() => setHovered(key)}
                  onMouseLeave={() => setHovered(null)}
                  disabled={busy || disabled}
                  title={disabled ? "Upload a custom image first" : p.label}
                  className={[
                    "relative h-14 overflow-hidden rounded-lg ring-1 transition",
                    active
                      ? "ring-gray-900 ring-2"
                      : "ring-gray-200 hover:ring-gray-300",
                    disabled && "opacity-40 cursor-not-allowed",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    background: isCustom
                      ? // Custom slot: subtle dashed cross-hatch to read as "your image goes here"
                        "repeating-linear-gradient(45deg, #fafafa 0 6px, #f0f0f0 6px 12px)"
                      : p.background,
                  }}
                >
                  {active && (
                    <span className="absolute right-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-gray-900 text-white">
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  )}
                  {isCustom && (
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-gray-500">
                      Custom
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {hoveredPreset && (
            <p className="mt-3 text-[11px] leading-relaxed text-gray-600">
              {hoveredPreset.blurb}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

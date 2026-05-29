// ── AmbientBackdrop ──
//
// The persistent pearl WHITEBOARD substrate behind every authenticated
// page — floor 0 of the spatial UI. Gives the app its Vision-Pro depth so
// floating cards / room-windows read as panes hovering over a whiteboard.
//
// IMPORTANT: the base fill is OPAQUE pearl (#F5F5F7), not transparent —
// otherwise whatever the active theme paints on `body.bg-gradient-page`
// (e.g. the legacy teal palette, if a user still has it saved) bleeds
// through and tints the whole substrate. Opaque base = pearl regardless
// of theme.
//
// Composition: opaque pearl → faint dot-grid (reads as a whiteboard) →
// soft top key-light → gentle edge vignette.
//
// Mounted once at the /app layout, fixed at -z-10. Hides itself whenever a
// SynergySceneBackground is active (those pages supply their own immersive
// scene) — see the `body.synergy-scene-active` rule in globals.css.

export function AmbientBackdrop() {
  return (
    <div
      aria-hidden
      className="ambient-backdrop pointer-events-none fixed inset-0 -z-10"
      style={{ background: "#F5F5F7" }}
    >
      {/* Dot grid — the "whiteboard" texture. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(rgba(15,23,42,0.06) 1.1px, transparent 1.1px)",
          backgroundSize: "22px 22px",
          backgroundPosition: "0 0",
        }}
      />
      {/* Key light — soft pearl glow from just above the top edge. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% -12%, rgba(255,255,255,0.9), transparent 55%)",
        }}
      />
      {/* Edge vignette — barely-there darkening at the corners so the
          substrate has volume and cards feel lifted off it. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(130% 120% at 50% 45%, transparent 62%, rgba(15,23,42,0.04))",
        }}
      />
    </div>
  );
}

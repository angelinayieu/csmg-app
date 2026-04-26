"use client";

/**
 * Whiteboard-esque backdrop for the projection shell.
 *
 * Sits behind the floating sidebar and projection card so the user
 * always feels like the base of the product is an infinite canvas.
 * Rendering the full tldraw editor here would be wasteful (~600KB +
 * Three.js neighbours) on every routed page, so we evoke the feel
 * with a dot grid on a soft gradient — the actual tldraw editor only
 * loads when the user clicks the Whiteboard button.
 */
export function WhiteboardBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* Base gradient — faintly cool to warm, like paper under light */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#f6f7fb] via-white to-[#f3f1ec]" />

      {/* Dot grid — tiny radial dots at a regular pitch. Using an
          inline SVG background keeps the pattern crisp at every zoom
          level without a separate asset. */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(15,23,42,0.18) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />

      {/* Ambient glows at corners — soft orbs that give the canvas a
          bit of depth. Pure decoration; kept faint so they never
          compete with real content in the projection card. */}
      <div className="absolute -left-40 -top-40 h-[420px] w-[420px] rounded-full bg-[rgba(125,211,252,0.18)] blur-[90px]" />
      <div className="absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full bg-[rgba(196,181,253,0.16)] blur-[110px]" />
    </div>
  );
}

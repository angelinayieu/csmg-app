"use client";

// ── Population HUD ───────────────────────────────────────────────
//
// Top-center overlay shown when mode === "population". Reads the
// pre-computed population samples and surfaces summary stats:
//   - n
//   - K mean ± stddev
//   - K range
//   - color legend (red = fail, green = success)
//
// The actual sample dots render inside ContextualChamber3D's
// cloudGroup. This component is just chrome for that.

export interface PopulationHudProps {
  samples: Array<{ K: number; success: number }>;
}

export function PopulationHud({ samples }: PopulationHudProps) {
  const n = samples.length;
  const ks = samples.map((s) => s.K);
  const mean = ks.length ? ks.reduce((a, b) => a + b, 0) / ks.length : 0;
  const variance = ks.length
    ? ks.reduce((acc, v) => acc + (v - mean) ** 2, 0) / ks.length
    : 0;
  const stddev = Math.sqrt(variance);
  const min = ks.length ? Math.min(...ks) : 0;
  const max = ks.length ? Math.max(...ks) : 0;

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-5 z-[5] flex max-w-[calc(100%-260px)] -translate-x-1/2 items-center gap-[18px] rounded-[10px] border border-black/[0.08] bg-white px-3.5 py-2.5 text-[12px] text-[#6e6e73] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_3px_rgba(0,0,0,0.05)]"
    >
      <span>Population Monte Carlo</span>
      <span>
        n ={" "}
        <b className="font-semibold tabular-nums text-[#1d1d1f]">{n}</b>
      </span>
      <span>
        K ={" "}
        <b className="font-semibold tabular-nums text-[#1d1d1f]">
          {mean.toFixed(1)} ± {stddev.toFixed(1)}
        </b>
      </span>
      <span>
        Range{" "}
        <b className="font-semibold tabular-nums text-[#1d1d1f]">
          {min.toFixed(1)}–{max.toFixed(1)}
        </b>
      </span>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-[#86868b]">Fail</span>
        <div
          className="h-1.5 w-20 rounded-[3px]"
          style={{
            background:
              "linear-gradient(90deg, #ff375f, #ff9500, #ffcc00, #34c759)",
          }}
          aria-hidden
        />
        <span className="text-[10px] text-[#86868b]">Success</span>
      </div>
    </div>
  );
}

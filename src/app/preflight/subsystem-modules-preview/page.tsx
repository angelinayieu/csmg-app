// Preview harness for SubsystemModulesView — the re-altitude'd room
// "Subsystems" tab. Each LEVER (mechanism) is a subsystem module previewing
// its internal data-flow; modules are wired by DETERMINISTIC directional
// produces→consumes token edges (the rigorous "how levers interlock" axis the
// causal-flow Map drops). Runs hand-crafted-but-realistic specs through the
// REAL buildSubsystemModules transform so this exercises the live pipeline,
// not a parallel mock. Public dev route. SAFE TO DELETE.

"use client";

import { SubsystemModulesView } from "@/components/objective/subsystem-modules-view";
import { buildSubsystemModules } from "@/lib/objective-canvas/build-subsystem-modules";
import type { RoomLane, LayerItem } from "@/components/objective/sub-objective-room-view";
import type { RoomCategories } from "@/lib/objective-canvas/generate-categories";

// One runtime_flow step with the engineering spine + token wiring.
function step(
  s: string,
  component: string,
  data: string,
  produces: string[],
  consumes: string[],
  user_sees = "—",
) {
  return { step: s, component, data, user_sees, produces, consumes };
}

// A feature-lane LayerItem carrying a mechanism_spec (or none → placeholder).
function lever(
  id: string,
  name: string,
  subCategory: string,
  spec: Record<string, unknown> | null,
): LayerItem {
  return {
    id,
    name,
    description: null,
    entity_type: "feature",
    causal_chain: { sub_category: subCategory },
    expanded_detail: spec ? { mechanism_spec: spec } : null,
  };
}

const M1 = lever("m1", "Mood Signal Capture", "mood_detection", {
  mechanism_of_action:
    "Fuses raw sensor + interaction signals into a single normalized mood vector the rest of the system can read.",
  user_visible_behavior:
    "The widget's mood ring shifts hue within a second of a detectable mood change.",
  input_data: ["device sensor feed", "recent interaction cadence"],
  runtime_flow: [
    step("Ingest raw sensor frames", "SensorBridge", "sensor feed → frames", [], ["raw_sensor_feed"]),
    step("Normalize + denoise", "SignalCleaner", "frames → clean signal", [], []),
    step("Emit mood vector", "MoodEncoder", "signal → mood_vector", ["mood_vector"], []),
  ],
});

const M2 = lever("m2", "Context Enricher", "mood_detection", {
  mechanism_of_action:
    "Joins the mood vector with the user's active identity goal to produce a context the renderer can theme against.",
  user_visible_behavior:
    "Widgets feel situationally aware — calmer at night, sharper mid-task.",
  input_data: ["active identity goal"],
  runtime_flow: [
    step("Resolve active goal", "GoalResolver", "goal id → goal", [], ["mood_vector"]),
    step("Compose enriched context", "ContextComposer", "mood + goal → context", ["enriched_context"], []),
  ],
});

const M3 = lever("m3", "Widget Composer", "widget_rendering", {
  mechanism_of_action:
    "Lays out widget slots from the enriched context and the live mood vector, deciding density and emphasis.",
  user_visible_behavior:
    "The widget rearranges its tiles to foreground what matters in the current mood + goal.",
  input_data: ["widget slot catalog"],
  runtime_flow: [
    step("Select slots", "SlotSelector", "context → slots", [], ["enriched_context"]),
    step("Rank by mood", "MoodRanker", "slots + mood → ranked", [], ["mood_vector"]),
    step("Resolve grid", "GridSolver", "ranked → grid", [], []),
    step("Emit layout", "LayoutEmitter", "grid → widget_layout", ["widget_layout"], []),
  ],
});

const M4 = lever("m4", "Theme Painter", "widget_rendering", {
  mechanism_of_action:
    "Paints the resolved layout with a mood-matched palette + motion, producing the final rendered widget.",
  user_visible_behavior:
    "Color, glow, and motion of the widget visibly track the user's mood.",
  input_data: ["palette library"],
  runtime_flow: [
    step("Map mood → palette", "PaletteMapper", "layout → palette", [], ["widget_layout"]),
    step("Render themed widget", "ThemeRenderer", "layout + palette → widget", ["themed_widget"], [], "themed widget on screen"),
  ],
});

// No mechanism_spec yet → renders the "not yet specified" placeholder module.
const M5 = lever("m5", "Regional Slang Mapper", "self_expression", null);

const lanes: RoomLane[] = [
  {
    slug: "features",
    label: "Mechanisms",
    color: "#2563EB",
    items: [M1, M2, M3, M4, M5],
  },
];

// One interferes_with conflict (symmetric) → drives the conflict strip.
const edges = [
  {
    source_entity_id: "m2",
    target_entity_id: "m4",
    relationship_type: "interferes_with",
    conditions:
      "richer context inflates layout, which the painter must then aggressively prune",
  },
];

const roomCategories: RoomCategories = {
  friction: [],
  mechanism: [
    { slug: "mood_detection", label: "Mood Detection", color: "#2563EB" },
    { slug: "widget_rendering", label: "Widget Rendering", color: "#7C3AED" },
    { slug: "self_expression", label: "Self-Expression", color: "#0E7490" },
  ],
  result: [],
};

export default function SubsystemModulesPreview() {
  const model = buildSubsystemModules({ lanes, edges, roomCategories });
  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        SubsystemModulesView — internal-mechanism harness
      </h1>
      <p style={{ fontSize: 12.5, color: "rgba(15,23,42,0.6)", marginBottom: 20 }}>
        Each lever is a subsystem module previewing its internal flow; modules
        are wired left→right by deterministic <strong>produces→consumes</strong>{" "}
        token edges. <strong>raw_sensor_feed</strong> is an external input;{" "}
        <strong>themed_widget</strong> is a terminal output; the last lever has
        no spec (placeholder); M2↔M4 carry an interferes_with conflict.
      </p>
      <SubsystemModulesView
        model={model}
        onOpenItem={(id) => console.log("open item", id)}
      />
    </div>
  );
}

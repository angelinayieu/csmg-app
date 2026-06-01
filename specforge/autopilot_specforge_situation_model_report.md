# Autopilot-First Objective Generation, Spec Forge, Rooms/Cards, and Situation Model Report

## 1. Executive Summary

The current product direction is to make the app operate through an **autopilot-first system** where the user’s intake prompt quickly generates a usable **v1 product skeleton**: objectives, feature structures, initial rooms, and a potential implementation tech spec. The user should not need to manually assemble the structure of the app after intake. The system should generate the first useful version quickly, then let the user deepen it through increasingly advanced optimization layers.

The core product model is:

**Intake prompt → macro objectives → feature skeleton → rooms auto-fill → v1 tech spec → optional deepening into v2 through autopilot optimization.**

The important strategic shift is that the **situation model** should become the main organizing spine of the product, not a deferred secondary view. As the system deepens mechanisms, evaluates variations, runs experiments, and updates feature logic inside rooms, those deeper layers should trace back into a visible whole-app **problem/solution model** on the main dashboard. This gives users a clear map of how the project becomes more complex and more optimized over time.

The product should therefore support two immediate paths after intake:

1. **Generate Tech Spec**  
   The user can accept the v1 skeleton and generate a technical implementation spec immediately.

2. **Deepen → v2**  
   The user can choose to deepen the current feature set through autopilot, where existing features are optimized through research, mechanism variation, scoring, refinement, and mechanism-spec generation.

The first implementation slice is focused on the **pre-room surface**: what appears immediately after the objective is approved but before the user enters individual rooms. This surface should make the v1-to-v2 workflow clear and reduce scattered controls.

---

## 2. Core Product Thesis

The app should not behave like a passive whiteboard or scattered workspace. It should behave like an intelligent system that takes a user's idea and automatically forms the first coherent product structure.

The user’s main idea is that by the time the system generates the **objective + features during intake**, it has already consolidated the structure of the final output. At that point, the main unknown is no longer “what is the app?” but rather:

- how the mechanisms should work,
- how the user experience should be designed,
- how the features should coordinate,
- which variations are better,
- which mechanisms should be selected,
- and how all layers should be traced back to the original problem/solution model.

This means the intake flow should not stop at vague brainstorming. It should produce a real **v1 skeleton** that is already close to a technical product proposal.

The deeper optimization stage should then happen **after** v1 exists. The user can either proceed with the v1 tech spec or deepen into v2.

---

## 3. Complementary Set Logic

A central concept is the **complementary set**.

A complementary set exists at multiple levels:

### Macro Complementary Set

At the macro level, the whole app proposal is one coordinated system. The whiteboard, generated objective, rooms, features, and operations should all point toward one final output: the **tech spec**.

In this sense, the full app proposal is a set of coordinated internal complementary systems. These systems should not be random features. They should work together to produce the final intended product.

### Micro Complementary Set

At the micro level, complementary sets operate inside each feature, objective, and mechanism. The system must curate combinations of mechanisms, methods, and feature logic so that each part supports the larger objective.

The micro-level complementary set focuses on:

- feature coordination,
- mechanism selection,
- micro-objective alignment,
- variation evaluation,
- downstream data flow,
- and how each mechanism supports the macro goal.

### Why This Matters

The system should not merely generate many options. It must determine which combinations are most complementary and useful. Variations should be explored, but the final output should be a ranked and coordinated system, not a pile of disconnected ideas.

---

## 4. Layer Optimization Framework

The product should optimize the idea through four connected layers:

1. Macro layer
2. Micro layer
3. Mechanism layer
4. Mechanism-to-micro-to-macro evaluation layer

Each layer follows the same general sequence:

**discover → evaluate → generate → distill**

This is important because it creates a repeatable structure for turning an idea into an optimized system.

---

## 5. Macro Layer

The macro layer defines the broad structure of the app.

### Macro Layer Process

1. **Discover**  
   Ask optimizing questions and decompose the idea into all major optimization factors.

2. **Evaluate**  
   Understand which factors matter most to the final goal, intention, mission, or philosophy.

3. **Generate**  
   Set the macro objectives of the product.

4. **Distill**  
   Convert the macro objectives into category layers.

### Macro Layer Output

The macro layer should produce:

- a concise AI-generated app title,
- a clear product purpose,
- macro objectives,
- category layers,
- and a structured path into microcards/features.

The macro layer is responsible for turning the original intake prompt into the product’s high-level structure.

---

## 6. Micro Layer

The micro layer converts macro objectives into more specific product components.

### Micro Layer Process

1. **Discover**  
   Ask micro-optimization questions and decompose each macro objective into smaller micro-objective layers.

2. **Evaluate**  
   Identify which micro-objectives matter most to the final goal.

3. **Generate**  
   Set the micro-objectives.

4. **Distill**  
   Convert the micro-objectives into core features.

### Micro Layer Output

The micro layer should produce feature cards or microcards that include:

- feature name,
- concise direct function,
- upstream data,
- downstream data,
- optimization objectives,
- top recommended mechanism,
- trace to experiment labs,
- and expandable ranked mechanisms.

### Current Important Decision

For the immediate implementation slice, **Deepen → v2 should optimize existing features only**. It should not yet re-curate the entire feature set through a full micro-objective tier. The micro-objective tier is important, but it should be deferred until the pre-room spine and situation model are working.

---

## 7. Mechanism Layer

The mechanism layer determines how each feature actually works.

### Mechanism Layer Process

1. **Discover**  
   Ask optimization questions and generate many possible solutions.

2. **Analyze and Decompose**  
   Break the mechanism into:
   - internal upstream mechanisms,
   - process mechanisms,
   - downstream mechanisms,
   - and interconnections across systems.

3. **Micro Evaluation**  
   Decide which processes, conceptual focuses, or technical approaches best optimize for the micro-objectives.

4. **Micro Distillation**  
   Rank the most optimal mechanisms that align with the micro and macro layers.

### Mechanism Layer Output

Each mechanism card should contain:

- the top recommended mechanism,
- internal mechanism proposal,
- experiment evaluation standard,
- experiment labs,
- experiment proposals,
- independent variables,
- dependent variables,
- controlled variables,
- lab outcomes,
- and ranked alternatives.

The mechanism layer is where complexity should increase. The rooms are where features become deeper, more tested, and more technically specific.

---

## 8. Mechanism-to-Micro-to-Macro Evaluation

The final optimization layer compares combinations across all levels.

### Process

1. **Cross-Analyze**  
   Determine which combinations of mechanisms, features, and objectives best optimize for the final outcome, intention, mission, or philosophy.

2. **Rebalance Complexity**  
   Adjust the app’s complexity distribution according to what matters most.

3. **Distill**  
   Rank the final optimal system.

### Purpose

This layer ensures that the system is not optimizing individual mechanisms in isolation. It evaluates whether the whole product remains coherent as it becomes more complex.

---

## 9. Spec Forge Agent Role

Spec Forge should not be treated as a separate visual or manual process. Its role should be integrated into the autopilot pipeline.

The main value of Spec Forge is that it already follows the kind of reasoning needed:

- diverge,
- converge,
- trace every leaf back to a root,
- distinguish complementary components from alternatives,
- and convert ideas into a structured skeleton.

The desired use is not to expose all intermediate Spec Forge steps to the user. Instead, Spec Forge-like reasoning should run internally through the LLM/autopilot system.

### What Spec Forge Should Do Internally

It should help generate:

- macro objectives,
- micro-objectives,
- feature sets,
- complementary vs. variation labels,
- mechanism candidates,
- and the initial tech-spec skeleton.

### What Should Surface to the User

The interface should surface only the most useful outputs:

- the approved v1 skeleton,
- the generated tech spec option,
- the deepen/v2 option,
- the situation model,
- the rooms,
- ranked mechanisms,
- and traceable history.

The user should not be overwhelmed with the full internal chain unless they intentionally open deeper views.

---

## 10. V1 vs. V2 Product Flow

The system should support a clear staged workflow.

### V1: Fast Skeleton

V1 is created immediately after intake and approval. It contains the first coherent product structure.

V1 should include:

- objective,
- generated features,
- initial rooms,
- problem/solution map,
- initial mechanism recommendations,
- and a generated tech implementation spec option.

The user should be able to stop here and proceed with implementation if satisfied.

### V2: Deepening Through Autopilot

V2 happens when the user chooses to deepen the project.

V2 should:

- optimize existing features,
- explore mechanism variations,
- conduct research,
- rank mechanisms,
- generate deeper mechanism specs,
- update the situation model,
- and add a history/complexity marker.

The important decision is that V2 currently **does not re-curate the full feature set**. It optimizes existing features only. Full feature re-curation can become a later phase when the micro-objective tier is added.

---

## 11. Rooms and Cards Model

Rooms and cards should not be disconnected interface objects. They should represent levels of the product model.

### Rooms

Rooms are where the complexity deepens. When the user approves the intake output and enters the objective page, rooms should start generating immediately.

Rooms should:

- auto-fill from approved/generated features,
- avoid duplicate generation,
- support mechanism variation,
- host deeper research and evaluation,
- form new mechanism layers,
- and trace all new complexity back to the situation model.

### Cards

Cards should be more than simple display items. A card should be able to function like a room when it contains deeper evaluation.

The goal is to eliminate dependence on side popups where possible. Instead, the card itself should become a structured entry point into:

- mechanism evaluation,
- experiments,
- variations,
- rankings,
- data flow,
- and lab outcomes.

### Mechanism Cards as Rooms

The current side popup should eventually be retired or reduced. Mechanism cards should become canonical rooms/pages that host:

- top mechanism,
- alternatives,
- experiments,
- scoring,
- outcomes,
- and traceability back to the parent feature and situation model.

---

## 12. Macro Card Requirements

The final macro layer card should contain:

- AI-generated concise app title,
- clear product purpose,
- macro objective category layers,
- macro objectives,
- microcards/features,
- and multiple views of the product model.

### Required Macro Views

1. **Blueprint View**  
   A normal card layout showing the product structure.

2. **Situation Model View**  
   A problem/solution layer model showing how the app solves the user’s problem and how the system becomes deeper over time.

3. **Data Map View**  
   A data flow and operations map showing:
   - the initial data point,
   - transformation operators,
   - output states,
   - and how data moves through the system.

The situation model should become the central view, not an afterthought.

---

## 13. Feature/Micro Card Requirements

A final feature or micro-layer card should contain:

- feature name,
- concise direct function,
- upstream data,
- downstream data,
- optimization objectives,
- top recommended mechanism,
- tracing to experiment labs,
- expandable ranked mechanisms.

The card should show enough information for the user to understand what the feature does, why it exists, how it supports the objective, and what mechanism was selected.

It should also allow deeper exploration without forcing the user into a cluttered drawer system.

---

## 14. Mechanism Card Requirements

A mechanism card should have two levels: main and expanded.

### Main View

The main view shows the **top recommended mechanism**.

### Expanded View

The expanded view should show:

- internal mechanism proposal,
- experiment evaluation standard,
- experiment labs,
- experiment proposals,
- independent variables,
- dependent variables,
- controlled variables,
- experiment outcomes,
- and ranked alternatives.

The card should support the transition from “recommended mechanism” to “tested mechanism logic.”

---

## 15. Situation Model as the Main Spine

The situation model is the most important interface concept that emerged from the discussion.

The situation model should show the whole-app problem/solution structure. It should be visible on the dashboard and should grow as rooms deepen.

### What It Should Show

The situation model should show:

- the original problem,
- the proposed solution layers,
- the features created to address each problem layer,
- the mechanisms supporting each feature,
- the new layers formed through deepening,
- and the timeline of complexity growth.

### Why It Matters

As the system deepens across rooms, macro layers, micro layers, and mechanism layers, the user needs to see how each new piece connects back to the original product thesis.

Without the situation model, the app risks becoming a collection of separate rooms, cards, and generated mechanisms. With the situation model, the user sees one coherent system growing over time.

---

## 16. History and Complexity Timeline

The history timeline should show how the product evolves from v1 to v2 and beyond.

This timeline should be proportional to complexity. As the system adds deeper layers, mechanism variations, research, and refinements, the timeline should show the project becoming more developed.

### Timeline Stages

The timeline should support:

- v1 initial skeleton,
- deepen/v2 run,
- synthesis versions,
- future forks,
- comparison points,
- and complexity growth markers.

### Purpose

The timeline helps users understand that the system is not randomly changing the project. It is incrementally increasing depth and optimization.

---

## 17. Interface Requirements Before Entering a Room

The key interface surface is the pre-room page after the objective is approved.

This page should make the user’s options obvious.

### Required Pre-Room Controls

1. **State Line**
   - Shows whether the v1 skeleton is ready.
   - Shows room generation progress.
   - Example: “v1 skeleton ready · N rooms.”
   - Example during generation: “Building v1 skeleton · 2/4.”

2. **Generate Tech Spec**
   - Generates the v1 technical implementation spec from the current product skeleton.
   - This should be a primary action, not buried inside the Strategy Brief.

3. **Deepen → v2**
   - Runs the existing autopilot deepening process.
   - Optimizes existing features only.
   - Should be locked or disabled until rooms finish generating.
   - Should clearly communicate that this deepens the model, not that it restarts the idea.

4. **Situation View**
   - Should appear as a primary/default view in the dashboard-level view control.
   - Should show the whole-app problem/solution model.

### Interface Principle

The user should not have to guess what to do after intake. The page should clearly say:

- use v1 now,
- generate implementation spec,
- or deepen into v2.

---

## 18. Current System Mapping from Prior Notes

The pasted implementation notes described that several major pieces already exist in the codebase and should be reused rather than rebuilt.

### Already Existing or Mostly Existing

- feature-to-sub-objective link through `parent_sub_objective_id`,
- sub-objective-to-room confirm flow,
- room generation idempotency,
- mechanism generation,
- variation ranking,
- top-1 mechanism selection,
- mechanism-as-room lab page,
- tech-spec compiler,
- blueprint view,
- data map view,
- Spec Forge-style diverge/converge discipline,
- RoomFillRunner for auto-generating rooms after approval,
- CanvasAutopilotRunner for optimizing existing features,
- AgentBuildSpec route for generating the tech spec.

### Important Current Finding

The system is not mainly missing engines. It is missing the correct **surface, sequence, and integration**.

The work is mostly:

- relabeling,
- re-sequencing,
- surfacing buried actions,
- connecting existing views,
- creating a whole-app situation model,
- and making the v1→v2 workflow legible.

---

## 19. Existing Gaps

The following gaps were identified.

### 1. Presentation and Labeling Gap

Some screens group content by causal altitude instead of by sub-objective. This causes confusing categories like “Other.”

The fix is to make sub-objectives the top-level category and nest real features underneath.

### 2. Micro-Objective Tier Missing

The system currently jumps from sub-objectives to features. It does not yet fully decompose macro-objectives into micro-objectives before distilling core features.

This is important but not part of the immediate slice.

### 3. Complementary vs. Variation Not Stored

The system needs a stored `set_role` or equivalent label to distinguish:

- complementary features that ship together,
- versus variations that are alternatives.

This supports “See more” as more variations within the same layer, not random additional cards.

### 4. Experiments Not Fully Attached to Mechanism Specs

Experiment proposals, variables, and lab outcomes need to attach directly to the feature’s mechanism spec.

This is required for full tracing from feature → mechanism → experiment → outcome.

### 5. Side Popup Still Too Important

The current detail drawer or side popup remains too central. The longer-term goal is to make the card or lab page the real room.

### 6. Whole-App Situation Model Missing

There may be per-room problem/solution or altitude views, but a whole-app dashboard-level situation model is still needed.

### 7. Cross-Layer Optimizer Not Fully Wired

There are pieces for combination evaluation, but they are not yet a true cross-layer optimizer feeding the final spec.

This can be deferred.

---

## 20. Finalized Implementation Direction

The agreed immediate direction is:

### Slice 1: Pre-Room Spine and Buttons

Build the pre-room interface spine.

This includes:

- state line for v1 skeleton and room generation,
- primary “Generate tech spec” action,
- primary “Deepen → v2” action,
- moving autopilot out of cluttered header placement,
- and making the v1→v2 workflow visible before entering rooms.

### Slice 2: Whole-App Situation Model

Create the dashboard-level situation model.

This includes:

- aggregating problem/solution layers across rooms,
- showing how features and mechanisms connect to the original problem,
- making “Situation” the first/default dashboard view,
- and ensuring deepened layers trace back to this model.

### Slice 3: Version and Complexity Timeline

Wire deepening runs to the version/history system.

This includes:

- v1 skeleton marker,
- deepen/v2 marker,
- annotations/version updates,
- and a visible complexity timeline.

### Deferred

The following should be deferred unless needed:

- full micro-objective tier,
- full feature re-curation during v2,
- group/fork tree migration,
- full cross-layer optimizer,
- full side popup retirement,
- complete experiment-lab wiring.

This is the strict path because the current priority is to make the autopilot-first experience coherent, not to expand scope.

---

## 21. Completed Slice 1 Status from Prior Notes

The prior implementation notes state that Slice 1 was completed.

### Added

`src/components/objective/pre-room-spine.tsx`

This component creates the pre-room spine under the core objective.

It includes:

- v1 skeleton state line,
- Generate Tech Spec action,
- Deepen → v2 action,
- reuse of existing AgentBuildSpec route,
- reuse of existing CanvasAutopilotRunner,
- and no duplication of the autopilot engine.

### Edited

`src/components/objective/main-canvas-view.tsx`

Changes described:

- removed autopilot from the top-right header,
- mounted the pre-room spine under the objective card,
- swapped imports,
- and kept RoomFillRunner behavior intact.

### Added Harness

`src/app/preflight/spine-preview/page.tsx`

This was created as a throwaway preview harness and can be deleted later.

### Verification Status

The notes state that ESLint passed on the changed files. The preview server was wedged and did not respond, likely due to environmental compile contention, so visual confirmation was not completed at that moment.

---

## 22. Page-by-Page Upgrade Plan

### `main-canvas-view.tsx`

Purpose: the primary pre-room objective page.

Planned or completed changes:

- add the pre-room spine under the core objective,
- move autopilot controls out of scattered header placement,
- add or expose the “Generate tech spec” button,
- add or expose the “Deepen → v2” button,
- make Situation the first/default view later,
- reduce clutter by consolidating actions.

### `pre-room-spine.tsx`

Purpose: new pre-room action surface.

Responsibilities:

- show v1 skeleton readiness,
- show room auto-fill status,
- expose tech spec generation,
- expose v2 deepening,
- prevent premature deepening before rooms are ready,
- and frame the user’s choice clearly.

### `situation-model-view.tsx`

Purpose: new whole-app problem/solution model.

Responsibilities:

- aggregate room-level problem/solution layers,
- show how the project becomes more complex,
- display problem → solution → feature → mechanism relationships,
- connect to history/timeline,
- and become the main dashboard spine.

### `canvas-autopilot-runner.tsx`

Purpose: existing autopilot engine for deepening.

Planned change:

- light integration only,
- reuse current runner,
- optional relabeling to “Deepen → v2,”
- append version marker after completion,
- refresh situation model after deepening.

### `strategy-brief-view.tsx`

Purpose: existing buried tech spec action.

Planned change:

- keep current behavior for now,
- eventually retire duplicate/buried button when CommandDeck is condensed,
- avoid duplicating logic.

### `item-detail-drawer.tsx`

Purpose: current side popup/detail drawer.

Future direction:

- reduce dependency on this drawer,
- shift mechanism detail into lab/card-as-room flow,
- eventually make it secondary instead of central.

### Lab Page

Purpose: mechanism card as room.

Future direction:

- attach experiments and IV/DV/CV logic directly to mechanism specs,
- support ranked mechanism exploration,
- host lab outcomes,
- become the canonical mechanism-room page.

---

## 23. Autopilot Requirements

Autopilot should do the work quickly and automatically. The user should not need to manually move through every internal reasoning stage.

### Autopilot Should

- generate the v1 skeleton during intake/approval,
- auto-fill rooms,
- allow immediate v1 tech spec generation,
- deepen existing features into v2,
- research and vary mechanisms,
- rank mechanism alternatives,
- update mechanism specs,
- update the situation model,
- and record history/complexity changes.

### Autopilot Should Not Yet

- re-curate the full feature set during v2,
- rebuild the entire product skeleton during each deepen run,
- create orphaned feature sets,
- create parallel systems disconnected from rooms,
- or expose too many intermediate reasoning stages to the user.

---

## 24. Critical Product Rules

These rules should guide implementation.

### Rule 1: No Orphaned Systems

Every generated feature, mechanism, experiment, and deepened layer must trace back to:

- a parent sub-objective,
- a feature,
- a room,
- and the situation model.

### Rule 2: V1 Must Be Usable

The first generated skeleton should be good enough to produce a tech spec. Users should not be forced into deepening before receiving value.

### Rule 3: V2 Deepens, It Does Not Restart

The first v2 implementation should optimize the current feature set rather than re-curate all features.

### Rule 4: Situation Model Is the Spine

All deeper work should become visible through the situation model.

### Rule 5: Interface Must Be Condensed

The user is in “connecting + condensing + simplifying” mode. The UI should reduce scattered buttons and unify the workflow.

### Rule 6: Spec Forge Reasoning Should Be Internal

The system should use Spec Forge-like reasoning but surface only the clean outputs.

### Rule 7: Cards Should Become Rooms When Depth Requires It

Mechanism cards should support room-like expansion, not only side popups.

---

## 25. What Was Missed or Needs Attention

The prior plan mostly aligned with the user’s direction, but one priority changed.

### Priority Correction

The situation model should not be deferred. It should be treated as the main spine of the interface and the main way the user understands deepening.

### Need to Avoid Scope Creep

The micro-objective tier is important but should not block the current build. The priority is:

1. pre-room spine,
2. situation model,
3. version/complexity timeline.

Only after those should the system deepen into full micro-objective re-curation.

### Need Stable Traceability IDs

Every deepened layer should attach to stable identity anchors such as concept slugs or equivalent identifiers. Without this, the situation model and history timeline will become unreliable.

### Need to Retire Redundant Entry Points

If “Generate Tech Spec” exists both in the new spine and buried inside Strategy Brief, the duplicated surface should eventually be cleaned up.

---

## 26. Recommended Final Build Sequence

### Phase 1 — Immediate

Finish the pre-room user choice surface.

- Show v1 readiness.
- Show Generate Tech Spec.
- Show Deepen → v2.
- Make room generation status obvious.

### Phase 2 — Next

Build the whole-app situation model.

- Make it dashboard-level.
- Connect it to rooms.
- Show problem/solution layers.
- Make it grow after deepening.

### Phase 3 — Next

Add the v1/v2 history and complexity timeline.

- Mark v1 skeleton.
- Mark deepen runs.
- Show growth in complexity.
- Let users understand changes over time.

### Phase 4 — Later

Add the micro-objective tier.

- Macro → micro → feature decomposition.
- More precise feature generation.
- Better control of core features.

### Phase 5 — Later

Wire experiments to mechanism specs.

- IV/DV/CV proposals.
- Lab outcomes.
- Mechanism scoring.
- Full trace from experiment to final mechanism.

### Phase 6 — Later

Build or wire the cross-layer optimizer.

- Evaluate mechanism combinations.
- Optimize system-wide feature coordination.
- Feed the final tech spec.

---

## 27. Final Alignment Statement

The correct product direction is:

**Use intake to create a useful v1 product skeleton and tech spec as quickly as possible. Use autopilot to deepen existing features into v2. Use the situation model as the dashboard spine so every room, card, mechanism, variation, and experiment traces back to the product’s problem/solution model.**

The immediate build should stay focused on the pre-room spine and situation model. Do not switch into building the full micro-objective layer yet. That would be valuable later, but right now it risks expanding complexity before the central workflow is clear.


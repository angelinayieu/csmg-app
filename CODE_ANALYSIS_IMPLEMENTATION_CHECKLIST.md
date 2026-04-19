# Code Analysis System - Implementation Checklist

**Status:** Ready to Execute  
**Timeline:** 4-16 weeks depending on scope  
**Estimated Effort:** 140-200 engineering hours  

---

## PHASE 1: MVP - Code Graph Extraction (Weeks 1-2) [60-80 hours]

### Sprint 1.1: GitHub Integration + AST Parsing (Week 1)

- [ ] **1.1.1** Install TypeScript compiler API + dependencies
  - [ ] `npm install typescript @types/node`
  - [ ] Create `src/lib/code-analysis/parser.ts`
  - [ ] Estimate: 2 hours

- [ ] **1.1.2** Build GitHub API client
  - [ ] `npm install octokit`
  - [ ] Create `src/lib/code-analysis/github-fetcher.ts`
  - [ ] Functions: `fetchRepoFiles()`, `getCommitHistory()`
  - [ ] Estimate: 3 hours

- [ ] **1.1.3** AST parser foundation
  - [ ] Parse TypeScript files to AST
  - [ ] Create `src/lib/code-analysis/ast-walker.ts`
  - [ ] Implement `parseFile()`, `visitNode()`, `extractMetadata()`
  - [ ] Test on 5 real files from your codebase
  - [ ] Estimate: 5 hours

- [ ] **1.1.4** Function extraction
  - [ ] Identify all function declarations
  - [ ] Capture: name, parameters, return type, body
  - [ ] Calculate cyclomatic complexity
  - [ ] `npm install complexity`
  - [ ] Test: verify ~150 functions extracted from src/lib/
  - [ ] Estimate: 4 hours

### Sprint 1.2: Entity & Edge Extraction (Week 2)

- [ ] **1.2.1** Class/Interface extraction
  - [ ] Identify all class declarations, interfaces, types
  - [ ] Capture: properties, methods, inheritance
  - [ ] Test: verify interfaces match TypeScript types
  - [ ] Estimate: 4 hours

- [ ] **1.2.2** Import/Dependency extraction
  - [ ] Track all `import` statements
  - [ ] Classify: internal vs. external
  - [ ] Mark: direct imports vs. transitive
  - [ ] Test: verify all 847 entities found
  - [ ] Estimate: 3 hours

- [ ] **1.2.3** Call graph extraction
  - [ ] Within each function, track what it calls
  - [ ] Link calls to target functions
  - [ ] Confidence scoring (direct call = 1.0, inferred = 0.7)
  - [ ] Test: verify 3200+ edges found
  - [ ] Estimate: 5 hours

- [ ] **1.2.4** Build CodeGraph data structure
  - [ ] Create `src/lib/code-analysis/types.ts`
  - [ ] Types: CodeEntity, CodeEdge, CodeGraph, CodeMetrics
  - [ ] Serialization to JSON
  - [ ] Estimate: 2 hours

- [ ] **1.2.5** Deduplication & normalization
  - [ ] Merge duplicate entities (same function found twice)
  - [ ] Normalize paths (resolve ../ references)
  - [ ] Handle aliased imports
  - [ ] Test on actual codebase
  - [ ] Estimate: 4 hours

- [ ] **1.2.6** Database insertion
  - [ ] Create schema migration for code entities/edges
  - [ ] Create `code_entities` table (parallel to entities)
  - [ ] Create `code_edges` table (parallel to edges)
  - [ ] Create `code_analysis_runs` table (tracks analyses)
  - [ ] Estimate: 3 hours

**Sprint 1 Subtotal: ~35 hours**

### Sprint 2: Bottleneck Detection (Week 2-3)

- [ ] **1.3.1** Hub detection (centrality analysis)
  - [ ] Calculate in-degree for each entity
  - [ ] Flag if in-degree > 20 (configurable threshold)
  - [ ] Severity: HIGH if >50 dependents
  - [ ] Output: list of "hub" bottlenecks
  - [ ] Estimate: 3 hours

- [ ] **1.3.2** Circular dependency detection
  - [ ] Implement cycle detection algorithm (DFS-based)
  - [ ] Find all circular import chains
  - [ ] Severity: CRITICAL (always)
  - [ ] Output: list of cycles with entity paths
  - [ ] Test on your codebase (should find 0-2 cycles)
  - [ ] Estimate: 4 hours

- [ ] **1.3.3** Dead code detection
  - [ ] Find functions with in-degree = 0
  - [ ] Filter: exclude exported functions, main(), tests
  - [ ] Severity: LOW (safe to remove)
  - [ ] Output: list of dead code candidates
  - [ ] Estimate: 2 hours

- [ ] **1.3.4** Complexity analysis
  - [ ] Use cyclomatic complexity scores
  - [ ] Flag if complexity > 15 (HIGH), > 25 (CRITICAL)
  - [ ] Output: list of complex functions to refactor
  - [ ] Estimate: 2 hours

- [ ] **1.3.5** Test coverage gaps
  - [ ] Parse test files (*.test.ts, *.spec.ts)
  - [ ] Match test calls to source functions
  - [ ] Calculate coverage per function
  - [ ] Flag if coverage < 50% (MEDIUM), < 20% (HIGH)
  - [ ] Estimate: 3 hours

- [ ] **1.3.6** Bottleneck aggregator
  - [ ] Combine all bottleneck types into one CodeBottleneck[]
  - [ ] Sort by severity + impact
  - [ ] Create summary: "Found X critical, Y high, Z medium issues"
  - [ ] Estimate: 2 hours

**Sprint 2 Subtotal: ~16 hours**

### Sprint 3: Visualization (Week 3-4)

- [ ] **1.4.1** D3.js graph component
  - [ ] `npm install d3 @types/d3`
  - [ ] Create React component: `<CodeDependencyGraph />`
  - [ ] Render nodes (entities) + edges (dependencies)
  - [ ] Color coding: green (OK), yellow (warning), red (critical)
  - [ ] Size scaling: proportional to complexity
  - [ ] Estimate: 8 hours

- [ ] **1.4.2** Interactive exploration
  - [ ] Click node → show details (complexity, tests, callers)
  - [ ] Hover edge → show edge type & frequency
  - [ ] Filter by type (functions, classes, modules)
  - [ ] Search by entity name
  - [ ] Zoom/pan controls
  - [ ] Estimate: 6 hours

- [ ] **1.4.3** Bottleneck scorecard component
  - [ ] `<CodeHealthScore />` component
  - [ ] Summary: "72/100 (B-)"
  - [ ] Lists: Critical (count), High (count), Medium (count)
  - [ ] Breakdown by bottleneck type (hubs, circular, complexity, tests)
  - [ ] Estimate: 4 hours

- [ ] **1.4.4** Dashboard page
  - [ ] Create `pages/code-analysis.tsx`
  - [ ] Layout: graph on left, scorecard + details on right
  - [ ] Filters: show only HIGH+ severity, or all
  - [ ] Export: PNG snapshot of graph
  - [ ] Estimate: 4 hours

**Sprint 3 Subtotal: ~22 hours**

### Phase 1 Total: 60-80 hours
**Deliverable:** GitHub repo → bottleneck detection + visualization

---

## PHASE 2: Decomposition Integration (Weeks 5-8) [40-60 hours]

### Sprint 2.1: Code-Specific Prompts (Week 5)

- [ ] **2.1.1** Adapt decomposition prompt for code
  - [ ] Create `src/lib/prompts/code-decomposition.ts`
  - [ ] Define code-specific entity types (function, class, module, import)
  - [ ] Define code-specific edge types (calls, imports, tests, queries)
  - [ ] Define code-specific metrics (complexity, test coverage, dependencies)
  - [ ] Estimate: 3 hours

- [ ] **2.1.2** Create code structuring prompt
  - [ ] Create `src/lib/prompts/code-structuring.ts`
  - [ ] Output format: StructuredDecomposition but for code
  - [ ] Include: leverage points (critical functions), risk points (untested code)
  - [ ] Include: cycles (circular dependencies), constraints (import restrictions)
  - [ ] Estimate: 2 hours

- [ ] **2.1.3** Create code synthesis prompt
  - [ ] Create `src/lib/prompts/code-synthesis.ts`
  - [ ] Identify patterns: "Module A is tightly coupled to Module B"
  - [ ] Identify risks: "Circular imports could break in bundling"
  - [ ] Identify opportunities: "Shared code could be extracted"
  - [ ] Estimate: 2 hours

**Sprint 2.1 Subtotal: ~7 hours**

### Sprint 2.2: Decomposition Pipeline (Week 6)

- [ ] **2.2.1** Adapter: CodeGraph → StructuredDecomposition
  - [ ] Create `src/lib/code-analysis/to-decomposition.ts`
  - [ ] Convert: CodeEntity → StructuredEntity
  - [ ] Convert: CodeEdge → StructuredEdge
  - [ ] Populate manifold: strategic (maintainability), operational (dependency count), epistemic (code certainty)
  - [ ] Estimate: 5 hours

- [ ] **2.2.2** Run decomposer on code
  - [ ] Create `/api/code-analysis/decompose` endpoint
  - [ ] Input: repo URL, branch
  - [ ] Step 1: Fetch code & build graph
  - [ ] Step 2: Transform to StructuredDecomposition
  - [ ] Step 3: Call Agent 1 (decomposer) with code-specific prompt
  - [ ] Step 4: Return enriched decomposition
  - [ ] Estimate: 5 hours

- [ ] **2.2.3** Run structurer on code
  - [ ] Reuse existing structurer (already works on JSON)
  - [ ] Input: raw decomposer output
  - [ ] Output: validated StructuredDecomposition with code-specific validations
  - [ ] Estimate: 3 hours

- [ ] **2.2.4** Store analysis in database
  - [ ] Create `code_analyses` table (parallel to spaces)
  - [ ] Store: repo_url, analysis_date, decomposition, synthesis
  - [ ] Create: `src/lib/code-analysis/store.ts`
  - [ ] Estimate: 3 hours

**Sprint 2.2 Subtotal: ~16 hours**

### Sprint 2.3: Code Smells Detection (Week 7)

- [ ] **2.3.1** Smell 1: Circular imports
  - [ ] Agent 3 (critic) identifies cycles
  - [ ] Output: list of circular import chains
  - [ ] Severity: CRITICAL
  - [ ] Estimate: 2 hours

- [ ] **2.3.2** Smell 2: Tight coupling
  - [ ] Identify: Module A imports Module B imports Module A
  - [ ] Or: Function has >5 external dependencies
  - [ ] Output: modules/functions to refactor
  - [ ] Severity: HIGH
  - [ ] Estimate: 2 hours

- [ ] **2.3.3** Smell 3: Low cohesion
  - [ ] Identify: Module exports 20+ functions with low interconnection
  - [ ] Output: functions that should move to different module
  - [ ] Severity: MEDIUM
  - [ ] Estimate: 2 hours

- [ ] **2.3.4** Smell 4: Hidden dependencies
  - [ ] Identify: Function calls external API but doesn't import it
  - [ ] Suggests: dependency injection needed
  - [ ] Severity: MEDIUM
  - [ ] Estimate: 2 hours

**Sprint 2.3 Subtotal: ~8 hours**

### Sprint 2.4: Synthesis (Week 8)

- [ ] **2.4.1** Run Agent 6 on code analysis
  - [ ] Input: code decomposition
  - [ ] Identify: architectural patterns (layered, modular, etc.)
  - [ ] Identify: areas of technical debt
  - [ ] Output: SynthesisData with code-specific insights
  - [ ] Estimate: 5 hours

- [ ] **2.4.2** Create code-specific insights
  - [ ] Leverage points: functions critical for system stability
  - [ ] Risk points: untested code, high complexity
  - [ ] Master bottleneck: the single biggest refactoring need
  - [ ] Estimate: 3 hours

**Sprint 2.4 Subtotal: ~8 hours**

### Phase 2 Total: 40-60 hours
**Deliverable:** Full code decomposition → synthesis pipeline

---

## PHASE 3: Strategy Generation (Weeks 9-12) [40-60 hours]

### Sprint 3.1: Code Refactoring Strategy (Week 9)

- [ ] **3.1.1** Adapt strategy prompts for refactoring
  - [ ] Create `src/lib/prompts/code-refactoring-strategy.ts`
  - [ ] Strategy type: Extract class, Reduce complexity, Break circular dependency, Improve test coverage
  - [ ] Output: StrategicRecommendation but for code refactoring
  - [ ] Estimate: 3 hours

- [ ] **3.1.2** Run strategy engine on code analysis
  - [ ] Create `/api/code-analysis/strategy` endpoint
  - [ ] Input: code decomposition + synthesis
  - [ ] Step 1: Diagnosis (what's wrong with the code?)
  - [ ] Step 2: Synthesis (what refactoring strategy?)
  - [ ] Step 3: Verification (what could go wrong?)
  - [ ] Output: StrategicRecommendation with refactoring plan
  - [ ] Estimate: 6 hours

- [ ] **3.1.3** Generate infrastructure map for refactoring
  - [ ] Core components: what classes/modules to create/refactor
  - [ ] Channels: new imports/dependencies
  - [ ] Activated loops: testing/validation
  - [ ] Estimate: 4 hours

- [ ] **3.1.4** Generate micro-tactics
  - [ ] Specific refactoring steps (extract function, move code, add tests)
  - [ ] Dependencies: what must be done first
  - [ ] Timeframe: can be done in 1 sprint? 2 sprints?
  - [ ] Estimate: 3 hours

**Sprint 3.1 Subtotal: ~16 hours**

### Sprint 3.2: Refactoring Roadmap (Week 10)

- [ ] **3.2.1** Priority ranking
  - [ ] Rank refactorings by impact (how many dependents?) × effort
  - [ ] Suggest: "Fix circular imports first (critical, 2 hours)"
  - [ ] Suggest: "Then reduce generateMultiStepStrategy complexity (5 days)"
  - [ ] Suggest: "Then add test coverage for sanitize.ts (3 days)"
  - [ ] Estimate: 3 hours

- [ ] **3.2.2** Timeline generation
  - [ ] Assume: 2 sprints = 80 engineering hours
  - [ ] Allocate hours to each refactoring
  - [ ] Output: "Sprint 1: Circular deps + dead code (15 hours). Sprint 2: Complex functions (35 hours). Sprint 3: Tests (30 hours)"
  - [ ] Estimate: 2 hours

- [ ] **3.2.3** Risk assessment
  - [ ] Pre-mortem: what could break during refactoring?
  - [ ] Mitigation: what tests must pass?
  - [ ] Rollback plan: can we revert if needed?
  - [ ] Estimate: 2 hours

**Sprint 3.2 Subtotal: ~7 hours**

### Sprint 3.3: Dashboard Components (Week 11-12)

- [ ] **3.3.1** Refactoring strategy card
  - [ ] `<RefactoringStrategy />` component
  - [ ] Title, macro strategy, infrastructure map
  - [ ] Perspectives (maintainability, scalability, testability)
  - [ ] Micro-tactics with timeline
  - [ ] Estimate: 6 hours

- [ ] **3.3.2** Roadmap view
  - [ ] `<RefactoringRoadmap />` component
  - [ ] Gantt chart: when to do each refactoring
  - [ ] Dependencies: what must be done first
  - [ ] Risk dashboard: what could go wrong
  - [ ] Estimate: 8 hours

- [ ] **3.3.3** Implementation tracker
  - [ ] `<RefactoringProgress />` component
  - [ ] Checkboxes for each micro-tactic
  - [ ] Before/after metrics (complexity, tests, hubs)
  - [ ] Validate: tests still pass after each refactoring
  - [ ] Estimate: 6 hours

- [ ] **3.3.4** Integration with main dashboard
  - [ ] Add "Code Health" tab to main dashboard
  - [ ] Show: latest analysis, bottlenecks, refactoring roadmap
  - [ ] Estimate: 4 hours

**Sprint 3.3 Subtotal: ~24 hours**

### Phase 3 Total: 40-60 hours
**Deliverable:** Refactoring strategies with roadmap & implementation tracker

---

## PHASE 4: Continuous Integration (Weeks 13-16) [30-40 hours]

### Sprint 4.1: GitHub Actions (Week 13)

- [ ] **4.1.1** GitHub Actions workflow
  - [ ] Create `.github/workflows/code-analysis.yml`
  - [ ] Trigger: on push, on PR, nightly schedule
  - [ ] Step 1: Run code analysis
  - [ ] Step 2: Detect new bottlenecks
  - [ ] Step 3: POST results to CSMG API
  - [ ] Estimate: 3 hours

- [ ] **4.1.2** Webhook handler
  - [ ] Create `/api/webhooks/github` endpoint
  - [ ] Receive: push event with new commits
  - [ ] Trigger: async code analysis job
  - [ ] Return: analysis URL to dashboard
  - [ ] Estimate: 3 hours

- [ ] **4.1.3** Alert system
  - [ ] If new CRITICAL bottleneck detected: send Slack alert
  - [ ] If circular dependency introduced: fail CI
  - [ ] If test coverage drops >5%: warn
  - [ ] Estimate: 3 hours

**Sprint 4.1 Subtotal: ~9 hours**

### Sprint 4.2: Trend Analysis (Week 14)

- [ ] **4.2.1** Historical tracking
  - [ ] Store: bottleneck count per day
  - [ ] Store: test coverage per day
  - [ ] Store: complexity distribution per day
  - [ ] Estimate: 3 hours

- [ ] **4.2.2** Trend detection
  - [ ] Is bottleneck count improving? (trend ↑↓→)
  - [ ] Is test coverage improving?
  - [ ] Calculate: rate of change per week
  - [ ] Predict: when will we reach 90% test coverage?
  - [ ] Estimate: 4 hours

- [ ] **4.2.3** Trend visualization
  - [ ] `<ArchitectureTrendChart />` component
  - [ ] Line chart: bottleneck count over time
  - [ ] Line chart: test coverage over time
  - [ ] Line chart: average complexity over time
  - [ ] Estimate: 5 hours

**Sprint 4.2 Subtotal: ~12 hours**

### Sprint 4.3: Learning Loop (Week 15)

- [ ] **4.3.1** Effectiveness tracking
  - [ ] After refactoring: did complexity actually decrease?
  - [ ] Did test coverage actually increase?
  - [ ] Did new bottlenecks emerge?
  - [ ] Estimate: 3 hours

- [ ] **4.3.2** Recommendation refinement
  - [ ] Track: which refactoring strategies actually worked?
  - [ ] Adjust: prioritization based on outcomes
  - [ ] Learn: "Extract class strategy has 95% success rate"
  - [ ] Estimate: 3 hours

- [ ] **4.3.3** Auto-generated PRs for dead code
  - [ ] Detect: new dead code
  - [ ] Create: GitHub PR to remove it
  - [ ] PR description: "Detected 3 unused functions"
  - [ ] Auto-merge if tests pass
  - [ ] Estimate: 4 hours

**Sprint 4.3 Subtotal: ~10 hours**

### Sprint 4.4: Polishing (Week 16)

- [ ] **4.4.1** Documentation
  - [ ] Create: `docs/code-analysis.md`
  - [ ] Explain: what each bottleneck type means
  - [ ] Explain: how to use the refactoring roadmap
  - [ ] Estimate: 3 hours

- [ ] **4.4.2** Performance optimization
  - [ ] Cache: analysis results (don't re-compute if code unchanged)
  - [ ] Optimize: graph rendering (D3 performance)
  - [ ] Estimate: 3 hours

- [ ] **4.4.3** Testing
  - [ ] Write tests for parser, bottleneck detection, strategy generation
  - [ ] Test on: multiple repos (yours, sample projects)
  - [ ] Estimate: 4 hours

**Sprint 4.4 Subtotal: ~10 hours**

### Phase 4 Total: 30-40 hours
**Deliverable:** CI/CD integration, trend analysis, learning loop

---

## Summary: Implementation Checklist

### Phase 1: MVP (Weeks 1-4)
- [ ] GitHub integration
- [ ] AST parser
- [ ] Entity/edge extraction
- [ ] Bottleneck detection (hub, circular, dead code, complexity, tests)
- [ ] Basic visualization (D3.js graph + scorecard)
- **Hours: 60-80 | Value: High (proof of concept)**

### Phase 2: Decomposition (Weeks 5-8)
- [ ] Code-specific decomposition/structuring prompts
- [ ] Transform CodeGraph to StructuredDecomposition
- [ ] Run decomposition pipeline
- [ ] Code smell detection
- [ ] Synthesis generation
- **Hours: 40-60 | Value: High (deep analysis)**

### Phase 3: Strategy (Weeks 9-12)
- [ ] Code refactoring strategy generation
- [ ] Strategy ranking & prioritization
- [ ] Refactoring roadmap with timeline
- [ ] Implementation tracker
- **Hours: 40-60 | Value: Critical (actionable output)**

### Phase 4: Continuous Integration (Weeks 13-16)
- [ ] GitHub Actions automation
- [ ] Trend analysis & dashboards
- [ ] Effectiveness measurement
- [ ] Learning loop
- **Hours: 30-40 | Value: Essential (staying current)**

---

## Quick-Start Recommendation

**Start with Phase 1 MVP (Weeks 1-4):**
- Build GitHub integration + AST parser
- Detect bottlenecks (hubs, circular deps, dead code)
- Create visualization
- Run on your own repo
- Show: "Generated analysis on 847 entities, 3200+ edges, found 12 bottlenecks"

**This alone would be a compelling demo that:**
1. Proves your system works on real code
2. Shows architectural bottlenecks in your own codebase
3. Provides actionable insights (dead code to remove, circular imports to fix)
4. Can be completed in 2-3 weeks with focused effort

**Then decide on Phases 2-4 based on value delivered.**

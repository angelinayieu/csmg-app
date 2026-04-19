# OpenAI Deep Research Integration Plan

## Executive take
Integrating `o3-deep-research` / `o4-mini-deep-research` is a strong fit for this stack, but should be done as a **new execution lane**, not a hard replacement of the current pipeline.

Recommended model:
- Keep current fast lane (Anthropic web-search + existing synthesis/strategy flow).
- Add a second lane: **Deep Research Lane** (OpenAI Responses API + background mode + claim-evidence output).

---

## Current state vs required state

### Current state (already present)
- Multi-pass research orchestration and continuation logic.
- Web-search tool usage via Anthropic path.
- Triggered reruns and downstream strategy integration.

### Missing for OpenAI deep-research-native integration
- Responses API background job lifecycle (create, poll/webhook, hydrate into DB).
- Parser for output item types (`web_search_call`, `file_search_call`, `mcp_tool_call`, `message`).
- Claim-level evidence persistence (quote spans, URLs, source metadata).
- Risk controls for prompt injection/exfiltration when MCP or private data is enabled.

---

## Integration architecture (optimal)

## Lane A: Fast default lane
Use current route for normal latency-sensitive runs.
- Endpoint: existing research route
- Purpose: fast enrichment and bridge creation

## Lane B: Deep research lane (new)
New long-running route and worker-driven completion.

### New route surface
- `POST /api/pipeline/research-deep/start`
  - Creates background deep research request
  - Stores run metadata + request envelope
- `POST /api/pipeline/research-deep/webhook`
  - Receives completion event
  - Pulls response, parses tool trace + citations
  - Writes claims/evidence/entities/edges
- `GET /api/pipeline/research-deep/:runId`
  - Returns status + partial/final report

### New DB entities
- `deep_research_runs`
- `deep_research_tool_calls`
- `claims`
- `evidence_items`
- `claim_evidence_links`

---

## Prompt/process pattern (recommended)

Implement the 3-step process before deep research model call:
1. Clarification pass (small model)
2. Prompt enrichment pass (small model)
3. Deep research pass (`o3-deep-research` or `o4-mini-deep-research`)

This maps directly to your existing architecture style and improves retrieval targeting.

---

## Data-source policy

## Public-web mode (default)
- Enable web search only.
- No private MCP or file search.
- Lowest exfiltration risk.

## Private-data mode (controlled)
Use staged execution:
1. Public web phase only.
2. Private phase with file search and/or MCP, with web search disabled.

Add allowlists:
- Allowed MCP servers only.
- Allowed domains for tool outputs.
- Tool argument validation + exfiltration monitor before external calls.

---

## Output normalization contract

From deep research output, normalize into:
- `research_summary`
- `tool_trace` (search/open/fetch/find/code calls)
- `claims[]` with confidence + status
- `evidence[]` with URL/title/quote span/published date/source type
- `recommendation_support_map` (strategy statement -> supporting claim IDs)

Store this in synthesis data and render clickable citations in UI.

---

## Cost and latency controls

Use:
- `max_tool_calls` to cap burn
- mode-specific budgets (`lite`, `standard`, `heavy`)
- hard timeout and cancellation controls
- run-level spend telemetry

Default suggestion:
- `o4-mini-deep-research` for most runs
- escalate to `o3-deep-research` only for high-value investigations

---

## Security controls (non-negotiable)

- Exfiltration monitor on outbound tool calls.
- Domain and MCP allowlists.
- Separate credentials for public vs private phases.
- Full tool-call logging and review trail.
- Disable mixed web+private modes by default unless explicitly approved.

---

## Rollout plan

## Phase 0 (2-3 days)
- Add feature flag: `deep_research_lane_enabled`.
- Add run table and status APIs.

## Phase 1 (1 week)
- Implement start + status + parser for deep research outputs.
- Persist citations and tool traces.

## Phase 2 (1-2 weeks)
- Add claims/evidence schema + UI citation rendering.
- Connect to synthesis and strategy refresh.

## Phase 3 (1 week)
- Add private-data staged mode with strict controls.
- Add exfiltration monitor + allowlists.

## Phase 4 (ongoing)
- Introduce MCP connectors and vector-store retrieval for internal corpora.
- Add quality scoring and contradiction tournament.

---

## Go/no-go recommendation

Go, with constraints:
- ✅ Add as second lane first.
- ✅ Use background mode + webhook architecture.
- ✅ Require claim-evidence persistence before making it default.
- ❌ Do not combine private MCP + unrestricted web search in first release.

This gives the largest quality jump while preserving reliability and trust.
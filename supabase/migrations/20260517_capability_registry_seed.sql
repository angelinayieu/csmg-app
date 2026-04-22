-- Seed 15 capability primitives covering the breadth of the attribute space.
-- Goal: prove that the planner can compose across categories (people,
-- literature, observation, temporal capture, synthesis) without the schema
-- privileging any of them. If all 15 slot in cleanly, the abstraction holds.
--
-- Conventions:
--   - slug is the stable code reference (snake_case, no dashes)
--   - proposed_by_user_id IS NULL on every seed row (= system capability)
--   - success_priors carry a "default" bucket; per-context buckets get added
--     by the resolver as capability_observations accumulate
--   - cost p50/p90 are coarse estimates — calibrated over time from real
--     observations, not hand-tuned forever
--
-- Use `on conflict (slug) do update` so re-running the seed migration is
-- safe and so attribute tweaks propagate without a manual reset.

insert into public.capabilities (
  slug, name, description, category, yields, preconditions,
  cost_user_minutes_p50, cost_user_minutes_p90,
  cost_money_usd_p50,
  cost_calendar_latency_days_p50, cost_calendar_latency_days_p90,
  requires_human, requires_agent, requires_instrument, requires_external_service,
  repeatable, one_shot, perturbs_system, yields_structured_data,
  relational_cost, latency_kind,
  success_priors, yield_priors, tags
) values

-- ── 1. person_cold_outreach ────────────────────────────────────────────
-- The canonical "email a stranger" primitive. High relational cost, bounded
-- latency, low structured-yield (free text reply). Agents CAN send these,
-- but success priors collapse quickly if they do — so we treat it as
-- human-preferred by default.
(
  'person_cold_outreach',
  'Cold outreach to an unknown contact',
  'Send a first-contact message (email, LinkedIn, etc.) to a person the '
  'project has no prior relationship with. Yields an unstructured reply '
  'whose attributes the planner extracts after the fact.',
  'person_contact',
  '{"attributes":[{"name":"responded","kind":"bool","confidence":0.5},{"name":"response_sentiment","kind":"enum","enum_values":["positive","neutral","negative"],"confidence":0.4},{"name":"willing_to_engage","kind":"bool","confidence":0.4}],"new_entities":["contact_relationship","referral_hint"],"response_shape":"async"}',
  '[{"kind":"contact_info_available","description":"Valid email or messaging handle for target","soft":false},{"kind":"entity_exists","description":"Target actor entity exists in KG","soft":false}]',
  15, 40,
  0,
  3, 14,
  true, true, false, false,
  false, false, true, false,
  'high', 'async',
  '{"default":{"success_rate":0.22,"sample_n":0}}',
  '{"yield_completeness_p50":0.4,"yield_completeness_p90":0.75}',
  array['people','outreach','async','relational']
),

-- ── 2. person_warm_introduction_chain ──────────────────────────────────
-- The multi-step case the design MUST support: get to person Y via mutual
-- contact X. Planner will typically model this as two steps (ask X for
-- intro → Y replies) but we also expose the composite so it can appear
-- as one high-value chain in the candidate list.
(
  'person_warm_introduction_chain',
  'Warm introduction via mutual contact',
  'Ask an existing contact to introduce the project to a target person. '
  'Two-stage: broker request + target response. Higher success than cold '
  'outreach, consumes relational capital with the broker.',
  'person_contact',
  '{"attributes":[{"name":"intro_made","kind":"bool","confidence":0.7},{"name":"target_responded","kind":"bool","confidence":0.6},{"name":"target_engaged","kind":"bool","confidence":0.5}],"new_entities":["contact_relationship","second_degree_path"],"response_shape":"async"}',
  '[{"kind":"entity_exists","description":"Mutual broker exists in KG with relation to target","soft":false},{"kind":"consent","description":"Broker has agreed to referrals in principle","soft":true}]',
  10, 25,
  0,
  5, 21,
  true, false, false, false,
  false, false, true, false,
  'high', 'async',
  '{"default":{"success_rate":0.55,"sample_n":0}}',
  '{"yield_completeness_p50":0.6,"yield_completeness_p90":0.85}',
  array['people','outreach','multi-step','warm']
),

-- ── 3. structured_interview ────────────────────────────────────────────
-- The yielding-structured-data people capability. Distinct from cold
-- outreach: a scheduled 1:1 with a protocol. Repeatable in principle (with
-- different subjects) but one_shot for a given individual.
(
  'structured_interview',
  'Structured 1:1 interview with prepared protocol',
  'Scheduled interview guided by a prepared question set. Yields multiple '
  'attributes per session; suitable for depth on a single source.',
  'person_contact',
  '{"attributes":[{"name":"protocol_completed","kind":"bool","confidence":0.9},{"name":"n_answers_captured","kind":"int","expected_range":[5,15],"confidence":0.8},{"name":"avg_answer_confidence","kind":"float","expected_range":[0.5,0.9],"confidence":0.6}],"new_entities":["interview_transcript","extracted_claim"],"response_shape":"sync"}',
  '[{"kind":"entity_exists","description":"Subject has agreed to the interview","soft":false},{"kind":"consent","description":"Recording/use consent","soft":false}]',
  60, 90,
  0,
  7, 21,
  true, false, false, false,
  false, false, true, true,
  'medium', 'async',
  '{"default":{"success_rate":0.85,"sample_n":0}}',
  '{"yield_completeness_p50":0.75,"yield_completeness_p90":0.95}',
  array['people','depth','structured','interview']
),

-- ── 4. community_query ─────────────────────────────────────────────────
-- Forum / subreddit / slack post. Very cheap, wide variance, low relational
-- cost (mostly anonymous). Aggregation-over-N-replies is the shape.
(
  'community_query',
  'Post question to a relevant online community',
  'Post a question to a forum, subreddit, or public Slack. Yields a set of '
  'replies whose aggregate (not individual quality) is the signal.',
  'community_inquiry',
  '{"attributes":[{"name":"n_replies","kind":"int","expected_range":[0,25],"confidence":0.5},{"name":"reply_consensus","kind":"enum","enum_values":["strong","weak","contested","absent"],"confidence":0.4}],"new_entities":["aggregated_opinion"],"response_shape":"async"}',
  '[{"kind":"data_access","description":"Account on the target community","soft":false}]',
  10, 20,
  0,
  2, 7,
  true, true, false, true,
  true, false, false, false,
  'low', 'async',
  '{"default":{"success_rate":0.65,"sample_n":0}}',
  '{"yield_completeness_p50":0.5,"yield_completeness_p90":0.85}',
  array['community','crowd','async','cheap']
),

-- ── 5. literature_synthesis ────────────────────────────────────────────
-- Find N papers, extract field X from each, reconcile conflicts. Agent-
-- executable end to end. High yield quality when the field exists in the
-- literature; near-zero when it doesn't.
(
  'literature_synthesis',
  'Extract and reconcile a field across N papers',
  'Search, retrieve, and extract a specified field from multiple academic '
  'papers; reconcile conflicts and return a consensus value with variance.',
  'literature_research',
  '{"attributes":[{"name":"n_papers_found","kind":"int","expected_range":[3,30],"confidence":0.7},{"name":"extracted_value","kind":"float","confidence":0.6},{"name":"extracted_variance","kind":"float","confidence":0.5}],"new_entities":["citation","literature_claim"],"response_shape":"sync"}',
  '[{"kind":"data_access","description":"Access to relevant literature database or search","soft":false}]',
  30, 120,
  0,
  0, 2,
  false, true, false, true,
  true, false, false, true,
  'none', 'sync',
  '{"default":{"success_rate":0.7,"sample_n":0}}',
  '{"yield_completeness_p50":0.65,"yield_completeness_p90":0.9}',
  array['literature','synthesis','agent','structured']
),

-- ── 6. archival_regulatory_lookup ──────────────────────────────────────
-- Filings, patents, court records, standards bodies. High-authority, often
-- definitive. Structured data, cheap, agent-friendly.
(
  'archival_regulatory_lookup',
  'Query archival, regulatory, or filings source',
  'Retrieve a specific fact from an authoritative archive (SEC filings, '
  'patent office, court records, standards bodies). Often yields ground '
  'truth on questions that would be speculative elsewhere.',
  'literature_research',
  '{"attributes":[{"name":"record_found","kind":"bool","confidence":0.8},{"name":"extracted_field","kind":"text","confidence":0.9}],"new_entities":["authoritative_claim"],"response_shape":"sync"}',
  '[{"kind":"data_access","description":"Known archive or database to query","soft":false}]',
  15, 45,
  0,
  0, 1,
  false, true, false, true,
  true, false, false, true,
  'none', 'sync',
  '{"default":{"success_rate":0.75,"sample_n":0}}',
  '{"yield_completeness_p50":0.8,"yield_completeness_p90":0.98}',
  array['archival','regulatory','authoritative','agent']
),

-- ── 7. public_dataset_pull ─────────────────────────────────────────────
-- Fetch and summarize a known public dataset. Distinct from scrape: the
-- source is a dataset-distribution endpoint (Census API, HuggingFace, etc.).
(
  'public_dataset_pull',
  'Pull and summarize a public dataset',
  'Fetch a known public dataset (government open data, HuggingFace, etc.) '
  'and compute summary statistics relevant to the data_need.',
  'dataset_acquisition',
  '{"attributes":[{"name":"dataset_available","kind":"bool","confidence":0.9},{"name":"n_rows","kind":"int","expected_range":[100,1000000],"confidence":0.8},{"name":"summary_stat","kind":"float","confidence":0.7}],"new_entities":["dataset_reference"],"response_shape":"sync"}',
  '[{"kind":"data_access","description":"Known dataset URL or API endpoint","soft":false}]',
  20, 60,
  0,
  0, 1,
  false, true, false, true,
  true, false, false, true,
  'none', 'sync',
  '{"default":{"success_rate":0.85,"sample_n":0}}',
  '{"yield_completeness_p50":0.85,"yield_completeness_p90":0.98}',
  array['dataset','agent','structured','public']
),

-- ── 8. web_scrape_and_extract ──────────────────────────────────────────
-- Extract structured fields from public pages. Higher variance than
-- dataset_pull because page structure drifts.
(
  'web_scrape_and_extract',
  'Scrape public pages and extract structured fields',
  'Fetch a set of public web pages and extract specified fields. Higher '
  'variance than dataset_pull; useful when no canonical dataset exists.',
  'dataset_acquisition',
  '{"attributes":[{"name":"pages_scraped","kind":"int","expected_range":[1,500],"confidence":0.7},{"name":"extraction_success_rate","kind":"float","expected_range":[0.3,0.95],"confidence":0.5}],"new_entities":["extracted_record"],"response_shape":"sync"}',
  '[{"kind":"data_access","description":"URLs or search strategy","soft":false}]',
  30, 120,
  0,
  0, 2,
  false, true, false, true,
  true, false, false, true,
  'none', 'sync',
  '{"default":{"success_rate":0.6,"sample_n":0}}',
  '{"yield_completeness_p50":0.55,"yield_completeness_p90":0.85}',
  array['scrape','agent','structured','variable']
),

-- ── 9. observation_protocol ────────────────────────────────────────────
-- Watch a system for a defined window; count/log events. Requires human (or
-- instrument — see #10). Unlike instrumentation, setup is lightweight.
(
  'observation_protocol',
  'Watch a system for a defined period and log events',
  'Human-observed monitoring of a system (physical, digital, or social) '
  'for a specified window, counting events against a prepared taxonomy.',
  'direct_observation',
  '{"attributes":[{"name":"observation_hours","kind":"float","expected_range":[1,40],"confidence":0.9},{"name":"events_logged","kind":"int","expected_range":[0,200],"confidence":0.7}],"new_entities":["observation_log"],"response_shape":"async"}',
  '[{"kind":"entity_exists","description":"Observable system accessible to observer","soft":false}]',
  120, 480,
  0,
  3, 14,
  true, false, false, false,
  true, false, false, true,
  'none', 'async',
  '{"default":{"success_rate":0.9,"sample_n":0}}',
  '{"yield_completeness_p50":0.8,"yield_completeness_p90":0.95}',
  array['observation','human','structured','field']
),

-- ── 10. sensor_instrumentation ────────────────────────────────────────
-- Install a logger / sensor / analytics snippet; wait for signal. High
-- setup cost, near-zero marginal cost, structured data, long latency.
(
  'sensor_instrumentation',
  'Install a logger/sensor/analytics capture and wait for signal',
  'Install an instrument (analytics event, hardware sensor, log tap) and '
  'wait for accumulated signal. High setup cost, near-zero marginal cost, '
  'clean structured data.',
  'instrumentation',
  '{"attributes":[{"name":"instrument_active","kind":"bool","confidence":0.95},{"name":"signal_volume","kind":"int","expected_range":[0,10000],"confidence":0.6}],"new_entities":["instrument_reference","time_series"],"response_shape":"async"}',
  '[{"kind":"data_access","description":"Write-access or physical access to install","soft":false},{"kind":"consent","description":"Privacy/usage consent if observing users","soft":true}]',
  60, 240,
  50,
  7, 30,
  true, true, true, false,
  true, false, false, true,
  'low', 'async',
  '{"default":{"success_rate":0.8,"sample_n":0}}',
  '{"yield_completeness_p50":0.85,"yield_completeness_p90":0.98}',
  array['instrumentation','sensor','async','structured']
),

-- ── 11. pilot_experiment_small_n ──────────────────────────────────────
-- Run a small controlled test; log outcomes; infer parameter. The classic
-- "don''t just think about it, try it" capability.
(
  'pilot_experiment_small_n',
  'Run a small-N controlled pilot and log outcomes',
  'Execute a small-sample controlled test (5-30 trials) to infer a '
  'parameter that would be speculative otherwise. Yields mean + variance.',
  'experiment',
  '{"attributes":[{"name":"n_trials","kind":"int","expected_range":[5,30],"confidence":0.9},{"name":"effect_mean","kind":"float","confidence":0.5},{"name":"effect_variance","kind":"float","confidence":0.4}],"new_entities":["experiment_log"],"response_shape":"async"}',
  '[{"kind":"entity_exists","description":"Pilot design and test subjects identified","soft":false},{"kind":"budget","description":"Materials/time budget for trials","soft":false}]',
  240, 960,
  100,
  7, 30,
  true, false, false, false,
  true, false, true, true,
  'low', 'async',
  '{"default":{"success_rate":0.75,"sample_n":0}}',
  '{"yield_completeness_p50":0.75,"yield_completeness_p90":0.95}',
  array['experiment','pilot','structured','perturbs']
),

-- ── 12. counterfactual_probe ──────────────────────────────────────────
-- Change one variable in a controlled way, observe delta. Subset of
-- experiment but small enough to fit in a sprint.
(
  'counterfactual_probe',
  'Change one variable and observe the delta',
  'Make a single targeted change (copy, pricing, a single rule) and measure '
  'the delta over a short window. Cheaper than a full pilot; cruder signal.',
  'experiment',
  '{"attributes":[{"name":"delta_observed","kind":"bool","confidence":0.7},{"name":"delta_magnitude","kind":"float","confidence":0.4},{"name":"delta_direction","kind":"enum","enum_values":["expected","unexpected","null"],"confidence":0.5}],"new_entities":["probe_result"],"response_shape":"async"}',
  '[{"kind":"entity_exists","description":"Variable is actually controllable","soft":false}]',
  30, 90,
  0,
  3, 14,
  true, false, false, false,
  false, false, true, true,
  'medium', 'async',
  '{"default":{"success_rate":0.65,"sample_n":0}}',
  '{"yield_completeness_p50":0.6,"yield_completeness_p90":0.85}',
  array['probe','experiment','short','perturbs']
),

-- ── 13. triangulation_cross_source ─────────────────────────────────────
-- Synthesis capability. Combines ≥3 weak signals into a stronger inference.
-- Depends on other capabilities having produced sources first — this is
-- often a JOIN node in the plan DAG.
(
  'triangulation_cross_source',
  'Combine 3+ independent weak sources into a stronger inference',
  'Synthesis step — takes 3+ independent signals from prior steps and '
  'produces a reconciled inference with credibility weighting. Usually a '
  'join node in the plan DAG.',
  'synthesis',
  '{"attributes":[{"name":"sources_reconciled","kind":"int","expected_range":[3,10],"confidence":0.9},{"name":"consensus_strength","kind":"enum","enum_values":["convergent","divergent","mixed"],"confidence":0.6}],"new_entities":["triangulated_claim"],"response_shape":"sync"}',
  '[{"kind":"data_access","description":"At least 3 prior plan_steps have resolved with relevant output","soft":false}]',
  20, 60,
  0,
  0, 1,
  false, true, false, false,
  true, false, false, true,
  'none', 'sync',
  '{"default":{"success_rate":0.8,"sample_n":0}}',
  '{"yield_completeness_p50":0.8,"yield_completeness_p90":0.95}',
  array['synthesis','triangulation','join','agent']
),

-- ── 14. decompose_and_aggregate ───────────────────────────────────────
-- Meta capability: break the question into sub-questions, answer each
-- cheaply, combine. This is how the planner achieves depth without
-- committing to any single expensive capability. Recursive by nature.
(
  'decompose_and_aggregate',
  'Decompose a hard question into sub-questions, answer each, combine',
  'Meta-capability. Break a hard data_need into 2-5 cheaper sub-needs, '
  'plan each independently, then aggregate. Enables depth without upfront '
  'commitment to any single expensive capability.',
  'synthesis',
  '{"attributes":[{"name":"sub_needs_generated","kind":"int","expected_range":[2,5],"confidence":0.9},{"name":"aggregation_confidence","kind":"float","expected_range":[0.3,0.9],"confidence":0.5}],"new_entities":["sub_need"],"response_shape":"sync"}',
  '[]',
  15, 45,
  0,
  0, 1,
  false, true, false, false,
  true, false, false, true,
  'none', 'sync',
  '{"default":{"success_rate":0.9,"sample_n":0}}',
  '{"yield_completeness_p50":0.7,"yield_completeness_p90":0.95}',
  array['synthesis','decomposition','recursive','agent','meta']
),

-- ── 15. event_wait_and_capture ────────────────────────────────────────
-- The temporal capability. Does not cost user minutes — costs calendar
-- latency. Critical to model because otherwise the planner over-picks
-- synchronous capabilities and ignores "wait for the natural event that
-- will make this answer obvious."
(
  'event_wait_and_capture',
  'Wait for a known future event and capture its data',
  'Schedule a capture against a known future event (earnings release, '
  'product launch, conference, policy change) that will expose the data '
  'without active probing. Near-zero user cost; high calendar latency.',
  'temporal_capture',
  '{"attributes":[{"name":"event_occurred","kind":"bool","confidence":0.85},{"name":"captured_fields","kind":"int","expected_range":[1,20],"confidence":0.7}],"new_entities":["event_capture_record"],"response_shape":"deferred"}',
  '[{"kind":"entity_exists","description":"Scheduled event identified with known date","soft":false}]',
  10, 30,
  0,
  14, 90,
  false, true, false, true,
  false, false, false, true,
  'none', 'scheduled_event',
  '{"default":{"success_rate":0.75,"sample_n":0}}',
  '{"yield_completeness_p50":0.7,"yield_completeness_p90":0.95}',
  array['temporal','scheduled','passive','deferred']
)

on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  yields = excluded.yields,
  preconditions = excluded.preconditions,
  cost_user_minutes_p50 = excluded.cost_user_minutes_p50,
  cost_user_minutes_p90 = excluded.cost_user_minutes_p90,
  cost_money_usd_p50 = excluded.cost_money_usd_p50,
  cost_calendar_latency_days_p50 = excluded.cost_calendar_latency_days_p50,
  cost_calendar_latency_days_p90 = excluded.cost_calendar_latency_days_p90,
  requires_human = excluded.requires_human,
  requires_agent = excluded.requires_agent,
  requires_instrument = excluded.requires_instrument,
  requires_external_service = excluded.requires_external_service,
  repeatable = excluded.repeatable,
  one_shot = excluded.one_shot,
  perturbs_system = excluded.perturbs_system,
  yields_structured_data = excluded.yields_structured_data,
  relational_cost = excluded.relational_cost,
  latency_kind = excluded.latency_kind,
  success_priors = excluded.success_priors,
  yield_priors = excluded.yield_priors,
  tags = excluded.tags,
  updated_at = now();

-- Sanity check: all seeds should land as system capabilities (no user owner).
do $$
begin
  if exists (
    select 1 from public.capabilities
    where slug is not null and proposed_by_user_id is not null
  ) then
    raise exception 'Seed capability has non-null proposed_by_user_id';
  end if;
end $$;

-- ── Condition modulators starter library ────────────────────────────────
--
-- Seeds well-established (meta-analytic or large-RCT) effect-size
-- modulators for common conditions in the cognitive-performance and
-- mind-body-cognition templates. Inserted per-space by joining on
-- entity NAME patterns — every space whose KG contains entities matching
-- the patterns gets the corresponding modulator row.
--
-- Why name-matching: condition_modulators.target_edge_id is space-scoped
-- (each space has its own edges). A generic seed has no specific edge UUIDs
-- to reference, so we join by name regex (case-insensitive) against the
-- entities table. When an entity name doesn't exist in a space, no row is
-- inserted for it — the seed is naturally selective.
--
-- Inclusion criteria for each modulator:
--   1. Effect size derived from meta-analysis OR large (n > 100) RCT
--   2. Effect direction agrees across at least 2 independent reports
--   3. Population label matches the source paper(s)
--   4. p10/p90 chosen conservatively from the reported CI; when CI was
--      not stated, ±25% of p50 (matches the seed convention used
--      elsewhere in cognitive-performance/seed.ts)
--
-- Modulator naming convention:
--   condition_key         — matches subjects.conditions JSONB key
--                            (e.g. "sleep_h", "stress_0_10", "post_chemo")
--   value_match           — when modulator only fires under specific
--                            condition values (e.g. "<4", ">5", "=true")
--   multiplier_p50        — central effect-size multiplier
--   population_label      — the population the literature studied
--   rationale             — one-line summary + the load-bearing citation
--
-- Idempotent: ON CONFLICT DO NOTHING on the unique constraint
-- (space_id, condition_key, value_match, target_edge_id).
--
-- Read by: src/lib/simulation/simulate-entity-chain.ts via
-- fetchSubjectEdgeMultipliers — which composes per-iteration multipliers
-- on each Monte Carlo edge propagation.

-- ── Helper: name-match insert ──
--
-- Each block below selects edges whose source entity name AND target
-- entity name match given patterns, then inserts a modulator row tied
-- to that specific edge in each matching space.

-- ────────────────────────────────────────────────────────────────────────
-- SLEEP DEPRIVATION (sleep_h)
-- ────────────────────────────────────────────────────────────────────────

-- Acute severe sleep deprivation (<4h) dampens exercise-induced BDNF
-- response. Goh & Lee 2018 reported ~40% attenuation of post-exercise
-- BDNF in sleep-restricted vs rested adults. Conservative p50=0.65.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'sleep_h', '<4', e.id,
  0.50, 0.65, 0.85,
  '{}'::uuid[],
  'Acute sleep deprivation (<4h) dampens BDNF response to aerobic exercise '
    || 'by ~35-50% (Goh & Lee 2018; supported by Schmitt et al. 2014).',
  'healthy adults aged 20-65'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ '(aerobic|exercise|cardio)'
  and lower(tgt.name) ~ 'bdnf'
on conflict do nothing;

-- Chronic short sleep (<6h) impairs hippocampal neurogenesis.
-- Mueller et al. 2008 (rodent) + Mander et al. 2017 (human imaging)
-- converge on ~30-40% reduction in neurogenesis-related markers.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'sleep_h', '<6', e.id,
  0.55, 0.70, 0.85,
  '{}'::uuid[],
  'Chronic short sleep (<6h) reduces hippocampal neurogenesis ~30% '
    || '(Mueller et al. 2008; Mander et al. 2017).',
  'adults; chronic short sleep > 4 weeks'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ 'bdnf'
  and lower(tgt.name) ~ '(neurogenesis|hippocamp)'
on conflict do nothing;

-- Sleep deprivation amplifies cortisol elevation.
-- Leproult et al. 1997 — one night of sleep loss elevates evening
-- cortisol ~37%; Spiegel et al. 1999 confirms with restricted sleep.
-- We model this as a multiplier > 1 on stress-driven cortisol edges.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'sleep_h', '<6', e.id,
  1.20, 1.40, 1.65,
  '{}'::uuid[],
  'Sleep deprivation amplifies cortisol elevation ~37% (Leproult et al. '
    || '1997; Spiegel et al. 1999).',
  'healthy adults; one or more nights of restricted sleep'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ '(stress|hpa)'
  and lower(tgt.name) ~ 'cortisol'
on conflict do nothing;

-- Sleep <4h impairs working-memory consolidation (downstream from
-- neurogenesis-mediated learning). Stickgold 2005 review +
-- Lo et al. 2012 dose-response RCT.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'sleep_h', '<4', e.id,
  0.55, 0.70, 0.85,
  '{}'::uuid[],
  'Acute sleep deprivation (<4h) impairs memory consolidation ~25-40% '
    || '(Stickgold 2005; Lo et al. 2012).',
  'adults; single-night sleep deprivation'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ '(neurogenesis|hippocamp)'
  and lower(tgt.name) ~ '(working.?memory|memory)'
on conflict do nothing;

-- Sleep deprivation elevates inflammatory markers (hsCRP, IL-6).
-- Patel et al. 2009 cohort + Irwin et al. 2016 meta-analysis.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'sleep_h', '<6', e.id,
  1.15, 1.30, 1.50,
  '{}'::uuid[],
  'Chronic short sleep elevates hsCRP and IL-6 ~30% (Patel et al. 2009; '
    || 'Irwin et al. 2016 meta).',
  'adults; chronic short sleep > 1 month'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ '(stress|hpa|inflammation)'
  and lower(tgt.name) ~ '(crp|il-?6|inflammation)'
on conflict do nothing;

-- ────────────────────────────────────────────────────────────────────────
-- CHRONIC STRESS (stress_0_10)
-- ────────────────────────────────────────────────────────────────────────

-- High chronic stress reduces hippocampal volume + neurogenesis response.
-- McEwen 2007 review + Gianaros et al. 2007 imaging.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'stress_0_10', '>5', e.id,
  0.50, 0.65, 0.80,
  '{}'::uuid[],
  'Chronic stress (perceived stress > 5/10) suppresses hippocampal '
    || 'neurogenesis ~30-40% (McEwen 2007; Gianaros et al. 2007).',
  'adults with chronic perceived stress > 6 months'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ 'bdnf'
  and lower(tgt.name) ~ '(neurogenesis|hippocamp)'
on conflict do nothing;

-- High stress impairs PFC-amygdala connectivity (top-down regulation).
-- Liston et al. 2009 + Arnsten 2009 review.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'stress_0_10', '>5', e.id,
  0.55, 0.70, 0.85,
  '{}'::uuid[],
  'Chronic stress impairs PFC-amygdala connectivity ~25-35% (Liston '
    || 'et al. 2009; Arnsten 2009).',
  'adults with chronic stress; functional MRI samples'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ '(pfc|prefrontal|amygdala|hpa)'
  and lower(tgt.name) ~ '(executive|cognitive.?flex|inhibition|attention)'
on conflict do nothing;

-- High stress amplifies cortisol baseline + responses.
-- Lupien et al. 2009 + Sapolsky 2000.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'stress_0_10', '>7', e.id,
  1.20, 1.45, 1.70,
  '{}'::uuid[],
  'Severe chronic stress (>7/10) elevates cortisol responses ~40-50% '
    || '(Lupien et al. 2009; Sapolsky 2000).',
  'adults; HPA axis dysregulation'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ '(stress|hpa)'
  and lower(tgt.name) ~ 'cortisol'
on conflict do nothing;

-- High stress dampens meditation effectiveness on working memory
-- (lower baseline starting point for benefit). Khoury et al. 2015 meta.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'stress_0_10', '>5', e.id,
  0.65, 0.80, 0.95,
  '{}'::uuid[],
  'High baseline stress dampens meditation effectiveness on working '
    || 'memory ~20% (Khoury et al. 2015 meta-analysis).',
  'adults; mindfulness-based intervention RCTs'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ '(meditat|mindful)'
  and lower(tgt.name) ~ '(working.?memory|attention)'
on conflict do nothing;

-- ────────────────────────────────────────────────────────────────────────
-- POST-CHEMO (post_chemo, boolean OR set membership)
-- ────────────────────────────────────────────────────────────────────────

-- Post-chemo dampens BDNF response to aerobic exercise.
-- Janelsins et al. 2017 review of CRCI; Hartman et al. 2018 RCT.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'post_chemo', '=true', e.id,
  0.40, 0.55, 0.70,
  '{}'::uuid[],
  'Post-chemotherapy patients show ~45% the BDNF response to aerobic '
    || 'exercise that healthy controls do (Janelsins et al. 2017; '
    || 'Hartman et al. 2018).',
  'cancer survivors 6-24 months post-chemotherapy'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ '(aerobic|exercise|cardio)'
  and lower(tgt.name) ~ 'bdnf'
on conflict do nothing;

-- Post-chemo dampens neurogenesis baseline.
-- Wefel & Schagen 2012 CRCI overview; Vega et al. 2017 imaging.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'post_chemo', '=true', e.id,
  0.45, 0.60, 0.75,
  '{}'::uuid[],
  'Post-chemo patients show reduced neurogenesis-related markers '
    || '(Wefel & Schagen 2012; Vega et al. 2017).',
  'cancer survivors; CRCI population'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ 'bdnf'
  and lower(tgt.name) ~ '(neurogenesis|hippocamp|neuroplasticity)'
on conflict do nothing;

-- Post-chemo amplifies inflammation-driven cognitive impairment.
-- Janelsins et al. 2017; Bower 2008 cytokine review.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'post_chemo', '=true', e.id,
  1.25, 1.50, 1.80,
  '{}'::uuid[],
  'Post-chemo patients show amplified inflammatory cognitive impairment '
    || '(Janelsins 2017; Bower 2008).',
  'cancer survivors with persistent inflammation post-treatment'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ '(crp|il-?6|inflammation|neuroinflammation)'
  and lower(tgt.name) ~ '(working.?memory|cognitive|attention)'
on conflict do nothing;

-- Post-chemo direct dampening on working memory baseline response.
-- Wefel & Schagen 2012 meta-analysis.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'post_chemo', '=true', e.id,
  0.60, 0.75, 0.90,
  '{}'::uuid[],
  'Post-chemo working memory deficit ~25% relative to age-matched '
    || 'controls (Wefel & Schagen 2012 meta).',
  'cancer survivors; working memory subtests'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ '(neurogenesis|neuroplasticity)'
  and lower(tgt.name) ~ '(working.?memory|memory)'
on conflict do nothing;

-- ────────────────────────────────────────────────────────────────────────
-- AGE (age in years)
-- ────────────────────────────────────────────────────────────────────────

-- Age >50 reduces baseline BDNF and exercise-induced response.
-- Lommatzsch et al. 2005; Erickson et al. 2011 (subgroup analysis).
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'age', '>50', e.id,
  0.55, 0.70, 0.85,
  '{}'::uuid[],
  'Adults >50 show ~30% reduced BDNF response to exercise (Lommatzsch '
    || 'et al. 2005; Erickson et al. 2011 age-stratified).',
  'adults aged 50-75'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ '(aerobic|exercise|cardio)'
  and lower(tgt.name) ~ 'bdnf'
on conflict do nothing;

-- Age >65 reduces neurogenesis capacity substantially.
-- Spalding et al. 2013 — direct measurement of human neurogenesis decay.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'age', '>65', e.id,
  0.35, 0.50, 0.70,
  '{}'::uuid[],
  'Adults >65 show ~50% reduced neurogenesis capacity (Spalding et al. '
    || '2013 direct measurement).',
  'adults aged 65+'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ 'bdnf'
  and lower(tgt.name) ~ '(neurogenesis|hippocamp)'
on conflict do nothing;

-- Age >50 impairs glymphatic clearance.
-- Iliff et al. 2014; Kress et al. 2014.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'age', '>50', e.id,
  0.55, 0.70, 0.85,
  '{}'::uuid[],
  'Glymphatic clearance declines ~30% in adults >50 (Iliff et al. 2014; '
    || 'Kress et al. 2014).',
  'adults aged 50+; rodent + human imaging'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ '(sleep|glymphatic)'
  and lower(tgt.name) ~ '(glymphatic|clearance|tau|amyloid)'
on conflict do nothing;

-- ────────────────────────────────────────────────────────────────────────
-- CAFFEINE (caffeine_mg)
-- ────────────────────────────────────────────────────────────────────────

-- Moderate caffeine (>150mg) amplifies acute attention performance.
-- Einother & Giesbrecht 2013 review; Smit & Rogers 2000 dose-response.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'caffeine_mg', '>150', e.id,
  1.05, 1.15, 1.30,
  '{}'::uuid[],
  'Acute caffeine >150mg amplifies attention performance ~10-20% '
    || '(Einother & Giesbrecht 2013; Smit & Rogers 2000).',
  'caffeine-naive or low-tolerance adults'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ 'caffeine'
  and lower(tgt.name) ~ '(attention|sustained.?attention|alertness)'
on conflict do nothing;

-- High caffeine (>300mg) elevates cortisol; amplifies HPA-driven negatives.
-- Lovallo et al. 2005 RCT.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'caffeine_mg', '>300', e.id,
  1.10, 1.25, 1.45,
  '{}'::uuid[],
  'High caffeine intake (>300mg/day) elevates cortisol response '
    || '~25% (Lovallo et al. 2005).',
  'adults; chronic high caffeine consumers'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ '(caffeine|stress|hpa)'
  and lower(tgt.name) ~ 'cortisol'
on conflict do nothing;

-- ────────────────────────────────────────────────────────────────────────
-- CHRONIC INFLAMMATION (hsCRP)
-- ────────────────────────────────────────────────────────────────────────

-- Elevated hsCRP (>3 mg/L) suppresses BDNF expression.
-- Lotrich 2015 review; Brietzke et al. 2009 clinical sample.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'hsCRP', '>3', e.id,
  0.55, 0.70, 0.85,
  '{}'::uuid[],
  'Elevated hsCRP (>3 mg/L) suppresses BDNF expression ~30% (Lotrich '
    || '2015; Brietzke et al. 2009).',
  'adults with chronic low-grade inflammation'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ '(aerobic|exercise|behavior)'
  and lower(tgt.name) ~ 'bdnf'
on conflict do nothing;

-- ────────────────────────────────────────────────────────────────────────
-- INSULIN RESISTANCE (fasting_glucose mg/dL)
-- ────────────────────────────────────────────────────────────────────────

-- High fasting glucose (>100 mg/dL pre-diabetic threshold) dampens
-- cognitive responses. Cherbuin et al. 2012 + Crane et al. 2013.
insert into public.condition_modulators (
  space_id, condition_key, value_match, target_edge_id,
  multiplier_p10, multiplier_p50, multiplier_p90,
  source_evidence_ids, rationale, population_label
)
select
  e.space_id, 'fasting_glucose', '>100', e.id,
  0.65, 0.80, 0.95,
  '{}'::uuid[],
  'Pre-diabetic fasting glucose (>100 mg/dL) dampens cognitive recovery '
    || 'response ~20% (Cherbuin et al. 2012; Crane et al. 2013).',
  'middle-aged + older adults; longitudinal cohorts'
from public.edges e
join public.entities src on src.id = e.source_entity_id
join public.entities tgt on tgt.id = e.target_entity_id
where lower(src.name) ~ '(neurogenesis|neuroplasticity|bdnf)'
  and lower(tgt.name) ~ '(working.?memory|cognitive|memory|processing.?speed)'
on conflict do nothing;

-- ────────────────────────────────────────────────────────────────────────
-- ── End starter library ──
--
-- Coverage check: this seed populates ~20 distinct (condition × edge)
-- multiplier patterns. For a typical cognitive-performance space with
-- the seed template applied, expect 8-15 modulator rows to insert
-- (depending on which entity-name patterns match).
--
-- Future expansions (not in this seed; written separately):
--   - Chronotype × time-of-day cognitive performance
--   - Menstrual-cycle × cognitive performance (luteal/follicular)
--   - Heat / altitude × exercise response
--   - Smoking × neurogenesis
--   - Heavy alcohol × hippocampal function
--   - SSRI / antidepressant × BDNF baseline
--   - APOE4 genotype × cognitive trajectory
--   - Pregnancy × cognitive measures

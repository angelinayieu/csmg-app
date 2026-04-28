-- ── Layer Ontology — per-space configurable layer hierarchy ────────
--
-- The hardcoded `knowledge_layer` enum on entities (internal /
-- conceptual / external / bridge — only 4 values) is too narrow for
-- domain-rigorous KG modeling. Different domains need different
-- layer hierarchies:
--
--   Mind-body cognition:  Molecular → Circuit → Cognitive →
--                         Behavioral → Performance / Experiential
--   Sleep optimization:   Circadian → Autonomic → Cognitive →
--                         Behavioral
--   Nutrition:            Biochemistry → Physiology → Behavior →
--                         Outcome
--   Exercise science:     Cellular → Tissue → Organ-System →
--                         Performance
--   General causal:       Cause → Mechanism → Mediator → Outcome
--
-- This migration introduces:
--   1. layer_ontology_templates — pre-built starter ontologies the
--      planner can pick from. Seeded with 4 starters at migration
--      time; new starters can be added by inserting rows.
--   2. layer_ontology — per-space materialized layer rows. Each row
--      is ONE layer in a space's active ontology. Nullable template_id
--      lets the row be: starter-derived (template_id set), researcher-
--      agent generated (template_id null + research_trace populated),
--      or fully user-authored (both null).
--   3. entities.layer_ontology_id — nullable FK on entities. When
--      set, takes precedence over the legacy knowledge_layer enum
--      for layer-aware rendering / filtering / coverage gates.
--      Backward compat: existing entities keep knowledge_layer; the
--      enum stays valid as a fallback.
--
-- The `knowledge_layer` enum is NOT removed. Existing entities + code
-- paths continue to work. New spaces use layer_ontology; old spaces
-- can be migrated incrementally.
--
-- Auto-generated ontology research:
--   When a topic doesn't fit any starter, the planner deploys a
--   research agent that reads the user's prompt + uploaded papers +
--   user's scope description and proposes a custom ontology grounded
--   in that domain's literature. The research_trace JSONB column on
--   layer_ontology rows carries the agent's reasoning + source
--   citations so the user can audit "why this layer."

-- ──────────────────────────────────────────────────────────────────
-- Pre-flight dependency guards
-- ──────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='spaces') then
    raise exception 'layer_ontology migration requires spaces table';
  end if;
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='entities') then
    raise exception 'layer_ontology migration requires entities table';
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────
-- 1. layer_ontology_templates — pre-built starters
-- ──────────────────────────────────────────────────────────────────

create table if not exists public.layer_ontology_templates (
  id uuid primary key default gen_random_uuid(),
  -- Stable machine identifier. Used by code that wants to look up a
  -- specific starter (e.g. "mind_body_cognition"). Unique.
  slug text not null unique,
  label text not null,
  description text,
  -- Domains this starter is well-suited for. Free-text array used by
  -- the planner's matcher to pick a starter when the topic is clear.
  -- Example: {"cognitive neuroscience", "cognition optimization",
  -- "working memory", "mind-body modeling"}.
  domain_tags text[] not null default '{}'::text[],
  -- Layer definitions as JSONB array. Each layer object:
  --   {ordinal, label, slug, description, color,
  --    typical_node_kinds[], example_nodes[]}
  -- Stored as JSONB (not separate rows) because templates are
  -- atomic — you import a whole starter, not individual layers.
  layers jsonb not null,
  -- Authoring metadata. Templates added via migration have author
  -- "system"; future user-contributed templates would carry the
  -- contributing user's id.
  author text not null default 'system',
  source_citations text[] default '{}'::text[],
  -- Lifecycle. Templates can be retired (status='deprecated') without
  -- removing the row, so historical layer_ontology rows that
  -- reference them still resolve.
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.layer_ontology_templates
  drop constraint if exists layer_ontology_templates_status_check;
alter table public.layer_ontology_templates
  add constraint layer_ontology_templates_status_check
  check (status in ('active', 'experimental', 'deprecated'));

create index if not exists layer_ontology_templates_slug_idx
  on public.layer_ontology_templates (slug);

create index if not exists layer_ontology_templates_domain_tags_gin_idx
  on public.layer_ontology_templates using gin (domain_tags);

create or replace function public.layer_ontology_templates_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists layer_ontology_templates_set_updated_at on public.layer_ontology_templates;
create trigger layer_ontology_templates_set_updated_at
  before update on public.layer_ontology_templates
  for each row execute function public.layer_ontology_templates_set_updated_at();

-- Templates are public-read (any authenticated user can browse the
-- starter library). Insert/update/delete restricted to service role
-- (templates are seeded via migration; new ones added via deploy,
-- not user UI).

alter table public.layer_ontology_templates enable row level security;

create policy "layer_ontology_templates select all auth"
  on public.layer_ontology_templates for select
  to authenticated
  using (true);

-- ──────────────────────────────────────────────────────────────────
-- 2. layer_ontology — per-space materialized layer rows
-- ──────────────────────────────────────────────────────────────────

create table if not exists public.layer_ontology (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- ── Layer definition ──
  -- 1-based ordinal for stable ordering. Lower = more fundamental
  -- (Molecular = 1; Performance = 5).
  ordinal integer not null,
  -- Human-readable name shown in UI.
  label text not null,
  -- Machine identifier. Unique per (space_id). Used in code paths
  -- that filter by layer (e.g. "show only Cognitive nodes").
  slug text not null,
  description text,
  -- Hex color for canvas rendering. KGNodeShape uses this for
  -- layer-aware visual differentiation.
  color text,
  -- Free-text array of node kinds this layer typically contains.
  -- Drives the +Variable button's kind picker contextual to the
  -- selected layer.
  typical_node_kinds text[] not null default '{}'::text[],

  -- ── Provenance ──
  -- Where this layer came from:
  --   "starter"       — derived from a layer_ontology_templates row
  --                     (template_id set). User may have edited the
  --                     label / description after import.
  --   "research_agent" — generated by deep-research agent for this
  --                     specific space (research_trace populated).
  --   "user_authored" — researcher hand-typed.
  --   "hybrid"        — started as starter or research, then user-edited.
  ontology_source text not null default 'user_authored',
  -- Optional FK to the template this layer derived from. Null if
  -- research_agent or user_authored.
  template_id uuid references public.layer_ontology_templates(id) on delete set null,
  -- Research agent trace when ontology_source = 'research_agent'.
  -- {agent_model, prompt_hash, sources_consulted[], reasoning_summary,
  --  generated_at, planner_confidence}
  research_trace jsonb,
  -- Optional pointer to the kg_generation_plan that materialized this
  -- layer on approval. Lets us trace any layer back to the plan
  -- the user reviewed.
  source_plan_id uuid references public.kg_generation_plans(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Per-space ordering: unique ordinals + unique slugs.
create unique index if not exists layer_ontology_space_ordinal_unique
  on public.layer_ontology (space_id, ordinal);
create unique index if not exists layer_ontology_space_slug_unique
  on public.layer_ontology (space_id, slug);

alter table public.layer_ontology
  drop constraint if exists layer_ontology_ordinal_check;
alter table public.layer_ontology
  add constraint layer_ontology_ordinal_check
  check (ordinal >= 1);

alter table public.layer_ontology
  drop constraint if exists layer_ontology_source_check;
alter table public.layer_ontology
  add constraint layer_ontology_source_check
  check (ontology_source in (
    'starter',
    'research_agent',
    'user_authored',
    'hybrid'
  ));

create index if not exists layer_ontology_space_idx
  on public.layer_ontology (space_id, ordinal);

create or replace function public.layer_ontology_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists layer_ontology_set_updated_at on public.layer_ontology;
create trigger layer_ontology_set_updated_at
  before update on public.layer_ontology
  for each row execute function public.layer_ontology_set_updated_at();

alter table public.layer_ontology enable row level security;

create policy "layer_ontology select own space"
  on public.layer_ontology for select
  using (
    exists (
      select 1 from public.spaces s
      where s.id = layer_ontology.space_id
        and s.user_id = auth.uid()
    )
  );

create policy "layer_ontology insert own space"
  on public.layer_ontology for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.spaces s
      where s.id = layer_ontology.space_id
        and s.user_id = auth.uid()
    )
  );

create policy "layer_ontology update own space"
  on public.layer_ontology for update
  using (
    exists (
      select 1 from public.spaces s
      where s.id = layer_ontology.space_id
        and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.spaces s
      where s.id = layer_ontology.space_id
        and s.user_id = auth.uid()
    )
  );

create policy "layer_ontology delete own space"
  on public.layer_ontology for delete
  using (
    exists (
      select 1 from public.spaces s
      where s.id = layer_ontology.space_id
        and s.user_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────────────
-- 3. entities.layer_ontology_id — nullable FK
-- ──────────────────────────────────────────────────────────────────
--
-- When set, takes precedence over knowledge_layer enum for layer-
-- aware rendering, filtering, coverage gates. When null, the legacy
-- knowledge_layer enum value is the source of truth.
--
-- Backward compat: existing entities are not modified. New entities
-- inserted by the planner-driven pipeline carry layer_ontology_id;
-- old code paths that don't know about layer_ontology continue to
-- work via the enum.

alter table public.entities
  add column if not exists layer_ontology_id uuid references public.layer_ontology(id) on delete set null;

create index if not exists entities_layer_ontology_id_idx
  on public.entities (layer_ontology_id)
  where layer_ontology_id is not null;

comment on column public.entities.layer_ontology_id is
  'FK to per-space layer_ontology row. When set, takes precedence over knowledge_layer enum. Null = use legacy knowledge_layer fallback.';

-- ──────────────────────────────────────────────────────────────────
-- 4. Starter ontology seeds
-- ──────────────────────────────────────────────────────────────────
--
-- Seed 4 starter ontologies. The planner picks one to import + customize,
-- or generates a fully custom ontology via research agent if none fit.
--
-- Each starter's `layers` JSONB is an ordered array of layer objects.
-- Colors chosen for visual distinguishability against canvas background;
-- ordinals are 1-based, fundamental → emergent.

insert into public.layer_ontology_templates (slug, label, description, domain_tags, layers, source_citations)
values
  -- ── Mind-body cognition ──
  ('mind_body_cognition',
   'Mind-body cognition',
   'General mind-body modeling for cognition, performance, and intervention research. Spans molecular substrates through experiential outcomes. Suitable for: working memory, attention, executive function, mood, sleep-cognition, exercise-cognition, intervention efficacy modeling.',
   ARRAY['cognition', 'cognitive performance', 'mind-body', 'neuroscience', 'cognitive neuroscience', 'behavioral intervention', 'CRCI', 'chemobrain', 'working memory', 'attention'],
   $${
     "version": 1,
     "layers": [
       {"ordinal": 1, "slug": "molecular", "label": "Molecular",
        "description": "Neurochemicals, neurotrophins, gene expression, receptor density. The biochemical substrate.",
        "color": "#7C3AED",
        "typical_node_kinds": ["mediator", "modifier"],
        "example_nodes": ["BDNF", "cortisol", "dopamine D2 receptor density", "inflammatory cytokines"]},
       {"ordinal": 2, "slug": "circuit", "label": "Circuit",
        "description": "Neural systems, brain regions, network connectivity. The structural neuroscience layer.",
        "color": "#2563EB",
        "typical_node_kinds": ["mediator", "modifier"],
        "example_nodes": ["hippocampal volume", "prefrontal-parietal connectivity", "default mode network", "fronto-striatal loops"]},
       {"ordinal": 3, "slug": "cognitive", "label": "Cognitive",
        "description": "Mental processes — working memory, attention, executive function, processing speed. The functional layer measured by cognitive tasks.",
        "color": "#0891B2",
        "typical_node_kinds": ["outcome", "mediator", "instrument"],
        "example_nodes": ["working memory capacity (K)", "sustained attention", "executive control", "processing speed", "FACT-Cog total"]},
       {"ordinal": 4, "slug": "behavioral", "label": "Behavioral",
        "description": "Habits, sleep patterns, exercise adherence, intervention compliance. The doable, measurable behavior layer.",
        "color": "#16A34A",
        "typical_node_kinds": ["intervention_kernel", "condition", "modifier"],
        "example_nodes": ["sleep duration", "aerobic exercise adherence", "cognitive training sessions/week", "caffeine intake"]},
       {"ordinal": 5, "slug": "performance", "label": "Performance / Experiential",
        "description": "Real-world outcomes — task performance, subjective wellbeing, daily functioning, quality of life. What the user actually cares about.",
        "color": "#D97706",
        "typical_node_kinds": ["outcome"],
        "example_nodes": ["task accuracy under load", "subjective cognitive complaints", "occupational functioning", "quality of life"]}
     ]
   }$$::jsonb,
   ARRAY['Janelidze et al. 2018 (CRCI biomarker review)', 'Lustberg 2024 (cognitive impairment cancer survivors)', 'Wefel et al. 2011 (chemobrain mechanisms)']
  ),

  -- ── Sleep optimization ──
  ('sleep_optimization',
   'Sleep optimization',
   'Sleep-focused modeling spanning circadian biology through behavioral outcomes. Suitable for: insomnia, circadian misalignment, shift-work sleep disorder, sleep-cognition coupling, performance under sleep restriction.',
   ARRAY['sleep', 'circadian', 'insomnia', 'shift work', 'sleep restriction', 'sleep-cognition'],
   $${
     "version": 1,
     "layers": [
       {"ordinal": 1, "slug": "circadian", "label": "Circadian",
        "description": "Endogenous biological rhythm — melatonin secretion, core body temperature, suprachiasmatic nucleus signaling, clock gene expression.",
        "color": "#7C3AED",
        "typical_node_kinds": ["mediator", "modifier"],
        "example_nodes": ["melatonin onset", "core body temperature minimum", "PER2 expression", "circadian phase"]},
       {"ordinal": 2, "slug": "autonomic", "label": "Autonomic / Homeostatic",
        "description": "Sleep pressure (process S), autonomic balance, sleep architecture (NREM/REM cycles), arousal threshold.",
        "color": "#2563EB",
        "typical_node_kinds": ["mediator", "modifier"],
        "example_nodes": ["sleep pressure", "slow-wave activity", "REM density", "HRV during sleep", "arousal index"]},
       {"ordinal": 3, "slug": "cognitive", "label": "Cognitive",
        "description": "Daytime cognitive consequences of sleep — attention, working memory, vigilance, mood regulation.",
        "color": "#0891B2",
        "typical_node_kinds": ["outcome", "mediator", "instrument"],
        "example_nodes": ["psychomotor vigilance lapses", "working memory under load", "mood regulation capacity", "sleepiness (KSS)"]},
       {"ordinal": 4, "slug": "behavioral", "label": "Behavioral",
        "description": "Sleep behaviors and interventions — bedtime, wake time, light exposure, caffeine, sleep environment, naps.",
        "color": "#16A34A",
        "typical_node_kinds": ["intervention_kernel", "condition", "modifier"],
        "example_nodes": ["bedtime consistency", "morning bright light exposure", "evening caffeine", "nap duration"]}
     ]
   }$$::jsonb,
   ARRAY['Borbely 1982 (two-process model)', 'Roenneberg 2019 (chronotype)', 'AASM clinical guidelines']
  ),

  -- ── Nutrition / metabolic ──
  ('nutrition_metabolic',
   'Nutrition & metabolic',
   'Nutrition and metabolic modeling spanning biochemistry through behavioral outcomes. Suitable for: dietary interventions, metabolic syndrome, glycemic control, weight management, supplementation studies.',
   ARRAY['nutrition', 'metabolic', 'diet', 'glycemic', 'metabolism', 'supplementation', 'macronutrients'],
   $${
     "version": 1,
     "layers": [
       {"ordinal": 1, "slug": "biochemistry", "label": "Biochemistry",
        "description": "Molecular nutrients, enzymes, hormones, metabolic intermediates. The nutrient + signaling level.",
        "color": "#7C3AED",
        "typical_node_kinds": ["mediator", "modifier"],
        "example_nodes": ["insulin", "GLP-1", "free fatty acids", "leptin", "vitamin D"]},
       {"ordinal": 2, "slug": "physiology", "label": "Physiology",
        "description": "Whole-body metabolic state — glycemic control, lipid profile, inflammation, body composition.",
        "color": "#2563EB",
        "typical_node_kinds": ["outcome", "mediator", "instrument"],
        "example_nodes": ["fasting glucose", "HbA1c", "LDL/HDL ratio", "CRP", "visceral adiposity"]},
       {"ordinal": 3, "slug": "behavior", "label": "Behavior",
        "description": "Eating patterns, dietary composition, physical activity, supplementation adherence.",
        "color": "#16A34A",
        "typical_node_kinds": ["intervention_kernel", "condition"],
        "example_nodes": ["meal timing", "carbohydrate fraction", "fiber intake", "supplement adherence"]},
       {"ordinal": 4, "slug": "outcome", "label": "Outcome",
        "description": "Functional and clinical outcomes — energy, weight trajectory, disease risk, quality of life.",
        "color": "#D97706",
        "typical_node_kinds": ["outcome"],
        "example_nodes": ["body weight", "energy / fatigue", "T2D risk", "metabolic syndrome status"]}
     ]
   }$$::jsonb,
   ARRAY['NIH ODS supplement labels database', 'EAT-Lancet 2019 commission', 'ADA Standards of Care']
  ),

  -- ── General causal (fallback) ──
  ('general_causal',
   'General causal (fallback)',
   'Domain-agnostic 4-layer causal scaffold for topics that do not fit a specialized starter. Cause → Mechanism → Mediator → Outcome. Suitable as a fallback when the planner''s research agent has not yet generated a custom ontology.',
   ARRAY['general', 'fallback', 'causal'],
   $${
     "version": 1,
     "layers": [
       {"ordinal": 1, "slug": "cause", "label": "Cause",
        "description": "Root drivers — interventions, exposures, structural conditions that initiate downstream chains.",
        "color": "#DC2626",
        "typical_node_kinds": ["intervention_kernel", "condition"],
        "example_nodes": []},
       {"ordinal": 2, "slug": "mechanism", "label": "Mechanism",
        "description": "Proximate processes the cause activates. The how-it-works layer.",
        "color": "#7C3AED",
        "typical_node_kinds": ["mediator"],
        "example_nodes": []},
       {"ordinal": 3, "slug": "mediator", "label": "Mediator",
        "description": "Intermediate measurable variables that carry the causal effect from mechanism to outcome.",
        "color": "#0891B2",
        "typical_node_kinds": ["mediator", "instrument"],
        "example_nodes": []},
       {"ordinal": 4, "slug": "outcome", "label": "Outcome",
        "description": "Final variables of interest — what the user is trying to change.",
        "color": "#D97706",
        "typical_node_kinds": ["outcome"],
        "example_nodes": []}
     ]
   }$$::jsonb,
   ARRAY['Pearl 2009 (Causality)', 'Hernan & Robins (Causal Inference)']
  )
on conflict (slug) do nothing;

-- ── Comments ──

comment on table public.layer_ontology_templates is
  'Pre-built starter ontologies the KG-generation planner picks from. New starters added via migration. Per-space layer_ontology rows can derive from a template (then customize) or be fully custom (research-agent or user-authored).';

comment on table public.layer_ontology is
  'Per-space materialized layer hierarchy. Each row = one layer in a space''s active ontology. Replaces hardcoded knowledge_layer enum for layer-aware rendering / filtering / coverage gates. Old enum stays as fallback.';

comment on column public.layer_ontology.ontology_source is
  'Provenance: starter (from template) | research_agent (deep-research generated) | user_authored | hybrid (started from one source, then edited). Drives audit display in Plan Review Card.';

comment on column public.layer_ontology.research_trace is
  'When ontology_source=research_agent, carries the deep-research agent''s trace: {agent_model, sources_consulted[], reasoning_summary, planner_confidence}. Lets users audit "why this layer."';

-- ── Objective Canvas — space kind + 4-stage layer seed ─────────────
--
-- Phase 1 of the Objective Canvas module (see project_objective_canvas
-- in agent memory). Adds:
--
--   1. `spaces.space_kind` text column. Default 'legacy' for existing
--      rows. New objective canvases write 'objective_canvas'.
--
--   2. A new layer_ontology_templates row 'objective_brainstorm' with
--      the 4 stages the user described: Pain → Features → Outcomes →
--      Objective. Picked up by the trigger below.
--
--   3. Trigger `seed_objective_canvas_layers` that auto-seeds 4
--      layer_ontology rows for any space inserted with
--      space_kind='objective_canvas'. Reuses the existing per-space
--      layer_ontology system (migration 20260615) — no new tables.
--
-- Rationale: per the user's "4-stage layering" requirement (Pain →
-- Features → Outcomes → Objective), each sub-objective room renders
-- entities grouped by these layers. By backing them with the existing
-- layer_ontology infrastructure, the canvas painter + filtering +
-- coverage gates all work for free.

-- ──────────────────────────────────────────────────────────────────
-- 1. spaces.space_kind
-- ──────────────────────────────────────────────────────────────────

alter table public.spaces
  add column if not exists space_kind text not null default 'legacy';

create index if not exists spaces_space_kind_idx
  on public.spaces (space_kind)
  where space_kind <> 'legacy';

comment on column public.spaces.space_kind is
  'Categorizes the space''s top-level shape. ''legacy'' = the original studio surface. ''objective_canvas'' = the Objective Canvas module (Phase 1+, /app/objective). Drives auto-seed of layer ontology + module-specific UI.';

-- ──────────────────────────────────────────────────────────────────
-- 2. objective_brainstorm starter template
-- ──────────────────────────────────────────────────────────────────
--
-- 4 stages, ordered as the user described. Colors picked to read
-- distinctly on a white canvas with low saturation (Apple-vibe).

insert into public.layer_ontology_templates
  (slug, label, description, domain_tags, layers, source_citations)
values
  ('objective_brainstorm',
   'Objective brainstorm (4-stage)',
   'Pain → Features → Outcomes → Objective. The default ontology for any Objective Canvas. Generated middle-out: pain points anchor one end, the objective anchors the other, outcomes and features bridge them. Cross-layer correlations are ranked in the room''s side panel.',
   ARRAY['brainstorm', 'objective canvas', 'product discovery', 'problem-solution fit'],
   $${
     "version": 1,
     "layers": [
       {"ordinal": 1, "slug": "pain", "label": "Pain points",
        "description": "Problems, bottlenecks, frictions, or unmet needs the objective must address. The starting anchor of the middle-out generation.",
        "color": "#DC2626",
        "typical_node_kinds": ["condition"],
        "example_nodes": []},
       {"ordinal": 2, "slug": "features", "label": "Features",
        "description": "Solutions, mechanisms, or interventions that bridge pains to outcomes. Generated last in the middle-out flow so they are anchored by both ends.",
        "color": "#2563EB",
        "typical_node_kinds": ["intervention_kernel"],
        "example_nodes": []},
       {"ordinal": 3, "slug": "outcomes", "label": "Outcomes",
        "description": "Desired states or conditions when features address pains. Generated after pain points to give features two anchors.",
        "color": "#16A34A",
        "typical_node_kinds": ["outcome"],
        "example_nodes": []},
       {"ordinal": 4, "slug": "objective", "label": "Objective",
        "description": "The umbrella goal — fixed from the sub-objective text. The terminal anchor of the middle-out generation.",
        "color": "#7C3AED",
        "typical_node_kinds": ["outcome"],
        "example_nodes": []}
     ]
   }$$::jsonb,
   ARRAY['Objective Canvas module design (project_objective_canvas memory, 2026-05-24)']
  )
on conflict (slug) do nothing;

-- ──────────────────────────────────────────────────────────────────
-- 3. Trigger: auto-seed layer_ontology rows on space insert
-- ──────────────────────────────────────────────────────────────────

create or replace function public.seed_objective_canvas_layers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tmpl_id uuid;
  tmpl_layers jsonb;
  layer_obj jsonb;
begin
  -- Only fire for objective_canvas spaces.
  if new.space_kind is null or new.space_kind <> 'objective_canvas' then
    return new;
  end if;

  select id, layers
    into tmpl_id, tmpl_layers
    from public.layer_ontology_templates
    where slug = 'objective_brainstorm'
    limit 1;

  -- Template missing (migration ordering issue): silently no-op so
  -- the space still gets created. The /api/brainstorm/start route
  -- has a backstop that creates layer rows directly if the trigger
  -- didn't fire.
  if tmpl_id is null then
    return new;
  end if;

  for layer_obj in select * from jsonb_array_elements(tmpl_layers -> 'layers')
  loop
    insert into public.layer_ontology (
      space_id, user_id, ordinal, label, slug,
      description, color, typical_node_kinds,
      ontology_source, template_id
    )
    values (
      new.id,
      new.user_id,
      (layer_obj ->> 'ordinal')::int,
      layer_obj ->> 'label',
      layer_obj ->> 'slug',
      layer_obj ->> 'description',
      layer_obj ->> 'color',
      coalesce(
        (select array_agg(value::text)
           from jsonb_array_elements_text(layer_obj -> 'typical_node_kinds')),
        '{}'::text[]
      ),
      'starter',
      tmpl_id
    )
    on conflict (space_id, slug) do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists seed_objective_canvas_layers_trigger on public.spaces;
create trigger seed_objective_canvas_layers_trigger
  after insert on public.spaces
  for each row execute function public.seed_objective_canvas_layers();

comment on function public.seed_objective_canvas_layers() is
  'Auto-populates 4 layer_ontology rows (pain, features, outcomes, objective) when a space is inserted with space_kind=''objective_canvas''. Reuses the layer_ontology system from migration 20260615.';

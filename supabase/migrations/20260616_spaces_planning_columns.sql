-- ── Spaces — planning + manual-authoring columns ───────────────────
--
-- Two small additions to spaces, both gating user-visible behavior:
--
-- 1. manual_authoring_enabled (boolean, default false)
--    Per-space toggle. When true, the whiteboard surfaces explicit
--    "+ Intervention", "+ Variable", "+ Paper", "+ Subject" buttons
--    so researchers can hand-author KG content peer-to-peer with
--    LLM extraction. When false (default), only the LLM-driven
--    extraction paths are surfaced (sticky → entity, drag-drop file).
--    Lets a space choose its mode without a separate "rigorous mode"
--    setting elsewhere.
--
-- 2. active_plan_id (uuid, nullable, FK → kg_generation_plans)
--    Pointer to the currently approved plan for this space. The
--    pipeline consults this on every stage to read its config; the
--    Plan Review Card writes here on user approval. Old plans stay
--    in kg_generation_plans for audit; only one is active at a time.
--    Nullable because pre-planning-stage spaces have no plan yet
--    (back-compat: the pipeline falls back to legacy reasoning_settings
--    when active_plan_id is null).

do $$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='kg_generation_plans') then
    raise exception 'spaces planning columns migration requires kg_generation_plans — apply 20260614_kg_generation_plans.sql first';
  end if;
end $$;

alter table public.spaces
  add column if not exists manual_authoring_enabled boolean not null default false;

alter table public.spaces
  add column if not exists active_plan_id uuid references public.kg_generation_plans(id) on delete set null;

create index if not exists spaces_active_plan_id_idx
  on public.spaces (active_plan_id)
  where active_plan_id is not null;

comment on column public.spaces.manual_authoring_enabled is
  'When true, the whiteboard surfaces +Intervention/+Variable/+Paper/+Subject buttons for hand-authoring KG content peer-to-peer with LLM extraction. Default false = LLM-only paths.';

comment on column public.spaces.active_plan_id is
  'Currently approved KG generation plan for this space. Pipeline reads stage config from this plan; Plan Review Card writes here on approval. Null = pre-planning (pipeline falls back to legacy reasoning_settings).';

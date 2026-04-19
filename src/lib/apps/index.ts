// ── App Assembly Kit — public exports ─────────────────────────────────
//
// Everything callers outside src/lib/apps should need in one import.
// Widget components are *not* re-exported here — they register
// themselves via the bootstrap in src/components/apps/widgets/index.ts.
// Importing the AppRenderer indirectly triggers that bootstrap.

export {
  registerWidget,
  getWidget,
  listWidgets,
  getContract,
  knownWidgetTypes,
} from "./widget-registry";
export type {
  RegisteredWidget,
  WidgetComponentProps,
} from "./widget-registry";

export {
  validateManifest,
  loadManifestForRender,
} from "./manifest-validator";

export { makeResolve } from "./binding-resolver";
export type { Resolver, ResolverContext, ResolverTable } from "./binding-resolver";

export { defaultActionLabel } from "./widget-context";
export type {
  WidgetRenderContext,
  ResolvedBinding,
  DispatchResult,
} from "./widget-context";

export {
  dispatchAction,
  registerActionHandler,
  getActionHandler,
} from "./action-dispatcher";
export type {
  ActionHandler,
  ActionHandlerContext,
  ActionHandlerResult,
  DispatchActionInput,
} from "./action-dispatcher";

export {
  EXAMPLE_MONITOR_MANIFEST,
  EXAMPLE_WORKFLOW_MANIFEST,
} from "./example-manifests";

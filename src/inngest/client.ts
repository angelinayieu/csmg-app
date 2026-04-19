import { Inngest } from "inngest";

/**
 * Inngest client singleton.
 * In dev: connects to the local Inngest dev server (npx inngest-cli@latest dev).
 * In prod: uses INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY to talk to Inngest Cloud.
 *
 * Event payload types are enforced at call sites by importing types from ./events.ts.
 */
export const inngest = new Inngest({
  id: "interaxis",
  name: "InterAxis Analysis Pipeline",
});

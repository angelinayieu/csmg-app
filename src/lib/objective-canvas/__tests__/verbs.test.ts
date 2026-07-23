import { describe, it, expect } from "vitest";
import {
  VERBS,
  verbById,
  primaryOpForVerb,
  referencedOpIds,
  assertVerbsResolve,
  type VerbId,
} from "../verbs";
import { operationById } from "../canvas-operations";

describe("the five-verb registry", () => {
  it("is exactly five verbs, in diamond order", () => {
    expect(VERBS.map((v) => v.id)).toEqual([
      "widen",
      "focus",
      "deepen",
      "test",
      "make",
    ] satisfies VerbId[]);
  });

  it("maps Widen to diverge and Focus to converge (the diamond)", () => {
    const widen = verbById("widen")!;
    const focus = verbById("focus")!;
    expect(widen.target).toMatchObject({ kind: "op", op: "diverge" });
    expect(widen.phase).toBe("diverge");
    expect(focus.target).toMatchObject({ kind: "op", op: "converge" });
    expect(focus.phase).toBe("converge");
  });

  it("gates only Make", () => {
    expect(VERBS.filter((v) => v.gated).map((v) => v.id)).toEqual(["make"]);
  });

  it("carries a plain-language prompt on every verb", () => {
    for (const v of VERBS) {
      expect(v.prompt.length).toBeGreaterThan(0);
      // No implementation vocabulary leaks into user-facing copy.
      expect(v.prompt.toLowerCase()).not.toMatch(
        /engine|converge|diverge|rubric|substrate/,
      );
    }
  });

  it("references only real, wired ops (registry stays honest)", () => {
    expect(() => assertVerbsResolve()).not.toThrow();
    for (const id of referencedOpIds()) {
      const op = operationById(id);
      expect(op, `op "${id}" must exist`).toBeDefined();
      expect(op!.wired, `op "${id}" must be wired`).toBe(true);
    }
  });

  it("resolves the primary op for thinking verbs, not for Make", () => {
    expect(primaryOpForVerb(verbById("deepen")!)?.id).toBe("decompose");
    expect(primaryOpForVerb(verbById("make")!)).toBeUndefined();
  });
});

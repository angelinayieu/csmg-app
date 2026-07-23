import { describe, it, expect } from "vitest";
import {
  computeMaturity,
  maturityPct,
  isMakeUnlocked,
  stateScore,
  canMarkExplored,
  canMarkResolved,
  nextAllowedState,
  maturityBreakdown,
} from "../compute";
import {
  CRITICAL_WEIGHT,
  DEFAULT_WEIGHT,
  type GlobalQuestion,
  type QuestionEvidence,
} from "../types";

function evidence(o: Partial<QuestionEvidence> = {}): QuestionEvidence {
  return { research: false, userAnswer: false, confirmed: false, ...o };
}

function q(o: Partial<GlobalQuestion> = {}): GlobalQuestion {
  return {
    id: "q",
    prompt: "?",
    state: "open",
    weight: DEFAULT_WEIGHT,
    evidence: evidence(),
    sourceNodeIds: [],
    ...o,
  };
}

describe("maturity computation", () => {
  it("is 0 for an empty set", () => {
    expect(computeMaturity([])).toBe(0);
    expect(maturityPct([])).toBe(0);
  });

  it("scores states 0 / 0.5 / 1", () => {
    expect(stateScore("open")).toBe(0);
    expect(stateScore("explored")).toBe(0.5);
    expect(stateScore("resolved")).toBe(1);
  });

  it("is a weighted average, with critical questions counting double", () => {
    // one critical (w2) resolved, one normal (w1) open → 2 of 3 possible.
    const qs = [
      q({ id: "a", state: "resolved", weight: CRITICAL_WEIGHT }),
      q({ id: "b", state: "open", weight: DEFAULT_WEIGHT }),
    ];
    expect(computeMaturity(qs)).toBeCloseTo(2 / 3, 5);
    expect(maturityPct(qs)).toBe(67);
  });

  it("treats a non-positive weight as 1 rather than dividing by zero", () => {
    const qs = [q({ state: "resolved", weight: 0 })];
    expect(computeMaturity(qs)).toBe(1);
  });

  it("does NOT move when nothing changes state (clicking is not progress)", () => {
    const qs = [q({ state: "open" }), q({ id: "b", state: "open" })];
    const before = computeMaturity(qs);
    // simulate 'firing verbs' — no state field touched
    const after = computeMaturity(qs);
    expect(after).toBe(before);
    expect(after).toBe(0);
  });

  it("unlocks Make at the 60% threshold, not before", () => {
    // two normal + one critical (total weight 4). Need >= 0.6 → >= 2.4 points.
    const below = [
      q({ id: "a", state: "resolved", weight: DEFAULT_WEIGHT }), // 1
      q({ id: "b", state: "explored", weight: DEFAULT_WEIGHT }), // 0.5
      q({ id: "c", state: "open", weight: CRITICAL_WEIGHT }), // 0
    ];
    expect(computeMaturity(below)).toBeCloseTo(1.5 / 4, 5); // 0.375
    expect(isMakeUnlocked(below)).toBe(false);

    const at = [
      q({ id: "a", state: "resolved", weight: CRITICAL_WEIGHT }), // 2
      q({ id: "b", state: "explored", weight: DEFAULT_WEIGHT }), // 0.5
      q({ id: "c", state: "open", weight: DEFAULT_WEIGHT }), // 0
    ];
    expect(computeMaturity(at)).toBeCloseTo(2.5 / 4, 5); // 0.625
    expect(isMakeUnlocked(at)).toBe(true);
  });
});

describe("evidence gates", () => {
  it("explored needs research OR a user answer", () => {
    expect(canMarkExplored(evidence())).toBe(false);
    expect(canMarkExplored(evidence({ research: true }))).toBe(true);
    expect(canMarkExplored(evidence({ userAnswer: true }))).toBe(true);
  });

  it("resolved needs research AND a user answer AND confirmation", () => {
    expect(canMarkResolved(evidence({ research: true, userAnswer: true }))).toBe(
      false,
    );
    expect(
      canMarkResolved(
        evidence({ research: true, userAnswer: true, confirmed: true }),
      ),
    ).toBe(true);
  });

  it("advances a question only along open → explored → resolved", () => {
    expect(nextAllowedState(q({ state: "open", evidence: evidence() }))).toBeNull();
    expect(
      nextAllowedState(q({ state: "open", evidence: evidence({ research: true }) })),
    ).toBe("explored");
    expect(
      nextAllowedState(
        q({
          state: "explored",
          evidence: evidence({ research: true, userAnswer: true, confirmed: true }),
        }),
      ),
    ).toBe("resolved");
    expect(
      nextAllowedState(q({ state: "resolved", evidence: evidence() })),
    ).toBeNull();
  });
});

describe("breakdown for the explainer", () => {
  it("reports earned/possible per question", () => {
    const qs = [
      q({ id: "a", state: "explored", weight: CRITICAL_WEIGHT }),
      q({ id: "b", state: "open", weight: DEFAULT_WEIGHT }),
    ];
    expect(maturityBreakdown(qs)).toEqual([
      { id: "a", earned: 1, possible: 2 },
      { id: "b", earned: 0, possible: 1 },
    ]);
  });
});

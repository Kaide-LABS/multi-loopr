// Implements PHASE_3_SPEC.md §1.1 -- plan.test.ts
// Covers §8 acceptance criteria #10, #11.

import { test } from "node:test";
import assert from "node:assert/strict";
import { InternalError } from "../domain/errors.ts";
import type { RunConfig } from "../domain/run.ts";
import { otherProviderId, planTurnSequence } from "./plan.ts";

function baseConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    run_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    repo_dir: "/tmp/fake-repo",
    executor_providers: ["claude-code", "codex-cli"],
    reviewer_provider: null,
    turn_timeout_ms: 1_800_000,
    phase: 1,
    spec_path: "PHASE_1_SPEC.md",
    ...overrides,
  };
}

test("otherProviderId returns the other member for both PROVIDER_IDS members", () => {
  assert.equal(otherProviderId("claude-code"), "codex-cli");
  assert.equal(otherProviderId("codex-cli"), "claude-code");
});

test("otherProviderId throws InternalError for an unreachable input", () => {
  assert.throws(
    // @ts-expect-error -- deliberately calling with a value outside ProviderId to exercise the defensive branch.
    () => otherProviderId("not-a-real-provider"),
    InternalError,
  );
});

test("planTurnSequence produces the three-slot sequence in order, defaulting the reviewer to the non-second-executor provider", () => {
  const plan = planTurnSequence(baseConfig());
  assert.deepStrictEqual(plan, [
    { archetype: "executor", provider: "claude-code" },
    { archetype: "executor", provider: "codex-cli" },
    { archetype: "reviewer", provider: "claude-code" },
  ]);
});

test("planTurnSequence honours an explicit non-null reviewer_provider override", () => {
  const plan = planTurnSequence(baseConfig({ reviewer_provider: "codex-cli" }));
  assert.deepStrictEqual(plan[2], { archetype: "reviewer", provider: "codex-cli" });
});

test("planTurnSequence respects executor_providers' own order", () => {
  const plan = planTurnSequence(baseConfig({ executor_providers: ["codex-cli", "claude-code"] }));
  assert.deepStrictEqual(plan[0], { archetype: "executor", provider: "codex-cli" });
  assert.deepStrictEqual(plan[1], { archetype: "executor", provider: "claude-code" });
  assert.deepStrictEqual(plan[2], { archetype: "reviewer", provider: "codex-cli" });
});

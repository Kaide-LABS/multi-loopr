// Implements PHASE_3_SPEC.md §1.1 -- prompt.test.ts
// Covers §8 acceptance criteria #25, #26.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FORBIDDEN_RELAY_KEY_PATTERN } from "../domain/relay.ts";
import type { HandoffRecord } from "../domain/relay.ts";
import {
  buildArtifactProductionInstructions,
  buildExecutorPrompt,
  buildHandoffContext,
  buildProtocolInstructions,
  buildReviewerPrompt,
} from "./prompt.ts";

const HANDOFF_RECORD_FIELD_NAMES = [
  "schema_version",
  "run_id",
  "phase",
  "turn_index",
  "role",
  "provider",
  "model_tier",
  "started_at",
  "completed_at",
  "repo",
  "spec_ref",
  "artifacts_read",
  "artifacts_written",
  "status",
  "work_done",
  "next_steps",
  "open_questions",
  "halt",
];

function priorRecord(overrides: Partial<HandoffRecord> = {}): HandoffRecord {
  return {
    schema_version: 1,
    run_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    phase: 1,
    turn_index: 0,
    role: "executor",
    provider: "claude-code",
    model_tier: "high-volume-low-effort",
    started_at: "2026-08-16T10:00:00Z",
    completed_at: "2026-08-16T10:05:00Z",
    repo: { branch: "main", head_before: "a".repeat(40), head_after: "b".repeat(40), commits: ["b".repeat(40)] },
    spec_ref: { path: "PHASE_1_SPEC.md", sha256: "c".repeat(64) },
    artifacts_read: [],
    artifacts_written: [{ path: "src/foo.ts", sha256: "d".repeat(64) }],
    status: "completed",
    work_done: "Implemented foo.",
    next_steps: ["Implement bar."],
    open_questions: ["Should bar be async?"],
    halt: null,
    ...overrides,
  };
}

test("buildProtocolInstructions contains every mandatory-content item, tested individually", () => {
  const out = buildProtocolInstructions({
    handoffAbsPath: "/repo/.multi-loopr/runs/abc/handoff/1/000-executor-claude-code.json",
    role: "executor",
    specRepoRelPath: "PHASE_2_SPEC.md",
    babyPrdRepoRelPath: ".claude/loopr/baby_prd.md",
    contextRepoRelPath: ".claude/loopr/context.md",
  });

  // 1. the literal handoffAbsPath
  assert.ok(out.includes("/repo/.multi-loopr/runs/abc/handoff/1/000-executor-claude-code.json"));
  // 2. every one of the eighteen HandoffRecord top-level field names
  for (const field of HANDOFF_RECORD_FIELD_NAMES) {
    assert.ok(out.includes(field), `expected protocol instructions to mention field "${field}"`);
  }
  // 3. factual-only statement citing PRD §6.4 by name
  assert.ok(out.includes("factual"));
  assert.ok(out.includes("PRD §6.4"));
  // 4. advisory-only / overwritten statement
  assert.ok(out.includes("advisory only"));
  assert.ok(out.includes("overwrites"));
  // 5. honest-halt statement
  assert.ok(out.includes('"blocked"'));
  assert.ok(out.includes('"halted"'));
  assert.ok(out.includes('"completed"'));
  // 6. the literal specRepoRelPath
  assert.ok(out.includes("PHASE_2_SPEC.md"));
  // 7. the literal babyPrdRepoRelPath (PHASE_4_SPEC.md §6.2, new)
  assert.ok(out.includes(".claude/loopr/baby_prd.md"));
  // 8. the literal contextRepoRelPath (PHASE_4_SPEC.md §6.2, new)
  assert.ok(out.includes(".claude/loopr/context.md"));
});

test("buildHandoffContext renders only the allow-listed fields, never a raw JSON dump", () => {
  const out = buildHandoffContext(priorRecord());
  assert.ok(out.includes("Implemented foo."));
  assert.ok(out.includes("Implement bar."));
  assert.ok(out.includes("Should bar be async?"));
  assert.ok(out.includes("src/foo.ts"));
  assert.ok(out.includes("completed"));
  assert.ok(out.includes("PHASE_1_SPEC.md"));
  // Not a raw JSON dump: schema_version/run_id/turn_index/role/provider/model_tier/started_at/
  // completed_at/repo (git ground truth)/artifacts_read are not allow-listed and must not leak.
  assert.ok(!out.includes("schema_version"));
  assert.ok(!out.includes("run_id"));
  assert.ok(!out.includes("model_tier"));
});

const BABY_PRD_REPO_REL_PATH = ".claude/loopr/baby_prd.md";
const CONTEXT_REPO_REL_PATH = ".claude/loopr/context.md";

test("buildExecutorPrompt omits handoff context on the first turn (priorRecord: null) and includes it on the second", () => {
  const first = buildExecutorPrompt({
    role: "executor",
    specRepoRelPath: "PHASE_1_SPEC.md",
    handoffAbsPath: "/repo/handoff.json",
    babyPrdRepoRelPath: BABY_PRD_REPO_REL_PATH,
    contextRepoRelPath: CONTEXT_REPO_REL_PATH,
    priorRecord: null,
    retryNote: null,
  });
  assert.ok(!first.includes("Implemented foo."));

  const second = buildExecutorPrompt({
    role: "executor",
    specRepoRelPath: "PHASE_1_SPEC.md",
    handoffAbsPath: "/repo/handoff.json",
    babyPrdRepoRelPath: BABY_PRD_REPO_REL_PATH,
    contextRepoRelPath: CONTEXT_REPO_REL_PATH,
    priorRecord: priorRecord(),
    retryNote: null,
  });
  assert.ok(second.includes("Implemented foo."));
});

test("buildExecutorPrompt appends retryNote when non-null", () => {
  const out = buildExecutorPrompt({
    role: "executor",
    specRepoRelPath: "PHASE_1_SPEC.md",
    handoffAbsPath: "/repo/handoff.json",
    babyPrdRepoRelPath: BABY_PRD_REPO_REL_PATH,
    contextRepoRelPath: CONTEXT_REPO_REL_PATH,
    priorRecord: null,
    retryNote: "RETRY: fix C3_NO_REVERT.",
  });
  assert.ok(out.includes("RETRY: fix C3_NO_REVERT."));
});

test("buildReviewerPrompt contains the spec path, the real diff text, and the prior record's allow-listed fields, and introduces no forbidden key name", () => {
  const diff = "diff --git a/foo.ts b/foo.ts\n+added a line\n";
  const out = buildReviewerPrompt({
    specRepoRelPath: "PHASE_2_SPEC.md",
    handoffAbsPath: "/repo/handoff.json",
    babyPrdRepoRelPath: BABY_PRD_REPO_REL_PATH,
    contextRepoRelPath: CONTEXT_REPO_REL_PATH,
    priorRecord: priorRecord(),
    diff,
    expectedArtifactPath: "PHASE_3_SPEC.md",
    isFinalPhase: false,
    retryNote: null,
  });
  assert.ok(out.includes("PHASE_2_SPEC.md"));
  assert.ok(out.includes(diff));
  assert.ok(out.includes("Implemented foo."));

  // buildHandoffContext's own "key: value" style labels never introduce a forbidden key name.
  // (Its own protocol-instruction prose legitimately *mentions* "reasoning"/"transcript" etc. as
  // English words while explaining the isolation rule to the agent -- that is not the same as
  // introducing one of those names as a payload key, which is what §6.2 item 26 actually guards
  // against. The allow-listed field *values* themselves came from an already-validated
  // HandoffRecord, which cannot contain such a key by construction -- assertNoTranscriptFields
  // already rejected it before this record was ever accepted.)
  const contextOnly = buildHandoffContext(priorRecord());
  const keyLabels = [...contextOnly.matchAll(/^([a-zA-Z_]+):/gm)].map((m) => m[1] ?? "");
  for (const label of keyLabels) {
    assert.equal(FORBIDDEN_RELAY_KEY_PATTERN.test(label), false, `key label "${label}" must not match the isolation denylist`);
  }
});

test("buildReviewerPrompt truncates a very large diff rather than embedding it unboundedly", () => {
  const hugeDiff = "x".repeat(50_000);
  const out = buildReviewerPrompt({
    specRepoRelPath: "PHASE_1_SPEC.md",
    handoffAbsPath: "/repo/handoff.json",
    babyPrdRepoRelPath: BABY_PRD_REPO_REL_PATH,
    contextRepoRelPath: CONTEXT_REPO_REL_PATH,
    priorRecord: priorRecord(),
    diff: hugeDiff,
    expectedArtifactPath: "PHASE_2_SPEC.md",
    isFinalPhase: false,
    retryNote: null,
  });
  assert.ok(out.length < hugeDiff.length);
  assert.ok(out.includes("truncated"));
});

test("buildReviewerPrompt appends retryNote when non-null", () => {
  const out = buildReviewerPrompt({
    specRepoRelPath: "PHASE_1_SPEC.md",
    handoffAbsPath: "/repo/handoff.json",
    babyPrdRepoRelPath: BABY_PRD_REPO_REL_PATH,
    contextRepoRelPath: CONTEXT_REPO_REL_PATH,
    priorRecord: priorRecord(),
    diff: "diff",
    expectedArtifactPath: "PHASE_2_SPEC.md",
    isFinalPhase: false,
    retryNote: "RETRY: address C4_SPEC_CONTINUITY.",
  });
  assert.ok(out.includes("RETRY: address C4_SPEC_CONTINUITY."));
});

// -------------------------------------------------------------------------------------------
// PHASE_4_SPEC.md §6.2 -- buildArtifactProductionInstructions() and its reviewer-only wiring
// (§8 acceptance criteria #25, #26)
// -------------------------------------------------------------------------------------------

test("buildArtifactProductionInstructions contains the literal expectedArtifactPath and branches on isFinalPhase", () => {
  const nonFinal = buildArtifactProductionInstructions("PHASE_5_SPEC.md", false);
  assert.ok(nonFinal.includes("PHASE_5_SPEC.md"));
  assert.ok(nonFinal.includes("technical blueprint"));
  assert.ok(!nonFinal.includes("completion record"));

  const final = buildArtifactProductionInstructions("BUILD_COMPLETE.md", true);
  assert.ok(final.includes("BUILD_COMPLETE.md"));
  assert.ok(final.includes("completion record"));
  assert.ok(!final.includes("technical blueprint"));
});

test("buildReviewerPrompt's output contains the literal expectedArtifactPath and the isFinalPhase-branched framing, for both branches", () => {
  const nonFinal = buildReviewerPrompt({
    specRepoRelPath: "PHASE_4_SPEC.md",
    handoffAbsPath: "/repo/handoff.json",
    babyPrdRepoRelPath: BABY_PRD_REPO_REL_PATH,
    contextRepoRelPath: CONTEXT_REPO_REL_PATH,
    priorRecord: priorRecord(),
    diff: "diff",
    expectedArtifactPath: "PHASE_5_SPEC.md",
    isFinalPhase: false,
    retryNote: null,
  });
  assert.ok(nonFinal.includes("PHASE_5_SPEC.md"));
  assert.ok(nonFinal.includes("technical blueprint"));

  const final = buildReviewerPrompt({
    specRepoRelPath: "PHASE_5_SPEC.md",
    handoffAbsPath: "/repo/handoff.json",
    babyPrdRepoRelPath: BABY_PRD_REPO_REL_PATH,
    contextRepoRelPath: CONTEXT_REPO_REL_PATH,
    priorRecord: priorRecord(),
    diff: "diff",
    expectedArtifactPath: "BUILD_COMPLETE.md",
    isFinalPhase: true,
    retryNote: null,
  });
  assert.ok(final.includes("BUILD_COMPLETE.md"));
  assert.ok(final.includes("completion record"));
});

test("buildExecutorPrompt's output never contains buildArtifactProductionInstructions()'s output -- production instructions are reviewer-only", () => {
  const expectedArtifactPath = "PHASE_5_SPEC.md";
  const executorOut = buildExecutorPrompt({
    role: "executor",
    specRepoRelPath: "PHASE_4_SPEC.md",
    handoffAbsPath: "/repo/handoff.json",
    babyPrdRepoRelPath: BABY_PRD_REPO_REL_PATH,
    contextRepoRelPath: CONTEXT_REPO_REL_PATH,
    priorRecord: priorRecord(),
    retryNote: null,
  });
  const reviewerOut = buildReviewerPrompt({
    specRepoRelPath: "PHASE_4_SPEC.md",
    handoffAbsPath: "/repo/handoff.json",
    babyPrdRepoRelPath: BABY_PRD_REPO_REL_PATH,
    contextRepoRelPath: CONTEXT_REPO_REL_PATH,
    priorRecord: priorRecord(),
    diff: "diff",
    expectedArtifactPath,
    isFinalPhase: false,
    retryNote: null,
  });

  const productionInstructions = buildArtifactProductionInstructions(expectedArtifactPath, false);
  assert.ok(reviewerOut.includes(productionInstructions));
  assert.ok(!executorOut.includes(productionInstructions));
  assert.ok(!executorOut.includes("You must genuinely produce loopr's next phase artifact"));
});

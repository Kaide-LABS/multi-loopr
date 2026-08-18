// Implements PHASE_6_SPEC.md §1.2 -- driver.test.ts
// Schema round-trip and rejection tests for DriveConfig/DriverLogEntry: `.strict()` rejection,
// `schema_version` literal rejection, and every field's own validator.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DriveConfig, DriverLogEntry, DRIVER_DECISION_KINDS, DRIVER_STATE_IDS } from "./driver.ts";

const DRIVER_RUN_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const DISPATCHED_RUN_ID = "4fa85f64-5717-4562-b3fc-2c963f66afa7";

function validDriveConfig(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    repo_dir: "/tmp/target-repo",
    driver_run_id: DRIVER_RUN_ID,
    starting_spec_path: "PHASE_1_SPEC.md",
    baby_prd_path: "baby_prd.md",
    context_path: "context.md",
    target_total_phases: 3,
    executor_providers: ["claude-code", "codex-cli"],
    ...overrides,
  };
}

test("DriveConfig accepts a minimal valid config and applies defaults", () => {
  const parsed = DriveConfig.parse(validDriveConfig());
  assert.equal(parsed.starting_phase, 1);
  assert.equal(parsed.max_phases, 25);
  assert.equal(parsed.reviewer_provider, null);
  assert.equal(parsed.turn_timeout_ms, 1_800_000);
});

test("DriveConfig accepts a fully-populated config", () => {
  const parsed = DriveConfig.parse(
    validDriveConfig({
      starting_phase: 2,
      max_phases: 10,
      reviewer_provider: "codex-cli",
      turn_timeout_ms: 60_000,
      model_overrides: { "claude-code": "override-model" },
      executor_prompt_path: "executor-prompt.md",
      reviewer_prompt_path: "reviewer-prompt.md",
    }),
  );
  assert.equal(parsed.starting_phase, 2);
  assert.equal(parsed.max_phases, 10);
  assert.equal(parsed.reviewer_provider, "codex-cli");
});

test("DriveConfig (z.strictObject) rejects an unknown extra key", () => {
  const raw = validDriveConfig({ unexpected_extra_field: "nope" });
  const result = DriveConfig.safeParse(raw);
  assert.equal(result.success, false);
});

test("DriveConfig rejects executor_providers with two identical provider ids", () => {
  const raw = validDriveConfig({ executor_providers: ["claude-code", "claude-code"] });
  const result = DriveConfig.safeParse(raw);
  assert.equal(result.success, false);
});

test("DriveConfig rejects target_total_phases < 1", () => {
  const raw = validDriveConfig({ target_total_phases: 0 });
  assert.equal(DriveConfig.safeParse(raw).success, false);
});

test("DriveConfig rejects max_phases < 1", () => {
  const raw = validDriveConfig({ max_phases: 0 });
  assert.equal(DriveConfig.safeParse(raw).success, false);
});

test("DriveConfig rejects a missing required field (target_total_phases)", () => {
  const raw = validDriveConfig();
  delete raw["target_total_phases"];
  assert.equal(DriveConfig.safeParse(raw).success, false);
});

test("DriveConfig rejects an unsafe starting_spec_path (absolute path)", () => {
  const raw = validDriveConfig({ starting_spec_path: "/etc/passwd" });
  assert.equal(DriveConfig.safeParse(raw).success, false);
});

test("DRIVER_STATE_IDS has exactly six members", () => {
  assert.equal(DRIVER_STATE_IDS.length, 6);
});

test("DRIVER_DECISION_KINDS has exactly three members", () => {
  assert.equal(DRIVER_DECISION_KINDS.length, 3);
});

function validLogEntry(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    written_at: "2026-08-18T10:00:00Z",
    driver_run_id: DRIVER_RUN_ID,
    phase: 1,
    state_id: "D0_NOT_STARTED",
    decision_kind: "dispatch",
    reason: "No phase has been dispatched yet this invocation.",
    dispatched_run_id: null,
    dispatched_run_exit_code: null,
    next_phase: 1,
    exit_code: null,
    ...overrides,
  };
}

test("DriverLogEntry accepts a fully-populated valid dispatch entry", () => {
  const rec = DriverLogEntry.parse(validLogEntry());
  assert.equal(rec.state_id, "D0_NOT_STARTED");
});

test("DriverLogEntry accepts a fully-populated valid terminal entry", () => {
  const rec = DriverLogEntry.parse(
    validLogEntry({
      state_id: "D3_BUILD_COMPLETE_PRESENT",
      decision_kind: "stop",
      dispatched_run_id: DISPATCHED_RUN_ID,
      dispatched_run_exit_code: 0,
      next_phase: null,
      exit_code: 0,
    }),
  );
  assert.equal(rec.decision_kind, "stop");
  assert.equal(rec.next_phase, null);
});

test("DriverLogEntry rejects schema_version: 2", () => {
  assert.equal(DriverLogEntry.safeParse(validLogEntry({ schema_version: 2 })).success, false);
});

test("DriverLogEntry (FM-D3) rejects an empty reason", () => {
  assert.equal(DriverLogEntry.safeParse(validLogEntry({ reason: "" })).success, false);
});

test("DriverLogEntry rejects a missing reason field entirely", () => {
  const raw = validLogEntry();
  delete raw["reason"];
  assert.equal(DriverLogEntry.safeParse(raw).success, false);
});

test("DriverLogEntry (z.strictObject) rejects an unknown extra key", () => {
  assert.equal(DriverLogEntry.safeParse(validLogEntry({ unexpected_extra_field: "nope" })).success, false);
});

test("DriverLogEntry rejects an invalid state_id outside the six-member enum", () => {
  assert.equal(DriverLogEntry.safeParse(validLogEntry({ state_id: "D9_MADE_UP" })).success, false);
});

test("DriverLogEntry rejects an invalid decision_kind outside the three-member enum", () => {
  assert.equal(DriverLogEntry.safeParse(validLogEntry({ decision_kind: "retry" })).success, false);
});

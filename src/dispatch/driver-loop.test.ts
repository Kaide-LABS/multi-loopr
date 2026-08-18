// Implements PHASE_6_SPEC.md §1.2 -- driver-loop.test.ts
// runDrive() integration tests against real temporary directories with an injected fake
// `runDispatchFn` (DriveDispatchDeps's own test seam -- PHASE_6_SPEC.md §6.4) standing in for a
// real per-phase turn dispatch. Covers baby_prd.md acceptance criteria 3, 4, 5, 6, 7 and §8
// acceptance criteria 9-13, FM-D6, FM-D7, FM-D8.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { DriveConfig } from "../domain/driver.ts";
import { DriverLogEntry } from "../domain/driver.ts";
import type { RunResult } from "./run-loop.ts";
import { driverLogPath } from "../util/paths.ts";
import { runDrive } from "./driver-loop.ts";

async function freshRepo(): Promise<string> {
  return mkdtemp(`${tmpdir()}/multi-loopr-driver-loop-test-`);
}

function baseDriveConfig(dir: string, overrides: Partial<DriveConfig> = {}): DriveConfig {
  return {
    repo_dir: dir,
    driver_run_id: randomUUID(),
    starting_phase: 1,
    starting_spec_path: "PHASE_1_SPEC.md",
    baby_prd_path: "baby_prd.md",
    context_path: "context.md",
    target_total_phases: 3,
    max_phases: 25,
    executor_providers: ["claude-code", "codex-cli"],
    reviewer_provider: null,
    turn_timeout_ms: 1_800_000,
    ...overrides,
  };
}

function okResult(exitCode = 0): RunResult {
  return { ok: true, exitCode, turns: [], halt: null, problems: [], warnings: [] };
}

function errResult(exitCode: number, problems: readonly string[]): RunResult {
  return { ok: false, exitCode, turns: [], halt: null, problems, warnings: [] };
}

test("runDrive (FM-D7) halts with DRIVER_START_INCOHERENT when BUILD_COMPLETE.md already exists before any dispatch, and dispatches nothing", async () => {
  const dir = await freshRepo();
  try {
    await writeFile(`${dir}/BUILD_COMPLETE.md`, "already done\n", "utf8");
    let dispatchCount = 0;
    const config = baseDriveConfig(dir);
    const result = await runDrive(config, {
      runDispatchFn: async () => {
        dispatchCount += 1;
        return okResult();
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 17);
    assert.equal(result.finalStateId, "D0_NOT_STARTED");
    assert.equal(dispatchCount, 0);
    assert.equal(result.phases.length, 1);
    assert.equal(result.phases[0]?.dispatched_run_id, null);
    assert.equal(result.phases[0]?.dispatched_run_exit_code, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDrive (baby_prd.md AC3, §8 AC9, D4) halts with DRIVER_HALTED_AMBIGUOUS when a completed phase produces neither artifact, and never dispatches a next phase", async () => {
  const dir = await freshRepo();
  try {
    const config = baseDriveConfig(dir);
    let dispatchCount = 0;
    const result = await runDrive(config, {
      runDispatchFn: async () => {
        dispatchCount += 1;
        return okResult();
      },
    });
    assert.equal(result.exitCode, 14);
    assert.equal(result.ok, false);
    assert.equal(result.finalStateId, "D4_NEITHER_PRESENT");
    assert.equal(dispatchCount, 1);
    assert.equal(result.problems.length, 1);
    assert.ok(result.problems[0]?.toLowerCase().includes("ambiguous"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDrive (baby_prd.md AC4, §8 AC10, D5) halts with DRIVER_HALTED_INCOHERENT when a completed phase produces both artifacts, and does not pick one", async () => {
  const dir = await freshRepo();
  try {
    const config = baseDriveConfig(dir);
    const result = await runDrive(config, {
      runDispatchFn: async () => {
        await writeFile(`${dir}/PHASE_2_SPEC.md`, "next spec\n", "utf8");
        await writeFile(`${dir}/BUILD_COMPLETE.md`, "done\n", "utf8");
        return okResult();
      },
    });
    assert.equal(result.exitCode, 15);
    assert.equal(result.ok, false);
    assert.equal(result.finalStateId, "D5_BOTH_PRESENT");
    assert.ok(result.problems[0]?.toLowerCase().includes("incoherent"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDrive (baby_prd.md AC5, §8 AC11) walks a real 2-phase fixture build to BUILD_COMPLETE.md in one invocation, with no manual re-invocation", async () => {
  const dir = await freshRepo();
  try {
    const config = baseDriveConfig(dir, { target_total_phases: 2 });
    const dispatchedPhases: number[] = [];
    const isFinalByPhase: Record<number, boolean> = {};
    const result = await runDrive(config, {
      runDispatchFn: async (runConfig) => {
        dispatchedPhases.push(runConfig.phase);
        isFinalByPhase[runConfig.phase] = runConfig.is_final_phase;
        if (runConfig.phase === 1) {
          await writeFile(`${dir}/PHASE_2_SPEC.md`, "next spec\n", "utf8");
        } else {
          await writeFile(`${dir}/BUILD_COMPLETE.md`, "done\n", "utf8");
        }
        return okResult();
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.finalStateId, "D3_BUILD_COMPLETE_PRESENT");
    assert.deepEqual(dispatchedPhases, [1, 2]);
    // FM-D8: is_final_phase === phase >= target_total_phases, computed at exactly one call site.
    assert.equal(isFinalByPhase[1], false);
    assert.equal(isFinalByPhase[2], true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDrive (PHASE_7_SPEC.md §6.4/FM-P5) threads role_pins unchanged into every dispatched phase's own RunConfig, across at least two consecutive phases", async () => {
  const dir = await freshRepo();
  try {
    const rolePins = { "claude-code": "executor", "codex-cli": "reviewer" } as const;
    const config = baseDriveConfig(dir, { target_total_phases: 3, role_pins: rolePins });
    const seenRolePins: unknown[] = [];
    const result = await runDrive(config, {
      runDispatchFn: async (runConfig) => {
        seenRolePins.push(runConfig.role_pins);
        if (runConfig.phase < 3) {
          await writeFile(`${dir}/PHASE_${String(runConfig.phase + 1)}_SPEC.md`, "next spec\n", "utf8");
        } else {
          await writeFile(`${dir}/BUILD_COMPLETE.md`, "done\n", "utf8");
        }
        return okResult();
      },
    });
    assert.equal(result.ok, true);
    assert.equal(seenRolePins.length, 3);
    for (const seen of seenRolePins) {
      assert.deepEqual(seen, rolePins);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDrive (PHASE_7_SPEC.md §6.4) omits role_pins entirely from a dispatched phase's RunConfig when DriveConfig carries none", async () => {
  const dir = await freshRepo();
  try {
    const config = baseDriveConfig(dir, { target_total_phases: 1 });
    let dispatchedHasKey = true;
    const result = await runDrive(config, {
      runDispatchFn: async (runConfig) => {
        dispatchedHasKey = Object.prototype.hasOwnProperty.call(runConfig, "role_pins");
        await writeFile(`${dir}/BUILD_COMPLETE.md`, "done\n", "utf8");
        return okResult();
      },
    });
    assert.equal(result.ok, true);
    assert.equal(dispatchedHasKey, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDrive (baby_prd.md AC6, §8 AC12, FM-D6) stops at the configured max-phases cap and reports the cap, not a false build-finished claim", async () => {
  const dir = await freshRepo();
  try {
    const config = baseDriveConfig(dir, { target_total_phases: 100, max_phases: 3 });
    let dispatchCount = 0;
    const result = await runDrive(config, {
      runDispatchFn: async (runConfig) => {
        dispatchCount += 1;
        await writeFile(`${dir}/PHASE_${String(runConfig.phase + 1)}_SPEC.md`, "next spec\n", "utf8");
        return okResult();
      },
    });
    assert.equal(result.exitCode, 16);
    assert.equal(result.ok, false);
    assert.equal(dispatchCount, 3);
    assert.ok(result.problems[0]?.toLowerCase().includes("cap"));
    // The reason explicitly denies a false "build finished" claim (PHASE_6_SPEC.md §6.5's own
    // literal wording is "not because the build finished") -- the halt is attributed to the cap.
    assert.ok(result.problems[0]?.toLowerCase().includes("not because the build finished"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDrive (baby_prd.md AC7, §8 AC13, FM-D9) writes a durable, append-only dispatch log a fresh reader can reconstruct without re-running anything", async () => {
  const dir = await freshRepo();
  try {
    const config = baseDriveConfig(dir, { target_total_phases: 2 });
    const result = await runDrive(config, {
      runDispatchFn: async (runConfig) => {
        if (runConfig.phase === 1) {
          await writeFile(`${dir}/PHASE_2_SPEC.md`, "next spec\n", "utf8");
        } else {
          await writeFile(`${dir}/BUILD_COMPLETE.md`, "done\n", "utf8");
        }
        return okResult();
      },
    });

    const logPath = driverLogPath(dir, config.driver_run_id);
    const raw = await readFile(logPath, "utf8");
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, result.phases.length);

    const parsed = lines.map((line) => DriverLogEntry.parse(JSON.parse(line) as unknown));
    assert.deepEqual(
      parsed.map((p) => p.state_id),
      result.phases.map((p) => p.state_id),
    );
    assert.deepEqual(
      parsed.map((p) => p.decision_kind),
      result.phases.map((p) => p.decision_kind),
    );
    assert.equal(parsed[parsed.length - 1]?.decision_kind, "stop");
    assert.equal(parsed[parsed.length - 1]?.exit_code, 0);
    for (const entry of parsed) {
      assert.equal(entry.driver_run_id, config.driver_run_id);
      assert.ok(entry.reason.length > 0);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDrive (D1_RUN_ERRORED) halts and propagates the failing runDispatch()'s own exit code, never a driver-invented one", async () => {
  const dir = await freshRepo();
  try {
    const config = baseDriveConfig(dir);
    const result = await runDrive(config, {
      runDispatchFn: async () => errResult(3, ["preflight failed: git not found"]),
    });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 3);
    assert.equal(result.finalStateId, "D1_RUN_ERRORED");
    assert.ok(result.problems[0]?.includes("preflight failed"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDrive dispatches config.starting_phase, not a hardcoded 1 (resume support)", async () => {
  const dir = await freshRepo();
  try {
    const config = baseDriveConfig(dir, {
      starting_phase: 4,
      starting_spec_path: "PHASE_4_SPEC.md",
      target_total_phases: 4,
    });
    let seenPhase: number | null = null;
    const result = await runDrive(config, {
      runDispatchFn: async (runConfig) => {
        seenPhase = runConfig.phase;
        await writeFile(`${dir}/BUILD_COMPLETE.md`, "done\n", "utf8");
        return okResult();
      },
    });
    assert.equal(seenPhase, 4);
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

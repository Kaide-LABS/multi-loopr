// Implements PHASE_3_SPEC.md §1.1 -- run-loop.test.ts
// End-to-end dispatch scenarios against real temporary git repositories (continuity.test.ts's own
// established pattern, Phase 1) plus an injected fake AdapterRegistry/runProcessFn standing in for
// a real provider CLI -- no test in this file spawns a real `claude` or `codex` process.
// Covers §8 acceptance criteria #12, #13, #14, #19, #20, #21, #23, #24, #29.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { BoundaryViolationError, InternalError, TurnTimeoutError } from "../domain/errors.ts";
import type { FileRef, HaltSignal, HandoffRecord } from "../domain/relay.ts";
import { writeHandoffRecord } from "../domain/relay.ts";
import type { ProviderId, RawInvocationResult, RunConfig, TurnOutcome, TurnRequest } from "../domain/run.ts";
import type { AdapterRegistry, Invocation, PreflightReport, ProviderAdapter } from "../ports/provider-adapter.ts";
import { runProcess } from "../util/exec.ts";
import { acquireRunLock, readRunLock, releaseRunLock } from "../util/lock.ts";
import { handoffPath } from "../util/paths.ts";
import type { PreflightSummary } from "../verify/preflight.ts";
import { runDispatch } from "./run-loop.ts";

const GIT_TIMEOUT_MS = 30_000;
const RUN_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

/**
 * A synthetic, always-healthy `PreflightSummary`, injected via `RunDispatchDeps.preflightFn`
 * (an AUTONOMOUS CRITIQUE addition to `RunDispatchDeps` -- see run-loop.ts's own doc comment on
 * that interface). The real `runPreflight()` shells out to the actual `claude`/`codex` binaries
 * with no injection seam of its own; this repo's own dev machine has Codex CLI installed but not
 * authenticated (confirmed live: `node src/cli/main.ts doctor --providers --json`), which would
 * otherwise make every scenario below fail at PREFLIGHT_FAILED before ever reaching the turn loop
 * under test -- directly defeating §8 acceptance criterion #30's requirement that no test in this
 * phase spawn a real `claude` or `codex` process.
 */
function fakeHealthyPreflight(): Promise<PreflightSummary> {
  return Promise.resolve({
    node: { found: true, version: "24.15.0", inRange: true },
    git: { found: true, version: "2.54.0", inRange: true },
    providers: [
      { provider: "claude-code", cliFound: true, version: "2.1.211", versionInRange: true, authenticated: true, problems: [] },
      { provider: "codex-cli", cliFound: true, version: "0.128.0", versionInRange: true, authenticated: true, problems: [] },
    ],
    ok: true,
    problems: [],
  });
}

async function git(repoDir: string, args: readonly string[]): Promise<string> {
  const result = await runProcess({ command: "git", args, cwd: repoDir, timeoutMs: GIT_TIMEOUT_MS });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed (exit ${String(result.exitCode)}): ${result.stderr}`);
  }
  return result.stdout;
}

async function initRepo(dir: string): Promise<void> {
  await git(dir, ["init", "--quiet", "-b", "main"]);
  await git(dir, ["config", "user.email", "test@example.com"]);
  await git(dir, ["config", "user.name", "Test"]);
}

async function commitFile(dir: string, relPath: string, content: string, message: string): Promise<string> {
  await writeFile(`${dir}/${relPath}`, content, "utf8");
  await git(dir, ["add", relPath]);
  await git(dir, ["commit", "--quiet", "-m", message]);
  return (await git(dir, ["rev-parse", "HEAD"])).trim();
}

async function commitFiles(dir: string, files: Readonly<Record<string, string>>, message: string): Promise<string> {
  for (const [relPath, content] of Object.entries(files)) {
    await writeFile(`${dir}/${relPath}`, content, "utf8");
    await git(dir, ["add", relPath]);
  }
  await git(dir, ["commit", "--quiet", "-m", message]);
  return (await git(dir, ["rev-parse", "HEAD"])).trim();
}

async function freshRepoWithSpec(): Promise<string> {
  const dir = await mkdtemp(`${tmpdir()}/multi-loopr-run-loop-test-`);
  await initRepo(dir);
  await commitFile(dir, "PHASE_1_SPEC.md", "spec content\n", "add spec");
  // Pre-exists so a later "revert" scenario reverts to a real recorded blob (not to
  // non-existence, which C3_NO_REVERT does not treat as a revert target).
  await commitFile(dir, "foo.txt", "v0\n", "add foo.txt");
  return dir;
}

function baseConfig(dir: string, overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    run_id: RUN_ID,
    repo_dir: dir,
    executor_providers: ["claude-code", "codex-cli"],
    reviewer_provider: null,
    turn_timeout_ms: 1_800_000,
    phase: 1,
    spec_path: "PHASE_1_SPEC.md",
    ...overrides,
  };
}

class RecordingFakeAdapter implements ProviderAdapter {
  readonly id: ProviderId;
  readonly seenRequests: TurnRequest[] = [];
  constructor(id: ProviderId) {
    this.id = id;
  }
  preflight(): Promise<PreflightReport> {
    return Promise.resolve({ provider: this.id, cliFound: true, version: "1.0.0", versionInRange: true, authenticated: true, problems: [] });
  }
  resolveEffort(): string {
    return "low";
  }
  buildInvocation(req: TurnRequest): Invocation {
    this.seenRequests.push(req);
    return { command: "fake-cli", args: [], env: {}, cwd: req.repoDir, stdin: req.prompt };
  }
  interpretResult(raw: RawInvocationResult): TurnOutcome {
    if (raw.timedOut) {
      return { ok: false, record: null, failure: new TurnTimeoutError("fake-cli timed out") };
    }
    if (raw.exitCode !== 0) {
      return { ok: false, record: null, failure: new InternalError(raw.stderr || "fake-cli failed") };
    }
    return { ok: true, record: null, failure: null };
  }
}

/**
 * A schema-valid draft `HandoffRecord`. `run_id`/`phase`/`turn_index`/`role`/`provider`/
 * `model_tier`/`repo`/`spec_ref` values are placeholders -- `reconcileHandoffRecord` only ever
 * replaces `repo`/`spec_ref`/artifact hashes (§6.3), and none of Phase 3's own logic (continuity
 * checks, prompt assembly) ever reads the other bookkeeping fields, so any schema-valid placeholder
 * is sufficient for them.
 */
function draft(overrides: {
  readonly role?: "executor" | "reviewer";
  readonly artifactsRead?: readonly FileRef[];
  readonly artifactsWritten?: readonly FileRef[];
  readonly status?: "completed" | "blocked" | "halted";
  readonly halt?: HaltSignal | null;
} = {}): HandoffRecord {
  return {
    schema_version: 1,
    run_id: RUN_ID,
    phase: 1,
    turn_index: 0,
    role: overrides.role ?? "executor",
    provider: "claude-code",
    model_tier: "high-volume-low-effort",
    started_at: "2026-08-16T10:00:00Z",
    completed_at: "2026-08-16T10:05:00Z",
    repo: { branch: "placeholder", head_before: "0".repeat(40), head_after: "1".repeat(40), commits: ["1".repeat(40)] },
    spec_ref: { path: "PLACEHOLDER.md", sha256: "0".repeat(64) },
    artifacts_read: overrides.artifactsRead ? [...overrides.artifactsRead] : [],
    artifacts_written: overrides.artifactsWritten ? [...overrides.artifactsWritten] : [],
    status: overrides.status ?? "completed",
    work_done: "did work",
    next_steps: [],
    open_questions: [],
    halt: overrides.halt ?? null,
  };
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

test("runDispatch: clean 3-turn run completes ok, honours model_overrides/timeoutMs/tier per turn, releases the lock", async () => {
  const dir = await freshRepoWithSpec();
  try {
    // z.record over a closed-enum key schema requires every enum member when the object is
    // present at all (verified live: a partial object fails RunConfig validation) -- so "one
    // provider overridden, the other not" isn't an expressible RunConfig; this instead proves each
    // provider is attributed its own distinct value, not the other's or a constant.
    const config = baseConfig(dir, {
      turn_timeout_ms: 60_000,
      model_overrides: { "claude-code": "operator-chosen-claude-override", "codex-cli": "operator-chosen-codex-override" },
    });
    const claude = new RecordingFakeAdapter("claude-code");
    const codex = new RecordingFakeAdapter("codex-cli");
    const adapters: AdapterRegistry = { "claude-code": claude, "codex-cli": codex };

    let call = 0;
    const runProcessFn: typeof runProcess = async () => {
      const step = call;
      call += 1;
      if (step === 0) {
        await commitFile(dir, "foo.txt", "v1\n", "turn0");
        await writeHandoffRecord(
          handoffPath(dir, RUN_ID, 1, 0, "executor", "claude-code"),
          draft({ artifactsWritten: [{ path: "foo.txt", sha256: "a".repeat(64) }] }),
        );
      } else if (step === 1) {
        await commitFile(dir, "bar.txt", "v1\n", "turn1");
        await writeHandoffRecord(
          handoffPath(dir, RUN_ID, 1, 1, "executor", "codex-cli"),
          draft({
            artifactsRead: [{ path: "foo.txt", sha256: "a".repeat(64) }],
            artifactsWritten: [{ path: "bar.txt", sha256: "a".repeat(64) }],
          }),
        );
      } else {
        await commitFile(dir, "reviewed.txt", "v1\n", "turn2");
        await writeHandoffRecord(
          handoffPath(dir, RUN_ID, 1, 2, "reviewer", "claude-code"),
          draft({ role: "reviewer", artifactsRead: [{ path: "bar.txt", sha256: "a".repeat(64) }] }),
        );
      }
      return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };

    const result = await runDispatch(config, { adapters, runProcessFn, preflightFn: fakeHealthyPreflight });

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.turns.length, 3);
    assert.deepStrictEqual(
      result.turns.map((t) => [t.archetype, t.provider, t.status, t.continuityVerdict, t.retried]),
      [
        ["executor", "claude-code", "completed", null, false],
        ["executor", "codex-cli", "completed", "CONTINUED", false],
        ["reviewer", "claude-code", "completed", "CONTINUED", false],
      ],
    );

    // model_overrides/timeoutMs/tier passthrough (§8 #23, #24).
    assert.equal(claude.seenRequests[0]?.modelOverride, "operator-chosen-claude-override");
    assert.equal(codex.seenRequests[0]?.modelOverride, "operator-chosen-codex-override");
    for (const req of [...claude.seenRequests, ...codex.seenRequests]) {
      assert.equal(req.timeoutMs, 60_000);
    }
    assert.equal(claude.seenRequests[0]?.tier, "high-volume-low-effort");
    assert.equal(claude.seenRequests[1]?.tier, "verification-grade");

    assert.equal(await readRunLock(dir), null);
  } finally {
    await cleanup(dir);
  }
});

test("runDispatch: a continuity failure retries exactly once and succeeds", async () => {
  const dir = await freshRepoWithSpec();
  try {
    const config = baseConfig(dir);
    const claude = new RecordingFakeAdapter("claude-code");
    const codex = new RecordingFakeAdapter("codex-cli");
    const adapters: AdapterRegistry = { "claude-code": claude, "codex-cli": codex };

    let call = 0;
    const runProcessFn: typeof runProcess = async () => {
      const step = call;
      call += 1;
      if (step === 0) {
        await commitFile(dir, "foo.txt", "v1\n", "turn0");
        await writeHandoffRecord(
          handoffPath(dir, RUN_ID, 1, 0, "executor", "claude-code"),
          draft({ artifactsWritten: [{ path: "foo.txt", sha256: "a".repeat(64) }] }),
        );
      } else if (step === 1) {
        // Bad attempt: reverts foo.txt entirely -> C3_NO_REVERT fails all-reverted -> REDO.
        await commitFile(dir, "foo.txt", "v0\n", "turn1 (bad, reverts turn0)");
        await writeHandoffRecord(
          handoffPath(dir, RUN_ID, 1, 1, "executor", "codex-cli"),
          draft({ artifactsRead: [{ path: "foo.txt", sha256: "a".repeat(64) }] }),
        );
      } else if (step === 2) {
        // Retry (turnIndex 2): restores foo.txt to turn0's content (undoing the bad revert) and
        // adds bar.txt -- genuinely does not revert any path turn0 touched.
        await commitFiles(dir, { "foo.txt": "v1\n", "bar.txt": "v1\n" }, "turn1 retry (good)");
        await writeHandoffRecord(
          handoffPath(dir, RUN_ID, 1, 2, "executor", "codex-cli"),
          draft({
            artifactsRead: [{ path: "foo.txt", sha256: "a".repeat(64) }],
            artifactsWritten: [{ path: "bar.txt", sha256: "a".repeat(64) }],
          }),
        );
      } else {
        await commitFile(dir, "reviewed.txt", "v1\n", "turn2 (reviewer, turnIndex 3)");
        await writeHandoffRecord(
          handoffPath(dir, RUN_ID, 1, 3, "reviewer", "claude-code"),
          draft({ role: "reviewer", artifactsRead: [{ path: "bar.txt", sha256: "a".repeat(64) }] }),
        );
      }
      return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };

    const result = await runDispatch(config, { adapters, runProcessFn, preflightFn: fakeHealthyPreflight });

    // With RunConfig.model_overrides entirely omitted, every turn falls back to null (§8 #24).
    assert.equal(claude.seenRequests[0]?.modelOverride, null);
    assert.equal(codex.seenRequests[0]?.modelOverride, null);

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    // §8 #29: "one extra" turn on a single successful retry.
    assert.equal(result.turns.length, 4);
    assert.deepStrictEqual(
      result.turns.map((t) => [t.turnIndex, t.status, t.continuityVerdict, t.retried]),
      [
        [0, "completed", null, false],
        [1, "completed", "REDO", false],
        [2, "completed", "CONTINUED", true],
        [3, "completed", "CONTINUED", false],
      ],
    );
  } finally {
    await cleanup(dir);
  }
});

test("runDispatch: a continuity failure on both the original and the retry halts at CONTINUITY_FAILED (6)", async () => {
  const dir = await freshRepoWithSpec();
  try {
    const config = baseConfig(dir);
    const claude = new RecordingFakeAdapter("claude-code");
    const codex = new RecordingFakeAdapter("codex-cli");
    const adapters: AdapterRegistry = { "claude-code": claude, "codex-cli": codex };

    let call = 0;
    const runProcessFn: typeof runProcess = async () => {
      const step = call;
      call += 1;
      if (step === 0) {
        await commitFile(dir, "foo.txt", "v1\n", "turn0");
        await writeHandoffRecord(
          handoffPath(dir, RUN_ID, 1, 0, "executor", "claude-code"),
          draft({ artifactsWritten: [{ path: "foo.txt", sha256: "a".repeat(64) }] }),
        );
      } else if (step === 1) {
        // Original attempt (turnIndex 1) reverts foo.txt back to turn0's own pre-turn content.
        await commitFile(dir, "foo.txt", "v0\n", "turn1 attempt 1 (bad, reverts turn0)");
        await writeHandoffRecord(
          handoffPath(dir, RUN_ID, 1, step, "executor", "codex-cli"),
          draft({ artifactsRead: [{ path: "foo.txt", sha256: "a".repeat(64) }] }),
        );
      } else {
        // Retry (turnIndex 2): never touches foo.txt again, so it stays reverted relative to
        // turn0 -- still needs its own real commit (R3), on an unrelated file, to stay distinct
        // from an empty (nothing-to-commit) git operation.
        await commitFile(dir, `noise-${String(step)}.txt`, "noise\n", `turn1 attempt ${String(step)} (bad, still reverted)`);
        await writeHandoffRecord(
          handoffPath(dir, RUN_ID, 1, step, "executor", "codex-cli"),
          draft({ artifactsRead: [{ path: "foo.txt", sha256: "a".repeat(64) }] }),
        );
      }
      return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };

    const result = await runDispatch(config, { adapters, runProcessFn, preflightFn: fakeHealthyPreflight });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 6);
    assert.equal(result.turns.length, 3);
    assert.deepStrictEqual(
      result.turns.map((t) => [t.turnIndex, t.continuityVerdict, t.retried]),
      [
        [0, null, false],
        [1, "REDO", false],
        [2, "REDO", true],
      ],
    );
    assert.equal(await readRunLock(dir), null);
  } finally {
    await cleanup(dir);
  }
});

test("runDispatch: a HandoffRecord.status of \"halted\" stops the run immediately, before any continuity check, exitCode RUN_HALTED (11)", async () => {
  const dir = await freshRepoWithSpec();
  try {
    const config = baseConfig(dir);
    const claude = new RecordingFakeAdapter("claude-code");
    const codex = new RecordingFakeAdapter("codex-cli");
    const adapters: AdapterRegistry = { "claude-code": claude, "codex-cli": codex };
    const haltSignal: HaltSignal = { code: "BLOCKED_ON_HUMAN", message: "need operator input" };

    const runProcessFn: typeof runProcess = async () => {
      await commitFile(dir, "foo.txt", "v1\n", "turn0 (halted)");
      await writeHandoffRecord(
        handoffPath(dir, RUN_ID, 1, 0, "executor", "claude-code"),
        draft({ status: "halted", halt: haltSignal }),
      );
      return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };

    const result = await runDispatch(config, { adapters, runProcessFn, preflightFn: fakeHealthyPreflight });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 11);
    assert.equal(result.turns.length, 1);
    assert.equal(result.turns[0]?.status, "halted");
    assert.equal(result.turns[0]?.continuityVerdict, null);
    assert.deepStrictEqual(result.halt, haltSignal);
    assert.equal(await readRunLock(dir), null);
  } finally {
    await cleanup(dir);
  }
});

test("runDispatch: an adapter-reported failure (e.g. a timeout) on the first turn halts with zero retry", async () => {
  const dir = await freshRepoWithSpec();
  try {
    const config = baseConfig(dir);
    const claude = new RecordingFakeAdapter("claude-code");
    const codex = new RecordingFakeAdapter("codex-cli");
    const adapters: AdapterRegistry = { "claude-code": claude, "codex-cli": codex };

    const runProcessFn: typeof runProcess = async () => ({
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: 1,
      timedOut: true,
    });

    const result = await runDispatch(config, { adapters, runProcessFn, preflightFn: fakeHealthyPreflight });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 10);
    assert.equal(result.turns.length, 1);
    assert.equal(result.turns[0]?.status, "failed");
    assert.equal(result.turns[0]?.retried, false);
    assert.equal(await readRunLock(dir), null);
  } finally {
    await cleanup(dir);
  }
});

test("runDispatch: an unexpected throw (BoundaryViolationError from assertNeutralCommits) still releases the lock", async () => {
  // §8 acceptance criterion #12 explicitly requires lock release to be verified for "an
  // unexpected throw", not only for the modelled RunResult-returning exit paths. run-loop.ts's own
  // top-of-file comment states a `BoundaryViolationError` from `assertNeutralCommits` inside
  // `runTurn` is "deliberately never caught anywhere in this module" and is left to propagate out
  // of `runDispatch` itself -- so this is the one exit path where `runDispatch` throws rather than
  // returning a `RunResult`. FM6/I4 both depend on the lock still being released here: a leaked
  // lock on a boundary violation would deadlock every subsequent run against this repo.
  const dir = await freshRepoWithSpec();
  try {
    const config = baseConfig(dir);
    const claude = new RecordingFakeAdapter("claude-code");
    const codex = new RecordingFakeAdapter("codex-cli");
    const adapters: AdapterRegistry = { "claude-code": claude, "codex-cli": codex };

    const runProcessFn: typeof runProcess = async () => {
      // A commit carrying an AI-attribution trailer -- assertNeutralCommits (called inside
      // runTurn, after ground-truth reconciliation) must reject this with BoundaryViolationError.
      await commitFile(dir, "foo.txt", "v1\n", "turn0 (dirty)\n\nCo-Authored-By: Claude <noreply@anthropic.com>");
      await writeHandoffRecord(
        handoffPath(dir, RUN_ID, 1, 0, "executor", "claude-code"),
        draft({ artifactsWritten: [{ path: "foo.txt", sha256: "a".repeat(64) }] }),
      );
      return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };

    await assert.rejects(
      runDispatch(config, { adapters, runProcessFn, preflightFn: fakeHealthyPreflight }),
      (err: unknown) => {
        assert.ok(err instanceof BoundaryViolationError);
        return true;
      },
    );

    // The lock must be released even though runDispatch threw rather than returning a RunResult.
    assert.equal(await readRunLock(dir), null);
  } finally {
    await cleanup(dir);
  }
});

test("runDispatch: lock contention returns LOCK_HELD (8) without dispatching any turn", async () => {
  const dir = await freshRepoWithSpec();
  try {
    await acquireRunLock(dir, "11111111-1111-1111-1111-111111111111");
    const config = baseConfig(dir);
    const claude = new RecordingFakeAdapter("claude-code");
    const codex = new RecordingFakeAdapter("codex-cli");
    const adapters: AdapterRegistry = { "claude-code": claude, "codex-cli": codex };

    let calls = 0;
    const runProcessFn: typeof runProcess = async () => {
      calls += 1;
      return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };

    const result = await runDispatch(config, { adapters, runProcessFn, preflightFn: fakeHealthyPreflight });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 8);
    assert.deepStrictEqual(result.turns, []);
    assert.equal(calls, 0);
  } finally {
    await releaseRunLock(dir, "11111111-1111-1111-1111-111111111111");
    await cleanup(dir);
  }
});

test("runDispatch: a missing spec_path fails preflight (exitCode 3) before acquiring the lock or touching .multi-loopr/runs/**", async () => {
  const dir = await freshRepoWithSpec();
  try {
    const config = baseConfig(dir, { spec_path: "DOES_NOT_EXIST.md" });
    const adapters: AdapterRegistry = {
      "claude-code": new RecordingFakeAdapter("claude-code"),
      "codex-cli": new RecordingFakeAdapter("codex-cli"),
    };

    let calls = 0;
    const runProcessFn: typeof runProcess = async () => {
      calls += 1;
      return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };

    const result = await runDispatch(config, { adapters, runProcessFn, preflightFn: fakeHealthyPreflight });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 3);
    assert.deepStrictEqual(result.turns, []);
    assert.equal(calls, 0);
    assert.equal(await readRunLock(dir), null);
    assert.ok(result.problems.some((p) => p.includes("DOES_NOT_EXIST.md")));
  } finally {
    await cleanup(dir);
  }
});

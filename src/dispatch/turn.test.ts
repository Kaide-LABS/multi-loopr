// Implements PHASE_3_SPEC.md §1.1 -- turn.test.ts
// Full turn lifecycle against a real temp git repo, with an injectable runProcessFn fixture
// standing in for a real provider CLI. Covers §8 acceptance criteria #18, #22, #23.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { BoundaryViolationError, InternalError, IsolationLeakError, LooprArtifactBypassError, RelaySchemaError } from "../domain/errors.ts";
import type { FileRef, HandoffRecord } from "../domain/relay.ts";
import { writeHandoffRecord } from "../domain/relay.ts";
import type { RawInvocationResult, TurnOutcome, TurnRequest } from "../domain/run.ts";
import type { Invocation, PreflightReport, ProviderAdapter } from "../ports/provider-adapter.ts";
import { runProcess } from "../util/exec.ts";
import { sha256File } from "../util/hash.ts";
import { handoffPath } from "../util/paths.ts";
import { runTurn } from "./turn.ts";

const GIT_TIMEOUT_MS = 30_000;

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

async function freshRepo(): Promise<string> {
  const dir = await mkdtemp(`${tmpdir()}/multi-loopr-turn-test-`);
  await initRepo(dir);
  return dir;
}

/**
 * Writes multi-loopr's three canonical loopr artifacts (`baby_prd.md`, `context.md`, and a spec
 * file matching `baseReq()`'s own `specRef.path`/`babyPrdPath`/`contextPath` defaults) as real files
 * on disk (not necessarily committed -- `reconcileFileRefs`, Phase 3, unmodified, hashes from disk
 * regardless of git state) and returns their `FileRef`s so a test can populate a draft's
 * `artifacts_read` with entries that survive ground-truth reconciliation (PHASE_4_SPEC.md §6.1:
 * `assertLooprArtifactsReferenced()` only accepts a *reconciled* record's `artifacts_read`, and a
 * reconciled entry only survives if its path resolves to a real file).
 */
async function writeLooprArtifacts(dir: string): Promise<{ babyPrd: FileRef; context: FileRef; spec: FileRef }> {
  await writeFile(`${dir}/baby_prd.md`, "baby prd content\n", "utf8");
  await writeFile(`${dir}/context.md`, "context content\n", "utf8");
  await writeFile(`${dir}/PHASE_1_SPEC.md`, "spec content\n", "utf8");
  return {
    babyPrd: { path: "baby_prd.md", sha256: await sha256File(`${dir}/baby_prd.md`) },
    context: { path: "context.md", sha256: await sha256File(`${dir}/context.md`) },
    spec: { path: "PHASE_1_SPEC.md", sha256: await sha256File(`${dir}/PHASE_1_SPEC.md`) },
  };
}

class FakeAdapter implements ProviderAdapter {
  readonly id = "claude-code" as const;
  preflight(): Promise<PreflightReport> {
    throw new Error("not used in this test");
  }
  resolveEffort(): string {
    return "low";
  }
  buildInvocation(req: TurnRequest): Invocation {
    return { command: "fake-cli", args: ["--noop"], env: {}, cwd: req.repoDir, stdin: req.prompt };
  }
  interpretResult(raw: RawInvocationResult): TurnOutcome {
    if (raw.exitCode !== 0) {
      return { ok: false, record: null, failure: new InternalError("fake-cli failed") };
    }
    return { ok: true, record: null, failure: null };
  }
}

function baseReq(overrides: Partial<TurnRequest> = {}): TurnRequest {
  return {
    runId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    phase: 1,
    turnIndex: 0,
    archetype: "executor",
    provider: "claude-code",
    tier: "high-volume-low-effort",
    modelOverride: null,
    repoDir: "unused",
    specRef: { path: "PHASE_1_SPEC.md", sha256: "9".repeat(64) },
    priorRecord: null,
    prompt: "do the work",
    timeoutMs: 30_000,
    babyPrdPath: "baby_prd.md",
    contextPath: "context.md",
    expectedArtifactPath: null,
    ...overrides,
  };
}

function draftFor(
  req: TurnRequest,
  repo: HandoffRecord["repo"],
  overrides: { readonly artifactsRead?: readonly FileRef[]; readonly artifactsWritten?: readonly FileRef[] } = {},
): HandoffRecord {
  return {
    schema_version: 1,
    run_id: req.runId,
    phase: req.phase,
    turn_index: req.turnIndex,
    role: "executor",
    provider: "claude-code",
    model_tier: req.tier,
    started_at: "2026-08-16T10:00:00Z",
    completed_at: "2026-08-16T10:05:00Z",
    repo,
    spec_ref: { path: "WRONG.md", sha256: "0".repeat(64) },
    artifacts_read: overrides.artifactsRead ? [...overrides.artifactsRead] : [],
    artifacts_written: overrides.artifactsWritten ? [...overrides.artifactsWritten] : [],
    status: "completed",
    work_done: "did work",
    next_steps: [],
    open_questions: [],
    halt: null,
  };
}

test("runTurn: happy path reconciles and persists the record, overwriting the agent's own (wrong) draft", async () => {
  const dir = await freshRepo();
  try {
    const commit0 = await commitFile(dir, "foo.txt", "v0\n", "initial");
    const artifacts = await writeLooprArtifacts(dir);
    const req = baseReq({ repoDir: dir });
    const path = handoffPath(dir, req.runId, req.phase, req.turnIndex, req.archetype, req.provider);

    const fakeRunProcess: typeof runProcess = async () => {
      // Simulate the dispatched agent: make a real commit, then write a deliberately-wrong draft.
      await commitFile(dir, "foo.txt", "v1\n", "agent's turn");
      await writeHandoffRecord(
        path,
        draftFor(
          req,
          { branch: "wrong-branch", head_before: "1".repeat(40), head_after: "2".repeat(40), commits: ["2".repeat(40)] },
          { artifactsRead: [artifacts.babyPrd, artifacts.context, artifacts.spec] },
        ),
      );
      return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };

    const result = await runTurn(req, { adapter: new FakeAdapter(), runProcessFn: fakeRunProcess });

    assert.equal(result.outcome.ok, true);
    assert.ok(result.record !== null);
    assert.equal(result.record?.repo.branch, "main");
    assert.equal(result.record?.repo.head_before, commit0);
    assert.notEqual(result.record?.repo.head_after, "2".repeat(40));
    assert.deepStrictEqual(result.record?.spec_ref, req.specRef);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("runTurn: an adapter-reported failure short-circuits before reading any on-disk record", async () => {
  const dir = await freshRepo();
  try {
    await commitFile(dir, "foo.txt", "v0\n", "initial");
    const req = baseReq({ repoDir: dir });
    const fakeRunProcess: typeof runProcess = async () => ({
      exitCode: 1,
      signal: null,
      stdout: "",
      stderr: "boom",
      durationMs: 1,
      timedOut: false,
    });

    const result = await runTurn(req, { adapter: new FakeAdapter(), runProcessFn: fakeRunProcess });

    assert.equal(result.outcome.ok, false);
    assert.equal(result.record, null);
    assert.ok(result.outcome.failure instanceof InternalError);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("runTurn: a malformed on-disk record is converted into a modelled failure (RelaySchemaError), not thrown", async () => {
  const dir = await freshRepo();
  try {
    await commitFile(dir, "foo.txt", "v0\n", "initial");
    const req = baseReq({ repoDir: dir });
    const path = handoffPath(dir, req.runId, req.phase, req.turnIndex, req.archetype, req.provider);

    const fakeRunProcess: typeof runProcess = async () => {
      await mkdir(path.split("/").slice(0, -1).join("/"), { recursive: true });
      await writeFile(path, "not valid json{{{", "utf8");
      return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };

    const result = await runTurn(req, { adapter: new FakeAdapter(), runProcessFn: fakeRunProcess });

    assert.equal(result.outcome.ok, false);
    assert.equal(result.outcome.failure?.code, "RELAY_SCHEMA_INVALID");
    assert.equal(result.record, null);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("runTurn: an on-disk record carrying a transcript-shaped key is converted into a modelled failure (IsolationLeakError), not thrown", async () => {
  // §8 acceptance criterion #21 requires a dedicated test proving IsolationLeakError (like
  // RelaySchemaError) never triggers a retry -- both are caught in the same runTurn branch (step
  // 6) and converted into an `outcome.ok: false` result, the uniform shape run-loop.ts's own
  // single "no retry on !outcome.ok" branch handles identically regardless of error subtype.
  const dir = await freshRepo();
  try {
    await commitFile(dir, "foo.txt", "v0\n", "initial");
    const req = baseReq({ repoDir: dir });
    const path = handoffPath(dir, req.runId, req.phase, req.turnIndex, req.archetype, req.provider);

    const fakeRunProcess: typeof runProcess = async () => {
      await mkdir(path.split("/").slice(0, -1).join("/"), { recursive: true });
      // A minimal object carrying a forbidden (transcript-shaped) key -- assertNoTranscriptFields
      // rejects this before schema_version/shape are ever checked.
      await writeFile(path, JSON.stringify({ schema_version: 1, reasoning: "leaked chain of thought" }), "utf8");
      return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };

    const result = await runTurn(req, { adapter: new FakeAdapter(), runProcessFn: fakeRunProcess });

    assert.equal(result.outcome.ok, false);
    assert.ok(result.outcome.failure instanceof IsolationLeakError);
    assert.equal(result.record, null);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("runTurn: ground-truth reconciliation rejecting the record (R3: completed with zero real commits) is converted into a modelled failure (RelaySchemaError), not thrown", async () => {
  // The reconciliation-time counterpart to the read-time RelaySchemaError test above -- §6.4 step
  // 7's own catch clause, distinct from step 6's. §8 acceptance criterion #21 groups both under
  // "a RelaySchemaError/IsolationLeakError from record read or reconciliation".
  const dir = await freshRepo();
  try {
    await commitFile(dir, "foo.txt", "v0\n", "initial");
    const req = baseReq({ repoDir: dir });
    const path = handoffPath(dir, req.runId, req.phase, req.turnIndex, req.archetype, req.provider);

    const fakeRunProcess: typeof runProcess = async () => {
      // The agent claims status: "completed" but makes no real commit -- ground truth will show
      // zero commits between headBefore and HEAD, violating R3 once reconciliation applies it.
      await writeHandoffRecord(
        path,
        draftFor(req, { branch: "main", head_before: "0".repeat(40), head_after: "1".repeat(40), commits: ["1".repeat(40)] }),
      );
      return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };

    const result = await runTurn(req, { adapter: new FakeAdapter(), runProcessFn: fakeRunProcess });

    assert.equal(result.outcome.ok, false);
    assert.ok(result.outcome.failure instanceof RelaySchemaError);
    assert.equal(result.record, null);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("runTurn: a commit carrying an AI-attribution trailer propagates BoundaryViolationError unmodified, uncaught, with zero retry attempted internally", async () => {
  const dir = await freshRepo();
  try {
    const commit0 = await commitFile(dir, "foo.txt", "v0\n", "initial");
    const artifacts = await writeLooprArtifacts(dir);
    const req = baseReq({ repoDir: dir });
    const path = handoffPath(dir, req.runId, req.phase, req.turnIndex, req.archetype, req.provider);

    const fakeRunProcess: typeof runProcess = async () => {
      await writeFile(`${dir}/bar.txt`, "bar\n", "utf8");
      await git(dir, ["add", "bar.txt"]);
      await git(dir, ["commit", "--quiet", "-m", "dirty commit\n\nCo-Authored-By: Claude <noreply@anthropic.com>"]);
      const head = (await git(dir, ["rev-parse", "HEAD"])).trim();
      await writeHandoffRecord(
        path,
        draftFor(
          req,
          { branch: "main", head_before: commit0, head_after: head, commits: [head] },
          { artifactsRead: [artifacts.babyPrd, artifacts.context, artifacts.spec] },
        ),
      );
      return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };

    await assert.rejects(
      () => runTurn(req, { adapter: new FakeAdapter(), runProcessFn: fakeRunProcess }),
      (err: unknown) => {
        assert.ok(err instanceof BoundaryViolationError);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("runTurn: the environment passed to runProcessFn is {...process.env-with-undefined-dropped, ...invocation.env}", async () => {
  const dir = await freshRepo();
  try {
    await commitFile(dir, "foo.txt", "v0\n", "initial");
    process.env["MULTI_LOOPR_TEST_AMBIENT"] = "ambient-value";
    let capturedEnv: Readonly<Record<string, string>> | undefined;
    const req = baseReq({ repoDir: dir });
    const fakeRunProcess: typeof runProcess = async (o) => {
      capturedEnv = o.env;
      return { exitCode: 1, signal: null, stdout: "", stderr: "boom", durationMs: 1, timedOut: false };
    };

    await runTurn(req, { adapter: new FakeAdapter(), runProcessFn: fakeRunProcess });

    assert.equal(capturedEnv?.["MULTI_LOOPR_TEST_AMBIENT"], "ambient-value");
  } finally {
    delete process.env["MULTI_LOOPR_TEST_AMBIENT"];
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("runTurn: timeoutMs passes straight through to runProcessFn, unmodified", async () => {
  const dir = await freshRepo();
  try {
    await commitFile(dir, "foo.txt", "v0\n", "initial");
    let capturedTimeout: number | undefined;
    const req = baseReq({ repoDir: dir, timeoutMs: 123456 });
    const fakeRunProcess: typeof runProcess = async (o) => {
      capturedTimeout = o.timeoutMs;
      return { exitCode: 1, signal: null, stdout: "", stderr: "boom", durationMs: 1, timedOut: false };
    };

    await runTurn(req, { adapter: new FakeAdapter(), runProcessFn: fakeRunProcess });

    assert.equal(capturedTimeout, 123456);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// -------------------------------------------------------------------------------------------
// PHASE_4_SPEC.md §6.3 -- the two new artifact guards (§8 acceptance criteria #13-15, #19, #21, #22)
// -------------------------------------------------------------------------------------------

test("runTurn: an executor turn whose reconciled artifacts_read never references baby_prd_path/context_path/spec_path propagates LooprArtifactBypassError unmodified, uncaught -- the guard is not skipped for an executor slot", async () => {
  const dir = await freshRepo();
  try {
    const commit0 = await commitFile(dir, "foo.txt", "v0\n", "initial");
    // Deliberately do NOT call writeLooprArtifacts/populate artifacts_read -- the agent worked the
    // repo but never genuinely referenced loopr's own canonical artifacts.
    const req = baseReq({ repoDir: dir, archetype: "executor" });
    const path = handoffPath(dir, req.runId, req.phase, req.turnIndex, req.archetype, req.provider);

    const fakeRunProcess: typeof runProcess = async () => {
      await commitFile(dir, "foo.txt", "v1\n", "agent's turn");
      const head = (await git(dir, ["rev-parse", "HEAD"])).trim();
      await writeHandoffRecord(path, draftFor(req, { branch: "main", head_before: commit0, head_after: head, commits: [head] }));
      return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };

    await assert.rejects(
      () => runTurn(req, { adapter: new FakeAdapter(), runProcessFn: fakeRunProcess }),
      (err: unknown) => {
        assert.ok(err instanceof LooprArtifactBypassError);
        assert.equal(err.exitCode, 12);
        assert.ok(err.message.includes("baby_prd_path"));
        assert.ok(err.message.includes("context_path"));
        assert.ok(err.message.includes("spec_path"));
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("runTurn: the same bypass on a reviewer turn also propagates LooprArtifactBypassError -- the guard is archetype-agnostic, not skipped for the reviewer slot either", async () => {
  const dir = await freshRepo();
  try {
    const commit0 = await commitFile(dir, "foo.txt", "v0\n", "initial");
    const req = baseReq({ repoDir: dir, archetype: "reviewer", expectedArtifactPath: null });
    const path = handoffPath(dir, req.runId, req.phase, req.turnIndex, req.archetype, req.provider);

    const fakeRunProcess: typeof runProcess = async () => {
      await commitFile(dir, "foo.txt", "v1\n", "reviewer's turn");
      const head = (await git(dir, ["rev-parse", "HEAD"])).trim();
      await writeHandoffRecord(path, draftFor(req, { branch: "main", head_before: commit0, head_after: head, commits: [head] }));
      return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };

    await assert.rejects(
      () => runTurn(req, { adapter: new FakeAdapter(), runProcessFn: fakeRunProcess }),
      (err: unknown) => {
        assert.ok(err instanceof LooprArtifactBypassError);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("runTurn: assertNextPhaseSpecProduced is never invoked for an executor request (expectedArtifactPath === null) -- a reviewer-only next-artifact path is never even checked to exist", async () => {
  const dir = await freshRepo();
  try {
    const commit0 = await commitFile(dir, "foo.txt", "v0\n", "initial");
    const artifacts = await writeLooprArtifacts(dir);
    // expectedArtifactPath stays null (baseReq's default) -- an executor slot never has one.
    const req = baseReq({ repoDir: dir, archetype: "executor" });
    const path = handoffPath(dir, req.runId, req.phase, req.turnIndex, req.archetype, req.provider);

    const fakeRunProcess: typeof runProcess = async () => {
      // This turn's commits never touch "PHASE_2_SPEC.md" -- if assertNextPhaseSpecProduced were
      // (incorrectly) invoked for this executor request, it would throw. It must not be.
      await commitFile(dir, "foo.txt", "v1\n", "executor's turn");
      const head = (await git(dir, ["rev-parse", "HEAD"])).trim();
      await writeHandoffRecord(
        path,
        draftFor(
          req,
          { branch: "main", head_before: commit0, head_after: head, commits: [head] },
          { artifactsRead: [artifacts.babyPrd, artifacts.context, artifacts.spec] },
        ),
      );
      return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };

    const result = await runTurn(req, { adapter: new FakeAdapter(), runProcessFn: fakeRunProcess });

    assert.equal(result.outcome.ok, true);
    assert.ok(result.record !== null);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("runTurn: when either new guard throws, writeHandoffRecord is never called for that turn -- the would-be-bypassed record is not persisted at handoffPath()", async () => {
  const dir = await freshRepo();
  try {
    const commit0 = await commitFile(dir, "foo.txt", "v0\n", "initial");
    const req = baseReq({ repoDir: dir });
    const path = handoffPath(dir, req.runId, req.phase, req.turnIndex, req.archetype, req.provider);

    const fakeRunProcess: typeof runProcess = async () => {
      await commitFile(dir, "foo.txt", "v1\n", "agent's turn");
      const head = (await git(dir, ["rev-parse", "HEAD"])).trim();
      // Deliberately omits artifacts_read entirely -- assertLooprArtifactsReferenced must throw
      // before the reconciled record (which the agent's own draft here is a stand-in for, since
      // reconciliation only replaces repo/spec_ref/artifact hashes) is ever persisted again.
      await writeHandoffRecord(path, draftFor(req, { branch: "main", head_before: commit0, head_after: head, commits: [head] }));
      return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    };

    await assert.rejects(() => runTurn(req, { adapter: new FakeAdapter(), runProcessFn: fakeRunProcess }));

    // The on-disk record still holds the agent's own pre-reconciliation draft (never overwritten),
    // proving writeHandoffRecord (step 9) never re-ran after the guard's throw at step 7.5.
    const onDisk = await readFile(path, "utf8");
    const parsed = JSON.parse(onDisk) as { readonly spec_ref: { readonly path: string } };
    assert.equal(parsed.spec_ref.path, "WRONG.md");
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

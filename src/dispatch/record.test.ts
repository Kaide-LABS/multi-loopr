// Implements PHASE_3_SPEC.md §1.1 -- record.test.ts
// Covers §8 acceptance criteria #15, #16, #17.
//
// Reconciliation against real temp git repos: a deliberately wrong agent-authored repo/hash is
// proven overwritten, not trusted. All fixtures are real git repositories, built via the
// sanctioned `runProcess` (this file never imports node:child_process directly).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { RelaySchemaError } from "../domain/errors.ts";
import type { HandoffRecord } from "../domain/relay.ts";
import { runProcess } from "../util/exec.ts";
import { sha256File, sha256String } from "../util/hash.ts";
import { captureGroundTruthBefore, reconcileHandoffRecord } from "./record.ts";

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
  const dir = await mkdtemp(`${tmpdir()}/multi-loopr-record-test-`);
  await initRepo(dir);
  return dir;
}

function draftRecord(overrides: Partial<HandoffRecord> = {}): HandoffRecord {
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
    repo: { branch: "wrong-branch", head_before: "1".repeat(40), head_after: "2".repeat(40), commits: ["2".repeat(40)] },
    spec_ref: { path: "WRONG_SPEC.md", sha256: "3".repeat(64) },
    artifacts_read: [],
    artifacts_written: [],
    status: "completed",
    work_done: "did some work",
    next_steps: [],
    open_questions: [],
    halt: null,
    ...overrides,
  };
}

test("captureGroundTruthBefore returns the real HEAD and branch", async () => {
  const dir = await freshRepo();
  try {
    const commit0 = await commitFile(dir, "foo.txt", "hello\n", "initial");
    const ground = await captureGroundTruthBefore(dir);
    assert.equal(ground.headBefore, commit0);
    assert.equal(ground.branch, "main");
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("reconcileHandoffRecord replaces a deliberately-wrong agent-authored repo field with independently-computed ground truth", async () => {
  const dir = await freshRepo();
  try {
    const commit0 = await commitFile(dir, "foo.txt", "v0\n", "initial");
    const commit1 = await commitFile(dir, "foo.txt", "v1\n", "the turn's own commit");

    const draft = draftRecord();
    const reconciled = await reconcileHandoffRecord(dir, draft, {
      headBefore: commit0,
      branch: "main",
      specRef: { path: "PHASE_1_SPEC.md", sha256: "9".repeat(64) },
    });

    assert.equal(reconciled.repo.branch, "main");
    assert.equal(reconciled.repo.head_before, commit0);
    assert.equal(reconciled.repo.head_after, commit1);
    assert.deepStrictEqual(reconciled.repo.commits, [commit1]);
    assert.notEqual(reconciled.repo.branch, draft.repo.branch);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("reconcileHandoffRecord replaces a deliberately-wrong agent-authored spec_ref with the dispatch loop's own computed FileRef", async () => {
  const dir = await freshRepo();
  try {
    const commit0 = await commitFile(dir, "foo.txt", "v0\n", "initial");
    await commitFile(dir, "foo.txt", "v1\n", "the turn's own commit");

    const draft = draftRecord();
    const trueSpecRef = { path: "PHASE_1_SPEC.md", sha256: sha256String("real spec content") };
    const reconciled = await reconcileHandoffRecord(dir, draft, {
      headBefore: commit0,
      branch: "main",
      specRef: trueSpecRef,
    });

    assert.deepStrictEqual(reconciled.spec_ref, trueSpecRef);
    assert.notDeepStrictEqual(reconciled.spec_ref, draft.spec_ref);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("reconcileHandoffRecord recomputes every artifact FileRef's sha256 from the real file, rejecting a wrong self-reported hash", async () => {
  const dir = await freshRepo();
  try {
    const commit0 = await commitFile(dir, "foo.txt", "v0\n", "initial");
    const commit1 = await commitFile(dir, "written.txt", "real content\n", "the turn's own commit");
    const trueSha = await sha256File(`${dir}/written.txt`);
    assert.notEqual(trueSha, "f".repeat(64));

    const draft = draftRecord({
      artifacts_written: [{ path: "written.txt", sha256: "f".repeat(64) }],
      repo: { branch: "main", head_before: "1".repeat(40), head_after: commit1, commits: [commit1] },
    });
    const reconciled = await reconcileHandoffRecord(dir, draft, {
      headBefore: commit0,
      branch: "main",
      specRef: { path: "PHASE_1_SPEC.md", sha256: "9".repeat(64) },
    });

    assert.equal(reconciled.artifacts_written.length, 1);
    assert.equal(reconciled.artifacts_written[0]?.sha256, trueSha);
    assert.notEqual(reconciled.artifacts_written[0]?.sha256, "f".repeat(64));
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("reconcileHandoffRecord drops (does not fail on) a declared artifact path that does not exist on disk", async () => {
  const dir = await freshRepo();
  try {
    const commit0 = await commitFile(dir, "foo.txt", "v0\n", "initial");

    const draft = draftRecord({
      artifacts_written: [{ path: "does-not-exist.txt", sha256: "f".repeat(64) }],
      repo: { branch: "main", head_before: "1".repeat(40), head_after: commit0, commits: [] },
      status: "blocked",
      halt: null,
    });
    const reconciled = await reconcileHandoffRecord(dir, draft, {
      headBefore: commit0,
      branch: "main",
      specRef: { path: "PHASE_1_SPEC.md", sha256: "9".repeat(64) },
    });

    assert.deepStrictEqual(reconciled.artifacts_written, []);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("reconcileHandoffRecord throws RelaySchemaError when ground truth contradicts the agent's own report (R3: completed with zero real commits)", async () => {
  const dir = await freshRepo();
  try {
    const commit0 = await commitFile(dir, "foo.txt", "v0\n", "initial");
    // No further commits are made -- ground truth will show zero commits between headBefore and
    // HEAD, but the agent claims status: "completed", which R3 forbids once ground truth applies.
    const draft = draftRecord({ status: "completed" });

    await assert.rejects(
      () =>
        reconcileHandoffRecord(dir, draft, {
          headBefore: commit0,
          branch: "main",
          specRef: { path: "PHASE_1_SPEC.md", sha256: "9".repeat(64) },
        }),
      (err: unknown) => {
        assert.ok(err instanceof RelaySchemaError);
        assert.equal(err.exitCode, 4);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

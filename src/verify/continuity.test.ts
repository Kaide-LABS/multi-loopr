// Implements PHASE_1_SPEC.md §1.6 -- continuity.test.ts
// Covers §8 acceptance criteria #22 and #23. All five fixtures are real git repositories created
// in the test's temp dir, built via the sanctioned `runProcess` (this file never imports
// node:child_process directly -- only src/util/exec.ts may).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { ContinuityError } from "../domain/errors.ts";
import type { HandoffRecord } from "../domain/relay.ts";
import { runProcess } from "../util/exec.ts";
import { sha256String } from "../util/hash.ts";
import { CONTINUITY_CHECKS, verifyContinuation } from "./continuity.ts";

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

async function commitFiles(dir: string, files: Readonly<Record<string, string>>, message: string): Promise<string> {
  for (const [relPath, content] of Object.entries(files)) {
    const abs = `${dir}/${relPath}`;
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    await git(dir, ["add", relPath]);
  }
  await git(dir, ["commit", "--quiet", "-m", message]);
  const head = await git(dir, ["rev-parse", "HEAD"]);
  return head.trim();
}

function baseRecord(): HandoffRecord {
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
    repo: { branch: "main", head_before: "0".repeat(40), head_after: "0".repeat(40), commits: [] },
    spec_ref: { path: "PHASE_1_SPEC.md", sha256: "1".repeat(64) },
    artifacts_read: [],
    artifacts_written: [],
    status: "completed",
    work_done: "did some work",
    next_steps: [],
    open_questions: [],
    halt: null,
  };
}

async function freshRepo(): Promise<string> {
  const dir = await mkdtemp(`${tmpdir()}/multi-loopr-continuity-test-`);
  await initRepo(dir);
  return dir;
}

test("all five CONTINUITY_CHECKS always appear, in order, on a passing run", async () => {
  const dir = await freshRepo();
  try {
    const fooA = "foo changed by A\n";
    const commit0 = await commitFiles(dir, { "foo.txt": "original foo\n" }, "initial");
    const commitA = await commitFiles(dir, { "foo.txt": fooA }, "A's turn");
    const commitB = await commitFiles(dir, { "bar.txt": "bar by B\n" }, "B's turn");

    const prev: HandoffRecord = {
      ...baseRecord(),
      repo: { branch: "main", head_before: commit0, head_after: commitA, commits: [commitA] },
      artifacts_written: [{ path: "foo.txt", sha256: sha256String(fooA) }],
    };
    const next: HandoffRecord = {
      ...baseRecord(),
      repo: { branch: "main", head_before: commitA, head_after: commitB, commits: [commitB] },
      artifacts_read: [{ path: "foo.txt", sha256: sha256String(fooA) }],
    };

    const verdict = await verifyContinuation(dir, prev, next);
    assert.equal(verdict.verdict, "CONTINUED");
    assert.deepStrictEqual(verdict.failedCheckIds, []);
    assert.deepStrictEqual(
      verdict.checks.map((c) => c.id),
      [...CONTINUITY_CHECKS],
    );
    assert.ok(verdict.checks.every((c) => c.passed));
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("REDO: the next turn reverts every path the prior turn touched", async () => {
  const dir = await freshRepo();
  try {
    const original = "original foo\n";
    const fooA = "foo changed by A\n";
    const commit0 = await commitFiles(dir, { "foo.txt": original }, "initial");
    const commitA = await commitFiles(dir, { "foo.txt": fooA }, "A's turn");
    const commitB = await commitFiles(dir, { "foo.txt": original }, "B reverts A's change");

    const prev: HandoffRecord = {
      ...baseRecord(),
      repo: { branch: "main", head_before: commit0, head_after: commitA, commits: [commitA] },
      artifacts_written: [{ path: "foo.txt", sha256: sha256String(fooA) }],
    };
    const next: HandoffRecord = {
      ...baseRecord(),
      repo: { branch: "main", head_before: commitA, head_after: commitB, commits: [commitB] },
      artifacts_read: [{ path: "foo.txt", sha256: sha256String(fooA) }],
    };

    const verdict = await verifyContinuation(dir, prev, next);
    assert.equal(verdict.verdict, "REDO");
    assert.deepStrictEqual(verdict.failedCheckIds, ["C3_NO_REVERT"]);
    assert.equal(verdict.checks.length, 5);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("PARTIAL_REVERT: the next turn reverts some but not all of the prior turn's paths", async () => {
  const dir = await freshRepo();
  try {
    const originalFoo = "original foo\n";
    const fooA = "foo changed by A\n";
    const bazA = "baz created by A\n";
    const commit0 = await commitFiles(dir, { "foo.txt": originalFoo }, "initial");
    const commitA = await commitFiles(dir, { "foo.txt": fooA, "baz.txt": bazA }, "A's turn (two files)");
    // B reverts foo.txt but leaves baz.txt exactly as A left it.
    const commitB = await commitFiles(dir, { "foo.txt": originalFoo }, "B reverts only foo.txt");

    const prev: HandoffRecord = {
      ...baseRecord(),
      repo: { branch: "main", head_before: commit0, head_after: commitA, commits: [commitA] },
      artifacts_written: [
        { path: "foo.txt", sha256: sha256String(fooA) },
        { path: "baz.txt", sha256: sha256String(bazA) },
      ],
    };
    const next: HandoffRecord = {
      ...baseRecord(),
      repo: { branch: "main", head_before: commitA, head_after: commitB, commits: [commitB] },
      artifacts_read: [
        { path: "foo.txt", sha256: sha256String(fooA) },
        { path: "baz.txt", sha256: sha256String(bazA) },
      ],
    };

    const verdict = await verifyContinuation(dir, prev, next);
    assert.equal(verdict.verdict, "PARTIAL_REVERT");
    assert.deepStrictEqual(verdict.failedCheckIds, ["C3_NO_REVERT"]);
    const c3 = verdict.checks.find((c) => c.id === "C3_NO_REVERT");
    assert.deepStrictEqual(c3?.evidence["revertedPaths"], ["foo.txt"]);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("IGNORED: the next turn never reads back an artifact the prior turn wrote (C5)", async () => {
  const dir = await freshRepo();
  try {
    const fooA = "foo changed by A\n";
    const commit0 = await commitFiles(dir, { "foo.txt": "original foo\n" }, "initial");
    const commitA = await commitFiles(dir, { "foo.txt": fooA }, "A's turn");
    const commitB = await commitFiles(dir, { "bar.txt": "bar by B\n" }, "B's turn, never reads foo.txt");

    const prev: HandoffRecord = {
      ...baseRecord(),
      repo: { branch: "main", head_before: commit0, head_after: commitA, commits: [commitA] },
      artifacts_written: [{ path: "foo.txt", sha256: sha256String(fooA) }],
    };
    const next: HandoffRecord = {
      ...baseRecord(),
      repo: { branch: "main", head_before: commitA, head_after: commitB, commits: [commitB] },
      artifacts_read: [],
    };

    const verdict = await verifyContinuation(dir, prev, next);
    assert.equal(verdict.verdict, "IGNORED");
    assert.deepStrictEqual(verdict.failedCheckIds, ["C5_ARTIFACT_ATTESTATION"]);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("IGNORED: the next turn never advances HEAD (C2)", async () => {
  const dir = await freshRepo();
  try {
    const fooA = "foo changed by A\n";
    const commit0 = await commitFiles(dir, { "foo.txt": "original foo\n" }, "initial");
    const commitA = await commitFiles(dir, { "foo.txt": fooA }, "A's turn");

    const prev: HandoffRecord = {
      ...baseRecord(),
      repo: { branch: "main", head_before: commit0, head_after: commitA, commits: [commitA] },
      artifacts_written: [{ path: "foo.txt", sha256: sha256String(fooA) }],
    };
    const next: HandoffRecord = {
      ...baseRecord(),
      repo: { branch: "main", head_before: commitA, head_after: commitA, commits: [] },
      artifacts_read: [{ path: "foo.txt", sha256: sha256String(fooA) }],
      status: "blocked",
    };

    const verdict = await verifyContinuation(dir, prev, next);
    assert.equal(verdict.verdict, "IGNORED");
    assert.deepStrictEqual(verdict.failedCheckIds, ["C2_ADVANCEMENT"]);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("DIVERGED: the next turn worked a different (or mutated) phase spec (C4), all else consistent", async () => {
  const dir = await freshRepo();
  try {
    const fooA = "foo changed by A\n";
    const commit0 = await commitFiles(dir, { "foo.txt": "original foo\n" }, "initial");
    const commitA = await commitFiles(dir, { "foo.txt": fooA }, "A's turn");
    const commitB = await commitFiles(dir, { "bar.txt": "bar by B\n" }, "B's turn");

    const prev: HandoffRecord = {
      ...baseRecord(),
      repo: { branch: "main", head_before: commit0, head_after: commitA, commits: [commitA] },
      spec_ref: { path: "PHASE_1_SPEC.md", sha256: "1".repeat(64) },
      artifacts_written: [{ path: "foo.txt", sha256: sha256String(fooA) }],
    };
    const next: HandoffRecord = {
      ...baseRecord(),
      repo: { branch: "main", head_before: commitA, head_after: commitB, commits: [commitB] },
      spec_ref: { path: "PHASE_1_SPEC.md", sha256: "2".repeat(64) },
      artifacts_read: [{ path: "foo.txt", sha256: sha256String(fooA) }],
    };

    const verdict = await verifyContinuation(dir, prev, next);
    assert.equal(verdict.verdict, "DIVERGED");
    assert.deepStrictEqual(verdict.failedCheckIds, ["C4_SPEC_CONTINUITY"]);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("a malformed/unknown git object OID throws ContinuityError with code GIT_BAD_OBJECT, not a false verdict", async () => {
  const dir = await freshRepo();
  try {
    // Only next.repo.head_after (C1's descendant argument) is bogus. C1 (isAncestor) and C3
    // (changedPaths/blobOidAt) run concurrently inside verifyContinuation; if the bogus OID were
    // instead placed in a field C3 also reads (e.g. prev.repo.head_after), C3's own git call would
    // independently fail too -- with a different, undocumented error type -- racing C1's documented
    // ContinuityError for which one wins the Promise.all rejection. Keeping prev's own
    // head_before/head_after both valid isolates the exception to C1 alone.
    const commit0 = await commitFiles(dir, { "foo.txt": "original foo\n" }, "initial");
    const commitA = await commitFiles(dir, { "foo.txt": "changed by A\n" }, "A's turn");
    const bogusOid = "f".repeat(40);

    const prev: HandoffRecord = {
      ...baseRecord(),
      repo: { branch: "main", head_before: commit0, head_after: commitA, commits: [commitA] },
    };
    const next: HandoffRecord = {
      ...baseRecord(),
      repo: { branch: "main", head_before: commitA, head_after: bogusOid, commits: [bogusOid] },
    };

    await assert.rejects(
      () => verifyContinuation(dir, prev, next),
      (err: unknown) => {
        assert.ok(err instanceof ContinuityError);
        assert.equal(err.details["code"], "GIT_BAD_OBJECT");
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("C3 passes vacuously when the prior turn changed no paths", async () => {
  const dir = await freshRepo();
  try {
    const commit0 = await commitFiles(dir, { "foo.txt": "original foo\n" }, "initial");
    // "Prior turn" that produced a commit identical in tree content to its parent is contrived,
    // but exercised here purely to drive the changedPaths()-returns-empty branch: use head_before
    // === head_after (no commits at all in the prior turn is a different, C2-covered case), so
    // instead simulate a genuine no-op amend-free "turn" by pointing head_before at the same
    // commit as head_after with an empty commits list is C2's job; here we cover the "prior turn
    // touched zero paths but still advanced" shape via an empty commit.
    await git(dir, ["commit", "--quiet", "--allow-empty", "-m", "A's no-op turn"]);
    const commitA = (await git(dir, ["rev-parse", "HEAD"])).trim();
    const commitB = await commitFiles(dir, { "bar.txt": "bar by B\n" }, "B's turn");

    const prev: HandoffRecord = {
      ...baseRecord(),
      repo: { branch: "main", head_before: commit0, head_after: commitA, commits: [commitA] },
    };
    const next: HandoffRecord = {
      ...baseRecord(),
      repo: { branch: "main", head_before: commitA, head_after: commitB, commits: [commitB] },
    };

    const verdict = await verifyContinuation(dir, prev, next);
    const c3 = verdict.checks.find((c) => c.id === "C3_NO_REVERT");
    assert.equal(c3?.passed, true);
    assert.equal(c3?.evidence["reason"], "vacuous");
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

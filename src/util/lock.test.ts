// Implements PHASE_1_SPEC.md §1.6 -- lock.test.ts
// Covers §8 acceptance criterion #25 and PHASE_1_SPEC.md §7 FM6's reviewer checklist.
//
// Never imports node:child_process (PHASE_1_SPEC.md §8 acceptance check #8 -- exactly one file,
// src/util/exec.ts, may). A "dead" pid for the stale-reclaim tests is simulated with an
// implausibly large pid rather than by spawning and killing a real process.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { InternalError, LockHeldError } from "../domain/errors.ts";
import { acquireRunLock, isProcessAlive, readRunLock, releaseRunLock } from "./lock.ts";
import { multiLooprDir, runLockPath } from "./paths.ts";

const IMPLAUSIBLE_DEAD_PID = 2_147_483_647;

async function freshRepoDir(): Promise<string> {
  return mkdtemp(`${tmpdir()}/multi-loopr-lock-test-`);
}

test("isProcessAlive is true for the current process and false for an implausible pid", () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(isProcessAlive(IMPLAUSIBLE_DEAD_PID), false);
});

test("acquireRunLock creates a readable lock, then releaseRunLock removes it", async () => {
  const dir = await freshRepoDir();
  try {
    const runId = randomUUID();
    const info = await acquireRunLock(dir, runId);
    assert.equal(info.runId, runId);
    assert.equal(info.pid, process.pid);

    const read = await readRunLock(dir);
    assert.deepStrictEqual(read, info);

    await releaseRunLock(dir, runId);
    assert.equal(await readRunLock(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("a second acquire in the same directory while the holder is alive throws LockHeldError (exit 8)", async () => {
  const dir = await freshRepoDir();
  try {
    const first = randomUUID();
    await acquireRunLock(dir, first);

    const second = randomUUID();
    await assert.rejects(
      () => acquireRunLock(dir, second),
      (err: unknown) => {
        assert.ok(err instanceof LockHeldError);
        assert.equal(err.exitCode, 8);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("a lock whose pid is dead is reclaimed automatically", async () => {
  const dir = await freshRepoDir();
  try {
    await mkdir(multiLooprDir(dir), { recursive: true });
    const staleInfo = {
      pid: IMPLAUSIBLE_DEAD_PID,
      runId: randomUUID(),
      host: "some-other-host",
      acquiredAt: new Date(0).toISOString(),
    };
    await writeFile(runLockPath(dir), JSON.stringify(staleInfo, null, 2) + "\n", "utf8");

    const newRunId = randomUUID();
    const info = await acquireRunLock(dir, newRunId);
    assert.equal(info.runId, newRunId);
    assert.equal(info.pid, process.pid);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("a corrupt lock file is treated as stale and reclaimed", async () => {
  const dir = await freshRepoDir();
  try {
    await mkdir(multiLooprDir(dir), { recursive: true });
    await writeFile(runLockPath(dir), "{ this is not valid json", "utf8");

    const newRunId = randomUUID();
    const info = await acquireRunLock(dir, newRunId);
    assert.equal(info.runId, newRunId);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("after a stale reclaim, a live second holder still loses the retry (LockHeldError)", async () => {
  const dir = await freshRepoDir();
  try {
    await mkdir(multiLooprDir(dir), { recursive: true });
    const staleInfo = {
      pid: IMPLAUSIBLE_DEAD_PID,
      runId: randomUUID(),
      host: "some-other-host",
      acquiredAt: new Date(0).toISOString(),
    };
    await writeFile(runLockPath(dir), JSON.stringify(staleInfo, null, 2) + "\n", "utf8");

    // First acquire reclaims the stale lock and holds it (its pid is now the live current process).
    const holder = randomUUID();
    await acquireRunLock(dir, holder);

    // A second acquire now contends with a genuinely live holder and must fail.
    await assert.rejects(() => acquireRunLock(dir, randomUUID()), LockHeldError);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("releasing another run's lock throws InternalError and leaves the lock in place", async () => {
  const dir = await freshRepoDir();
  try {
    const owner = randomUUID();
    await acquireRunLock(dir, owner);

    await assert.rejects(() => releaseRunLock(dir, randomUUID()), InternalError);
    const stillThere = await readRunLock(dir);
    assert.equal(stillThere?.runId, owner);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("releasing an already-absent lock is a no-op, not an error", async () => {
  const dir = await freshRepoDir();
  try {
    await assert.doesNotReject(() => releaseRunLock(dir, randomUUID()));
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("readRunLock returns null for a directory with no lock at all", async () => {
  const dir = await freshRepoDir();
  try {
    assert.equal(await readRunLock(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("acquireRunLock does not use a check-then-act race (existsSync-style pattern)", async () => {
  // Behavioural proxy for the "wx atomic open, never existsSync-then-write" requirement: two
  // concurrent acquire calls in the same directory must never both succeed.
  const dir = await freshRepoDir();
  try {
    const results = await Promise.allSettled([acquireRunLock(dir, randomUUID()), acquireRunLock(dir, randomUUID())]);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    assert.equal(succeeded.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("the lock file on disk matches the LockInfo shape", async () => {
  const dir = await freshRepoDir();
  try {
    const runId = randomUUID();
    await acquireRunLock(dir, runId);
    const raw = await readFile(runLockPath(dir), "utf8");
    const parsed: unknown = JSON.parse(raw);
    assert.deepStrictEqual(Object.keys(parsed as Record<string, unknown>).sort(), [
      "acquiredAt",
      "host",
      "pid",
      "runId",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

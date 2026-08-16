// Implements PHASE_1_SPEC.md §6.4 -- FM6 [DET]
//
// The exclusive on-disk run lock. V1's handoff model is strictly sequential, one agent active at
// a time (PRD §3 item 8); this primitive enforces that rather than assuming it. Acquisition uses
// `fs.open(path, "wx")`, an atomic filesystem primitive -- an `existsSync` check followed by a
// write would be a check-then-act race and is forbidden.

import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { InternalError, LockHeldError } from "../domain/errors.ts";
import { multiLooprDir, runLockPath } from "./paths.ts";

/** The contents of a held run lock. */
export interface LockInfo {
  readonly pid: number;
  readonly runId: string;
  readonly host: string;
  readonly acquiredAt: string;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function parseLockInfo(raw: string): LockInfo | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) {
      return null;
    }
    const d = data as Record<string, unknown>;
    if (
      typeof d["pid"] === "number" &&
      typeof d["runId"] === "string" &&
      typeof d["host"] === "string" &&
      typeof d["acquiredAt"] === "string"
    ) {
      return { pid: d["pid"], runId: d["runId"], host: d["host"], acquiredAt: d["acquiredAt"] };
    }
    return null;
  } catch {
    return null;
  }
}

/** `wx`-creates the lock file with `info`'s contents. Returns `"exists"` on `EEXIST`. */
async function tryCreateLockFile(lockPath: string, info: LockInfo): Promise<"created" | "exists"> {
  let handle;
  try {
    // [DET] atomic exclusive create -- an existsSync-then-write race is forbidden.
    handle = await open(lockPath, "wx");
  } catch (err) {
    if (isNodeError(err) && err.code === "EEXIST") {
      return "exists";
    }
    throw new InternalError(
      `Failed to create lock file ${lockPath}: ${err instanceof Error ? err.message : String(err)}`,
      { lockPath },
    );
  }
  try {
    await handle.writeFile(JSON.stringify(info, null, 2) + "\n", "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return "created";
}

/**
 * Inspects the existing lock at `lockPath` (already known to exist via a prior `EEXIST`). Throws
 * {@link LockHeldError} if its pid is alive; otherwise unlinks it (stale or corrupt) so the caller
 * can retry the create exactly once.
 */
async function reclaimIfStaleOrThrow(lockPath: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      // Disappeared between the EEXIST and this read -- nothing to reclaim; retry the create.
      return;
    }
    throw new InternalError(
      `Failed to read lock file ${lockPath}: ${err instanceof Error ? err.message : String(err)}`,
      { lockPath },
    );
  }

  const parsed = parseLockInfo(raw);
  if (parsed === null) {
    process.stderr.write(`multi-loopr: lock file ${lockPath} is corrupt; treating as stale.\n`);
  } else if (isProcessAlive(parsed.pid)) {
    throw new LockHeldError(
      `Run lock at ${lockPath} is held by pid ${parsed.pid} (acquired at ${parsed.acquiredAt}).`,
      { holderPid: parsed.pid, acquiredAt: parsed.acquiredAt, lockPath },
    );
  }

  try {
    await unlink(lockPath);
  } catch (err) {
    if (!(isNodeError(err) && err.code === "ENOENT")) {
      throw new InternalError(
        `Failed to unlink stale lock ${lockPath}: ${err instanceof Error ? err.message : String(err)}`,
        { lockPath },
      );
    }
  }
}

/**
 * Acquires the exclusive run lock for `repoDir`. On contention with a live holder, throws
 * {@link LockHeldError} naming the holding pid and `acquiredAt`. A lock whose pid is dead (or
 * whose contents are corrupt) is reclaimed automatically, with exactly one retry; a second
 * `EEXIST` after reclaim means another process won the race and also throws {@link LockHeldError}.
 */
export async function acquireRunLock(repoDir: string, runId: string): Promise<LockInfo> {
  await mkdir(multiLooprDir(repoDir), { recursive: true });
  const lockPath = runLockPath(repoDir);
  const info: LockInfo = {
    pid: process.pid,
    runId,
    host: hostname(),
    acquiredAt: new Date().toISOString(),
  };

  if ((await tryCreateLockFile(lockPath, info)) === "created") {
    return info;
  }

  await reclaimIfStaleOrThrow(lockPath);

  if ((await tryCreateLockFile(lockPath, info)) === "created") {
    return info;
  }
  throw new LockHeldError(
    `Run lock at ${lockPath} was re-acquired by another process during reclaim.`,
    { lockPath },
  );
}

/** Reads the current lock, if any. Returns `null` when absent or unparseable -- never throws for those cases. */
export async function readRunLock(repoDir: string): Promise<LockInfo | null> {
  const lockPath = runLockPath(repoDir);
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return null;
    }
    throw new InternalError(
      `Failed to read lock file ${lockPath}: ${err instanceof Error ? err.message : String(err)}`,
      { lockPath },
    );
  }
  return parseLockInfo(raw);
}

/**
 * Releases the run lock, but only if it belongs to `runId`. Releasing another run's lock throws
 * {@link InternalError}. Unlinking an already-absent (or unparseable) lock is a no-op, not an error.
 */
export async function releaseRunLock(repoDir: string, runId: string): Promise<void> {
  const lockPath = runLockPath(repoDir);
  const existing = await readRunLock(repoDir);
  if (existing === null) {
    return;
  }
  if (existing.runId !== runId) {
    throw new InternalError(
      `Refusing to release run lock at ${lockPath}: it belongs to run ${existing.runId}, not ${runId}.`,
      { lockPath, ownerRunId: existing.runId, requestedRunId: runId },
    );
  }
  try {
    await unlink(lockPath);
  } catch (err) {
    if (!(isNodeError(err) && err.code === "ENOENT")) {
      throw new InternalError(
        `Failed to unlink lock file ${lockPath}: ${err instanceof Error ? err.message : String(err)}`,
        { lockPath },
      );
    }
  }
}

/**
 * True iff a process with `pid` currently exists, using `process.kill(pid, 0)`'s
 * throws-or-not-and-error-code contract: no throw or `EPERM` (owned by another user) => alive;
 * `ESRCH` => dead.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (isNodeError(err) && err.code === "EPERM") {
      return true;
    }
    return false;
  }
}

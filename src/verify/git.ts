// Implements PHASE_1_SPEC.md §6.5 -- [DET]
//
// Thin, typed wrappers over the exact git plumbing commands the deterministic verifiers need. No
// function in this module parses porcelain output; all use plumbing or explicitly stable formats
// (`-z`, `--format=%B`), because porcelain output is documented by git as subject to change.

import { ContinuityError, InternalError } from "../domain/errors.ts";
import { runProcess } from "../util/exec.ts";

const GIT_TIMEOUT_MS = 30_000;

async function git(repoDir: string, args: readonly string[]) {
  return runProcess({ command: "git", args, cwd: repoDir, timeoutMs: GIT_TIMEOUT_MS });
}

/** `git --version`'s raw stdout, trimmed, or `null` if git is not found or fails to run. */
export async function gitVersion(repoDir: string): Promise<string | null> {
  const result = await git(repoDir, ["--version"]);
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.trim();
}

/** Resolves `rev` (e.g. `HEAD`, a short SHA, a ref name) to its full object id. Throws on failure. */
export async function revParse(repoDir: string, rev: string): Promise<string> {
  const result = await git(repoDir, ["rev-parse", rev]);
  if (result.exitCode !== 0) {
    throw new InternalError(`git rev-parse ${rev} failed in ${repoDir}: ${result.stderr.trim()}`, {
      repoDir,
      rev,
      exitCode: result.exitCode,
      stderr: result.stderr,
    });
  }
  return result.stdout.trim();
}

/** `git rev-parse --abbrev-ref HEAD`. Returns the literal string `HEAD` in a detached-HEAD state. */
export async function currentBranch(repoDir: string): Promise<string> {
  const result = await git(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (result.exitCode !== 0) {
    throw new InternalError(`git rev-parse --abbrev-ref HEAD failed in ${repoDir}: ${result.stderr.trim()}`, {
      repoDir,
      exitCode: result.exitCode,
      stderr: result.stderr,
    });
  }
  return result.stdout.trim();
}

/**
 * `git merge-base --is-ancestor <ancestor> <descendant>`. Exit `0` -> `true`; exit `1` -> `false`;
 * exit `128` (a malformed/unknown object) -> throws {@link ContinuityError} with
 * `code: "GIT_BAD_OBJECT"` -- a bad object must never be silently read as "not an ancestor".
 */
export async function isAncestor(repoDir: string, ancestor: string, descendant: string): Promise<boolean> {
  const result = await git(repoDir, ["merge-base", "--is-ancestor", ancestor, descendant]);
  if (result.exitCode === 0) {
    return true;
  }
  if (result.exitCode === 1) {
    return false;
  }
  throw new ContinuityError(
    `git merge-base --is-ancestor ${ancestor} ${descendant} returned exit ${String(result.exitCode)} ` +
      `(bad object) in ${repoDir}: ${result.stderr.trim()}`,
    { code: "GIT_BAD_OBJECT", repoDir, ancestor, descendant, exitCode: result.exitCode, stderr: result.stderr },
  );
}

/**
 * `git diff --name-only -z <fromOid>..<toOid>`. `-z` is mandatory: paths with spaces or
 * non-ASCII characters break the newline-separated form. Splits on `\0` and drops the trailing
 * empty element.
 */
export async function changedPaths(repoDir: string, fromOid: string, toOid: string): Promise<readonly string[]> {
  const result = await git(repoDir, ["diff", "--name-only", "-z", `${fromOid}..${toOid}`]);
  if (result.exitCode !== 0) {
    throw new InternalError(
      `git diff --name-only -z ${fromOid}..${toOid} failed in ${repoDir}: ${result.stderr.trim()}`,
      { repoDir, fromOid, toOid, exitCode: result.exitCode, stderr: result.stderr },
    );
  }
  const parts = result.stdout.split("\0");
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

/**
 * `git rev-parse <oid>:<repoRelPath>`. Exit `0` -> the blob OID (trimmed); non-zero -> `null`
 * (the path did not exist at that commit).
 */
export async function blobOidAt(repoDir: string, oid: string, repoRelPath: string): Promise<string | null> {
  const result = await git(repoDir, ["rev-parse", `${oid}:${repoRelPath}`]);
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.trim();
}

/**
 * `git rev-list --reverse <fromOid>..<toOid>`. Oldest-first list of commit ids; empty output
 * yields an empty array.
 */
export async function commitsBetween(repoDir: string, fromOid: string, toOid: string): Promise<readonly string[]> {
  const result = await git(repoDir, ["rev-list", "--reverse", `${fromOid}..${toOid}`]);
  if (result.exitCode !== 0) {
    throw new InternalError(
      `git rev-list --reverse ${fromOid}..${toOid} failed in ${repoDir}: ${result.stderr.trim()}`,
      { repoDir, fromOid, toOid, exitCode: result.exitCode, stderr: result.stderr },
    );
  }
  const trimmed = result.stdout.trim();
  return trimmed === "" ? [] : trimmed.split("\n");
}

/**
 * `git diff <fromOid>..<toOid>` -- the full unified diff body (no `--name-only`), unlike
 * {@link changedPaths}, which intentionally returns only names. Exit non-zero -> {@link InternalError},
 * matching this file's existing wrapper convention exactly. Implements PHASE_3_SPEC.md §1.6.
 */
export async function diffText(repoDir: string, fromOid: string, toOid: string): Promise<string> {
  const result = await git(repoDir, ["diff", `${fromOid}..${toOid}`]);
  if (result.exitCode !== 0) {
    throw new InternalError(`git diff ${fromOid}..${toOid} failed in ${repoDir}: ${result.stderr.trim()}`, {
      repoDir,
      fromOid,
      toOid,
      exitCode: result.exitCode,
      stderr: result.stderr,
    });
  }
  return result.stdout;
}

/**
 * `git show -s --format=%B <oid>`, called once per OID (never batched with a separator, which
 * could appear inside a message body). Returns each commit's full raw message body, in the same
 * order as `oids`.
 */
export async function commitMessages(repoDir: string, oids: readonly string[]): Promise<readonly string[]> {
  const messages: string[] = [];
  for (const oid of oids) {
    const result = await git(repoDir, ["show", "-s", "--format=%B", oid]);
    if (result.exitCode !== 0) {
      throw new InternalError(`git show -s --format=%B ${oid} failed in ${repoDir}: ${result.stderr.trim()}`, {
        repoDir,
        oid,
        exitCode: result.exitCode,
        stderr: result.stderr,
      });
    }
    messages.push(result.stdout);
  }
  return messages;
}

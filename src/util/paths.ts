// Implements PHASE_1_SPEC.md §6.3
//
// Repo-relative POSIX path helpers and the `.multi-loopr/` on-disk layout resolver. This is a
// Windows-hosted project: `toRepoRelPosix` converts `\` to `/` unconditionally rather than
// splitting on `node:path`'s host-specific `sep`, so its output does not depend on which platform
// it runs on.
//
// `isSafeRepoRelPath` implements exactly the three `RepoRelPath` refinements from
// `src/domain/relay.ts` §3.4 (not absolute, no backslash separators, no `..` traversal segment)
// and is what that schema's single `.refine()` calls, so the safety rule is defined in exactly
// one place rather than duplicated between the schema and the path layer (PHASE_1_SPEC.md §6.3).

import { relative } from "node:path";

/**
 * Converts an absolute filesystem path to a POSIX-separated, repo-relative path. Always replaces
 * `\` with `/` regardless of host platform.
 */
export function toRepoRelPosix(repoDir: string, absPath: string): string {
  const rel = relative(repoDir, absPath);
  return rel.replace(/\\/g, "/");
}

/**
 * True iff `p` is a safe repo-relative path: not absolute (POSIX `/` or Windows drive-letter
 * form), contains no backslash separators, and has no `..` traversal segment. This is the single
 * source of truth for repo-relative path safety; `src/domain/relay.ts`'s `RepoRelPath` schema
 * calls this function rather than re-implementing the check.
 */
export function isSafeRepoRelPath(p: string): boolean {
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) {
    return false;
  }
  if (p.includes("\\")) {
    return false;
  }
  if (p.split("/").includes("..")) {
    return false;
  }
  return true;
}

/** The `.multi-loopr/` directory multi-loopr owns within a repo. */
export function multiLooprDir(repoDir: string): string {
  return `${repoDir}/.multi-loopr`;
}

/** The exclusive run-lock file path (`src/util/lock.ts`, PRD §9 FM6). */
export function runLockPath(repoDir: string): string {
  return `${multiLooprDir(repoDir)}/run.lock`;
}

/**
 * Resolves a repo-relative POSIX path (already known-safe, i.e. it has passed
 * `isSafeRepoRelPath`/`RepoRelPath`) to an absolute path. Straight concatenation is correct and
 * sufficient here (not `node:path.join`/`resolve`) precisely because the input is already
 * constrained: no leading `/`, no drive letter, no `..` segment, POSIX separators only -- the same
 * safety guarantee every other path-builder in this file already relies on. Implements
 * PHASE_3_SPEC.md §1.5.
 */
export function repoRelToAbs(repoDir: string, repoRelPath: string): string {
  return `${repoDir}/${repoRelPath}`;
}

/**
 * The path a given turn's `HandoffRecord` is written to:
 * `<repoDir>/.multi-loopr/runs/<runId>/handoff/<phase>/<turnIndex>-<role>-<provider>.json`, with
 * `turnIndex` zero-padded to 3 digits so lexical order equals numeric order.
 */
export function handoffPath(
  repoDir: string,
  runId: string,
  phase: number,
  turnIndex: number,
  role: string,
  provider: string,
): string {
  const paddedTurnIndex = String(turnIndex).padStart(3, "0");
  return `${multiLooprDir(repoDir)}/runs/${runId}/handoff/${phase}/${paddedTurnIndex}-${role}-${provider}.json`;
}

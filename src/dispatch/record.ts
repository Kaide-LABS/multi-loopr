// Implements PHASE_3_SPEC.md §6.3 -- [DET, DECISION Phase 3, PRD §7 I2]
//
// The central mechanism that keeps `HandoffRecord`'s correctness-critical fields out of the
// "agent's say-so" path I2 forbids, while still letting the agent be the source of the fields only
// it can know (the summary text, which paths it touched). A "compare and reject on mismatch"
// design was considered and rejected: it would require the agent's prompt instructions to get git
// plumbing and hashing exactly right merely to avoid a spurious rejection, adding fragility with
// no security benefit -- replacing outright is simpler, strictly more robust to an agent's
// git-plumbing mistakes, and is what §6.2 item 4 already tells the agent to expect.

import { z } from "zod";
import type { FileRef, HandoffRecord } from "../domain/relay.ts";
import { HandoffRecord as HandoffRecordSchema } from "../domain/relay.ts";
import { RelaySchemaError } from "../domain/errors.ts";
import { commitsBetween, currentBranch, revParse } from "../verify/git.ts";
import { sha256File } from "../util/hash.ts";
import { repoRelToAbs } from "../util/paths.ts";

/** The independently-computed ground truth {@link reconcileHandoffRecord} reconciles a draft against. */
export interface RecordGroundTruth {
  readonly headBefore: string;
  readonly branch: string;
  readonly specRef: FileRef;
}

/**
 * [DET] `{ headBefore: await revParse(repoDir, "HEAD"), branch: await currentBranch(repoDir) }` --
 * called immediately before spawning a turn's process, so `headBefore` is genuinely "immediately
 * before the turn started." Implements PHASE_3_SPEC.md §6.3.
 */
export async function captureGroundTruthBefore(repoDir: string): Promise<{ headBefore: string; branch: string }> {
  const headBefore = await revParse(repoDir, "HEAD");
  const branch = await currentBranch(repoDir);
  return { headBefore, branch };
}

function isEnoentError(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Recomputes every `FileRef`'s SHA-256 from the real file on disk, dropping (not failing) any
 * entry whose declared path does not actually exist -- an agent may over-report. A non-ENOENT
 * read failure (e.g. a permissions error) is not swallowed as a missing file; it propagates, since
 * that is a genuinely unexpected condition the spec's "does not exist" carve-out does not cover.
 */
async function reconcileFileRefs(repoDir: string, refs: readonly FileRef[]): Promise<readonly FileRef[]> {
  const out: FileRef[] = [];
  for (const ref of refs) {
    const absPath = repoRelToAbs(repoDir, ref.path);
    let sha256: string;
    try {
      sha256 = await sha256File(absPath);
    } catch (err) {
      if (isEnoentError(err)) {
        continue;
      }
      throw err;
    }
    out.push({ path: ref.path, sha256 });
  }
  return out;
}

/**
 * [DET, DECISION Phase 3, PRD §7 I2] Overwrites the agent-authored draft's `repo`, `spec_ref`, and
 * every artifact `FileRef`'s `sha256` with multi-loopr's own independently-computed ground truth,
 * discarding the agent's own claims entirely -- they were never trustworthy ground truth in the
 * first place. Re-validates the fully reconciled object: this can fail even though `draft` itself
 * parsed successfully (e.g. the agent claimed `status: "completed"` but ground truth shows zero
 * real commits, violating R3). On failure, throws {@link RelaySchemaError} naming this as a
 * reconciliation inconsistency rather than a raw schema defect. Implements PHASE_3_SPEC.md §6.3.
 */
export async function reconcileHandoffRecord(
  repoDir: string,
  draft: HandoffRecord,
  ground: RecordGroundTruth,
): Promise<HandoffRecord> {
  const headAfter = await revParse(repoDir, "HEAD");
  const commits = await commitsBetween(repoDir, ground.headBefore, headAfter);

  const artifactsRead = await reconcileFileRefs(repoDir, draft.artifacts_read);
  const artifactsWritten = await reconcileFileRefs(repoDir, draft.artifacts_written);

  const reconciled = {
    ...draft,
    repo: { branch: ground.branch, head_before: ground.headBefore, head_after: headAfter, commits: [...commits] },
    spec_ref: { path: ground.specRef.path, sha256: ground.specRef.sha256 },
    artifacts_read: artifactsRead,
    artifacts_written: artifactsWritten,
  };

  const result = HandoffRecordSchema.safeParse(reconciled);
  if (!result.success) {
    throw new RelaySchemaError(
      `HandoffRecord failed re-validation after ground-truth reconciliation (this is a ` +
        `reconciliation inconsistency -- ground truth contradicts the agent's own report -- not a ` +
        `raw schema defect): ${z.prettifyError(result.error)}`,
      { stage: "reconciliation" },
    );
  }
  return result.data;
}

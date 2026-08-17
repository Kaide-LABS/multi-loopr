// Implements PHASE_3_SPEC.md §6.4 -- [DET]
//
// `runTurn()` -- one turn end to end: build invocation, merge env, spawn, interpret, read +
// reconcile the on-disk record, assert commit neutrality, persist the reconciled record.

import type { RawInvocationResult, TurnOutcome, TurnRequest } from "../domain/run.ts";
import type { HandoffRecord } from "../domain/relay.ts";
import { readHandoffRecord, writeHandoffRecord } from "../domain/relay.ts";
import { IsolationLeakError, RelaySchemaError } from "../domain/errors.ts";
import type { ProviderAdapter } from "../ports/provider-adapter.ts";
import { runProcess } from "../util/exec.ts";
import { MULTI_LOOPR_DIR_NAME, handoffPath } from "../util/paths.ts";
import { assertNeutralCommits } from "../verify/commits.ts";
import { stageAllAndCommit, workingTreeChanges } from "../verify/git.ts";
import { assertLooprArtifactsReferenced, assertNextPhaseSpecProduced } from "./artifacts.ts";
import { captureGroundTruthBefore, reconcileHandoffRecord } from "./record.ts";

/** Dependencies {@link runTurn} needs beyond the pure `TurnRequest`. */
export interface RunTurnDeps {
  readonly adapter: ProviderAdapter;
  /** Defaults to {@link runProcess}; injectable so tests never spawn a real provider CLI. */
  readonly runProcessFn?: typeof runProcess;
}

/** The result of {@link runTurn}. */
export interface RunTurnResult {
  readonly outcome: TurnOutcome;
  /** The reconciled record; non-null iff `outcome.ok` and reconciliation succeeded. */
  readonly record: HandoffRecord | null;
}

/**
 * `process.env` with every `undefined`-valued key dropped -- required to satisfy
 * `RunProcessOptions.env`'s `Readonly<Record<string, string>>` type under
 * `exactOptionalPropertyTypes` (`process.env`'s own type is `Record<string, string | undefined>`).
 */
function filteredProcessEnv(): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * The directories {@link captureTurnLeftovers} leaves out of both its change scan and its commit.
 *
 * Only `.multi-loopr/` is excluded, and it is load-bearing rather than cosmetic. multi-loopr's own
 * run bookkeeping lives there, and the agent's draft `HandoffRecord` is written there *during* the
 * turn -- so in any target repo that does not itself gitignore `.multi-loopr/`, that draft is an
 * untracked file at the moment step 5.5 runs. Including it would make "the working tree has
 * changes" true after literally every turn, so the fallback would fire even for a turn that did no
 * real work, and R3 (`status === "completed"` implies `commits.length >= 1`) would become trivially
 * satisfiable by a turn that produced nothing -- destroying the exact property R3 exists to check.
 * Excluding it keeps the "genuinely no changes -> no commit" case intact, and also avoids
 * committing an un-reconciled draft record that step 9 is about to overwrite anyway.
 */
const LEFTOVER_SCAN_EXCLUDES: readonly string[] = [MULTI_LOOPR_DIR_NAME];

/**
 * [DET] The fallback commit's message, composed here and only here -- from `req`'s own already-typed
 * fields plus fixed literal prose. No part of it ever passes through a provider, a model, or the
 * agent's own `HandoffRecord`, so it cannot acquire an AI-attribution trailer by any path: its
 * neutrality under `assertNeutralCommits()` (PRD §7 I4) is a property of this function's source, not
 * a runtime hope. The subject follows this repo's own `chore: ... (multi-loopr)` convention for
 * multi-loopr-authored commits, deliberately distinct from the `feat: Phase N implementation
 * (multi-loopr)` shape a dispatched executor turn uses for its own work -- a reader scanning
 * `git log` can tell at a glance which commits the harness made rather than an agent.
 */
export function buildFallbackCommitMessage(req: TurnRequest): string {
  return [
    "chore: capture a dispatched turn's uncommitted working-tree changes (multi-loopr)",
    "",
    "The dispatched agent finished with real changes still sitting in the working tree and no",
    "commit of its own. multi-loopr staged and committed them on the agent's behalf so the turn's",
    "work is preserved and the branch history reflects it.",
    "",
    "This is the fallback path: an agent is instructed to commit its own work, and normally does.",
    "Some sandboxed provider environments deny write access to .git and genuinely cannot.",
    "",
    `run-id: ${req.runId}`,
    `phase: ${String(req.phase)}`,
    `turn-index: ${String(req.turnIndex)}`,
    `provider: ${req.provider}`,
    `archetype: ${req.archetype}`,
    "",
  ].join("\n");
}

/**
 * [DET, DECISION] Commits whatever the turn left uncommitted, and returns the new commit's OID, or
 * `null` when the working tree was genuinely clean and nothing was committed.
 *
 * Why this exists: multi-loopr requires the dispatched agent to commit its own work, and Claude Code
 * does. Codex CLI on Windows cannot -- `CodexCliAdapter.buildInvocation()` emits `--sandbox
 * workspace-write` unconditionally (PRD §9 FM7, a deliberate reviewed decision), and that sandbox
 * treats `.git/` as read-only on Windows. Confirmed empirically against a real repo with codex-cli
 * 0.147.0: every `git` write failed with `fatal: Unable to create '<repo>/.git/index.lock':
 * Permission denied`, and the agent itself reported "The commit did not succeed". Adding `.git` to
 * `sandbox_workspace_write.writable_roots` was tested and did not change the outcome, so it is a
 * hard sandbox restriction, not a config gap. `--sandbox danger-full-access` would fix it by
 * reversing FM7's security decision for one provider on one platform, and was rejected.
 *
 * This runs **unconditionally**, before the agent's `HandoffRecord` is even read, and therefore
 * regardless of what `status` that record eventually claims. Both properties are deliberate: real
 * work in the working tree must never be silently dropped just because the agent reported
 * `"blocked"`, and running before the read means the fallback does not depend on the record being
 * valid, parseable, or present at all.
 *
 * A failure here propagates unmodified rather than being folded into `TurnOutcome`. The realistic
 * causes are operator-environment defects (no `user.email`, a rejecting pre-commit hook), and
 * silently continuing would leave the turn to fail R3 later with a misleading diagnosis.
 */
async function captureTurnLeftovers(req: TurnRequest): Promise<string | null> {
  const changes = await workingTreeChanges(req.repoDir, LEFTOVER_SCAN_EXCLUDES);
  if (!changes.hasAny) {
    return null;
  }
  return stageAllAndCommit(req.repoDir, buildFallbackCommitMessage(req), LEFTOVER_SCAN_EXCLUDES);
}

/**
 * [DET] One turn end to end, in a fixed order:
 * 1. Capture ground truth (HEAD/branch) immediately before spawning.
 * 2. Build the invocation via the adapter (pure).
 * 3. [DECISION Phase 3] Merge env as `{ ...process.env-with-undefined-dropped, ...invocation.env }`
 *    -- never `invocation.env` alone (would silently strip the operator's PATH/credentials).
 * 4. Spawn via `deps.runProcessFn ?? runProcess`.
 * 5. Interpret the raw result. A failed outcome returns immediately -- no attempt to read an
 *    on-disk record when the adapter itself already reports failure.
 * 5.5. [DECISION] `captureTurnLeftovers()` -- if the working tree still carries uncommitted changes
 *    (unstaged edits to tracked files, a staged-but-uncommitted index, *or* new untracked files;
 *    all three, since an agent's new file is untracked until something stages it), stage and commit
 *    them under a message multi-loopr composes itself. A genuinely clean tree commits nothing, so a
 *    turn that did no real work still correctly reconciles to `commits.length === 0` at step 7.
 *    Runs unconditionally, whatever `status` the agent's record will turn out to claim, and runs
 *    *before* step 6 reads that record so it does not depend on the record being valid at all. It
 *    must also precede step 7: `reconcileHandoffRecord()` re-reads HEAD at call time and derives
 *    `commits` from `headBefore..HEAD` itself, so putting the fallback commit here -- and only here
 *    -- is what makes it visible to reconciliation without changing one line of `record.ts`.
 * 6. Read the on-disk `HandoffRecord`, as a **draft** (`{ draft: true }`) -- every rule except R3,
 *    which `src/domain/relay.ts` defers to step 7 because `repo.commits` is ground truth the agent
 *    never supplies and reconciliation always overwrites. Without that, an agent whose sandbox
 *    could not commit and which therefore honestly wrote `commits: []` would be refused *here*,
 *    before step 7 could ever see step 5.5's fallback commit -- observed directly in a real
 *    codex-cli turn, whose draft read exactly `"status": "completed"` with `"commits": []`. A
 *    `RelaySchemaError`/`IsolationLeakError` here is caught and converted into this step's own
 *    modelled failure (not reinterpreted -- the original error object is preserved as
 *    `outcome.failure`); any other thrown error (e.g. the handoff file is genuinely missing)
 *    propagates unmodified, an unexpected condition outside this step's modelled failure set.
 * 7. Reconcile against ground truth (may itself throw `RelaySchemaError`, handled identically).
 * 7.5. [DECISION Phase 4] `assertLooprArtifactsReferenced()` against the reconciled record, for
 *    **every** turn (executor and reviewer alike) -- a thrown `LooprArtifactBypassError` is not
 *    caught here; it propagates unmodified, matching step 8's own uncaught-throw contract.
 * 7.6. [DECISION Phase 4] `assertNextPhaseSpecProduced()`, only when `req.expectedArtifactPath !==
 *    null` (a no-op for every executor turn; runs only for the reviewer turn). Same uncaught-throw
 *    contract.
 * 8. If any real commits were recorded, assert commit neutrality -- a thrown
 *    `BoundaryViolationError` propagates unmodified; I4 is a hard invariant, never retried. Runs
 *    only once both new Phase 4 guards have already passed, and covers step 5.5's own fallback
 *    commit as well as every agent-authored one: the fallback is checked by the same mechanism as
 *    everything else rather than being trusted for having been machine-composed.
 * 9. Persist the reconciled record at the same path, overwriting the agent's own draft. Both new
 *    guards run before this step, so a bypassed or non-produced-artifact turn's record is never
 *    persisted to `.multi-loopr/runs/**` -- only a turn that cleared every hard invariant ever
 *    reaches disk.
 * Implements PHASE_3_SPEC.md §6.4, PHASE_4_SPEC.md §6.3.
 */
export async function runTurn(req: TurnRequest, deps: RunTurnDeps): Promise<RunTurnResult> {
  const ground = await captureGroundTruthBefore(req.repoDir);
  const invocation = deps.adapter.buildInvocation(req);
  const env = { ...filteredProcessEnv(), ...invocation.env };
  const spawn = deps.runProcessFn ?? runProcess;

  const raw: RawInvocationResult = await spawn({
    command: invocation.command,
    args: invocation.args,
    cwd: invocation.cwd,
    env,
    stdin: invocation.stdin,
    timeoutMs: req.timeoutMs,
  });

  const outcome = deps.adapter.interpretResult(raw);
  if (!outcome.ok) {
    return { outcome, record: null };
  }

  await captureTurnLeftovers(req);

  const path = handoffPath(req.repoDir, req.runId, req.phase, req.turnIndex, req.archetype, req.provider);

  let draft: HandoffRecord;
  try {
    draft = await readHandoffRecord(path, { draft: true });
  } catch (err) {
    if (err instanceof RelaySchemaError || err instanceof IsolationLeakError) {
      return { outcome: { ok: false, record: null, failure: err }, record: null };
    }
    throw err;
  }

  let reconciled: HandoffRecord;
  try {
    reconciled = await reconcileHandoffRecord(req.repoDir, draft, {
      headBefore: ground.headBefore,
      branch: ground.branch,
      specRef: req.specRef,
    });
  } catch (err) {
    if (err instanceof RelaySchemaError) {
      return { outcome: { ok: false, record: null, failure: err }, record: null };
    }
    throw err;
  }

  assertLooprArtifactsReferenced(reconciled, {
    babyPrdPath: req.babyPrdPath,
    contextPath: req.contextPath,
    specPath: req.specRef.path,
  });

  if (req.expectedArtifactPath !== null) {
    await assertNextPhaseSpecProduced(req.repoDir, reconciled, req.expectedArtifactPath);
  }

  if (reconciled.repo.commits.length > 0) {
    await assertNeutralCommits(req.repoDir, reconciled.repo.commits);
  }

  await writeHandoffRecord(path, reconciled);
  return { outcome, record: reconciled };
}

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
import { handoffPath } from "../util/paths.ts";
import { assertNeutralCommits } from "../verify/commits.ts";
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
 * [DET] One turn end to end, in a fixed order:
 * 1. Capture ground truth (HEAD/branch) immediately before spawning.
 * 2. Build the invocation via the adapter (pure).
 * 3. [DECISION Phase 3] Merge env as `{ ...process.env-with-undefined-dropped, ...invocation.env }`
 *    -- never `invocation.env` alone (would silently strip the operator's PATH/credentials).
 * 4. Spawn via `deps.runProcessFn ?? runProcess`.
 * 5. Interpret the raw result. A failed outcome returns immediately -- no attempt to read an
 *    on-disk record when the adapter itself already reports failure.
 * 6. Read the on-disk `HandoffRecord`. A `RelaySchemaError`/`IsolationLeakError` here is caught and
 *    converted into this step's own modelled failure (not reinterpreted -- the original error
 *    object is preserved as `outcome.failure`); any other thrown error (e.g. the handoff file is
 *    genuinely missing) propagates unmodified, an unexpected condition outside this step's
 *    modelled failure set.
 * 7. Reconcile against ground truth (may itself throw `RelaySchemaError`, handled identically).
 * 8. If any real commits were recorded, assert commit neutrality -- a thrown
 *    `BoundaryViolationError` propagates unmodified; I4 is a hard invariant, never retried.
 * 9. Persist the reconciled record at the same path, overwriting the agent's own draft.
 * Implements PHASE_3_SPEC.md §6.4.
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

  const path = handoffPath(req.repoDir, req.runId, req.phase, req.turnIndex, req.archetype, req.provider);

  let draft: HandoffRecord;
  try {
    draft = await readHandoffRecord(path);
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

  if (reconciled.repo.commits.length > 0) {
    await assertNeutralCommits(req.repoDir, reconciled.repo.commits);
  }

  await writeHandoffRecord(path, reconciled);
  return { outcome, record: reconciled };
}

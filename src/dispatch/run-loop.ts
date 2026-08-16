// Implements PHASE_3_SPEC.md §6.5
//
// `runDispatch()` -- the top-level orchestrator: preflight, lock, the turn loop, continuity gating
// with bounded retry, halt propagation. Never throws a `MultiLooprError` for a modelled failure --
// mirrors `runDoctor`'s own established "returns the exit code, never calls `process.exit`, never
// throws for an expected condition" contract. An unexpected (non-modelled) throw -- including a
// `BoundaryViolationError` from `assertNeutralCommits` inside `runTurn`, which is deliberately
// never caught anywhere in this module (I4 is a hard invariant, never retried) -- is allowed to
// propagate normally, to be caught by `src/cli/run.ts`/`main.ts`'s existing generic catch, same as
// any other module in this codebase.

import type { AdapterRegistry, ProviderAdapter } from "../ports/provider-adapter.ts";
import { ADAPTER_REGISTRY } from "../adapters/registry.ts";
import type { FileRef, HaltSignal, HandoffRecord } from "../domain/relay.ts";
import type { ProviderId, RunConfig, TurnRequest } from "../domain/run.ts";
import { ExitCode, LockHeldError, exitCodeFor } from "../domain/errors.ts";
import { getRole } from "../domain/roles.ts";
import type { ContinuityVerdict, ContinuityVerdictLabel } from "../verify/continuity.ts";
import { verifyContinuation } from "../verify/continuity.ts";
import { diffText } from "../verify/git.ts";
import { runPreflight } from "../verify/preflight.ts";
import { acquireRunLock, releaseRunLock } from "../util/lock.ts";
import { handoffPath, repoRelToAbs } from "../util/paths.ts";
import { sha256File } from "../util/hash.ts";
import { runProcess } from "../util/exec.ts";
import type { TurnPlan } from "./plan.ts";
import { planTurnSequence } from "./plan.ts";
import { buildExecutorPrompt, buildReviewerPrompt } from "./prompt.ts";
import type { RunTurnDeps } from "./turn.ts";
import { runTurn } from "./turn.ts";

/**
 * Builds a {@link RunTurnDeps} without ever explicitly assigning `undefined` to the optional
 * `runProcessFn` property -- required under `exactOptionalPropertyTypes` (a variable typed
 * `typeof runProcess | undefined` cannot be assigned directly to an optional property of type
 * `typeof runProcess`, even though simply omitting the property is fine).
 */
function buildTurnDeps(adapter: ProviderAdapter, runProcessFn: typeof runProcess | undefined): RunTurnDeps {
  return runProcessFn === undefined ? { adapter } : { adapter, runProcessFn };
}

/** One dispatched turn attempt's summary, as reported in {@link RunResult.turns}. */
export interface TurnAttemptSummary {
  readonly turnIndex: number;
  readonly archetype: "executor" | "reviewer";
  readonly provider: ProviderId;
  readonly status: "completed" | "blocked" | "halted" | "failed";
  readonly continuityVerdict: ContinuityVerdictLabel | null;
  readonly retried: boolean;
}

/** The result of {@link runDispatch}. */
export interface RunResult {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly turns: readonly TurnAttemptSummary[];
  readonly halt: HaltSignal | null;
  readonly problems: readonly string[];
}

/**
 * Dependencies {@link runDispatch} needs beyond `RunConfig` itself.
 *
 * `preflightFn` is an AUTONOMOUS CRITIQUE addition beyond PHASE_3_SPEC.md §6.5's literal
 * two-field interface (`adapters`, `runProcessFn`) -- see the handoff notes for the full
 * rationale. In short: `runPreflight()` (Phase 1, unchanged) always shells out to the real
 * `claude`/`codex` binaries with no injection seam of its own, so without this field it is
 * structurally impossible for any test to reach `runDispatch`'s own turn-loop logic (lock,
 * planning, continuity retry, halt) without both provider CLIs being genuinely installed and
 * authenticated on the machine running the test -- directly contradicting §8 acceptance criterion
 * #30's explicit requirement that "no test in this phase spawns a real `claude` or `codex`
 * process." Defaults to the real {@link runPreflight} when omitted, so every call site that does
 * not pass `deps` (in particular `src/cli/run.ts`'s `runDispatch(config)`, which never passes
 * `deps` at all) is completely unaffected -- production behaviour is byte-identical to the spec as
 * literally written.
 */
export interface RunDispatchDeps {
  readonly adapters?: AdapterRegistry;
  readonly runProcessFn?: typeof runProcess;
  readonly preflightFn?: typeof runPreflight;
}

function buildRetryNote(verdict: ContinuityVerdict): string {
  const lines: string[] = [
    `RETRY NOTICE: your prior attempt's output did not pass multi-loopr's deterministic ` +
      `continuity checks (verdict: ${verdict.verdict}). Failing checks:`,
  ];
  for (const check of verdict.checks) {
    if (!check.passed) {
      lines.push(`  - ${check.id}: ${check.detail}`);
    }
  }
  lines.push("Address these specific issues in this attempt; do not repeat the same mistake.");
  return lines.join("\n");
}

interface BuildPromptInput {
  readonly slot: TurnPlan;
  readonly specRepoRelPath: string;
  readonly handoffAbsPath: string;
  readonly prevRecord: HandoffRecord | null;
  readonly diff: string | null;
  readonly retryNote: string | null;
}

function buildPromptForSlot(input: BuildPromptInput): string {
  if (input.slot.archetype === "executor") {
    return buildExecutorPrompt({
      role: "executor",
      specRepoRelPath: input.specRepoRelPath,
      handoffAbsPath: input.handoffAbsPath,
      priorRecord: input.prevRecord,
      retryNote: input.retryNote,
    });
  }
  // The reviewer slot always has a non-null prevRecord and diff -- it is never the first slot in
  // planTurnSequence's fixed three-slot order (§6.1).
  return buildReviewerPrompt({
    specRepoRelPath: input.specRepoRelPath,
    handoffAbsPath: input.handoffAbsPath,
    priorRecord: input.prevRecord as HandoffRecord,
    diff: input.diff ?? "",
    retryNote: input.retryNote,
  });
}

interface DispatchOneAttemptInput {
  readonly config: RunConfig;
  readonly deps: RunTurnDeps;
  readonly slot: TurnPlan;
  readonly turnIndex: number;
  readonly specRef: FileRef;
  readonly prevRecord: HandoffRecord | null;
  readonly diff: string | null;
  readonly retryNote: string | null;
}

async function dispatchOneAttempt(input: DispatchOneAttemptInput) {
  const { config, slot, turnIndex } = input;
  const tier = getRole(slot.archetype).tier;
  const modelOverride = config.model_overrides?.[slot.provider] ?? null;
  const handoffAbsPath = handoffPath(config.repo_dir, config.run_id, config.phase, turnIndex, slot.archetype, slot.provider);
  const prompt = buildPromptForSlot({
    slot,
    specRepoRelPath: config.spec_path,
    handoffAbsPath,
    prevRecord: input.prevRecord,
    diff: input.diff,
    retryNote: input.retryNote,
  });
  const req: TurnRequest = {
    runId: config.run_id,
    phase: config.phase,
    turnIndex,
    archetype: slot.archetype,
    provider: slot.provider,
    tier,
    modelOverride,
    repoDir: config.repo_dir,
    specRef: input.specRef,
    priorRecord: input.prevRecord,
    prompt,
    timeoutMs: config.turn_timeout_ms,
  };
  const result = await runTurn(req, input.deps);
  return { req, result };
}

function nonCompleteSummary(
  turnIndex: number,
  slot: TurnPlan,
  status: "blocked" | "halted" | "failed",
  retried: boolean,
): TurnAttemptSummary {
  return { turnIndex, archetype: slot.archetype, provider: slot.provider, status, continuityVerdict: null, retried };
}

/**
 * [DET] The extended preflight check (§6.5 step 1): the ordinary `runPreflight()` (Phase 1,
 * unchanged) plus a readability check on `config.spec_path`, folded into the same "is everything
 * this run needs actually present and healthy" concept rather than a new exit code.
 */
async function runExtendedPreflight(
  config: RunConfig,
  preflightFn: typeof runPreflight,
): Promise<{ ok: boolean; problems: readonly string[] }> {
  const summary = await preflightFn(config.repo_dir);
  const problems: string[] = [...summary.problems];
  let specOk = true;
  try {
    await sha256File(repoRelToAbs(config.repo_dir, config.spec_path));
  } catch {
    specOk = false;
    problems.push(
      `spec_path "${config.spec_path}" does not resolve to a readable file in "${config.repo_dir}".`,
    );
  }
  return { ok: summary.ok && specOk, problems };
}

/**
 * The top-level orchestrator: extended preflight, run lock, then the fixed three-slot turn loop
 * (planning, prompt assembly, spawn, ground-truth reconciliation, neutrality assertion, continuity
 * gating with exactly one bounded retry scoped to a non-`CONTINUED` verdict, halt propagation).
 * Implements PHASE_3_SPEC.md §6.5.
 */
export async function runDispatch(config: RunConfig, deps?: RunDispatchDeps): Promise<RunResult> {
  const preflight = await runExtendedPreflight(config, deps?.preflightFn ?? runPreflight);
  if (!preflight.ok) {
    return { ok: false, exitCode: ExitCode.PREFLIGHT_FAILED, turns: [], halt: null, problems: preflight.problems };
  }

  try {
    await acquireRunLock(config.repo_dir, config.run_id);
  } catch (err) {
    if (err instanceof LockHeldError) {
      return { ok: false, exitCode: ExitCode.LOCK_HELD, turns: [], halt: null, problems: [err.message] };
    }
    throw err;
  }

  try {
    return await runTurnLoop(config, deps);
  } finally {
    await releaseRunLock(config.repo_dir, config.run_id);
  }
}

async function runTurnLoop(config: RunConfig, deps?: RunDispatchDeps): Promise<RunResult> {
  const adapters = deps?.adapters ?? ADAPTER_REGISTRY;
  const runProcessFn = deps?.runProcessFn;

  const specSha256 = await sha256File(repoRelToAbs(config.repo_dir, config.spec_path));
  const specRef: FileRef = { path: config.spec_path, sha256: specSha256 };

  const plan = planTurnSequence(config);
  const turns: TurnAttemptSummary[] = [];
  let attemptCounter = 0;
  let prevRecord: HandoffRecord | null = null;
  let firstTurnHeadBefore: string | null = null;

  for (const [slotIndex, slot] of plan.entries()) {
    const adapter = adapters[slot.provider];

    let diff: string | null = null;
    if (slot.archetype === "reviewer") {
      diff = await diffText(config.repo_dir, firstTurnHeadBefore ?? "", (prevRecord as HandoffRecord).repo.head_after);
    }

    const turnIndex = attemptCounter;
    attemptCounter += 1;
    const { result } = await dispatchOneAttempt({
      config,
      deps: buildTurnDeps(adapter, runProcessFn),
      slot,
      turnIndex,
      specRef,
      prevRecord,
      diff,
      retryNote: null,
    });

    if (!result.outcome.ok) {
      turns.push(nonCompleteSummary(turnIndex, slot, "failed", false));
      return {
        ok: false,
        exitCode: exitCodeFor(result.outcome.failure),
        turns,
        halt: null,
        problems: [result.outcome.failure?.message ?? "turn failed with no further detail"],
      };
    }

    const record = result.record as HandoffRecord;
    if (record.status !== "completed") {
      turns.push(nonCompleteSummary(turnIndex, slot, record.status, false));
      return {
        ok: false,
        exitCode: ExitCode.RUN_HALTED,
        turns,
        halt: record.halt,
        problems: [record.halt?.message ?? `turn reported status "${record.status}"`],
      };
    }

    if (slotIndex === 0) {
      firstTurnHeadBefore = record.repo.head_before;
    }

    if (prevRecord === null) {
      turns.push({
        turnIndex,
        archetype: slot.archetype,
        provider: slot.provider,
        status: "completed",
        continuityVerdict: null,
        retried: false,
      });
      prevRecord = record;
      continue;
    }

    const verdict = await verifyContinuation(config.repo_dir, prevRecord, record);
    if (verdict.verdict === "CONTINUED") {
      turns.push({
        turnIndex,
        archetype: slot.archetype,
        provider: slot.provider,
        status: "completed",
        continuityVerdict: "CONTINUED",
        retried: false,
      });
      prevRecord = record;
      continue;
    }

    // [DECISION Phase 3] Exactly one bounded retry, scoped only to a non-CONTINUED verdict.
    turns.push({
      turnIndex,
      archetype: slot.archetype,
      provider: slot.provider,
      status: "completed",
      continuityVerdict: verdict.verdict,
      retried: false,
    });

    const retryTurnIndex = attemptCounter;
    attemptCounter += 1;
    const { result: retryResult } = await dispatchOneAttempt({
      config,
      deps: buildTurnDeps(adapter, runProcessFn),
      slot,
      turnIndex: retryTurnIndex,
      specRef,
      prevRecord,
      diff,
      retryNote: buildRetryNote(verdict),
    });

    if (!retryResult.outcome.ok) {
      turns.push(nonCompleteSummary(retryTurnIndex, slot, "failed", true));
      return {
        ok: false,
        exitCode: exitCodeFor(retryResult.outcome.failure),
        turns,
        halt: null,
        problems: [retryResult.outcome.failure?.message ?? "turn failed with no further detail"],
      };
    }

    const retryRecord = retryResult.record as HandoffRecord;
    if (retryRecord.status !== "completed") {
      turns.push(nonCompleteSummary(retryTurnIndex, slot, retryRecord.status, true));
      return {
        ok: false,
        exitCode: ExitCode.RUN_HALTED,
        turns,
        halt: retryRecord.halt,
        problems: [retryRecord.halt?.message ?? `turn reported status "${retryRecord.status}"`],
      };
    }

    const retryVerdict = await verifyContinuation(config.repo_dir, prevRecord, retryRecord);
    if (retryVerdict.verdict !== "CONTINUED") {
      turns.push({
        turnIndex: retryTurnIndex,
        archetype: slot.archetype,
        provider: slot.provider,
        status: "completed",
        continuityVerdict: retryVerdict.verdict,
        retried: true,
      });
      return {
        ok: false,
        exitCode: ExitCode.CONTINUITY_FAILED,
        turns,
        halt: null,
        problems: [
          `continuity check failed twice for ${slot.archetype}/${slot.provider}: first verdict ` +
            `${verdict.verdict} (failed: ${verdict.failedCheckIds.join(", ") || "none"}), retry verdict ` +
            `${retryVerdict.verdict} (failed: ${retryVerdict.failedCheckIds.join(", ") || "none"}).`,
        ],
      };
    }

    turns.push({
      turnIndex: retryTurnIndex,
      archetype: slot.archetype,
      provider: slot.provider,
      status: "completed",
      continuityVerdict: "CONTINUED",
      retried: true,
    });
    prevRecord = retryRecord;
  }

  return { ok: true, exitCode: ExitCode.OK, turns, halt: null, problems: [] };
}

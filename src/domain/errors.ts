// Implements PHASE_1_SPEC.md §3.1
//
// Canonical exit-code table and error hierarchy for multi-loopr. Every deterministic verifier and
// the CLI dispatcher (`src/cli/main.ts`) communicate failure exclusively through this hierarchy so
// that `exitCodeFor()` is the single place mapping an error to a process exit code.

/**
 * Canonical process exit codes (PHASE_1_SPEC.md §4.3). A plain `const object`, not a TypeScript
 * `enum` -- `erasableSyntaxOnly` (tsconfig.json) forbids `enum` because it requires code generation
 * that Node's type stripping cannot execute.
 */
export const ExitCode = {
  OK: 0,
  INTERNAL: 1,
  USAGE: 2,
  PREFLIGHT_FAILED: 3,
  RELAY_SCHEMA_INVALID: 4,
  ISOLATION_LEAK: 5,
  CONTINUITY_FAILED: 6,
  BOUNDARY_VIOLATION: 7,
  LOCK_HELD: 8,
  TIER_WELDING: 9,
  TURN_TIMEOUT: 10,
  RUN_HALTED: 11,
  LOOPR_ARTIFACT_BYPASSED: 12,
  ACCEPTANCE_INCOMPLETE: 13,
  /** A completed phase produced neither a next phase spec nor BUILD_COMPLETE.md (PHASE_6_SPEC.md §3.4/§6.5, D4). */
  DRIVER_HALTED_AMBIGUOUS: 14,
  /** A completed phase produced both a next phase spec and BUILD_COMPLETE.md (PHASE_6_SPEC.md §3.4/§6.5, D5). */
  DRIVER_HALTED_INCOHERENT: 15,
  /** The driver's configured max-phases cap (baby_prd.md acceptance criterion 6) was reached before BUILD_COMPLETE.md (PHASE_6_SPEC.md §3.4/§6.5, D2 nested cap branch). */
  DRIVER_HALTED_MAX_PHASES: 16,
  /** BUILD_COMPLETE.md already existed at the target repo root before a driver invocation dispatched anything (PHASE_6_SPEC.md §3.4/§6.1). */
  DRIVER_START_INCOHERENT: 17,
  /** `claude` CLI was found, but `multi-loopr`'s own server ended in a non-success outcome (PHASE_9_SPEC.md §4.2). */
  SETUP_FAILED: 18,
} as const;

/** The type of a value in {@link ExitCode}. */
export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Base class for every error multi-loopr's deterministic layer raises. Carries a stable process
 * exit code, a stable machine-readable `code` identifier, and a structured `details` bag so a
 * caller (the CLI, a test, or a future reviewer payload) never needs to parse `message` text.
 */
export abstract class MultiLooprError extends Error {
  abstract readonly exitCode: number;
  abstract readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

/** An unexpected failure that is not one of multi-loopr's own modelled error conditions. */
export class InternalError extends MultiLooprError {
  readonly exitCode = ExitCode.INTERNAL;
  readonly code = "INTERNAL";
}

/** Unknown command, unknown flag, or mutually exclusive flags passed together (PHASE_1_SPEC.md §4.1). */
export class UsageError extends MultiLooprError {
  readonly exitCode = ExitCode.USAGE;
  readonly code = "USAGE";
}

/** Toolchain, git, or provider-CLI preflight failed (PRD §9 FM1 / FM9). */
export class PreflightError extends MultiLooprError {
  readonly exitCode = ExitCode.PREFLIGHT_FAILED;
  readonly code = "PREFLIGHT_FAILED";
}

/** A `HandoffRecord`'s `schema_version` did not match, or it failed zod parsing (PRD §9 FM5). */
export class RelaySchemaError extends MultiLooprError {
  readonly exitCode = ExitCode.RELAY_SCHEMA_INVALID;
  readonly code = "RELAY_SCHEMA_INVALID";
}

/** A transcript-shaped key was found in a relay payload before schema parsing (PRD §9 FM2, §7 I5). */
export class IsolationLeakError extends MultiLooprError {
  readonly exitCode = ExitCode.ISOLATION_LEAK;
  readonly code = "ISOLATION_LEAK";
}

/** `ContinuityVerdict.verdict !== "CONTINUED"`, or a git plumbing call returned a bad object (PRD §9 FM3). */
export class ContinuityError extends MultiLooprError {
  readonly exitCode = ExitCode.CONTINUITY_FAILED;
  readonly code = "CONTINUITY_FAILED";
}

/** One of boundary rules B1--B6 or B8 fired (PRD §5.1). */
export class BoundaryViolationError extends MultiLooprError {
  readonly exitCode = ExitCode.BOUNDARY_VIOLATION;
  readonly code = "BOUNDARY_VIOLATION";
}

/** The run lock (`.multi-loopr/run.lock`) is held by a live process (PRD §9 FM6). */
export class LockHeldError extends MultiLooprError {
  readonly exitCode = ExitCode.LOCK_HELD;
  readonly code = "LOCK_HELD";
}

/** Boundary rule B7 specifically fired -- a concrete model name outside `src/adapters/**` (PRD §9 FM4). */
export class TierWeldingError extends MultiLooprError {
  readonly exitCode = ExitCode.TIER_WELDING;
  readonly code = "TIER_WELDING";
}

/**
 * A turn's child process ran past `TurnRequest.timeoutMs` and was killed (PRD §9 FM7). Distinct
 * from {@link InternalError}: a turn timeout is a modelled condition an adapter's
 * `interpretResult()` must recognise unconditionally, not an unexpected internal failure.
 * Implements PHASE_2_SPEC.md §1.2.
 */
export class TurnTimeoutError extends MultiLooprError {
  readonly exitCode = ExitCode.TURN_TIMEOUT;
  readonly code = "TURN_TIMEOUT";
}

/**
 * A turn's `HandoffRecord.status` was `"blocked"` or `"halted"` -- the run stopped because the
 * dispatched agent said it could not, or should not, continue (PRD §9; distinct from every other
 * error class: not a process failure, not a schema defect, not a continuity failure, not a
 * timeout). Implements PHASE_3_SPEC.md §1.4.
 */
export class RunHaltedError extends MultiLooprError {
  readonly exitCode = ExitCode.RUN_HALTED;
  readonly code = "RUN_HALTED";
}

/**
 * A turn's reconciled `HandoffRecord` failed one of Phase 4's two new loopr-artifact guards: either
 * `artifacts_read` never referenced one of `baby_prd_path`/`context_path`/`spec_path`
 * (`assertLooprArtifactsReferenced()`), or the reviewer turn's `artifacts_written` did not name a
 * genuinely turn-produced next-phase artifact (`assertNextPhaseSpecProduced()`). One error class
 * covers both checks -- they are the same *kind* of failure under PRD AC3 ("the agent did not
 * genuinely engage with loopr's own artifacts"), the same reasoning already applied to
 * {@link BoundaryViolationError} covering six distinct boundary-rule violations under one exit
 * code. The distinguishing detail lives in the thrown error's own `message`/`details`. Implements
 * PHASE_4_SPEC.md §1.3/§3.3.
 */
export class LooprArtifactBypassError extends MultiLooprError {
  readonly exitCode = ExitCode.LOOPR_ARTIFACT_BYPASSED;
  readonly code = "LOOPR_ARTIFACT_BYPASSED";
}

/**
 * A genuine internal defect in the `setup` command path. Thrown only for a bug, never for a normal
 * registration failure -- the normal failure route is a non-zero `exit_code` returned inside
 * `{ report, exitCode }`, matching every other command in this project (PHASE_9_SPEC.md §1.6).
 */
export class SetupError extends MultiLooprError {
  readonly exitCode = ExitCode.SETUP_FAILED;
  readonly code = "SETUP_FAILED";
}

/**
 * Resolves the process exit code for any thrown value: the error's own `exitCode` when it is a
 * {@link MultiLooprError}, otherwise {@link ExitCode.INTERNAL}.
 */
export function exitCodeFor(err: unknown): number {
  if (err instanceof MultiLooprError) {
    return err.exitCode;
  }
  return ExitCode.INTERNAL;
}

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
 * Resolves the process exit code for any thrown value: the error's own `exitCode` when it is a
 * {@link MultiLooprError}, otherwise {@link ExitCode.INTERNAL}.
 */
export function exitCodeFor(err: unknown): number {
  if (err instanceof MultiLooprError) {
    return err.exitCode;
  }
  return ExitCode.INTERNAL;
}

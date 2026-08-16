// Implements PHASE_1_SPEC.md §3.6
//
// The portability seam (PRD §6.1). Declarations only -- Phase 1 ships no implementation of
// `ProviderAdapter` and no `AdapterRegistry` value. A file under `src/adapters/` appearing in
// Phase 1 is a scope violation (PHASE_1_SPEC.md §9, non-goal #1).

import type { ModelTier } from "../domain/tiers.ts";
import type { ProviderId, RawInvocationResult, TurnOutcome, TurnRequest } from "../domain/run.ts";

/**
 * A fully-specified child-process invocation, ready to hand to `runProcess()`
 * (`src/util/exec.ts`). Producing one is the entire job of `ProviderAdapter.buildInvocation`.
 */
export interface Invocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  /** `null` => stdin is closed immediately, never inherited from the parent TTY (PRD §9 FM7). */
  readonly stdin: string | null;
}

/** The result of a single provider's health check (toolchain presence, version, auth state). */
export interface PreflightReport {
  readonly provider: ProviderId;
  readonly cliFound: boolean;
  readonly version: string | null;
  readonly versionInRange: boolean;
  readonly authenticated: boolean;
  /** Empty array => healthy. */
  readonly problems: readonly string[];
}

/**
 * The mechanism-independent port every provider CLI is driven through (PRD §6.1 portability
 * constraint). A port to a new provider is a new implementation of this interface, never a
 * redesign of the layers above it.
 */
export interface ProviderAdapter {
  readonly id: ProviderId;

  /** Observes this provider's toolchain/auth health. Never establishes credentials (boundary rule B6). */
  preflight(): Promise<PreflightReport>;

  /** Maps an abstract {@link ModelTier} to this provider's own concrete effort setting (PRD §6.2). */
  resolveEffort(tier: ModelTier): string;

  /**
   * Builds the child-process invocation for one turn. **Must be pure**: no I/O, no clock, no
   * environment read beyond what `req` already carries. Purity is what makes Phase 2's adapters
   * testable without spawning an LLM, and Phase 2's conformance suite depends on it.
   */
  buildInvocation(req: TurnRequest): Invocation;

  /** Interprets a completed process result as a {@link TurnOutcome}. */
  interpretResult(raw: RawInvocationResult): TurnOutcome;
}

/** One adapter per {@link ProviderId}, always both present. Phase 1 ships no value of this type. */
export type AdapterRegistry = Readonly<Record<ProviderId, ProviderAdapter>>;

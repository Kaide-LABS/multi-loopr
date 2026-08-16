// Implements PHASE_1_SPEC.md §3.5
//
// Provider identity, the operator-facing `RunConfig`, and the plain (non-wire) types a turn
// passes between the dispatch layer and a `ProviderAdapter` (Phase 2+). Phase 1 defines and
// validates `RunConfig`; nothing in Phase 1 consumes it (no dispatch loop exists yet -- §9).
//
// Module dependency note: this file intentionally has zero runtime dependency on `./relay.ts`.
// `RunConfig.run_id` validates with an inline `z.uuid()` (behaviourally identical to relay.ts's
// exported `RunId` primitive) rather than importing it, and `TurnRequest`/`TurnOutcome` pull in
// `FileRef`/`HandoffRecord`/`MultiLooprError` via `import type` only, which Node's type stripping
// erases entirely. This keeps relay.ts's runtime import of `ProviderIdSchema` from this file a
// one-directional edge instead of an ES-module import cycle. See the note at the top of relay.ts.

import { z } from "zod";
import type { Archetype } from "./roles.ts";
import type { ModelTier } from "./tiers.ts";
import type { FileRef, HandoffRecord } from "./relay.ts";
import type { MultiLooprError } from "./errors.ts";

/** The two provider CLIs multi-loopr V1 drives (PRD §5, fixed pair). */
export const PROVIDER_IDS = ["claude-code", "codex-cli"] as const;

/** A member of {@link PROVIDER_IDS}. */
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** zod schema for {@link ProviderId}. */
export const ProviderIdSchema = z.enum(PROVIDER_IDS);

/**
 * Operator-supplied run configuration. Phase 1 defines and validates it; Phase 3's dispatch loop
 * is its only consumer.
 */
export const RunConfig = z.strictObject({
  run_id: z.uuid(),
  repo_dir: z.string().min(1),
  executor_providers: z
    .tuple([ProviderIdSchema, ProviderIdSchema])
    .refine(([a, b]) => a !== b, "executor_providers must be two different provider ids"),
  reviewer_provider: ProviderIdSchema.nullable().default(null),
  turn_timeout_ms: z.number().int().min(1000).max(7_200_000).default(1_800_000),
  model_overrides: z.record(ProviderIdSchema, z.string().min(1)).optional(),
});

/** The inferred type of {@link RunConfig}. */
export type RunConfig = z.infer<typeof RunConfig>;

/**
 * Everything a `ProviderAdapter` needs to build one turn's invocation. Not a wire schema -- it
 * never crosses a process boundary, so it is a plain TypeScript type.
 */
export interface TurnRequest {
  readonly runId: string;
  readonly phase: number;
  readonly turnIndex: number;
  readonly archetype: Archetype;
  readonly provider: ProviderId;
  readonly tier: ModelTier;
  /**
   * Operator-supplied override from `RunConfig.model_overrides` (PHASE_1_SPEC.md §3.5) -- "the
   * only place a concrete model name may appear at runtime, and it is operator-supplied data,
   * never source." `null` when the operator did not override this provider's model for this run.
   * Implements PHASE_2_SPEC.md §1.3.
   */
  readonly modelOverride: string | null;
  readonly repoDir: string;
  readonly specRef: FileRef;
  readonly priorRecord: HandoffRecord | null;
  readonly prompt: string;
  readonly timeoutMs: number;
}

/** The raw result of spawning a child process, before any provider-specific interpretation. */
export interface RawInvocationResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

/** The result of interpreting a turn: either a valid handoff record, or a modelled failure. */
export interface TurnOutcome {
  readonly ok: boolean;
  readonly record: HandoffRecord | null;
  readonly failure: MultiLooprError | null;
}

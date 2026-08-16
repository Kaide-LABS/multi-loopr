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
import { isSafeRepoRelPath } from "../util/paths.ts";

/**
 * A repo-relative POSIX path, declared locally rather than imported from `./relay.ts`'s
 * `RepoRelPath` -- this file has zero *runtime* dependency on `relay.ts` (see the module
 * dependency note above) to keep the two files' dependency a one-directional DAG. This is not a
 * new safety rule: it delegates to the same single-source-of-truth `isSafeRepoRelPath`
 * (`src/util/paths.ts`) that `RepoRelPath` itself already delegates to (PHASE_1_SPEC.md §6.3: "the
 * rule lives in one place"), just declared a second time as a schema value in the one file that
 * cannot safely import the other's schema object without a cycle. Implements PHASE_3_SPEC.md §1.3.
 */
const RepoRelPathLike = z
  .string()
  .min(1)
  .max(1024)
  .refine(isSafeRepoRelPath, "must be a safe, repo-relative POSIX path (no absolute path, no backslash separators, no upward traversal)");

/** The two provider CLIs multi-loopr V1 drives (PRD §5, fixed pair). */
export const PROVIDER_IDS = ["claude-code", "codex-cli"] as const;

/** A member of {@link PROVIDER_IDS}. */
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** zod schema for {@link ProviderId}. */
export const ProviderIdSchema = z.enum(PROVIDER_IDS);

/**
 * The three genuinely distinct outcomes of *observing* a provider CLI's credential state (boundary
 * rule B6 -- multi-loopr only ever observes it, never establishes it):
 *
 * - `"authenticated"` -- the CLI ran and its own output positively says the operator is signed in.
 * - `"unauthenticated"` -- the CLI ran fine and its own output positively says the operator is not
 *   signed in (Claude Code's `loggedIn: false`; Codex's documented not-signed-in exit code with no
 *   API key env var set). A **claim**, and an actionable one: the operator needs to sign in.
 * - `"indeterminate"` -- the probe did not answer the question: the child process failed to spawn,
 *   timed out, returned an exit code matching neither documented outcome, or emitted output that
 *   did not parse. The **absence** of a claim, and a different action: look closer.
 *
 * Collapsing the last two into a single `false` is exactly the shape that let the Windows `cmd.exe`
 * argument-quoting defect (fixed in `src/util/exec.ts`) stay invisible: a probe failing for a reason
 * entirely unrelated to credentials read identically to "not signed in", so `doctor --providers`
 * reported a plausible-looking provider state right up until a real turn silently failed. A probe
 * that cannot answer must say so rather than guess the more familiar answer.
 */
export const AUTH_PROBE_STATES = ["authenticated", "unauthenticated", "indeterminate"] as const;

/** A member of {@link AUTH_PROBE_STATES}. */
export type AuthProbeState = (typeof AUTH_PROBE_STATES)[number];

/** zod schema for {@link AuthProbeState}. */
export const AuthProbeStateSchema = z.enum(AUTH_PROBE_STATES);

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
  /** Which loopr phase this run dispatches (PHASE_3_SPEC.md §1.3). */
  phase: z.number().int().min(1),
  /** Repo-relative path to the `PHASE_N_SPEC.md` this run's turns work from (PHASE_3_SPEC.md §1.3). */
  spec_path: RepoRelPathLike,
  /**
   * Repo-relative path to loopr's own `baby_prd.md` for this build -- required (never nullable):
   * by the time any `multi-loopr run` dispatch happens, loopr's interrogation stage has necessarily
   * already produced it. Genuinely read (never generated) by every dispatched turn
   * (`assertLooprArtifactsReferenced()`, PHASE_4_SPEC.md §6.1).
   */
  baby_prd_path: RepoRelPathLike,
  /** Repo-relative path to loopr's own `context.md` for this build. Same treatment as `baby_prd_path`. */
  context_path: RepoRelPathLike,
  /**
   * Whether this run dispatches the target build's own final phase. Operator-supplied per run --
   * multi-loopr never infers it. Determines what the reviewer turn is instructed, and mechanically
   * held, to produce next: `PHASE_(N+1)_SPEC.md` when `false`, a `BUILD_COMPLETE.md` completion
   * artifact when `true` (`nextPhaseSpecPath()`, PHASE_4_SPEC.md §6.1). Defaults `false` so every
   * pre-Phase-4 `RunConfig` fixture that omits it keeps parsing, the same reasoning
   * `turn_timeout_ms`'s own default already established.
   */
  is_final_phase: z.boolean().default(false),
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
  /**
   * Repo-relative path to loopr's `baby_prd.md` for this build, threaded from
   * `RunConfig.baby_prd_path` -- a plain path string, not a `FileRef`: unlike `specRef` it never
   * participates in a cross-turn consistency check (there is no `C_BABY_PRD_CONTINUITY`), so no
   * ground-truth hash needs to be precomputed for it. Implements PHASE_4_SPEC.md §1.2.
   */
  readonly babyPrdPath: string;
  /** Repo-relative path to loopr's `context.md` for this build, threaded from `RunConfig.context_path`. */
  readonly contextPath: string;
  /**
   * The repo-relative path the reviewer turn must genuinely produce next (`nextPhaseSpecPath()`),
   * or `null` for every executor turn -- the same "null unless this specific slot needs it" shape
   * `diff` already uses in `run-loop.ts`'s `BuildPromptInput`. Implements PHASE_4_SPEC.md §1.2.
   */
  readonly expectedArtifactPath: string | null;
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

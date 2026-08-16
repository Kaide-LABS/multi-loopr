// Implements PHASE_3_SPEC.md §6.1
//
// Resolves PRD §6.3's DECISION (which archetypes cross-provider-dispatch in V1) into the concrete,
// ordered, three-slot turn sequence for one run. Plain types, not zod -- in-process only, like
// `Invocation`/`TurnRequest` (PHASE_1_SPEC.md §3.6).

import { InternalError } from "../domain/errors.ts";
import type { ProviderId, RunConfig } from "../domain/run.ts";
import { PROVIDER_IDS } from "../domain/run.ts";

/**
 * One dispatched turn's role/provider pair. `archetype` is narrowed to exactly the two
 * V1-dispatched archetypes (`ROLE_REGISTRY`'s `instantiatedInV1: true` members, PRD §6.3) --
 * `planTurnSequence` never produces `"architect"`, `"researcher"`, or `"auditor"`.
 */
export interface TurnPlan {
  readonly archetype: "executor" | "reviewer";
  readonly provider: ProviderId;
}

/**
 * [DET] Total over {@link PROVIDER_IDS} (exactly two members): returns the member of
 * `PROVIDER_IDS` that is not `id`. Throws {@link InternalError} if none is found (unreachable
 * given `PROVIDER_IDS`'s two-distinct-member invariant, defended anyway per this codebase's
 * established "exhaustive-over-a-closed-set, defend at runtime" idiom -- `getRole()`, both
 * adapters' `resolveEffort()`).
 */
export function otherProviderId(id: ProviderId): ProviderId {
  if (!PROVIDER_IDS.includes(id)) {
    throw new InternalError(`otherProviderId: unreachable provider id "${id}"`, { id });
  }
  const other = PROVIDER_IDS.find((p) => p !== id);
  if (other === undefined) {
    throw new InternalError(`otherProviderId: unreachable provider id "${id}"`, { id });
  }
  return other;
}

/**
 * [DET, DECISION Phase 3] Resolves PRD §6.3's DECISION into the concrete, ordered, three-slot V1
 * turn sequence for one run: two executor slots, ordered exactly as `executor_providers` (already
 * validated as two *different* provider ids by `RunConfig`'s own `.refine`), then one reviewer
 * slot whose provider defaults to whichever provider did *not* produce the diff under review
 * (`otherProviderId(executor_providers[1])`, necessarily `executor_providers[0]` in a fixed
 * two-provider system) unless the operator set `reviewer_provider` explicitly. No other archetype
 * ever appears. Implements PHASE_3_SPEC.md §6.1.
 */
export function planTurnSequence(config: RunConfig): readonly TurnPlan[] {
  const [firstExecutor, secondExecutor] = config.executor_providers;
  return [
    { archetype: "executor", provider: firstExecutor },
    { archetype: "executor", provider: secondExecutor },
    { archetype: "reviewer", provider: config.reviewer_provider ?? otherProviderId(secondExecutor) },
  ];
}

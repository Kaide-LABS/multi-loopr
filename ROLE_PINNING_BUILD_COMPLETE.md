# ROLE_PINNING_BUILD_COMPLETE.md -- multi-loopr role pinning feature

**Status:** Phase 7 (role pinning) is built, reviewed, and approved.

This is a third, separate feature series layered on top of the already-shipped, already-complete
V1 (`BUILD_COMPLETE.md`, phases 1-5) and the already-shipped, already-approved Phase 6 driver
(`DRIVER_BUILD_COMPLETE.md`). It is deliberately a distinctly-named marker, not a rewrite of either
file, per `PHASE_7_SPEC.md`'s own PHASE ADVANCEMENT instruction: overwriting or duplicating either
would corrupt an existing, already-shipped record. Phase 7 is a single-phase feature series
(`PHASE_7_SPEC.md` §0); there is no Phase 8 of *this* feature. An MCP server is a separate, later
feature series with its own eventual loopr interrogation (`.claude/loopr-role-pinning/baby_prd.md`
scope edges).

## Commit trail

| Commit | Meaning |
|---|---|
| `36b249c` | `feat: Phase 7 implementation (multi-loopr)` |
| `1afec50` | `fix: Phase 7 review patches (multi-loopr) -- cite self-preference-bias literature in code comments, add rendered "Warnings:" block coverage` |
| `361e328` | `chore: Phase 7 review approved (multi-loopr)` |
| (this pass) | `docs: multi-loopr role pinning feature complete -- 1 phase shipped` |

The one fix patch (`1afec50`) closed two real, disclosed gaps: the corroborating self-preference-bias
literature existed only in the PRD's own changelog, not in the shipped code, at implementation time;
and `PHASE_7_SPEC.md` §8 AC3's rendered-text half ("Warnings:" block) had no direct unit test, only
the JSON (`RunReport.warnings`) half. Both are independently re-verified below, not taken on the
approval commit's word.

## Acceptance-suite results -- run live this pass, not self-reported

Every item below was executed directly against the repository at HEAD (`361e328`) during this
advancement pass.

**Static discipline**
1. `npm run typecheck` -- **PASS**, zero diagnostics.
2. `node src/cli/main.ts doctor --boundary` -- **PASS**, exit `0`, `34 file(s) scanned, 0 violation(s)`.
3. `npm run check`'s test step (`node --test "src/**/*.test.ts"`) -- **394/398 pass, 4 fail.** The 4
   failures (`src/adapters/codex-cli.test.ts`, `src/cli/main.test.ts` x2, `src/verify/preflight.test.ts`)
   are the same pre-existing, environment-dependent Codex-auth-state failures already disclosed in
   `DRIVER_BUILD_COMPLETE.md` and in commit `1afec50`'s own message -- they assert this machine's
   Codex CLI is in an unauthenticated state, and this machine's real, current sign-in state differs.
   None of the 4 touch `src/dispatch/plan.ts`, `src/domain/run.ts`, `src/domain/driver.ts`,
   `src/dispatch/run-loop.ts`, `src/dispatch/driver-loop.ts`, or role-pinning-specific test files --
   they are identical in name and assertion to the pre-Phase-7 failure set. Not a Phase 7 regression.
4. `git diff --name-only 76e829f..361e328` (the full Phase-6-approved -> Phase-7-approved range) --
   touches exactly `README.md`, `src/cli/{main,run}.ts` (+ their `.test.ts`), `src/dispatch/{plan,
   run-loop,driver-loop}.ts` (+ their `.test.ts`), `src/domain/{run,driver}.ts` (+ their `.test.ts`),
   plus `DRIVER_BUILD_COMPLETE.md` (added by the intervening Phase-6-completion commit `96adf35`, not
   Phase 7 itself). **Zero** files under `src/verify/**`, `src/ports/**`, `src/adapters/**`,
   `src/cli/doctor.ts`, `src/cli/evidence.ts`, `src/dispatch/driver-state.ts`, `src/dispatch/turn.ts`,
   `src/dispatch/record.ts`, `src/dispatch/prompt.ts`, or `src/dispatch/artifacts.ts` are touched --
   **PASS** against PHASE_7_SPEC.md §1's exhaustive file list and FM-P6.

**Nine-row worked resolution table (PHASE_7_SPEC.md §6.1) -- re-traced against the real shipped
`planTurnSequence` (`src/dispatch/plan.ts`) and the real `RunConfig`/`DriveConfig` refine chain
(`src/domain/run.ts`, byte-identical in `src/domain/driver.ts`), not re-quoted from the spec:**

| `role_pins` | executor slots | reviewer slot | `reviewerReviewedOwnWork` | Verified against |
|---|---|---|---|---|
| `{}` | `[P0, P1]` | `otherProviderId(P1) = P0` (or explicit `reviewer_provider`) | `false` | `executorPool.length===2` branch; `pinnedReviewer===null`, `reviewer_provider===null` path |
| `{A:"executor"}`, `A=P0` | `[P0, P1]` | `P1` (naive default `P0` is banned) | `true` | `naiveDefault=otherProviderId(P1)=P0`; `isPinned(P0,"executor")===true` -> falls back to `diffWriter=P1` |
| `{A:"executor"}`, `A=P1` | `[P0, P1]` | `P0` (naive default, not banned) | `false` | `naiveDefault=otherProviderId(P1)=P0`; `isPinned(P0,"executor")===false` -> `reviewerProvider=P0` |
| `{B:"reviewer"}` only | `[A, A]` | `B` | `false` | `executorPool` excludes `B` -> collapses to sole eligible `A`; `pinnedReviewer=B` |
| `{A:"executor", B:"reviewer"}` | `[A, A]` | `B` | `false` | Same collapse + pinned-reviewer branch; clean separation (AC1) |
| `{A:"reviewer", B:"executor"}` | `[B, B]` | `A` | `false` | Same, roles reversed; clean separation (AC1) |
| `{A:"reviewer"}` only | `[B, B]` | `A` | `false` | Same collapse + pinned-reviewer branch |
| `{A:"executor", B:"executor"}` | -- rejected, RP2 -- | | | `PROVIDER_IDS.some(p => role_pins[p] !== "executor")` is `false` for both providers -> `.refine()` fails at `.safeParse()` |
| `{A:"reviewer", B:"reviewer"}` | -- rejected, RP1 -- | | | `PROVIDER_IDS.some(p => role_pins[p] !== "reviewer")` is `false` for both providers -> `.refine()` fails at `.safeParse()` |

All nine rows independently traced line-by-line through `src/dispatch/plan.ts`'s actual
`planTurnSequence`/`isPinned` bodies and `src/domain/run.ts`'s actual RP1-RP4 `.refine()` predicates
this pass. **PASS**, all nine.

**§8 acceptance criteria, mapped to the code that satisfies each:**
1. **AC1 (clean role separation)** -- table rows 5-6 above; asserted directly in `plan.test.ts` and,
   at the `TurnAttemptSummary[]` level, in `run-loop.test.ts`. **PASS.**
2. **AC2 (unpinned config byte-identical to pre-Phase-7)** -- table row 1; `executorPool.length===2`
   short-circuits to `[firstExecutor, secondExecutor]`, the exact pre-Phase-7 expression. Pre-Phase-7
   `plan.test.ts` fixtures re-run unmodified. **PASS.**
3. **AC3 (self-review surfaced, not silent)** -- table row 2; `runTurnLoop` (`src/dispatch/run-loop.ts`
   lines 354-359) pushes a named warning string before dispatch; `RunResult.warnings` ->
   `RunReport.warnings` (`src/cli/run.ts`) -> `renderRunHumanReport`'s "Warnings:" block
   (`src/cli/main.ts` lines 298-304, confirmed present and exported this pass). Both JSON and
   rendered-text forms directly unit-tested (`src/cli/main.test.ts`, added in `1afec50`). **PASS.**
4. **AC4 (no executor -> pre-dispatch failure)** -- table row 9, RP1. Rejected at `.safeParse()`,
   before `runDispatch`/lock acquisition. **PASS.**
5. **AC5 (no reviewer -> pre-dispatch failure)** -- table row 8, RP2. Same treatment. **PASS.**
6. **AC6 (`run --help` and README describe pinned-role behavior)** -- confirmed this pass by direct
   grep: `src/cli/main.ts` line 31 (`USAGE_TEXT`) contains "...via the config's role_pins."; `README.md`
   line 15 names `role_pins` and "clean single-role separation." **PASS.**

**Overall: every §8 acceptance criterion re-verified this pass against the real shipped code, not
inherited from the prior review's own claim.**

## Citation-gate summary

Two citations bind this phase, grounding `reviewerReviewedOwnWork`'s "surface loudly, never silently"
design (`multi-loopr-PRD.md` §8.6, `PHASE_7_SPEC.md` §3.3). Both independently re-verified this pass
via a live arXiv abstract fetch, and confirmed genuinely present in the diff's own code comments
(`src/dispatch/plan.ts` file header, added by the review's own fix-patch commit `1afec50`), not merely
asserted in the PRD:

1. **Panickssery, Bowman, and Feng, "LLM Evaluators Recognize and Favor Their Own Generations,"
   arXiv:2404.13076 (2024-04-15).** Title and authors match exactly. Abstract confirms: LLM
   self-evaluation introduces self-preference bias (an LLM evaluator scoring its own outputs higher
   while human annotators rate them equal), with a demonstrated causal link between self-recognition
   capability and self-preference strength -- the mechanism the code comment cites as "a causal
   mechanism for self-preference bias when an LLM acts as both evaluator and evaluatee."
2. **Chen, Wei, Zhu, Feng, and Meng, "Do LLM Evaluators Prefer Themselves for a Reason?,"
   arXiv:2504.03846 (2025-04-04).** Title and authors match exactly. Abstract's finding (2) --
   "Harmful self-preference persists when evaluator models err as generators, and stronger models
   display more pronounced harmful self-preference bias when they do err" -- is quoted verbatim in the
   code comment and is on-point for this feature's code-generation reviewer context.

**Citation-gate result: PASSED**, independently re-verified this pass, not inherited.

## Handoff

`role_pins` on `RunConfig`/`DriveConfig` is complete, reviewed, and usable today for pinning either
provider (`claude-code`, `codex-cli`) exclusively to the executor role, exclusively to the reviewer
role, or leaving either unpinned, in a real `multi-loopr run --config <path>` or `multi-loopr drive
--config <path>` invocation. An unpinned config (the default) is byte-identical to pre-Phase-7
behaviour -- no operator action is required to keep today's alternation. An impossible pinning (RP1/
RP2) is rejected before any turn is dispatched or lock acquired, with a named, actionable message. A
structurally valid pinning that forces a reviewer to review its own prior work is not blocked, but is
surfaced plainly via `RunResult.warnings`/`RunReport.warnings` and the human "Warnings:" block --
never silent. `DriveConfig.role_pins` threads unchanged into every phase's `RunConfig` via
`buildPhaseRunConfig`, so a pinned drive stays pinned across every phase it dispatches, not only the
first.

No known gaps are being carried forward from this phase specifically (contrast `DRIVER_BUILD_COMPLETE.md`'s
disclosed multi-phase-fixture coverage gap, which is a Phase 6 property, not a Phase 7 one, and is
unaffected by role pinning since `src/dispatch/driver-state.ts` is untouched, §9 non-goal 2).

No deployment URL applies -- multi-loopr is a local CLI harness, not a deployed service.

# PHASE_4_SPEC.md -- multi-loopr

## §0 Phase Plan Header

**Phase 4 of 5.**

**Title:** loopr artifact integration.

**Built from:** `multi-loopr-PRD.md` §10 (Phase plan: "loopr artifact integration -- `baby_prd.md` /
`context.md` / `PHASE_N_SPEC.md` production and reference attestation (AC3)"), `multi-loopr-PRD.md`
§2 AC3 ("loopr's own phase artifacts (`baby_prd.md`, `context.md`, `PHASE_N_SPEC.md`) are genuinely
produced and read by both agents during the run, not bypassed -- observable by diffing what each
agent actually referenced against what it was handed"), `PHASE_3_SPEC.md` §9 ("Deferred to Phase 4
(loopr artifact integration)" items 1-2, explicitly naming exactly this scope), and `COMPREHENSION.md`
(verified account of what Phases 1-3 actually shipped, read in full for this draft, including its §5
honesty-audit note that `RunHaltedError` is declared but never constructed anywhere -- addressed
explicitly in §9 below, not silently absorbed into this phase's scope). Where this spec and the PRD
disagree, the PRD wins and the disagreement is a defect in this spec that must be escalated, not
silently reconciled.

**What Phase 4 is.** The mechanism that closes the two gaps `PHASE_3_SPEC.md` §9 named and deferred
here by name:

1. **Reference attestation.** Every dispatched turn (both executor turns and the reviewer turn alike)
   must genuinely reference multi-loopr's own three canonical loopr artifacts for the run --
   `baby_prd.md`, `context.md`, and the phase spec at `RunConfig.spec_path` -- by recording each in
   its `HandoffRecord.artifacts_read`, not merely being handed their paths and ignoring them. A new
   deterministic guard, `assertLooprArtifactsReferenced()`, checks this against the *reconciled*
   record (Phase 3's ground-truth-recomputed version, never the agent's raw draft) after every turn,
   and throws a new `LooprArtifactBypassError` (exit `12`) when a required path never appears.
2. **Real production of the next artifact.** The reviewer turn -- which Phase 3's own dispatch loop
   treated as "mechanically identical to an executor turn... it does not draft a real
   `PHASE_(N+1)_SPEC.md`" (`PHASE_3_SPEC.md` §0, §9 item 1) -- is now instructed, and mechanically
   held, to genuinely write that next artifact for real: `PHASE_(N+1)_SPEC.md` on an ordinary phase,
   or a completion artifact on the run's own final phase (`RunConfig.is_final_phase`, new this
   phase). A second new deterministic guard, `assertNextPhaseSpecProduced()`, checks that the expected
   path both appears in the reviewer's reconciled `artifacts_written` **and** was actually touched by
   a real commit the reviewer turn made (via `changedPaths()`, Phase 1, unmodified) -- so a stale,
   untouched pre-existing file cannot satisfy the requirement by being merely re-declared.

Both guards are deliberately built as **new, additional** checks alongside Phase 1's existing
`C5_ARTIFACT_ATTESTATION` (`src/verify/continuity.ts`), not as a change to it: C5 verifies generic
handoff continuity between two *consecutive* turns' arbitrary artifact lists; this phase's guards
verify that three *specific, named* loopr artifacts were genuinely referenced by *every* turn and
genuinely produced by the *reviewer* turn specifically -- a different question, answered by a
different, purpose-built check, so `CONTINUITY_CHECKS`'s fixed five-member tuple (PRD §7 I2: "five
git/hash predicates") is not touched. See §9.

**What Phase 4 is not.** multi-loopr still never generates, drafts, or templates the actual prose
content of `baby_prd.md`, `context.md`, or any `PHASE_N_SPEC.md` itself -- the dispatched agent
remains the sole author of that content, exactly as `PHASE_3_SPEC.md` §9 item 1 already established
for phase-spec content specifically, now extended to the same rule for `baby_prd.md`/`context.md`.
No toy build task, no AC1/AC2/AC3 evidence collection or packaging, no open-source packaging (Phase
5, `PHASE_3_SPEC.md` §9 item 3, unchanged). No multi-phase autonomous looping -- one `multi-loopr
run` invocation still dispatches exactly one loopr phase's turn sequence and returns
(`PHASE_3_SPEC.md` §9 item 4, unchanged; `RunConfig.is_final_phase` tells this run's reviewer turn
which artifact to draft, it does not make multi-loopr advance to that next phase itself). See §9.

**Standing constraint for the executor agent (inherited from `PHASE_1_SPEC.md` §0,
`PHASE_2_SPEC.md` §0, and `PHASE_3_SPEC.md` §0, binding here too).** Every public function named in
§6 below must exist with the exact name, exact module path, and exact signature given. This spec
introduces no new external CLI-surface risk at all (Phase 4 adds no provider flags, no new CLI
command, and reuses `buildInvocation`'s already-verified output verbatim, exactly as
`PHASE_3_SPEC.md` §0 already noted for Phase 3) -- every genuinely new decision in this spec is
internal design (which artifacts are required, how "genuinely produced" is checked, the final-phase
branch), marked **[DECISION, Phase 4]** throughout, open to escalation if the executor finds a
concrete reason one is unworkable, but not a vendor fact requiring re-verification.

**Cross-phase modification policy (inherited from `PHASE_2_SPEC.md` §0 and `PHASE_3_SPEC.md` §0,
applied again here).** Phase 4 modifies four already-approved files (three from Phase 1/3,
`src/dispatch/prompt.ts` and `src/dispatch/turn.ts` and `src/dispatch/run-loop.ts` from Phase 3
itself). Each modification in §1 states: (a) why it is additive; (b) that every prior-phase test
exercising the file continues to pass unmodified; (c) why the existing file, not a new Phase 4 file,
is the right place.

---

## §1 Files Added or Modified

All paths are relative to the repo root `C:\Users\hp\multi-loopr`.

### 1.1 New: `src/dispatch/artifacts.ts`

| Path | Purpose |
|---|---|
| `src/dispatch/artifacts.ts` | `nextPhaseSpecPath()`, `assertLooprArtifactsReferenced()`, `assertNextPhaseSpecProduced()` -- the reference-attestation and real-production guards this phase exists to add. |
| `src/dispatch/artifacts.test.ts` | Each function's pass/fail paths, including the two production-failure modes (never declared; declared but not actually touched by a commit) and the final-phase path-selection branch. |

Placed in `src/dispatch/` rather than `src/verify/` because, unlike Phase 1's verifiers
(`continuity.ts`, `boundary.ts`, `commits.ts`, `preflight.ts`), these two functions are not
general-purpose repo verifiers -- they are specific to the dispatch loop's own `RunConfig`-derived
expectations (which paths *this run* designated as `baby_prd_path`/`context_path`/the computed
next-artifact path) and take a `HandoffRecord` plus that run-specific context, the same reason
`record.ts`'s `reconcileHandoffRecord()` (also run-specific, also dispatch-layer) lives in
`src/dispatch/` rather than `src/verify/`.

### 1.2 Modified: `src/domain/run.ts`

**Additive only.** `RunConfig` gains three new fields, appended after `spec_path` (never inserted
mid-list, matching `PHASE_3_SPEC.md` §1.3's own precedent for appending to this same schema):

```
baby_prd_path: RepoRelPathLike,
context_path: RepoRelPathLike,
is_final_phase: z.boolean().default(false),
```

**Why required, not nullable/optional, for the first two.** By the time any `multi-loopr run`
dispatch happens (Phase 1 of a target build or later), loopr's own interrogation stage --
producing `baby_prd.md` and `context.md` -- has necessarily already completed; a `PHASE_N_SPEC.md`
cannot exist without them under loopr's own method (the same chain this very meta-project's own
specs cite as their own "Built from" ancestry). Treating them as optional would let a run silently
skip the exact thing this phase exists to make mechanically un-skippable, matching `spec_path`'s own
already-established required (non-nullable) treatment (`PHASE_3_SPEC.md` §1.3) rather than
introducing a softer rule for a strictly analogous case.

**Why `is_final_phase` defaults `false`, not required.** Every already-shipped `RunConfig` literal in
Phase 3's own test fixtures omits it; defaulting preserves those without requiring a mechanical
rewrite of every existing fixture, the same reasoning `turn_timeout_ms`'s own `.default(1_800_000)`
already established in Phase 1 for a field most callers do not need to think about.

`TurnRequest` (same file, plain interface, not a wire schema) gains three fields, appended after
`timeoutMs`:

```
readonly babyPrdPath: string;
readonly contextPath: string;
readonly expectedArtifactPath: string | null;
```

`babyPrdPath`/`contextPath` are plain repo-relative path strings, not `FileRef`s -- unlike
`specRef`, these two never participate in a cross-turn consistency check (there is no
`C_BABY_PRD_CONTINUITY` analogous to `C4_SPEC_CONTINUITY`; PRD AC3 requires them to be genuinely
*read*, not that they stay byte-identical turn to turn), so no ground-truth hash needs to be
precomputed or threaded for them at all -- `assertLooprArtifactsReferenced()` (§6.1) only needs to
know *which paths* to look for in the reconciled `artifacts_read` list; the hash recorded there is
already trustworthy, because reconciliation (`src/dispatch/record.ts`, Phase 3, unmodified) already
recomputes every surviving `artifacts_read` entry's hash from the real file and drops any entry
whose path does not resolve to a real file. `expectedArtifactPath` is `null` for every executor
turn and the computed next-artifact path (§6.1) for the reviewer turn -- the same "null unless this
specific slot needs it" shape `diff` already uses in `run-loop.ts`'s `BuildPromptInput` (Phase 3).

**Regression constraint.** Both `RunConfig` and `TurnRequest` gain fields only at the end of their
existing field lists; every Phase 1-3 test that constructs either literal with the pre-Phase-4 field
set now fails to type-check only where a literal is missing the two newly-required `RunConfig`
fields -- which is exactly the same, already-accepted category of change `PHASE_3_SPEC.md` §1.3 made
when it added `phase`/`spec_path` as required fields onto the same schema; those call sites must add
the two new fields, not be exempted from them.

### 1.3 Modified: `src/domain/errors.ts`

**Additive only**, following `PHASE_2_SPEC.md` §1.2's and `PHASE_3_SPEC.md` §1.4's exact precedent
(append after the existing eleven, never renumber):

```
ExitCode.LOOPR_ARTIFACT_BYPASSED = 12
```

`class LooprArtifactBypassError extends MultiLooprError` -- `exitCode =
ExitCode.LOOPR_ARTIFACT_BYPASSED`, `code = "LOOPR_ARTIFACT_BYPASSED"`.

**Why one error class covers both new guards, not two.** `assertLooprArtifactsReferenced()` and
`assertNextPhaseSpecProduced()` are two different mechanical checks but the same *kind* of failure
under PRD AC3 -- "the agent did not genuinely engage with loopr's own artifacts" -- exactly the same
reasoning `BoundaryViolationError`/exit `7` already covers boundary rules B1-B6 and B8 (six distinct
rule violations, one exit code) rather than one exit code per rule. The distinguishing detail lives
in the thrown error's own `message`/`details`, not in a proliferation of exit codes.

**Regression constraint.** Same as `PHASE_3_SPEC.md` §1.4's own: `exitCodeFor()` already handles any
`MultiLooprError` subclass generically (unchanged since Phase 1); no Phase 1-3 test asserts the exact
membership of `ExitCode`, so none breaks.

### 1.4 Modified: `src/dispatch/prompt.ts`

**Additive only.** `ProtocolInstructionParams` gains `babyPrdRepoRelPath: string` and
`contextRepoRelPath: string`; `buildProtocolInstructions()` gains two new mandatory-content items
(§6.2). `BuildExecutorPromptParams` and `BuildReviewerPromptParams` each gain the same two fields,
threaded straight into their own `buildProtocolInstructions()` call. `BuildReviewerPromptParams`
additionally gains `expectedArtifactPath: string` (always present for a reviewer turn -- unlike the
executor params, there is no "reviewer turn with nothing to produce" case in V1) and
`isFinalPhase: boolean`. A new exported function, `buildArtifactProductionInstructions()`, is
concatenated into `buildReviewerPrompt()`'s output only (§6.2) -- executors are never asked to
produce the next artifact; that is the reviewer archetype's own defining responsibility (PRD §6:
"verifies... then generates the next phase spec").

**Why here, why now.** This file is already "the role-profile injection and isolation-respecting
cross-turn context assembly" layer (its own header comment); the two new mandatory-content items are
the same kind of content `buildProtocolInstructions()` already renders (a literal path the agent must
act on), and `buildArtifactProductionInstructions()` is the same kind of reviewer-only addendum
`buildReviewerPrompt()` already appends its diff block as (§6.2 below shows the exact concatenation
order). No new file is warranted for two functions and one field addition to three existing ones.

**Regression constraint.** Every existing mandatory-content item `PHASE_3_SPEC.md` §6.2 specified
(the six original items) is unchanged in wording and still present; `prompt.test.ts`'s existing
substring assertions for those six continue to pass unmodified, since nothing removes or alters them
-- this phase only adds more literal substrings to check for.

### 1.5 Modified: `src/dispatch/turn.ts`

**Additive only.** `runTurn()`'s fixed order (`PHASE_3_SPEC.md` §6.4, steps 1-10) gains two new steps
inserted between the existing step 7 (`reconcileHandoffRecord()`) and step 8
(`assertNeutralCommits()`) -- see §6.3 below for the exact insertion. Every one of Phase 3's original
ten steps keeps its own relative order and behaviour unchanged; the two new steps are additions, not
replacements.

**Why here, why now.** `runTurn()` is already the single place "one turn end to end" happens, and is
already where `assertNeutralCommits()` -- a structurally identical "hard invariant, checked against
the reconciled record, throws uncaught on violation" guard -- lives. The two new guards are the same
shape of check on the same reconciled record Phase 3 already produces at this exact point in the
function; a separate file or separate call site would duplicate `runTurn()`'s own sequencing logic
for no benefit.

**Regression constraint.** `turn.test.ts`'s existing fixtures (a temp repo whose fixture
`HandoffRecord` drafts do not reference `baby_prd.md`/`context.md`) will newly fail the added checks
unless updated -- this is an *intended* consequence of a new invariant being enforced, not a
regression in the sense `PHASE_2_SPEC.md`/`PHASE_3_SPEC.md`'s "additive" language protects against
(that language protects existing *behaviour* other code relies on, not test fixtures that must now
supply data a new mandatory field requires -- the same category of change `PHASE_3_SPEC.md` §1.3
itself made when `RunConfig` gained required fields). Every test not exercising these two new checks
directly must still pass unmodified.

### 1.6 Modified: `src/dispatch/run-loop.ts`

**Additive only.** `runExtendedPreflight()` gains two more readability checks (`baby_prd_path`,
`context_path`), folded into the same `PREFLIGHT_FAILED` outcome exactly as `spec_path`'s own check
already is (`PHASE_3_SPEC.md` §6.5 step 1). `runTurnLoop()` computes
`nextArtifactPath = nextPhaseSpecPath(config.spec_path, config.phase, config.is_final_phase)` once,
alongside its existing once-computed `specRef`, and threads `config.baby_prd_path`,
`config.context_path`, and (reviewer slot only) `nextArtifactPath` into every constructed
`TurnRequest` and into `buildPromptForSlot()`'s reviewer branch. See §6.4 for the exact changes.

**Why here, why now.** `run-loop.ts` is already the one place that resolves `RunConfig` fields into
per-turn `TurnRequest`/prompt values (`specRef`, `modelOverride`, `diff` are already resolved exactly
once here and threaded per slot) -- the three new fields are the same shape of resolution, reusing
the same call sites rather than inventing a second orchestration layer.

**Regression constraint.** `run-loop.test.ts`'s existing scenario fixtures construct `RunConfig`
literals that will need the two new required fields added (§1.2's regression note applies
identically here); every existing scenario's *assertions* about turn count, exit codes, and retry
behaviour for the failure modes Phase 3 already tested are unchanged and must still pass once those
fixtures are updated with valid `baby_prd_path`/`context_path` values.

### 1.7 Full Phase 4 file manifest

| Path | Status |
|---|---|
| `src/dispatch/artifacts.ts` | new |
| `src/dispatch/artifacts.test.ts` | new |
| `src/domain/run.ts` | modified (additive) |
| `src/domain/errors.ts` | modified (additive) |
| `src/dispatch/prompt.ts` | modified (additive) |
| `src/dispatch/turn.ts` | modified (additive) |
| `src/dispatch/run-loop.ts` | modified (additive) |
| `README.md` | modified (one sentence, per `PHASE_3_SPEC.md` §8 item 32's own precedent) |

No other file changes. In particular: `src/adapters/**`, `src/verify/**` (including
`continuity.ts` and its fixed `CONTINUITY_CHECKS` five-member tuple), `src/domain/relay.ts` (the
`HandoffRecord` schema itself -- see §3.3 for why no schema change is needed), `src/domain/tiers.ts`,
`src/domain/roles.ts`, `src/ports/provider-adapter.ts`, `src/util/exec.ts`, `src/util/hash.ts`,
`src/util/lock.ts`, `src/util/paths.ts`, `src/dispatch/plan.ts`, `src/dispatch/record.ts`,
`src/cli/run.ts`, `src/cli/main.ts`, `src/cli/doctor.ts` are untouched -- Phase 4 *consumes* every
one of these, unmodified.

---

## §2 Dependencies

**No change.** `package.json` `dependencies` still contains exactly `zod` (boundary rule B2
unchanged). `devDependencies` still contains exactly `typescript` and `@types/node`. Phase 4 needs no
new package: the two new guards are array/string comparisons plus one already-existing git wrapper
call (`changedPaths()`, Phase 1, unmodified); prompt changes are string concatenation, identical in
kind to everything `prompt.ts` already does. `tsconfig.json` is unchanged -- `rootDir: "src"` already
covers `src/dispatch/artifacts.ts` with no edit required.

---

## §3 Schemas and Data Models

### 3.1 `src/domain/run.ts` -- `RunConfig` additions

Already specified in full in §1.2. Restated here for completeness, in the order they append to the
existing field list:

```
baby_prd_path: RepoRelPathLike,
context_path: RepoRelPathLike,
is_final_phase: z.boolean().default(false),
```

### 3.2 `src/domain/run.ts` -- `TurnRequest` additions (plain interface, not zod -- in-process only)

Already specified in full in §1.2:

```
readonly babyPrdPath: string;
readonly contextPath: string;
readonly expectedArtifactPath: string | null;
```

### 3.3 `src/domain/errors.ts` -- `ExitCode.LOOPR_ARTIFACT_BYPASSED` / `LooprArtifactBypassError`

Already specified in full in §1.3.

### 3.4 `src/dispatch/artifacts.ts` -- plain types (not zod; run-specific, like `RecordGroundTruth`)

```
export interface LooprArtifactPaths {
  readonly babyPrdPath: string;
  readonly contextPath: string;
  readonly specPath: string;
}
```

### 3.5 No change to `HandoffRecord` (`src/domain/relay.ts`)

**Deliberate, and worth stating explicitly.** Both new guards operate entirely on
`HandoffRecord.artifacts_read`/`artifacts_written` -- fields Phase 1 already shipped as general,
capped `FileRef` arrays (§3.4 of `PHASE_1_SPEC.md`, fields 12-13). "Genuinely reference `baby_prd.md`"
means "an entry with that path survives ground-truth reconciliation into `artifacts_read`," which the
existing schema and existing reconciliation logic (`src/dispatch/record.ts`, unmodified this phase)
already fully support -- no new field, no new refinement, no schema-version bump. This is the
smallest-footprint way to satisfy AC3's reference-attestation requirement and is preferred over adding
dedicated `baby_prd_ref`/`context_ref` fields to `HandoffRecord`, which would duplicate a mechanism
the schema already has.

### 3.6 No change to `RunReport` (`src/cli/run.ts`)

**Deliberate.** `PHASE_3_SPEC.md` §9 item 2 already deferred "any human-readable 'artifact
provenance' report beyond what `RunReport`/the persisted `HandoffRecord` files already give
mechanically" to this phase, and this phase does not build one: a `LooprArtifactBypassError` is an
ordinary uncaught `MultiLooprError`, handled by the exact same generic propagation path
`BoundaryViolationError` already uses (§6.3) -- `RunReport.exit_code` and (for a failure caught inside
`runDispatch`'s own turn loop, which this is not -- see §6.3) `RunReport.problems` already communicate
it without a new field.

---

## §4 CLI Surface

**No new command and no new flag.** Phase 4 adds no CLI surface of its own; `multi-loopr run --config
<path> [--json]` (`PHASE_3_SPEC.md` §4) is unchanged. The operator-supplied `--config` JSON file gains
three new keys (§3.1) that `RunConfig.safeParse()` (unchanged call site, `src/cli/run.ts`) now
requires two of and defaults the third.

### 4.1 Exit codes (extends `PHASE_3_SPEC.md` §4.3; no existing code's meaning changes)

| Code | Name | Raised by `run` when |
|---|---|---|
| `12` | LOOPR_ARTIFACT_BYPASSED | a turn's reconciled `artifacts_read` is missing a reference to `baby_prd_path`, `context_path`, or `spec_path` (`assertLooprArtifactsReferenced()`), **or** the reviewer turn's reconciled `artifacts_written` does not genuinely include the computed next-artifact path as a real, turn-touched file (`assertNextPhaseSpecProduced()`) |

**Precedence, same rule as I4 (`PHASE_3_SPEC.md` §4.3).** Both new guards run inside `runTurn()`
before `assertNeutralCommits()` and before the record is persisted (§6.3); a violation is an uncaught
throw that propagates out of `runDispatch()` exactly as `BoundaryViolationError` already does --
first-failure-wins, no further turns dispatched, and (because the throw happens inside the `try` that
wraps `acquireRunLock`/`releaseRunLock`, §6.5 of `PHASE_3_SPEC.md`, unchanged) the run lock is still
released via the existing `finally`.

### 4.2 Stream discipline

Unchanged from `PHASE_1_SPEC.md` §4.4 / `PHASE_3_SPEC.md` §4.4.

---

## §5 Migrations

**N/A, same rationale as `PHASE_1_SPEC.md`/`PHASE_2_SPEC.md`/`PHASE_3_SPEC.md` §5.** Phase 4
introduces no new persistent, versioned format: `HandoffRecord` (`schema_version: 1`) is unchanged
(§3.5); the run lock is unchanged; the two artifacts a reviewer turn now genuinely writes
(`PHASE_(N+1)_SPEC.md` or the final-phase completion artifact) are ordinary target-repo files the
dispatched agent authors and commits itself, not a multi-loopr-owned format multi-loopr generates,
templates, or migrates.

---

## §6 Implementation Logic Flow

### 6.1 `src/dispatch/artifacts.ts`

```
export function nextPhaseSpecPath(specPath: string, phase: number, isFinalPhase: boolean): string
export interface LooprArtifactPaths {
  readonly babyPrdPath: string;
  readonly contextPath: string;
  readonly specPath: string;
}
export function assertLooprArtifactsReferenced(record: HandoffRecord, expected: LooprArtifactPaths): void
export async function assertNextPhaseSpecProduced(
  repoDir: string,
  record: HandoffRecord,
  expectedPath: string,
): Promise<void>
```

**`nextPhaseSpecPath(specPath, phase, isFinalPhase)`.** **[DET, DECISION Phase 4]**
- If `isFinalPhase`: returns the literal `"BUILD_COMPLETE.md"` -- the same final-phase artifact name
  this project's own loopr method already uses for itself (visible directly in this repo's own root),
  adopted here as the general convention for any target build multi-loopr drives, not a
  meta-project-specific special case.
- Else: returns `` `${dir}PHASE_${String(phase + 1)}_SPEC.md` ``, where `dir` is `specPath`'s own
  directory prefix (everything up to and including its last `/`, or `""` if `specPath` has none) --
  preserving whatever directory convention the target repo's specs already live in (root, in every
  case this project's own specs demonstrate, but `RepoRelPath` does not require that) rather than
  hardcoding a root-only assumption. Does not read or parse `specPath`'s own filename number; `phase
  + 1` is computed from `RunConfig.phase` directly, which is already the authoritative source of
  "which phase this run is" (`PHASE_3_SPEC.md` §1.3) -- deriving the next number from the *config*
  rather than by regex-parsing the *filename* is deliberately the more robust of the two available
  designs, since an operator-chosen `spec_path` string is not guaranteed to embed the phase number in
  a parseable form.

**`assertLooprArtifactsReferenced(record, expected)`.** **[DET, DECISION Phase 4, PRD §2 AC3]** For
each of `expected.babyPrdPath`, `expected.contextPath`, `expected.specPath`: passes iff
`record.artifacts_read` contains an entry whose `path` equals it. Because `record` is always the
*reconciled* `HandoffRecord` (§6.3 below -- never the agent's raw draft), a surviving entry is already
proof the path resolved to a real file at reconciliation time with a truthfully recomputed hash
(`reconcileHandoffRecord()`, Phase 3, unmodified, drops any `artifacts_read` entry that does not
resolve); this function does not need, and does not accept, expected hash values -- only expected
paths. On any missing path, throws `LooprArtifactBypassError` naming every missing path, not only the
first (so a single failing turn reports its complete deficiency in one throw, not one guard failure
at a time across retries -- there is no retry for this error class regardless, §7, so completeness of
the single report matters more than for a retryable check).

**`assertNextPhaseSpecProduced(repoDir, record, expectedPath)`.** **[DET, DECISION Phase 4, PRD §2
AC3]** Two-part check, both required:
1. `record.artifacts_written` contains an entry whose `path === expectedPath`. Missing -> throw.
2. `await changedPaths(repoDir, record.repo.head_before, record.repo.head_after)` (Phase 1's
   `src/verify/git.ts`, unmodified) includes `expectedPath`. Absent -> throw, naming this as "declared
   in `artifacts_written` but not actually touched by any commit this turn made" -- the literal,
   mechanical distinction between a turn that wrote the artifact for real and one that merely
   re-declared a stale, already-existing file to satisfy part 1 alone.

**Why two parts, not one.** Part 1 alone (matching Phase 1's own `reconcileHandoffRecord()` treatment
of any other `artifacts_written` entry) proves the file exists and has a real hash, but a file that
already existed before this turn started and was never touched would still pass it -- exactly the
"bypass" AC3 exists to catch, since "produced... not bypassed" requires the artifact to be new work
from *this* turn, not a pre-existing file merely pointed at. Part 2 closes that gap using
`changedPaths()`, a primitive Phase 1 already built and `verifyContinuation()`'s own `C3_NO_REVERT`
already uses for a structurally similar purpose (which paths did a turn's own commits actually touch)
-- no new git wrapper is needed.

### 6.2 `src/dispatch/prompt.ts` changes

```
export interface ProtocolInstructionParams {
  readonly handoffAbsPath: string;
  readonly role: "executor" | "reviewer";
  readonly specRepoRelPath: string;
  readonly babyPrdRepoRelPath: string;   // new, Phase 4
  readonly contextRepoRelPath: string;   // new, Phase 4
}

export function buildArtifactProductionInstructions(expectedArtifactPath: string, isFinalPhase: boolean): string
```

**`buildProtocolInstructions(p)` mandatory-content additions**, tested individually by substring
exactly as `PHASE_3_SPEC.md` §6.2's original six items already are:
7. The literal `p.babyPrdRepoRelPath`, with an instruction that the agent must read it and record it
   in `artifacts_read` -- loopr's foundational problem-statement artifact for this build.
8. The literal `p.contextRepoRelPath`, same instruction -- loopr's foundational context artifact.

**`buildArtifactProductionInstructions(expectedArtifactPath, isFinalPhase)`.** **[DECISION Phase 4]**
New function, reviewer-only (never called from `buildExecutorPrompt()`). Prose is not fixed verbatim
(same tolerance as every other prose block in this file), but two items are load-bearing and tested
by substring:
1. The literal `expectedArtifactPath`, as the exact repo-relative path the reviewer must write real
   content to.
2. An explicit statement, branching on `isFinalPhase`, of *what* that content must be: on a non-final
   phase, "the real next phase's technical blueprint, `PHASE_(N+1)_SPEC.md`, following this project's
   own established spec structure" (deliberately not more prescriptive than that -- multi-loopr does
   not template or validate the content, §9); on the final phase, "this build's completion record."
   Both branches state that the path must also be recorded, with its real hash, in `artifacts_written`
   -- otherwise multi-loopr will treat the phase as bypassed, not completed (naming the mechanical
   consequence up front, the same transparency `buildProtocolInstructions()`'s existing "advisory
   only... overwrites" clause already models for `repo`/`spec_ref`).

**`buildReviewerPrompt(params)` concatenation order, extended.** `getRole("reviewer").profileSummary`
+ `buildProtocolInstructions(...)` (now including items 7-8) +
`buildArtifactProductionInstructions(params.expectedArtifactPath, params.isFinalPhase)` +
`buildHandoffContext(params.priorRecord)` + the capped diff + (`params.retryNote` when non-null). The
production instructions are placed immediately after the protocol instructions and before the
handoff/diff context, matching the existing ordering convention that instructions-about-the-task
precede context-about-prior-work.

**`buildExecutorPrompt(params)` concatenation order, extended.** Unchanged in shape --
`getRole("executor").profileSummary` + `buildProtocolInstructions(...)` (now including items 7-8,
threaded from the new `babyPrdRepoRelPath`/`contextRepoRelPath` params) + prior-record context (when
present) + retry note (when present). No production-instruction block is ever added for an executor
turn.

### 6.3 `src/dispatch/turn.ts` changes -- `runTurn()`'s fixed order, extended

`PHASE_3_SPEC.md` §6.4's ten steps are unchanged in relative order; two new steps are inserted between
step 7 (`reconcileHandoffRecord()`) and the renumbered step 8 (`assertNeutralCommits()`):

7. `reconciled = await reconcileHandoffRecord(...)` -- unchanged (Phase 3).
7.5. **[DECISION Phase 4]** `assertLooprArtifactsReferenced(reconciled, { babyPrdPath: req.babyPrdPath,
   contextPath: req.contextPath, specPath: req.specRef.path })` -- runs for **every** turn
   (executor and reviewer alike). A thrown `LooprArtifactBypassError` is **not** caught here; it
   propagates unmodified, exactly matching `assertNeutralCommits()`'s own existing uncaught-throw
   contract for `BoundaryViolationError` one step later.
7.6. **[DECISION Phase 4]** `if (req.expectedArtifactPath !== null) { await
   assertNextPhaseSpecProduced(req.repoDir, reconciled, req.expectedArtifactPath); }` -- a no-op for
   every executor turn (`expectedArtifactPath` is always `null` there, §6.4); runs only for the
   reviewer turn. Same uncaught-throw contract.
8. `assertNeutralCommits(...)` -- unchanged (Phase 1/3), now runs only once both new guards have
   already passed.
9. `writeHandoffRecord(...)` -- unchanged. **Both new guards run before this step**, so (matching I4's
   existing guarantee for `assertNeutralCommits()`) a bypassed or non-produced-artifact turn's record
   is never persisted to `.multi-loopr/runs/**` -- only a turn that cleared every hard invariant ever
   reaches disk.
10. Return `{ outcome, record: reconciled }` -- unchanged.

### 6.4 `src/dispatch/run-loop.ts` changes

**`runExtendedPreflight()` (§6.5 of `PHASE_3_SPEC.md`), extended.** After the existing `spec_path`
readability check, two more of the identical shape:

```
for (const [label, path] of [["baby_prd_path", config.baby_prd_path], ["context_path", config.context_path]] as const) {
  try {
    await sha256File(repoRelToAbs(config.repo_dir, path));
  } catch {
    problems.push(`${label} "${path}" does not resolve to a readable file in "${config.repo_dir}".`);
    ok = false;
  }
}
```

Folded into the same single `PREFLIGHT_FAILED` outcome as `spec_path`'s own check -- **[DECISION
Phase 4]**, same reasoning `PHASE_3_SPEC.md` §6.5 step 1 already gave for `spec_path`: one more
precondition on "is everything this run needs actually present," not a new exit code.

**`runTurnLoop()`, extended.** Once, before the turn loop (alongside the existing once-computed
`specRef`):

```
const nextArtifactPath = nextPhaseSpecPath(config.spec_path, config.phase, config.is_final_phase);
```

`dispatchOneAttempt()`'s constructed `TurnRequest` gains:

```
babyPrdPath: config.baby_prd_path,
contextPath: config.context_path,
expectedArtifactPath: slot.archetype === "reviewer" ? nextArtifactPath : null,
```

`buildPromptForSlot()`'s reviewer branch passes `babyPrdRepoRelPath: input.specRepoRelPath === ... `
-- concretely, threads `config.baby_prd_path`/`config.context_path` (available via a new
`babyPrdRepoRelPath`/`contextRepoRelPath` field on `BuildPromptInput`, appended the same way
`specRepoRelPath` already is) into both `buildExecutorPrompt()`'s and `buildReviewerPrompt()`'s calls,
and additionally passes `expectedArtifactPath: nextArtifactPath` and `isFinalPhase:
config.is_final_phase` into the reviewer-only `buildReviewerPrompt()` call.

**No change to the turn loop's own control flow** (planning, the lock, the continuity-retry bound,
halt propagation) -- every addition in this file is a value computed once and threaded through
already-existing parameter-passing paths, not a new branch in `runTurnLoop()`'s own sequencing logic.

---

## §7 Failure-Mode Guards

| FM / Guard | Guard in Phase 4 | Reviewer check (mechanical) |
|---|---|---|
| **AC3 reference attestation** (new, PRD §2 AC3) | `assertLooprArtifactsReferenced()` runs inside `runTurn()` for every turn, against the reconciled record, before that record is persisted. | 1. Confirm `turn.ts` calls it after `reconcileHandoffRecord()` and before `assertNeutralCommits()`. 2. Confirm it runs unconditionally for both `executor` and `reviewer` archetypes (no archetype-gated skip). 3. Dedicated test: a fixture draft that omits `context_path` from `artifacts_read` is rejected with `LOOPR_ARTIFACT_BYPASSED` (exit `12`), naming `context_path` specifically. |
| **AC3 real production** (new, PRD §2 AC3) | `assertNextPhaseSpecProduced()` runs only for the reviewer slot (`req.expectedArtifactPath !== null`), checking both `artifacts_written` membership and real-commit membership via `changedPaths()`. | 1. Confirm the guard is skipped (no-op) for every executor `TurnRequest` (`expectedArtifactPath === null`). 2. Dedicated test: a reviewer draft that declares the next-spec path in `artifacts_written` but whose commits never touch that path is rejected (part 2 of the check, §6.1). 3. Dedicated test: a reviewer draft that never declares the path at all is rejected (part 1). 4. Dedicated test: a reviewer draft that genuinely writes and commits the real next-spec file passes. |
| **FM2 isolation leak (unchanged, extended coverage)** | The two new mandatory-content items (`babyPrdRepoRelPath`/`contextRepoRelPath`) are plain repo-relative path strings injected the same way `specRepoRelPath` already is -- never provider stdout/stderr, never a `HandoffRecord`'s non-allow-listed field. `buildArtifactProductionInstructions()` takes only a path string and a boolean, never a `HandoffRecord` or `RawInvocationResult`. | 1. Grep `src/dispatch/artifacts.ts` and the new `prompt.ts` additions for a `RawInvocationResult`/`.stdout`/`.stderr` reference -- zero hits (same check `PHASE_3_SPEC.md` §7's FM2 row already runs, re-run against the new code). |
| **Phase-4-local guard -- bounded retry scope (extends `PHASE_3_SPEC.md` §7's own row)** | `LooprArtifactBypassError` joins the same "halts on first occurrence, zero retry" bucket as `BoundaryViolationError`, `PreflightError`, `LockHeldError`, `RelaySchemaError`/`IsolationLeakError`, and `TurnTimeoutError` -- retries remain scoped **exclusively** to a non-`CONTINUED` continuity verdict, unchanged from Phase 3. | 1. Dedicated test confirms a `LooprArtifactBypassError` from either new guard results in zero retry -- the run halts at exit `12` on the very first occurrence, joining `PHASE_3_SPEC.md` §8 item 21's existing "zero retry" test family rather than a new, separately-scoped retry path. |
| **No change to `CONTINUITY_CHECKS`** | `src/verify/continuity.ts` is untouched this phase (§1.7); `verifyContinuation()` still runs exactly five checks, in the same fixed order, unaware the two new guards exist. | 1. Confirm `git diff` between the Phase 3 and Phase 4 approval commits touches no path under `src/verify/**`. 2. Confirm `CONTINUITY_CHECKS.length === 5` still holds (unchanged constant). |
| **HARD BOUNDARY (PRD §5.1)** | No B1-B8 pattern anywhere in `src/dispatch/artifacts.ts` or the modified files -- no B7 exemption here either, matching `PHASE_3_SPEC.md` §7's own equivalent row exactly (only `src/adapters/**` is ever exempted). | 1. `node src/cli/main.ts doctor --boundary` exits `0`. 2. Grep the new/modified files for `opus\|sonnet\|haiku\|fable\|gpt-5\|claude-\|o[34]-` -- zero hits. |

---

## §8 Phase Acceptance Criteria

Phase 4 is approved only when **every** item below is objectively true.

**Regression (no prior-phase behaviour broken)**
1. `npm run typecheck` exits `0` with **zero** diagnostics, across the full tree including
   `src/dispatch/artifacts.ts`.
2. `npm run test` exits `0`. Every Phase 1-3 test file passes, with fixture updates limited strictly
   to supplying the newly-required `RunConfig`/`TurnRequest` fields (§1.5/§1.6's own stated
   consequence) -- no assertion about pre-existing behaviour is altered.
3. `node src/cli/main.ts doctor --boundary` exits `0`.
4. `npm run check` exits `0`.
5. `node src/cli/main.ts --version`, `--help`, `doctor`, `doctor --json`, `doctor --boundary`,
   `doctor --providers`, and `run --config <path> [--json]`'s own flag parsing (missing `--config`,
   unknown flag) all behave byte-identically to `PHASE_1_SPEC.md`/`PHASE_3_SPEC.md` §4.

**Static discipline**
6. `z.object(` and `z.string().datetime(` do not appear anywhere under `src/dispatch/artifacts.ts`.
7. The token `any` does not appear as a type annotation under `src/dispatch/artifacts.ts` or any
   modified file's new code.
8. `enum `, `namespace `, and constructor parameter properties appear nowhere under
   `src/dispatch/artifacts.ts`.
9. `node:child_process` is still imported in exactly one file in the whole tree: `src/util/exec.ts`
   (unchanged) -- confirms `assertNextPhaseSpecProduced()` reaches git exclusively through
   `changedPaths()`, never by spawning its own process.

**Behaviour -- path computation**
10. `nextPhaseSpecPath("PHASE_3_SPEC.md", 3, false) === "PHASE_4_SPEC.md"`.
11. `nextPhaseSpecPath("specs/PHASE_2_SPEC.md", 2, false) === "specs/PHASE_3_SPEC.md"` (directory
    prefix preserved).
12. `nextPhaseSpecPath("PHASE_5_SPEC.md", 5, true) === "BUILD_COMPLETE.md"` (the `isFinalPhase`
    branch overrides the phase-number-increment branch entirely, regardless of `phase`'s value).

**Behaviour -- reference attestation**
13. A reconciled `HandoffRecord` whose `artifacts_read` contains all three of `baby_prd_path`,
    `context_path`, and `spec_path` passes `assertLooprArtifactsReferenced()` -- dedicated test.
14. A reconciled `HandoffRecord` missing any one, two, or all three of those paths from
    `artifacts_read` throws `LooprArtifactBypassError` naming every missing path, not only the first
    -- dedicated tests for each combination.
15. `runTurn()` calls `assertLooprArtifactsReferenced()` for **both** executor turns and the reviewer
    turn -- dedicated test per archetype confirming the guard is not skipped for any of the three
    turn slots.

**Behaviour -- real production**
16. A reviewer `HandoffRecord` whose `artifacts_written` includes the computed next-artifact path,
    and whose turn's own commits (per `changedPaths(repoDir, head_before, head_after)`) genuinely
    touch that same path, passes `assertNextPhaseSpecProduced()` -- dedicated test against a real
    temporary git repo.
17. A reviewer `HandoffRecord` that never declares the next-artifact path in `artifacts_written`
    throws `LooprArtifactBypassError` -- dedicated test.
18. A reviewer `HandoffRecord` that declares the next-artifact path in `artifacts_written` but whose
    turn's commits never touch that path (a pre-existing, untouched file merely re-declared) throws
    `LooprArtifactBypassError`, distinguishably from item 17's failure (different message content) --
    dedicated test.
19. `assertNextPhaseSpecProduced()` is never called for an executor `TurnRequest`
    (`expectedArtifactPath === null`) -- dedicated test confirms no throw and no git call occurs for
    an executor turn regardless of what that turn's own commits touched.
20. `runDispatch()` against a `RunConfig` with `is_final_phase: true` computes and enforces
    `"BUILD_COMPLETE.md"` as the reviewer's expected artifact path instead of a `PHASE_N_SPEC.md`
    pattern -- dedicated end-to-end scenario test in `run-loop.test.ts`.

**Behaviour -- retry scoping and persistence**
21. A `LooprArtifactBypassError` from either new guard results in **zero retry**: `runDispatch()`
    halts at `exitCode: 12` on first occurrence, joining the existing zero-retry test family
    (`PHASE_3_SPEC.md` §8 item 21) -- dedicated test.
22. When either new guard throws, `writeHandoffRecord()` is never called for that turn -- the
    would-be-bypassed record is not persisted to `.multi-loopr/runs/**` -- dedicated test confirming
    no file is written at that turn's `handoffPath()`.

**Behaviour -- preflight**
23. A `RunConfig` whose `baby_prd_path` or `context_path` does not resolve to a readable file in
    `repo_dir` fails preflight (`exitCode: ExitCode.PREFLIGHT_FAILED`, `3`) before the lock is
    acquired and before any turn is dispatched -- dedicated tests for each of the two paths
    independently, extending `PHASE_3_SPEC.md` §8 item 14's existing `spec_path` test family.

**Behaviour -- prompt assembly**
24. `buildProtocolInstructions()`'s output contains the literal `babyPrdRepoRelPath` and
    `contextRepoRelPath` values passed to it, tested individually by substring, alongside the six
    original items from `PHASE_3_SPEC.md` §6.2 (still present, still tested).
25. `buildReviewerPrompt()`'s output contains the literal `expectedArtifactPath` and, branching on
    `isFinalPhase`, either the next-phase-spec framing or the completion-artifact framing -- tested
    individually by substring for both branches.
26. `buildExecutorPrompt()`'s output never contains `buildArtifactProductionInstructions()`'s output
    -- dedicated test confirms an executor prompt built with the same `babyPrdRepoRelPath`/
    `contextRepoRelPath` values as a reviewer prompt in the same fixture does not contain the
    production-instruction substrings the reviewer prompt does.

**Contract coverage** (dedicated-test presence and correctness, continuing `PHASE_1_SPEC.md` §1.6's
own established convention -- no blanket coverage-percentage target)
27. Every function named in §6 has at least one dedicated test. `artifacts.test.ts`'s tests for
    `assertNextPhaseSpecProduced()` use a **real temporary git repository** (`continuity.test.ts`'s
    and `record.test.ts`'s own established pattern) -- no test in this phase spawns a real `claude`
    or `codex` process.
28. `RunConfig`'s three new fields each have a dedicated schema test: `baby_prd_path`/`context_path`
    reject an absolute path and a path with a `..` segment (mirroring `PHASE_3_SPEC.md` §8 item 31's
    existing `spec_path` test shape exactly); `is_final_phase` defaults to `false` when omitted and
    accepts an explicit `true`.

**Documentation**
29. `README.md` gains, at most, a one-line mention that `run` now enforces genuine loopr-artifact
    reference and production -- no operational tutorial, and no claim about Phase 5 functionality
    (the toy build task, AC1-AC3 evidence packaging) that this phase does not ship.

---

## §9 Explicit NON-GOALS

Phase 4 does **not** build the following. A pull of any item below into Phase 4 is a scope violation
and must be rejected by the review agent even if the code is correct.

**Content generation -- still never multi-loopr's job**
1. Generating, templating, or validating the actual prose content of `baby_prd.md`, `context.md`, or
   any `PHASE_N_SPEC.md`/`BUILD_COMPLETE.md`. `buildArtifactProductionInstructions()` tells the
   reviewer *where* to write and *that* it must be real, substantive content, not *what* that content
   must say -- exactly the same restraint `PHASE_3_SPEC.md` §9 item 1 already established for
   `spec_path` and extended here to the two newly-in-scope artifact types. The two new guards check
   **provenance** (was it genuinely written this turn, by this turn's own commits) never **quality**
   or **correctness** of what was written -- that remains the loopr method's own review discipline,
   exercised by the dispatched reviewer archetype itself, not a mechanical multi-loopr check.
2. Any content-shape validation of the produced artifact (e.g. checking `PHASE_(N+1)_SPEC.md` has a
   `§0 Phase Plan Header` or any other section). `assertNextPhaseSpecProduced()` checks existence and
   turn-provenance only.

**RunHaltedError -- explicitly not this phase's concern**
3. `COMPREHENSION.md`'s own honesty audit (Phase 3) noted, as a minor, non-blocking observation, that
   `RunHaltedError` is declared in `src/domain/errors.ts` but never constructed anywhere --
   `run-loop.ts` reports a halted run by returning a `RunResult` with `exitCode:
   ExitCode.RUN_HALTED` directly, consistent with its own explicit, unchanged contract ("never throws
   a `MultiLooprError` for a modelled failure... returns the exit code"). Phase 4's own new failure
   mode (`LooprArtifactBypassError`) follows the *opposite*, already-established pattern instead --
   an uncaught throw, the same shape `BoundaryViolationError` already uses -- because both new guards
   fire from inside `runTurn()`, one layer below `run-loop.ts`'s own "return, don't throw" contract,
   exactly where `assertNeutralCommits()` already throws uncaught today. Neither of Phase 4's new
   guards gives any new reason to change `run-loop.ts`'s "returns, never throws for a modelled
   failure" design, or to retroactively construct `RunHaltedError` for real. That remains exactly
   what `COMPREHENSION.md` already said it was: legitimate future work *only if* a later phase
   deliberately refactors `run-loop.ts` toward uniformly throwing `MultiLooprError` subclasses instead
   of returning them -- a design change with its own justification requirement, not something to
   smuggle in as a side effect of this phase's unrelated additions. If no future phase ever makes that
   change, reconsidering whether `RunHaltedError` needs to exist at all is the correct resolution, not
   forcing a construction site into code that has no other reason to need one.

**Deferred to Phase 5 (Acceptance harness)**
4. The toy build task's actual content, end-to-end AC1/AC2/AC3 evidence collection or packaging,
   open-source packaging (`PHASE_3_SPEC.md` §9 item 3, unchanged).
5. Deciding, tracking, or auto-detecting how many total phases a given target build has, or which
   phase is genuinely "final." `RunConfig.is_final_phase` is an operator-supplied boolean for *this*
   run; multi-loopr does not infer it from any file, count, or prior run's history. Phase 5's toy
   build task is where a real multi-phase run's final-phase boundary is actually exercised end to
   end.
6. **Multi-phase autonomous looping** (`PHASE_3_SPEC.md` §9 item 4, unchanged). One `multi-loopr run`
   invocation still dispatches exactly one loopr phase's turn sequence and returns.
   `RunConfig.is_final_phase` changes *what the reviewer is asked to produce within this one run*; it
   does not make multi-loopr chain into dispatching the next phase's own run itself.
7. Full evidence-collection semantics for the final-phase completion artifact beyond
   existence-plus-provenance (item 20's own check). What `BUILD_COMPLETE.md` must actually contain to
   satisfy AC1-AC3 as real evidence is Phase 5's own acceptance-harness concern.

**Out of V1 entirely (PRD §3) -- never build these, in any phase**
8. A third provider or any routing beyond the fixed ordered pair -- unaffected by this phase; no code
   in `src/dispatch/artifacts.ts` reasons about `ProviderId` at all.
9. Cost, token, or budget tracking -- unaffected.
10. The AUDITOR or RESEARCHER archetypes' dispatch paths -- unaffected;
    `buildArtifactProductionInstructions()` is called only from the reviewer path already established
    in Phase 3.
11. Concurrent or parallel agent execution -- unaffected; the run lock's existing scope (the whole
    turn loop) is unchanged.
12. Anything that would trip boundary rules B1-B8 -- including inside `src/dispatch/artifacts.ts`,
    which gets **no** B7 exemption (only `src/adapters/**` is exempted).

**Explicitly not a Phase 4 goal even though it may look adjacent**
13. Refusing to dispatch, or warning, when the computed next-artifact path already exists on disk
    before the reviewer turn starts (e.g. a stale `PHASE_(N+1)_SPEC.md` from an abandoned prior
    attempt). multi-loopr does not pre-check or guard against this; not overwriting an
    already-approved prior artifact without escalation is the loopr method's own discipline, carried
    by the dispatched reviewer archetype's own role profile and protocol instructions -- not a
    mechanical precondition this phase's preflight or guards enforce. `assertNextPhaseSpecProduced()`
    only requires that the turn's own commits touched the path (item 18's check), which already rules
    out a completely untouched stale file, but does not rule out the reviewer legitimately overwriting
    one it was instructed (out of band) to revise.
14. Adding a `C6` check to `verifyContinuation()`/`CONTINUITY_CHECKS`. The two new guards are
    deliberately separate from, and run at a different point in `runTurn()`'s own sequencing than,
    the five-check continuity predicate -- see §0 and §7's dedicated row.
15. Any new CLI flag, command, or `RunReport` field beyond the exit-code table extension in §4.1.
16. Amending `PHASE_1_SPEC.md`, `PHASE_2_SPEC.md`, or `PHASE_3_SPEC.md` themselves.

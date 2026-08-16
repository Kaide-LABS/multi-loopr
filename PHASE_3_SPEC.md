# PHASE_3_SPEC.md -- multi-loopr

## §0 Phase Plan Header

**Phase 3 of 5.**

**Title:** Sequential dispatch engine.

**Built from:** `multi-loopr-PRD.md` §10 (Phase plan: "Sequential dispatch engine -- Turn loop, lock
acquisition, relay write/read cycle, halt/escalation signals, timeouts"), `PHASE_1_SPEC.md` §9
(non-goals 6-8, explicitly deferring exactly this scope to Phase 3), `PHASE_2_SPEC.md` §9
("Deferred to Phase 3" items 1-5) and its own file-by-file comments anticipating this phase
(`src/domain/run.ts`'s "Phase 3's dispatch loop is its only consumer" note on `RunConfig`;
`src/ports/provider-adapter.ts`'s `env` doc comment naming "Phase 3's dispatch loop, via
`runProcess()`" as the actual spawn site), and `COMPREHENSION.md` (verified account of what Phases
1-2 actually shipped, read in full for this draft). Where this spec and the PRD disagree, the PRD
wins and the disagreement is a defect in this spec that must be escalated, not silently reconciled.

**What Phase 3 is.** The engine that finally uses Phase 1's core substrate and Phase 2's adapters
together to run a real, sequential, cross-provider turn sequence for one loopr phase: a `run` CLI
command; a deterministic turn planner (`planTurnSequence`) that resolves PRD §6.3's DECISION into
concrete `{archetype, provider}` slots; role-profile/isolation-respecting prompt assembly for each
turn; the actual `runProcess()` spawn of a real provider CLI (the first phase to do so for a live
turn, as opposed to Phase 1's toolchain-probe-only use); ground-truth reconciliation of the
agent-authored `HandoffRecord` against git and file-hash reality rather than trusting the agent's
self-report (PRD §7 I2); `verifyContinuation()` wired in as the actual gate between consecutive
turns, with the bounded (exactly-once) retry-on-failed-verdict logic both prior phases deferred
here; halt-signal propagation; and the exclusive run lock wrapped around the whole run.

**What Phase 3 is not.** No real loopr-artifact content (`baby_prd.md`/`context.md`/
`PHASE_N_SPEC.md` production, rendering, or AC3 evidence packaging) -- Phase 3's reviewer turn is
mechanically identical to an executor turn from the dispatch loop's point of view; it does not draft
a real next-phase spec. No multi-phase autonomous looping -- one `multi-loopr run` invocation
dispatches exactly one loopr phase's turn sequence and exits. No toy build task content, no AC1/AC2/
AC3 evidence collection or packaging, no open-source packaging. See §9.

**Standing constraint for the executor agent (inherited from `PHASE_1_SPEC.md` §0 and
`PHASE_2_SPEC.md` §0, binding here too).** Every public function named in §6 below must exist with
the exact name, exact module path, and exact signature given. Where this spec marks a claim
**[UNVERIFIED-P3]** rather than **[VERIFIED-LOCAL]**/**[VERIFIED-DOC]**/**[DECISION, Phase 3]**, the
executor must confirm it before shipping (a live local test where the claim concerns real process/
filesystem behaviour, or escalation where it concerns a genuinely new judgment call this spec cannot
settle in advance); if a confirmed reality contradicts this spec, HALT and escalate -- do not
silently substitute a plausible-looking alternative and leave this spec stale (the exact failure
mode `PHASE_1_SPEC.md` §6.1's own erratum and `PHASE_2_SPEC.md`'s own `[UNVERIFIED-P2]`-closure gap
already demonstrated once each in this project; `COMPREHENSION.md` §5 names both). This spec
introduces very little genuinely new *external* CLI-surface risk (Phase 3 does not add new provider
flags -- it reuses `buildInvocation`'s already-verified output verbatim) but it does introduce
several genuinely new *internal* design decisions (turn sequencing, retry policy, ground-truth
reconciliation). Those are marked **[DECISION, Phase 3]** throughout and are this spec's own
considered resolutions, not vendor facts to re-verify -- but they are still open to escalation if the
executor finds a concrete reason one is unworkable.

**Cross-phase modification policy (inherited from `PHASE_2_SPEC.md` §0, applied again here).** Phase
3 modifies five already-approved files. Each modification in §1 states: (a) why it is additive; (b)
that every prior-phase test exercising the file continues to pass unmodified; (c) why the existing
file, not a new Phase 3 file, is the right place.

---

## §1 Files Added or Modified

All paths are relative to the repo root `C:\Users\hp\multi-loopr`.

### 1.1 New: `src/dispatch/`

The turn-sequencing and orchestration layer -- the first new top-level `src/` directory since Phase
2's `src/adapters/`, for the same reason Phase 2 got its own directory rather than being inlined
into `src/cli/main.ts`: this is substantial, independently-testable domain logic, not CLI argument
handling. `src/cli/run.ts` (§1.2) stays a thin composition layer over this directory, exactly
mirroring `src/cli/doctor.ts`'s existing relationship to `src/verify/**`.

| Path | Purpose |
|---|---|
| `src/dispatch/plan.ts` | `planTurnSequence()` / `otherProviderId()` -- resolves PRD §6.3's DECISION into the concrete, ordered `TurnPlan[]` for one run. |
| `src/dispatch/plan.test.ts` | Sequence correctness, `reviewer_provider` default vs. override, `otherProviderId` totality. |
| `src/dispatch/prompt.ts` | `buildProtocolInstructions()`, `buildExecutorPrompt()`, `buildReviewerPrompt()` -- role-profile injection and isolation-respecting cross-turn context assembly (FM2). |
| `src/dispatch/prompt.test.ts` | Mandatory-content checklist presence; forbidden-content absence (no raw stdout/stderr, no `FORBIDDEN_RELAY_KEY_PATTERN` hit). |
| `src/dispatch/record.ts` | `reconcileHandoffRecord()` -- overwrites the agent-authored record's `repo`/`spec_ref`/artifact hashes with multi-loopr's own independently-computed ground truth (PRD §7 I2). |
| `src/dispatch/record.test.ts` | Reconciliation against real temp git repos; a deliberately wrong agent-authored `repo`/hash is proven overwritten, not trusted. |
| `src/dispatch/turn.ts` | `runTurn()` -- one turn end to end: build invocation, merge env, spawn, interpret, read + reconcile the on-disk record, assert commit neutrality, persist the reconciled record. |
| `src/dispatch/turn.test.ts` | Full turn lifecycle against a real temp git repo, with an injectable `runProcessFn` fixture standing in for a real provider CLI. |
| `src/dispatch/run-loop.ts` | `runDispatch()` -- the top-level orchestrator: preflight, lock, the turn loop, continuity gating with bounded retry, halt propagation. |
| `src/dispatch/run-loop.test.ts` | End-to-end dispatch scenarios: clean 3-turn run, continuity-failure-then-retry-succeeds, continuity-failure-twice-halts, agent halt, lock contention, preflight failure. |

### 1.2 New: `src/cli/run.ts`

| Path | Purpose |
|---|---|
| `src/cli/run.ts` | `RunReport` (`z.strictObject`) and `runRunCommand()` -- reads/validates the `--config` JSON file against `RunConfig`, calls `runDispatch()`, renders the result. Mirrors `src/cli/doctor.ts`'s existing shape (own zod report schema, a function that returns `{report, exitCode}` and never calls `process.exit`). |
| `src/cli/run.test.ts` | CLI-level config-file validation errors, `--json` output shape, exit-code passthrough from `runDispatch()`. |

### 1.3 Modified: `src/domain/run.ts`

**Additive only.** `RunConfig` gains two new required fields:

```
phase: z.number().int().min(1),
spec_path: <a locally-defined repo-relative-path schema, see rationale below>,
```

**Why.** Phase 1 shipped `RunConfig` with no way to say *which* loopr phase a run executes or *which*
`PHASE_N_SPEC.md` its turns work from -- `TurnRequest.phase` and `TurnRequest.specRef` (both already
in Phase 1's `run.ts`) had no config-level source. This is a genuine gap in a file explicitly
described as "Phase 1 defines and validates it; Phase 3's dispatch loop is its only consumer"
(`src/domain/run.ts`'s own header comment) -- Phase 3, as that stated sole consumer, is exactly the
place to notice and close it, the same way Phase 2 closed `TurnRequest.modelOverride`'s missing
plumbing for `RunConfig.model_overrides`.

**Why `spec_path` is not imported from `src/domain/relay.ts`'s `RepoRelPath`.** `run.ts`'s own header
comment states a deliberate, documented constraint: it has "zero runtime dependency on `./relay.ts`"
specifically to keep the two files' dependency a one-directional DAG (`relay.ts` imports
`ProviderIdSchema` from `run.ts` at runtime; `run.ts` imports only *types* from `relay.ts`, erased by
type stripping). Importing `RepoRelPath` (a runtime zod value) from `relay.ts` into `run.ts` would
create exactly the ES-module cycle that comment warns against. Instead, `run.ts` builds its own
local schema from the same underlying primitive both files already share safely:
`isSafeRepoRelPath` from `src/util/paths.ts` (a leaf module with no dependency on either `run.ts` or
`relay.ts`):

```
const RepoRelPathLike = z.string().min(1).max(1024).refine(isSafeRepoRelPath, "...");
```

This is not a new safety rule -- it is `RepoRelPath`'s own existing refinement, sourced from the same
single-source-of-truth function `RepoRelPath` itself already delegates to (`PHASE_1_SPEC.md` §6.3:
"the rule lives in one place"), just declared a second time as a schema value in the one file that
cannot safely import the other's schema object without a cycle.

**Regression constraint.** `RunConfig` has zero consumers in Phases 1-2 (Phase 1: "nothing in Phase 1
consumes it"; Phase 2 touches only `TurnRequest`/`errors.ts`/`provider-adapter.ts`/`preflight.ts`,
never `RunConfig`, per `PHASE_2_SPEC.md` §1.6's own file manifest). No existing test constructs a
`RunConfig` literal without these fields that this addition could break (grep-confirmed: `RunConfig`
has zero non-type-only references outside `src/domain/run.ts` itself in the current tree, mirroring
exactly the argument `PHASE_2_SPEC.md` §1.3 made for `TurnRequest.modelOverride`).

### 1.4 Modified: `src/domain/errors.ts`

**Additive only**, following `PHASE_2_SPEC.md` §1.2's exact precedent (append after the existing ten,
never renumber):

```
ExitCode.RUN_HALTED = 11
```

`class RunHaltedError extends MultiLooprError` -- `exitCode = ExitCode.RUN_HALTED`,
`code = "RUN_HALTED"`.

**Why here, why now.** A turn's `HandoffRecord.status` can be `"blocked"` or `"halted"` (Phase 1
schema, §3.4 field 14) -- a real, modelled outcome distinct from every existing error class: not a
process failure (`InternalError`), not a schema defect (`RelaySchemaError`), not a continuity failure
(`ContinuityError`), not a timeout (`TurnTimeoutError`). Phase 1 defined the field; Phase 2 never
produced a `HandoffRecord` at all (`interpretResult().record` is always `null` in Phase 2); Phase 3 is
the first phase that reads a real, agent-authored `status`, so it is the first phase that needs a
concrete class for "the run stopped because the dispatched agent said it could not, or should not,
continue," reusing exactly the reasoning `PHASE_2_SPEC.md` §1.2 used for `TurnTimeoutError`
("a concrete class is now structurally required, not optional polish").

**Regression constraint.** `exitCodeFor()` already handles any `MultiLooprError` subclass generically
(unchanged since Phase 1); no Phase 1/2 test asserts the exact membership of `ExitCode`, so none
breaks.

### 1.5 Modified: `src/util/paths.ts`

**Additive only.** Adds one function:

```
export function repoRelToAbs(repoDir: string, repoRelPath: string): string
```

Returns `` `${repoDir}/${repoRelPath}` ``. Straight concatenation is correct and sufficient here
(not `node:path.join`/`resolve`) because `repoRelPath` is only ever a value that has already passed
`isSafeRepoRelPath` (no leading `/`, no drive letter, no `..` segment, POSIX separators only) --
exactly the safety guarantee that makes plain concatenation safe, consistent with this file's own
existing POSIX-forward-slash convention (`multiLooprDir`, `runLockPath`, `handoffPath` all
concatenate the same way).

**Why here.** `src/dispatch/record.ts` and `src/dispatch/turn.ts` need to resolve
`RunConfig.spec_path` and each `HandoffRecord.artifacts_read`/`artifacts_written` entry's
repo-relative path to an absolute path before calling `sha256File()` (which takes an absolute path,
per `src/util/hash.ts`, unmodified). `toRepoRelPosix` (the existing inverse direction, abs -> rel)
already lives here; its inverse belongs in the same file, not duplicated in `src/dispatch/`.

**Regression constraint.** One new exported function; every existing export and `paths.test.ts`'s
existing assertions are untouched.

### 1.6 Modified: `src/verify/git.ts`

**Additive only.** Adds one function:

```
export function diffText(repoDir: string, fromOid: string, toOid: string): Promise<string>
```

`git diff <fromOid>..<toOid>` (no `--name-only` -- the full unified diff body, unlike the existing
`changedPaths`, which intentionally returns only names). Exit non-zero -> `InternalError`, matching
this file's existing wrapper convention exactly (`changedPaths`, `commitsBetween` follow the same
non-zero-exit-throws-`InternalError` shape).

**Why here, why now.** PRD §9 FM2 states the reviewer's turn payload is assembled "only from
`spec_ref` + git diff + the previous `HandoffRecord`'s allow-listed fields -- never from provider log
files." Phase 1 built every other git plumbing wrapper `verifyContinuation()` needed
(`isAncestor`, `changedPaths`, `blobOidAt`) but had no reason yet to build a *text* diff wrapper,
since none of C1-C5 needs diff *content*, only changed *paths*. Phase 3's reviewer prompt assembly
(§6.2) is the first consumer that needs the actual diff body, so this is the first phase with a
reason to add it -- and `src/verify/git.ts` is the single place every other typed git wrapper already
lives (PRD §9 FM9's drift-prevention reasoning, applied here to git wrapper duplication rather than
version-range duplication).

**Regression constraint.** One new exported function; every existing export and `git.ts`'s own
consumers (`continuity.ts`, `preflight.ts`, `commits.ts`) are unchanged and untouched.

### 1.7 Modified: `src/cli/main.ts`

**Additive in effect, not doc-comment-only.** Gains recognition of a new `run` command and its flags
(`--config <path>`, `--json`) inside `parseArgs`, plus a new `case "run"` branch in `main()`'s
dispatch `switch`. Every existing command's parsing and behaviour (`--version`, `--help`,
`doctor`/`doctor --json`/`doctor --boundary`/`doctor --providers`, unknown-command handling) is
byte-identical -- `parseArgs` only gains one new recognized `first === "run"` branch alongside the
existing `"doctor"` branch; nothing about the existing branches changes.

**Regression constraint.** `src/cli/main.test.ts` (Phases 1-2, unmodified) must still pass without a
single edit to that test file, proving every pre-existing argv shape still resolves identically.

### 1.8 Full Phase 3 file manifest

| Path | Status |
|---|---|
| `src/dispatch/plan.ts` | new |
| `src/dispatch/plan.test.ts` | new |
| `src/dispatch/prompt.ts` | new |
| `src/dispatch/prompt.test.ts` | new |
| `src/dispatch/record.ts` | new |
| `src/dispatch/record.test.ts` | new |
| `src/dispatch/turn.ts` | new |
| `src/dispatch/turn.test.ts` | new |
| `src/dispatch/run-loop.ts` | new |
| `src/dispatch/run-loop.test.ts` | new |
| `src/cli/run.ts` | new |
| `src/cli/run.test.ts` | new |
| `src/domain/run.ts` | modified (additive) |
| `src/domain/errors.ts` | modified (additive) |
| `src/util/paths.ts` | modified (additive) |
| `src/verify/git.ts` | modified (additive) |
| `src/cli/main.ts` | modified (additive in effect) |

No other file changes. In particular: `src/adapters/**`, `src/verify/preflight.ts`,
`src/verify/continuity.ts`, `src/verify/boundary.ts`, `src/verify/boundary-rules.ts`,
`src/verify/commits.ts`, `src/domain/relay.ts`, `src/domain/tiers.ts`, `src/domain/roles.ts`,
`src/ports/provider-adapter.ts`, `src/util/exec.ts`, `src/util/hash.ts`, `src/util/lock.ts`,
`src/cli/doctor.ts` are untouched -- Phase 3 *consumes* every one of these, unmodified, rather than
changing any of them.

---

## §2 Dependencies

**No change.** `package.json` `dependencies` still contains exactly `zod` (boundary rule B2
unchanged). `devDependencies` still contains exactly `typescript` and `@types/node`. Phase 3 needs no
new package: turn sequencing is array/object construction, prompt assembly is string building, and
process spawning already goes through Phase 1's `runProcess()`. `tsconfig.json` is byte-identical to
`PHASE_1_SPEC.md` §2.2 -- `rootDir: "src"` already covers `src/dispatch/**` and `src/cli/run.ts` with
no edit required.

---

## §3 Schemas and Data Models

### 3.1 `src/domain/run.ts` -- `RunConfig` additions

Already specified in full in §1.3. Restated here for completeness, in the order they append to the
existing field list:

```
phase: z.number().int().min(1),
spec_path: RepoRelPathLike,   // locally-defined, see §1.3
```

### 3.2 `src/domain/errors.ts` -- `ExitCode.RUN_HALTED` / `RunHaltedError`

Already specified in full in §1.4.

### 3.3 `src/dispatch/plan.ts` -- plain types (not zod; in-process only, like `Invocation`/`TurnRequest`)

```
export interface TurnPlan {
  readonly archetype: "executor" | "reviewer";
  readonly provider: ProviderId;
}
```

`TurnPlan.archetype` is narrowed to exactly the two V1-dispatched archetypes (`ROLE_REGISTRY`'s
`instantiatedInV1: true` members, PRD §6.3) -- `planTurnSequence` never produces `"architect"`,
`"researcher"`, or `"auditor"`.

### 3.4 `src/dispatch/run-loop.ts` -- plain types

```
export interface TurnAttemptSummary {
  readonly turnIndex: number;
  readonly archetype: "executor" | "reviewer";
  readonly provider: ProviderId;
  readonly status: "completed" | "blocked" | "halted" | "failed";
  readonly continuityVerdict: ContinuityVerdictLabel | null;
  readonly retried: boolean;
}

export interface RunResult {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly turns: readonly TurnAttemptSummary[];
  readonly halt: HaltSignal | null;
  readonly problems: readonly string[];
}
```

`"failed"` is a `TurnAttemptSummary.status` value with no `HandoffRecord` counterpart -- it covers a
turn whose `TurnOutcome.ok` was `false` (process failure, timeout, or an on-disk record that failed
to read/parse/reconcile) before any `status` field was ever available to report.

### 3.5 `src/cli/run.ts` -- `RunReport` (zod, mirrors `DoctorReport`'s existing shape)

```
export const RunReport = z.strictObject({
  schema_version: z.literal(1),
  generated_at: IsoUtc,
  run_id: RunId,
  phase: z.number().int().min(1),
  ok: z.boolean(),
  exit_code: z.number().int(),
  turns: z.array(z.strictObject({
    turn_index: z.number().int().min(0),
    archetype: z.enum(["executor", "reviewer"]),
    provider: ProviderIdSchema,
    status: z.enum(["completed", "blocked", "halted", "failed"]),
    continuity_verdict: z.enum(["CONTINUED", "REDO", "PARTIAL_REVERT", "IGNORED", "DIVERGED"]).nullable(),
    retried: z.boolean(),
  })),
  halt: HaltSignal.nullable(),
  problems: z.array(z.string()),
});
export type RunReport = z.infer<typeof RunReport>;
```

Global rules from `PHASE_1_SPEC.md` §3 apply unchanged (`z.strictObject` everywhere, no bare
`z.object`, schema constant and inferred type share one identifier).

---

## §4 CLI Surface

Phase 3 adds exactly one new command to the binary Phase 1 shipped and Phase 2 left unchanged.

### 4.1 New command and flags

| Invocation | Behaviour |
|---|---|
| `multi-loopr run --config <path>` | Reads and validates `<path>` as JSON against `RunConfig`, then dispatches the canonical V1 turn sequence (§6.1) for that config. Human-readable report to stdout. Exit per §4.3. |
| `multi-loopr run --config <path> --json` | Same run, single `RunReport` JSON object to stdout, nothing else on stdout. |
| `multi-loopr run` *(no `--config`)* | `UsageError`. Exit `2`. |
| `multi-loopr run --config <path> <unknown-flag>` | `UsageError`. Exit `2`, same "unknown flags are never ignored" rule `PHASE_1_SPEC.md` §4.1 already established for `doctor`. |

All of Phase 1's `--version`/`--help`/`doctor*` behaviour (§4.1-§4.4 of `PHASE_1_SPEC.md`) is
unchanged; regression-verified in §8.

### 4.2 `run --json` output shape

`RunReport` (§3.5), printed with `JSON.stringify(report, null, 2)`, exactly mirroring `DoctorReport`'s
own printing convention (`PHASE_1_SPEC.md` §4.2).

### 4.3 Exit codes (extends `PHASE_1_SPEC.md` §4.3; no existing code's meaning changes)

| Code | Name | Raised by `run` when |
|---|---|---|
| `0` | OK | every planned turn completed and every continuity check passed (first attempt or the one permitted retry) |
| `1` | INTERNAL | an unexpected throw, or a turn's `TurnOutcome.failure` is an `InternalError` (adapter-reported process failure or malformed JSON output) |
| `2` | USAGE | `--config` missing, the config file is not valid JSON, or it fails `RunConfig` schema validation |
| `3` | PREFLIGHT_FAILED | toolchain/provider preflight failed, **or** `spec_path` does not resolve to a readable file (§6.3) |
| `4` | RELAY_SCHEMA_INVALID | the agent-authored on-disk record failed to parse/validate, or failed re-validation after ground-truth reconciliation (§6.4) |
| `5` | ISOLATION_LEAK | the agent-authored on-disk record contained a transcript-shaped key |
| `6` | CONTINUITY_FAILED | `verifyContinuation()` returned non-`CONTINUED` on both the original attempt and the one permitted retry |
| `7` | BOUNDARY_VIOLATION | `assertNeutralCommits()` found an AI-attribution trailer in a turn's real commits (§6.4) |
| `8` | LOCK_HELD | the run lock could not be acquired at the start of the run |
| `10` | TURN_TIMEOUT | a turn's process ran past `timeoutMs` |
| `11` | RUN_HALTED | a turn's `HandoffRecord.status` was `"blocked"` or `"halted"` |

**Precedence, first-failure-wins:** `run` stops dispatching further turns at the first failure and
returns that failure's own exit code -- unlike `doctor`, which always runs every requested check and
reports the union, `run` is a sequential process where turn *N+1* cannot meaningfully happen without
turn *N*'s real git state, so there is no "run every check regardless" mode here.

### 4.4 Stream discipline

Unchanged from `PHASE_1_SPEC.md` §4.4: `--json` output to stdout only; diagnostics to stderr; no ANSI
colour when `stdout` is not a TTY.

---

## §5 Migrations

**N/A for the relay format, same rationale as `PHASE_1_SPEC.md`/`PHASE_2_SPEC.md` §5** -- `run`
introduces no new persistent, versioned format; every on-disk artifact it writes is either the
already-versioned `HandoffRecord` (`schema_version: 1`, unchanged) or the run lock (ephemeral,
unchanged). **Operationally new, though:** Phase 3 is the first phase that actually populates
`.multi-loopr/runs/<run_id>/handoff/**.json` for real -- Phase 1 only declared that layout
(`handoffPath()`); Phase 2 never called `writeHandoffRecord`/`readHandoffRecord` at all
(`PHASE_2_SPEC.md` §9 item 2). No migration scaffolding is introduced for this; a future
`schema_version: 2` is still "a second schema and a version-dispatching reader," per Phase 1's
already-settled design, not something Phase 3 needs to anticipate further.

---

## §6 Implementation Logic Flow

### 6.1 `src/dispatch/plan.ts`

```
export function otherProviderId(id: ProviderId): ProviderId
export function planTurnSequence(config: RunConfig): readonly TurnPlan[]
```

**`otherProviderId(id)`.** **[DET]** Total over `PROVIDER_IDS` (exactly two members): returns the
member of `PROVIDER_IDS` that is not `id`. Throws `InternalError` if none is found (unreachable given
`PROVIDER_IDS`'s two-distinct-member invariant, defended anyway per this codebase's established
"exhaustive-over-a-closed-set, defend at runtime" idiom -- `getRole()`, both adapters'
`resolveEffort()`).

**`planTurnSequence(config)`.** **[DET, DECISION Phase 3]** Resolves PRD §6.3's DECISION into the
concrete, ordered, three-slot V1 turn sequence for one run:

```
[
  { archetype: "executor", provider: config.executor_providers[0] },
  { archetype: "executor", provider: config.executor_providers[1] },
  { archetype: "reviewer", provider: config.reviewer_provider ?? otherProviderId(config.executor_providers[1]) },
]
```

**Why this exact sequence, and why it is a defensible, non-arbitrary reading of PRD §6.3.** Two
executor slots, ordered exactly as `executor_providers` (already validated as two *different*
provider ids by `RunConfig`'s own `.refine`, `PHASE_1_SPEC.md` §3.5) -- "EXECUTOR is dispatched
through the adapter to *both* providers within a single phase. This is the handoff AC1 measures."
The reviewer slot's provider resolution is the literal, mechanical form of PRD §6.3's own sentence:
"Default: the reviewer runs on whichever provider did *not* produce the diff under review" -- since
`executor_providers[1]` is the provider whose turn most recently touched the diff, "did not produce
it" resolves, in a fixed two-provider system, to `otherProviderId(executor_providers[1])`, which is
necessarily `executor_providers[0]`. `reviewer_provider` (already `nullable`, default `null` in
`RunConfig`) is honoured directly when the operator sets it, exactly matching "its provider is a
run-config parameter rather than a fixed cross-provider swap." No other archetype ever appears
(`researcher`/`auditor`: `instantiatedInV1: false`; `architect`: never dispatched by multi-loopr at
all, PRD §6.3) -- confirmed at the type level by `TurnPlan.archetype`'s own narrowed union (§3.3).

**One `multi-loopr run` invocation dispatches exactly this one three-slot sequence and then returns**
(plus, per turn, at most one retry -- §6.4). It does not loop across loopr phases; see §9.

### 6.2 `src/dispatch/prompt.ts`

```
export interface ProtocolInstructionParams {
  readonly handoffAbsPath: string;
  readonly role: "executor" | "reviewer";
  readonly specRepoRelPath: string;
}
export function buildProtocolInstructions(p: ProtocolInstructionParams): string

export function buildHandoffContext(prev: HandoffRecord): string

export function buildExecutorPrompt(params: {
  readonly role: "executor";
  readonly specRepoRelPath: string;
  readonly handoffAbsPath: string;
  readonly priorRecord: HandoffRecord | null;
  readonly retryNote: string | null;
}): string

export function buildReviewerPrompt(params: {
  readonly specRepoRelPath: string;
  readonly handoffAbsPath: string;
  readonly priorRecord: HandoffRecord;
  readonly diff: string;
  readonly retryNote: string | null;
}): string
```

**`buildProtocolInstructions(p)`.** Prose is not fixed verbatim by this spec (matching this
codebase's existing tolerance for flexible prose within a length-capped, content-checked field --
`RoleDefinition.profileSummary`, `PHASE_1_SPEC.md` §3.3, is the precedent: `z.string().min(20).max(600)`,
content-tested by substring, not by exact match). What **is** load-bearing, and must each appear as a
literal substring, tested individually:
1. The literal `p.handoffAbsPath`.
2. Every one of the eighteen `HandoffRecord` top-level field names (§3.4 of `PHASE_1_SPEC.md`), named
   explicitly, so the agent knows the exact schema shape to produce.
3. An explicit statement that `work_done`/`next_steps`/`open_questions` must be **factual**, never
   reasoning, chain-of-thought, or a transcript excerpt, and must never use a key name resembling one
   -- citing PRD §6.4's isolation rule by name.
4. An explicit statement that the `repo` and `spec_ref` values the agent writes are **advisory only**
   and will be overwritten by multi-loopr's own git-based computation (§6.4) -- true, and stated so the
   agent does not waste turn budget trying to get git plumbing exactly right.
5. An explicit statement that an incomplete phase must be reported as `status: "blocked"` or
   `status: "halted"` (with a populated `halt`), never as a fabricated `"completed"`.
6. The literal `p.specRepoRelPath`, as the file the turn must read and work from.

**`buildHandoffContext(prev)`.** **[DET]** Renders exactly the allow-listed fields of `prev` as plain
text: `work_done`, `next_steps`, `open_questions`, `artifacts_written`, `status`, `spec_ref`. Never
`prev`'s raw JSON dump wholesale (which would be schema-shape leakage, not a deliberate allow-list) and
never any provider log/stdout/stderr text -- this function's signature takes only a `HandoffRecord`,
never a `RawInvocationResult`, so there is no raw process output available to leak even by mistake.
This is the same mechanism used for both the second executor turn's context and the reviewer's context
(§ below), applying PRD §7 I5's isolation rule uniformly rather than narrowly to only the
PRD-§6.4-named reviewer case.

**`buildExecutorPrompt(params)`.** Concatenates: `getRole("executor").profileSummary` (Phase 1,
unchanged) + `buildProtocolInstructions(...)` + (`params.priorRecord === null` ? nothing :
`buildHandoffContext(params.priorRecord)`, for the second executor turn) + (`params.retryNote` when
non-null, §6.4).

**`buildReviewerPrompt(params)`.** Concatenates: `getRole("reviewer").profileSummary` +
`buildProtocolInstructions(...)` + `buildHandoffContext(params.priorRecord)` + a capped rendering of
`params.diff` (truncated with a marker past a fixed cap, mirroring `runProcess`'s own truncation
pattern in `src/util/exec.ts`, so a very large diff cannot make the invocation's `stdin` payload
unboundedly large) + (`params.retryNote` when non-null). This is the literal, mechanical form of PRD
§9 FM2's sentence: "the reviewer's turn payload is assembled only from `spec_ref` + git diff + the
previous `HandoffRecord`'s allow-listed fields -- never from provider log files" -- `diff` here is
`diffText()`'s real output (§1.6), not a provider's own stdout.

**No function in this file ever reads `process.env`, spawns a process, or touches a clock** --
consistent with `buildInvocation`'s own purity constraint (`PHASE_1_SPEC.md` §3.6), applied here to
the layer one step upstream of it.

### 6.3 `src/dispatch/record.ts`

```
export interface RecordGroundTruth {
  readonly headBefore: string;
  readonly branch: string;
  readonly specRef: FileRef;
}
export async function captureGroundTruthBefore(repoDir: string): Promise<{ headBefore: string; branch: string }>
export async function reconcileHandoffRecord(
  repoDir: string,
  draft: HandoffRecord,
  ground: RecordGroundTruth,
): Promise<HandoffRecord>
```

**`captureGroundTruthBefore(repoDir)`.** **[DET]** `{ headBefore: await revParse(repoDir, "HEAD"),
branch: await currentBranch(repoDir) }` -- called by `runTurn()` (§6.4) immediately before spawning
the turn's process, so `headBefore` is genuinely "immediately before the turn started."

**`reconcileHandoffRecord(repoDir, draft, ground)`.** **[DET, DECISION Phase 3, PRD §7 I2]** The
central mechanism that keeps `HandoffRecord`'s correctness-critical fields out of the "agent's
say-so" path I2 forbids, while still letting the agent be the source of the fields only it can
know (the summary text, which paths it touched):
1. `headAfter = await revParse(repoDir, "HEAD")`.
2. `commits = await commitsBetween(repoDir, ground.headBefore, headAfter)`.
3. Build the authoritative `repo: RepoState = { branch: ground.branch, head_before: ground.headBefore,
   head_after: headAfter, commits }` -- **replacing**, not merging with, whatever `draft.repo`
   contained. The agent's own `repo` claim is discarded entirely; it was never trustworthy ground
   truth in the first place (§6.2 item 4 tells the agent this up front).
4. Replace `draft.spec_ref` with `ground.specRef` outright, same reasoning.
5. For each `FileRef` in `draft.artifacts_read` and `draft.artifacts_written`: resolve
   `repoRelToAbs(repoDir, ref.path)`; if the file does not exist, **drop** that entry (documented,
   non-fatal -- an agent may over-report); otherwise recompute `sha256File()` on the real file and
   **replace** `ref.sha256` with the recomputed value, discarding whatever hash the agent claimed. The
   agent's own hash claim is never trusted -- this is the literal mechanism PRD §9 FM5 already names:
   "AC3 artifact attestation is decided by SHA-256 comparison... not by asking an agent."
6. Re-run `HandoffRecord.safeParse(...)` on the fully reconciled object. **This can fail even though
   `draft` itself parsed successfully** -- e.g. the agent claimed `status: "completed"` but ground
   truth shows zero real commits, which now violates R3 (`PHASE_1_SPEC.md` §3.4). On failure, throw
   `RelaySchemaError` with `z.prettifyError()`'s output, naming this as a **reconciliation**
   inconsistency (ground truth contradicts the agent's own report) rather than a raw schema defect, so
   the distinction is legible to an operator reading the error.
7. Return the reconciled, re-validated `HandoffRecord`.

**Why replace rather than merge-and-validate-consistency.** A "compare and reject on mismatch"
design was considered and rejected: it would require the agent's prompt instructions to get git
plumbing and hashing exactly right merely to avoid a spurious rejection, adding fragility with no
security benefit (ground truth is always independently available and cheap to compute) -- replacing
outright is simpler, strictly more robust to an agent's git-plumbing mistakes, and is what §6.2 item 4
already tells the agent to expect.

### 6.4 `src/dispatch/turn.ts`

```
export interface RunTurnDeps {
  readonly adapter: ProviderAdapter;
  readonly runProcessFn?: typeof runProcess;   // defaults to runProcess; injectable for tests
}
export interface RunTurnResult {
  readonly outcome: TurnOutcome;
  readonly record: HandoffRecord | null;   // the reconciled record; non-null iff outcome.ok and reconciliation succeeded
}
export async function runTurn(req: TurnRequest, deps: RunTurnDeps): Promise<RunTurnResult>
```

**[DET]** Fixed order, one turn end to end:
1. `ground = await captureGroundTruthBefore(req.repoDir)`.
2. `invocation = deps.adapter.buildInvocation(req)`.
3. **[DECISION Phase 3, implements `PHASE_2_SPEC.md` §1.4's documented merge contract for the first
   time]** Build the child environment as `{ ...filteredProcessEnv, ...invocation.env }`, where
   `filteredProcessEnv` is `process.env` with every `undefined`-valued key dropped (required to
   satisfy `RunProcessOptions.env`'s `Readonly<Record<string, string>>` type under
   `exactOptionalPropertyTypes`; `process.env`'s own type is `Record<string, string | undefined>`).
   **Never** `invocation.env` alone -- exactly the failure mode that doc comment names ("would
   silently strip the operator's PATH/credentials").
4. `raw = await (deps.runProcessFn ?? runProcess)({ command: invocation.command, args: invocation.args,
   cwd: invocation.cwd, env: <the merged env>, stdin: invocation.stdin, timeoutMs: req.timeoutMs })`.
5. `outcome = deps.adapter.interpretResult(raw)`. If `!outcome.ok`, return `{ outcome, record: null }`
   immediately -- **no attempt to read an on-disk record** when the adapter itself already reports
   failure (a crashed/timed-out process gives no reason to expect a valid handoff file exists).
6. Else, attempt `draft = await readHandoffRecord(handoffPath(req.repoDir, req.runId, req.phase,
   req.turnIndex, req.archetype, req.provider))` (`req.archetype` is passed directly as
   `handoffPath`'s `role` parameter -- identical string values for the two V1-dispatched archetypes,
   `HandoffRecord.role`'s own enum). A thrown `RelaySchemaError`/`IsolationLeakError` here (missing
   file, malformed JSON, transcript-shaped key, schema violation) is **not** caught and reinterpreted
   -- it propagates to the caller as this step's own failure, converted into
   `{ outcome: { ok: false, record: null, failure: <that error> }, record: null }`.
7. `reconciled = await reconcileHandoffRecord(req.repoDir, draft, { headBefore: ground.headBefore,
   branch: ground.branch, specRef: req.specRef })` -- may itself throw `RelaySchemaError` (§6.3 step
   6), handled the same way as step 6.
8. If `reconciled.repo.commits.length > 0`: `await assertNeutralCommits(req.repoDir,
   reconciled.repo.commits)` (Phase 1, unmodified). A thrown `BoundaryViolationError` propagates
   unmodified -- I4 is a hard invariant; it is never retried (§7).
9. `await writeHandoffRecord(handoffPath(...), reconciled)` -- **persists the reconciled version at
   the same path**, overwriting the agent's own draft. This is deliberate: every downstream reader
   (the next turn's `priorRecord`, `verifyContinuation()`, a human inspecting `.multi-loopr/runs/**`
   after the fact) must see the ground-truth-corrected record, never the agent's uncorrected claim.
10. Return `{ outcome, record: reconciled }`.

### 6.5 `src/dispatch/run-loop.ts`

```
export interface RunDispatchDeps {
  readonly adapters?: AdapterRegistry;      // defaults to ADAPTER_REGISTRY
  readonly runProcessFn?: typeof runProcess;
}
export async function runDispatch(config: RunConfig, deps?: RunDispatchDeps): Promise<RunResult>
```

**Never throws a `MultiLooprError` for a modelled failure** -- mirrors `runDoctor`'s own established
"returns the exit code, never calls `process.exit`, never throws for an expected condition" contract
(`PHASE_1_SPEC.md` §6.10). An unexpected (non-modelled) throw is allowed to propagate normally, to be
caught by `src/cli/run.ts`/`main.ts`'s existing generic catch, same as any other module in this
codebase.

Fixed order:
1. **Extended preflight.** `summary = await runPreflight(config.repo_dir)`. Additionally attempt
   `sha256File(repoRelToAbs(config.repo_dir, config.spec_path))`; on failure (file missing/unreadable)
   append a problem string naming the missing spec path to `summary.problems` and treat this as a
   preflight failure too -- **[DECISION Phase 3]** this is folded into the same "is everything this
   run needs actually present and healthy" concept `runPreflight` already represents, rather than
   inventing a new exit code for what is, in substance, one more precondition check (§4.3). If either
   check failed: return `{ ok: false, exitCode: ExitCode.PREFLIGHT_FAILED, turns: [], halt: null,
   problems: summary.problems }` -- **before acquiring the lock and before touching
   `.multi-loopr/runs/**` at all.**
2. **Lock.** `try { await acquireRunLock(config.repo_dir, config.run_id); } catch (err) { if (err
   instanceof LockHeldError) return { ok: false, exitCode: ExitCode.LOCK_HELD, turns: [], halt: null,
   problems: [err.message] }; throw err; }`.
3. **The turn loop**, inside a `try { ... } finally { await releaseRunLock(config.repo_dir,
   config.run_id); }` so the lock is released on every exit path -- success, halt, continuity
   failure, timeout, or an unexpected throw:
   - `plan = planTurnSequence(config)`.
   - `attemptCounter = 0`; `prevRecord: HandoffRecord | null = null`; `turns:
     TurnAttemptSummary[] = []`.
   - For each `slot` in `plan`, in order:
     a. Resolve `tier = getRole(slot.archetype).tier` (Phase 1, unchanged).
     b. Resolve `modelOverride = config.model_overrides?.[slot.provider] ?? null` -- **this is the
        first phase that actually reads `RunConfig.model_overrides`**, closing the loop
        `TurnRequest.modelOverride`'s own doc comment already anticipated (`PHASE_2_SPEC.md` §1.3).
     c. Build the turn's `prompt` via `buildExecutorPrompt`/`buildReviewerPrompt` (§6.2), passing
        `prevRecord` (and, for the reviewer slot, `diff = await diffText(config.repo_dir,
        <the very first turn's own recorded head_before>, prevRecord.repo.head_after)` -- the
        combined diff across both executor turns, per FM2) and `retryNote: null` on the first
        attempt.
     d. Build `req: TurnRequest = { runId: config.run_id, phase: config.phase, turnIndex:
        attemptCounter, archetype: slot.archetype, provider: slot.provider, tier, modelOverride,
        repoDir: config.repo_dir, specRef: <computed once, §6.3's `ground.specRef`>, priorRecord:
        prevRecord, prompt, timeoutMs: config.turn_timeout_ms }`; `attemptCounter += 1`.
     e. `adapter = (deps?.adapters ?? ADAPTER_REGISTRY)[slot.provider]`.
     f. `result = await runTurn(req, { adapter, runProcessFn: deps?.runProcessFn })`.
     g. If `!result.outcome.ok`: push a `"failed"`-status summary; return `{ ok: false, exitCode:
        exitCodeFor(result.outcome.failure), turns, halt: null, problems: [result.outcome.failure's
        message] }` -- **no retry** (§7).
     h. If `result.record.status !== "completed"`: push the summary with that real status; return
        `{ ok: false, exitCode: ExitCode.RUN_HALTED, turns, halt: result.record.halt, problems:
        [result.record.halt?.message ?? "turn reported status " + result.record.status] }` -- **no
        continuity check attempted** against an incomplete record, **no retry**.
     i. If `prevRecord !== null`: `verdict = await verifyContinuation(config.repo_dir, prevRecord,
        result.record)`. If `verdict.verdict !== "CONTINUED"`:
        - **[DECISION Phase 3, closes `PHASE_2_SPEC.md` §9 item 4's deferred "retry-on-failed-
          ContinuityVerdict logic"]** Re-dispatch the **same** `slot` exactly once: build a new
          `req'` identical to `req` except `turnIndex: attemptCounter` (incremented again, keeping
          `turn_index` monotonically increasing across the retry, per `HandoffRecord`'s own field
          doc) and `prompt` rebuilt with `retryNote` describing `verdict.failedCheckIds` and each
          failing check's `detail`, so the retried turn knows specifically what to fix.
        - Re-run `runTurn(req', ...)`. If it fails outcome-wise or is non-`"completed"`, handle
          exactly as steps g/h above (still no further retry).
        - Otherwise re-run `verifyContinuation` against the retry's record. If **still** not
          `CONTINUED`: return `{ ok: false, exitCode: ExitCode.CONTINUITY_FAILED, turns, halt: null,
          problems: [both verdicts' `failedCheckIds`, summarised] }`.
        - If the retry's verdict **is** `CONTINUED`: mark that slot's summary `retried: true` and
          proceed with the retry's record as `prevRecord`.
     j. Else (verdict `CONTINUED`, or this was the first turn with no `prevRecord` to compare
        against): push a `"completed"`-status summary (`retried: false`), set `prevRecord =
        result.record`, continue to the next slot.
   - After every slot in `plan` completes with a `CONTINUED`/first-turn pass: return `{ ok: true,
     exitCode: ExitCode.OK, turns, halt: null, problems: [] }`.

### 6.6 `src/cli/run.ts`

```
export interface RunCommandOptions { readonly json: boolean; readonly configPath: string; }
export async function runRunCommand(opts: RunCommandOptions): Promise<{ report: RunReport; exitCode: number }>
```

1. Read `opts.configPath` as UTF-8; a read failure (ENOENT, etc.) -> `UsageError` naming the path.
2. `JSON.parse` the contents; a parse failure -> `UsageError` with the underlying message.
3. `RunConfig.safeParse(parsed)`; on failure -> `UsageError` with `z.prettifyError(result.error)` --
   **exit `2`, not `4`**: `RELAY_SCHEMA_INVALID` (exit `4`) is reserved for the inter-agent
   `HandoffRecord` payload specifically (`PHASE_1_SPEC.md` §4.3); a malformed *operator-supplied run
   config* is squarely "the CLI invocation itself was malformed," `UsageError`'s own established
   definition.
4. `result = await runDispatch(config)`.
5. Assemble `RunReport` from `result` (`generated_at: new Date().toISOString()`, everything else a
   direct field mapping) and return `{ report, exitCode: result.exitCode }`.

### 6.7 `src/cli/main.ts` changes

`parseArgs` gains, alongside the existing `first === "doctor"` branch: `if (first === "run") { return
parseRunArgs(args.slice(1)); }`, where `parseRunArgs` recognises `--config <path>` (consumes the next
argv element as the path; missing value -> `UsageError`) and `--json`; any other flag -> `UsageError`;
missing `--config` -> `UsageError`. `main()`'s dispatch `switch` gains `case "run": { const { report,
exitCode } = await runRunCommand({ configPath: command.configPath, json: command.json });
process.stdout.write(command.json ? JSON.stringify(report, null, 2) + "\n" :
<a human-readable render analogous to `renderHumanReport`>); return exitCode; }`.

---

## §7 Failure-Mode Guards

| FM | Guard in Phase 3 | Reviewer check (mechanical) |
|---|---|---|
| **FM1** credential expiry/absence | `runDispatch`'s step 1 runs the full `runPreflight()` (Phase 1, unchanged) before acquiring the lock or dispatching any turn; failure aborts at `PREFLIGHT_FAILED` (3) before any provider CLI is spawned. | 1. Read `run-loop.ts` and confirm `runPreflight` is called, and its failure returns, strictly before `acquireRunLock`. 2. Confirm no retry is ever attempted for a `PreflightError`-shaped failure (there is nothing to retry -- the run never starts). |
| **FM2** isolation leak | `buildHandoffContext`/`buildReviewerPrompt` (§6.2) take only a `HandoffRecord` and a `diffText()` string -- never a `RawInvocationResult` or any provider stdout/stderr. `readHandoffRecord` (Phase 1, unmodified) still runs `assertNoTranscriptFields` before every parse, including inside `runTurn`'s step 6. | 1. Grep `src/dispatch/prompt.ts` for a `RawInvocationResult`/`.stdout`/`.stderr` parameter or reference -- zero hits. 2. Confirm `buildReviewerPrompt`'s diff argument is always `diffText()`'s return value, never `raw.stdout`. |
| **FM3** silent redo | `verifyContinuation()` (Phase 1, unmodified) is the sole continuity mechanism, called between every consecutive pair of `"completed"` turns, with exactly one bounded retry on a non-`CONTINUED` verdict and a hard halt (exit `6`) on a second failure. | 1. Confirm `run-loop.ts` never treats a non-`CONTINUED` verdict as passing. 2. Confirm the retry count is bounded to exactly one (a loop, counter, or recursive call with no further recursion) -- an unbounded retry loop is a defect. 3. Confirm a `"blocked"`/`"halted"` record is never fed into `verifyContinuation` as `next` (step 6.5.h precedes 6.5.i). |
| **FM5** relay schema drift | `runTurn` reads the agent's draft via Phase 1's unmodified `readHandoffRecord`/`parseHandoffRecord`; `reconcileHandoffRecord` re-validates after substituting ground truth, so a record that *would* violate a refinement once ground truth is applied is still caught (§6.3 step 6), not silently accepted because the agent's own draft happened to validate. | 1. Confirm `reconcileHandoffRecord` calls `HandoffRecord.safeParse` a second time on the reconciled object, not just once on the draft. 2. Confirm a dedicated test constructs a draft that validates on its own but fails R3 once ground truth shows zero real commits, and confirms it is rejected. |
| **FM6** concurrent write collision | `acquireRunLock`/`releaseRunLock` (Phase 1, unmodified) wrap the **entire** run inside a `try/finally` in `runDispatch` -- not per-turn -- so a second, concurrent `multi-loopr run` against the same `repo_dir` is rejected (`LOCK_HELD`, exit `8`) before its own first turn, and the first run's lock is released on every exit path including an unexpected throw. | 1. Confirm the `finally` releasing the lock wraps the whole turn loop, not just the success path. 2. Confirm no code path returns or throws out of the turn loop without going through that `finally` (no bare early `return` inside the `try` that bypasses it -- structurally impossible in a correctly-nested `try/finally`, but verify no `process.exit`/unhandled-rejection path was introduced that could skip it). |
| **FM7** silent interactive fallback | Unchanged from Phase 2 (adapters already guarantee `bypassPermissions`/`approval_policy=never` unconditionally). Phase 3's own contribution: `TurnRequest.timeoutMs` is always `config.turn_timeout_ms` (or its schema default), never omitted or widened, all the way through to `runProcess`'s mandatory `timeoutMs`. | 1. Confirm every `TurnRequest` constructed in `run-loop.ts` sets `timeoutMs` from `config.turn_timeout_ms`, never a literal or a wider value. 2. Confirm `runTurn` passes that same value straight through to its `runProcess`/`runProcessFn` call, unmodified. |
| **FM9** provider version drift | Unchanged -- `runPreflight`/`buildProviderPreflightReport` (Phase 1/2) are the only version-range logic anywhere; `run-loop.ts` calls `runPreflight` directly and duplicates nothing. | 1. Grep `src/dispatch/**` for `PROVIDER_VERSION_RANGES` or a re-declared version range -- zero hits. |
| **I4** neutral commits | `assertNeutralCommits()` (Phase 1, unmodified) is called inside `runTurn`, after ground-truth reconciliation, with the *real* commit list -- before that turn's record is persisted or trusted as `prevRecord`. A violation is a hard `BoundaryViolationError` (exit `7`), never retried. | 1. Confirm `runTurn` calls `assertNeutralCommits` with `reconciled.repo.commits` (the ground-truth list), not any agent-claimed list. 2. Confirm a fixture commit carrying an attribution trailer halts the run at exit `7` with zero retry attempted. |
| **Phase-3-local guard** -- bounded retry scope | Retries apply **only** to a non-`CONTINUED` continuity verdict, exactly once. Every other failure class (`TurnTimeoutError`, an adapter-reported `InternalError`, `RelaySchemaError`/`IsolationLeakError` from record read/reconciliation, `LockHeldError`, `PreflightError`, `BoundaryViolationError` from `assertNeutralCommits`) halts the run on first occurrence. | 1. Grep `run-loop.ts` for every place a retry could plausibly be triggered -- confirm the *only* one is the continuity-verdict branch (step 6.5.i). 2. Dedicated tests (§8 item 21) prove each of the six other failure classes retries zero times. |
| **Phase-3-local guard** -- ground-truth authority | `repo`, `spec_ref`, and every artifact `FileRef`'s `sha256` in the *persisted* `HandoffRecord` are always multi-loopr's own independently-computed values, never the agent's self-reported ones (PRD §7 I2). | 1. Read `reconcileHandoffRecord` and confirm `repo`/`spec_ref` are constructed fresh from `ground`/git calls, never copied from `draft`. 2. Confirm every persisted `artifacts_read`/`artifacts_written` entry's `sha256` came from a `sha256File()` call inside `reconcileHandoffRecord`, not from `draft`. 3. Dedicated test (§8 item 15-17) with a deliberately wrong agent-authored draft, proving the persisted record differs from the draft in exactly these fields. |
| **HARD BOUNDARY** (PRD §5.1) | No B1-B8 pattern anywhere in `src/dispatch/**` or `src/cli/run.ts` -- **no B7 exemption here**; only `src/adapters/**` is exempted, so a model-name/tier-alias literal in `prompt.ts` or anywhere else new this phase is a real violation, not a permitted one. | 1. `node src/cli/main.ts doctor --boundary` exits `0`. 2. Confirm `src/verify/boundary.test.ts` (unmodified) still passes. 3. Grep `src/dispatch/**` and `src/cli/run.ts` specifically for `opus\|sonnet\|haiku\|fable\|gpt-5\|claude-\|o[34]-` -- zero hits (unlike `src/adapters/**`, these files get no B7 pass). |

---

## §8 Phase Acceptance Criteria

Phase 3 is approved only when **every** item below is objectively true.

**Regression (no prior-phase behaviour broken)**
1. `npm run typecheck` exits `0` with **zero** diagnostics, across the full tree including
   `src/dispatch/**` and `src/cli/run.ts`.
2. `npm run test` exits `0`. Every Phase 1 and Phase 2 test file passes **unmodified**.
3. `node src/cli/main.ts doctor --boundary` exits `0`.
4. `npm run check` exits `0`.
5. `node src/cli/main.ts --version`, `--help`, `doctor`, `doctor --json`, `doctor --boundary`,
   `doctor --providers` all behave byte-identically to `PHASE_1_SPEC.md` §4 / `PHASE_2_SPEC.md` §4.

**Static discipline**
6. `z.object(` and `z.string().datetime(` do not appear anywhere under `src/dispatch/**` or
   `src/cli/run.ts`.
7. The token `any` does not appear as a type annotation under `src/dispatch/**` or `src/cli/run.ts`.
8. `enum `, `namespace `, and constructor parameter properties appear nowhere under those paths.
9. `node:child_process` is imported in exactly one file in the whole tree: `src/util/exec.ts`
   (unchanged) -- confirms `src/dispatch/turn.ts` spawns exclusively through `runProcess`/
   `runProcessFn`, never directly.

**Behaviour -- turn planning**
10. `planTurnSequence` produces exactly the three-slot sequence in §6.1's order for a `reviewer_provider:
    null` config, and honours an explicit non-null `reviewer_provider` when set.
11. `otherProviderId` is correct for both `PROVIDER_IDS` members and throws `InternalError` for any
    other input (unreachable at the type level, tested defensively).

**Behaviour -- lock and preflight**
12. `runDispatch` acquires the run lock before the first turn and releases it on every exit path
    (success, a turn's `"failed"`/non-`"completed"` status, continuity failure after the retry, an
    unexpected throw) -- verified by `readRunLock(repoDir) === null` after each scenario resolves.
13. A `runDispatch` call against a `repo_dir` whose lock is already held by a live pid returns
    `exitCode: ExitCode.LOCK_HELD` (8) without dispatching any turn.
14. A preflight failure (injected via a fake provider report, or a `spec_path` that does not exist)
    returns `exitCode: ExitCode.PREFLIGHT_FAILED` (3) without acquiring the lock and without writing
    any file under `.multi-loopr/runs/**`.

**Behaviour -- ground-truth reconciliation**
15. `reconcileHandoffRecord` replaces a deliberately-wrong agent-authored `repo` field with
    independently-computed ground truth -- dedicated test.
16. `reconcileHandoffRecord` replaces a deliberately-wrong agent-authored `spec_ref` with the
    dispatch loop's own computed `FileRef` -- dedicated test.
17. `reconcileHandoffRecord` recomputes every `artifacts_read`/`artifacts_written` entry's `sha256`
    from the real file, rejecting the agent's self-reported hash even when it is wrong; a declared path
    that does not exist on disk is dropped, not fatal -- dedicated tests for both cases.

**Behaviour -- neutrality, halts, continuity**
18. `runTurn` calls `assertNeutralCommits` with the ground-truth commit list after every turn; a
    fixture commit carrying an attribution trailer halts the run at `exitCode: 7`
    (`BoundaryViolationError`), with zero retry.
19. A `HandoffRecord` with `status !== "completed"` stops the run immediately, before any continuity
    check and before dispatching a further turn; `exitCode: ExitCode.RUN_HALTED` (11); `RunResult.halt`
    carries the record's own `halt` value.
20. `verifyContinuation` runs between every consecutive pair of `"completed"` turns. A non-`CONTINUED`
    first verdict triggers exactly one retry of the later turn (same archetype/provider, a fresh,
    monotonically-increasing `turn_index`, a prompt containing the prior verdict's `failedCheckIds`);
    a second non-`CONTINUED` verdict halts the run at `exitCode: ExitCode.CONTINUITY_FAILED` (6) with
    both verdicts represented in `problems`. A retry that itself succeeds (`CONTINUED`) lets the run
    proceed, with that slot's `TurnAttemptSummary.retried === true`.
21. Dedicated tests confirm zero retry is ever attempted for: a `TurnTimeoutError`, an adapter-reported
    `InternalError`, a `RelaySchemaError`/`IsolationLeakError` from record read or reconciliation, a
    `LockHeldError`, a `PreflightError`, and a `BoundaryViolationError` from `assertNeutralCommits` --
    each halts the run on first occurrence.

**Behaviour -- environment, timeouts, model overrides**
22. The environment passed to a real turn's `runProcess`/`runProcessFn` call is
    `{ ...process.env-with-undefined-dropped, ...invocation.env }` -- dedicated test confirms an
    ambient `process.env` key survives into the constructed child env.
23. `TurnRequest.timeoutMs` for every dispatched turn equals `config.turn_timeout_ms` (explicit value
    or the `RunConfig` schema's own default `1_800_000`).
24. `TurnRequest.modelOverride` for a turn on provider `p` equals `config.model_overrides?.[p] ?? null`
    -- dedicated test with a config that overrides one provider and not the other.

**Behaviour -- prompt assembly and isolation**
25. `buildProtocolInstructions`'s output contains every mandatory-content item listed in §6.2, tested
    individually by substring.
26. `buildReviewerPrompt`'s output contains the phase spec's repo-relative path, the real diff text
    (from a `diffText()` fixture), and the prior record's allow-listed fields -- and does **not**
    contain any string matching `FORBIDDEN_RELAY_KEY_PATTERN` as a *key name it introduces itself*
    (the allow-listed field values themselves, being already-validated `HandoffRecord` content, cannot
    contain such a key by construction, since the record they came from already passed
    `assertNoTranscriptFields`).

**Behaviour -- CLI**
27. `multi-loopr run` with no `--config` exits `2` before touching any file.
28. `multi-loopr run --config <path>` where `<path>`'s JSON fails `RunConfig` validation exits `2`
    before touching `repo_dir` at all.
29. `multi-loopr run --config <path> --json` emits a single `RunReport`-shaped JSON object on stdout,
    with `turns.length` reflecting however many turns actually ran (3 on a clean run; fewer on an early
    halt/failure; one extra on a single successful retry).

**Contract coverage** (dedicated-test presence and correctness, no blanket coverage-percentage target
-- continuing `PHASE_1_SPEC.md` §1.6's own established convention)
30. Every function named in §6 has at least one dedicated test. `run-loop.test.ts`'s scenario tests use
    **real temporary git repositories** (`continuity.test.ts`'s own established pattern, Phase 1) plus
    an injected fake `AdapterRegistry`/`runProcessFn` standing in for a real provider CLI -- no test in
    this phase spawns a real `claude` or `codex` process.
31. `RunConfig`'s two new fields each reject an invalid value with a dedicated test: `phase: 0` and
    `phase: -1`; `spec_path` as an absolute path and as a path containing a `..` segment.

**Documentation**
32. `README.md` gains, at most, a one-line mention that a `run` command now exists -- no operational
    tutorial, and no claim about Phase 4/5 functionality (real loopr-artifact content, the toy build
    task, AC1-AC3 evidence packaging) that this phase does not ship.

---

## §9 Explicit NON-GOALS

Phase 3 does **not** build the following. A pull of any item below into Phase 3 is a scope violation
and must be rejected by the review agent even if the code is correct.

**Deferred to Phase 4 (loopr artifact integration)**
1. Producing, rendering, or reading `baby_prd.md`, `context.md`, or `PHASE_N_SPEC.md` as real
   content. Phase 3's reviewer turn does **not** draft a real `PHASE_(N+1)_SPEC.md`; from the
   dispatch loop's point of view it is mechanically identical to an executor turn (build invocation,
   spawn, read + reconcile the record, check neutrality/continuity). `TurnRequest.specRef`/
   `RunConfig.spec_path` remain a path-plus-hash reference to whatever file already exists at that
   path -- multi-loopr does not generate, template, or validate that file's *content*.
2. Any human-readable "artifact provenance" report beyond what `RunReport`/the persisted
   `HandoffRecord` files already give mechanically.

**Deferred to Phase 5 (Acceptance harness)**
3. The toy build task's actual content, end-to-end AC1/AC2/AC3 evidence collection or packaging,
   open-source packaging.
4. **Multi-phase autonomous looping.** One `multi-loopr run` invocation dispatches exactly one loopr
   phase's turn sequence (up to three turns, plus at most one retry) and then returns. Advancing to
   the next loopr phase is a fresh, separately-invoked `multi-loopr run` with a new config (a new
   `phase`/`spec_path`) -- mirroring how this very project's own `loopr-step12`/`loopr-step14`
   subagents are re-dispatched between phases by the architect/driver rather than self-chaining.
   Building that re-dispatch automation is out of Phase 3's scope.

**Out of V1 entirely (PRD §3) -- never build these, in any phase**
5. A third provider or any routing beyond the fixed ordered pair. `planTurnSequence` only ever
   consumes `RunConfig.executor_providers`'s two members and `PROVIDER_IDS`'s two members.
6. Cost, token, or budget tracking -- still never extracted from either provider's payload
   (`interpretResult` already deliberately ignores it, Phase 2; Phase 3 adds no new extraction).
7. The AUDITOR or RESEARCHER archetypes' dispatch paths -- `planTurnSequence` never produces a
   `TurnPlan` with `archetype: "auditor"` or `"researcher"`; `TurnPlan.archetype`'s own type excludes
   them.
8. Concurrent or parallel agent execution. The run lock (Phase 1) already enforces this structurally;
   Phase 3 is the first phase whose own turn loop *demonstrates* single-active-agent sequencing
   end-to-end, but adds no parallelism of any kind.
9. Anything that would trip boundary rules B1-B8 -- including inside `src/dispatch/**` and
   `src/cli/run.ts`, which get **no** B7 exemption (only `src/adapters/**` is exempted, and only for
   the literal classes `PHASE_2_SPEC.md` §3.1/§3.2 already enumerate).

**Explicitly not a Phase 3 goal even though it may look adjacent**
10. Re-running `scanBoundary()`/`doctor --boundary` against the **target** repo (`req.repoDir`). The
    boundary scanner is, and remains, scoped to multi-loopr's own `src/**`; it has no meaning applied
    to an arbitrary repo the dispatched agents operate on, and this phase builds no analogous scanner
    for that repo.
11. A `--dry-run` flag or any run-validate-only CLI mode beyond what `--config`'s own `RunConfig`
    schema validation already gives via a `UsageError` before `runDispatch` is ever called.
12. Any run-level audit log, streaming log file, or telemetry beyond the `HandoffRecord` files
    themselves (Phase 1's own on-disk layout) and the one `RunReport` printed once at the end via
    `--json`.
13. Unbounded or configurable retry counts. The retry bound is exactly one, hardcoded, and scoped
    exclusively to a non-`CONTINUED` continuity verdict (§6.5, §7) -- not an operator-tunable setting.
14. Amending `PHASE_1_SPEC.md` or `PHASE_2_SPEC.md` themselves.

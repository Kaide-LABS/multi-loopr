# PHASE_5_SPEC.md -- multi-loopr

## §0 Phase Plan Header

**Phase 5 of 5 -- THE FINAL PHASE.**

**Title:** End-to-end acceptance harness.

**Built from:** `multi-loopr-PRD.md` §10 (Phase plan: "5 | End-to-end acceptance harness | The toy
build task; AC1/AC2/AC3 evidence collection; open-source packaging"), `multi-loopr-PRD.md` §2
(Acceptance criteria AC1-AC3, quoted in full below), `multi-loopr-PRD.md` §5 (Boundary, confirmed --
no hosted account, no interactive credential setup, no network dependency beyond each provider's own
CLI), `PHASE_1_SPEC.md` §9 item 10 ("Deferred to Phase 5 (Acceptance harness): the toy build task,
end-to-end AC1/AC2/AC3 evidence collection, and open-source packaging (`npm publish` config, LICENSE
beyond the manifest field, CONTRIBUTING, CI workflow)"), `PHASE_3_SPEC.md` §9 item 3 (same deferral,
restated), `PHASE_4_SPEC.md` §9 items 4-7 (same deferral, restated a third time, plus the explicit
note that `RunConfig.is_final_phase`'s real end-to-end exercise, and full evidence-collection
semantics for the final-phase completion artifact beyond existence-plus-provenance, are this phase's
concern), and `COMPREHENSION.md` (verified account of what Phases 1-4 actually shipped, read in full
for this draft, including its own §5/§6 honesty-audit finding about `assertLooprArtifactsReferenced()`
-- addressed explicitly in §9 below, not silently absorbed into this phase's scope -- and its
carried-forward open item that `RunHaltedError` is declared but never constructed anywhere,
also addressed explicitly in §9). Where this spec and the PRD disagree, the PRD wins and the
disagreement is a defect in this spec that must be escalated, not silently reconciled.

**PRD §2's three acceptance criteria, quoted verbatim, because this entire phase exists to make them
objectively checkable rather than aspirational:**

1. "Run a single toy build task through multi-loopr V1 end to end: Claude Code starts a
   loopr-disciplined phase, hands off, and Codex CLI picks it up and continues it on the same repo --
   observable as two agents' commits on one git history where the second's work demonstrably builds
   on the first's (not a redo, not ignoring it)."
2. "The entire run completes with zero browser/interactive prompts after initial credential setup --
   observable as a scripted run producing exit 0 with no human interaction mid-run."
3. "loopr's own phase artifacts (`baby_prd.md`, `context.md`, `PHASE_N_SPEC.md`) are genuinely
   produced and read by both agents during the run, not bypassed -- observable by diffing what each
   agent actually referenced against what it was handed."

**What Phase 5 is.** Three deliverables, matching the PRD §10 row exactly:

1. **The toy build task.** A genuinely tiny, genuinely real coding task (`examples/toy-build/`) --
   its own `baby_prd.md`/`context.md`/`PHASE_1_SPEC.md` loopr artifacts, materialized as a fresh,
   throwaway git repository outside multi-loopr's own working tree, driven end to end by a real
   `multi-loopr run --config <path> --json` invocation against genuinely authenticated `claude` and
   `codex` CLIs. This is the concrete instance AC1-AC3 are checked against; Phases 1-4 built the
   mechanism, Phase 5 is the first phase that actually points it at a real target and lets it run.
2. **AC1/AC2/AC3 evidence collection.** A new, deterministic, offline-replayable module
   (`src/dispatch/acceptance.ts`, `assessAcceptanceEvidence()`) that re-derives all three criteria
   from the run's own persisted ground truth -- the `.multi-loopr/runs/<run_id>/handoff/**` records
   Phase 3 already writes and Phase 4's guards already gate -- independently of, and without trusting,
   any report the run itself produced live. Exposed as a new CLI command, `multi-loopr evidence`,
   the same shape as `doctor` and `run` (a report object plus an exit code, never a process exit
   inside the library layer).
3. **Open-source packaging.** `LICENSE` (full MIT text), `CONTRIBUTING.md`, a CI workflow that runs
   `npm run check` (never a live provider-CLI run -- see §9), and a `files` allowlist added to
   `package.json` so a future `npm publish` ships only the library surface. Phase 5 prepares the
   package; it does not publish it, for the same reason multi-loopr's own git history is never pushed
   without an explicit operator decision (§9).

**What Phase 5 is not.** It is not a fourth deterministic-guard-adding phase in the shape of Phases
1/4 -- it adds exactly one new mechanism (`assessAcceptanceEvidence()`/`multi-loopr evidence`) and
otherwise *exercises* the already-complete dispatch engine, rather than extending it. It does not
change `runDispatch()`'s, `runTurn()`'s, or `runTurnLoop()`'s control flow, does not add a provider
flag, does not add a `HandoffRecord` field, and does not touch `src/adapters/**`. It does not perform
a live `npm publish`, does not add a hosted CI secret or deploy step, and does not grade the toy
build's own code quality -- exactly the same provenance-not-quality restraint `PHASE_4_SPEC.md` §9
items 1-2 already established for `assertNextPhaseSpecProduced()`, extended here to the acceptance
harness's own re-derivation of the same guards. See §9.

**Standing constraint for the executor agent (inherited from `PHASE_1_SPEC.md` §0 and every phase
since, binding here too).** Every public function named in §6 below must exist with the exact name,
exact module path, and exact signature given. Unlike Phases 2-4, this spec's genuinely new decisions
are almost entirely internal design (the toy task's own content, the evidence module's algorithm, the
packaging file contents) rather than a vendor fact requiring re-verification -- marked
**[DECISION, Phase 5]** throughout, open to escalation if the executor finds a concrete reason one is
unworkable, but not something a doc-lookup can settle. The one genuine external-fact dependency this
phase has -- whether `claude` and `codex` are *currently* authenticated on the machine building/
reviewing this phase -- is not a vendor-doc fact either; it is observed live via `doctor --providers`,
exactly as Phase 1's own acceptance criterion 18 already did, and §8 below is written to be honest
about that dependency rather than assume a state.

**Cross-phase modification policy (inherited from `PHASE_2_SPEC.md`/`PHASE_3_SPEC.md`/
`PHASE_4_SPEC.md` §0, applied again here).** Phase 5 modifies three already-approved files
(`src/domain/errors.ts`, `src/cli/main.ts`, `package.json`) plus `README.md`. Each modification in §1
states: (a) why it is additive; (b) that every prior-phase test exercising the file continues to pass
unmodified; (c) why the existing file, not a new Phase 5 file, is the right place. This is the last
phase in which this policy applies to a *next* phase's own build -- there is no Phase 6.

---

## §1 Files Added or Modified

All paths are relative to the repo root `C:\Users\hp\multi-loopr`.

### 1.1 New: `src/dispatch/acceptance.ts`

| Path | Purpose |
|---|---|
| `src/dispatch/acceptance.ts` | `assessAcceptanceEvidence()` -- reads a completed run's persisted `HandoffRecord` files back off disk and independently re-derives AC1 (cross-provider continuity), AC2 (clean, non-interactive completion), and AC3 (genuine artifact reference and production) from them, never trusting any report the run itself produced live. |
| `src/dispatch/acceptance.test.ts` | Every branch, against real temporary git repositories and real persisted `HandoffRecord` fixture files on disk (`continuity.test.ts`'s and `artifacts.test.ts`'s own established pattern) -- no test in this file spawns a real `claude` or `codex` process. |

Placed in `src/dispatch/` rather than `src/verify/`, for the identical reason `PHASE_4_SPEC.md` §1.1
already gave for `artifacts.ts`: this is not a general-purpose repo verifier, it is specific to one
run's own persisted, run-scoped state (`repoDir` + `runId`), the same "run-specific, lives in
`src/dispatch/`" reasoning `record.ts`'s `reconcileHandoffRecord()` and `artifacts.ts` both already
established.

### 1.2 New: `src/cli/evidence.ts`

| Path | Purpose |
|---|---|
| `src/cli/evidence.ts` | `EvidenceReport` (the `--json` wire schema) and `runEvidenceCommand()` -- mirrors `src/cli/doctor.ts`'s and `src/cli/run.ts`'s own shape exactly: a function that returns `{report, exitCode}` and never calls `process.exit`. |
| `src/cli/evidence.test.ts` | Flag-independent report-assembly tests, mirroring `run.test.ts`'s own coverage shape for `runRunCommand()`. |

**Why a separate wire schema from `AcceptanceEvidence` (§3.2).** Same reasoning `PHASE_3_SPEC.md`
already established for `RunDispatchResult` (plain, `run-loop.ts`) vs. `RunReport` (zod,
`src/cli/run.ts`): `assessAcceptanceEvidence()`'s return value is in-process only and never crosses a
wire; `EvidenceReport` is the `--json` output contract, independently versioned
(`schema_version: 1`) the same way `DoctorReport`/`RunReport` are.

### 1.3 New: `examples/toy-build/`

| Path | Purpose |
|---|---|
| `examples/toy-build/README.md` | The exact, copy-pasteable operator procedure: materialize the fixture into a fresh directory *outside* this repository, generate a `RunConfig` JSON, run `multi-loopr run`, then run `multi-loopr evidence`. No new script is required to run any of these steps -- every step is either a already-existing `multi-loopr` command or a single `git`/`node` one-liner, printed verbatim. |
| `examples/toy-build/loopr/baby_prd.md` | The toy task's own problem statement (§6.1). |
| `examples/toy-build/loopr/context.md` | The toy task's own background/constraints document (§6.1). |
| `examples/toy-build/loopr/PHASE_1_SPEC.md` | The toy task's own single-phase blueprint (§6.1). Naming this file identically to multi-loopr's own root `PHASE_1_SPEC.md` is deliberate, not a collision to avoid -- it lives inside a *different* repository (the materialized toy target repo) and is loopr's own generic convention, the same convention this very meta-project's spec chain already demonstrates. |
| `examples/toy-build/run-config.template.json` | A `RunConfig`-shaped JSON template with exactly two placeholders (`run_id`, `repo_dir`) the operator fills in; every other field is a concrete, correct value for this specific toy build (§6.2). |

**Deliberately outside `src/`.** These are example/demonstration materials for an operator driving
multi-loopr, not part of the shipped `bin`/library surface `tsconfig.json`'s `include` (`src/**/*.ts`)
or `scanBoundary()`'s `src/**` walk cover -- the same treatment this project's own root-level
`docs/modernization_log.md` and `PHASE_N_SPEC.md` files already get (referenced, committed, but not
subject to `src/**`'s own compiled/scanned invariants). `examples/toy-build/` contains no `.ts` file
at all in this phase's design (§6.1-§6.2) -- every step is either static fixture content (`.md`,
`.json`) or a command the operator types directly, so the question of whether example *code* would
need to reuse `runProcess()` (Phase 1's "node:child_process imported in exactly one file" invariant)
does not arise.

### 1.4 Modified: `src/domain/errors.ts`

**Additive only**, following every prior phase's own precedent (append after the existing twelve,
never renumber):

```
ExitCode.ACCEPTANCE_INCOMPLETE = 13
```

**No new `MultiLooprError` subclass.** `multi-loopr evidence` never throws this code -- it is a
*reportable*, expected outcome (AC1/AC2/AC3 not (yet) satisfied for this run), assembled into
`EvidenceReport.exit_code` the same way `DoctorReport.exit_code`/`RunReport.exit_code` are computed
by their own commands' report-assembly logic without a dedicated thrown class existing for "problems
found" either. `exitCodeFor()` (§3.1 of `PHASE_1_SPEC.md`) is unaffected -- it maps thrown
`MultiLooprError`s, and nothing in this phase throws one for this new code.

**Regression constraint.** Same as every prior phase's own: `exitCodeFor()` already handles any
`MultiLooprError` subclass generically (unchanged since Phase 1); no Phase 1-4 test asserts the exact
membership of `ExitCode`, so none breaks.

### 1.5 Modified: `src/cli/main.ts`

**Additive only.** Gains a third command, `evidence`, in exactly the shape `doctor` and `run` already
establish: a `parseEvidenceArgs()` function, a `{ kind: "evidence" } & EvidenceCommandOptions` member
of the `Command` union, a `case "evidence"` dispatch arm, a `renderEvidenceHumanReport()` function,
and one new line in `USAGE_TEXT`. See §6.4 for the exact flag grammar.

**Regression constraint.** Every existing `--version`/`--help`/`doctor`/`run` behaviour is untouched;
`main.test.ts`'s existing exit-code assertions for those commands continue to pass unmodified --
this phase only adds a new `if (first === "evidence")` branch to `parseArgs()`, the same shape the
existing `if (first === "run")` branch already has.

### 1.6 Modified: `package.json`

**Additive only**, and the first amendment to this file's `§2.1`-pinned shape since Phase 1 --
justified because "open-source packaging" is Phase 5's own named PRD §10 mandate, not scope creep.
Gains exactly one new top-level key, appended after `"engines"`:

```json
"files": ["src", "README.md", "LICENSE"]
```

**Why these three entries and no others.** `src/` is the entire library/CLI surface (`bin` already
points into it); `README.md` and `LICENSE` are the standard npm-package minimum. `examples/`,
`PHASE_*_SPEC.md`, `multi-loopr-PRD.md`, `COMPREHENSION.md`, `CONTRIBUTING.md`, `docs/`, and `.claude/`
are development/process artifacts an operator building or reviewing this project needs, not runtime
library surface a consumer installing `multi-loopr` from a registry needs -- excluding them from
`files` keeps a hypothetical future `npm pack`/`npm publish` output minimal, the same reasoning that
already motivated `.npmrc`'s `save-exact=true` in Phase 1.

**No other field changes. Explicitly:** `"private": true` is **not** flipped to `false` (§9) --
publishing is a deliberate, irreversible, credentialed future operator action Phase 5 prepares for but
does not perform, the same restraint this project already applies to `git push`/`git remote add`.
`dependencies` still contains exactly `zod`; `devDependencies` still contains exactly `typescript` and
`@types/node`; `scripts` is unchanged (§2). No `"repository"`/`"homepage"`/`"bugs"` field is added --
this repo currently has no configured remote, and fabricating a URL would be worse than omitting the
field.

### 1.7 Modified: `README.md`

**Additive.** Gains a new `## Examples` (or equivalently-named) section pointing at
`examples/toy-build/README.md` and a one-sentence mention that `multi-loopr evidence` exists and what
it checks. Unlike Phases 2-4's own "at most one sentence" README constraint, Phase 5 is the phase
where a fuller, public-facing README becomes appropriate (open-source packaging, §10) -- but the
same restraint those phases established still applies in kind: no roadmap, no badges, no
installation promise this project does not keep (`PHASE_1_SPEC.md` §1.1), and no claim that the toy
build has actually been executed against live credentials unless it genuinely has been on the
reviewing machine at approval time (§8).

### 1.8 New: `LICENSE`, `CONTRIBUTING.md`, `.github/workflows/ci.yml`

| Path | Purpose |
|---|---|
| `LICENSE` | The unmodified, standard MIT license text (§6.3), matching `package.json`'s existing `"license": "MIT"` field -- this file has been a documented gap since Phase 1 (`PHASE_1_SPEC.md` §9 item 10 named it as deferred to this phase). |
| `CONTRIBUTING.md` | How to build/test/typecheck locally (`npm ci`, `npm run check`), the phase-spec-driven development method this repo itself was built with (a two-sentence pointer, not a tutorial), and that PRs are not currently accepted (no remote/org exists yet to accept them into) -- honest about the project's actual current state rather than a template's generic promises (§6.3). |
| `.github/workflows/ci.yml` | Runs on `push`/`pull_request`: checkout, `actions/setup-node` pinned to a Node major satisfying `engines.node` (`>=24.0.0`), `npm ci`, `npm run check`. **Never** invokes `doctor --providers` or `run` -- CI has no BYOA provider credentials and is not the place to attempt one (§9). |

### 1.9 Full Phase 5 file manifest

| Path | Status |
|---|---|
| `src/dispatch/acceptance.ts` | new |
| `src/dispatch/acceptance.test.ts` | new |
| `src/cli/evidence.ts` | new |
| `src/cli/evidence.test.ts` | new |
| `examples/toy-build/README.md` | new |
| `examples/toy-build/loopr/baby_prd.md` | new |
| `examples/toy-build/loopr/context.md` | new |
| `examples/toy-build/loopr/PHASE_1_SPEC.md` | new |
| `examples/toy-build/run-config.template.json` | new |
| `LICENSE` | new |
| `CONTRIBUTING.md` | new |
| `.github/workflows/ci.yml` | new |
| `src/domain/errors.ts` | modified (additive) |
| `src/cli/main.ts` | modified (additive) |
| `package.json` | modified (additive, `files` only) |
| `README.md` | modified (additive) |

No other file changes. In particular: `src/adapters/**`, `src/verify/**` (including `continuity.ts`
and its fixed `CONTINUITY_CHECKS` five-member tuple), `src/domain/relay.ts` (`HandoffRecord`,
`schema_version` stays `1` for the whole of V1), `src/domain/tiers.ts`, `src/domain/roles.ts`,
`src/domain/run.ts` (`RunConfig`/`TurnRequest`), `src/ports/provider-adapter.ts`, `src/util/exec.ts`,
`src/util/hash.ts`, `src/util/lock.ts`, `src/util/paths.ts`, `src/dispatch/plan.ts`,
`src/dispatch/prompt.ts`, `src/dispatch/record.ts`, `src/dispatch/turn.ts`, `src/dispatch/run-loop.ts`,
`src/dispatch/artifacts.ts`, `src/cli/doctor.ts`, `src/cli/run.ts` are untouched -- Phase 5 *consumes*
every one of these, unmodified, through `assessAcceptanceEvidence()`'s own imports and through a real
`multi-loopr run` invocation.

---

## §2 Dependencies

**No change.** `package.json` `dependencies` still contains exactly `zod` (boundary rule B2
unchanged). `devDependencies` still contains exactly `typescript` and `@types/node`. `scripts` is
unchanged -- `npm run typecheck`/`npm run test`/`npm run check` remain the only three, and Phase 5
adds no fourth script: `examples/toy-build/`'s own procedure is documented commands, not an npm
script, and CI (§1.8) invokes the existing `npm run check` directly. `tsconfig.json` is unchanged --
`rootDir: "src"` already covers `src/dispatch/acceptance.ts` and `src/cli/evidence.ts` with no edit
required, and `examples/**` is deliberately outside `include` (§1.3). Phase 5 needs no new package:
`assessAcceptanceEvidence()` is directory enumeration, JSON parsing, and calls into Phase 1's own
`verifyContinuation()`/Phase 4's own `assertLooprArtifactsReferenced()`/`assertNextPhaseSpecProduced()`
-- all already-built, already-imported primitives.

---

## §3 Schemas and Data Models

### 3.1 `src/domain/errors.ts` -- `ExitCode.ACCEPTANCE_INCOMPLETE`

Already specified in full in §1.4.

### 3.2 `src/dispatch/acceptance.ts` -- plain types (not zod; run-specific, like `RecordGroundTruth`/`LooprArtifactPaths`)

```
export interface AcceptanceContinuityEntry {
  readonly fromTurnIndex: number;
  readonly toTurnIndex: number;
  readonly verdict: ContinuityVerdictLabel;          // from src/verify/continuity.ts, unmodified
  readonly failedCheckIds: readonly ContinuityCheckId[];
}

export interface AcceptanceReferenceEntry {
  readonly turnIndex: number;
  readonly archetype: "executor" | "reviewer";
  readonly provider: ProviderId;
  readonly status: "completed" | "blocked" | "halted";
  readonly artifactsReferenced: boolean;
  readonly missingArtifactPaths: readonly string[];
}

export interface AcceptanceProduction {
  readonly satisfied: boolean;
  readonly detail: string;
}

export interface AcceptanceEvidence {
  readonly repoDir: string;
  readonly runId: string;
  readonly finalPhase: boolean;
  readonly turnsFound: number;
  readonly ac1: {
    readonly satisfied: boolean;
    readonly detail: string;
    readonly providerSequence: readonly ProviderId[];
    readonly continuity: readonly AcceptanceContinuityEntry[];
  };
  readonly ac2: {
    readonly satisfied: boolean;
    readonly detail: string;
    readonly turnStatuses: readonly { readonly turnIndex: number; readonly status: string }[];
  };
  readonly ac3: {
    readonly satisfied: boolean;
    readonly detail: string;
    readonly references: readonly AcceptanceReferenceEntry[];
    readonly production: AcceptanceProduction | null;   // null iff no reviewer turn was found
  };
  readonly problems: readonly string[];
}
```

### 3.3 `src/cli/evidence.ts` -- `EvidenceReport`, the `--json` wire schema

Mirrors `DoctorReport`'s and `RunReport`'s own `z.strictObject` style exactly, snake_case wire fields
built from `AcceptanceEvidence`'s own camelCase in-process fields (the same translation
`runRunCommand()` already performs from `RunDispatchResult` into `RunReport`):

```
export const EvidenceReport = z.strictObject({
  schema_version: z.literal(1),
  generated_at: IsoUtc,
  repo_dir: z.string().min(1),
  run_id: RunId,
  final_phase: z.boolean(),
  ok: z.boolean(),
  exit_code: z.number().int(),
  turns_found: z.number().int().min(0),
  ac1: z.strictObject({
    satisfied: z.boolean(),
    detail: z.string(),
    provider_sequence: z.array(ProviderIdSchema),
    continuity: z.array(z.strictObject({
      from_turn_index: z.number().int(),
      to_turn_index: z.number().int(),
      verdict: z.enum(["CONTINUED", "REDO", "PARTIAL_REVERT", "IGNORED", "DIVERGED"]),
      failed_check_ids: z.array(z.string()),
    })),
  }),
  ac2: z.strictObject({
    satisfied: z.boolean(),
    detail: z.string(),
    turn_statuses: z.array(z.strictObject({
      turn_index: z.number().int(),
      status: z.enum(["completed", "blocked", "halted"]),
    })),
  }),
  ac3: z.strictObject({
    satisfied: z.boolean(),
    detail: z.string(),
    references: z.array(z.strictObject({
      turn_index: z.number().int(),
      archetype: z.enum(["executor", "reviewer"]),
      provider: ProviderIdSchema,
      artifacts_referenced: z.boolean(),
      missing_artifact_paths: z.array(z.string()),
    })),
    production: z.strictObject({ satisfied: z.boolean(), detail: z.string() }).nullable(),
  }),
  problems: z.array(z.string()),
});
export type EvidenceReport = z.infer<typeof EvidenceReport>;
```

### 3.4 No change to `HandoffRecord` (`src/domain/relay.ts`)

**Deliberate, and worth stating explicitly, as the final confirmation of a throughline that has held
since Phase 1.** `RELAY_SCHEMA_VERSION` stays `1` for the entirety of V1. `assessAcceptanceEvidence()`
reads existing, already-persisted `HandoffRecord` files via `readHandoffRecord()` (Phase 1, unmodified)
-- it needs no new field, because every fact AC1-AC3 requires (`provider`, `repo.head_before/after`,
`spec_ref`, `artifacts_read`, `artifacts_written`, `status`) is already there.

### 3.5 No change to `RunConfig`/`TurnRequest` (`src/domain/run.ts`)

**Deliberate.** The toy build's own `RunConfig` (§1.3, `run-config.template.json`) is an *instance* of
the existing schema, not a schema change -- it sets `executor_providers: ["claude-code", "codex-cli"]`
(the exact ordered pair AC1's own wording names) and `is_final_phase: true` (a single-phase toy build
has no next phase; the reviewer turn produces `BUILD_COMPLETE.md`, §6.1). No new `RunConfig` field is
needed for `assessAcceptanceEvidence()` -- it takes `repoDir`/`runId`/`finalPhase` as plain function
arguments, mirroring an operator's own knowledge of the run they just dispatched, not a value threaded
through the dispatch loop itself.

---

## §4 CLI Surface

### 4.1 New command

| Invocation | Behaviour |
|---|---|
| `multi-loopr evidence --repo-dir <path> --run-id <uuid> [--final-phase] [--json]` | Reads the persisted `HandoffRecord` files for the given run id under `<repo-dir>/.multi-loopr/runs/<run-id>/handoff/`, independently re-derives AC1/AC2/AC3, and reports. Never spawns a process, never mutates the target repo. Exit per §4.2. |

Flag rules, identical shape to `run`'s own (`PHASE_3_SPEC.md` §4.1): `--repo-dir <path>` and
`--run-id <uuid>` are both required (missing either -> `UsageError`, exit `2`); `--final-phase` is a
boolean presence flag, absent means `false` (mirroring `RunConfig.is_final_phase`'s own default);
`--json` may combine with either. Unknown flags are a `UsageError`, never ignored -- the same rule
every prior CLI surface in this project already enforces.

`USAGE_TEXT` gains one line:
```
  multi-loopr evidence --repo-dir <path> --run-id <uuid> [--final-phase] [--json]
                                              Re-derive AC1/AC2/AC3 evidence for a completed run
                                              from its persisted handoff records.
```

### 4.2 Exit codes (extends `PHASE_4_SPEC.md` §4.1; no existing code's meaning changes)

| Code | Name | Raised by `evidence` when |
|---|---|---|
| `0` | OK | `turnsFound === 3` and AC1, AC2, and AC3 are all `satisfied: true` |
| `13` | ACCEPTANCE_INCOMPLETE | any of AC1/AC2/AC3 is not satisfied, or fewer than 3 persisted turns were found, or more than one phase subdirectory was found under this run id's `handoff/` directory (§6.1) |
| `2` | USAGE | `--repo-dir` or `--run-id` missing, or an unknown flag |

`evidence` never raises `1`/`3`/`4`/.../`12` -- it is a read-only, offline audit over artifacts a
*prior*, already-completed `run` invocation produced; it does not re-run preflight, does not
re-acquire the lock, and does not re-parse a `HandoffRecord` it did not itself write, so none of the
live-dispatch failure classes apply to it. A directory-read failure (missing `.multi-loopr/`, missing
`handoff/`, an unparseable record file) is folded into `problems`/`ok: false`/exit `13`, never a
crash -- the same "never throw for a modelled outcome, always produce a report" contract
`runDoctor()`/`runRunCommand()` already establish (§6.5).

### 4.3 Stream discipline

Unchanged from `PHASE_1_SPEC.md` §4.4 / `PHASE_3_SPEC.md` §4.4.

---

## §5 Migrations

**N/A, same rationale as every prior phase's §5.** Phase 5 introduces no new persistent, versioned
format. `assessAcceptanceEvidence()` only *reads* the existing `.multi-loopr/runs/**` layout Phase 1
already defined (`handoffPath()`, unmodified) -- it writes nothing to the target repo and nothing to
multi-loopr's own repo. The toy build's own target repo is an ordinary git repository the dispatched
agents commit to under loopr's own discipline, not a multi-loopr-owned format.

---

## §6 Implementation Logic Flow

### 6.1 The toy build task (`examples/toy-build/`) **[DECISION, Phase 5]**

**The task itself.** A single-file, dependency-free Node.js CLI, `wordcount.mjs`: reads all of stdin
and prints exactly one line, `lines: <n> words: <n> chars: <n>`, to stdout, plus a colocated
`wordcount.test.mjs` using Node's built-in `node:test` runner (deliberately the same "zero
dependency, no build step" toolchain philosophy this very project uses for itself -- a low-risk,
genuinely two-turn-sized task, not a toy so trivial it proves nothing and not large enough to make a
real, live, multi-hour dispatch expensive to reproduce).

**`examples/toy-build/loopr/baby_prd.md`** must state, in the same spirit as this project's own
`baby_prd.md`: the problem (build `wordcount.mjs` exactly as described above), and that this is a
demonstration build used to exercise multi-loopr's own cross-provider handoff, not a production
deliverable.

**`examples/toy-build/loopr/context.md`** must state the toolchain constraint (Node.js only, no
`package.json` dependency, `node:test`, no build step) and must explicitly instruct the dispatched
agents that this file and `baby_prd.md` must both be read before any code is written -- the same
mandatory-content shape `buildProtocolInstructions()` (Phase 4) already injects mechanically, restated
here in the artifact's own prose for a human reader inspecting the toy build directly.

**`examples/toy-build/loopr/PHASE_1_SPEC.md`** must specify: the two files to add
(`wordcount.mjs`, `wordcount.test.mjs`), the exact stdout format quoted above, at least one concrete
test case, and an acceptance criterion runnable as a command (`node --test wordcount.test.mjs` exits
`0`). It is the toy build's *own* phase spec -- it has no `§0`-`§9` structure requirement of its own;
loopr's method, not multi-loopr's code, governs its shape (`PHASE_4_SPEC.md` §9 item 2: no
content-shape validation of a produced artifact, extended by symmetry to this authored one).

**`examples/toy-build/run-config.template.json`** -- a `RunConfig` literal with two placeholder
fields (`"run_id": "<GENERATE WITH crypto.randomUUID()>"`, `"repo_dir": "<ABSOLUTE PATH TO THE
MATERIALIZED TOY REPO>"`) and every other field concrete: `executor_providers: ["claude-code",
"codex-cli"]` (this exact order, matching AC1's own wording -- Claude Code first, Codex CLI second),
`reviewer_provider: null` (defaults to `"claude-code"` per `planTurnSequence`, §6.3 of
`PHASE_3_SPEC.md`, unmodified), `phase: 1`, `spec_path: "loopr/PHASE_1_SPEC.md"`,
`baby_prd_path: "loopr/baby_prd.md"`, `context_path: "loopr/context.md"`, `is_final_phase: true`
(single-phase toy build; the reviewer turn's expected artifact is `BUILD_COMPLETE.md` at the toy
repo's root, per `nextPhaseSpecPath()`'s already-shipped final-phase branch, `PHASE_4_SPEC.md` §6.1,
unmodified).

**`examples/toy-build/README.md`** documents the exact procedure, as commands, not prose:
1. Materialize: create a fresh directory **outside this repository** (never nested inside
   multi-loopr's own working tree -- a nested git repository would confuse both repos' own history and
   is unnecessary, §9), `git init` it, copy `examples/toy-build/loopr/` into it, `git add`/`git commit`
   an initial commit (authored by the operator/script running the setup, not by either dispatched
   agent -- outside the turn range `assertNeutralCommits()` ever inspects, so I4 is not implicated).
2. Generate the config: copy `run-config.template.json`, fill in `run_id` (one `node -e
   "console.log(crypto.randomUUID())"` invocation) and `repo_dir` (the absolute path from step 1).
3. Preflight (recommended, not required): `node src/cli/main.ts doctor --providers` from this repo,
   confirm both providers show `authenticated: true` before dispatching for real.
4. Dispatch: `node src/cli/main.ts run --config <generated-config-path> --json`, from this repo, run
   against the toy repo via `repo_dir`.
5. Collect evidence: `node src/cli/main.ts evidence --repo-dir <toy-repo-path> --run-id <the same
   run_id> --final-phase --json`.

No step above is a new script -- every one is either an already-shipped `multi-loopr` command or a
single, already-standard `git`/`node` command. This is a deliberate simplification versus a bespoke
orchestration script: it keeps Phase 5 from inventing a fourth piece of machinery when three
(the fixture content, `run`, `evidence`) already suffice, and it means the exact commands an operator
runs are the same commands a future CI job or a human could run identically, with nothing hidden
inside a script only this phase understands.

### 6.2 `src/dispatch/acceptance.ts`

```
export async function assessAcceptanceEvidence(
  repoDir: string,
  runId: string,
  finalPhase: boolean,
): Promise<AcceptanceEvidence>
```

Logic, in order, **[DET]** throughout -- every sub-check below is a deterministic re-derivation from
persisted artifacts, never an LLM self-report, matching PRD §7 I2 exactly as every prior deterministic
module in this project already does:

1. **Locate the run's persisted turns.** Enumerate subdirectories of
   `<repoDir>/.multi-loopr/runs/<runId>/handoff/` (via `fs.readdir`, no glob dependency, the same
   idiom `scanBoundary()` already uses for `src/**` enumeration). Each subdirectory name is a phase
   number multi-loopr itself wrote via `handoffPath()` (Phase 1) -- reading it back is not the kind of
   "parse an operator-supplied filename for a phase number" fragility `PHASE_4_SPEC.md` §6.1 already
   rejected for `nextPhaseSpecPath()`; it is multi-loopr's own directory-naming convention, fully
   under its own control.
   - Zero subdirectories, or the directory itself missing (`ENOENT`) -> `turnsFound: 0`, every AC
     `satisfied: false`, a `problems` entry naming the missing path, return early -- never throw.
   - More than one subdirectory -> a `problems` entry naming every phase number found, every AC
     `satisfied: false`, return early. This is a real, disclosed limitation of a simple design (§9):
     `assessAcceptanceEvidence()` assesses exactly one phase's worth of evidence per call, matching
     "no multi-phase autonomous looping" (`PHASE_3_SPEC.md` §9 item 4, unchanged) -- if an operator
     dispatched more than one phase under the same `run_id` (unusual; `RunConfig.run_id` is meant to
     identify one run of one phase), that is reported as ambiguous input, not silently resolved by
     picking one.
2. **Read every turn in that one phase subdirectory**, sorted by filename (already zero-padded,
   lexical order equals numeric `turnIndex` order, `handoffPath()`'s own documented contract,
   unmodified) via `readHandoffRecord()` (Phase 1, unmodified). A parse failure on any file is a
   `problems` entry naming the file and the error, that record is dropped from the set, and
   `turnsFound` reflects only the records that parsed.
3. **AC1 (continuity).** Requires: exactly 3 turns found; `records[0].role === "executor"`,
   `records[1].role === "executor"`, `records[2].role === "reviewer"` (`planTurnSequence`'s own fixed
   shape, Phase 3, unmodified); `records[0].provider !== records[1].provider`. If all hold, call
   `verifyContinuation(repoDir, records[0], records[1])` and `verifyContinuation(repoDir, records[1],
   records[2])` (Phase 1, unmodified) and require **both** verdicts `=== "CONTINUED"`.
   `ac1.satisfied = true` iff every one of these holds. `providerSequence` is
   `records.map(r => r.provider)` regardless of outcome, so a failing run's evidence still shows which
   providers were actually dispatched.
4. **AC2 (clean, non-interactive completion).** Requires every found record's `status === "completed"`
   (a `"blocked"`/`"halted"` record means the run stopped itself deliberately, not that it hung --
   distinguish this in `detail`, do not conflate it with a timeout). `ac2.satisfied = turnsFound === 3
   && every record's status === "completed"`. **Explicitly scoped in `detail`:** this command does not
   and cannot re-verify, after the fact, that stdin was genuinely never inherited from a TTY -- that
   guarantee is structural to `runProcess()`'s own closed-stdin/mandatory-timeout design (Phase 1 §6.1,
   PRD FM7), unchanged and not re-derived here. What this check *can* honestly assert is its necessary
   downstream consequence: a run that hung on an interactive prompt would never have produced three
   persisted, `"completed"` records at all (it would have hit `TurnTimeoutError` first), so their
   presence is genuine, if indirect, evidence for AC2.
5. **AC3 (reference and production).** For each found record, re-run `assertLooprArtifactsReferenced()`
   (Phase 4, unmodified) against `{ babyPrdPath: <constant, see below>, contextPath: <constant>,
   specPath: record.spec_ref.path }`, wrapped in try/catch (this module never throws for a modelled
   outcome, §4.2) -- catch -> `artifactsReferenced: false`, `missingArtifactPaths` from the thrown
   error's `details`; no throw -> `artifactsReferenced: true`, `missingArtifactPaths: []`. Because
   `baby_prd_path`/`context_path` are not stored on `HandoffRecord` itself (`RunConfig`-level only,
   §3.5), and because every persisted record in one phase subdirectory was necessarily dispatched
   under the same `RunConfig`, this function derives them once, from the **reviewer's own persisted
   `spec_ref.path`'s directory prefix** joined with the literal filenames `baby_prd.md`/`context.md`
   -- **[DECISION, Phase 5]** a convention this phase's own toy-build fixture follows exactly
   (`loopr/PHASE_1_SPEC.md`, `loopr/baby_prd.md`, `loopr/context.md`, same directory), stated as this
   function's own documented assumption rather than silently guessed: a target build whose
   `baby_prd_path`/`context_path` do **not** share `spec_path`'s directory will report a false
   `artifactsReferenced: false` here even if the live run's own guards genuinely passed, and
   `ac3.detail` must say so plainly when triggered (compare each record's own `artifacts_read` paths
   against the derived expectation and note a mismatch rather than silently misreporting). For the
   reviewer's record specifically (`records[2]`, when present), additionally re-run
   `assertNextPhaseSpecProduced(repoDir, records[2], expectedPath)` (Phase 4, unmodified) where
   `expectedPath = nextPhaseSpecPath(records[2].spec_ref.path, records[2].phase, finalPhase)`
   (Phase 4, unmodified) -- same try/catch-to-boolean pattern, assigned to `ac3.production`.
   `ac3.satisfied = every record's artifactsReferenced === true && (ac3.production === null ||
   ac3.production.satisfied === true)`.
6. **Assemble.** `ok = turnsFound === 3 && ac1.satisfied && ac2.satisfied && ac3.satisfied`. Return the
   full `AcceptanceEvidence` (§3.2). This function never throws for any input short of a genuine
   programming error (e.g. `repoDir`/`runId` of the wrong JS type, which `strict`/`noUncheckedIndexedAccess`
   makes unreachable through the CLI's own zod-validated flag parsing, §6.4).

### 6.3 `LICENSE` / `CONTRIBUTING.md` / `.github/workflows/ci.yml` content

**`LICENSE`.** The unmodified, standard MIT license text, with the copyright line reading
`Copyright (c) 2026 the multi-loopr contributors` -- a generic, defensible attribution for a project
about to be open-sourced with no single confirmed legal-entity name to cite, deliberately not a
fabricated individual or organization name (matching this project's own general discipline against
asserting unverified facts). Matches `package.json`'s existing `"license": "MIT"` field exactly.

**`CONTRIBUTING.md`.** Must state, at minimum: how to build/typecheck/test locally (`npm ci`,
`npm run check` -- the same three scripts README already documents, not a new set); that this project
is built phase-by-phase against `PHASE_N_SPEC.md` specs under an automated review loop (a two-sentence
factual description, not a tutorial on the loop itself); and, honestly, that no public remote or issue
tracker exists yet for this repository at the time this phase ships (`git status`'s own "no remote
configured" state, PRD context) -- stating what's actually true rather than a template's generic
"open a PR" promise this repo cannot currently honour.

**`.github/workflows/ci.yml`.** A single job: `actions/checkout`, `actions/setup-node` with
`node-version: '24'` (satisfying `engines.node: ">=24.0.0"`), `npm ci`, `npm run check`. Triggers on
`push` and `pull_request`. No matrix, no second job, no deploy step, no secret. **Must not** invoke
`doctor --providers`, `doctor` (full, which also runs provider preflight), or `run` -- CI runners have
no BYOA `claude`/`codex` credentials and are structurally the wrong place to attempt a live provider
dispatch (§9); `doctor --boundary` alone (a substring of what `npm run check` already runs) would be
safe to add explicitly but is redundant with `check`, so this workflow does not duplicate it.

### 6.4 `src/cli/main.ts` changes

```
function parseEvidenceArgs(rest: readonly string[]): Command
```

Same flag-loop shape as `parseRunArgs()` (§6.11 of `PHASE_1_SPEC.md`'s own `main.ts` section,
`PHASE_3_SPEC.md`'s `parseRunArgs()`): `--repo-dir <path>` and `--run-id <uuid>` each consume the next
argv element (missing value or missing flag entirely -> `UsageError`); `--final-phase` and `--json`
are boolean presence flags; any other token -> `UsageError` naming the unknown flag. `case
"evidence"` in `main()`'s dispatch `switch` calls `runEvidenceCommand()` (§6.5) and writes
`JSON.stringify(report, null, 2) + "\n"` (when `--json`) or a new `renderEvidenceHumanReport()`'s
output to stdout, returning `exitCode` -- the identical shape the existing `"doctor"`/`"run"` arms
already follow.

### 6.5 `src/cli/evidence.ts`

```
export interface EvidenceCommandOptions {
  readonly repoDir: string;
  readonly runId: string;
  readonly finalPhase: boolean;
  readonly json: boolean;
}
export async function runEvidenceCommand(
  opts: EvidenceCommandOptions,
): Promise<{ report: EvidenceReport; exitCode: number }>
```

Calls `assessAcceptanceEvidence(opts.repoDir, opts.runId, opts.finalPhase)` (§6.2), translates the
returned `AcceptanceEvidence` into `EvidenceReport`'s snake_case wire shape (§3.3), computes
`exit_code = evidence.ok ? ExitCode.OK : ExitCode.ACCEPTANCE_INCOMPLETE`, and returns
`{ report, exitCode }`. **Never calls `process.exit`** -- only `main.ts`'s own entry guard does, the
same rule every prior CLI command function in this project already follows (`runDoctor()`,
`runRunCommand()`).

---

## §7 Failure-Mode Guards

Phase 5 adds no new PRD §9 failure mode of its own -- it is an assembly/demonstration/packaging phase,
not a mechanism phase. This section instead confirms the guards Phases 1-4 already built are exercised
for real, and closes out the two carried-forward open items this dispatch's own context named.

| Guard / open item | Status after Phase 5 | Reviewer check (mechanical) |
|---|---|---|
| **AC1-AC3, live** | A real toy build, dispatched through the unmodified Phases 1-4 mechanism, is the first genuinely live exercise of the full chain. | See §8's machine-conditioned live-run item -- this is the one item in this project's history that is honestly dependent on the reviewing machine's real, current provider-authentication state, the same category `PHASE_1_SPEC.md` §8 item 18 already established for `doctor --providers`. |
| **`assessAcceptanceEvidence()` never spawns a process** | `src/dispatch/acceptance.ts` imports only `fs` (directory/file read), `readHandoffRecord`, `verifyContinuation`, `assertLooprArtifactsReferenced`, `assertNextPhaseSpecProduced`, `nextPhaseSpecPath` -- no `runProcess`, no `node:child_process`. | 1. Grep `src/dispatch/acceptance.ts` for `child_process`/`runProcess` -- zero hits. 2. Confirm `node:child_process` is still imported in exactly one file in the whole tree: `src/util/exec.ts` (unchanged since Phase 1, re-confirmed every phase since). |
| **`evidence` never mutates the target repo** | No `fs.writeFile`/`fs.mkdir`/git-write call anywhere in `src/dispatch/acceptance.ts` or `src/cli/evidence.ts`. | Grep both files for `writeFile`/`mkdir`/`unlink`/`git commit`/`git add` -- zero hits; confirm by reading the diff directly, not merely by grep, that every call is read-only. |
| **HARD BOUNDARY (PRD §5.1)** | No B1-B8 pattern anywhere in the new/modified `src/**` files. `"claude-code"`/`"codex-cli"` string literals (already used throughout `src/domain/run.ts` since Phase 1) are `ProviderId` values, not B7's concrete-model-name/tier-alias pattern -- confirmed not to match B7's regex, the same as every prior phase's own equivalent row. | 1. `node src/cli/main.ts doctor --boundary` exits `0`. 2. Confirm the scan still reports the same file count plus exactly the two new `src/**` files added this phase (`acceptance.ts`, `evidence.ts`, plus their `.test.ts` files, which are excluded from the scan itself per the standing `*.test.ts` exclusion). |
| **`RunHaltedError` -- final resolution, not deferred again** | Still declared in `src/domain/errors.ts`, still never constructed anywhere. Phase 5 touches none of `run-loop.ts`'s "return the exit code, never throw for a modelled failure" control flow (§1.9: file untouched), and the toy build's own dispatch runs through that exact, unmodified code path -- a genuinely `"blocked"`/`"halted"` toy-build turn (unlikely but possible if a dispatched agent legitimately judges the toy task ambiguous) is already correctly surfaced as `RunResult.exitCode = ExitCode.RUN_HALTED` without the class ever needing construction, exactly as Phases 3-4 already established. **Because there is no Phase 6 to defer this to again**, this is this project's own final word on the question: `RunHaltedError` was speculative scaffolding from Phase 3's own design that V1's actual shipped control-flow shape (`run-loop.ts` returns, `runTurn()`'s own guards throw) never needed a construction site for, across all five phases. Recorded as a closed, correct non-issue in this phase's own `COMPREHENSION.md` update (§9), not left as a dangling "future phase" pointer with no future phase to point to. | 1. Grep the full `src/` tree for `new RunHaltedError` -- zero hits, confirmed still correct. 2. Confirm this phase's diff touches no line of `run-loop.ts`. 3. Confirm the Phase 5 comprehension pass (Step 14, dispatched after this phase's approval) states this closure explicitly rather than mechanically re-carrying the Phase 2/3/4 "still open" language forward with nothing left to resolve it against. |
| **The reference-attestation "named vs. genuinely read" gap (`COMPREHENSION.md` §5/§6, Phase 4)** | **Not closed by this phase, and not attempted.** `assessAcceptanceEvidence()`'s AC3 re-derivation has exactly the same structural ceiling `assertLooprArtifactsReferenced()` itself already has (§6.2 step 5 re-runs the identical function) -- it can prove a path was named and truthfully hashed, not that the agent's own reasoning engaged with the content. Closing this would require either crossing PRD I5's isolation boundary or a verification capability outside V1's scope, exactly as `COMPREHENSION.md` §6 already concluded, and that conclusion is not revisited here. | Confirm this phase's own diff introduces no new hash/path/read-tracing mechanism beyond re-invoking the existing Phase 4 guards, and confirm the Phase 5 comprehension pass explicitly re-states (not silently drops) this as a permanent, disclosed, accepted V1 limitation now that there is no further phase to potentially close it in. |

---

## §8 Phase Acceptance Criteria

Phase 5 is approved only when **every** item below is objectively true.

**Regression (no prior-phase behaviour broken)**
1. `npm run typecheck` exits `0` with **zero** diagnostics, across the full tree including
   `src/dispatch/acceptance.ts` and `src/cli/evidence.ts`.
2. `npm run test` exits `0`. Every Phase 1-4 test file passes unmodified -- no existing fixture
   requires a new field this phase (Phase 5 adds no required field to any existing schema, §3.4/§3.5).
3. `node src/cli/main.ts doctor --boundary` exits `0`.
4. `npm run check` exits `0`.
5. `--version`, `--help`, `doctor`, `doctor --json`, `doctor --boundary`, `doctor --providers`, and
   `run --config <path> [--json]`'s own flag parsing all behave byte-identically to
   `PHASE_1_SPEC.md`/`PHASE_3_SPEC.md`/`PHASE_4_SPEC.md` §4.

**Static discipline**
6. `z.object(` and `z.string().datetime(` do not appear anywhere under `src/dispatch/acceptance.ts`
   or `src/cli/evidence.ts`.
7. The token `any` does not appear as a type annotation under either new file or any modified file's
   new code.
8. `enum `, `namespace `, and constructor parameter properties appear nowhere under either new file.
9. `node:child_process` is still imported in exactly one file in the whole tree: `src/util/exec.ts`.

**Behaviour -- `assessAcceptanceEvidence()`**
10. Against a real temporary git repo with three real, correctly-shaped, correctly-persisted
    `HandoffRecord` fixtures (two executors, different providers, then a reviewer; genuine `CONTINUED`
    ancestry between each consecutive pair; genuine artifact references; a genuinely produced
    `BUILD_COMPLETE.md`), `assessAcceptanceEvidence()` returns `ok: true` with all three ACs
    `satisfied: true` -- dedicated test.
11. A fixture missing the second executor's provider distinctness (both executor turns report the same
    `provider`) fails AC1 specifically, with `ac2`/`ac3` evaluated independently and correctly on their
    own terms (not short-circuited by AC1's failure) -- dedicated test.
12. A fixture where the second executor's turn is a real `REDO` (per `verifyContinuation()`'s own
    C3 semantics, replayed against a real temp repo) fails AC1 with `verdict: "REDO"` surfaced in
    `continuity` -- dedicated test.
13. A fixture where the reviewer turn's own `status` is `"halted"` fails AC2, with `turnStatuses`
    correctly reporting the halted turn -- dedicated test.
14. A fixture where one turn's `artifacts_read` omits `context.md` fails AC3 for that turn
    specifically, naming it in `missingArtifactPaths`, while other turns' `artifactsReferenced`
    remain independently correct -- dedicated test.
15. A fixture where the reviewer's commits never touch the computed `BUILD_COMPLETE.md` path (the
    same "declared but not touched" scenario `artifacts.test.ts`'s own third `assertNextPhaseSpecProduced`
    test already builds, replayed here through `assessAcceptanceEvidence()`) fails AC3's `production`
    specifically -- dedicated test.
16. Zero persisted turns (missing `handoff/` directory entirely) returns `turnsFound: 0`, `ok: false`,
    every AC `satisfied: false`, and a `problems` entry naming the missing path -- **does not throw**
    -- dedicated test.
17. Two phase subdirectories present under one `runId` returns `ok: false` with a `problems` entry
    naming both phase numbers found -- dedicated test.
18. `finalPhase: false` against a fixture whose reviewer turn genuinely produced `PHASE_2_SPEC.md`
    (not `BUILD_COMPLETE.md`) passes AC3's production check; the same fixture assessed with
    `finalPhase: true` fails it, confirming the flag is genuinely load-bearing, not ignored --
    dedicated test.

**Behaviour -- CLI**
19. `multi-loopr evidence` with a valid `--repo-dir`/`--run-id` against the fixture from item 10 exits
    `0` and its `--json` output validates against `EvidenceReport`.
20. `multi-loopr evidence` missing `--repo-dir`, missing `--run-id`, or passed an unknown flag, each
    exits `2` -- dedicated tests, mirroring `run.test.ts`'s own existing flag-validation coverage shape.
21. `multi-loopr evidence` against the item-16 (zero-turns) scenario exits `13`.
22. `runEvidenceCommand()` never calls `process.exit` -- confirmed by direct code read, the same check
    `PHASE_1_SPEC.md` §6.10 already specified for `runDoctor()`.

**Behaviour -- packaging**
23. `LICENSE` exists at the repo root and its text matches the standard, unmodified MIT license.
24. `CONTRIBUTING.md` exists and contains, at minimum, the `npm ci`/`npm run check` commands and an
    honest statement that no public remote exists yet.
25. `.github/workflows/ci.yml` exists, is syntactically valid YAML, triggers on `push` and
    `pull_request`, and its only command steps are `npm ci` and `npm run check` -- grep confirms no
    occurrence of `doctor --providers`, bare `doctor`, or `run --config` anywhere in the file.
26. `package.json`'s `"files"` field is exactly `["src", "README.md", "LICENSE"]`; `"private"` is
    still `true`; `dependencies`/`devDependencies`/`scripts` are byte-identical to
    `PHASE_1_SPEC.md` §2.1's own pinned content.

**Behaviour -- toy build fixture**
27. `examples/toy-build/loopr/baby_prd.md`, `context.md`, and `PHASE_1_SPEC.md` all exist, are
    non-empty, and each names `wordcount.mjs`'s exact required stdout format
    (`lines: <n> words: <n> chars: <n>`) -- grep-verifiable substring check, the same shape
    `prompt.test.ts`'s own mandatory-content assertions already use.
28. `examples/toy-build/run-config.template.json` parses as JSON and, with its two placeholders
    replaced by a valid UUID and an absolute path, validates against `RunConfig` -- dedicated test
    (this is the one item in this section that *can* be checked without any live provider CLI: it
    tests the template's own shape, not a live dispatch).
29. `examples/toy-build/README.md` documents all five steps in §6.1, each referencing an existing
    `multi-loopr` command or a plain `git`/`node` command -- no reference to a script this phase does
    not ship.

**Contract coverage** (dedicated-test presence and correctness, continuing every prior phase's
established convention -- no blanket coverage-percentage target)
30. Every function named in §6 has at least one dedicated test. `acceptance.test.ts`'s tests use
    **real temporary git repositories** and **real, hand-constructed `HandoffRecord` JSON files
    written to a real `handoff/` directory** (`continuity.test.ts`'s and `artifacts.test.ts`'s own
    established pattern) -- no test in this phase spawns a real `claude` or `codex` process.

**Documentation**
31. `README.md` gains an `## Examples` section pointing at `examples/toy-build/README.md` and a
    one-sentence mention of `multi-loopr evidence`, and makes no claim about a live toy-build run
    having occurred unless item 32 below is genuinely satisfied on the reviewing machine.

**The live, real-credential demonstration -- machine-conditioned, honestly scoped (mirrors
`PHASE_1_SPEC.md` §8 item 18's own treatment of live auth state exactly)**
32. **If, at the time this phase is reviewed, `node src/cli/main.ts doctor --providers` reports both
    `claude-code` and `codex-cli` as `authenticated: true` on the reviewing machine:** the reviewer
    must actually perform the §6.1 procedure end to end -- materialize the toy build fixture, dispatch
    a real `multi-loopr run`, and confirm `multi-loopr evidence` reports `ok: true` with all three ACs
    satisfied -- and record the real `run_id`, the toy repo's real `git log --oneline` output, and the
    `evidence --json` output in this phase's own approval commit or `COMPREHENSION.md` update, as the
    first genuine, live, end-to-end confirmation of PRD AC1-AC3 this project has ever produced.
    **If either provider is not authenticated:** the reviewer must instead (a) run
    `doctor --providers` for real and record its real, current output naming which provider blocks a
    live run, honestly and without embellishment, exactly as `PHASE_1_SPEC.md` §8 item 18 already did
    for this same condition; (b) verify items 10-18 above (the fixture-based, no-live-CLI test suite)
    pass in full, since that is the evidence this phase's *code* is correct that does not depend on
    machine auth state; and (c) record explicitly, in the approval commit or `COMPREHENSION.md`, that
    AC1-AC3's live demonstration remains a documented, ready-to-run, but not-yet-performed operator
    action pending both providers' authentication on some machine -- not a defect in this phase's own
    work, and not silently omitted from the record either.

---

## §9 Explicit NON-GOALS

Phase 5 does **not** build the following. A pull of any item below into Phase 5 is a scope violation
and must be rejected by the review agent even if the code is correct. Because this is the final phase,
several items here are permanent V1 boundaries, not deferrals to a next phase that does not exist.

**Content generation and quality -- still never multi-loopr's job**
1. Generating, templating, or validating the actual prose content of the toy build's own
   `baby_prd.md`/`context.md`/`PHASE_1_SPEC.md`/`wordcount.mjs`/`BUILD_COMPLETE.md` at *dispatch* time
   -- these are authored once, by this phase's own executor, as static example fixture content
   (`examples/toy-build/loopr/**`) and then genuinely written by the dispatched agents during the live
   run; multi-loopr's own runtime code never generates or grades any of it, the same restraint
   `PHASE_4_SPEC.md` §9 items 1-2 already established for `assertNextPhaseSpecProduced()`, extended
   here to `assessAcceptanceEvidence()`'s own re-derivation (it checks provenance, never quality).
2. Judging whether the toy build's `wordcount.mjs` is *good* code, beyond `node --test` exiting `0` --
   loopr's own review discipline, carried out by the dispatched reviewer archetype itself, governs
   quality; multi-loopr's mechanism never has and does not start now.

**Packaging -- prepared, not executed**
3. Running `npm publish`, flipping `"private"` to `false`, or registering an npm account/org. Exactly
   the same restraint this project already applies to `git push`/`git remote add` -- an irreversible,
   credentialed action that is the operator's own deliberate decision, not something a build phase
   performs on its own initiative.
4. Adding a release/tag/versioning workflow, a changelog generator, or any GitHub Actions job beyond
   the single `npm run check` CI job (§1.8/§6.3). No deploy step, no npm-publish-on-tag automation.
5. Registering a real `"repository"`/`"homepage"`/`"bugs"` URL in `package.json` -- no remote is
   configured for this repo; fabricating one would be worse than omitting the field.

**Live execution boundaries**
6. Any CI job that invokes `doctor --providers`, `doctor` (unqualified), or `run` -- CI has no BYOA
   provider credentials, and multi-loopr must never be the reason a CI environment is taught to expect
   or store one (PRD §5's hard boundary: no hosted/proxied credential of any kind).
7. Any code path, in `assessAcceptanceEvidence()` or elsewhere, that spawns `claude` or `codex` --
   `evidence` is a strictly offline, read-only audit over already-produced artifacts (§7).
8. **Multi-phase autonomous looping**, still. The toy build is deliberately a single phase
   (`is_final_phase: true`) precisely so this restriction (`PHASE_3_SPEC.md` §9 item 4, restated by
   every phase since) is honoured, not tested against, by the one demonstration this project ships.

**`RunHaltedError` and the reference-attestation gap -- final resolution, not further deferral**
9. Constructing `RunHaltedError` anywhere. §7's dedicated row states the final resolution: it was
   speculative Phase 3 scaffolding V1's actual, shipped control-flow shape never needed. This is not
   revisited as a "future phase" item because there is no future phase.
10. Adding any new mechanism to close the "named the artifact path vs. genuinely read its content" gap
    `COMPREHENSION.md` §5/§6 disclosed after Phase 4. Closing it for real would require crossing PRD
    I5's isolation boundary or a verification capability outside V1's scope -- both explicitly out of
    V1 entirely (PRD §3), not something this final phase reopens on its way out.

**Out of V1 entirely (PRD §3) -- never built, in any phase, and V1 now ships without them**
11. A third provider, or any routing beyond the fixed ordered pair.
12. Cost, token, or budget tracking.
13. The AUDITOR or RESEARCHER archetypes' dispatch paths.
14. Concurrent or parallel agent execution, or any asynchronous inter-agent messaging.
15. Any indexing, embedding, knowledge-graph, or retrieval layer.
16. Any GUI, TUI, web server, or HTTP endpoint.
17. Anything that would trip boundary rules B1-B8 -- including inside `src/dispatch/acceptance.ts`
    and `src/cli/evidence.ts`, which get **no** B7 exemption (only `src/adapters/**` is ever exempted).

**Explicitly not a Phase 5 goal even though it may look adjacent**
18. A bespoke orchestration script for the toy build (§6.1's own stated reasoning: three already-
    shipped pieces -- fixture content, `run`, `evidence` -- suffice; a fourth, script-shaped piece of
    machinery is not warranted for a one-time demonstration).
19. Materializing the toy build's target repo *inside* multi-loopr's own working tree, or adding
    anything to `.gitignore` for it -- the documented procedure (§6.1 step 1) places it in a separate
    directory entirely, so no nested-git-repository or ignore-rule question arises.
20. A `--phase` flag on `evidence`, or any support for assessing more than one phase's evidence in a
    single invocation -- §6.2 step 1's "more than one phase subdirectory is reported as ambiguous
    input, not resolved" design is deliberate, matching this project's single-phase-per-run
    architecture throughout.
21. Amending `PHASE_1_SPEC.md`, `PHASE_2_SPEC.md`, `PHASE_3_SPEC.md`, or `PHASE_4_SPEC.md` themselves.
22. Writing `BUILD_COMPLETE.md` -- that happens only once Phase 5 itself is built and reviewed and
    approved, by that future review dispatch, not by this spec.

# COMPREHENSION.md -- multi-loopr

_Maintained by the Step 14 comprehension pass. Sections 1-6 describe the current state of the system
after the most recently approved phase; they are rewritten each phase, not appended to. The Phase Log
at the bottom is append-only history._

## 1. Plain-language walkthrough

multi-loopr is a tool for having two different AI coding assistants -- Claude Code and Codex -- take
turns working on the same software project, on the operator's own computer, without any company's
central relay service sitting in between. Think of it as a relay race: one assistant does a stretch of
work, then hands the baton to the other, which is expected to genuinely continue that work rather than
redo it, ignore it, or quietly undo it. A third leg then reviews the combined result. multi-loopr's job
is not to write any of the code itself -- it is to dispatch each assistant's turn, and then, using only
mechanical, repeatable checks (never by trusting what an assistant says about its own work), confirm
that the handoff was genuine.

This was built in five stages, and this phase is the last of them. Phase 1 built the plumbing the race
runs on: a shared "handoff note" format each assistant fills in describing what it read and wrote, a
locking mechanism so only one run happens at a time, and a set of hard rules ("the boundary") the code
itself is checked against so an assistant can never quietly weld in things like a hardcoded model name.
Phase 2 taught the tool how to speak each assistant's own command-line language -- what to type to
invoke Claude Code versus Codex, and how to read back whether each one actually succeeded. Phase 3
pressed the button for the first time: it made multi-loopr actually spawn the real assistant processes,
run the fixed three-leg sequence, and never simply believe what an assistant claims about its own work
-- every self-reported git commit and file fingerprint gets thrown away and recomputed from the real
repository before being trusted. Phase 4 added two mechanical checks that make sure each assistant
genuinely referenced the project's own planning documents (a problem statement, a background document,
and a numbered blueprint) during its turn, and that the reviewing assistant genuinely wrote the next
blueprint rather than merely claiming to.

This final phase does not add a new safety mechanism of its own kind. Instead it does two things: it
builds a second, independent way to check the previous four phases' own work after the fact, and it
prepares the whole project to be shared with other people.

The first piece is a new command, `multi-loopr evidence`. After a run has finished, an operator can
point this command at the run's own saved records and ask it to re-derive, from scratch, whether the
three things this whole project exists to prove actually happened: did the second assistant genuinely
continue the first's work rather than redo or ignore it; did the whole thing finish cleanly with no
person needing to click through a prompt; and did both assistants genuinely reference the project's
planning documents rather than being handed their location and ignoring it. This command reads only
what was already saved to disk during the run -- it never re-runs the assistants, never trusts the
run's own live report of itself, and never changes anything in the project it is checking.

The second piece is a small, real, deliberately tiny worked example: a project that asks the two
assistants to build a one-file command-line tool that counts lines, words, and characters from typed
input. This "toy build" exists so an operator can actually watch the whole relay happen for real, start
to finish, rather than only reading about the mechanism in the abstract. On the machine this phase was
reviewed on, one of the two assistants (Codex) was not signed in at the time, so this live demonstration
was prepared and is ready to run, but has not actually been carried out yet -- that is recorded plainly
below rather than glossed over or falsely claimed.

The third piece is ordinary but necessary "make this shareable" work: an open-source license file, a
short document explaining how someone would build and test the project themselves, and an automated
check that runs every time code changes, confirming nothing is broken. None of this changes what the
tool does -- it only prepares it to be handed to someone else.

Two questions this project has carried since earlier phases are now settled for good, because this is
the last phase and there will not be another chance to revisit them. First: a specific kind of error the
code declared space for very early on, meant to represent "the run stopped because an assistant said it
could not safely continue," turned out to never actually get used anywhere -- every phase, including
this one, found a different, already-working way to report that same situation. That is now recorded as
a deliberate, permanent design outcome, not an oversight. Second: this phase's new "did both assistants
genuinely reference the planning documents" check inherits a known, honestly-disclosed limitation from
Phase 4 -- it can prove an assistant *named* a real document and that the document's content is what it
truly is, but it cannot prove the assistant's own reasoning actually drew on what was inside that
document rather than merely copying the document's location into its own self-report. This limitation
is not something this final phase could close, and it is recorded here as a permanent, disclosed
boundary of what a tool watching an AI assistant from the outside can ever verify -- not a defect to
chase further.

## 2. Architecture walkthrough

Every file below was confirmed to exist at the stated path this run (`find src -type f -name "*.ts"`,
re-checked directly). This section describes the whole finished system across all five phases, grouped
by directory, not only Phase 5's own slice -- Phase 5 is the last phase, so there is no future entry
left to defer a fuller architecture description to.

**`src/domain/` -- shared types and error taxonomy, no I/O.**
- `errors.ts` -- the canonical `ExitCode` table (a plain object, not a TypeScript `enum`, because
  `tsconfig.json`'s `erasableSyntaxOnly` forbids `enum`) and the `MultiLooprError` class hierarchy
  every deterministic check throws through. Now 14 exit codes (`0`-`13`), the last two added by Phases
  4 and 5 respectively (`LOOPR_ARTIFACT_BYPASSED = 12`, `ACCEPTANCE_INCOMPLETE = 13`, confirmed by
  direct read this run). `RunHaltedError` is declared here (class body present, `exitCode =
  ExitCode.RUN_HALTED`) but a tree-wide grep this run (`grep -rn "RunHaltedError" src/`) finds it in
  exactly two places: its own declaration, and a doc-comment in `run-loop.ts` explaining why it stays
  unconstructed. See §5/§6.
- `relay.ts` -- `HandoffRecord`, the versioned (`RELAY_SCHEMA_VERSION = 1`, unchanged across all five
  phases) zod schema every turn's saved record is validated against, plus `readHandoffRecord()`/
  `writeHandoffRecord()`. Untouched since Phase 3.
- `run.ts` -- `RunConfig` (the operator-supplied run configuration, now including `baby_prd_path`,
  `context_path`, and `is_final_phase` since Phase 4) and `TurnRequest` (the plain interface threaded
  into each dispatched turn). Untouched this phase (confirmed: not in the Phase 5 diff).
- `tiers.ts`, `roles.ts` -- the `ModelTier` map and the five-archetype role registry (only two
  archetypes, EXECUTOR and REVIEWER, actually dispatch in V1; AUDITOR/RESEARCHER remain declared-only,
  confirmed unused in any dispatch path).

**`src/ports/provider-adapter.ts`** -- the `ProviderAdapter` interface every concrete adapter
implements. Declarations only, unchanged since Phase 1.

**`src/adapters/` -- the two concrete provider integrations.**
- `claude-code.ts`, `codex-cli.ts` -- build a pure `Invocation` (argv/env/cwd/stdin) for each CLI, map
  `ModelTier` to that provider's own effort value, and interpret a completed process result into a
  `TurnOutcome` verdict. Untouched since Phase 2; confirmed byte-identical through Phase 5's own diff.
- `registry.ts` -- `ADAPTER_REGISTRY`, the concrete `AdapterRegistry` value mapping `ProviderId` to its
  adapter.
- `conformance.ts` -- `assertAdapterConformance()`, a shared test-only suite both adapters' own test
  files call against themselves.

**`src/util/` -- host primitives, each imported from exactly the places the boundary scan expects.**
- `exec.ts` -- `runProcess()`, the *only* file in the whole tree that imports `node:child_process`
  (re-confirmed this run by grep: every other tree-wide hit for `child_process` is prose in a comment
  explaining this exact invariant, not an import). Closed-stdin, mandatory-timeout process spawning.
- `hash.ts` -- `sha256File`/`sha256String`. `lock.ts` -- the exclusive run lock
  (`.multi-loopr/run.lock`). `paths.ts` -- `handoffPath()` and friends, the run-scoped file-layout
  convention every phase since has relied on unmodified.

**`src/verify/` -- general-purpose, repo-wide deterministic verifiers, untouched since Phase 3.**
- `git.ts` -- thin plumbing wrappers (`revParse`, `commitsBetween`, `changedPaths`, `currentBranch`).
- `continuity.ts` -- `verifyContinuation()` and its fixed five-check `CONTINUITY_CHECKS` tuple
  (`ContinuityVerdictLabel`: `CONTINUED`/`REDO`/`PARTIAL_REVERT`/`IGNORED`/`DIVERGED`), the mechanism
  behind PRD AC1. `commits.ts` -- `assertNeutralCommits()`, the boundary check on commit
  authorship/attribution (PRD I4). `boundary.ts`/`boundary-rules.ts` -- `scanBoundary()` and the eight
  B1-B8 hard-boundary rules (PRD §5.1). `preflight.ts` -- toolchain/provider version and
  authentication checks, including `buildProviderPreflightReport()`.

**`src/dispatch/` -- the sequential dispatch engine, now including this phase's own new module.**
- `plan.ts` -- `planTurnSequence()`, resolving PRD §6.3's DECISION into the fixed three-slot
  executor/executor/reviewer sequence.
- `prompt.ts` -- `buildExecutorPrompt()`/`buildReviewerPrompt()`, including Phase 4's mandatory
  artifact-reference instructions and reviewer-only artifact-production instructions.
- `record.ts` -- `reconcileHandoffRecord()`, which discards an agent's self-reported git/hash claims
  and recomputes them from the real repository before anything is trusted or persisted.
- `turn.ts` -- `runTurn()`, one full turn end to end: spawn, interpret, reconcile, then Phase 4's two
  artifact guards, then `assertNeutralCommits()`, then persist.
- `run-loop.ts` -- `runDispatch()`/`runTurnLoop()`/`runExtendedPreflight()`: the lock, the three-turn
  sequence, continuity gating between consecutive turns, and the single bounded retry scoped to one
  failure class. Untouched this phase (confirmed: not in the Phase 5 diff).
- `artifacts.ts` (Phase 4) -- `nextPhaseSpecPath()`, `assertLooprArtifactsReferenced()`,
  `assertNextPhaseSpecProduced()`. Untouched this phase; re-imported (not re-implemented) by this
  phase's own new module.
- **New this phase: `acceptance.ts`** -- `assessAcceptanceEvidence(repoDir, runId, finalPhase)`, the
  offline, deterministic re-derivation of PRD AC1/AC2/AC3 straight from a completed run's already-
  persisted `HandoffRecord` files. Internally: `assessAc1()` (re-runs `verifyContinuation()` on both
  consecutive turn pairs), `assessAc2()` (checks every persisted turn's `status === "completed"`),
  `assessAc3()` (re-runs `assertLooprArtifactsReferenced()` per turn and
  `assertNextPhaseSpecProduced()` for the reviewer turn, both imported unmodified from `artifacts.ts`).
  Confirmed by reading the file directly: it imports only `node:fs/promises` (`readdir`) plus the
  Phase 1/4 primitives named above -- no `runProcess`, no `node:child_process`, and no `writeFile`/
  `mkdir`/`unlink` call anywhere in the file, matching its own documented "never spawns, never
  mutates" contract.
- `acceptance.test.ts` -- exercises every branch above against real temporary git repositories and
  real, hand-written `HandoffRecord` JSON files placed in a real `handoff/` directory (the same pattern
  `continuity.test.ts`/`artifacts.test.ts` already established), plus (added by the post-approval fix
  patch `ed81c7c`) a dedicated test parsing `examples/toy-build/run-config.template.json` and
  validating it against `RunConfig` once its two placeholders are filled in.

**`src/cli/` -- the three user-facing commands.**
- `doctor.ts` -- `runDoctor()`, the toolchain/provider/boundary/lock health check. Untouched this
  phase.
- `run.ts` -- `runRunCommand()`, dispatching one loopr phase's turn sequence. Untouched this phase.
- **New this phase: `evidence.ts`** -- `EvidenceReport` (the `--json` wire schema, `schema_version: 1`,
  snake_case, mirroring `DoctorReport`/`RunReport`'s own `z.strictObject` style exactly) and
  `runEvidenceCommand()`, which calls `assessAcceptanceEvidence()`, translates its camelCase
  in-process result into `EvidenceReport`'s wire shape, computes `ok`/`exit_code`, and returns
  `{report, exitCode}` without ever calling `process.exit` -- confirmed by reading the function body
  directly, matching `runDoctor()`/`runRunCommand()`'s own established contract.
- `main.ts` -- gains, this phase, `parseEvidenceArgs()` (the same required-`--repo-dir`/required-
  `--run-id`/boolean-`--final-phase`/boolean-`--json` flag-loop shape as `parseRunArgs()`), a
  `case "evidence"` dispatch arm, and `renderEvidenceHumanReport()`. Confirmed by reading the diff
  directly: every existing `--version`/`--help`/`doctor`/`run` branch is untouched, and the new
  `evidence` branch is additive in the same shape.

**`examples/toy-build/` (new this phase, deliberately outside `src/`, not part of the compiled/scanned
tree)** -- `README.md` (the five-step operator procedure: materialize a fresh repo outside this one,
generate a config, preflight, dispatch, collect evidence), `loopr/baby_prd.md`, `loopr/context.md`,
`loopr/PHASE_1_SPEC.md` (the toy task's own three loopr artifacts, describing a single-file
`wordcount.mjs` CLI that prints `lines: <n> words: <n> chars: <n>`), and
`run-config.template.json` (a concrete `RunConfig` literal with exactly two placeholders, `run_id` and
`repo_dir`; every other field, including `executor_providers: ["claude-code", "codex-cli"]` and
`is_final_phase: true`, is concrete). Confirmed by direct read: no `.ts` file exists anywhere under
`examples/`.

**Packaging files (new this phase):** `LICENSE` (unmodified standard MIT text, confirmed present at
repo root), `CONTRIBUTING.md` (build/test instructions plus an honest statement that no public remote
exists yet), `.github/workflows/ci.yml` (checkout, `setup-node@v4` pinned to Node 24, `npm ci`,
`npm run check` -- confirmed by direct read: no `doctor --providers`, bare `doctor`, or `run` anywhere
in the file). `package.json` gains one field, `"files": ["src", "README.md", "LICENSE"]`, confirmed by
direct read to be the only change -- `"private": true`, `dependencies`, `devDependencies`, and
`scripts` are byte-identical to Phase 1's own pinned content.

Verified this run by direct execution, not merely by reading source: `npm run typecheck` exits `0` with
zero diagnostics; `npm run check` (typecheck + full test suite + boundary scan) exits `0`, reporting 239
passing tests and 30 files scanned with 0 boundary violations (matching the approval commit `b2c778d`'s
own stated post-fix-patch numbers exactly -- 239 = 238 shipped plus the one test added by the review's
own fix patch `ed81c7c`); `node src/cli/main.ts doctor --boundary` exits `0` standalone with the same
30-file, 0-violation result. `node src/cli/main.ts doctor --providers --json` was also run live this
pass: `claude-code` reports `authenticated: true`, `codex-cli` reports `authenticated: false`, exit
code `3` -- identical to what the approval commit itself recorded at review time, confirming the
machine's provider-authentication state has not changed since approval.

## 3. Decisions and tradeoffs

**`assessAcceptanceEvidence()` re-runs the existing Phase 1/4 checking primitives rather than
re-implementing their logic.** Confirmed by reading `acceptance.ts` directly: `assessAc1()` calls
`verifyContinuation()` (Phase 1) unmodified; `assessAc3()` calls `assertLooprArtifactsReferenced()`
and `assertNextPhaseSpecProduced()` (Phase 4) unmodified, catching their thrown
`LooprArtifactBypassError` and converting it to a boolean field rather than letting it propagate. The
tradeoff: this guarantees the evidence command can never silently drift from what the live run itself
enforces (there is only one implementation of each check, not two that could diverge), at the cost of
`acceptance.ts` needing every one of these functions to already be pure/re-callable outside their
original single-call-site context -- true for all of them, confirmed by reading each function's own
signature, but a constraint this phase relied on rather than tested for independently.

**`assessAc1`/`assessAc3` never let a thrown error escape -- every check converts a caught exception
into an unsatisfied verdict with a `detail` string, so the module keeps its own "never throw for a
modelled outcome" contract.** Confirmed by reading both functions directly: `assessAc1()` wraps its two
`verifyContinuation()` calls in a try/catch that folds a thrown `ContinuityError` (the narrow bad-git-
object path `continuity.ts` itself documents as its one propagated exception) into `satisfied: false`;
`assessAc3()` wraps each `assertLooprArtifactsReferenced()`/`assertNextPhaseSpecProduced()` call
individually. The tradeoff, confirmed accurate by the review's own written verification: folding a
genuine environment failure (e.g. a corrupted git object) into "AC1 could not be verified, unsatisfied"
is honest and matches this command's own "never crash, always report" contract, but it also means a
truly exceptional, non-modelled failure (a bug, not a modelled outcome) is reported identically to a
genuine AC1 failure -- `problems`/`detail` carries the distinguishing message, the boolean result does
not.

**AC3's re-derivation must guess `baby_prd_path`/`context_path` from the reviewer's own persisted
`spec_ref.path` directory prefix, because `HandoffRecord` itself never stored those two paths.**
Confirmed by reading `src/domain/relay.ts` (untouched since Phase 3: `HandoffRecord` has no
`baby_prd_path`/`context_path` field) and `acceptance.ts`'s `assessAc3()` (derives
`` `${dir}baby_prd.md` ``/`` `${dir}context.md` `` from `reviewerRecord.spec_ref.path`'s own directory
prefix). The tradeoff, stated in the function's own doc comment and confirmed accurate: a target build
whose `baby_prd_path`/`context_path` do not share `spec_path`'s directory will report a false
`artifactsReferenced: false` even if the live run's own Phase 4 guards genuinely passed at the time --
`findBasenameElsewhere()` detects and surfaces this specific mismatch case in `detail` rather than
silently misreporting it, but does not correct the false negative itself. This is a real, disclosed
limitation of reading evidence back after the fact from a schema that was never extended to carry those
two paths directly, not a bug -- extending `HandoffRecord` to carry them was available but not taken,
because Phase 5's own §3.4/§3.5 explicitly commits to no schema change this phase.

**`multi-loopr evidence` assesses exactly one phase's worth of evidence per invocation, and reports
"more than one phase subdirectory found" as an unresolved ambiguity rather than picking one.** Confirmed
by reading `assessAcceptanceEvidence()` directly: `phaseDirNames.length > 1` returns `emptyEvidence()`
with every AC unsatisfied and a `problems` entry naming every phase number found, rather than assessing
the most recent or any other selected one. The tradeoff: an operator who ran more than one phase under
the same `run_id` (unusual, since `RunConfig.run_id` is documented to identify one run of one phase)
gets a maximally honest "cannot tell you which one you meant" report instead of a possibly-wrong guess
-- consistent with V1's standing "no multi-phase autonomous looping, no `--phase` flag on `evidence`"
restriction (§9 items 8/20 of `PHASE_5_SPEC.md`).

**`RunHaltedError` was never constructed in any of the five phases, and this phase treats that as this
project's own final, settled answer rather than a still-open question.** Re-confirmed this run: a
tree-wide grep for `RunHaltedError` finds only its own class declaration and a doc-comment reference in
`run-loop.ts`. The tradeoff, and the reason this is now closed rather than carried forward: `run-loop.ts`
communicates a halted/blocked turn by returning `RunResult.exitCode = ExitCode.RUN_HALTED` directly, not
by throwing, and every guard added since (Phase 4's `LooprArtifactBypassError`, Phase 5's own read-only
`evidence` command, which raises no thrown error at all) followed the opposite, already-established
"guards that fire mid-turn throw; the turn loop itself returns" split instead of retrofitting a
construction site for this specific class. `RunHaltedError` was Phase 3's own speculative scaffolding for
a control-flow shape V1's actual shipped code never needed -- correct to leave unconstructed, not an
oversight, and there is no Phase 6 left to reconsider it in.

**Open-source packaging is prepared, not executed.** `package.json` gains `"files"` but `"private"`
stays `true` (confirmed by direct read); no `npm publish`, no flipped visibility flag, no fabricated
`"repository"`/`"homepage"` URL for a repo that genuinely has no configured remote. The tradeoff,
consistent with this project's own established restraint around `git push`/`git remote add`: the project
is left in a state where publishing is a small, deliberate, credentialed step away, rather than one this
build performed on its own initiative.

**Retries remain bounded to exactly one, and remain scoped to exactly one failure class -- a
non-`CONTINUED` continuity verdict -- unchanged since Phase 3.** Confirmed by reading `run-loop.ts`
directly: still exactly one retry code path in the file; this phase adds no dispatch-time error class at
all (`evidence` is a read-only post-hoc audit, not a dispatch-time guard), so the retry bound's scope is
unchanged from what Phase 4's own comprehension pass already recorded. The tradeoff is the same one
already carried forward across every phase: this bound is hardcoded, not operator-tunable, deliberately.

## 4. Domain mechanics

**The toy build's own stdout contract, `lines: <n> words: <n> chars: <n>`, is this phase's own authored
fixture content, not a sourced convention.** Confirmed by reading `examples/toy-build/loopr/PHASE_1_SPEC.md`,
`baby_prd.md`, and `context.md` directly: each names this exact format string. This is not a domain
figure in the sense this section tracks (a threshold, statistic, or methodology number sourced from an
external authority) -- it is arbitrary, self-consistent fixture content this phase's own executor
authored for a deliberately tiny demonstration task, the same treatment `PHASE_5_SPEC.md` §6.1 itself
describes it as (`[DECISION, Phase 5]`).

**Which three artifacts count as "loopr's own canonical artifacts" (`baby_prd.md`, `context.md`, the
phase spec) and the final-phase artifact name `"BUILD_COMPLETE.md"` remain this project's own inherited
loopr-method conventions, unchanged and re-confirmed this phase, not new domain figures.** Confirmed by
reading `nextPhaseSpecPath()` (`artifacts.ts`, untouched this phase, re-used by this phase's own
`acceptance.ts`) and the toy build's own `run-config.template.json` (`is_final_phase: true`, so the toy
run's own reviewer turn is expected to produce `BUILD_COMPLETE.md` at the toy repo's root) -- this is
architecture/convention, carried forward from Phase 4's own comprehension pass, not a threshold or
statistic requiring external citation.

**`node-version: '24'` in `.github/workflows/ci.yml` is not an independently-sourced figure -- it is
this same project's own already-pinned `package.json` `engines.node: ">=24.0.0"` constraint, restated
for CI.** Confirmed by reading both files directly: the CI workflow's own Node version satisfies the
existing engine constraint Phase 1 already set; this phase introduces no new version claim requiring its
own verification.

No domain figures (thresholds, statistics, or methodology numbers sourced from an external authority)
were introduced this phase, continuing the consistent treatment every prior phase's own comprehension
pass already established for this project's own internal orchestration design. `PHASE_5_SPEC.md` itself
states this phase's genuinely new decisions are "almost entirely internal design (the toy task's own
content, the evidence module's algorithm, the packaging file contents) rather than a vendor fact
requiring re-verification," marked `[DECISION, Phase 5]` throughout -- confirmed accurate by reading
every such-tagged function in `acceptance.ts` directly: `assessAc1()`/`assessAc2()`/`assessAc3()`'s
logic depends only on path-string comparison, status-literal comparison, and re-invocation of
already-verified Phase 1/4 primitives, never a vendor-sourced number. The one genuinely external,
live fact this phase depends on -- whether `claude`/`codex` are currently authenticated on the reviewing
machine -- is not a "domain figure" in this section's sense either; it was observed live via
`doctor --providers` (§5/§6 below), the same treatment Phase 1's own acceptance criterion 18 already
established for that exact category of fact.

## 5. Honesty audit

Compared every `PHASE_5_SPEC.md` clause I read against the shipped code, this run, including running
`npm run typecheck`, the full test suite via `npm run check`, `node src/cli/main.ts doctor --boundary`,
and `node src/cli/main.ts doctor --providers --json` myself, rather than trusting the spec's or the
review's own claims about their results. All figures matched: 239/239 tests, 30 files scanned/0
boundary violations (both matching the approval commit `b2c778d`'s own stated post-fix-patch numbers
exactly), and `doctor --providers` showing `claude-code: authenticated: true` /
`codex-cli: authenticated: false`, identical to what the approval commit itself recorded live at review
time -- confirming the reviewing machine's own provider-authentication state has not drifted since
approval.

**Real gap #1, directly inherited and re-confirmed rather than newly found this phase: this pass was
specifically directed to verify whether Phase 5's own evidence-collection work changes anything about
the AC3 "genuinely read vs. merely cited" limitation Phase 4's comprehension pass disclosed. It does
not, and `PHASE_5_SPEC.md` itself says so explicitly (§7's dedicated table row, §9 item 10) -- I
independently confirmed this is accurate by reading the actual code, not by trusting that claim.**
`assessAc3()` (`src/dispatch/acceptance.ts`) re-invokes `assertLooprArtifactsReferenced()` (Phase 4,
unmodified) per persisted turn, wrapped in try/catch, converting its thrown/not-thrown outcome into a
boolean `artifactsReferenced` field -- I read the function directly and confirmed it introduces no new
hash, path, or read-tracing mechanism of its own; it is a thin re-derivation layer over the identical
Phase 4 guard, operating on records already reconciled and persisted by Phase 3's
`reconcileHandoffRecord()` at dispatch time. Every limitation Phase 4's comprehension pass already
established therefore holds unchanged: the mechanism can prove a self-reported artifact path resolves
to a real file with a truthfully recomputed hash, and it can now additionally prove that same fact
*after the fact*, from disk, independently of trusting the live run's own report -- but neither the live
guard nor this phase's own offline re-derivation of it can observe whether the dispatched agent's own
reasoning actually engaged with a referenced file's content, versus copying its path from the prompt
into a self-report without opening it. Closing that would require either crossing PRD I5's isolation
boundary (reading the agent's own reasoning transcript, which the relay's pre-parse isolation denylist
exists specifically to prevent) or a verification capability outside what V1 was ever scoped to build.
Because this is the final phase and there is no Phase 6, I am recording this here as this project's own
final, permanent word on the question: **this is a genuine, disclosed, permanent V1 limitation to
disclose to any future operator or reader, not a defect this build failed to fix.** It is not resolved
by Phase 5, and `PHASE_5_SPEC.md` §9 item 10 is explicit that closing it was never this phase's goal.

**Real gap #2, directly inherited and re-confirmed rather than newly found this phase: whether
`RunHaltedError` is finally constructed anywhere, checked directly against the real code rather than
assumed carried forward.** A tree-wide grep this run (`grep -rn "RunHaltedError" src/`) finds it in
exactly two places: its own class declaration in `src/domain/errors.ts`, and a doc-comment reference in
`src/dispatch/run-loop.ts`'s header (confirmed unchanged from Phase 4's own text, and `run-loop.ts` is
confirmed untouched by this phase's diff). `PHASE_5_SPEC.md` §7's dedicated table row states this is
"this project's own final word on the question... speculative scaffolding from Phase 3's own design that
V1's actual shipped control-flow shape... never needed a construction site for, across all five phases."
I confirm this is accurate, not merely asserted: `run-loop.ts`'s own control flow communicates a halted
run via a returned `RunResult.exitCode = ExitCode.RUN_HALTED`, never a thrown error, and every guard
added since Phase 3 (Phase 4's `LooprArtifactBypassError`, this phase's own read-only `evidence` path,
which throws no dispatch-time error at all) followed that same already-established split rather than
retrofitting a use for this class. **Recorded here as genuinely closed, not carried forward as an open
item** -- see §6.

**Real gap #3, confirmed by direct diff and code read: the spec's own self-inconsistency around
`AcceptanceEvidence.ok`, and the review's resolution of it, verified rather than taken at face value.**
`PHASE_5_SPEC.md` §3.2's literal `AcceptanceEvidence` interface has no `ok` field, yet §6.2 step 6's own
prose says "Return the full `AcceptanceEvidence`" after computing `ok = turnsFound === 3 &&
ac1.satisfied && ac2.satisfied && ac3.satisfied," and §6.5's prose references `evidence.ok` as if reading
it off the returned value. I read `src/dispatch/acceptance.ts` directly: `AcceptanceEvidence` genuinely
has no `ok` field (confirmed, matching §3.2's literal type). I read `src/cli/evidence.ts` directly:
`runEvidenceCommand()` recomputes `ok` itself, using the exact formula §6.2 step 6 specifies, from the
returned evidence's own `turnsFound`/`ac1.satisfied`/`ac2.satisfied`/`ac3.satisfied` fields, rather than
reading a nonexistent `evidence.ok`. This is the conservative resolution of a genuine spec
self-inconsistency: it adds no undocumented field to `AcceptanceEvidence`'s literal §3.2 type and
computes the identical value the spec's own formula already defines. Confirmed accurate, not a
rationalization -- the approval commit named this exact same inconsistency and resolution in its own
text before I read the code, and I independently confirm the diff matches that description precisely.

**Real gap #4, confirmed by direct diff read: the one deviation the review itself found and fixed before
approving.** `PHASE_5_SPEC.md` §8 acceptance criterion #28 requires a dedicated test confirming
`examples/toy-build/run-config.template.json` parses as JSON and validates against `RunConfig` once its
two placeholders are filled in. I confirmed by reading `git log` and the diff of `ed81c7c` directly: no
such test existed in the initial implementation commit `f1123cb`; the review's own fix-patch commit
`ed81c7c` added it to `src/dispatch/acceptance.test.ts` (test-only, no production code changed,
confirmed by the commit's own diff stat: one file, 39 insertions/5 deletions, all inside a test file).
This is a real, disclosed, closed-before-approval gap -- not a live divergence between the approved code
and the spec.

No other `PHASE_5_SPEC.md` clause I checked (§1's per-file additive/regression constraints, §2's
no-new-dependency claim, §3's schema definitions including the deliberate no-change to `HandoffRecord`/
`RunConfig`, §4's exit-code and CLI-flag table, §6.1-§6.5's fixture content and function signatures/
control flow, §7's failure-mode/open-item table, §8's remaining acceptance criteria I could check by
direct execution or direct code reading, §9's non-goals) showed a divergence between what the spec
states and what the code I read this run actually does.

## 6. Open items

**Carried forward from Phase 4's own comprehension pass, re-evaluated this phase per this pass's own
explicit instruction, and still genuinely open: the reference-attestation mechanism's structural
inability to distinguish "genuinely read" from "path copied into the self-report without reading."**
Documented fully in §5 above. This is now a **permanent, disclosed V1 limitation** rather than an item
awaiting a future phase's attention -- there is no Phase 6 left to close it in, and `PHASE_5_SPEC.md` §9
item 10 explicitly declines to attempt closing it here. It is left in this "open items" section
deliberately, not moved to a "resolved" or "won't fix, silently dropped" status, because an operator
reading this file after V1 ships should understand it as a standing property of what this architecture
can and cannot verify from the outside: multi-loopr can prove a required artifact's path was named and
its content truthfully hashed at reconciliation time (this is real, mechanical, and complete for the
"never mentioned it at all" bypass), but it cannot and structurally never will be able to prove genuine
content engagement without either crossing PRD I5's isolation boundary or adding a capability outside
V1's scope entirely. Any future work building on this project should treat closing this as a deliberate
architecture decision, not a bug-fix.

**Carried forward from Phase 2's own comprehension pass, still true, standing environmental note rather
than an active defect: the four `[UNVERIFIED-P2]` flag-syntax confirmations remain tied to this
machine's specific `claude` 2.1.211 / `codex-cli` 0.128.0 versions.** Re-checked this run:
`node src/cli/main.ts doctor --providers --json` reports the same `claude-code 2.1.211 (Claude Code)` /
`codex-cli 0.128.0` version strings live on this machine, unchanged since Phase 2. Phase 5 introduces no
new provider CLI flags or process-spawning code of its own -- confirmed by reading `acceptance.ts` and
`evidence.ts` directly: neither imports `runProcess` or constructs provider argv, and `src/adapters/**`
(where `buildInvocation()` lives) is untouched by this phase's diff. This caveat therefore remains a
standing, permanent-for-V1 environmental note, not something this or any future phase resolves in code:
if either CLI is upgraded on a machine running multi-loopr, those four confirmations should be treated
as needing re-verification, not as permanently settled facts.

**RESOLVED this phase, moved out of open-item status: `RunHaltedError` is declared but never constructed
anywhere in the shipped code.** Carried forward as open since Phase 3's own comprehension pass; §5 above
confirms, by direct code read, that this is now this project's own final, correct, permanent design
outcome rather than an unresolved question -- `run-loop.ts`'s control flow returns
`RunResult.exitCode = ExitCode.RUN_HALTED` rather than throwing, and no phase across all five ever needed
a construction site for this class. Because this is the final phase and there is no Phase 6 to defer to,
this item is not carried forward again.

**New this phase, and the item PHASE_5_SPEC.md §8 acceptance criterion 32 was itself designed to
surface honestly: the live, real-two-provider demonstration of PRD AC1-AC3 through the toy build has
not been performed, because `codex-cli` was not authenticated on the reviewing machine at approval time
(and remains unauthenticated as of this comprehension pass, re-checked live this run).**
`node src/cli/main.ts doctor --providers --json`, re-run this pass, reports `claude-code:
authenticated: true`, `codex-cli: authenticated: false` (exit code `3`), identical to what the approval
commit itself recorded. This is not a defect in Phase 5's own work: acceptance criteria 10-18 (the
fixture-based, no-live-CLI test suite covering `assessAcceptanceEvidence()`'s own correctness against
real temporary git repositories and hand-constructed `HandoffRecord` fixtures) are independently
verified passing in full via `npm run check`'s 239/239 result, which is the evidence this phase's code
is correct that does not depend on machine auth state. What remains genuinely open is the live
demonstration itself: `examples/toy-build/` is fully prepared and documented
(`examples/toy-build/README.md`'s five-step procedure), but no operator has yet materialized the toy
repository, dispatched a real `multi-loopr run` against genuinely authenticated `claude`/`codex` CLIs,
and confirmed `multi-loopr evidence` reports `ok: true`. This stays open until performed on some machine
with both providers authenticated -- a ready-to-run, documented, not-yet-performed operator action, not
a gap in the shipped mechanism.

One forward-looking note, not an unresolved item but worth stating plainly for the operator now that V1
is complete: this project's own explicit non-goals (`PHASE_5_SPEC.md` §9, restating and finalizing every
prior phase's own deferrals) mean multi-loopr does not validate the *content* or *shape* of any produced
artifact (only its provenance), does not infer or detect which phase of a target build is final
(`is_final_phase` is purely operator-supplied), dispatches exactly one loopr phase's turn sequence per
`run`/`evidence` invocation with no autonomous looping across phases, supports exactly two providers with
no routing beyond the fixed ordered pair, and has not been published to a package registry
(`"private": true` remains set). None of these are accidentally dropped -- each is a permanent V1
boundary this final phase confirms rather than a deferral to a phase that no longer exists.

## Phase Log

**Phase 1 -- 2026-08-16.** Initial build. Established the host-agnostic core substrate: the versioned
`HandoffRecord` relay schema with its pre-parse isolation denylist, the five-archetype role registry,
the `ProviderAdapter` port (declarations only, no implementation), the exclusive-lock primitive, the
five-check `verifyContinuation()` continuity verifier, provider/toolchain preflight, the eight-rule
boundary scanner, the neutral-commits check, and the `multi-loopr doctor` CLI that exercises all of the
above. No provider adapter, no dispatch loop, and no code that spawns a provider CLI to do real work
exist yet. The phase's own adversarial review (commit `e389620`) found one non-blocking, flagged
deviation -- an undocumented Windows-specific fallback in `src/util/exec.ts` needed to launch the
provider CLIs' `.cmd` shims at all, which narrows the spec's literal `exitCode: null` spawn-error
contract on that platform -- and closed a test-coverage gap for it with a fix patch (`ceb3d9a`, adding
`src/util/exec.test.ts`) before approving. A follow-up documentation-only commit (`ce3d2ed`) clarified
that exception in the code's own comments; `PHASE_1_SPEC.md` itself remains unamended (open item #1).

**Phase 2 -- 2026-08-16.** Provider adapters. Shipped `ClaudeCodeAdapter` and `CodexCliAdapter`, the
first two concrete implementations of Phase 1's `ProviderAdapter` port, plus `ADAPTER_REGISTRY` (the
first value of type `AdapterRegistry`) and a shared, provider-agnostic conformance suite
(`assertAdapterConformance`) both adapters' own test files call against themselves. Each adapter builds
a pure `Invocation` (argv/env/cwd/stdin) for its CLI, maps `ModelTier` to that provider's own effort
value, delegates health checks to a newly-extracted `buildProviderPreflightReport()` (lifted out of
Phase 1's `runPreflight()` without changing its observable behaviour, confirmed by Phase 1's own
unmodified preflight tests still passing), and interprets a completed process result into a strict,
ordered `TurnOutcome` verdict (timeout checked first and unconditionally, then a provider-specific
failure-event/exit-code check, then success) -- never by asking the provider to self-report success.
Three Phase 1 files (`src/domain/errors.ts`, `src/domain/run.ts`, `src/ports/provider-adapter.ts`) were
modified, each confirmed additive-only per this phase's own new cross-phase modification policy: a new
exit code and error class, a new required `TurnRequest` field, and an extended doc comment,
respectively, with every Phase 1 test that exercised those files still passing unmodified. This phase
independently confirmed the "highest-value correction" PRD FM7 records (the real `codex exec` binary
rejects `-a`/`--ask-for-approval`, contradicting widely-circulated third-party guidance) by never
emitting that flag, backed by a dedicated test. Its own review found one gap in the same shape as
Phase 1's: the implementation commit's own comments silently omitted documenting the confirmation of
one `[UNVERIFIED-P2]` item (`claude -p`'s no-argument stdin-fallback behavior); unlike Phase 1's
still-open item, this one was found and closed within the same review cycle via a fix-patch commit
(`6298f98`) adding a documented live smoke test, with no production-code change. Phase 1's own open
item #1 (the Windows `exitCode:null` erratum) is now resolved: the spec was formally amended
(`dda755f`, before this phase was drafted) and this phase's own `interpretResult` code in both adapters
demonstrably keys on `exitCode !== 0` rather than `=== null`, matching the erratum's guidance exactly.

**Phase 3 -- 2026-08-16.** Sequential dispatch engine. Shipped the first code in this project that
actually spawns a provider CLI to do real work: `src/dispatch/` (`plan.ts`, `prompt.ts`, `record.ts`,
`turn.ts`, `run-loop.ts`) and `src/cli/run.ts`, wired into `main.ts` as a new `run` command.
`planTurnSequence` resolves PRD §6.3's DECISION into a fixed three-slot sequence (executor, executor,
reviewer); `runTurn` spawns one turn end to end and, critically, discards the agent's own self-reported
`repo`/`spec_ref`/artifact hashes in favour of independently-computed git and file-hash ground truth
(PRD §7 I2) before ever persisting or trusting the record; `runDispatch` wraps the whole sequence in the
Phase 1 run lock, gates every consecutive pair of completed turns through Phase 1's unmodified
`verifyContinuation()`, and grants exactly one bounded retry scoped only to a non-`CONTINUED` verdict --
every other failure class halts on first occurrence with zero retry. Four Phase 1/2 files
(`src/domain/run.ts`, `src/domain/errors.ts`, `src/util/paths.ts`, `src/verify/git.ts`) plus
`src/cli/main.ts` were modified, each confirmed additive per this phase's own file-manifest claims. The
phase's own adversarial review (commit `a5a4567`) found and closed two test-coverage gaps against
explicit acceptance criteria (lock-release-on-unexpected-throw, retry-scoping for two more failure
classes) via a fix-patch commit (`0434f98`, no production-code change) before approving, and separately
flagged -- explicitly, without fixing it -- a real but non-blocking risk: two `src/cli/run.test.ts`
tests were only safe from accidentally dispatching a real provider-CLI turn because of this specific
development machine's current Codex-CLI-unauthenticated state, not because the code structurally
prevented it. After approval, the architect directed a follow-up fix (commit `4588f9e`) adding an
injectable `deps?: RunDispatchDeps` parameter to `runRunCommand`, mirroring the injection seam
`runDispatch` itself already had one layer down; this closes the gap for real (verified independently
this run against the actual diff and by re-running the affected tests: 196/196 overall, all 10 of
`run.test.ts`'s own tests passing in isolation) while leaving `src/cli/main.ts`'s real call site --
which never passes `deps` -- byte-identical to before the parameter existed.

**Phase 4 -- 2026-08-16.** loopr artifact integration. Shipped the second gap `PHASE_3_SPEC.md` §9
deferred by name: two new deterministic guards, `assertLooprArtifactsReferenced()` and
`assertNextPhaseSpecProduced()` (new file `src/dispatch/artifacts.ts`, alongside pure helper
`nextPhaseSpecPath()`), wired into `runTurn()` between reconciliation and neutral-commits assertion.
Every dispatched turn (both executors and the reviewer) must now genuinely reference `baby_prd.md`,
`context.md`, and the phase spec in its reconciled `artifacts_read`, checked against the record Phase
3's `reconcileHandoffRecord()` already ground-truths; the reviewer turn specifically must also produce
the run's next artifact (`PHASE_(N+1)_SPEC.md`, or `BUILD_COMPLETE.md` on a new operator-supplied
`RunConfig.is_final_phase: true`) as both a declared `artifacts_written` entry and a real, turn-committed
file, checked via `changedPaths()` (Phase 1, unmodified). Either guard failing throws the new
`LooprArtifactBypassError` (`ExitCode.LOOPR_ARTIFACT_BYPASSED = 12`), uncaught, zero retry, before the
record is ever persisted -- the same shape `assertNeutralCommits()`'s `BoundaryViolationError` already
established. `RunConfig`/`TurnRequest` (`src/domain/run.ts`), `src/domain/errors.ts`,
`src/dispatch/prompt.ts`, `src/dispatch/turn.ts`, and `src/dispatch/run-loop.ts` were modified, each
confirmed additive; `src/verify/**` and `HandoffRecord` (`src/domain/relay.ts`) are untouched -- both new
guards operate entirely on the existing `FileRef` arrays Phase 1 already shipped, no schema change. The
phase's own adversarial review (commit `6fd4c8a`) found no code-level defect, confirmed 220/220 tests and
28/0 boundary scan, and named one minor documentation-only mismatch (two `src/adapters/**` test fixture
files needed three mechanical lines each, contradicting §1.7's fully-literal "untouched" claim, though
the production adapter files themselves are genuinely untouched). The review separately escalated, as
UNCERTAIN rather than a blocking defect, a structural limitation of the new reference-attestation guard:
it can prove a self-reported artifact path resolves to a real file with a truthfully recomputed hash, but
cannot prove the dispatched agent's own reasoning genuinely incorporated that file's content rather than
copying its path from the prompt into a self-report without reading it -- a limitation inherited from
Phase 1's original `HandoffRecord.artifacts_read` self-report design, not introduced by this phase, and
one that cannot be closed without either crossing PRD I5's isolation boundary or adding a verification
capability outside V1's scope. This comprehension pass independently read `assertLooprArtifactsReferenced()`
and `reconcileHandoffRecord()` together and confirmed the finding holds; it is recorded as a genuinely
open item (§5, §6 above), not treated as closed by disclosure alone.

**Phase 5 -- 2026-08-16.** End-to-end acceptance harness, the final phase (5 of 5). Shipped the
project's third and final deliverable set: (1) a new, offline, deterministic module,
`src/dispatch/acceptance.ts` (`assessAcceptanceEvidence()`, with internal `assessAc1()`/`assessAc2()`/
`assessAc3()` helpers), which re-derives PRD §2's AC1 (cross-provider continuity), AC2 (clean,
non-interactive completion), and AC3 (genuine artifact reference and production) purely by reading a
completed run's already-persisted `HandoffRecord` files back off disk, re-invoking Phase 1's
`verifyContinuation()` and Phase 4's `assertLooprArtifactsReferenced()`/`assertNextPhaseSpecProduced()`
unmodified, never spawning a process and never mutating the target repo; (2) a new CLI command,
`multi-loopr evidence --repo-dir <path> --run-id <uuid> [--final-phase] [--json]`
(`src/cli/evidence.ts`, wired into `src/cli/main.ts`), exposing that module in the same
`{report, exitCode}`-returning, `process.exit`-free shape `doctor`/`run` already establish, exiting `0`
when all three ACs are satisfied or the new `ExitCode.ACCEPTANCE_INCOMPLETE = 13`
(`src/domain/errors.ts`, additive) otherwise; (3) a small, real, live-runnable demonstration fixture,
`examples/toy-build/` (a single-file `wordcount.mjs` CLI task with its own `baby_prd.md`/`context.md`/
`PHASE_1_SPEC.md` loopr artifacts and a `run-config.template.json`), deliberately outside `src/` and
outside the compiled/scanned tree; and (4) open-source packaging -- `LICENSE` (MIT), `CONTRIBUTING.md`,
`.github/workflows/ci.yml` (checkout, setup-node, `npm ci`, `npm run check`; never a live provider
dispatch), and a `"files"` field added to `package.json` (`"private": true` deliberately left
unflipped; no `npm publish` performed). `src/domain/errors.ts`, `src/cli/main.ts`, `package.json`, and
`README.md` were the only already-approved files modified, each confirmed additive; `src/adapters/**`,
`src/verify/**`, `src/domain/relay.ts` (`HandoffRecord`), `src/domain/run.ts`
(`RunConfig`/`TurnRequest`), and every `src/dispatch/*.ts` file other than the new `acceptance.ts`
(including `artifacts.ts`, re-used unmodified) are untouched. The phase's own adversarial review
(commit `b2c778d`) found and fixed one genuine gap before approving -- acceptance criterion #28's
required dedicated test for `run-config.template.json`'s own `RunConfig` validity was missing from the
initial implementation and was added via a test-only fix-patch commit (`ed81c7c`), bringing the suite to
239/239 passing, 30 files scanned with 0 boundary violations. The review also re-ran
`doctor --providers` live and recorded, honestly, that `codex-cli` was not authenticated on the
reviewing machine at approval time, so the live, real-two-provider toy-build demonstration itself
(distinct from the fixture-based test suite, which does pass in full) remains a documented, ready-to-run,
not-yet-performed operator action -- this comprehension pass independently re-ran the same live check
and confirms that state is unchanged. This phase also delivers this project's final word on two items
carried forward since earlier phases: `RunHaltedError` is confirmed, by direct code read, to have never
needed a construction site across all five phases and is recorded as a closed, correct design outcome
rather than an open question; and the AC3 "genuinely read vs. merely cited" limitation Phase 4's
comprehension pass first disclosed is confirmed unchanged and unclosed by this phase's own
evidence-collection work (`assessAc3()` re-derives the identical Phase 4 guard, introducing no new
verification capability), recorded as a permanent, disclosed V1 limitation rather than a defect.

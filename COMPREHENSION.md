# COMPREHENSION.md -- multi-loopr

_Maintained by the Step 14 comprehension pass. Sections 1-6 describe the current state of the system
after the most recently approved phase; they are rewritten each phase, not appended to. The Phase Log
at the bottom is append-only history._

## 1. Plain-language walkthrough

multi-loopr is a tool for having two different AI coding assistants -- Claude Code and Codex -- take
turns working on the same software project, on the operator's own computer, without any company's
central relay service sitting in between. Think of it as a relay race: one assistant does a stretch of
work, then hands the baton to the other, which is expected to genuinely continue that work rather than
redo it, ignore it, or quietly undo it.

Phase 1 built the plumbing the race runs on. Phase 2 taught the tool how to speak each assistant's own
language. Phase 3 pressed the button for the first time: it made multi-loopr actually spawn the real
assistant CLIs, run a fixed three-leg sequence (one assistant goes first, the other continues, a third
leg reviews the combined result), and never simply believe what an assistant claims about its own
work -- every self-reported git commit and file fingerprint gets thrown away and recomputed from the
real repository before being trusted.

This phase closes a gap Phase 3 deliberately left open. The whole reason multi-loopr exists is to run
a specific, disciplined build method (called loopr) that starts every phase of work from a small set of
its own planning documents: a one-time problem statement, a one-time background/context document, and
a numbered phase-by-phase blueprint. Through Phase 3, multi-loopr handed an assistant the *location* of
that phase's blueprint but had no way to make sure the assistant actually read the problem statement or
the background document at all, and had no way to make sure the reviewing assistant, at the end of its
turn, actually sat down and wrote the *next* phase's real blueprint rather than just saying it would.

This phase adds two new, purely mechanical checks. First: after every single turn (both assistants that
do the building, and the one that reviews), multi-loopr checks that the turn's own handoff note lists
the problem statement, the background document, and the phase blueprint as files it says it read. If any
one of the three is missing from that list, the whole run stops immediately with a specific, named
error -- there is no second chance for this particular failure. Second: at the end of the reviewing
assistant's turn specifically, multi-loopr checks two things together -- that the assistant's handoff
note claims it wrote the next phase's blueprint, *and* that the assistant's own real git commits from
that turn actually touched that exact file. Claiming to have written it is not enough; a leftover file
from some earlier, abandoned attempt that the assistant merely points at without touching does not
count either. Only a file that is both claimed and genuinely, freshly committed this turn satisfies the
check. On the very last phase of a target build, this same mechanism asks for a different, final
"build complete" document instead of another phase blueprint.

Neither of these two checks is graded for quality -- multi-loopr never reads or judges what the
problem statement, background document, or blueprint actually say, and it never checks whether the
newly written next-phase blueprint is any good. It checks only "was this genuinely touched," the same
narrow, mechanical kind of question every other check in this tool asks. multi-loopr itself still never
writes a single word of any of these documents; that remains entirely the dispatched assistant's own
job, exactly as before.

There is an important, deliberately disclosed limit to how far this new check can see, and it is worth
stating plainly rather than only in the more technical sections below: mechanically confirming that an
assistant's handoff note names a real file, with a truthful fingerprint of that file's actual current
content, is not the same thing as confirming the assistant's own reasoning genuinely drew on what is
inside that file. An assistant is handed the file's location as part of its own instructions for the
turn -- it has to be, or it would not know where to look -- and a shortcut-taking or simply careless
assistant could, in principle, copy that same location straight into its own self-report without ever
truly opening and absorbing the file. The check this phase adds can catch "never even claimed to have
looked," but it structurally cannot catch "claimed to have looked, and named the real file, but never
actually engaged with what was inside it." This is not something this phase got wrong -- the mechanism
that makes the check possible at all was actually built back in Phase 1, and this phase's own reviewer
noticed and disclosed the limit rather than missing it or quietly building past it. It is a
genuine, standing limit of watching any AI assistant's work from the outside, not a bug to be patched
away, and it is recorded again below (sections 5 and 6) rather than left as a one-time footnote.

One other thing happened again this phase in a familiar shape, worth a plain-language note the way a
similar Phase 3 event was: the reviewer who signed off on this phase's code found one small, honest
mismatch between what the plan said and what the finished code actually needed -- a couple of test
files needed three extra lines each supplying data a newly-required field now demands, which is a
routine, expected consequence of tightening a requirement, not a defect -- and said so plainly rather
than letting the plan's wording stand next to code that behaves slightly differently.

## 2. Architecture walkthrough

Every file below was read in full this run and exists in the repository at the stated path. Phases 1-3's
own architecture, where unchanged this phase, is not re-described here; it remains as `COMPREHENSION.md`'s
own Phase 1/2/3 entries in the Phase Log below record it. This section covers `src/dispatch/` and its
neighbours as they now stand after this phase's additions.

**New this phase: `src/dispatch/artifacts.ts`** -- the reference-attestation and real-production
guards, the first new file added to `src/dispatch/` since Phase 3.
- `nextPhaseSpecPath(specPath, phase, isFinalPhase)` -- pure path computation. Returns the literal
  `"BUILD_COMPLETE.md"` when `isFinalPhase`; otherwise returns `` `${dir}PHASE_${phase + 1}_SPEC.md` ``,
  where `dir` is `specPath`'s own directory prefix (everything through its last `/`, or `""`).
  Confirmed by direct read: it never regex-parses `specPath`'s own filename for a phase number --
  `phase + 1` is computed from the numeric `phase` argument directly.
- `assertLooprArtifactsReferenced(record, expected)` -- checks that `record.artifacts_read` contains an
  entry whose `path` equals each of `expected.babyPrdPath`, `expected.contextPath`, and
  `expected.specPath`. Throws `LooprArtifactBypassError` naming every missing path (not only the first)
  when any is absent; a no-op returning normally when all three are present. Confirmed by direct read:
  it takes only expected *paths*, never expected hashes -- the function signature itself has no hash
  parameter.
- `assertNextPhaseSpecProduced(repoDir, record, expectedPath)` -- an async, two-part check run only for
  the reviewer turn: (1) `record.artifacts_written` contains an entry with `path === expectedPath`; (2)
  `changedPaths(repoDir, record.repo.head_before, record.repo.head_after)` (Phase 1's `src/verify/git.ts`,
  confirmed unmodified this phase) includes `expectedPath`. Either part failing throws
  `LooprArtifactBypassError` with a distinguishing `details.reason` (`"never_declared"` vs.
  `"declared_but_not_touched"`), confirmed by reading both throw sites directly.
- `src/dispatch/artifacts.test.ts` -- path-computation cases (root-level, nested-directory, final-phase
  override); `assertLooprArtifactsReferenced` passing and failing (zero/one/two of three paths present,
  confirming the missing-path list narrows correctly each time); `assertNextPhaseSpecProduced` exercised
  against three real temporary git repositories (pass; never-declared; declared-but-untouched-by-commits,
  the last one built by pre-committing a stale `PHASE_2_SPEC.md` before the turn's own commit range
  starts, then confirming the guard still rejects it). No test in this file spawns a real `claude` or
  `codex` process -- confirmed by reading the file's own `runProcess` usage, which only ever shells out
  to `git`.

**Modified this phase (all confirmed additive by reading the diff directly, `git diff a5a4567..6fd4c8a`):**
- `src/domain/run.ts` -- `RunConfig` gains three fields appended after `spec_path`: `baby_prd_path` and
  `context_path` (both required, validated against the same `RepoRelPathLike` schema `spec_path` already
  uses) and `is_final_phase: z.boolean().default(false)`. `TurnRequest` (plain interface) gains
  `babyPrdPath: string`, `contextPath: string`, and `expectedArtifactPath: string | null`, appended after
  `timeoutMs`.
- `src/domain/errors.ts` -- gains `ExitCode.LOOPR_ARTIFACT_BYPASSED = 12` (appended after the existing
  eleven, none renumbered -- confirmed by reading the diff hunk directly) and
  `class LooprArtifactBypassError extends MultiLooprError`, one error class covering both new guards'
  failures.
- `src/dispatch/prompt.ts` -- `ProtocolInstructionParams` gains `babyPrdRepoRelPath`/
  `contextRepoRelPath`; `buildProtocolInstructions()` gains two new mandatory-content items (instructing
  the agent to read `baby_prd.md`/`context.md` and record each in `artifacts_read`), confirmed present as
  literal substrings in the rendered output. A new exported function,
  `buildArtifactProductionInstructions(expectedArtifactPath, isFinalPhase)`, is concatenated into
  `buildReviewerPrompt()`'s output only, immediately after the protocol instructions and before the
  handoff/diff context -- confirmed by reading `buildReviewerPrompt()`'s own `parts` array construction
  directly; `buildExecutorPrompt()`'s own `parts` array never references this function.
- `src/dispatch/turn.ts` -- `runTurn()` gains two new steps between the existing `reconcileHandoffRecord()`
  call and `assertNeutralCommits()`: `assertLooprArtifactsReferenced(reconciled, {...})`, called
  unconditionally for every turn, then `assertNextPhaseSpecProduced(req.repoDir, reconciled,
  req.expectedArtifactPath)` inside `if (req.expectedArtifactPath !== null)`, a no-op for every executor
  turn. Neither new call is wrapped in a try/catch -- confirmed by reading the surrounding code -- so
  either guard's `LooprArtifactBypassError` propagates uncaught, exactly like `assertNeutralCommits()`'s
  own existing `BoundaryViolationError` one step later. Both new steps run, and must pass, before
  `writeHandoffRecord()` is ever called.
- `src/dispatch/run-loop.ts` -- `runExtendedPreflight()` gains two more readability checks
  (`baby_prd_path`, `context_path`) in the same loop shape as the existing `spec_path` check, folded into
  the same `PREFLIGHT_FAILED` outcome. `runTurnLoop()` computes `nextArtifactPath =
  nextPhaseSpecPath(config.spec_path, config.phase, config.is_final_phase)` once, alongside its existing
  once-computed `specRef`, and threads `config.baby_prd_path`/`config.context_path`/`nextArtifactPath`
  into every constructed `TurnRequest` and into `buildPromptForSlot()`'s prompt-building calls (the
  reviewer branch additionally receives `expectedArtifactPath`/`isFinalPhase`). Confirmed by reading the
  full diff: no new branch is added to the turn loop's own control flow (planning, lock, retry bound,
  halt propagation) -- every addition is a value computed once and threaded through already-existing
  parameter paths.
- `src/adapters/claude-code.test.ts`, `src/adapters/codex-cli.test.ts` -- each gains exactly three lines
  to their shared `makeTurnRequest()` fixture helper (`babyPrdPath`, `contextPath`,
  `expectedArtifactPath: null`), supplying `TurnRequest`'s three newly-required fields. Confirmed by
  reading the diff directly: the production adapter files themselves (`claude-code.ts`, `codex-cli.ts`)
  are untouched.
- `src/cli/run.test.ts` -- gains `RunConfig` fixture fields (`baby_prd_path`, `context_path`) and new
  test cases for the two extended-preflight checks and `is_final_phase` schema behaviour.
- `README.md` -- gains one sentence noting `run` now mechanically enforces genuine loopr-artifact
  reference and production.

No other file changed this phase: `src/adapters/claude-code.ts`, `src/adapters/codex-cli.ts`,
`src/verify/**` (including `continuity.ts` and its `CONTINUITY_CHECKS` tuple), `src/domain/relay.ts` (the
`HandoffRecord` schema itself -- no field added, no schema-version bump; both new guards operate entirely
on the existing `artifacts_read`/`artifacts_written` `FileRef` arrays Phase 1 already shipped),
`src/domain/tiers.ts`, `src/domain/roles.ts`, `src/ports/provider-adapter.ts`, `src/util/exec.ts`,
`src/util/hash.ts`, `src/util/lock.ts`, `src/util/paths.ts`, `src/dispatch/plan.ts`,
`src/dispatch/record.ts`, `src/cli/main.ts`, and `src/cli/doctor.ts` are byte-identical to the Phase 3
tip -- confirmed this run: `git diff a5a4567..6fd4c8a -- src/verify/` produces no output at all.

Verified this run by direct execution, not merely by reading source: `npm run typecheck` exits `0` with
zero diagnostics; `npm run check` (typecheck + full test suite + boundary scan) exits `0`, reporting 220
passing tests and 28 files scanned with 0 boundary violations (both figures matching the approval commit
`6fd4c8a`'s own stated verification exactly); `node src/cli/main.ts doctor --boundary` exits `0` with the
same 28-file, 0-violation result run standalone.

## 3. Decisions and tradeoffs

**One error class, `LooprArtifactBypassError`, covers two mechanically distinct guards.**
`assertLooprArtifactsReferenced()` and `assertNextPhaseSpecProduced()` check different things (every
turn's reference behaviour vs. only the reviewer's production behaviour) but both throw the same error
class, confirmed by reading `src/domain/errors.ts` and both throw sites in `artifacts.ts` directly. The
tradeoff: a caller catching `LooprArtifactBypassError` cannot distinguish which guard fired without
reading `error.details`, but this is the same reasoning already applied to `BoundaryViolationError`
covering six distinct boundary-rule violations (B1-B6, B8) under one exit code -- one exit code per
*kind* of failure under a PRD acceptance criterion, not one per mechanical check, with the distinguishing
detail carried in the message/details rather than the exit code.

**Both new guards run inside `runTurn()`, as uncaught throws, not as a `RunDispatchDeps`-level return
value -- the same shape `assertNeutralCommits()` already uses, deliberately not `run-loop.ts`'s own
"return the exit code, never throw" shape.** Confirmed by reading `turn.ts` directly: neither
`assertLooprArtifactsReferenced()` nor the `assertNextPhaseSpecProduced()` call is wrapped in a
try/catch at its call site, so a thrown `LooprArtifactBypassError` propagates out of `runTurn()`,
through `runDispatch()`, to `src/cli/run.ts`/`main.ts`'s existing generic catch -- exactly Phase 3's
`BoundaryViolationError` precedent, not a new propagation pattern. The tradeoff, named explicitly in
`run-loop.ts`'s own updated header comment (confirmed present): this is also why `RunHaltedError`
remains unconstructed after this phase (§5/§6 below) -- Phase 4's new failure mode gave a real
opportunity to either construct `RunHaltedError` for real or follow the opposite established pattern,
and the shipped code follows the opposite pattern on purpose, not by default.

**Real production is checked as existence-in-`artifacts_written` AND real-commit-provenance, not
existence alone.** `assertNextPhaseSpecProduced()`'s two-part design (confirmed by reading `artifacts.ts`
directly: part 1 checks `artifacts_written` membership, part 2 independently calls `changedPaths()`
against the turn's own `head_before`/`head_after`) means a reviewer cannot satisfy the guard merely by
re-declaring a stale, pre-existing file it never touched -- verified directly against a real temporary
git repo in `artifacts.test.ts`'s third `assertNextPhaseSpecProduced` test, which pre-commits a stale
`PHASE_2_SPEC.md` before the turn's own commit range begins and confirms the guard still rejects it. The
tradeoff: this is strictly a provenance check, not a content check (§4/§9 below) -- a reviewer that
deletes a real prior file's content and replaces it with one trivial line, then commits it, still passes;
multi-loopr's own guard cannot and does not judge substance, only "was this genuinely this turn's own
commit."

**`nextPhaseSpecPath()` derives the next phase number from `RunConfig.phase` (an integer the operator
supplies), never by parsing digits out of `spec_path`'s own filename string.** Confirmed by reading the
function directly: there is no regex or filename-parsing logic in `artifacts.ts` at all. The tradeoff,
stated in the function's own doc comment and confirmed accurate: an operator-chosen `spec_path` is not
guaranteed to embed a parseable phase number (e.g. a differently-named file), so deriving from the
config's own authoritative `phase` field is more robust, at the cost of requiring the operator to keep
`phase` and `spec_path` in sync themselves -- multi-loopr does not cross-check that `spec_path`'s
filename actually matches `phase`'s value.

**`is_final_phase` is operator-supplied per run, with no attempt by multi-loopr to infer, count, or
detect it.** Confirmed by reading `src/domain/run.ts`: `is_final_phase: z.boolean().default(false)` is
the entire mechanism -- no code anywhere in the diff counts phase-spec files on disk or reads any other
run's history to guess this value. The tradeoff, stated explicitly in `PHASE_4_SPEC.md` §9 item 5 and
confirmed as what shipped: an operator who forgets to set `is_final_phase: true` on a build's actual
final phase gets a run that computes and enforces a `PHASE_(N+1)_SPEC.md` path that was never meant to
exist, rather than the intended `BUILD_COMPLETE.md` -- a real operator-error surface this phase
knowingly leaves unmitigated rather than building inference logic for a one-run-at-a-time tool.

**Ground-truth reconciliation (Phase 3, unmodified) is the load-bearing mechanism the new guards build
on, and this phase's own honesty-audit finding traces directly to what reconciliation does and does not
prove -- see §5 below for the full account.** `reconcileHandoffRecord()` (`src/dispatch/record.ts`,
confirmed byte-identical to Phase 3, re-read in full this run) recomputes every surviving
`artifacts_read`/`artifacts_written` entry's SHA-256 from the real file on disk and silently drops any
entry whose declared path does not resolve to a real file. `assertLooprArtifactsReferenced()` then only
checks path membership in that already-reconciled list. The tradeoff this composition carries forward,
not introduced by this phase: proving a path is real and its hash is truthful is not the same claim as
proving the path was genuinely read for content, and Phase 4 does not close that specific gap -- see §5.

**Retries remain bounded to exactly one, and remain scoped to exactly one failure class -- a
non-`CONTINUED` continuity verdict -- unchanged from Phase 3.** `LooprArtifactBypassError` joins the same
zero-retry bucket as `BoundaryViolationError`, `PreflightError`, `LockHeldError`,
`RelaySchemaError`/`IsolationLeakError`, and `TurnTimeoutError`, confirmed by reading `run-loop.ts`
directly: there is still exactly one retry code path in the file (unchanged from Phase 3), and this
phase adds no second one for its own new error class. The tradeoff is the same one Phase 3's own
comprehension pass already recorded: this bound is hardcoded, not operator-tunable, deliberately.

## 4. Domain mechanics

**The final-phase artifact name, the literal string `"BUILD_COMPLETE.md"`, is not an arbitrary or
externally-sourced figure -- it is this same meta-project's own existing convention, read directly.**
`nextPhaseSpecPath()`'s doc comment states it is "the same final-phase artifact name this project's own
loopr method already uses for itself." I confirmed this by checking the repo root: no `BUILD_COMPLETE.md`
exists yet in this repo (multi-loopr's own build is only through Phase 4 of 5), so this is not a file I
could verify against an existing instance in *this* repo specifically -- it is `PHASE_4_SPEC.md` §6.1's
own stated convention, adopted as the general default for any target build multi-loopr drives, not a
domain figure requiring an external citation in this section's sense (a threshold, statistic, or
methodology number sourced from outside the project). Named here rather than silently passed over,
since a reader could otherwise assume it was independently sourced.

**Which three artifacts count as "loopr's own canonical artifacts" (`baby_prd.md`, `context.md`, the
phase spec) is a naming convention inherited from this project's own loopr method, not a new domain
figure this phase invents.** Confirmed by reading `PHASE_4_SPEC.md` §0 and the PRD's own §1 problem
statement, which both name these same three artifact types as loopr's existing vocabulary (this repo's
own `.claude/loopr/baby_prd.md` and `.claude/loopr/context.md`, confirmed present on disk at those exact
paths, are the running example). This is architecture/convention, not a threshold or statistic.

No domain figures (thresholds, statistics, or methodology numbers sourced from an external authority)
were introduced this phase, continuing the consistent treatment Phase 3's comprehension pass already
established for this project's own internal orchestration design. `PHASE_4_SPEC.md` §0 itself states
Phase 4 "introduces no new external CLI-surface risk at all... every genuinely new decision in this spec
is internal design," marked `[DECISION, Phase 4]` throughout rather than `[VERIFIED-LOCAL]`/
`[VERIFIED-DOC]` -- confirmed accurate by reading every `[DET, DECISION Phase 4]`-tagged function in
`artifacts.ts` directly: none of the two new guards' logic depends on a vendor-sourced number, only on
path-string comparison and git-commit membership.

## 5. Honesty audit

Compared every `PHASE_4_SPEC.md` clause I read against the shipped code, this run, including running
`npm run typecheck`, the full test suite via `npm run check`, and `node src/cli/main.ts doctor --boundary`
myself, rather than trusting the spec's or the review's own claims about their results. Both figures
(220/220 tests, 28 files/0 boundary violations) matched the Phase 4 approval commit's own stated numbers
exactly.

**Real gap #1, and the one this pass was specifically directed to verify and state in my own words: the
new reference-attestation guard can prove a claimed artifact path is real and truthfully hashed -- it
cannot prove the dispatched agent's own reasoning genuinely incorporated that file's content.** I read
`assertLooprArtifactsReferenced()` (`src/dispatch/artifacts.ts`) and `reconcileHandoffRecord()`
(`src/dispatch/record.ts`, Phase 3, confirmed unmodified) together, not separately, because the guard's
actual guarantee is the composition of both. Here is what I confirmed each one literally does:
`reconcileHandoffRecord()`'s `reconcileFileRefs()` helper takes every `artifacts_read` entry the agent's
own draft claims, recomputes its SHA-256 from the real file on disk at that repo-relative path, and
silently drops (not fails) any entry whose path does not resolve to a real file at all. What survives
into the *reconciled* record is therefore proof of exactly two things: the path is real, and the hash
attached to it is the file's true current content hash -- not whatever hash the agent may have typed.
`assertLooprArtifactsReferenced()` then does nothing more than check that `baby_prd.md`/`context.md`/the
phase spec's paths each appear somewhere in that already-reconciled list; the function's own signature
takes no hash parameter at all, confirming it relies entirely on reconciliation for the hash-truthfulness
part and contributes only the presence check. Put together: the mechanism can catch an agent that never
mentions a required artifact's path anywhere in its handoff note, or one that names a path that turns out
not to exist, or one that names a stale/wrong file (reconciliation would attach that *file's* real hash,
which is honest about what was actually read, but does not stop the path itself from being named without
being opened). It cannot catch an agent that copies the artifact's path string -- which it necessarily
already has, because the path is handed to it verbatim as part of its own turn instructions
(`buildProtocolInstructions()`'s two new mandatory-content items, confirmed by reading `prompt.ts`
directly: they literally interpolate `p.babyPrdRepoRelPath`/`p.contextRepoRelPath` into the prompt text)
-- straight into its own self-reported `artifacts_read` list without ever genuinely opening the file.
Nothing in `reconcileHandoffRecord()` or `assertLooprArtifactsReferenced()` observes whether a read
syscall, a tool-use event, or any other trace of genuine file access occurred; both operate purely on the
agent's own self-reported list of paths, filtered by mechanical existence-and-hash recomputation. This
matches the Phase 4 approval commit's own UNCERTAIN escalation almost exactly, and having now read the
actual code myself rather than transcribing that framing, I confirm it holds: the guard is a faithful,
correct implementation of what `PHASE_4_SPEC.md` §6.1 literally specifies (path-membership-in-reconciled-
list, nothing more), and what it specifies is genuinely narrower than "the agent read the file," even
though the two are easy to conflate from the outside. This is not a defect introduced by Phase 4 --
`HandoffRecord.artifacts_read` as a self-reported `FileRef` array is Phase 1's own original design
(confirmed: `src/domain/relay.ts` is untouched this phase), and PRD §7 I2 itself describes the mechanism
as "SHA-256 comparison between what a turn recorded as written and what the next turn recorded as read,"
which is a claim about *recorded* paths and hashes, not about verified comprehension. Phase 4's own
stated purpose is closing AC3's "not merely being handed their paths and ignoring them" gap, and what
shipped closes the "never mentioned it at all" half of that sentence mechanically and completely, while
the "mentioned it without reading it" half remains open by construction -- verifying genuine content
engagement from outside a black-box LLM subprocess invocation is not something any purely file-hash-based
mechanism can do, on this architecture or plausibly on any comparably-shaped one, without either reading
the agent's own reasoning transcript (which PRD I5/FM2's isolation invariant forbids crossing the relay)
or some other capability outside what V1 was scoped to build. I judge this a genuinely open structural
limitation, not a closed one -- see §6.

**Real gap #2, confirmed by direct diff read: the minor, disclosed documentation mismatch the approval
commit itself named.** `PHASE_4_SPEC.md` §1.7 states "no other file changes... `src/adapters/**`...
untouched." I read the actual diff (`git diff a5a4567..6fd4c8a -- src/adapters/`) and confirmed:
`src/adapters/claude-code.test.ts` and `src/adapters/codex-cli.test.ts` each gained exactly three lines
(`babyPrdPath`, `contextPath`, `expectedArtifactPath: null` added to a shared `makeTurnRequest()` fixture
helper), while the two production files, `claude-code.ts` and `codex-cli.ts`, are genuinely byte-identical
to Phase 3. So §1.7's claim is not perfectly literal -- two test files under `src/adapters/**` did change
-- but the change is mechanical and non-behavioral: `TurnRequest` gained three required fields this
phase, and any fixture literal constructing a full `TurnRequest` must supply them to type-check, the same
category of consequence `PHASE_3_SPEC.md` §1.2's own `RunConfig` fixture-cascade language already
authorizes explicitly. The approval commit named this exact gap in its own text before I read the code,
and I independently confirm the diff matches that description precisely.

**Carried forward from Phase 3, still true and re-confirmed this run: `RunHaltedError` remains declared
in `src/domain/errors.ts` but is never constructed anywhere in the shipped code.** I grepped the full
`src/` tree again this run: `RunHaltedError` still appears in exactly two places, its own class
declaration and a doc-comment reference in `run-loop.ts`'s header explaining why it stays unconstructed
(the comment was extended this phase, confirmed by reading the diff, specifically to note that
`LooprArtifactBypassError` follows the opposite, already-established uncaught-throw pattern instead, and
gives no new reason to change this). `PHASE_4_SPEC.md` §9 item 3 addresses this directly and states the
correct resolution is either constructing it for real if a future phase refactors `run-loop.ts` toward
uniformly throwing, or reconsidering whether the class needs to exist at all -- not forcing a construction
site into this phase's unrelated additions. Confirmed this phase does neither, correctly, per its own
stated non-goal.

No other `PHASE_4_SPEC.md` clause I checked (§1's per-file additive/regression constraints, §2's
no-new-dependency claim, §3's schema definitions including the deliberate no-change to `HandoffRecord`
and `RunReport`, §4's exit-code table, §6.1-§6.4's function signatures and control flow, §7's
failure-mode guard table, §8's 29 acceptance criteria I could check by direct execution or direct code
reading, §9's non-goals) showed a divergence between what the spec states and what the code I read this
run actually does.

## 6. Open items

**New this phase, and the item this pass was specifically directed to evaluate for open-vs-closed
status: the reference-attestation guard's inability to distinguish "genuinely read" from "path copied
into the self-report without reading."** Documented fully in §5 above -- I judge this genuinely open,
not closed, and I am recording it here rather than treating the approval commit's own escalation as
already resolved by disclosure alone. Disclosure is not resolution: the mechanism `assertLooprArtifactsReferenced()`
plus `reconcileHandoffRecord()` together provide is real and valuable (it closes the "never mentioned the
artifact at all" bypass completely and mechanically), but it does not and structurally cannot close the
"mentioned it, truthfully, without reading it" case, because doing so would require either crossing PRD
I5/FM2's isolation boundary (feeding transcript/tool-trace data into the relay, which the architecture
forbids on purpose) or some other verification capability this project has not built and was not scoped
to build in V1. This is not something a future phase can casually "just fix" -- closing it for real is a
capability question, not a bug-fix, and any future attempt should be evaluated against whether it would
require weakening I5, not treated as a small addition. Until a future phase makes a deliberate,
architect-reviewed decision either to accept this residual risk permanently (documented as such) or to
add some new, disclosed verification capability that doesn't cross the isolation boundary, this stays
open.

**Carried forward from Phase 3's own comprehension pass, still true, re-confirmed this run: `RunHaltedError`
is declared but never constructed anywhere in the shipped code.** See §5 above. `PHASE_4_SPEC.md` §9
item 3 addressed this by name and confirmed it is correctly out of this phase's scope, not accidentally
missed -- still worth a future phase's attention only if `run-loop.ts` is ever deliberately refactored
toward uniformly throwing `MultiLooprError` subclasses (it currently, by explicit design, does not); at
that point either construct `RunHaltedError` for real or reconsider whether the class needs to exist at
all. Not urgent; not accidentally dropped.

**Carried forward from Phase 2's own comprehension pass, still true, standing environmental note rather
than an active defect: the four `[UNVERIFIED-P2]` flag-syntax confirmations remain tied to this
machine's specific `claude` 2.1.211 / `codex-cli` 0.128.0 versions.** Phase 4 introduces no new provider
CLI flags (`PHASE_4_SPEC.md` §0: "this spec introduces no new external CLI-surface risk at all... reuses
`buildInvocation`'s already-verified output verbatim"), confirmed by reading `artifacts.ts` and the
modified files directly: none of them import `runProcess`, spawn a process, or construct provider argv.
If either CLI is upgraded, those four confirmations should be treated as needing re-verification, not as
permanently settled.

The one item Phase 3's own review left open (the auth-state-dependent test hazard in
`src/cli/run.test.ts`) was resolved by the post-approval fix commit `4588f9e` and confirmed closed in the
Phase 3 comprehension pass; it is not carried forward here as it remains genuinely resolved -- no code
touched by Phase 4 reopens it.

One forward-looking note, not an unresolved item but worth stating plainly for the operator:
`PHASE_4_SPEC.md` §9's own explicit non-goals mean multi-loopr still does not validate the *content* or
*shape* of any produced artifact (only its provenance), still does not infer or detect which phase of a
target build is final (`is_final_phase` is purely operator-supplied), and still dispatches exactly one
loopr phase's turn sequence per `run` invocation with no autonomous looping across phases -- all
deliberately deferred, most explicitly to Phase 5's acceptance harness, not accidentally dropped.

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

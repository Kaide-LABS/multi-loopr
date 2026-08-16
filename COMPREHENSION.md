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
language (the exact command-line words, the effort dial, the pass/fail reader) but never actually
pressed the button.

This phase presses the button. multi-loopr can now actually run a race: given a small configuration
file (which two assistants to use, which repository, which numbered project-phase document to work
from, and how long to let a turn run before giving up on it), it dispatches a real, fixed three-leg
sequence -- one assistant goes first, the other assistant continues that work, and then one of the two
reviews the combined result -- and it does this for real: it spawns the actual assistant CLI, waits for
it to finish or time out, and reads back whatever handoff note that assistant wrote to disk.

The most important new idea this phase introduces is that multi-loopr never simply believes what an
assistant claims about its own work. Every assistant's turn ends with it writing a note that includes
claims like "here is the git commit I made" or "here is the file I changed, and here is that file's
fingerprint." This phase throws every one of those specific claims away and recomputes them itself,
directly from the real git history and the real files on disk, before trusting the note for anything
that matters. An assistant can still describe, in its own words, what it did and what's left to do --
that part is trusted -- but never the parts a dishonest or simply mistaken assistant could fake to make
its own turn look more successful than it was.

The second new idea is a safety net for the handoff itself: after each assistant's turn, multi-loopr
runs the same strict, mechanical continuity check Phase 1 built (did the next turn actually build on the
last one, or did it quietly ignore or undo it?). If that check fails once, multi-loopr gives the same
assistant exactly one more try, explicitly telling it what went wrong -- but only ever one extra try,
and only for that specific kind of failure. Any other kind of problem (a crash, a timeout, an assistant
that honestly reports it got stuck) stops the whole run immediately, with no retry, because those are
not situations where "try again" is an honest response.

This phase still does not do any of the real work of the loopr method itself: it does not draft a real
project-phase document, and it does not loop across phases on its own -- one invocation of the tool
plays exactly one three-leg race and then stops, the same way this project's own operator manually
re-runs its own review-and-comprehension steps between phases rather than letting them self-chain.

Also worth understanding in plain terms, because it happened again this phase in a slightly new shape:
a reviewer signed off on this phase's code, and separately flagged -- explicitly, in writing, without
fixing it -- one thing they had noticed but judged out of scope for their own pass: two of the newly
written tests only avoided a real risk (accidentally starting a real assistant turn just by running the
test suite) because of a coincidence of this one development machine's current login state, not because
the code was actually built to prevent it. The operator directed a follow-up fix, done after the
review's own approval, that closes this properly: it gives that specific piece of code a way to be
handed fake stand-ins during a test, the same way every other part of this phase's code already could
be, so the tests no longer depend on which assistant happens to be logged in on whichever machine runs
them.

## 2. Architecture walkthrough

Every file below was read in full this run and exists in the repository at the stated path. Phases 1
and 2's own architecture (unchanged this phase, so not re-described here) remain as `COMPREHENSION.md`'s
own Phase 1/2 entries in the Phase Log below record them.

**New this phase: `src/dispatch/`** -- the turn-sequencing and orchestration layer, the first new
top-level `src/` directory since Phase 2's `src/adapters/`.
- `src/dispatch/plan.ts` -- `otherProviderId(id)` (total over the two `PROVIDER_IDS`, throws
  `InternalError` for an unreachable input) and `planTurnSequence(config)`, which resolves PRD §6.3's
  DECISION into the fixed three-slot `TurnPlan[]`: executor on `executor_providers[0]`, executor on
  `executor_providers[1]`, reviewer on `reviewer_provider ?? otherProviderId(executor_providers[1])`.
- `src/dispatch/plan.test.ts` -- sequence correctness, the reviewer default vs. an explicit override,
  `otherProviderId` totality and its defensive throw.
- `src/dispatch/prompt.ts` -- `buildProtocolInstructions()`, `buildHandoffContext()`,
  `buildExecutorPrompt()`, `buildReviewerPrompt()`. Assembles each dispatched turn's actual prompt text
  from a role profile (Phase 1, unchanged) plus protocol instructions plus, where applicable, the prior
  turn's allow-listed context and (for the reviewer only) the real git diff between the two executor
  turns, capped at 20,000 characters with a `"truncated"` marker past the cap. No function in this file
  reads `process.env`, spawns a process, or touches a clock.
- `src/dispatch/prompt.test.ts` -- the six mandatory protocol-instruction items tested individually by
  substring; the allow-list boundary (`buildHandoffContext` proven not to leak `schema_version`,
  `run_id`, or `model_tier`); diff truncation; retry-note appending.
- `src/dispatch/record.ts` -- `captureGroundTruthBefore(repoDir)` and
  `reconcileHandoffRecord(repoDir, draft, ground)`. The latter unconditionally replaces the
  agent-authored `repo`, `spec_ref`, and every `artifacts_read`/`artifacts_written` entry's `sha256`
  with independently-computed ground truth (a dropped, non-fatal outcome for a declared path that does
  not exist on disk), then re-runs `HandoffRecord.safeParse` on the reconciled object, throwing
  `RelaySchemaError` on a reconciliation-triggered failure distinct from a raw schema defect.
- `src/dispatch/record.test.ts` -- reconciliation exercised against real temporary git repositories; a
  deliberately wrong agent-authored `repo`/`spec_ref`/artifact hash is proven overwritten.
- `src/dispatch/turn.ts` -- `runTurn(req, deps)`. One turn end to end, in a fixed order: capture ground
  truth, build the invocation via the adapter, merge the environment as
  `{ ...process.env-with-undefined-dropped, ...invocation.env }` (never `invocation.env` alone), spawn
  via an injectable `runProcessFn` (defaults to the real `runProcess`), interpret the result, read the
  on-disk `HandoffRecord` (a `RelaySchemaError`/`IsolationLeakError` here becomes a modelled failure, not
  a throw), reconcile it against ground truth, assert commit neutrality on the real commit list when any
  exist, then persist the reconciled record at the same path, overwriting the agent's own draft.
- `src/dispatch/turn.test.ts` -- full turn lifecycle against a real temporary git repo, with an
  injectable `runProcessFn` fixture; dedicated tests for the adapter-failure short-circuit, the
  malformed-record and isolation-leak modelled-failure conversions, the reconciliation-rejection case,
  the uncaught `BoundaryViolationError` propagation, the environment-merge contract, and timeout
  pass-through.
- `src/dispatch/run-loop.ts` -- `runDispatch(config, deps?)`, the top-level orchestrator: an extended
  preflight (Phase 1's `runPreflight()` plus a `spec_path`-readability check, folded into one
  `PREFLIGHT_FAILED` outcome), the run lock acquired before any turn and released in a `finally` wrapping
  the entire turn loop, then the fixed three-slot loop with the bounded, exactly-one, non-`CONTINUED`
  -verdict-only retry. `RunDispatchDeps` carries `adapters`, `runProcessFn`, and (an autonomous-critique
  addition beyond the spec's literal two-field interface, explained in §3 below) `preflightFn`, all
  optional and each defaulting to the real production dependency when omitted.
- `src/dispatch/run-loop.test.ts` -- end-to-end dispatch scenarios against real temporary git repos with
  an injected fake `AdapterRegistry`/`runProcessFn`/`preflightFn`: a clean 3-turn run; a continuity
  failure that retries once and succeeds; a continuity failure on both the original and the retry
  (`CONTINUITY_FAILED`, exit 6); a `"halted"` record stopping the run immediately (`RUN_HALTED`, exit
  11); an adapter-reported failure with zero retry; an unexpected `BoundaryViolationError` throw that
  still releases the lock; lock contention (`LOCK_HELD`, exit 8); a missing `spec_path` failing
  preflight before the lock is ever touched.

**New this phase: `src/cli/run.ts`** -- `RunReport` (`z.strictObject`, mirroring `DoctorReport`'s shape)
and `runRunCommand(opts, deps?)`: reads and validates the `--config` JSON file against `RunConfig`
(a failure here is `UsageError`, exit 2, deliberately distinct from `RELAY_SCHEMA_INVALID`'s exit 4,
which is reserved for the inter-agent `HandoffRecord` payload specifically), calls `runDispatch()`, and
assembles the report. `deps` (added post-approval, see §3/§5) threads straight through to `runDispatch`'s
own second argument and is `undefined` by default, so `src/cli/main.ts`'s real call site -- which never
passes it -- is byte-identical to before the parameter existed.
- `src/cli/run.test.ts` -- CLI-level config-file validation errors, `--json` output shape, exit-code
  passthrough, `RunConfig`'s two new fields each rejecting an invalid value. As of the post-approval fix
  (§3/§5), the direct `runRunCommand` "dispatches a valid config" test drives a full injected fake
  `RunDispatchDeps` (a synthetic always-healthy preflight, a `RecordingFakeAdapter` pair, and a scripted
  `runProcessFn` that writes real commits and real `HandoffRecord` files into a temp repo) through a
  clean 3-turn run, and the real-subprocess `--json` CLI test uses a `spec_path` that can never resolve
  to a readable file, so it deterministically fails preflight before the turn loop, on any machine, in
  any provider-auth state.

**Modified this phase (all confirmed additive by reading the diff directly):**
- `src/domain/run.ts` -- `RunConfig` gains two new required fields: `phase: z.number().int().min(1)` and
  `spec_path`, validated against a locally-declared `RepoRelPathLike` schema (not imported from
  `src/domain/relay.ts`'s `RepoRelPath`, to avoid creating an ES-module import cycle between the two
  files -- `run.ts`'s own header comment states this constraint explicitly) built from the same
  underlying `isSafeRepoRelPath` (`src/util/paths.ts`) both files already share.
- `src/domain/errors.ts` -- gains `ExitCode.RUN_HALTED = 11` (appended after the existing ten, none
  renumbered) and `class RunHaltedError extends MultiLooprError`.
- `src/util/paths.ts` -- gains `repoRelToAbs(repoDir, repoRelPath)`, plain string concatenation
  (deliberately not `node:path.join`/`resolve`), safe because its input has always already passed
  `isSafeRepoRelPath`.
- `src/verify/git.ts` -- gains `diffText(repoDir, fromOid, toOid)`: `git diff <fromOid>..<toOid>`, the
  full unified diff body (unlike the existing `changedPaths`, which returns only names), following the
  file's existing non-zero-exit-throws-`InternalError` wrapper convention.
- `src/cli/main.ts` -- gains recognition of a `run` command (`--config <path>`, `--json`) inside
  `parseArgs` (a new `parseRunArgs` function) and a new `case "run"` branch in `main()`'s dispatch
  switch, plus `renderRunHumanReport()`. Every existing command's parsing and behaviour is unchanged --
  the diff only adds new branches, touching no existing one.
- `README.md` -- gains exactly one new sentence noting the `run` command exists.

No other file changed this phase: `src/adapters/**`, `src/verify/preflight.ts`,
`src/verify/continuity.ts`, `src/verify/boundary.ts`, `src/verify/boundary-rules.ts`,
`src/verify/commits.ts`, `src/domain/relay.ts`, `src/domain/tiers.ts`, `src/domain/roles.ts`,
`src/ports/provider-adapter.ts`, `src/util/exec.ts`, `src/util/hash.ts`, `src/util/lock.ts`, and
`src/cli/doctor.ts` are byte-identical to the Phase 2 tip (confirmed: `git diff` between the two
approval commits touches no path under any of those).

Verified this run by direct execution, not merely by reading source: `npm run typecheck` exits `0` with
zero diagnostics; `npm run check` (typecheck + full test suite + boundary scan) exits `0`, reporting 196
passing tests and 27 files scanned with 0 boundary violations; `node --test src/cli/run.test.ts` run in
isolation shows all 10 of that file's tests passing, including the two tests the post-approval fix
commit rewrote.

## 3. Decisions and tradeoffs

**Ground-truth reconciliation replaces the agent's self-reported `repo`/`spec_ref`/artifact hashes
outright, rather than comparing and rejecting on mismatch.** `PHASE_3_SPEC.md` §6.3 states the
alternative considered and rejected explicitly: a "compare and reject" design would require the agent's
own prompt instructions to get git plumbing and hashing exactly right merely to avoid a spurious
rejection, adding fragility for no security benefit, since ground truth is always independently
available and cheap to compute. The tradeoff taken: the agent's own claims about these specific fields
are never even consulted for correctness, only discarded -- the agent is told this up front in its own
protocol instructions (`buildProtocolInstructions`'s "advisory only... overwrites" clause, confirmed
present in `prompt.ts` and tested in `prompt.test.ts`), so this is a disclosed constraint on the agent,
not a silent one.

**Reconciliation can make a record fail validation even though the agent's own draft parsed cleanly.**
`reconcileHandoffRecord` re-runs `HandoffRecord.safeParse` on the reconciled object as its final step
(`src/dispatch/record.ts` lines 93-101) -- an agent claiming `status: "completed"` with zero real commits
now fails schema refinement R3 even though its own draft, before reconciliation, would have parsed. The
tradeoff: an honest agent that is merely bad at git bookkeeping is treated identically to a dishonest
one, by design -- multi-loopr does not attempt to distinguish "the agent lied" from "the agent's
plumbing was wrong," because I2 forbids trusting the agent's self-report for exactly the fields being
checked either way.

**Retries are bounded to exactly one, and scoped to exactly one failure class: a non-`CONTINUED`
continuity verdict.** Every other failure path in `run-loop.ts` (an adapter-reported process failure or
timeout, a `RelaySchemaError`/`IsolationLeakError` from record read or reconciliation, a
`LockHeldError`, a `PreflightError`, a `BoundaryViolationError` from `assertNeutralCommits`) returns or
propagates on first occurrence with zero retry, verified by reading `run-loop.ts` directly: there is
exactly one retry code path (the `verdict.verdict !== "CONTINUED"` branch), no loop construct anywhere
in the file, and dedicated tests in both `run-loop.test.ts` and `turn.test.ts` confirm each of the other
failure classes retries zero times. The tradeoff, stated in `PHASE_3_SPEC.md` §9 item 13: this bound is
hardcoded, not an operator-tunable setting, deliberately -- an unbounded or configurable retry count was
explicitly ruled out of scope.

**`RunDispatchDeps` gained a third field, `preflightFn`, beyond what `PHASE_3_SPEC.md` §6.5 literally
specified (`adapters`, `runProcessFn` only) -- a real, disclosed autonomous-critique addition, not a
silent deviation.** `run-loop.ts`'s own doc comment on `RunDispatchDeps` states the reasoning directly:
`runPreflight()` (Phase 1, unchanged) always shells out to the real `claude`/`codex` binaries with no
injection seam of its own, so without `preflightFn` it would be structurally impossible for any test to
reach `runDispatch`'s own turn-loop logic (lock, planning, continuity retry, halt) without both provider
CLIs being genuinely installed and authenticated on the test-running machine -- directly contradicting
§8 acceptance criterion #30's explicit requirement that no test in this phase spawn a real provider
process. The tradeoff: `runDispatch`'s actual shipped signature is not byte-identical to the spec's
literal §6.5 interface text, but production behaviour is unaffected (`preflightFn` defaults to the real
`runPreflight`, and `src/cli/run.ts`'s own call site never passed a `deps` object at all prior to the
post-approval fix below) -- this is exactly the kind of legitimate, disclosed spec deviation
`PHASE_3_SPEC.md` §0's own standing constraint anticipates ("HALT and escalate... do not silently
substitute a plausible-looking alternative"), and the reviewer's approval commit confirms it reviewed
and accepted this addition rather than missing it.

**`runRunCommand` gained an injectable `deps?: RunDispatchDeps` parameter after Phase 3's own approval,
not before -- a disclosed, architect-directed post-approval fix, not a unilateral change.** The review
that approved Phase 3 (`a5a4567`) explicitly named, as a non-blocking finding it chose not to fix itself,
that two of `src/cli/run.test.ts`'s tests exercised a real, un-injected `runDispatch(config)` call and
were only safe because this specific development machine's Codex CLI happens to be unauthenticated --
on a fully authenticated machine, the same tests could have dispatched a real provider-CLI turn as a
side effect of running `npm test`. Commit `4588f9e` closes this by adding the same kind of injection
seam `runDispatch` itself already had, threaded one layer up. I independently read this commit's actual
diff (not the commit message alone) and confirm: it touches exactly two files (`src/cli/run.ts`,
15 lines changed; `src/cli/run.test.ts`, 193 lines changed, no other file); `runRunCommand`'s new second
parameter is optional and defaults to `undefined`, so `src/cli/main.ts`'s real call site -- itself
untouched by this commit -- passes no `deps` argument and reaches `runDispatch(config, undefined)`,
byte-identical production behaviour to before the parameter existed; the previously-hazardous test now
drives a full injected `RunDispatchDeps` (a synthetic always-healthy preflight, a fake
`AdapterRegistry`, and a scripted `runProcessFn` that writes real commits and real `HandoffRecord` files
into a temp repo) through a genuine clean 3-turn run, asserting on the exact turn-by-turn status/verdict
sequence rather than merely on a preflight-failure passthrough; the one CLI-level test that spawns a
real `node src/cli/main.ts run` subprocess correctly cannot accept an injected `deps` (main.ts's own call
site intentionally never threads one), so it instead uses a `spec_path` that can never resolve to a
readable file, forcing a deterministic `PREFLIGHT_FAILED` before the turn loop is ever reached,
regardless of machine or provider-auth state. I ran `npm run check` and `node --test src/cli/run.test.ts`
myself at the current tip: 196/196 tests pass overall, and all 10 tests in `run.test.ts` pass in
isolation, including the two rewritten by this commit. The tradeoff: none of substance -- this closes an
UNCERTAIN item the reviewer explicitly declined to resolve unilaterally (correctly, since adding an
injection seam to a spec-mandated function signature is a design decision, not a QA patch) by having the
architect make the call instead, exactly the escalation path `PHASE_3_SPEC.md` §0 describes.

## 4. Domain mechanics

**The three-slot turn sequence's provider assignment is a mechanical, non-arbitrary reading of PRD
§6.3's DECISION, not a new domain figure.** `planTurnSequence` resolves "the reviewer runs on whichever
provider did not produce the diff under review" (PRD §6.3, read directly this run) into
`otherProviderId(executor_providers[1])` -- necessarily `executor_providers[0]` in multi-loopr's fixed
two-provider system -- confirmed identical in both the spec's prose and the shipped `plan.ts` code.
This is architecture, not a domain figure requiring a citation in this section's sense (a threshold,
statistic, or methodology number) -- no such figure appears in `plan.ts`.

**The reviewer-diff truncation cap, `DIFF_CAP_CHARS = 20_000` in `src/dispatch/prompt.ts`.** This is an
ordinary defensive-programming bound analogous to Phase 2's `MAX_REPORTED_EVENTS = 20`
(`src/adapters/codex-cli.ts`) and Phase 1's SIGTERM-grace-period/recursion-depth constants, all
previously treated in this project's own comprehension passes as engineering judgment calls rather than
domain-derived figures requiring external citation -- consistent treatment continued here.

No domain figures (thresholds, statistics, or methodology numbers sourced from an external authority)
were introduced this phase. Phase 3's genuinely new content is internal orchestration design (turn
sequencing, retry policy, ground-truth reconciliation), which `PHASE_3_SPEC.md` §0 itself explicitly
distinguishes from "external CLI-surface risk" and marks `[DECISION, Phase 3]` throughout rather than
`[VERIFIED-LOCAL]`/`[VERIFIED-DOC]` -- these are multi-loopr's own considered design choices, not vendor
facts requiring a citation or an [UNVERIFIED] marker in the sense this section tracks.

## 5. Honesty audit

Compared every `PHASE_3_SPEC.md` clause I read against the shipped code, this run, including running
`npm run typecheck`, the full test suite via `npm run check`, and `node --test src/cli/run.test.ts` in
isolation myself, rather than trusting the spec's or either review's own claims about their results.

**Real gap #1, disclosed by the phase's own review and now independently confirmed resolved by me: the
auth-state-dependent test hazard in `src/cli/run.test.ts`.** Documented fully in §3 above. The review
that approved Phase 3 named this precisely and chose, correctly, not to fix it itself (adding an
injection seam to a spec-mandated function signature is a design decision, properly escalated rather
than patched unilaterally). The architect directed the fix; I read commit `4588f9e`'s actual diff line
by line (not the commit message) and independently ran the resulting tests. It is real and it works: the
previously-hazardous test no longer depends on this machine's Codex-CLI auth state, and the CLI-level
subprocess test that cannot accept dependency injection now forces a deterministic preflight failure by
construction instead. This closes the one open item the Phase 3 review left on the record (see §6).

**Real gap #2, a genuine spec-vs-shipped-signature divergence, disclosed in the code's own comments but
worth naming explicitly here because a third party diffing the spec's literal text against the code
would find a real mismatch: `RunDispatchDeps`'s shape does not match `PHASE_3_SPEC.md` §6.5's literal
text.** The spec's §6.5 code block declares exactly two optional fields (`adapters`, `runProcessFn`);
the shipped `src/dispatch/run-loop.ts` declares three (`adapters`, `runProcessFn`, `preflightFn`). This
is not an oversight -- `run-loop.ts`'s own doc comment names it as a deliberate autonomous-critique
addition and states the reason (§3 above), and the reviewer's own approval commit shows independent
awareness of the fix's shape ("the bounded retry is structurally scoped..." and the AC21 discussion both
presuppose the injected `preflightFn` seam `run-loop.test.ts` actually uses). I confirm this reading is
correct by direct inspection of both files. This is a disclosed, reasoned deviation, not an undisclosed
one -- but it is still a real difference between what §6.5's code block states and what shipped, and the
comprehension-pass discipline this project follows (documented in Phase 1's Windows erratum and Phase
2's `[UNVERIFIED-P2]`-closure gap, both named in prior comprehension passes) is to name it plainly rather
than let the spec's literal text stand uncorrected next to code that does something slightly different.

**A minor, non-blocking observation, not named by either review: `RunHaltedError` (added this phase,
`src/domain/errors.ts`) is never actually constructed anywhere in the shipped code.** `PHASE_3_SPEC.md`
§1.4 justifies adding this class with "it is the first phase that needs a concrete class for... the run
stopped because the dispatched agent said it could not, or should not, continue." I grepped the full
`src/` tree and confirmed `RunHaltedError` appears in exactly one file, its own declaration in
`errors.ts` -- `run-loop.ts` reports a halted run by returning a `RunResult` object with
`exitCode: ExitCode.RUN_HALTED` set directly, never by constructing or throwing a `RunHaltedError`
instance. This is consistent with `run-loop.ts`'s own explicit contract ("never throws a
`MultiLooprError` for a modelled failure... returns the exit code"), so it is not a bug -- `exitCodeFor()`
never needs to see this particular error class because `runDispatch` never throws it -- but it means the
class exists for schema/type-hierarchy completeness (parity with every other exit code having a matching
error class) rather than because any code path actually constructs one. Not a spec violation (nothing in
§8's acceptance criteria requires `RunHaltedError` to be thrown, only that `RUN_HALTED`'s exit code
behaviour work, which it does, tested), but worth naming as a small mismatch between the class's stated
justification and its actual (non-)use.

No other `PHASE_3_SPEC.md` clause I checked (§1's per-file additive/regression constraints, §2's
no-new-dependency claim, §3's schema definitions, §4's CLI surface and exit-code table, §6.1-§6.7's
function signatures and control flow, §7's failure-mode guard table, §8's 32 acceptance criteria I could
check by direct execution or direct code reading, §9's non-goals) showed a divergence between what the
spec states and what the code I read this run actually does.

## 6. Open items

No open items are carried forward from the prior `COMPREHENSION.md`: Phase 2's own open items (the
version-drift caveat on the four `[UNVERIFIED-P2]` flag-syntax confirmations) concerned Phase 2's
adapter-flag-syntax confirmations specifically, not anything Phase 3's code depends on differently, and
Phase 3 introduces no new provider CLI flags (`PHASE_3_SPEC.md` §0: "this spec introduces very little
genuinely new external CLI-surface risk... it reuses `buildInvocation`'s already-verified output
verbatim") -- so that caveat still stands, unchanged, as a standing environmental note rather than a
Phase 3 open item. It is restated here for completeness rather than silently dropped: the four
`[UNVERIFIED-P2]` flag-syntax confirmations from Phase 2 remain tied to this machine's specific
`claude` 2.1.211 / `codex-cli` 0.128.0 versions; if either CLI is upgraded, those confirmations should be
treated as needing re-verification, not as permanently settled.

The one item this phase's own review (`a5a4567`) placed on the record as unresolved -- the
auth-state-dependent test hazard in `src/cli/run.test.ts` -- is now resolved, not carried forward. See
§3 and §5 above for the full account: commit `4588f9e`, directed by the architect after approval,
verified by me this run against the actual diff and by independently re-running the affected tests.

One new item surfaces from this run's own honesty audit, not previously flagged by either review: the
minor `RunHaltedError`-never-constructed observation in §5. It does not block anything and is not a
correctness defect, but is worth a future phase's attention if `run-loop.ts` is ever refactored toward
throwing `MultiLooprError` subclasses more uniformly (it currently deliberately does not, by its own
stated design) -- at that point, either construct `RunHaltedError` for real or reconsider whether the
class needs to exist at all.

One forward-looking note, not an unresolved item but worth stating plainly for the operator: Phase 3's
own explicit non-goals (`PHASE_3_SPEC.md` §9) mean multi-loopr still cannot loop across loopr phases on
its own, still produces no real `PHASE_(N+1)_SPEC.md` content from its reviewer turn, and still collects
no AC1-AC3 evidence -- all three remain deferred to Phase 4/5 as planned, not accidentally dropped.

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

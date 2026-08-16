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

Phase 1 built the plumbing the race runs on (the handoff-note format, the readiness checker, the
locking mechanism, the internal rulebook, the way to check a handoff was honored) but could not yet
actually talk to either assistant.

This phase teaches the tool how to *speak each assistant's own language*. For each of the two
assistants, multi-loopr now knows: the exact command-line words to type to start a turn in a way that
never stops to ask a human a permission question partway through (a silent hang would be worse than a
clear failure); how to translate an abstract "how much effort should this turn get" setting into that
specific assistant's own effort dial; and how to read the assistant's own output afterward and decide,
in a strict, checklist-driven way, whether the turn actually succeeded, failed, or ran out of time --
never by asking the assistant itself to self-report the answer.

This phase deliberately still does not press the button. Nothing in this phase actually launches
either assistant to do real work, writes any real handoff note to disk, takes the exclusive lock, or
offers an operator-facing command to start a run. What got built this phase is the translator and the
verdict-reader for each assistant; wiring them into an actual back-and-forth loop is next.

Also worth understanding in plain terms: multi-loopr already caught itself in a small honesty gap once
before, in Phase 1 (a documented, disclosed platform-specific quirk on Windows that the original plan
hadn't anticipated), and formally corrected the plan document itself to describe it rather than leaving
the written plan and the real behavior silently out of step. This phase's own build reused that lesson
directly: partway through, a reviewer noticed the newly-written code's own explanatory notes had quietly
skipped documenting one thing it had actually verified, and closed that gap the same way -- writing it
down explicitly rather than leaving it implicit.

## 2. Architecture walkthrough

Every file below was read in full this run and exists in the repository at the stated path. Phase 1's
architecture (unchanged this phase, so not re-described in full here) remains as `COMPREHENSION.md`'s
own Phase 1 entry in the Phase Log below records it.

**New this phase: `src/adapters/`** -- the concrete implementations of the `ProviderAdapter` interface
Phase 1 shipped as a declaration only.
- `src/adapters/claude-code.ts` -- `ClaudeCodeAdapter`, driving the `claude` CLI in headless (`-p`)
  mode. Exports `CLAUDE_EFFORT_VALUES` (`low`/`medium`/`high`/`xhigh`/`max`) and the class itself, which
  implements `id`, `preflight()`, `resolveEffort()`, `buildInvocation()`, `interpretResult()`.
- `src/adapters/claude-code.test.ts` -- unit tests plus one call into the shared conformance suite.
- `src/adapters/codex-cli.ts` -- `CodexCliAdapter`, driving `codex exec`. Exports `CODEX_EFFORT_VALUES`
  (`minimal`/`low`/`medium`/`high`/`xhigh`) and the class, same four-method shape.
- `src/adapters/codex-cli.test.ts` -- unit tests plus one call into the shared conformance suite.
- `src/adapters/conformance.ts` -- `assertAdapterConformance(adapter, fixture)`, a synchronous,
  provider-agnostic battery of eight checks (identity, `resolveEffort` totality/purity, `buildInvocation`
  purity and non-mutation, forbidden-flag absence, `env` non-credential-forging, timeout precedence,
  `record` always `null`) that both adapters' own test files call against themselves, so the contract is
  verified identically rather than re-implemented per adapter. Not itself a `*.test.ts` file.
- `src/adapters/registry.ts` -- `ADAPTER_REGISTRY`, a frozen, two-entry object mapping
  `"claude-code"`/`"codex-cli"` to one stateless instance of each adapter class. First value of type
  `AdapterRegistry` this project has shipped (Phase 1's `src/ports/provider-adapter.ts` declared the
  type only).
- `src/adapters/registry.test.ts` -- confirms the registry has exactly one entry per `PROVIDER_IDS`
  member, each entry's own `id` field matches the key it's stored under, and the object is frozen.

**Modified this phase (all confirmed additive by reading the diff directly, not by trusting the spec's
own characterization of itself):**
- `src/domain/errors.ts` -- gains `ExitCode.TURN_TIMEOUT = 10` (appended after the existing nine, none
  renumbered) and `class TurnTimeoutError extends MultiLooprError`.
- `src/domain/run.ts` -- `TurnRequest` gains one new required field, `modelOverride: string | null`.
  Verified no Phase 1 code constructs a `TurnRequest` literal (Phase 1 shipped no dispatch code), so
  this cannot regress an existing caller.
- `src/ports/provider-adapter.ts` -- `Invocation.env`'s doc comment is extended to state the merge
  contract: `env` is an additive overlay a future spawn site must apply as
  `{ ...process.env, ...invocation.env }`, never as a full replacement. No type or method signature
  changed.
- `src/verify/preflight.ts` -- gains `buildProviderPreflightReport(id: ProviderId): Promise<PreflightReport>`,
  the exact per-provider assembly block (`checkProviderCli` -> version-range check -> conditional
  `checkProviderAuth` -> problems list -> `PreflightReport`) that `runPreflight()`'s loop body already
  computed inline in Phase 1, now extracted so both `runPreflight()` (one call site, rewritten as a
  `for` loop over `PROVIDER_IDS`) and each adapter's own `preflight()` method call the identical logic.
  `src/verify/preflight.test.ts` (Phase 1, unmodified) still passes, which is the direct evidence the
  extraction changed no observable behavior.

No other file changed this phase: `src/cli/main.ts`, `src/cli/doctor.ts`, `src/verify/boundary.ts`,
`src/verify/boundary-rules.ts`, `src/domain/relay.ts`, `src/domain/tiers.ts`, `src/domain/roles.ts`, and
everything under `src/util/` are byte-identical to the Phase 1 tip (confirmed: `git diff` between the
two approval commits touches no path under any of those).

Verified this run by direct execution, not merely by reading source: `npm run typecheck` exits `0` with
no diagnostics; `node --test "src/**/*.test.ts"` runs 152 tests, all passing (up from Phase 1's 125,
consistent with the seven new adapter/registry test files); `node src/cli/main.ts doctor --boundary`
reports 21 files scanned (up from Phase 1's 17, exactly the four new non-test files under
`src/adapters/`), 0 violations; `node src/cli/main.ts doctor --providers --json` on this machine
resolves `claude-code` as `authenticated: true` and `codex-cli` as `authenticated: false` with a
non-empty `problems` array, live and reproducible, matching `PHASE_2_SPEC.md` §8 acceptance criterion
20 exactly.

## 3. Decisions and tradeoffs

**`bypassPermissions` chosen as Claude Code's permission mode, over five other documented options.**
`src/adapters/claude-code.ts`'s `buildInvocation` hard-codes `--permission-mode bypassPermissions`,
unconditionally, in every branch. The code's own comment and `PHASE_2_SPEC.md` §6.1 state this was
chosen because it is the only documented value among `acceptEdits`/`auto`/`bypassPermissions`/
`manual`/`dontAsk`/`plan`/`default` that guarantees zero interactive tool-use prompts
*deterministically* rather than *probabilistically* -- the property PRD AC2 and FM7 both require. The
tradeoff, stated explicitly in the spec rather than left implicit: this is multi-loopr's own choice
among vendor-documented options, not a vendor mandate, so a future phase revisiting permission
granularity (e.g. per-tool confirmation) would need to consciously walk this back rather than assume it
was forced.

**`--bare` (Claude) is permanently rejected, at real cost to startup-context determinism guarantees.**
Both `buildInvocation` methods never emit `--bare`, enforced by a dedicated test in each adapter's own
test file and by `assertAdapterConformance`'s check 5. Per PRD §9 FM8 (verified this run by reading the
PRD directly): `--bare` is the vendor-recommended mode for scripted calls, but it disables OAuth/
keychain credential reading and would force an `ANTHROPIC_API_KEY`, silently breaking the
BYOA-by-subscription login model multi-loopr's own preflight/auth logic already depends on. The
tradeoff taken instead: startup-context determinism is obtained the harder way, via three explicit
flags (`--setting-sources project`, `--strict-mcp-config`, `--allowedTools <fixed list>`) rather than
one blanket flag -- more surface area to keep correct as the vendor's CLI evolves, in exchange for not
regressing the credential model.

**`codex exec -a`/`--ask-for-approval` is permanently rejected -- not a stylistic choice but a
correction of what PRD §9 FM7 calls "the single highest-value correction" of the whole modernization
pass.** The PRD records (and I independently confirmed by reading `docs/modernization_log.md`'s cited
local probe) that `codex exec -a never --help` on the installed binary actually returns `error:
unexpected argument '-a' found`; `-a` exists only on the top-level interactive `codex` command, not
`exec`. `buildInvocation` instead sets the same intent via `-c approval_policy="never"` plus `--sandbox
workspace-write`, unconditionally. `--full-auto` is separately never emitted either (deprecated in favor
of the explicit `--sandbox` flag). Tradeoff: none really -- this is a case where the spec's original
plan was simply wrong about the real CLI's surface, and Phase 2's code follows the corrected PRD
guidance rather than the more "obvious"-looking flag a naive implementation might have reached for.

**`stdin: req.prompt`, not a positional CLI argument, for both adapters.** Both adapters pipe the
turn's prompt through stdin (`"-"` explicitly for Codex; an absent positional argument for Claude)
rather than passing it as a trailing argv element. The stated reason in both files is avoiding an OS
command-line length ceiling for a large, loopr-spec-shaped prompt. For Claude specifically, this was
initially shipped with the "no-argument implies stdin" behavior tagged `[UNVERIFIED-P2]` in the spec
(§6.1); see §5 below for how and when this was actually closed.

**`interpretResult` keys on `raw.exitCode !== 0`, never on `raw.exitCode === null` specifically, in
both adapters.** This is a direct, demonstrated compliance with the Phase 1 Windows `exitCode:null`
erratum (see §5/§6 below) -- confirmed by reading both `interpretResult` implementations line by line:
`claude-code.ts` line 144 and `codex-cli.ts` line 161 both branch on `raw.exitCode !== 0`, so a
spawn-level failure (`exitCode: null`) and any other non-zero exit are treated identically as failure,
with no code path anywhere in either adapter that distinguishes `null` from a real non-zero value. The
tradeoff: multi-loopr cannot currently tell "the CLI genuinely isn't installed" apart from "the CLI ran
and exited with a real error code" from `interpretResult`'s signal alone -- but this was already an
accepted, documented tradeoff from the erratum, not a new one Phase 2 introduced.

**`buildProviderPreflightReport` extracted into `src/verify/preflight.ts` rather than duplicated inside
each adapter.** `PHASE_2_SPEC.md` §1.5 states the alternative considered and rejected: writing the same
version-range/auth-interpretation assembly logic inside each adapter file instead, which would create
two independently-maintained copies of it. The tradeoff taken: a Phase 1 file was modified (additively)
rather than kept untouched, in exchange for a single source of truth an adapter's `preflight()` and
`multi-loopr doctor` can never disagree about.

## 4. Domain mechanics

**Effort-value sets and the tier -> effort maps** (`src/adapters/claude-code.ts`'s `CLAUDE_EFFORT_VALUES`
= `low`/`medium`/`high`/`xhigh`/`max`; `src/adapters/codex-cli.ts`'s `CODEX_EFFORT_VALUES` =
`minimal`/`low`/`medium`/`high`/`xhigh`; both adapters' private `TIER_TO_EFFORT` maps sending
`research-grade`/`verification-grade` -> `high` and `high-volume-low-effort` -> `low` for both
providers). Source: `docs/modernization_log.md` §1, cited in both adapter files' own doc comments as
`[VERIFIED-LOCAL]` (Claude, against the installed v2.1.211 binary's own `--help` text) and
`[VERIFIED-DOC]` (Codex, against `https://learn.chatgpt.com/docs/config-file/config-reference`). I did
not independently re-fetch either source this run; this citation is inherited from the PRD's own Step
10 research pass and from Phase 2's own build-time re-confirmation recorded in the code comments, not
independently re-verified against the vendor pages by me this run -- **[UNVERIFIED]** beyond that
inherited chain.

**Claude Code's `ultracode` effort value is deliberately excluded.** The vendor's published CLI
reference additionally lists `ultracode` as an accepted `--effort` value, but `CLAUDE_EFFORT_VALUES`
excludes it. Source: `docs/modernization_log.md` §1's own stated rule, quoted directly in
`claude-code.ts`'s doc comment: "treat any value absent from the installed binary's own help as
unavailable." This is a real, live judgment call a developer without this project's own history would
not know to make -- the installed binary's actual `--help` output is treated as more authoritative than
the vendor's own published docs page, on the theory that a doc page can describe an aspirational or
not-yet-rolled-out feature.

**The `--setting-sources project` / `--allowedTools "Bash,Edit,Write,Read,Glob,Grep"` / `--model`
flag-syntax verifications, closed during this phase's own build rather than left as spec-time guesses.**
`PHASE_2_SPEC.md` §6.1 flagged four items `[UNVERIFIED-P2]`, requiring the executor to confirm each
against the installed binary before shipping. `claude-code.ts`'s own file header states three were
confirmed against `claude --help` v2.1.211 during implementation: `--setting-sources` accepts a
comma-separated list of `user`/`project`/`local` (so the literal `"project"` is valid); `--allowedTools`
accepts bare tool names; `--model <model>` exists as documented. This is a real methodology figure (a
CLI's accepted flag syntax) grounded in a stated local binary probe -- **[VERIFIED-LOCAL]** by the
implementation's own account; I did not independently re-run `claude --help` myself this run to
re-confirm it, so this is inherited verification, not independently re-verified by me -- **[UNVERIFIED]**
beyond that inherited chain.

**The fourth `[UNVERIFIED-P2]` item -- whether `claude -p` with no positional prompt argument reads
from stdin -- was the one genuinely left unclosed by the implementation commit, and was closed by the
review itself with a live local smoke test.** See §5 below; this is both a domain-mechanics figure (a
CLI's actual stdin-fallback behavior) and the subject of this phase's honesty-audit finding.

No other domain figures (thresholds, statistics, or methodology numbers in the sense this section
tracks) were introduced this phase. `MAX_REPORTED_EVENTS = 20` (`src/adapters/codex-cli.ts`) is an
ordinary defensive-programming cap on how many matched failure events get attached to a thrown error's
details, not a domain-derived figure, consistent with how Phase 1's own SIGTERM-grace-period and
recursion-depth constants were treated in the prior comprehension pass.

## 5. Honesty audit

Compared every `PHASE_2_SPEC.md` clause I read against the shipped code, this run, including running
`npm run typecheck`, the full test suite, `doctor --boundary`, and `doctor --providers --json` myself
rather than trusting the spec's or the review's own claims about their results.

**Real gap, already found and closed within this same phase's own review cycle, worth naming precisely
because of what it reveals about the project's own pattern:** `PHASE_2_SPEC.md` §6.1's fourth
`[UNVERIFIED-P2]` item required confirming, before shipping, whether `claude -p` (no positional prompt
argument) reads its prompt from stdin -- load-bearing because `buildInvocation`'s `stdin: req.prompt`
design assumes exactly this. The Phase 2 implementation commit (`de97571`) closed the other three
`[UNVERIFIED-P2]` items in `claude-code.ts`'s own file-header comment but silently omitted this fourth
one -- the comment as first shipped did not document that it had been checked at all. This is exactly
the same undocumented-verification-gap shape as Phase 1's Windows `exitCode:null` narrowing (an
implementation detail was handled correctly in the running code but not written down where a future
reader would look for it). Unlike the Phase 1 case, this one was caught and closed inside the *same*
phase's review, before approval: the review-patch commit (`6298f98`) added a documented live smoke test
(`echo "..." | claude -p --output-format json --effort low` on the installed v2.1.211 binary, returning
a valid parsed JSON result) confirming the design was already functionally correct, and recorded that
confirmation in the code's own comments. I confirmed this by reading `6298f98`'s diff directly: it
touches exactly one file (`src/adapters/claude-code.ts`), adds only comment lines (13 insertions, 0
production-logic changes), and the commit message states 152/152 tests still pass and the boundary scan
still reports 0 violations -- both of which I independently re-ran this run and confirmed still hold at
the current tip.

**Not a gap, but the item I was specifically asked to verify rather than assume: whether the Phase 1
Windows `exitCode:null` erratum was genuinely resolved before Phase 2 depended on it.** It was. Commit
`dda755f` ("docs: erratum to PHASE_1_SPEC.md §6.1") added the erratum text to `PHASE_1_SPEC.md` §6.1
itself at `2026-08-16 12:45:50`, chronologically before both the Phase 2 blueprint commit (`89966af`,
`12:57:27`) and the Phase 2 implementation commit (`de97571`, `13:22:29`) -- confirmed by reading commit
timestamps directly, not by trusting commit order in `git log`'s default listing alone. The erratum's
own text (read this run, `PHASE_1_SPEC.md` lines 616-630) states the consequence for downstream phases
in one explicit sentence: "code must not rely on `exitCode === null` as an OS-independent 'command not
found' signal -- treat any non-zero `exitCode` as the actual failure signal instead." I then read both
Phase 2 adapters' `interpretResult` implementations directly and confirmed both do exactly this:
`claude-code.ts` line 144 and `codex-cli.ts` line 161 both branch on `raw.exitCode !== 0`, never on
`=== null`. So this is not merely a paper resolution -- Phase 2's actual code demonstrably respects the
erratum's guidance. This closes Phase 1 open item #1 (see §6).

**A documentation curiosity worth naming, though not a code-vs-spec gap:** `PHASE_2_SPEC.md` §9 item 15
(written at `89966af`, `12:57:27` -- twelve minutes after the erratum commit) describes amending
`PHASE_1_SPEC.md` itself as "a separate, still-pending operator decision this phase does not resolve or
need to resolve," phrased as if the erratum had not yet happened. By the time that sentence was written,
`dda755f` had already appended the erratum to `PHASE_1_SPEC.md` §6.1. This does not affect Phase 2's own
correctness (the spec's conclusion -- "Phase 2 has no dependency on that open item being closed" -- is
still true either way, since Phase 2's code was never written to depend on the null/non-null
distinction), but the spec's own prose was already slightly stale relative to the repository's real
state at the moment it was drafted. I flag this as a minor process observation, not a functional defect.

No other `PHASE_2_SPEC.md` clause I checked (§1's per-file additive/regression constraints, §2
dependency exactness, §3's plain-`as const` schema-avoidance claim, §4's CLI-surface no-change claim,
§6.1-§6.5 function signatures and flag lists, §7's failure-mode guard table, §8's 21 acceptance
criteria I could check by direct execution or direct code reading, §9's non-goals) showed a divergence
between what the spec states and what the code I read this run actually does.

## 6. Open items

No open items are carried forward from the prior `COMPREHENSION.md`: its sole open item (#1, whether to
formally amend `PHASE_1_SPEC.md` §6.1 for the Windows `exitCode:null` narrowing before Phase 2/3 code
came to depend on the exact null/non-null distinction) is now resolved. It was resolved two ways,
independently confirmed this run: (a) the spec itself was, in fact, formally amended (commit `dda755f`,
before Phase 2 was drafted or implemented), and (b) Phase 2's own `interpretResult` code in both
adapters demonstrably never keys on `exitCode === null`, only on `exitCode !== 0`, exactly as the
erratum recommends. Neither half of that resolution is aspirational or merely documented -- both were
verified by reading the actual files this run (see §5).

No new open items surfaced from this phase's own review commits (`de97571`, `6298f98`, `d8785b6` --
the latter carries no commit body, unlike Phase 1's approval commit, so its findings live entirely in
the preceding fix-patch commit's own message, which I read and summarized in §5) beyond the one gap
already closed within the same review cycle (§5).

One forward-looking note, not an unresolved item but worth stating plainly for the operator: the four
`[UNVERIFIED-P2]` flag-syntax items `PHASE_2_SPEC.md` §6.1 named were closed by a local binary probe on
this specific machine's installed CLI versions (`claude` 2.1.211, `codex-cli` 0.128.0). If either CLI is
upgraded before Phase 3 begins, these flag-syntax confirmations should be treated as tied to those
specific versions, not as permanently settled -- this is the same version-drift concern PRD FM9 already
tracks for version *ranges*, extended here to flag *syntax*, which FM9's mechanism does not separately
guard.

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
Phase 1's `runPreflight()` without changing its observable behavior, confirmed by Phase 1's own
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

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

This first phase does not yet run that relay race. No AI assistant is actually dispatched by this
code yet -- that comes later. What this phase builds is the plumbing the race will run on:

- A strict "handoff form" format: when one assistant's turn ends, what it hands to the next assistant
  is a small, structured note -- what changed, what files were read and written (each backed by a
  fingerprint of its contents so the claim can be checked, not just trusted), what's left to do, and
  whether it hit a wall. It is explicitly not allowed to contain the assistant's private reasoning,
  chat transcript, or self-justification -- only facts. A note that tries to sneak in anything that
  looks like reasoning is rejected outright, by a filter that runs before the note's format is even
  checked.
- A "doctor" command a person can run to check whether their computer is ready: is the right version of
  Node.js and git installed, are both AI assistants installed and signed in, and does the project's own
  code obey its own rules.
- A locking mechanism so two runs can never collide and stomp on each other's work at the same time.
- A set of automatic scans over multi-loopr's own source code that catch specific forbidden shortcuts:
  reaching out to the internet, hard-coding a browser-login flow, hard-coding one specific AI model's
  name somewhere that would make it hard to add a third AI provider later, or leaving an AI-generated
  fingerprint (like "Co-Authored-By: Claude") in a commit message.
- A mechanical way to check that a handoff was honored: did the next assistant's work actually build on
  top of the previous assistant's commits (rather than starting over), did it actually read back the
  files the previous assistant said it wrote, and did it keep working from the same instructions
  (rather than a stale or swapped-out spec)? All of this is decided by directly inspecting git history
  and file fingerprints -- never by asking an assistant to self-report whether it did the right thing.

This phase also deliberately does not build several things yet, on purpose: it does not know how to
actually launch Claude Code or Codex to do real work, it has no command to start a real handoff run,
and it has no idea yet how an abstract "effort level" (like "verification-grade") maps to each
assistant's own concrete settings. Those are for later phases.

## 2. Architecture walkthrough

Every file below was read in full this run and exists in the repository at the stated path.

**Project root**
- `package.json` -- manifest. `"type": "module"`, `engines.node: ">=24.0.0"`, three scripts
  (`typecheck`, `test`, `check`), and exactly one runtime dependency (`zod`).
- `tsconfig.json` -- strict TypeScript configuration for Node's native `.ts` execution (no build
  step): `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`,
  `erasableSyntaxOnly`, `allowImportingTsExtensions`, `rootDir: "src"`.
- `.gitignore` -- ignores `node_modules/`, `.multi-loopr/`, `*.log`.
- `.npmrc` -- `save-exact=true`.
- `README.md` -- name, one-paragraph description, the Node requirement, and the three `npm run`
  scripts. No functionality claims beyond what Phase 1 ships.

**`src/domain/` -- host-agnostic types, zero provider knowledge**
- `src/domain/errors.ts` -- `ExitCode` (a plain const object, not a TypeScript `enum` -- `enum` is
  banned by `erasableSyntaxOnly`), the abstract `MultiLooprError` base class, nine concrete error
  subclasses (one per non-zero exit code), and `exitCodeFor()`.
- `src/domain/tiers.ts` -- `MODEL_TIERS` (`research-grade` / `verification-grade` /
  `high-volume-low-effort`) and nothing else. No tier-to-provider-effort mapping lives here.
- `src/domain/roles.ts` -- the five `ARCHETYPES`, the `RoleDefinition` schema, and `ROLE_REGISTRY`
  with one entry per archetype. Every entry pins `receivesPriorAgentReasoning` to the literal `false`.
  `getRole()` is total over the five archetypes.
- `src/domain/relay.ts` -- the versioned `HandoffRecord` schema (schema version 1), the primitive
  sub-schemas (`Sha256Hex`, `GitOid`, `IsoUtc`, `RunId`, `RepoRelPath`, `FileRef`), the
  `FORBIDDEN_RELAY_KEY_PATTERN` isolation denylist and `assertNoTranscriptFields()`, and
  `parseHandoffRecord` / `serialiseHandoffRecord` / `readHandoffRecord` / `writeHandoffRecord`.
- `src/domain/run.ts` -- `ProviderId` (`claude-code` / `codex-cli`), the operator-facing `RunConfig`
  schema, and the plain (non-wire) `TurnRequest` / `RawInvocationResult` / `TurnOutcome` types.

**`src/ports/` -- the portability seam**
- `src/ports/provider-adapter.ts` -- the `ProviderAdapter` interface, `Invocation`, `PreflightReport`,
  and `AdapterRegistry` type. Declarations only; no implementation and no adapter value exist in this
  phase, and `src/adapters/` does not exist yet.

**`src/util/` -- primitives**
- `src/util/exec.ts` -- `runProcess()`, the only module in the codebase permitted to import
  `node:child_process` (verified: it is the only production file that does; four test files
  reference the string only in comments, never as an import). Spawns with `shell: false`, closes
  stdin immediately when no payload is given, and enforces a mandatory timeout with a SIGTERM-then-
  SIGKILL (5s grace) escalation. See §3 for the Windows-specific fallback this file adds beyond the
  spec's literal text.
- `src/util/hash.ts` -- `sha256String()` and `sha256File()` (the latter streams the file). No
  dedicated `hash.test.ts` file exists; its coverage lives inside `src/verify/continuity.test.ts`
  (verified by reading that file's imports).
- `src/util/paths.ts` -- `toRepoRelPosix()`, `isSafeRepoRelPath()` (the single source of truth
  `relay.ts`'s `RepoRelPath` schema delegates to), `multiLooprDir()`, `runLockPath()`, and
  `handoffPath()`.
- `src/util/lock.ts` -- `acquireRunLock()`, `readRunLock()`, `releaseRunLock()`, `isProcessAlive()`.
  Acquisition uses `fs.open(path, "wx")` (verified: no `existsSync`/`access` check-then-act pattern
  anywhere in the file); a lock whose pid is dead or whose contents are corrupt is reclaimed with
  exactly one retry.

**`src/verify/` -- the deterministic layer**
- `src/verify/git.ts` -- typed plumbing wrappers (`gitVersion`, `revParse`, `currentBranch`,
  `isAncestor`, `changedPaths`, `blobOidAt`, `commitsBetween`, `commitMessages`), all routed through
  `runProcess`. No dedicated `git.test.ts`; its functions are exercised from
  `continuity.test.ts` and `preflight.test.ts`.
- `src/verify/continuity.ts` -- `verifyContinuation()` and the five `checkC1..checkC5` functions,
  aggregated by strict logical AND into a `ContinuityVerdict`. All five checks always run, even on an
  early failure (verified by reading `verifyContinuation`'s body: `Promise.all` runs C1/C3, then C2,
  C4, C5 all execute regardless of C1/C3's outcome).
- `src/verify/preflight.ts` -- `PROVIDER_VERSION_RANGES`, `TOOL_VERSION_RANGES`, `parseSemverish()`,
  `inRange()`, `checkNodeVersion()`, `checkGitAvailable()`, `checkProviderCli()`,
  `checkProviderAuth()`, and `runPreflight()`, which always probes both providers even if the first
  fails.
- `src/verify/boundary-rules.ts` -- the eight `BOUNDARY_RULES` (B1-B8) as frozen data, excluded from
  its own scan.
- `src/verify/boundary.ts` -- `scanBoundary()` and `listScannedSourceFiles()`, which walk `src/**/*.ts`
  (excluding `*.test.ts` and `boundary-rules.ts` itself) plus `package.json`'s `dependencies`.
- `src/verify/commits.ts` -- `ATTRIBUTION_PATTERNS`, `checkCommitNeutrality()`, and
  `assertNeutralCommits()`. One pattern is built with `new RegExp("Generated with " + "Codex", "i")`
  rather than a literal, specifically so this file's own source line does not trip its own boundary
  rule B8 (see §3).

**`src/cli/`**
- `src/cli/main.ts` -- hand-rolled argument parsing, command dispatch, and
  `MultiLooprError` -> exit-code mapping. Shebang present. Uses `process.exitCode` rather than
  `process.exit()` so buffered `--json` output is not truncated.
- `src/cli/doctor.ts` -- `runDoctor()`, which composes preflight, the boundary scan, and a lock
  smoke test (against a disposable temp directory, never the real repo) into one `DoctorReport`,
  computes the exit code by §4.3's precedence rule, and redacts credential-looking substrings from
  boundary-violation excerpts.

**Tests** (all colocated `*.test.ts` files named in the spec's own test table exist:
`src/domain/relay.test.ts`, `src/domain/roles.test.ts`, `src/util/lock.test.ts`,
`src/util/paths.test.ts`, `src/verify/continuity.test.ts`, `src/verify/boundary.test.ts`,
`src/verify/preflight.test.ts`, `src/verify/commits.test.ts`, `src/cli/main.test.ts`), plus one file
the spec's own table never named: `src/util/exec.test.ts`, added by the review's own fix patch (see
§3, §5).

Verified this run by direct execution (not merely by reading the source): `node src/cli/main.ts
doctor --boundary` exits `0`, reporting 17 files scanned and 0 violations; `node --test
"src/**/*.test.ts"` runs 125 tests, all passing.

## 3. Decisions and tradeoffs

**The Windows `cmd.exe` ENOENT-relaunch fallback in `src/util/exec.ts` (not in the original spec).**
`PHASE_1_SPEC.md` §6.1 specifies that a spawn error resolves with `exitCode: null`. The shipped code
adds a documented exception: on `win32`, when the primary `shell:false` spawn fails with `ENOENT`
(because npm publishes the `claude`/`codex` CLIs as `.cmd` launcher shims, which `child_process.spawn`
cannot execute at all under `shell:false`, regardless of whether the command is genuinely on PATH), the
code retries exactly once through `cmd.exe /d /s /c`, gated by a check that every argument is free of
`cmd.exe`'s own shell metacharacters (`&|<>^%"` and CR/LF). The tradeoff, stated in the file's own
comment block and confirmed by direct execution: when that fallback engages and the command genuinely
doesn't exist either, the result now comes from `cmd.exe`'s own `close` event with a real, non-null
exit code (observed: `1`) rather than a second spawn error -- so on Windows specifically, "spawn error"
and "process ran and exited 1" become numerically indistinguishable, and the code explicitly declines
to parse `cmd.exe`'s own (potentially localized) stderr text to disambiguate, citing PRD §7 I2's ban on
non-deterministic heuristics in the verification path. What was given up: strict conformance to
§6.1's literal `exitCode: null` contract on this one platform, in exchange for the provider CLIs being
launchable on Windows at all. See §5 for whether the spec itself was updated to reflect this.

**Coverage for `hash.ts` and `git.ts` was folded into `continuity.test.ts` and `preflight.test.ts`
rather than shipped as dedicated files.** `PHASE_1_SPEC.md` §1.6's own test table never named a
`hash.test.ts` or `git.test.ts`, so this is not a spec deviation, but it is a real choice: `sha256File`/
`sha256String` are exercised inside `continuity.test.ts` (which already builds real git fixture repos
for the C1-C5 checks) rather than in a standalone file. Tradeoff: coverage for these two primitives is
less discoverable by filename, in exchange for reusing fixture setup that already existed.

**`commits.ts`'s own attribution-pattern list avoids writing one forbidden phrase as a literal.** One
entry in `ATTRIBUTION_PATTERNS` is built as `new RegExp("Generated with " + "Codex", "i")` instead of a
regex literal. The comment explains why: `commits.ts` is not excluded from `scanBoundary()`'s own scan
(only `*.test.ts` and `boundary-rules.ts` are), and boundary rule B8 is a dumb textual pattern match
that cannot distinguish "this string detects the forbidden trailer" from "this string emits it."
Tradeoff: a slightly harder-to-read line of source, in exchange for the project's own boundary scanner
not flagging its own detection logic as a violation.

## 4. Domain mechanics

**`ContinuityVerdict`'s strict-logical-AND aggregation** (`src/verify/continuity.ts`,
`verifyContinuation()`): a turn is `CONTINUED` only if all five checks (C1-C5) pass; any single failure
fails the whole verdict, and the failing check IDs are enumerated rather than collapsed to a boolean.
Citation: Xu, Zhang, Mitra, Hruschka, "Verification-Aware Planning for Multi-Agent Systems" (VeriMAP),
arXiv:2510.17109, §2.3 ("a strict logical AND strategy, where a subtask is marked as failed if any VF
fails"). I confirmed this citation is actually present in `multi-loopr-PRD.md` §8.1(3) (read this run)
and that `continuity.ts`'s own file-level comment names the same paper and section; I did not
independently re-fetch the arXiv paper this run, so the citation's accuracy is inherited from the PRD's
own Step 10 research pass rather than independently re-verified against the source text.

**Provider CLI and toolchain version acceptance ranges** (`src/verify/preflight.ts`,
`PROVIDER_VERSION_RANGES` / `TOOL_VERSION_RANGES`): `claude-code` `[2.1.200, 3.0.0)`, `codex-cli`
`[0.128.0, 1.0.0)`, Node.js `>=24.0.0`, git `>=2.40.0`. Source: `PHASE_1_SPEC.md` §2.3, which states
these were verified locally against real installed CLIs during the Step 10 pass. I independently
re-ran the same probes on this machine this run: `claude --version` -> `2.1.211 (Claude Code)`,
`codex --version` -> `codex-cli 0.128.0`, `git --version` -> `2.54.0.windows.1`, `node --version` ->
`v24.15.0` -- all fall inside the ranges the shipped code encodes, and the exact banner shapes match
what `parseSemverish()`'s own tests assert against. Not independently re-verified against each vendor's
own published release notes for whether `2.1.200`/`3.0.0` and `0.128.0`/`1.0.0` are the *correct*
boundary versions (as opposed to merely "this machine's installed versions fall inside them") --
**[UNVERIFIED]** beyond the local-execution check above.

**SIGTERM-to-SIGKILL grace period (5000ms), default max captured output (10,000,000 bytes), and the
transcript-scan recursion depth cap (12)** (`src/util/exec.ts`, `src/domain/relay.ts`): these are
engineering constants, not figures drawn from external research or a domain-specific methodology. No
citation is claimed for them; they are not domain figures in the sense this section tracks (a
threshold or statistic a developer without domain background wouldn't know to question) so much as
ordinary defensive-programming defaults.

## 5. Honesty audit

Compared every `PHASE_1_SPEC.md` clause I read against the shipped code, this run. Two things stand
out, one real gap and one thing that is not a gap:

**Real gap: `PHASE_1_SPEC.md` §6.1 step 6 was never amended to describe the Windows `cmd.exe`
fallback.** The spec's literal text still says a spawn error "resolves with `exitCode: null`" with no
platform exception. The shipped `src/util/exec.ts` narrows that contract on `win32` (see §3). I
confirmed this is still true as of the current tip: the commit that followed approval (`ce3d2ed`,
"docs: clarify Windows exitCode:null contract exception in exec.ts") only edited `src/util/exec.ts`'s
own comments to describe the exception more precisely -- `PHASE_1_SPEC.md` itself was not touched by
that commit or by any commit after the approval. So the spec's §6.1 text and the shipped behavior
still diverge on this platform; only the code's own self-documentation was strengthened, not the spec
of record. This was already surfaced by the phase's own review (commit `e389620`'s message names the
same gap) as a flagged, non-blocking finding rather than a defect -- I independently confirmed it by
reading `exec.ts` in full and diffing `PHASE_1_SPEC.md` against the current tree myself, not by
trusting the review's own prose.

**Not a gap, but worth naming: the spec's own §1.6 test table never mandated `exec.test.ts`, `hash.test.ts`,
or `git.test.ts` as dedicated files, and the shipped code's test layout (one added file, two folded
into other files) is consistent with that -- there is no missing-coverage gap here, just a test-file
layout that doesn't mirror the module layout one-to-one.**

No other spec clause I checked (§2 dependency/tsconfig exactness, §3 schema rules and refinements, §4
CLI surface and exit-code precedence, §6.1-§6.11 function signatures and module boundaries, §7
failure-mode guards, §8 acceptance criteria I could check by direct execution) showed a divergence
between what the spec states and what the code I read this run actually does.

## 6. Open items

1. **Operator decision still pending: whether to formally amend `PHASE_1_SPEC.md` §6.1** to describe
   the Windows `cmd.exe` ENOENT-relaunch fallback and its narrowed `exitCode: null` contract, before
   Phase 2 or Phase 3 code comes to depend on the exact null/non-null distinction on that path. This
   was recommended by the phase's own review (commit `e389620`) and remains unresolved: the follow-up
   commit (`ce3d2ed`) improved the code's own comments but did not touch the spec file itself. Every
   current caller already treats "any non-zero/non-null exit code" as failure rather than keying
   specifically on `exitCode === null`, so this is not currently causing an observed bug -- it is a
   documentation/spec-fidelity gap, not a functional one, but it is still open.

No other open items are carried forward: this is the first phase, so there is no prior
COMPREHENSION.md to inherit items from, and no other UNCERTAIN-flagged item surfaced in the review
commits I read.

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

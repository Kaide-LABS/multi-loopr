# PHASE_2_SPEC.md -- multi-loopr

## §0 Phase Plan Header

**Phase 2 of 5.**

**Title:** Provider adapters.

**Built from:** `multi-loopr-PRD.md` §10 (Phase plan: "Provider adapters -- `ClaudeCodeAdapter` +
`CodexCliAdapter` implementing the port; pure argv construction; exit-code interpretation; adapter
conformance suite"), `PHASE_1_SPEC.md` §9 (non-goals 1-5, explicitly deferring exactly this scope to
Phase 2), `docs/modernization_log.md` (pinned CLI invocation facts, §§1/3/4), and `COMPREHENSION.md`
(verified account of what Phase 1 actually shipped). Where this spec and the PRD disagree, the PRD
wins and the disagreement is a defect in this spec that must be escalated, not silently reconciled.

**What Phase 2 is.** Two concrete implementations of the `ProviderAdapter` interface Phase 1 shipped
as declarations only (`src/ports/provider-adapter.ts`, PHASE_1_SPEC.md §3.6): `ClaudeCodeAdapter` and
`CodexCliAdapter`. Each adapter turns a `TurnRequest` into a pure, testable `Invocation` (argv/env/
cwd/stdin) for `claude`/`codex`, maps an abstract `ModelTier` to that provider's own effort setting,
observes that provider's health via `preflight()`, and interprets a completed process result via
`interpretResult()`. Phase 2 also ships the first `AdapterRegistry` value and a conformance suite that
exercises both adapters against the same contract.

**What Phase 2 is not.** No turn loop, no `run` CLI command, and no code that actually spawns a
provider CLI to do real work -- `buildInvocation`'s output is never handed to `runProcess()` outside of
a test. No `HandoffRecord` file is read or written during a live run. No role-profile/system-prompt
content assembly. No lock acquisition around a turn. See §9.

**Standing constraint for the executor agent (inherited from PHASE_1_SPEC.md §0, binding here too).**
Every public function named in §6 below must exist with the exact name, exact module path, and exact
signature given. Where this spec marks a CLI flag or value as **[UNVERIFIED-P2]** rather than
**[VERIFIED-LOCAL]**/**[VERIFIED-DOC]**, the executor must confirm it against the installed binary's
own `--help` output before shipping; if the installed binary's real behaviour contradicts this spec,
HALT and escalate -- do not silently substitute a plausible-looking flag. This mirrors exactly the
epistemic discipline `multi-loopr-PRD.md` itself uses (`[VERIFIED-LOCAL]` / `[VERIFIED-DOC]` /
`[VERIFIED-REGISTRY]` / `[UNVERIFIED]`), applied here to Phase 2's own new claims rather than repeating
ones the PRD already settled.

**Cross-phase modification policy (new for Phase 2, stated once so later phases can reuse the same
reasoning).** Phase 1's own header said "Phase 1 adds every file below; it modifies none" because Phase
1 was greenfield. Phase 2 is not greenfield: it is genuinely allowed to modify already-approved Phase 1
files, but only when every one of the following holds, and §1 must say so explicitly for each modified
file: (a) the modification is additive (a new field, a new exported function, a new doc comment) rather
than a change to existing behaviour or an existing signature; (b) every Phase 1 test that exercised the
file continues to pass unmodified, proving no regression; (c) the reason a Phase 1 file rather than a
new Phase 2 file was the right place is stated. Three such modifications are made in this phase; each is
justified individually in §1.

---

## §1 Files Added or Modified

All paths are relative to the repo root `C:\Users\hp\multi-loopr`.

### 1.1 New: `src/adapters/`

| Path | Purpose |
|---|---|
| `src/adapters/claude-code.ts` | `ClaudeCodeAdapter implements ProviderAdapter`. |
| `src/adapters/claude-code.test.ts` | Unit tests + the conformance suite run against this adapter. |
| `src/adapters/codex-cli.ts` | `CodexCliAdapter implements ProviderAdapter`. |
| `src/adapters/codex-cli.test.ts` | Unit tests + the conformance suite run against this adapter. |
| `src/adapters/conformance.ts` | `assertAdapterConformance()` -- the shared, provider-agnostic contract checks both adapter test files run (§6.4). Not itself a `*.test.ts` file: it is a reusable assertion library, consistent with `src/verify/git.ts` being a non-test helper consumed by multiple test files in Phase 1. |
| `src/adapters/registry.ts` | `ADAPTER_REGISTRY: AdapterRegistry` -- the first value of this type (PHASE_1_SPEC.md §3.6 explicitly deferred it here). |
| `src/adapters/registry.test.ts` | Registry identity/completeness tests. |

This is `src/adapters/**` in full for Phase 2 -- the directory PHASE_1_SPEC.md's boundary rule B7
already carved out an exclusion for (§6.8 note: "`src/adapters/` does not exist in Phase 1. The
exclusion is written now so that Phase 2 does not need to modify the scanner"). **Confirmed: the
scanner needs no change.** Every concrete model-name/tier-alias literal Phase 2 introduces (effort
value strings, in §6.1/§6.2 below) lives under this directory and is therefore already exempt from B7
under Phase 1's own rule table.

### 1.2 Modified: `src/domain/errors.ts`

**Additive only.** Adds exactly one new exit code and one new error class, both appended after the
existing nine (never renumbering an existing one, since `ExitCode` values are a public, load-bearing
contract other code already switches on):

```
ExitCode.TURN_TIMEOUT = 10
```

`class TurnTimeoutError extends MultiLooprError` -- `exitCode = ExitCode.TURN_TIMEOUT`,
`code = "TURN_TIMEOUT"`.

**Why here, why now.** `multi-loopr-PRD.md` §9 FM7 already names "the turn fails with a distinct
`TurnTimeoutError`" as the intended design, but Phase 1 never introduced the class because Phase 1
never produced a `TurnOutcome` (its own `runProcess` timeout probes were internal CLI health checks,
not turns). Phase 2's `interpretResult()` is the first code that must return a `TurnOutcome.failure`
for a timed-out turn (§6.3/§6.4 below), and `TurnOutcome.failure` is typed `MultiLooprError | null`
(PHASE_1_SPEC.md §3.5) -- so a concrete class is now structurally required, not optional polish.
Reusing `InternalError` was considered and rejected: `InternalError` is documented as "an unexpected
failure that is not one of multi-loopr's own modelled error conditions," and a turn timeout is exactly
a modelled condition (FM7), not an unexpected one -- conflating the two would make a future dispatch
loop (Phase 3) unable to distinguish "the provider hung" from "something in multi-loopr itself broke."
**Regression constraint:** `src/domain/errors.ts`'s own consumers in Phase 1 (`exitCodeFor()`,
`src/cli/main.ts`'s catch block) require no change -- `exitCodeFor()` already handles any
`MultiLooprError` subclass generically. No Phase 1 test asserts the exact membership of `ExitCode`, so
none breaks.

### 1.3 Modified: `src/domain/run.ts`

**Additive only.** `TurnRequest` gains one new required field:

```
readonly modelOverride: string | null;
```

**Why.** `RunConfig.model_overrides` (PHASE_1_SPEC.md §3.5) is documented as "the only place a concrete
model name may appear at runtime, and it is operator-supplied data, never source." Phase 1 validates
`RunConfig` but nothing consumes it yet (Phase 1 §9 non-goal: no dispatch loop). `TurnRequest` --
the type `ProviderAdapter.buildInvocation` actually receives -- had no field to carry that
operator-supplied override through to argv construction. Since nothing in Phase 1 constructs or
consumes a `TurnRequest` value yet either (same non-goal), adding this field is purely additive: it
cannot break an existing caller because there is no existing caller. Not adding it would leave
`RunConfig.model_overrides` write-only forever, silently missing its one stated purpose.
`null` (not absent/optional) when the operator did not override, matching this codebase's established
preference for explicit nullability over optionality on non-wire types (`RawInvocationResult`'s fields
are all required unions with `null`, never `?`).
**Regression constraint:** no Phase 1 code constructs a `TurnRequest` literal, so no Phase 1 test can
possibly break from this addition (grep-confirmed: `TurnRequest` has zero non-type-only references
outside `src/domain/run.ts` and `src/ports/provider-adapter.ts` in the current tree).

### 1.4 Modified: `src/ports/provider-adapter.ts`

**Additive only, doc-comment only -- no type or behavioural change.** `Invocation.env`'s doc comment is
extended to state the merge contract Phase 2 depends on (this was genuinely unstated in Phase 1, not
contradicted by it):

> `env` is an **additive overlay**, not a full replacement: whatever process actually spawns this
> invocation (Phase 3's dispatch loop, via `runProcess()`) must construct the child's environment as
> `{ ...process.env, ...invocation.env }`, never as `invocation.env` alone. This is what lets
> `buildInvocation` stay pure (per this interface's own existing doc comment: "no environment read
> beyond what `req` already carries") while the provider CLI still inherits the operator's ambient
> `PATH`, credentials, and shell environment at actual spawn time. An adapter returns a non-empty `env`
> only for values it must deterministically force (none needed in Phase 2 -- see §6.1/§6.2).

**Why this had to be resolved now, not deferred to Phase 3.** `buildInvocation` is contractually pure
(already fixed by Phase 1's own doc comment on the interface) and cannot call `process.env` itself.
Without stating the merge contract, a Phase 3 implementer could just as plausibly read `invocation.env`
as the complete environment, which would silently strip the operator's `PATH`/credentials the moment
any adapter returns `env: {}` -- a real, load-bearing ambiguity, not a style nit. Resolving it here
means Phase 2's own conformance suite (§6.4) can assert against a documented contract rather than an
implementer's guess.
**Regression constraint:** the `Invocation` interface's fields and the `ProviderAdapter` interface's
method signatures are byte-identical to Phase 1's shipped version; only a doc comment gained
additional sentences. No test reads doc comments, so nothing can regress.

### 1.5 Modified: `src/verify/preflight.ts`

**Additive/refactor only -- extracts existing inline logic into a new exported function; the extracted
logic's observable behaviour is unchanged.** Adds:

```
export async function buildProviderPreflightReport(id: ProviderId): Promise<PreflightReport>
```

This is exactly the per-provider block `runPreflight()`'s loop body already computes inline
(`checkProviderCli` -> `versionInRange` -> `checkProviderAuth` -> `reportProblems` ->
`PreflightReport` object), lifted out unchanged and called both by `runPreflight()`'s loop (replacing
the inline block, one call site) and by each adapter's `preflight()` method (§6.1/§6.2). This is the
right place because it is the *only* place PROVIDER_VERSION_RANGES, checkProviderCli, and
checkProviderAuth are already imported together and already assembled into exactly a `PreflightReport`
-- duplicating that assembly logic inside `src/adapters/*.ts` instead would create two independently
maintained copies of the same version-range/auth-interpretation logic, which is exactly the kind of
drift PRD §9 FM9 exists to prevent.
**Regression constraint:** `src/verify/preflight.test.ts` (Phase 1, unmodified) must still pass without
a single edit to that test file -- proving `runPreflight()`'s output is byte-for-byte the same before
and after the extraction. If it is not, the refactor is wrong and must be redone until it is.

### 1.6 Full Phase 2 file manifest

| Path | Status |
|---|---|
| `src/adapters/claude-code.ts` | new |
| `src/adapters/claude-code.test.ts` | new |
| `src/adapters/codex-cli.ts` | new |
| `src/adapters/codex-cli.test.ts` | new |
| `src/adapters/conformance.ts` | new |
| `src/adapters/registry.ts` | new |
| `src/adapters/registry.test.ts` | new |
| `src/domain/errors.ts` | modified (additive) |
| `src/domain/run.ts` | modified (additive) |
| `src/ports/provider-adapter.ts` | modified (doc comment only) |
| `src/verify/preflight.ts` | modified (refactor, no behaviour change) |

No other file changes. In particular: `src/cli/main.ts`, `src/cli/doctor.ts`, `src/verify/boundary.ts`,
`src/verify/boundary-rules.ts`, `src/domain/relay.ts`, `src/domain/tiers.ts`, `src/domain/roles.ts`,
`src/util/**` are untouched -- Phase 2 adds no CLI command and changes no CLI-visible behaviour (§9).

---

## §2 Dependencies

**No change.** `package.json` `dependencies` still contains exactly `zod` (boundary rule B2 unchanged).
`devDependencies` still contains exactly `typescript` and `@types/node`. Phase 2 needs no new package:
argv construction is string/array assembly, and interpreting a JSON/JSONL payload uses `JSON.parse`
(already used throughout Phase 1's `src/verify/preflight.ts`). `tsconfig.json` is byte-identical to
PHASE_1_SPEC.md §2.2 -- `rootDir: "src"` already covers `src/adapters/**` with no edit required.

---

## §3 Schemas and Data Models

Phase 2 introduces no new **zod** schema. Nothing it adds crosses a process/wire boundary the way
`HandoffRecord` does (that is still exclusively `src/domain/relay.ts`'s job, untouched this phase);
`Invocation` and `TurnRequest` remain plain, non-validated TypeScript types constructed and consumed
entirely in-process, exactly as Phase 1 already declared them. What Phase 2 adds are plain `as const`
tuples/records, in the same style as `src/domain/tiers.ts`'s `MODEL_TIERS`.

### 3.1 `src/adapters/claude-code.ts` -- effort value set

```
export const CLAUDE_EFFORT_VALUES = ["low", "medium", "high", "xhigh", "max"] as const;
export type ClaudeEffortValue = (typeof CLAUDE_EFFORT_VALUES)[number];
```
Source: `docs/modernization_log.md` §1, itself `[VERIFIED-LOCAL]` against `claude --help` v2.1.211.
The doc page additionally lists `ultracode`; per that same log entry ("treat any value absent from the
installed binary's own help as unavailable"), `ultracode` is deliberately excluded here too.

### 3.2 `src/adapters/codex-cli.ts` -- effort value set

```
export const CODEX_EFFORT_VALUES = ["minimal", "low", "medium", "high", "xhigh"] as const;
export type CodexEffortValue = (typeof CODEX_EFFORT_VALUES)[number];
```
Source: `docs/modernization_log.md` §1, `[VERIFIED-DOC]`
https://learn.chatgpt.com/docs/config-file/config-reference.

### 3.3 Tier -> effort map (private to each adapter file, not exported as a shared table)

Both adapters encode the same already-decided table (`docs/modernization_log.md` §1, PRD §6.2) as a
`Readonly<Record<ModelTier, ClaudeEffortValue>>` / `Readonly<Record<ModelTier, CodexEffortValue>>`
respectively:

| `ModelTier` | Claude Code | Codex CLI |
|---|---|---|
| `research-grade` | `high` | `high` |
| `verification-grade` | `high` | `high` |
| `high-volume-low-effort` | `low` | `low` |

Deliberately **not** a shared cross-provider file: the two maps' value types differ
(`ClaudeEffortValue` vs `CodexEffortValue`), and PHASE_1_SPEC.md §3.2 already forbids this table from
living anywhere in `src/domain/` -- "A tier->effort table appearing here is a boundary rule B7
violation." Each adapter owns its own map privately, consistent with the interface's own doc comment:
"Maps an abstract `ModelTier` to this provider's own concrete effort setting."

### 3.4 `TurnRequest.modelOverride` (schema, not zod -- see §1.3)

Already specified in §1.3. Restated here for completeness: `string | null`, required, no default.

### 3.5 `TurnTimeoutError` / `ExitCode.TURN_TIMEOUT`

Already specified in §1.2.

---

## §4 CLI Surface

**No change.** Phase 2 adds zero commands, zero flags, and modifies the behaviour of no existing
command. `multi-loopr doctor`, `doctor --json`, `doctor --boundary`, `doctor --providers`, `--version`,
`--help` behave identically to PHASE_1_SPEC.md §4, verified by regression (§8). There is still no `run`
command (§9) -- that is Phase 3's deliverable, per PRD §10.

---

## §5 Migrations

**N/A, same rationale as PHASE_1_SPEC.md §5.** Phase 2 owns no persistent, versioned, on-disk format.
It writes nothing to disk at all -- `buildInvocation` returns an in-memory `Invocation` value; nothing
in Phase 2 calls `runProcess()` with it (§9). The only on-disk state multi-loopr owns
(`.multi-loopr/run.lock`, `.multi-loopr/runs/**`) is unchanged from Phase 1 and untouched by this
phase.

---

## §6 Implementation Logic Flow

### 6.1 `src/adapters/claude-code.ts`

```
export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly id: ProviderId = "claude-code";
  preflight(): Promise<PreflightReport>;
  resolveEffort(tier: ModelTier): ClaudeEffortValue;
  buildInvocation(req: TurnRequest): Invocation;
  interpretResult(raw: RawInvocationResult): TurnOutcome;
}
```

**`preflight()`.** `return buildProviderPreflightReport("claude-code");` (§1.5). No independent logic --
this is a direct delegation so the adapter and `multi-loopr doctor` can never disagree about this
provider's health (FM9).

**`resolveEffort(tier)`.** Looks up §3.3's private map. **[DET]** Total over `MODEL_TIERS`: throws
`InternalError` on an unreachable tier value, mirroring `getRole()`'s existing pattern
(PHASE_1_SPEC.md §3.3) -- this codebase's established idiom for "exhaustive switch over a closed
union, defend against a value that shouldn't exist."

**`buildInvocation(req)` -- must be pure (interface's own doc comment, unchanged).**

```
command: "claude"
args: [
  "-p",
  "--output-format", "json",
  "--effort", this.resolveEffort(req.tier),
  "--permission-mode", "bypassPermissions",
  "--setting-sources", "project",
  "--strict-mcp-config",
  "--allowedTools", "Bash,Edit,Write,Read,Glob,Grep",
  ...(req.modelOverride !== null ? ["--model", req.modelOverride] : []),
]
env: {}
cwd: req.repoDir
stdin: req.prompt
```

Flag-by-flag sourcing:
- `-p` / `--output-format json` -- **[VERIFIED-DOC]** `docs/modernization_log.md` §4.1, headless mode.
- `--effort <value>` -- **[VERIFIED-LOCAL]** §3.1.
- `--permission-mode bypassPermissions` -- **[DECISION, Phase 2]**. Value drawn from the already-
  verified allowed set (`acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`,
  `default`; `docs/modernization_log.md` §4.1). `bypassPermissions` is the only member of that set
  that guarantees zero interactive tool-use prompts unconditionally, which AC2 (PRD §2.2, "zero
  browser/interactive prompts") and FM7 both require deterministically, not probabilistically. This is
  not a vendor-mandated value -- it is multi-loopr's own choice among documented options, stated as
  such (unlike `shell: false` in Phase 1, which was a mandatory safety property, not a choice).
- `--setting-sources project`, `--strict-mcp-config` -- **[DECISION, Phase 2, but PRD-mandated]**.
  PRD §9 FM8 already resolves that these two flags (plus `--allowedTools`) are how multi-loopr obtains
  startup-context determinism *without* `--bare` (which is permanently banned, FM8). The literal value
  `"project"` for `--setting-sources` is **[UNVERIFIED-P2]** -- the accepted value syntax for this flag
  was not independently probed during Step 10's pass. The executor must confirm via `claude --help`
  (or `claude --setting-sources --help` if such exists) on the installed binary before shipping; if the
  accepted syntax differs, HALT and escalate per this spec's §0 Standing Constraint rather than guess.
- `--allowedTools "Bash,Edit,Write,Read,Glob,Grep"` -- **[DECISION, Phase 2, but PRD-mandated]**. FM8
  requires *an* explicit `--allowedTools` set; this exact tool list is multi-loopr's own choice, sized
  to what an executor/reviewer turn plausibly needs (git via `Bash`, code changes via `Edit`/`Write`,
  reading via `Read`/`Glob`/`Grep`) and no more. The exact accepted string syntax (bare tool names vs.
  the `Bash(git diff *)` pattern-restricted form the headless docs also show) is **[UNVERIFIED-P2]** --
  same verify-before-ship instruction as above.
- `--model <override>` -- appended only when `req.modelOverride !== null`. Flag name **[UNVERIFIED-P2]**
  -- multi-loopr's own research pass never independently probed an explicit model-override flag for
  `claude` (PRD §6.2's own table covers *effort*, not model selection overrides). Verify against
  `claude --help` before shipping.
- `--bare` -- **never emitted, under any `req` value.** This is the one flag this file must contain a
  positive test proving it never appears (§8), per FM8.
- `env: {}` -- per §1.4's now-documented merge contract: no forced overrides needed for Claude Code in
  V1 (its credential model is ambient CLI login / keychain, already inherited via the merge Phase 3
  performs at actual spawn time -- never via `buildInvocation` reading `process.env` itself).
- `stdin: req.prompt` -- the prompt is piped, not passed as a trailing positional argument, to avoid any
  OS command-line length ceiling for a large loopr-spec-shaped prompt. Whether `claude -p` (with no
  positional prompt argument) reads the prompt from stdin is **[UNVERIFIED-P2]** -- multi-loopr's own
  research pass did not independently probe this specific behaviour (it probed the flag's *existence*,
  not the no-argument-falls-back-to-stdin behaviour). The executor must confirm via `claude --help` and
  a local smoke test before shipping; if `-p` requires a positional argument, `buildInvocation` must be
  changed to embed the prompt as `args`'s last element instead, and this spec section escalated for
  amendment (do not silently choose whichever works and leave this section stale, repeating Phase 1's
  own §6.1 erratum mistake -- see `PHASE_1_SPEC.md` §6.1's erratum for exactly the failure mode being
  avoided here).

**`interpretResult(raw)` -- [DET].**
1. If `raw.timedOut === true`: return `{ ok: false, record: null, failure: new TurnTimeoutError(...) }`
   **unconditionally** -- checked first, before any exit-code inspection, exactly mirroring
   `src/util/exec.ts`'s own doc comment ("never resolve a timed-out run as a success regardless of exit
   code").
2. Else if `raw.exitCode !== 0`: return
   `{ ok: false, record: null, failure: new InternalError("claude-code exited " + raw.exitCode, { exitCode: raw.exitCode, signal: raw.signal, stderrExcerpt: raw.stderr.slice(0, 2000) }) }`.
   (`exitCode === null`, i.e. a spawn-level failure, is covered by this same branch -- `null !== 0`.)
3. Else attempt `JSON.parse(raw.stdout)`. On parse failure: return
   `{ ok: false, record: null, failure: new InternalError("claude-code exited 0 but --output-format json stdout did not parse as JSON", { stdoutExcerpt: raw.stdout.slice(0, 2000) }) }`.
   This step exists *only* to catch a malformed-output anomaly -- it deliberately does **not** extract
   or persist `result` / `session_id` / `total_cost_usd` from the parsed payload (PRD §3 item 3: "V1
   deliberately does not consume either" cost surface; `total_cost_usd` is real and present per the
   PRD's own citation, but out of scope regardless of availability).
4. Else return `{ ok: true, record: null, failure: null }`.

**Why `record` is always `null` in Phase 2 (stated once here, applies identically to the Codex
adapter).** `interpretResult(raw: RawInvocationResult)` receives only the raw process result -- no
`repoDir`, `runId`, `phase`, `turnIndex`, `role`, or `provider`, i.e. none of the six arguments
`handoffPath()` (PHASE_1_SPEC.md §6.3, already shipped) needs to locate the `HandoffRecord` file on
disk. This is not an oversight to patch in Phase 2: it is the signature Phase 1 already fixed
(`PHASE_1_SPEC.md` §3.6), and changing it now would be a non-additive, behaviour-altering modification
of an already-approved interface, which §0's cross-phase modification policy forbids. Reading and
validating the on-disk `HandoffRecord` after a turn is Phase 3's dispatch-loop responsibility (which
*does* have `TurnRequest` in scope and can call `readHandoffRecord(handoffPath(...))` itself, then
combine that with this method's `ok`/`failure` signal). §9 states this as an explicit non-goal.

### 6.2 `src/adapters/codex-cli.ts`

```
export class CodexCliAdapter implements ProviderAdapter {
  readonly id: ProviderId = "codex-cli";
  preflight(): Promise<PreflightReport>;
  resolveEffort(tier: ModelTier): CodexEffortValue;
  buildInvocation(req: TurnRequest): Invocation;
  interpretResult(raw: RawInvocationResult): TurnOutcome;
}
```

**`preflight()`.** `return buildProviderPreflightReport("codex-cli");` -- same delegation as §6.1.

**`resolveEffort(tier)`.** Same shape as §6.1, against the Codex table in §3.3. **[DET]**.

**`buildInvocation(req)` -- must be pure.**

```
command: "codex"
args: [
  "exec",
  "-c", `approval_policy="never"`,
  "--sandbox", "workspace-write",
  "-c", `model_reasoning_effort="${this.resolveEffort(req.tier)}"`,
  ...(req.modelOverride !== null ? ["-c", `model="${req.modelOverride}"`] : []),
  "--json",
  "-C", req.repoDir,
  "-",
]
env: {}
cwd: req.repoDir
stdin: req.prompt
```

Flag-by-flag sourcing:
- `exec` -- **[VERIFIED-LOCAL]** `docs/modernization_log.md` §4.2.
- `-c approval_policy="never"` -- **[VERIFIED-DOC]** exact config key and value from the same section.
  Passed explicitly even though it is already `exec`'s documented default, for the same
  explicit-over-implicit-default reasoning FM8 already established for Claude Code's
  `--setting-sources`/`--strict-mcp-config` -- multi-loopr does not rely on a provider's current
  default remaining its future default (this is exactly FM9's concern, applied to defaults rather than
  version ranges).
- `--sandbox workspace-write` -- **[VERIFIED-DOC]** same section; mandatory because the undocumented
  default is read-only, and a turn that writes code needs write access.
- `-c model_reasoning_effort="<value>"` -- **[VERIFIED-DOC]** exact config key; value from §3.2.
- `-c model="<override>"` -- appended only when `req.modelOverride !== null`. Key name
  **[VERIFIED-DOC]** (`docs/modernization_log.md` §4.2 lists `model = string` as an accepted config
  key), so unlike Claude's `--model` flag (§6.1), this one does not need an `[UNVERIFIED-P2]` tag.
- `--json` -- **[VERIFIED-DOC]** JSONL event stream; §6.2's `interpretResult` consumes it below. This
  is exactly PHASE_1_SPEC.md §9 non-goal #4's "Parsing of ... Codex's `--json` JSONL event stream,"
  explicitly deferred to Phase 2.
- `-C <repoDir>` -- **[VERIFIED-LOCAL]** (`--cd`/`-C`, §4.2); reinforces `Invocation.cwd` explicitly
  rather than relying on the spawn-level cwd alone, matching this file's general explicit-over-implicit
  posture.
- `-a` / `--ask-for-approval` -- **never emitted, under any `req` value.** PRD §9 FM7's single
  highest-value correction: "the real binary rejects it." This file must contain a positive test
  proving it never appears (§8).
- `--full-auto` -- **never emitted** (deprecated in favour of `--sandbox workspace-write`, already used
  above; `docs/modernization_log.md` §4.2 item 6).
- `env: {}` -- same merge contract as §6.1. Codex's BYOA env-var path (`CODEX_API_KEY`/
  `OPENAI_API_KEY`) is ambient and inherited at Phase 3's actual spawn time, not forced here.
- `"-"` -- the documented explicit-stdin form of `codex exec [PROMPT]`
  (`docs/modernization_log.md` §4.2: "Prompt may be the argument, `-`, or piped stdin" --
  **[VERIFIED-LOCAL]**, `codex exec --help` v0.128.0). Chosen explicitly over omitting the positional
  argument entirely, for the same large-prompt/argv-length reasoning as §6.1, and because `-` removes
  any ambiguity about whether omission defaults to stdin or to an interactive prompt (which would
  itself be an FM7 hazard) -- `-` is unambiguous by the docs' own wording, so this one is **not**
  tagged `[UNVERIFIED-P2]`.
- `stdin: req.prompt`.

**`interpretResult(raw)` -- [DET].**
1. Same unconditional `raw.timedOut` check as §6.1, first.
2. Split `raw.stdout` on `\n`; for each non-empty line, `JSON.parse` it defensively (a line that fails
   to parse is skipped, not treated as a crash -- the documented contract is the *event-type* vocabulary
   `thread.started` / `turn.started` / `turn.completed` / `turn.failed` / `item.*` / `error`
   (`docs/modernization_log.md` §4.2, **[VERIFIED-DOC]**), not a guarantee that every implementation
   detail of every line is parseable by a naive split -- multi-loopr does not assume more than the
   vendor doc states). Collect every parsed event whose `type` field is `"turn.failed"` or `"error"`.
3. If any such event was found: return
   `{ ok: false, record: null, failure: new InternalError("codex-cli reported a turn.failed/error event", { events: <the matched events, capped at 20> }) }`
   -- **checked before the exit-code fallback**, because a wrapped failure could in principle still
   exit `0` and the event stream is the more specific signal when both are present.
4. Else if `raw.exitCode !== 0`: return
   `{ ok: false, record: null, failure: new InternalError("codex-cli exited " + raw.exitCode, { exitCode: raw.exitCode, signal: raw.signal, stderrExcerpt: raw.stderr.slice(0, 2000) }) }`.
5. Else return `{ ok: true, record: null, failure: null }`.

`record` is always `null` -- same reasoning as §6.1's closing note.

### 6.3 `src/adapters/registry.ts`

```
export const ADAPTER_REGISTRY: AdapterRegistry = Object.freeze({
  "claude-code": new ClaudeCodeAdapter(),
  "codex-cli": new CodexCliAdapter(),
});
```

Both adapters are stateless (no constructor arguments, no instance fields beyond the fixed `id`), so a
single frozen module-level instance per provider is sufficient; no factory function is needed.

### 6.4 `src/adapters/conformance.ts` -- the adapter conformance suite

```
export function assertAdapterConformance(adapter: ProviderAdapter, fixture: TurnRequest): void
```

**[DET]** A synchronous function that runs a fixed battery of `node:assert` checks against any
`ProviderAdapter` implementation and a representative `TurnRequest` fixture, throwing (failing the
test) on the first violation. Both `claude-code.test.ts` and `codex-cli.test.ts` call this once each,
against their own adapter instance and a locally-built fixture `TurnRequest`, so the same contract is
verified identically for both providers rather than being reimplemented per file (the drift risk PRD
§9 FM9 already names, applied here to test code instead of production code).

Checks, in order:
1. **Identity.** `adapter.id` is a member of `PROVIDER_IDS` and matches the key `ADAPTER_REGISTRY` uses
   for this adapter instance.
2. **`resolveEffort` totality and value-set membership.** For every member of `MODEL_TIERS`,
   `adapter.resolveEffort(tier)` returns a string, does not throw, and is a member of that provider's
   own `*_EFFORT_VALUES` tuple (§3.1/§3.2) -- catching a typo in the private map before it ever reaches
   a real invocation.
3. **`resolveEffort` purity.** Calling it twice with the same tier returns the same value.
4. **`buildInvocation` purity.** `adapter.buildInvocation(fixture)` called twice with the same fixture
   (or two structurally-`deepStrictEqual` fixtures) produces two `deepStrictEqual` `Invocation` values,
   and `fixture` itself is not mutated by the call (`deepStrictEqual` against a pre-call deep clone).
5. **No forbidden flags, regardless of adapter.** The built `Invocation.args` never contains the
   literal token `--bare`. If `adapter.id === "codex-cli"`, `args` never contains the literal token
   `-a` and never contains `--ask-for-approval` (FM7's named hazard) and never contains `--full-auto`.
6. **`env` is additive, not a full-environment guess.** `Invocation.env` contains no key that looks
   like a credential (reuses the same `/(sk-|ghp_|xoxb-)[A-Za-z0-9_-]+/` shape PHASE_1_SPEC.md §4.2
   already established for doctor-report redaction, applied here to catch an adapter accidentally
   forging a credential value rather than letting the ambient environment supply it).
7. **`interpretResult` timeout precedence.** Given a synthetic `RawInvocationResult` with
   `timedOut: true` and `exitCode: 0` (a deliberately contradictory fixture), `interpretResult` returns
   `ok: false` with a `TurnTimeoutError` -- proving the timeout check is unconditional and first, not
   reachable only when the exit code also indicates failure.
8. **`interpretResult.record` is always `null`.** For every synthetic `RawInvocationResult` fixture
   this suite constructs (success, timeout, non-zero exit), `record === null`.

### 6.5 `src/verify/preflight.ts` -- extraction detail

```
export async function buildProviderPreflightReport(id: ProviderId): Promise<PreflightReport>
```
Body: exactly the loop-body block already in `runPreflight()` (`checkProviderCli` ->
`versionInRange` computation -> conditional `checkProviderAuth` -> `reportProblems` assembly ->
`PreflightReport` object literal), parameterised on `id` instead of iterating `PROVIDER_IDS` inline.
`runPreflight()` is rewritten to `for (const id of PROVIDER_IDS) { const report = await buildProviderPreflightReport(id); providers.push(report); problems.push(...report.problems); }` -- same aggregate `ok`/`problems` computation as before, unchanged.

---

## §7 Failure-Mode Guards

| FM | Guard in Phase 2 | Reviewer check (mechanical) |
|---|---|---|
| **FM1** credential expiry/absence | Both adapters' `preflight()` delegate to `buildProviderPreflightReport()`, which is the exact Phase 1 `checkProviderAuth` logic (unchanged) -- no new auth-probe code path is introduced that could diverge from Phase 1's already-verified contracts. | 1. Confirm `preflight()` on each adapter is a one-line delegation, not reimplemented logic. 2. Confirm `src/verify/preflight.test.ts` still passes unmodified (§1.5 regression constraint). |
| **FM4** model-tier welding | Every concrete effort-value literal (§3.1/§3.2) and every tier->effort map (§3.3) lives under `src/adapters/**`, which B7 already exempts. No other file this phase (§1.6) touches `src/domain/` or `src/ports/` with a literal. | 1. Run `node src/cli/main.ts doctor --boundary`; expect exit `0`. 2. Grep `src/domain/`, `src/ports/`, `src/verify/`, `src/util/`, `src/cli/` for `low\|medium\|high\|xhigh\|max\|minimal` used as an effort-value string literal (not as an English word in a comment) -- any hit outside `src/adapters/**` fails. |
| **FM7** silent interactive fallback | `--permission-mode bypassPermissions` (Claude) and `-c approval_policy="never"` + `--sandbox workspace-write` (Codex) are unconditional, non-optional elements of `buildInvocation`'s output -- no code path omits them. Codex's `-a`/`--ask-for-approval`/`--full-auto` are never emitted (§6.2, conformance check 5). | 1. Confirm the four flags above appear in **every** branch of both `buildInvocation` methods (i.e. they are not inside an `if`). 2. Run the conformance suite (§6.4 check 5); expect it to pass for both adapters. 3. Confirm neither adapter's `buildInvocation` sets `Invocation.stdin` to `null` when `req.prompt` is a non-empty string (a turn always has a prompt; `stdin: null` would only be correct for the already-shipped Phase 1 CLI-probe call sites, not for a real turn). |
| **FM8** `--bare` regression | `ClaudeCodeAdapter.buildInvocation` never emits `--bare` under any input (§6.1, conformance check 5). | 1. Grep `src/adapters/claude-code.ts` for the literal `--bare` -- expect zero hits. 2. Confirm the conformance suite's check 5 runs against the Claude adapter specifically (not skipped). |
| **FM9** provider version drift | Adapters do not duplicate `PROVIDER_VERSION_RANGES`; they delegate to the single already-verified `buildProviderPreflightReport()` (§1.5), so a future version-range change needs one edit, not three. | 1. Grep `src/adapters/*.ts` for `PROVIDER_VERSION_RANGES` or a re-declared version range -- expect zero hits (must be imported/used only via the delegation, never re-implemented). |
| **Phase-2-local guard (not a numbered FM, an internal contract)** -- `resolveEffort` emitting a value the installed CLI would reject. | Conformance suite check 2 asserts every `resolveEffort(tier)` result is a member of that provider's own verified `*_EFFORT_VALUES` tuple. | 1. Confirm both `*_EFFORT_VALUES` tuples match §3.1/§3.2 exactly (byte-for-byte against `docs/modernization_log.md` §1). 2. Confirm the private tier->effort maps contain no value outside their own tuple (would fail typecheck if the map's value type is declared as the tuple's own union type, which it must be). |
| **HARD BOUNDARY** (PRD §5.1) | No B1-B8 pattern introduced anywhere outside the already-exempted `src/adapters/**` (B7 only). | 1. `node src/cli/main.ts doctor --boundary` exits `0`. 2. Confirm `src/verify/boundary.test.ts` (Phase 1, unmodified) still passes -- proves the scanner itself is untouched and still fires correctly. |

---

## §8 Phase Acceptance Criteria

Phase 2 is approved only when **every** item below is objectively true.

**Regression (no prior-phase behaviour broken)**
1. `npm run typecheck` exits `0` with **zero** diagnostics, across the full tree including `src/adapters/**`.
2. `npm run test` exits `0`. Every Phase 1 test file listed in `PHASE_1_SPEC.md` §1.6 passes **unmodified**
   (no test file edited except by adding new files alongside them) -- this is the direct evidence for
   §1's per-file regression constraints.
3. `node src/cli/main.ts doctor --boundary` exits `0`.
4. `npm run check` exits `0`.
5. `node src/cli/main.ts doctor --json` still emits a `DoctorReport`-shaped object with
   `providers.length === 2`, byte-identical schema to PHASE_1_SPEC.md §4.2 (Phase 2 changes no CLI
   surface, §4).

**Static discipline (same bar as Phase 1, re-applied to the new files)**
6. `z.object(` and `z.string().datetime(` do not appear anywhere under `src/adapters/**` (they should
   not appear at all, since §3 introduces no zod schema there, but the check remains general).
7. The token `any` does not appear as a type annotation under `src/adapters/**`.
8. `enum `, `namespace `, and constructor parameter properties appear nowhere under `src/adapters/**`.
9. `node:child_process` is imported in exactly one file in the whole tree: `src/util/exec.ts` (unchanged
   from Phase 1 -- confirms no adapter tried to spawn directly instead of going through `runProcess`,
   which would also make §9's "Phase 2 never spawns a real turn" non-goal unverifiable).

**Behaviour -- purity and contract**
10. `ADAPTER_REGISTRY["claude-code"].id === "claude-code"` and `ADAPTER_REGISTRY["codex-cli"].id === "codex-cli"`.
11. `ClaudeCodeAdapter.resolveEffort` and `CodexCliAdapter.resolveEffort` each return a member of their
    own `*_EFFORT_VALUES` for every `MODEL_TIERS` member (9 assertions total across both adapters: 3
    tiers x each adapter, plus purity).
12. `buildInvocation` is pure for both adapters: two calls with structurally-equal `TurnRequest` fixtures
    produce `deepStrictEqual` `Invocation` values; the fixture object is not mutated.
13. Neither adapter's `buildInvocation` output ever contains `--bare` (Claude) or `-a` /
    `--ask-for-approval` / `--full-auto` (Codex), across a battery of fixtures covering every
    `Archetype`/`ModelTier`/`modelOverride: null-and-non-null` combination reachable in V1
    (`executor`/`reviewer` archetypes only, per PRD §6.3 -- `architect`/`researcher`/`auditor` are never
    dispatched in V1 and need no fixture).
14. `interpretResult` on both adapters: a `timedOut: true` fixture (even with `exitCode: 0`) returns
    `ok: false` with a `TurnTimeoutError` whose `exitCode === ExitCode.TURN_TIMEOUT`.
15. `interpretResult.record === null` on every fixture, for both adapters (success, non-zero exit,
    timeout, and -- Codex only -- a synthetic `turn.failed` JSONL line with `exitCode: 0`).
16. Codex's `interpretResult` treats a synthetic `{"type":"turn.failed",...}` JSONL stdout line as a
    failure even when `raw.exitCode === 0` (dedicated test, proves the event-stream check runs before
    the exit-code fallback, §6.2 step 3 vs step 4).
17. Claude's `interpretResult` treats `exitCode: 0` with non-JSON `stdout` as a failure (dedicated test).

**Contract coverage** (each requires at least one dedicated test, `PHASE_1_SPEC.md` §1.6's own
convention of "no blanket coverage percentage, verify presence and correctness" continues to apply)
18. `assertAdapterConformance()` (§6.4) is called from both `claude-code.test.ts` and
    `codex-cli.test.ts`, and both calls pass.
19. `buildProviderPreflightReport("claude-code")` and the Phase 1 `runPreflight()`'s corresponding
    array element are `deepStrictEqual` for the same injected fake `RawInvocationResult` fixtures
    (proves the extraction in §1.5/§6.5 changed nothing observable).
20. On this machine's current, real state (Claude Code authenticated, Codex CLI not logged in --
    the same live condition PHASE_1_SPEC.md §8 item 18 already exercises): `new
    ClaudeCodeAdapter().preflight()` resolves `authenticated: true`; `new
    CodexCliAdapter().preflight()` resolves `authenticated: false` with a non-empty `problems` array.
    This is a real, currently-reproducible integration check, not a mocked one.

**Documentation**
21. `README.md` is **not** amended to claim a `run` command or real dispatch exists -- Phase 2 does not
    change what an operator can actually do with the CLI (§4), so no README change is required or
    permitted this phase.

---

## §9 Explicit NON-GOALS

Phase 2 does **not** build the following. A pull of any item below into Phase 2 is a scope violation
and must be rejected by the review agent even if the code is correct.

**Deferred to Phase 3 (Sequential dispatch engine)**
1. The `run` CLI command, the turn loop, and any code that actually calls `runProcess()` with an
   adapter-built `Invocation` for a real turn. Phase 2's own use of `runProcess` is limited entirely to
   the already-shipped Phase 1 preflight probes (`--version`, `auth status` / `login status`), reused
   via `buildProviderPreflightReport()` (§1.5) -- never a live turn.
2. Reading or writing any `HandoffRecord` file during a run (`readHandoffRecord`/`writeHandoffRecord`
   are Phase 1 functions Phase 2 does not call). `interpretResult.record` stays `null` in Phase 2 by
   construction (§6.1/§6.2 closing notes) -- combining an adapter's `ok`/`failure` signal with an
   on-disk record read is explicitly Phase 3's job.
3. Lock acquisition (`acquireRunLock`/`releaseRunLock`) around a turn. Phase 2 never calls the lock
   module at all.
4. Halt-signal propagation, retry-on-failed-`ContinuityVerdict` logic, or any turn-sequencing state
   machine.
5. Turn-level prompt assembly or role-profile injection. `buildInvocation` treats `req.prompt` as
   already fully assembled by its caller; it never appends role-profile text, and it deliberately never
   emits `--append-system-prompt`/`--system-prompt` (Claude) -- those exist, per PRD §4, precisely for
   role-profile injection, which is out of scope this phase.

**Deferred to Phase 4 (loopr artifact integration)**
6. Producing, rendering, or reading `baby_prd.md`, `context.md`, or `PHASE_N_SPEC.md` as real content.
   `TurnRequest.specRef` remains an opaque `FileRef`, exactly as Phase 1 left it.

**Deferred to Phase 5 (Acceptance harness)**
7. The toy build task, end-to-end AC1/AC2/AC3 evidence collection, open-source packaging.

**Out of V1 entirely (PRD §3) -- never build these, in any phase**
8. A third provider, or any provider-selection/routing logic beyond the fixed ordered pair.
   `AdapterRegistry`'s two keys (§6.3) are exactly `PROVIDER_IDS`, never more.
9. Consuming `total_cost_usd` (Claude) or the `usage` object (Codex), even though `interpretResult`
   already parses the payloads that would contain them (§6.1 step 3, §6.2 step 2). Parsing for
   malformed-output/failure-event detection is in scope; extracting and persisting cost/usage fields is
   not (PRD §3 item 3).
10. The AUDITOR and RESEARCHER archetypes' dispatch paths -- no fixture, test, or code path in this
    phase constructs a `TurnRequest` with `archetype: "auditor"` or `archetype: "researcher"` (PRD §6.3;
    `ROLE_REGISTRY` already records both as `instantiatedInV1: false`).
11. Concurrent or parallel agent execution, or any asynchronous inter-agent messaging (PRD §3.8).
12. Anything that would trip boundary rules B1-B8 -- permanently, in every phase, including inside
    `src/adapters/**` for B1-B6 and B8 (only B7 is exempted there, and only for the specific literal
    classes §3.1/§3.2 already enumerate).

**Explicitly not a Phase 2 goal even though it may look adjacent**
13. A shared `effort-map.ts` file or any other cross-provider abstraction over the tier->effort tables
    (§3.3 explains why each adapter owns its own map privately).
14. Resolving the `[UNVERIFIED-P2]`-tagged flag values (§6.1: `--setting-sources` value syntax,
    `--allowedTools` exact string syntax, `--model`'s flag name, `-p`'s no-argument-stdin behaviour)
    through guesswork dressed up as fact. They must be independently confirmed against the installed
    `claude --help`/local smoke test before this phase can be marked complete; if confirmation
    contradicts this section, this spec must be amended (escalated), not silently overridden in code
    while the spec of record goes stale -- the exact failure mode `PHASE_1_SPEC.md` §6.1's own erratum
    (commit `dda755f`) already documents happening once in this project and flags as something later
    phases must not repeat.
15. Amending `PHASE_1_SPEC.md` itself. That file's own open item #1 (documented in `COMPREHENSION.md`
    §6) -- whether to formally amend §6.1 for the Windows `exitCode:null` narrowing -- remains a
    separate, still-pending operator decision this phase does not resolve or need to resolve: every
    Phase 2 consumer of `RawInvocationResult.exitCode` (§6.1/§6.2 `interpretResult`) already branches
    on "is it exactly `0`" rather than "is it `null`", which is exactly the safe pattern the erratum
    recommends, so Phase 2 has no dependency on that open item being closed.

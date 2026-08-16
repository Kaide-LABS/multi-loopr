# PHASE_1_SPEC.md -- multi-loopr

## §0 Phase Plan Header

**Phase 1 of 5.**

**Title:** Host-agnostic core substrate.

**Built from:** `multi-loopr-PRD.md` (MODERNISED, Step 10 pass 2026-08-16) and
`docs/modernization_log.md`. Where this spec and the PRD disagree, the PRD wins and the disagreement is
a defect in this spec that must be escalated, not silently reconciled.

**What Phase 1 is.** The provider-independent core: the project toolchain, the versioned relay schema,
the role/tier registry, the four deterministic verifiers (continuity, preflight, boundary,
commit-neutrality), the `ProviderAdapter` port as an *interface only*, the exclusive-lock primitive, and
a `multi-loopr doctor` CLI that exercises the verifiers.

**What Phase 1 is not.** No provider adapter implementations. No dispatch loop. No agent is ever spawned
in Phase 1. See §9.

**Standing constraint for the executor agent.** Every public function named in §6 must exist with the
exact name, exact module path, and exact signature given. The reviewer agent checks names and signatures
mechanically. If a signature in this spec is impossible to implement as written, HALT and escalate -- do
not substitute a similar signature.

---

## §1 Files Added or Modified

All paths are relative to the repo root `C:\Users\hp\multi-loopr`. Phase 1 adds every file below; it
modifies none (the repo is greenfield apart from `multi-loopr-PRD.md`, `docs/modernization_log.md`,
`PHASE_1_SPEC.md`, `.claude/`, `.loopr-state/`, `prompts/`, none of which Phase 1 touches).

### 1.1 Project root

| Path | Purpose |
|---|---|
| `package.json` | Package manifest. `"type": "module"`, `engines`, scripts, the single runtime dependency. Exact contents in §2.1. |
| `tsconfig.json` | Type-check configuration. Exact contents in §2.2. |
| `.gitignore` | Ignores `node_modules/`, `.multi-loopr/`, `*.log`. Must **not** ignore `docs/` or `src/`. |
| `.npmrc` | Single line: `save-exact=true`. Prevents a caret range re-introducing version drift. |
| `README.md` | Minimal. Name, one-paragraph description drawn from PRD §1, the `engines` requirement, and the three `npm run` scripts. **No** installation promises, no roadmap, no badges. |

### 1.2 `src/domain/` -- host-agnostic types (zero provider knowledge)

| Path | Purpose |
|---|---|
| `src/domain/errors.ts` | `MultiLooprError` base class, the nine concrete error classes, and the `ExitCode` enum-as-const. |
| `src/domain/tiers.ts` | `ModelTier` union + `MODEL_TIERS` tuple. Nothing else. |
| `src/domain/roles.ts` | `Archetype` union, `RoleDefinition` type, `ROLE_REGISTRY`, `getRole()`. |
| `src/domain/relay.ts` | The `HandoffRecord` zod schema (v1), its inferred type, the transcript denylist, and the parse/serialise functions. |
| `src/domain/run.ts` | `ProviderId`, `RunConfig`, `TurnRequest`, `TurnOutcome`, `RawInvocationResult` schemas/types. |

### 1.3 `src/ports/` -- the portability seam

| Path | Purpose |
|---|---|
| `src/ports/provider-adapter.ts` | The `ProviderAdapter` interface, the `Invocation` type, and the `AdapterRegistry` type. **Declarations only -- no implementation, no provider name resolution logic.** |

### 1.4 `src/util/` -- primitives

| Path | Purpose |
|---|---|
| `src/util/exec.ts` | `runProcess()` -- the single sanctioned child-process wrapper. Nothing else in the codebase may import `node:child_process`. |
| `src/util/hash.ts` | `sha256File()`, `sha256String()`. |
| `src/util/paths.ts` | Repo-relative POSIX path helpers and the `.multi-loopr/` layout resolver. |
| `src/util/lock.ts` | `acquireRunLock()`, `releaseRunLock()`, `readRunLock()` -- the FM6 primitive. |

### 1.5 `src/verify/` -- the deterministic layer

| Path | Purpose |
|---|---|
| `src/verify/git.ts` | Thin, typed wrappers over the exact git plumbing commands the verifiers need. |
| `src/verify/continuity.ts` | `verifyContinuation()` and the C1--C5 check functions. FM3 / AC1. |
| `src/verify/preflight.ts` | `runPreflight()` and the per-check functions. FM1 / FM9 / AC2. |
| `src/verify/boundary-rules.ts` | The B1--B8 rule table as data. **Excluded from its own scan.** |
| `src/verify/boundary.ts` | `scanBoundary()` -- executes the B1--B8 rules over `src/**` and `package.json`. |
| `src/verify/commits.ts` | `assertNeutralCommits()`. I4. |

### 1.6 Tests (colocated, `*.test.ts`)

| Path | Covers |
|---|---|
| `src/domain/relay.test.ts` | Schema acceptance/rejection, round-trip, version rejection, isolation denylist. |
| `src/domain/roles.test.ts` | Registry completeness, tier assignment, absence of model names. |
| `src/util/lock.test.ts` | Exclusive acquire, double-acquire rejection, stale reclaim, release. |
| `src/util/paths.test.ts` | Path normalisation and traversal rejection. |
| `src/verify/continuity.test.ts` | C1--C5 individually and the strict-AND aggregation, against real fixture repos. |
| `src/verify/boundary.test.ts` | Each of B1--B8 fires on a positive fixture and stays silent on a negative one. |
| `src/verify/preflight.test.ts` | Version parsing, range checking, auth-probe interpretation (with injected fake process results). |
| `src/verify/commits.test.ts` | Attribution trailers detected; clean messages pass. |
| `src/cli/main.test.ts` | Exit codes for `--version`, `--help`, unknown command, `doctor --json`. |

Test files are excluded from `scanBoundary()` (§7 B-rules) because they must contain the forbidden
literals as fixtures.

### 1.7 `src/cli/`

| Path | Purpose |
|---|---|
| `src/cli/main.ts` | Argument parsing (hand-rolled, no dependency), command dispatch, top-level error -> exit-code mapping. Declared as the `bin` entry. |
| `src/cli/doctor.ts` | The `doctor` command: composes preflight + boundary + a lock smoke test into one report. |

---

## §2 Dependencies

Exact pinned versions, reconciled in PRD §7 I1 and mirrored in `docs/modernization_log.md` §2. Every
version below was verified against the npm registry and then installed and exercised locally during the
Step 10 pass. **No caret ranges. No `latest`.**

### 2.1 `package.json` (exact)

```json
{
  "name": "multi-loopr",
  "version": "0.1.0",
  "description": "Local, headless harness that runs loopr's spec discipline across Claude Code and Codex CLI.",
  "type": "module",
  "private": true,
  "license": "MIT",
  "bin": {
    "multi-loopr": "./src/cli/main.ts"
  },
  "engines": {
    "node": ">=24.0.0"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "node --test \"src/**/*.test.ts\"",
    "check": "npm run typecheck && npm run test && node src/cli/main.ts doctor --boundary"
  },
  "dependencies": {
    "zod": "4.4.3"
  },
  "devDependencies": {
    "typescript": "7.0.2",
    "@types/node": "26.2.0"
  }
}
```

**Constraints on this file, checked by the reviewer:**
- `dependencies` contains exactly one key, `zod`. Any addition violates boundary rule B2 (exit `7`; see
  §4.3).
- `devDependencies` contains exactly `typescript` and `@types/node`.
- No `"build"` script, no bundler, no transpiler, no test-runner dependency. Node runs `.ts` directly.
- `"type": "module"` is mandatory. Omitting it produces `TS1295`/`TS1287` under
  `verbatimModuleSyntax` -- observed locally during the Step 10 pass.

### 2.2 `tsconfig.json` (exact)

This exact configuration was installed and run to `tsc --noEmit` exit `0` during the Step 10 pass
against a probe module using zod `.strictObject`, `node:child_process`, and a `.ts`-extension relative
import. Do not alter it.

```json
{
  "compilerOptions": {
    "target": "es2024",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["es2024"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

**Why each non-obvious flag is mandatory:**
- `erasableSyntaxOnly` -- forbids `enum`, parameter properties, and namespaces, which Node's type
  stripping cannot execute. Without it the no-build-step property breaks at runtime, not at type-check.
  This is why §3 specifies unions-of-string-literals rather than `enum` everywhere.
- `allowImportingTsExtensions` -- relative imports must be written with an explicit `.ts` extension
  (e.g. `import { x } from "./y.ts"`), which is what Node requires under `nodenext` ESM. Verified locally.
- `verbatimModuleSyntax` -- forces `import type` for type-only imports, which type stripping requires.
- `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` -- the strictness floor from PRD §7 I1.

### 2.3 Runtime / tool prerequisites (not npm-managed)

| Tool | Required range | How Phase 1 checks it |
|---|---|---|
| Node.js | `>=24.0.0` | `process.versions.node` major, in `checkNodeVersion()` |
| git | `>=2.40.0` | `git --version` parse, in `checkGitAvailable()` |
| Claude Code CLI | `>=2.1.200 <3.0.0` | `claude --version` parse, in `checkProviderVersion("claude-code")` |
| Codex CLI | `>=0.128.0 <1.0.0` | `codex --version` parse, in `checkProviderVersion("codex-cli")` |

Rationale for the provider minimums: `2.1.211` and `0.128.0` are the versions on which every flag in
`docs/modernization_log.md` §4 was verified locally. `2.1.200` is chosen slightly below the verified
version to avoid an over-tight pin, but nothing below `2.1.163` may be permitted (the headless docs
describe pre-`2.1.163` background-task behaviour that would hang a run). The upper bounds are majors.

**These ranges live in exactly one place:** `PROVIDER_VERSION_RANGES` in `src/verify/preflight.ts`.

---

## §3 Schemas and Data Models

Stack note: this project is TypeScript, not Python, so this section specifies **zod v4 schemas**, not
Pydantic models. The zod v4 idioms below were verified by execution during the Step 10 pass:
`z.strictObject({...})` rejects unknown keys; `z.iso.datetime()` is the current spelling (**not**
`z.string().datetime()`, which is the deprecated v3 form) and rejects UTC offsets unless
`{ offset: true }` is passed; `z.prettifyError()` and `z.treeifyError()` exist as functions.

**Global rules for every schema in this phase:**
1. Every object schema is built with `z.strictObject(...)`. `z.object(...)` is forbidden in `src/domain/`.
2. Every schema exports both the schema constant and the inferred type, using the same identifier
   (`export const HandoffRecord = ...; export type HandoffRecord = z.infer<typeof HandoffRecord>;`).
3. No schema field is optional unless this spec says `optional`. Nullable and optional are different:
   use `.nullable()` for "present but empty", `.optional()` only where stated.
4. Parse failures are surfaced through `z.prettifyError(result.error)`, never through a raw throw.

### 3.1 `src/domain/errors.ts`

```
ExitCode (const object, not enum -- erasableSyntaxOnly):
  OK                    = 0
  INTERNAL              = 1
  USAGE                 = 2
  PREFLIGHT_FAILED      = 3
  RELAY_SCHEMA_INVALID  = 4
  ISOLATION_LEAK        = 5
  CONTINUITY_FAILED     = 6
  BOUNDARY_VIOLATION    = 7
  LOCK_HELD             = 8
  TIER_WELDING          = 9
```

`abstract class MultiLooprError extends Error`
- `readonly exitCode: number` (abstract)
- `readonly code: string` (abstract; a stable SCREAMING_SNAKE identifier)
- `readonly details: Readonly<Record<string, unknown>>` (defaults `{}`)
- constructor `(message: string, details?: Record<string, unknown>)`

Concrete subclasses, one per exit code above except `OK`:
`InternalError`, `UsageError`, `PreflightError`, `RelaySchemaError`, `IsolationLeakError`,
`ContinuityError`, `BoundaryViolationError`, `LockHeldError`, `TierWeldingError`.

`export function exitCodeFor(err: unknown): number` -- returns `err.exitCode` when `err instanceof
MultiLooprError`, else `ExitCode.INTERNAL`.

### 3.2 `src/domain/tiers.ts`

```
export const MODEL_TIERS = ["research-grade", "verification-grade", "high-volume-low-effort"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];
export const ModelTierSchema = z.enum(MODEL_TIERS);
```

Nothing else may live in this file. In particular: **no map from tier to any provider's effort value.**
That mapping belongs to `src/adapters/**` in Phase 2. A tier->effort table appearing here is a
boundary rule B7 violation.

### 3.3 `src/domain/roles.ts`

```
export const ARCHETYPES = ["architect", "researcher", "executor", "reviewer", "auditor"] as const;
export type Archetype = (typeof ARCHETYPES)[number];
```

`RoleDefinition` (`z.strictObject`):

| Field | Type | Rules |
|---|---|---|
| `archetype` | `z.enum(ARCHETYPES)` | required |
| `tier` | `ModelTierSchema` | required |
| `instantiatedInV1` | `z.boolean()` | required |
| `crossProviderInV1` | `z.boolean()` | required |
| `receivesPriorAgentReasoning` | `z.literal(false)` | required, **literal false for every role** -- makes the isolation rule a type-level fact |
| `profileSummary` | `z.string().min(20).max(600)` | required; the host-agnostic role description an adapter will inject |

`ROLE_REGISTRY: Readonly<Record<Archetype, RoleDefinition>>` -- exactly these five entries, matching
PRD §6 and §6.3:

| archetype | tier | instantiatedInV1 | crossProviderInV1 |
|---|---|---|---|
| `architect` | `research-grade` | `false` | `false` |
| `researcher` | `research-grade` | `false` | `false` |
| `executor` | `high-volume-low-effort` | `true` | **`true`** |
| `reviewer` | `verification-grade` | `true` | `false` |
| `auditor` | `verification-grade` | `false` | `false` |

`architect.instantiatedInV1 = false` because the architect is the operator's own persistent session,
never dispatched by multi-loopr (PRD §6.3).

`export function getRole(a: Archetype): RoleDefinition` -- total; throws `InternalError` on an
unreachable key.

### 3.4 `src/domain/relay.ts` -- the `HandoffRecord`, schema version 1

This is the single most load-bearing schema in the project (PRD §9 FM5). It is the entire payload that
crosses between agents. It carries **no free-form transcript, reasoning, or conversation** (PRD §6.4,
§7 I5, §9 FM2).

**Primitive sub-schemas (defined in this file, exported):**

```
Sha256Hex     = z.string().regex(/^[0-9a-f]{64}$/)
GitOid        = z.string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/)
IsoUtc        = z.iso.datetime()                        // offsets rejected; UTC only
RunId         = z.uuid()
RepoRelPath   = z.string().min(1).max(1024)
                  .refine(p => !p.startsWith("/") && !/^[A-Za-z]:/.test(p), "must be repo-relative")
                  .refine(p => !p.includes("\\"), "must use POSIX separators")
                  .refine(p => !p.split("/").includes(".."), "must not traverse upward")
FileRef       = z.strictObject({ path: RepoRelPath, sha256: Sha256Hex })
```

`GitOid` accepts both 40-hex (SHA-1) and 64-hex (SHA-256 object-format repos) so a repo created with
`--object-format=sha256` does not silently fail validation.

**`RELAY_SCHEMA_VERSION = 1` (exported const).**

**`HandoffRecord` (`z.strictObject`):**

| # | Field | Schema | Rules / notes |
|---|---|---|---|
| 1 | `schema_version` | `z.literal(1)` | Any other value must fail with `RelaySchemaError`, never be coerced. FM5. |
| 2 | `run_id` | `RunId` | UUID identifying the whole multi-turn run |
| 3 | `phase` | `z.number().int().min(1)` | loopr phase number |
| 4 | `turn_index` | `z.number().int().min(0)` | monotonically increasing within a phase |
| 5 | `role` | `z.enum(["executor", "reviewer"])` | only the two archetypes instantiated in V1 (§3.3) |
| 6 | `provider` | `ProviderIdSchema` (§3.5) | which CLI produced this turn |
| 7 | `model_tier` | `ModelTierSchema` | abstract tier, never a model name (B7) |
| 8 | `started_at` | `IsoUtc` | |
| 9 | `completed_at` | `IsoUtc` | must be `>= started_at`; enforced by a schema-level `.refine` on the object |
| 10 | `repo` | `RepoState` (below) | git ground truth |
| 11 | `spec_ref` | `FileRef` | the `PHASE_N_SPEC.md` this turn was handed. C4 compares this across turns. |
| 12 | `artifacts_read` | `z.array(FileRef).max(200)` | AC3 attestation: what the agent actually read |
| 13 | `artifacts_written` | `z.array(FileRef).max(200)` | AC3 attestation: what it produced |
| 14 | `status` | `z.enum(["completed", "blocked", "halted"])` | |
| 15 | `work_done` | `z.string().min(1).max(4000)` | a factual summary of changes. **Not** reasoning. Length-capped deliberately: a 4000-char cap makes a smuggled transcript structurally impossible. |
| 16 | `next_steps` | `z.array(z.string().min(1).max(500)).max(20)` | |
| 17 | `open_questions` | `z.array(z.string().min(1).max(500)).max(20)` | |
| 18 | `halt` | `HaltSignal.nullable()` | non-null iff `status === "halted"`; enforced by object-level `.refine` |

`RepoState` (`z.strictObject`):

| Field | Schema | Notes |
|---|---|---|
| `branch` | `z.string().min(1).max(255)` | |
| `head_before` | `GitOid` | HEAD immediately before the turn started |
| `head_after` | `GitOid` | HEAD immediately after the turn ended |
| `commits` | `z.array(GitOid).max(500)` | the commits this turn created, oldest first; may be empty only when `status !== "completed"` (object-level `.refine`) |

`HaltSignal` (`z.strictObject`):

| Field | Schema | Notes |
|---|---|---|
| `code` | `z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/)` | machine-readable; the loop halts on this |
| `message` | `z.string().min(1).max(2000)` | |

**Object-level refinements (all three are mandatory and each needs its own test):**
- R1: `completed_at >= started_at`.
- R2: `status === "halted"` iff `halt !== null`.
- R3: `status === "completed"` implies `commits.length >= 1`.

**Isolation denylist (FM2, PRD §7 I5).**

```
export const FORBIDDEN_RELAY_KEY_PATTERN =
  /transcript|conversation|reasoning|chain[_-]?of[_-]?thought|rationale|thinking|scratchpad|messages|history|justification/i;
```

`export function assertNoTranscriptFields(raw: unknown): void` -- walks `raw` **recursively** (objects
and arrays, depth-capped at 12) and throws `IsolationLeakError` naming PRD §6.4 and the offending key
path if any key matches. It runs **before** schema parsing so the failure is legible as an isolation
breach rather than as a generic unknown-key error. Depth cap exists so a malicious/degenerate nesting
cannot hang the parse.

**Functions:**

```
export function parseHandoffRecord(raw: unknown): HandoffRecord
export function readHandoffRecord(absPath: string): Promise<HandoffRecord>
export function serialiseHandoffRecord(rec: HandoffRecord): string
export function writeHandoffRecord(absPath: string, rec: HandoffRecord): Promise<void>
```

- `parseHandoffRecord` order of operations is fixed and testable:
  1. reject non-plain-object input -> `RelaySchemaError`
  2. `assertNoTranscriptFields(raw)` -> may throw `IsolationLeakError` (exit `5`)
  3. read `raw.schema_version`; if it is not the literal `1`, throw `RelaySchemaError` (exit `4`) with
     both the found and expected versions in `details`. **Do not fall through to zod for this** -- the
     dedicated check produces a drift-specific message.
  4. `HandoffRecord.safeParse(raw)`; on failure throw `RelaySchemaError` with
     `z.prettifyError(result.error)` as the message.
- `serialiseHandoffRecord` emits `JSON.stringify(rec, null, 2) + "\n"` with keys in the declaration
  order of §3.4 (stable ordering is required for the round-trip test and for readable diffs).
- `readHandoffRecord` reads UTF-8, `JSON.parse`, then `parseHandoffRecord`. A `JSON.parse` failure is a
  `RelaySchemaError`, not an `InternalError`.

### 3.5 `src/domain/run.ts`

```
export const PROVIDER_IDS = ["claude-code", "codex-cli"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export const ProviderIdSchema = z.enum(PROVIDER_IDS);
```

`RunConfig` (`z.strictObject`) -- Phase 1 defines and validates it; Phase 3 consumes it:

| Field | Schema | Default | Notes |
|---|---|---|---|
| `run_id` | `RunId` | none | |
| `repo_dir` | `z.string().min(1)` | none | absolute path to the target repo |
| `executor_providers` | `z.tuple([ProviderIdSchema, ProviderIdSchema])` | none | ordered pair; must be two **different** ids (`.refine`) -- this is what makes the run cross-provider |
| `reviewer_provider` | `ProviderIdSchema.nullable()` | `null` | `null` = "the provider that did not produce the diff" (PRD §6.3) |
| `turn_timeout_ms` | `z.number().int().min(1000).max(7_200_000)` | `1_800_000` | FM7 |
| `model_overrides` | `z.record(ProviderIdSchema, z.string().min(1)).optional()` | absent | the **only** place a concrete model name may appear at runtime, and it is operator-supplied data, never source. |

`TurnRequest` (type, not a wire schema): `{ runId, phase, turnIndex, archetype, provider, tier,
repoDir, specRef: FileRef, priorRecord: HandoffRecord | null, prompt: string, timeoutMs: number }`.

`RawInvocationResult` (type): `{ exitCode: number | null, signal: NodeJS.Signals | null, stdout: string,
stderr: string, durationMs: number, timedOut: boolean }`.

`TurnOutcome` (type): `{ ok: boolean, record: HandoffRecord | null, failure: MultiLooprError | null }`.

### 3.6 `src/ports/provider-adapter.ts` -- declarations only

```
export interface Invocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly stdin: string | null;   // null => stdin is closed immediately (FM7)
}

export interface PreflightReport {
  readonly provider: ProviderId;
  readonly cliFound: boolean;
  readonly version: string | null;
  readonly versionInRange: boolean;
  readonly authenticated: boolean;
  readonly problems: readonly string[];   // empty => healthy
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  preflight(): Promise<PreflightReport>;
  resolveEffort(tier: ModelTier): string;
  buildInvocation(req: TurnRequest): Invocation;
  interpretResult(raw: RawInvocationResult): TurnOutcome;
}

export type AdapterRegistry = Readonly<Record<ProviderId, ProviderAdapter>>;
```

**`buildInvocation` must be pure** -- no I/O, no clock, no environment read beyond what is passed in.
This is the decision that makes Phase 2's adapters testable without spawning an LLM, and Phase 2's
conformance suite depends on it. State this as a doc comment on the method.

Phase 1 ships **no** implementation of this interface and **no** `AdapterRegistry` value. A file under
`src/adapters/` appearing in Phase 1 is a scope violation (§9).

---

## §4 CLI Surface

Phase 1 ships one binary with two commands. There is deliberately no `run` command yet (§9).

Argument parsing is hand-rolled in `src/cli/main.ts` -- no `commander`, `yargs`, or `citty`, because
`dependencies` is allowlisted to `zod` alone (boundary rule B2).

### 4.1 Commands and flags

| Invocation | Behaviour |
|---|---|
| `multi-loopr --version` | Prints the `version` field from `package.json` and a newline. Exit `0`. |
| `multi-loopr -v` | Alias of `--version`. |
| `multi-loopr --help` \| `-h` \| *(no args)* | Prints usage to **stdout**. Exit `0`. |
| `multi-loopr doctor` | Full health check: toolchain + both providers + boundary scan + lock smoke test. Human-readable report to stdout. Exit per §4.3. |
| `multi-loopr doctor --json` | Same checks, single JSON object to stdout, nothing else on stdout. Exit per §4.3. |
| `multi-loopr doctor --boundary` | Boundary scan **only** (no provider probes, no network-adjacent work, fast). Exit `0` or `7`/`9`. |
| `multi-loopr doctor --providers` | Provider preflight only. Exit `0` or `3`. |
| anything else | Usage error to **stderr**. Exit `2`. |

Flag rules: unknown flags are a `UsageError` (exit `2`), never ignored. `--json` may combine with
`--boundary` or `--providers`. `--boundary` and `--providers` are mutually exclusive; passing both is
exit `2`.

### 4.2 `doctor --json` output shape

A single `z.strictObject` (`DoctorReport`, defined in `src/cli/doctor.ts`), printed with
`JSON.stringify(report, null, 2)`:

```
{
  "schema_version": 1,
  "generated_at": <IsoUtc>,
  "ok": <boolean>,
  "exit_code": <number>,
  "toolchain": {
    "node":  { "found": bool, "version": string|null, "inRange": bool },
    "git":   { "found": bool, "version": string|null, "inRange": bool }
  },
  "providers": [ <PreflightReport>, ... ],       // one per ProviderId, always both, in PROVIDER_IDS order
  "boundary": {
    "filesScanned": number,
    "violations": [ { "rule": "B1".."B8", "file": string, "line": number, "excerpt": string } ]
  },
  "lock": { "acquirable": bool, "detail": string },
  "problems": [ string, ... ]                     // flattened, human-readable, ordered by severity
}
```

`excerpt` is capped at 200 characters and must have any credential-looking substring
(`/(sk-|ghp_|xoxb-)[A-Za-z0-9_-]+/`) replaced with `***REDACTED***` before printing -- a doctor report is
something operators paste into issues.

### 4.3 Exit codes (canonical; PRD §9)

| Code | Name | Raised when |
|---|---|---|
| `0` | OK | all requested checks passed |
| `1` | INTERNAL | an unexpected throw that is not a `MultiLooprError` |
| `2` | USAGE | unknown command, unknown flag, mutually exclusive flags |
| `3` | PREFLIGHT_FAILED | toolchain missing/out of range, provider CLI missing/out of range, or provider unauthenticated |
| `4` | RELAY_SCHEMA_INVALID | `schema_version` mismatch or zod parse failure on a `HandoffRecord` |
| `5` | ISOLATION_LEAK | a transcript-shaped key found in a relay record |
| `6` | CONTINUITY_FAILED | `ContinuityVerdict.verdict !== "CONTINUED"` |
| `7` | BOUNDARY_VIOLATION | any of B1--B6, B8 fired |
| `8` | LOCK_HELD | the run lock is held by a live process |
| `9` | TIER_WELDING | **B7 specifically** fired -- a concrete model name outside `src/adapters/**` |

B7 gets its own exit code so the reviewer can distinguish a portability regression (FM4) from a
hard-boundary breach. When both a B7 and another B-rule fire in the same scan, the exit code is `7`
(the harder failure wins) and both appear in `violations`.

**Precedence when multiple failures occur in one `doctor` run:** report *all* of them in `problems` /
`violations`, and exit with the **lowest-numbered non-zero** code among those raised, except that `7`
outranks `9` as stated above. `main.ts` must never exit `0` while `problems` is non-empty.

### 4.4 Stream discipline

- Machine-readable output (`--json`, `--version`) goes to **stdout only**.
- Diagnostics, warnings, and error messages go to **stderr**.
- No ANSI colour codes when `process.stdout.isTTY` is false. Phase 1 need not implement colour at all;
  if it does, this rule is mandatory.

---

## §5 Migrations

**N/A for Phase 1, and structurally N/A for V1.** multi-loopr is a CLI harness with no database and no
persistent schema requiring migration. The only on-disk state it owns is:

- `.multi-loopr/run.lock` -- ephemeral, deleted on release, reclaimable when stale.
- `.multi-loopr/runs/<run_id>/handoff/**.json` -- append-only artifacts of a single run.

Forward compatibility for the relay format is handled by the `schema_version` literal (§3.4 field 1),
which **rejects** rather than migrates. A future schema version 2 will be introduced by adding a second
schema and a version-dispatching reader, not by mutating version 1 records in place. Phase 1 must not
write any migration scaffolding, version-upgrade function, or `schema_version >= 1` range check.

---

## §6 Implementation Logic Flow

Function-by-function. Deterministic anchors are named explicitly and marked **[DET]** -- these are the
functions PRD §7 I2 forbids any LLM from substituting for.

### 6.1 `src/util/exec.ts`

```
export interface RunProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string | null;
  readonly timeoutMs: number;
  readonly maxOutputBytes?: number;   // default 10_000_000
}
export function runProcess(o: RunProcessOptions): Promise<RawInvocationResult>
```

**This is the only module in the codebase permitted to import `node:child_process`.** The reviewer
greps for `node:child_process` and fails any other file.

Logic, in order:
1. Spawn with `child_process.spawn(command, args, { cwd, env, shell: false, windowsHide: true,
   stdio: ["pipe", "pipe", "pipe"] })`. **`shell: false` is mandatory** -- a shell would reintroduce
   argument-injection and would make `buildInvocation`'s argv contract meaningless.
2. **[DET, FM7]** If `o.stdin` is a string, write it and `end()`. If it is `null` or `undefined`,
   call `child.stdin.end()` **immediately**. The parent's TTY is never inherited on stdin. A provider CLI
   that tries to prompt therefore reads EOF and fails fast instead of hanging.
3. Accumulate stdout/stderr as UTF-8. If either exceeds `maxOutputBytes`, stop accumulating, set a
   truncation marker in the tail of the captured string, and keep the process running (do not kill --
   truncation is not a failure).
4. **[DET, FM7]** Arm a timer for `timeoutMs`. On expiry: kill the process tree
   (`child.kill("SIGTERM")`, then `SIGKILL` after a 5000 ms grace), resolve with `timedOut: true`.
   Never resolve a timed-out run as a success regardless of exit code.
5. Resolve `{ exitCode, signal, stdout, stderr, durationMs, timedOut }`. Note `exitCode` is `null` when
   the process was signalled -- callers must handle `null` explicitly, which
   `noUncheckedIndexedAccess`/`strict` will force.
6. A spawn error (ENOENT) resolves with `exitCode: null, signal: null, stderr: <the error message>` and
   a `durationMs`. It does **not** reject. Rejecting would make every caller write a try/catch and would
   make "CLI not installed" indistinguishable from a bug.

> **Erratum (post-approval, 2026-08-16):** the `exitCode: null` guarantee in point 6 above has a
> disclosed, non-fixable narrowing on Windows. `src/util/exec.ts` contains a documented, justified
> AUTONOMOUS CRITIQUE adjustment added during Phase 1's implementation: when the primary spawn fails
> with `ENOENT` on `win32`, a `cmd.exe /d /s /c` relaunch fallback engages (see that file's own
> file-level comment for the full rationale). If that relaunch *also* fails to find the command,
> the result comes from `cmd.exe`'s own `close` event rather than from a second spawn error -- so
> `exitCode` is **not** `null` in that case. It is a real, non-null exit code (observed on the
> implementation machine: `1`), indistinguishable by value alone from some legitimate non-zero
> business-logic outcomes (e.g. `codex login status`'s own "not logged in" -> `1`). This is
> deliberate and non-fixable: no reliable, locale-independent signal exists to reconstruct `null`
> here without violating the project's determinism invariant. Consequence for downstream phases:
> code must not rely on `exitCode === null` as an OS-independent "command not found" signal --
> treat any non-zero `exitCode` as the actual failure signal instead, which every current Phase 1
> consumer already does. This erratum does not alter the original paragraph above; it documents a
> narrowing found and confirmed after the Phase 1 spec's approval (commit `e389620`).

### 6.2 `src/util/hash.ts`

```
export function sha256String(s: string): string            // hex, lowercase
export function sha256File(absPath: string): Promise<string>
```
`node:crypto` `createHash("sha256")`. `sha256File` streams the file rather than reading it whole.
Both return lowercase hex, matching the `Sha256Hex` regex. **[DET]** -- these are the AC3 attestation
primitive.

### 6.3 `src/util/paths.ts`

```
export function toRepoRelPosix(repoDir: string, absPath: string): string
export function isSafeRepoRelPath(p: string): boolean
export function multiLooprDir(repoDir: string): string                    // <repoDir>/.multi-loopr
export function runLockPath(repoDir: string): string                      // <repoDir>/.multi-loopr/run.lock
export function handoffPath(repoDir: string, runId: string, phase: number,
                            turnIndex: number, role: string, provider: string): string
```

`handoffPath` returns
`<repoDir>/.multi-loopr/runs/<runId>/handoff/<phase>/<turnIndex>-<role>-<provider>.json` with
`turnIndex` zero-padded to 3 digits so lexical order equals numeric order. This is a Windows-hosted
project: `toRepoRelPosix` must convert `\` to `/` and must not depend on the host separator.
`isSafeRepoRelPath` implements exactly the three `RepoRelPath` refinements from §3.4 and is what that
schema calls -- the rule lives in one place.

### 6.4 `src/util/lock.ts` -- FM6 **[DET]**

```
export interface LockInfo { readonly pid: number; readonly runId: string;
                            readonly host: string; readonly acquiredAt: string; }
export function acquireRunLock(repoDir: string, runId: string): Promise<LockInfo>
export function readRunLock(repoDir: string): Promise<LockInfo | null>
export function releaseRunLock(repoDir: string, runId: string): Promise<void>
export function isProcessAlive(pid: number): boolean
```

`acquireRunLock`:
1. `mkdir -p` the `.multi-loopr` directory.
2. **[DET]** `await fs.open(lockPath, "wx")` -- the `wx` flag fails with `EEXIST` if the file exists.
   This is an atomic filesystem operation; a `existsSync` check followed by a write is a race and is
   **forbidden**.
3. On success: write the JSON `LockInfo`, `fsync`, close, return.
4. On `EEXIST`: read and parse the existing lock.
   - If it parses and `isProcessAlive(info.pid)` is true -> throw `LockHeldError` (exit `8`) naming the
     holding pid and `acquiredAt`.
   - If it parses and the pid is dead -> the lock is stale: unlink it and retry step 2 **exactly once**.
     A second `EEXIST` throws `LockHeldError` (another process won the race -- correct behaviour).
   - If it does not parse (corrupt) -> treat as stale, same as above, and log the corruption to stderr.
5. Any other errno -> `InternalError`.

`isProcessAlive` uses `process.kill(pid, 0)` inside try/catch: no throw -> alive; `ESRCH` -> dead;
`EPERM` -> alive (owned by another user).

`releaseRunLock` reads the lock, and unlinks **only if `info.runId === runId`**. Releasing another run's
lock is an `InternalError`. Unlinking a non-existent lock is a no-op, not an error.

### 6.5 `src/verify/git.ts` -- typed plumbing wrappers **[DET]**

Every function here calls `runProcess` with `command: "git"` and returns typed data. No function in this
module parses porcelain output; all use plumbing or explicitly stable formats.

```
export function gitVersion(repoDir: string): Promise<string | null>
export function revParse(repoDir: string, rev: string): Promise<string>            // full OID; throws on failure
export function currentBranch(repoDir: string): Promise<string>                    // `git rev-parse --abbrev-ref HEAD`
export function isAncestor(repoDir: string, ancestor: string, descendant: string): Promise<boolean>
export function changedPaths(repoDir: string, fromOid: string, toOid: string): Promise<readonly string[]>
export function blobOidAt(repoDir: string, oid: string, repoRelPath: string): Promise<string | null>
export function commitsBetween(repoDir: string, fromOid: string, toOid: string): Promise<readonly string[]>
export function commitMessages(repoDir: string, oids: readonly string[]): Promise<readonly string[]>
```

Exact commands and exit-code contracts (these were probed locally during the Step 10 pass; do not
substitute equivalents):

| Function | Command | Contract |
|---|---|---|
| `isAncestor` | `git merge-base --is-ancestor <ancestor> <descendant>` | exit `0` -> `true`; exit `1` -> `false`; exit `128` -> throw `ContinuityError` with code `GIT_BAD_OBJECT` (a malformed OID must never be silently read as "not an ancestor") |
| `changedPaths` | `git diff --name-only -z <from>..<to>` | split on `\0`, drop the trailing empty element. `-z` is mandatory: paths with spaces or non-ASCII break the newline form. |
| `blobOidAt` | `git rev-parse <oid>:<path>` | exit `0` -> the OID; non-zero -> `null` (the path did not exist at that commit) |
| `commitsBetween` | `git rev-list --reverse <from>..<to>` | oldest-first list; empty output -> empty array |
| `commitMessages` | `git show -s --format=%B <oid>` per OID | one call per OID; do not batch with a separator that could appear in a message body |
| `currentBranch` | `git rev-parse --abbrev-ref HEAD` | returns `HEAD` in detached state; callers must accept that |

### 6.6 `src/verify/continuity.ts` -- FM3 / AC1 **[DET, the single most important module in Phase 1]**

```
export const CONTINUITY_CHECKS = ["C1_ANCESTRY","C2_ADVANCEMENT","C3_NO_REVERT",
                                  "C4_SPEC_CONTINUITY","C5_ARTIFACT_ATTESTATION"] as const;
export type ContinuityCheckId = (typeof CONTINUITY_CHECKS)[number];

export interface CheckResult {
  readonly id: ContinuityCheckId;
  readonly passed: boolean;
  readonly detail: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export type ContinuityVerdictLabel =
  "CONTINUED" | "REDO" | "PARTIAL_REVERT" | "IGNORED" | "DIVERGED";

export interface ContinuityVerdict {
  readonly verdict: ContinuityVerdictLabel;
  readonly checks: readonly CheckResult[];      // always all five, in CONTINUITY_CHECKS order
  readonly failedCheckIds: readonly ContinuityCheckId[];
}

export function verifyContinuation(
  repoDir: string, prev: HandoffRecord, next: HandoffRecord
): Promise<ContinuityVerdict>
```

**Aggregation rule (strict logical AND, adopted from VeriMAP §2.3 per PRD §8.1(3)):** the verdict is
`CONTINUED` **only** when all five checks pass. All five checks always run -- do not short-circuit -- so
the verdict carries the complete failure set for the retry signal.

Per-check logic:

- **C1_ANCESTRY.** `isAncestor(repoDir, prev.repo.head_after, next.repo.head_after)` must be `true`.
  Evidence: both OIDs. Failure alone -> contributes to `DIVERGED`.
- **C2_ADVANCEMENT.** `next.repo.head_after !== prev.repo.head_after` **and**
  `next.repo.commits.length >= 1`. Failure alone -> contributes to `IGNORED` (the receiving agent
  produced nothing).
- **C3_NO_REVERT.** The literal, deterministic definition of "not a redo":
  1. `P = changedPaths(repoDir, prev.repo.head_before, prev.repo.head_after)` -- the paths the prior
     agent touched.
  2. If `P` is empty, C3 passes vacuously with `detail: "prior turn changed no paths"`.
  3. For each `p in P`: `beforeOid = blobOidAt(repoDir, prev.repo.head_before, p)` and
     `afterOid = blobOidAt(repoDir, next.repo.head_after, p)`. Call `p` **reverted** when
     `beforeOid === afterOid` (including the both-`null` case, meaning the file was created by A and
     deleted by B).
  4. If **every** `p` is reverted -> C3 fails, verdict contribution `REDO`.
  5. If **some but not all** are reverted -> C3 fails, verdict contribution `PARTIAL_REVERT`; the
     reverted path list goes in `evidence.revertedPaths`.
  6. Otherwise C3 passes.
- **C4_SPEC_CONTINUITY.** `next.spec_ref.path === prev.spec_ref.path` **and**
  `next.spec_ref.sha256 === prev.spec_ref.sha256`. Proves the receiving agent worked the same phase spec
  and that the spec was not mutated mid-phase. Failure alone -> contributes to `DIVERGED`.
- **C5_ARTIFACT_ATTESTATION.** For every `w in prev.artifacts_written`, there must exist an
  `r in next.artifacts_read` with `r.path === w.path` **and** `r.sha256 === w.sha256`. This is AC3's
  mechanical form. Missing paths and hash mismatches are reported separately in `evidence`
  (`unreadPaths`, `staleReads`). Failure alone -> contributes to `IGNORED`.

**Verdict label selection** (deterministic, first match wins, evaluated in this order):
1. all pass -> `CONTINUED`
2. C3 failed with the all-reverted condition -> `REDO`
3. C3 failed with the some-reverted condition -> `PARTIAL_REVERT`
4. C2 or C5 failed -> `IGNORED`
5. otherwise -> `DIVERGED`

`verifyContinuation` throws nothing except `ContinuityError` from `isAncestor`'s bad-object path; a
failing check is a returned verdict, not an exception. The **caller** maps a non-`CONTINUED` verdict to
exit `6`.

### 6.7 `src/verify/preflight.ts` -- FM1 / FM9 **[DET]**

```
export const PROVIDER_VERSION_RANGES: Readonly<Record<ProviderId, {min: string; maxExclusive: string}>>
export const TOOL_VERSION_RANGES:     Readonly<Record<"node"|"git", {min: string; maxExclusive: string}>>

export function parseSemverish(s: string): {major:number; minor:number; patch:number} | null
export function inRange(v: string, min: string, maxExclusive: string): boolean
export function checkNodeVersion(): ToolCheck
export function checkGitAvailable(repoDir: string): Promise<ToolCheck>
export function checkProviderCli(id: ProviderId): Promise<{found: boolean; version: string | null}>
export function checkProviderAuth(id: ProviderId): Promise<{authenticated: boolean; detail: string}>
export function runPreflight(repoDir: string): Promise<PreflightSummary>
```

`parseSemverish` must extract the first `MAJOR.MINOR.PATCH` triple from an arbitrary version banner --
`claude --version` emits `2.1.211 (Claude Code)` and `codex --version` emits `codex-cli 0.128.0`, both
observed locally. A parser that assumes the whole string is a semver will fail on both.

**`checkProviderAuth` -- exact, locally verified contracts. Do not substitute other commands.**

- `claude-code`: run `claude auth status`. Authenticated iff `exitCode === 0` **and**
  `JSON.parse(stdout).loggedIn === true`. Observed stdout on a healthy machine includes `loggedIn`,
  `authMethod`, `apiProvider`, `subscriptionType`. A stdout that does not parse as JSON is
  *unauthenticated with detail "unrecognised auth status output"*, not a crash.
- `codex-cli`: run `codex login status`. Authenticated iff `exitCode === 0`. **Key on the exit code
  only** -- the unauthenticated case (`exit 1`, stdout `Not logged in`) was verified locally, but the
  authenticated stdout shape was not observable and must not be assumed. If `exitCode !== 0`, accept a
  non-empty `CODEX_API_KEY` **or** `OPENAI_API_KEY` in `process.env` as a satisfying BYOA path, with
  `detail: "authenticated via API key env var"`.

**Boundary-critical [DET]:** `runPreflight` and every function it calls **never** invoke
`claude auth login`, `claude setup-token`, `codex login` (without `status`), or any command that could
open a browser. Boundary rule B6 greps for exactly this. Preflight *observes* credential state; it never
establishes it. On failure it prints the remediation command as **text for the operator to run**, and
exits `3`.

`runPreflight` returns `PreflightSummary { node, git, providers: readonly PreflightReport[], ok:
boolean, problems: readonly string[] }` and always probes **both** providers even if the first fails, so
one `doctor` run reports every problem.

### 6.8 `src/verify/boundary-rules.ts` and `src/verify/boundary.ts` -- §5.1 **[DET]**

`boundary-rules.ts` exports a single frozen array:

```
export interface BoundaryRule {
  readonly id: "B1"|"B2"|"B3"|"B4"|"B5"|"B6"|"B7"|"B8";
  readonly description: string;
  readonly kind: "source-pattern" | "manifest";
  readonly pattern?: RegExp;                 // for kind === "source-pattern"
  readonly exitCode: 7 | 9;
}
export const BOUNDARY_RULES: readonly BoundaryRule[]
```

```
export interface BoundaryViolation {
  readonly rule: BoundaryRule["id"]; readonly file: string;
  readonly line: number; readonly excerpt: string;
}
export function scanBoundary(repoRoot: string): Promise<readonly BoundaryViolation[]>
```

`scanBoundary` logic:
1. Enumerate `src/**/*.ts` via `fs.readdir` recursion (no glob dependency).
2. **Exclusions, exact and non-negotiable:** any file matching `*.test.ts` (tests must contain the
   forbidden literals as fixtures) and the file `src/verify/boundary-rules.ts` itself (it contains every
   forbidden pattern by construction). Any other exclusion is a defect.
3. For each remaining file, read UTF-8 and evaluate every `source-pattern` rule line by line. Strip
   `//`-style line comments before matching for rules **B4 only** (a documentation URL in a comment is
   not a violation); all other rules match the raw line.
4. Evaluate the `manifest` rules (B2) against parsed `package.json`.
5. Return every violation found. **Do not stop at the first.**

The rule table (this is the normative list; `boundary-rules.ts` must encode exactly these):

| ID | Kind | Pattern / condition | Exit |
|---|---|---|---|
| B1 | source-pattern | `/traycer/i` | 7 |
| B2 | manifest | `package.json.dependencies` has any key other than `zod` | 7 |
| B3 | source-pattern | `/\bfrom\s+["']node:(http\|https\|net\|tls)["']\|\brequire\(["']node:(http\|https\|net\|tls)["']\|\bfrom\s+["'](undici\|axios\|got\|node-fetch)["']\|(?<![.\w])fetch\s*\(\|XMLHttpRequest/` | 7 |
| B4 | source-pattern | `/https?:\/\//` (after stripping `//` line comments) | 7 |
| B5 | source-pattern | `/\bfrom\s+["'](open\|opn\|openurl\|open-cli)["']\|\bxdg-open\b\|\brundll32\s+url\.dll\|["']start["']\s*,/` | 7 |
| B6 | source-pattern | `/claude["'\s,\]]+auth["'\s,\]]+login\|claude["'\s,\]]+setup-token\|codex["'\s,\]]+login(?!["'\s,\]]+status)\|codex["'\s,\]]+auth/` | 7 |
| B7 | source-pattern | `/claude-(opus\|sonnet\|haiku\|fable)\|\bgpt-5[\w.-]*\|\bo[34](-mini)?\b\|["'](opus\|sonnet\|haiku\|fable)["']/` -- **applied only to files not under `src/adapters/`** | 9 |
| B8 | source-pattern | `/Co-Authored-By:\s*Claude\|Co-authored-by:\s*Codex\|Generated with \[?Claude Code\|Generated with Codex/i` | 7 |

Note on B4: it will fire on a URL written into a string in `src/`. That is intended -- multi-loopr makes
zero network calls (PRD §7 I3), so a URL literal in source has no legitimate use. Documentation URLs
belong in comments or in `docs/`.

Note on B7's exclusion: `src/adapters/` does not exist in Phase 1. The exclusion is written now so that
Phase 2 does not need to modify the scanner, and so the reviewer can confirm the seam exists before it
is used.

### 6.9 `src/verify/commits.ts` -- I4 **[DET]**

```
export const ATTRIBUTION_PATTERNS: readonly RegExp[]
export interface NeutralityResult { readonly clean: boolean;
                                    readonly offenders: readonly {oid: string; matched: string}[] }
export function checkCommitNeutrality(repoDir: string, oids: readonly string[]): Promise<NeutralityResult>
export function assertNeutralCommits(repoDir: string, oids: readonly string[]): Promise<void>
```

`ATTRIBUTION_PATTERNS` covers, at minimum: `/^Co-Authored-By:\s*Claude/im`,
`/^Co-authored-by:\s*Codex/im`, `/Generated with \[?Claude Code/i`, `/Generated with Codex/i`,
`/🤖 Generated with/`.

`checkCommitNeutrality` fetches each message via `commitMessages()` and tests every pattern.
`assertNeutralCommits` throws `BoundaryViolationError` (exit `7`) listing the offending OIDs when not
clean. Per PRD §7 I2 this deterministic check -- not any provider setting -- is the load-bearing
mechanism, because a `commit_attribution` config key for Codex is `[UNVERIFIED]`.

### 6.10 `src/cli/doctor.ts`

```
export interface DoctorOptions { readonly json: boolean; readonly only: "all"|"boundary"|"providers"; }
export function runDoctor(repoRoot: string, opts: DoctorOptions): Promise<{report: DoctorReport; exitCode: number}>
```

Order of operations for `only === "all"`:
1. `checkNodeVersion()` and `checkGitAvailable()`.
2. `scanBoundary(repoRoot)`.
3. `runPreflight(repoRoot)` -- both providers, always both.
4. Lock smoke test: `acquireRunLock` with a throwaway UUID into a temp subdirectory, then
   `releaseRunLock`. Records `acquirable`. A `LockHeldError` here is reported, not thrown.
5. Assemble `DoctorReport`, redact per §4.2, compute `exitCode` per §4.3 precedence.

`runDoctor` **returns** the exit code; it never calls `process.exit`. Only `main.ts` exits.

### 6.11 `src/cli/main.ts`

```
export async function main(argv: readonly string[]): Promise<number>
```
1. Parse `argv.slice(2)` by hand. Recognise exactly the forms in §4.1; anything else -> `UsageError`.
2. Dispatch. `--version` reads the version by importing `package.json` with
   `import pkg from "../../package.json" with { type: "json" }`.
3. Wrap the dispatch in try/catch. `MultiLooprError` -> print `err.message` to stderr, return
   `err.exitCode`. Anything else -> print the stack to stderr, return `ExitCode.INTERNAL`.
4. The module's entry guard calls `main(process.argv).then(c => { process.exitCode = c; })`. Use
   `process.exitCode` rather than `process.exit()` so buffered stdout is flushed before the process ends
   -- calling `process.exit()` after a large `--json` write can truncate it.
5. The file begins with the shebang `#!/usr/bin/env node`.

---

## §7 Failure-Mode Guards

For each PRD §9 failure mode reachable in Phase 1: the guard, and the **exact check the review agent
performs**. A guard that exists but has no test is not implemented.

| FM | Guard in Phase 1 | Reviewer check (mechanical) |
|---|---|---|
| **FM1** credential expiry/absence | `checkProviderAuth()` (§6.7): `claude auth status` -> exit 0 **and** `loggedIn === true`; `codex login status` -> exit 0, else `CODEX_API_KEY`/`OPENAI_API_KEY`. Failure -> exit `3` with a printed remediation command. | 1. Grep `src/verify/preflight.ts` for the literal strings `auth status` and `login status`. 2. Confirm **no** source file matches boundary rule B6. 3. Confirm `src/verify/preflight.test.ts` covers: authed, not-authed, CLI-absent (ENOENT), and non-JSON stdout. 4. Confirm the claude predicate checks `loggedIn`, not merely exit code. |
| **FM2** isolation leak | `FORBIDDEN_RELAY_KEY_PATTERN` + `assertNoTranscriptFields()` run **before** zod parsing; `HandoffRecord` built with `z.strictObject`; `work_done` capped at 4000 chars. | 1. Confirm `parseHandoffRecord` calls `assertNoTranscriptFields` **before** `safeParse` (read the function body; order is load-bearing). 2. Grep `src/domain/relay.ts` for `z.object(` -- any hit fails. 3. Confirm the denylist walk is recursive and depth-capped. 4. Confirm a test asserts `IsolationLeakError` (exit `5`) for a nested `{ meta: { transcript: "..." } }`, not just a top-level key. |
| **FM3** silent redo | `verifyContinuation()` (§6.6): five checks, strict-AND, no short-circuit. | 1. Confirm all five `CONTINUITY_CHECKS` ids appear in the returned `checks` array on **every** path, including early-failure paths. 2. Confirm C3 uses blob-OID comparison via `git rev-parse <oid>:<path>` and not a textual diff. 3. Confirm `isAncestor` maps git exit `128` to a thrown `ContinuityError`, not to `false`. 4. Confirm `continuity.test.ts` builds **real** git fixture repos and covers all five verdict labels. |
| **FM4** model-tier welding | Boundary rule B7, exit `9`; `src/domain/tiers.ts` contains no provider mapping; `RoleDefinition.tier` is `ModelTier`. | 1. Run `node src/cli/main.ts doctor --boundary`; expect exit `0`. 2. Grep `src/domain/` and `src/ports/` for `opus\|sonnet\|haiku\|fable\|gpt-5\|effort` -- the only permitted hit is the `resolveEffort` **method name** in `src/ports/provider-adapter.ts`. 3. Confirm `roles.test.ts` asserts every `ROLE_REGISTRY` entry's `tier` is a member of `MODEL_TIERS`. |
| **FM5** relay schema drift | `schema_version: z.literal(1)`; dedicated pre-zod version check -> `RelaySchemaError` (exit `4`); round-trip test. | 1. Confirm feeding `{...valid, schema_version: 2}` throws `RelaySchemaError` whose `details` names both found and expected versions. 2. Confirm `serialiseHandoffRecord` -> `parseHandoffRecord` deep-equals the original. 3. Confirm **no** `schema_version >= 1` range check and no migration function exists (§5). |
| **FM6** concurrent write collision | `acquireRunLock` via `fs.open(path, "wx")`; live-pid detection; stale reclaim with exactly one retry. | 1. Grep `src/util/lock.ts` for `existsSync` or `access` used before the open -- any check-then-act pattern fails. 2. Confirm the open flag is the literal `"wx"`. 3. Confirm `lock.test.ts` covers: acquire, second acquire -> `LockHeldError` exit `8`, stale (dead pid) reclaim, corrupt-lock reclaim, cross-run release rejection. |
| **FM7** silent interactive fallback | `runProcess` closes stdin immediately when no payload (§6.1 step 2); mandatory `timeoutMs` with SIGTERM->SIGKILL escalation; `shell: false`. | 1. Grep `src/util/exec.ts` for `stdio` and confirm `"pipe"` for stdin -- `"inherit"` anywhere fails. 2. Confirm `timeoutMs` is a **required** field of `RunProcessOptions` (not optional, no default). 3. Confirm `shell: false` is passed explicitly. 4. Confirm a timed-out result sets `timedOut: true` and is never treated as success. |
| **FM9** provider version drift | `PROVIDER_VERSION_RANGES` + `parseSemverish` + `inRange`; out-of-range -> exit `3` printing observed and required. | 1. Confirm `parseSemverish` has tests for the two **observed real banners**: `2.1.211 (Claude Code)` and `codex-cli 0.128.0`. 2. Confirm ranges are declared in exactly one place. 3. Confirm no code path invokes `claude update`, `codex update`, or `npm i -g` -- multi-loopr never auto-updates a provider. |
| **HARD BOUNDARY** (PRD §5.1) | `scanBoundary()` implementing B1--B8 (§6.8), wired into `npm run check`. | 1. Confirm all eight rules exist in `BOUNDARY_RULES` with the ids `B1`..`B8`. 2. Confirm `boundary.test.ts` has a **positive** fixture (rule fires) and a **negative** fixture (rule silent) for each of the eight. 3. Confirm the only scan exclusions are `*.test.ts` and `boundary-rules.ts`. 4. Confirm B7 maps to exit `9` and the rest to `7`, and that `7` outranks `9` when both fire. 5. Run `npm run check`; expect exit `0`. |
| **I4** neutral commits | `assertNeutralCommits()` (§6.9). | 1. Confirm the patterns include both providers' trailers and the `🤖 Generated with` form. 2. Confirm **no** source file matches boundary rule B8. 3. Confirm the check reads real commit messages via `git show -s --format=%B`, not a cached string. |

---

## §8 Phase Acceptance Criteria

Phase 1 is approved only when **every** item below is objectively true. Each is a command with an
expected exit code or an inspectable fact. No item is satisfied by an agent asserting it.

**Toolchain**
1. `npm ci` completes with exit `0` and `node_modules` contains exactly `zod`, `typescript`,
   `@types/node`, and their transitive dependencies.
2. `npm run typecheck` exits `0` with **zero** diagnostics.
3. `tsconfig.json` byte-matches §2.2. `package.json` matches §2.1 in every field listed there.
4. `npm run test` exits `0`. No test is skipped, `todo`, or commented out.
5. No `dist/`, no build script, no bundler config, no transpiler, no test-runner dependency exists.

**Static discipline**
6. `node src/cli/main.ts doctor --boundary` exits `0`.
7. `npm run check` exits `0`.
8. `node:child_process` is imported in exactly one file: `src/util/exec.ts`.
9. `z.object(` appears nowhere under `src/domain/`; every object schema uses `z.strictObject`.
10. `z.string().datetime(` appears nowhere -- the codebase uses `z.iso.datetime()` (the zod v4 spelling).
11. The token `any` does not appear as a type annotation under `src/**` except at a boundary-parse site
    that is immediately narrowed by a zod schema on the next statement.
12. `enum `, `namespace `, and constructor parameter properties appear nowhere (they would violate
    `erasableSyntaxOnly` and break Node's type stripping).

**Behaviour**
13. `node src/cli/main.ts --version` prints the version and exits `0`.
14. `node src/cli/main.ts --help` prints usage to **stdout** and exits `0`.
15. `node src/cli/main.ts frobnicate` prints to **stderr** and exits `2`.
16. `node src/cli/main.ts doctor --boundary --providers` exits `2` (mutually exclusive).
17. `node src/cli/main.ts doctor --json` emits a single JSON object on stdout that parses and satisfies
    the `DoctorReport` schema, with `providers.length === 2`.
18. On this machine (Claude Code authenticated, Codex **not** logged in), `doctor --providers` exits `3`
    and its `problems` names Codex specifically with a remediation command. This is a real,
    currently-reproducible state and is the primary live test of FM1.

**Contract coverage** (each requires at least one dedicated test)
19. `HandoffRecord` accepts a fully-populated valid record and rejects, individually: a missing required
    field; `schema_version: 2` (exit `4`); an unknown extra key; `completed_at < started_at` (R1);
    `status: "halted"` with `halt: null` (R2); `status: "completed"` with `commits: []` (R3); an absolute
    path in `artifacts_read`; a `..` traversal in `spec_ref.path`; a 41-character `GitOid`.
20. A record containing a nested transcript-shaped key throws `IsolationLeakError` (exit `5`) and the
    error message names PRD §6.4.
21. `serialiseHandoffRecord` -> `parseHandoffRecord` round-trips deep-equal.
22. `verifyContinuation` returns `CONTINUED` on a genuine-continuation fixture, and `REDO`,
    `PARTIAL_REVERT`, `IGNORED`, and `DIVERGED` on fixtures constructed for each. All five fixtures are
    **real git repositories** created in the test's temp dir, not mocked git output.
23. `verifyContinuation` returns all five `CheckResult`s on every path, and `failedCheckIds` exactly
    matches the ids whose `passed` is `false`.
24. Each of B1--B8 has a positive and a negative fixture test.
25. `acquireRunLock` twice in the same directory throws `LockHeldError` with exit `8`; a lock whose pid
    is dead is reclaimed; releasing another run's lock throws.
26. `parseSemverish` correctly parses `2.1.211 (Claude Code)` and `codex-cli 0.128.0`.
27. `assertNeutralCommits` flags a fixture commit carrying `Co-Authored-By: Claude` and passes a clean one.

**Documentation**
28. `README.md` exists, states the `engines.node` requirement, and lists the three `npm run` scripts.
    It makes no claim about functionality Phase 1 does not ship.

---

## §9 Explicit NON-GOALS

Phase 1 does **not** build the following. A pull of any item below into Phase 1 is a scope violation and
must be rejected by the review agent even if the code is correct.

**Deferred to Phase 2 (Provider adapters)**
1. Any file under `src/adapters/`. Phase 1 ships the `ProviderAdapter` **interface only**.
2. Any concrete argv construction for `claude` or `codex` (`-p`, `--append-system-prompt`,
   `codex exec`, `--sandbox workspace-write`, `-c approval_policy=...`).
3. Any `ModelTier` -> provider effort mapping. Phase 1's `tiers.ts` is deliberately mapping-free.
4. Parsing of Claude Code's `--output-format json` payload or Codex's `--json` JSONL event stream.
5. Any `AdapterRegistry` value.

**Deferred to Phase 3 (Sequential dispatch engine)**
6. The turn loop, the `run` CLI command, and any code that actually spawns a provider CLI. Phase 1's
   `runProcess` is exercised only against `git`, `node`, and the two providers' `--version`/auth probes.
7. Writing `HandoffRecord` files during a real run, lock acquisition around a real turn, halt-signal
   propagation, retry-on-failed-verdict logic.
8. Turn-level prompt assembly and role-profile injection.

**Deferred to Phase 4 (loopr artifact integration)**
9. Producing, rendering, or reading `baby_prd.md`, `context.md`, or `PHASE_N_SPEC.md`. Phase 1 models
   them only as opaque `FileRef`s inside `spec_ref` / `artifacts_read` / `artifacts_written`.

**Deferred to Phase 5 (Acceptance harness)**
10. The toy build task, end-to-end AC1/AC2/AC3 evidence collection, and open-source packaging
    (`npm publish` config, LICENSE beyond the manifest field, CONTRIBUTING, CI workflow).

**Out of V1 entirely (PRD §3) -- never build these**
11. A third provider, or any provider-selection/routing logic beyond the fixed ordered pair.
12. Cost, token, or budget tracking. Do not read `total_cost_usd` or Codex's `usage` object even though
    both are available.
13. The AUDITOR archetype's dispatch path. `ROLE_REGISTRY` records it with
    `instantiatedInV1: false`; nothing may consume it.
14. The RESEARCHER archetype's dispatch path, same treatment.
15. Any indexing, embedding, knowledge-graph, or retrieval layer.
16. Any GUI, TUI, web server, or HTTP endpoint.
17. Concurrent or parallel agent execution, or any asynchronous inter-agent messaging (PRD §3.8).
18. Anything that would trip boundary rules B1--B8 (PRD §5.1) -- permanently, in every phase.

**Explicitly not a Phase 1 goal even though it may look adjacent**
19. Relay schema **version 2**, any migration path, or any forward-compatibility shim (§5).
20. Structured-output-based relay extraction using Codex's `--output-schema` or Claude Code's
    `--json-schema`. PRD §9 FM5 rejects this approach for V1; the record is a file the agent writes and
    multi-loopr validates.
21. Claude Code's `--bare` mode, in any phase, without an explicit escalation (PRD §9 FM8).
22. Logging frameworks, telemetry, metrics, or crash reporting. Phase 1 writes to stdout/stderr only.

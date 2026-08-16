# multi-loopr -- Product Requirements Document

**Status:** MODERNISED (Step 10 pass, 2026-08-16). This is the single canonical PRD. The pre-modernization
seed was assembled from the confirmed loopr interrogation (`.claude/loopr/baby_prd.md`,
`.claude/loopr/context.md`); this revision grounds it in verified external reality, resolves the open
questions the seed flagged, and is the reference the automated phase loop verifies against.

**Verification key used throughout:**
- `[VERIFIED-LOCAL]` -- confirmed by executing the tool on this machine; the command and observed output are named.
- `[VERIFIED-DOC]` -- confirmed against the vendor's current official documentation; URL inline.
- `[VERIFIED-REGISTRY]` -- confirmed against the npm registry via `npm view <pkg> version` on 2026-08-16.
- `[UNVERIFIED]` -- could not be traced to a primary source; what was searched is stated.

---

## 1. Problem statement

I want to be able to complete a spec-disciplined build that spans two different AI coding providers --
without losing context, discipline, or continuity when work hands off from one to the other, and
without depending on a closed or hosted orchestrator to make that handoff work. That becomes true for
the operator first, as the person running it day to day, and -- once open-sourced -- for any other
Claude Code / Codex user who wants multi-provider spec discipline on their own machine instead of
inside someone else's platform.

Current best guess at how: a local harness where Claude Code and Codex CLI run loopr's discipline
together end to end, one starting a phase and the other continuing it.

## 2. Acceptance criteria (V1)

1. Run a single toy build task through multi-loopr V1 end to end: Claude Code starts a
   loopr-disciplined phase, hands off, and Codex CLI picks it up and continues it on the same repo --
   observable as two agents' commits on one git history where the second's work demonstrably builds on
   the first's (not a redo, not ignoring it).
2. The entire run completes with zero browser/interactive prompts after initial credential setup --
   observable as a scripted run producing exit 0 with no human interaction mid-run.
3. loopr's own phase artifacts (`baby_prd.md`, `context.md`, `PHASE_N_SPEC.md`) are genuinely produced
   and read by both agents during the run, not bypassed -- observable by diffing what each agent
   actually referenced against what it was handed.

**Modernization note on AC1.** "Demonstrably builds on" was the one criterion the loopr judge flagged as
carrying interpretive judgment. Step 10 removes that judgment by defining it as a deterministic,
five-part git+hash predicate (§9, `ContinuityVerdict`). AC1 is now mechanically checkable, in line with
the §7 determinism invariant. This is a tightening of the criterion's *measurement*, not a change to the
criterion itself.

## 3. Scope

### Out of scope / deferred (V1)

1. More than two providers (deferred) -- V1 proves the premise with exactly two; N-provider routing is
   a different, harder problem not worth solving before two works.
2. Sophisticated routing/model-selection logic (deferred) -- V1 is a fixed Claude Code <-> Codex CLI
   pairing, no dynamic provider choice.
3. Cost optimization or budget enforcement (out) -- no token/spend tracking or budget gating in V1.
   (Note: both CLIs expose spend surfaces -- Claude Code's `--output-format json` payload carries
   `total_cost_usd` and it accepts `--max-budget-usd`; Codex's `turn.completed` JSONL event carries a
   `usage` object. V1 deliberately does not consume either. [VERIFIED-DOC]
   https://code.claude.com/docs/en/headless , https://learn.chatgpt.com/docs/non-interactive-mode)
4. The V2 auditor subagent + severity/confidence escalation tier (deferred) -- V1 runs loopr's core
   discipline without it.
5. Indexing, knowledge graphs, or any retrieval layer (out) -- context relay is file-based handoff
   artifacts only, not a search/retrieval system.
6. A GUI (out) -- CLI/headless only.
7. Traycer, or any hosted/closed orchestrator dependency (out, PERMANENTLY -- an architectural
   rejection made before this build started, not a V2 deferral; see §5).
8. **Concurrent/parallel agent execution (out, V1).** V1's handoff model is strictly sequential, one
   agent active at a time, enforced by an exclusive on-disk lock (§9, FM6). Asynchronous mid-execution
   agent-to-agent messaging is a real and measured improvement for *parallel* multi-agent code
   comprehension, but it is orthogonal to, and strictly harder than, the sequential handoff V1 exists
   to prove. See §8 for the literature note.

## 4. Locked architectural decision -- do not reopen

A two-hour spike against `traycerai/traycer` (findings: `C:\Users\hp\traycer-spike\TRAYCER_SPIKE_FINDINGS.md`)
established that Traycer's actual orchestration engine ("the Host") is a closed binary in a private
repo, not the open-source client. It offers no per-agent instruction injection (no exposed system-prompt
field), and its agent-to-agent context sharing is gated to GUI agents plus Claude Code TUI only --
Codex and other TUI harnesses have no inbox transport at all, which is exactly the multi-provider case
multi-loopr exists to serve.

DECISION: multi-loopr owns its own orchestration. It spawns and manages agents directly, owns
role-profile injection, and owns the context relay. It does not depend on Traycer or any other closed
orchestrator. This is a permanent rejection, not revisited in V2.

**Step 10 corroboration (not a reopening).** The two capabilities the spike found missing in Traycer are
both natively available in the provider CLIs multi-loopr drives directly, which is what makes owning the
orchestration cheap rather than expensive:

- *Per-agent instruction injection.* Claude Code exposes `--append-system-prompt`,
  `--append-system-prompt-file`, `--system-prompt`, and `--system-prompt-file` in print mode.
  [VERIFIED-LOCAL] `claude --help` on Claude Code 2.1.211 lists `--append-system-prompt <prompt>` and
  `--system-prompt <prompt>`. [VERIFIED-DOC] https://code.claude.com/docs/en/cli-reference
  Codex CLI has no system-prompt flag; role-profile injection for Codex is done by composing the role
  profile into the `codex exec` prompt payload (prompt argument or piped stdin). [VERIFIED-LOCAL]
  `codex exec --help` on codex-cli 0.128.0 exposes no system-prompt flag; `[PROMPT]` is documented as
  "read from stdin" when omitted or `-`.
- *A transport that works for both.* Files on the operator's own disk plus each CLI's own working
  directory. No inbox, no broker, no network hop.

## 5. Boundary (confirmed)

multi-loopr V1 covers: a local, headless harness that runs loopr's spec discipline across exactly two
AI coding provider CLIs -- Claude Code and Codex CLI -- operating on a single repository. It includes a
file-based context relay that lets one provider's agent hand off a loopr-disciplined build phase to the
other and have it genuinely continue that work (not restart it, not ignore it), verifiable via git
commit history and loopr's own rendered phase artifacts actually being produced and referenced by both
agents. It runs entirely on the operator's own machine against their own repo, using each provider's
own existing (BYOA) credentials/subscriptions, with no hosted account, no proxying or reselling of
provider access, and no interactive/browser step required mid-run once credentials are set up once.

It explicitly does NOT cover: routing/selecting among more than two providers; sophisticated
model-selection logic; cost optimization or budget enforcement/tracking; the V2 auditor subagent and
its severity/confidence-based escalation tier; indexing, knowledge graphs, or any retrieval layer; a
GUI. It also does not, and will not, depend on Traycer or any other hosted/closed orchestrator.

### PROJECT HARD BOUNDARY

No hosted, closed, or third-party orchestration dependency. multi-loopr must never require a hosted
account, a proxied or resold provider credential, a closed/signed-binary orchestration engine, or any
network dependency beyond each provider's own official CLI/API used under the operator's own BYOA
credentials. Code VIOLATES this boundary if it: imports or shells out to a Traycer client/SDK/CLI;
requires an interactive browser OAuth flow at any point in the normal (post-setup) run path;
introduces a hosted multi-loopr service, account, or API key multi-loopr itself issues or brokers; or
proxies/resells a provider's own credentials rather than using the operator's ambient CLI login or API
key directly.

**The boundary outranks modernization.** Any enhancement this or a later research pass surfaces that
touches the boundary is auto-rejected, not applied.

#### 5.1 Mechanised boundary rules (deterministic, greppable)

The boundary is enforced by executable code, not by reviewer goodwill. `multi-loopr doctor --boundary`
(Phase 1) scans `src/**` and `package.json` and exits `7` on any hit. The complete Phase 1 ruleset is
specified in `PHASE_1_SPEC.md` §7. In summary, the following are boundary violations:

| ID | Rule | Rationale |
|----|------|-----------|
| B1 | Any case-insensitive occurrence of `traycer` in `src/**` or in `package.json` dependencies | §4 locked rejection |
| B2 | Any runtime `dependencies` entry in `package.json` outside the allowlist (`zod` only in V1) | Prevents a hosted/closed orchestration SDK entering by the side door |
| B3 | Any import of `node:http`, `node:https`, `node:net`, `node:tls`, `undici`, `axios`, `got`, `node-fetch`, or any call to global `fetch(` / `XMLHttpRequest` in `src/**` | multi-loopr itself makes **zero** network calls. All network access belongs to the provider CLIs, under the operator's own credentials. |
| B4 | Any `http://` or `https://` string literal in `src/**` (comments and `*.md` excluded) | Same as B3; catches a URL smuggled into a spawn argument |
| B5 | Any import of `open`, `opn`, `openurl`, `open-cli`, or a spawn of `start` / `xdg-open` / `rundll32 url.dll` | An interactive browser flow in the run path is a boundary violation (§5) |
| B6 | Any invocation of `claude auth login`, `claude setup-token`, `codex login` (without `status`), or `codex auth` from `src/**` | multi-loopr never performs or triggers credential setup; it only *observes* credential state |
| B7 | Any concrete provider model-name literal (`claude-opus*`, `claude-sonnet*`, `claude-haiku*`, `claude-fable*`, `gpt-5*`, `o3*`, `o4*`) or bare tier alias string (`"opus"`, `"sonnet"`, `"haiku"`, `"fable"`) anywhere outside `src/adapters/**` | FM4, §6 portability constraint |
| B8 | Any commit-attribution string (`Co-Authored-By: Claude`, `Co-authored-by: Codex`, `Generated with [Claude Code]`, `Generated with Codex`) in a commit-message template under `src/**` | §7 neutral-commits invariant |

## 6. Archetypes (confirmed soft context)

The canonical five-archetype set for this build (supersedes any earlier 3- or 4-archetype notion):

1. **ARCHITECT/CONTROLLER/DISPATCHER** -- the persistent main session. Owns the spec chain and scratch
   files, routes escalations, dispatches every other archetype. A router, not an adjudicator. Operator
   -controlled, always the same provider/session -- not swapped across providers.
2. **RESEARCHER/PLANNER (Step 10)** -- PRD modernization: verifies real versions/API signatures against
   current docs, escalates contradictions rather than silently resolving them. Model floor is
   non-negotiable and structural. Does research/verification only -- does not own the spec chain, does
   not overrule a locked architectural decision, escalates to the human instead.
3. **EXECUTOR** -- writes code against the spec it's given. Highest output volume; checked immediately
   downstream, which is why a low-effort tier is correct for it.
4. **REVIEWER** -- verifies phase output against phase spec, generates the next phase spec. High
   verification effort is non-negotiable -- it IS the check. ISOLATION RULE: receives only the phase
   spec and the diff, never the executor's conversation/reasoning/justifications. It flags, never
   overrules; the architect adjudicates.
5. **AUDITOR** -- on-demand only, dispatched by the architect (never self-escalated by the reviewer)
   when the reviewer halts, or when an item touches a correctness-critical path regardless of
   confidence. Context-scoped to only the flagged items, their referenced spec clauses, and their
   referenced code. Out of scope for V1 entirely (§3.4).

### 6.1 Portability constraint (load-bearing)

Archetype roles, escalation chain, isolation rules, dispatch gating, and model tiering must live in a
host-agnostic layer, with the actual spawning mechanism (Claude Code subagent, Codex CLI invocation,
etc.) behind an adapter. A port to a new provider must be a mechanism swap, not a redesign. Model tiers
must NOT be recorded as concrete Anthropic/OpenAI model names directly on role definitions -- that welds
roles to mechanism the same way an unabstracted spawn call would. Record tier as an abstract property,
with each provider's adapter mapping that to its own concrete setting.

### 6.2 RESOLVED (Step 10): tier maps to *effort*, not to a model name

Modernization finding: concrete model identifiers are the single most volatile string in this system,
and both vendors' own docs used different example model strings within the same doc set during this pass
(`gpt-5.6` in the config-basic page, `gpt-5.5` in the config-reference page --
[VERIFIED-DOC] https://learn.chatgpt.com/docs/config-file/config-basic ,
https://learn.chatgpt.com/docs/config-file/config-reference ). Pinning a model name would guarantee
staleness and would weld the role layer to mechanism.

Both providers, by contrast, expose a **stable, enumerated effort/reasoning axis**:

| Provider | Setting | Allowed values | Source |
|---|---|---|---|
| Claude Code | `--effort <level>` | `low`, `medium`, `high`, `xhigh`, `max` | [VERIFIED-LOCAL] `claude --help`, v2.1.211. The published CLI reference additionally lists `ultracode`; treat any value not present in the locally installed binary's help output as unavailable. [VERIFIED-DOC] https://code.claude.com/docs/en/cli-reference |
| Codex CLI | `model_reasoning_effort` (via `-c`) | `minimal`, `low`, `medium`, `high`, `xhigh` | [VERIFIED-DOC] https://learn.chatgpt.com/docs/config-file/config-reference |

**DECISION.** `ModelTier` is an abstract enum with exactly three members --
`research-grade`, `verification-grade`, `high-volume-low-effort` -- attached to role definitions in the
host-agnostic layer. Each adapter maps tier to that provider's *effort* value. Model *selection* is
delegated to the provider CLI's own configured default unless the operator explicitly overrides it in
the run config; multi-loopr never hardcodes a model name. Rule B7 (§5.1) makes this mechanically
enforceable.

### 6.3 RESOLVED (Step 10): which archetypes cross-provider-dispatch in V1

**DECISION.** V1 cross-provider-dispatches the **EXECUTOR archetype only**.

- ARCHITECT stays fixed as the operator's own persistent session (per §6.1 soft context) and is not
  dispatched by multi-loopr at all in V1.
- RESEARCHER/PLANNER is **not instantiated** in V1. Step 10 is run by the operator's architect session,
  as it is being run now.
- EXECUTOR is dispatched through the adapter to *both* providers within a single phase. This is the
  handoff AC1 measures.
- REVIEWER **is** instantiated in V1 and **is** dispatched through the same `ProviderAdapter` port, but
  its provider is a run-config parameter rather than a fixed cross-provider swap. Default: the reviewer
  runs on whichever provider did *not* produce the diff under review, which satisfies the §6.4 isolation
  rule at the process level as well as the payload level (a separate process cannot inherit the
  executor's conversation because it never had it). Because it already goes through the port, crossing
  it deliberately in V2 is a config change, not a redesign.
- AUDITOR remains fully out of V1 (§3.4).

Rationale: AC1 describes an executor-shaped handoff. Adding a mandatory reviewer crossing would add an
axis of variation without adding evidence for any acceptance criterion, while the port-based dispatch
keeps the portability constraint honoured.

## 7. Universal invariants

These bind both the modernised PRD and every phase spec. A phase that violates one is rejected
regardless of whether its own acceptance criteria pass.

### I1 -- Stack and type-safety discipline

**RESOLVED (Step 10):** multi-loopr is implemented in **TypeScript on Node.js**, run directly by Node's
native type stripping with **no build step**.

*Why this stack.* The seed PRD's constraint was that the harness must not impose a new heavy toolchain
beyond what BYOA use of the two provider CLIs already implies. Both provider CLIs are published to npm --
`@anthropic-ai/claude-code` (latest `2.1.233`, stable tag `2.1.224`) and `@openai/codex` (latest
`0.147.0`) [VERIFIED-REGISTRY] `npm view <pkg> version dist-tags`, 2026-08-16 -- and npm/`npx` is the
documented primary install path for both, so Node is the least-surprising runtime for the target
audience and `npx multi-loopr` matches how they already install these tools. Caveat, stated honestly:
both vendors *also* ship native standalone binaries (`claude install` exists as a subcommand
[VERIFIED-LOCAL] `claude --help`; `@openai/codex` publishes per-platform binary dist-tags such as
`0.147.0-linux-x64` [VERIFIED-REGISTRY]), so a Node runtime is *likely* but not *guaranteed* on an
operator's machine. Mitigation: declare `engines.node` and fail preflight with an actionable message
(§9, FM1) rather than assume.

*Verified toolchain* -- every element below was executed on this machine during the Step 10 pass:

| Element | Pin | Verification |
|---|---|---|
| Node.js | `>=24.0.0` (Active LTS "Krypton") | [VERIFIED-LOCAL] `node --version` -> `v24.15.0`. [VERIFIED-DOC] https://nodejs.org/en/about/previous-releases -- v24 is LTS; v20 is EOL; v22 is maintenance |
| TypeScript | `7.0.2` (dev dependency, type-check only) | [VERIFIED-REGISTRY] `npm view typescript version` -> `7.0.2`. [VERIFIED-LOCAL] installed and `tsc --noEmit` run to exit 0 against a probe using the exact tsconfig in `PHASE_1_SPEC.md` §2 |
| `@types/node` | `26.2.0` | [VERIFIED-REGISTRY] |
| zod | `4.4.3` -- **the only runtime dependency** | [VERIFIED-REGISTRY]; [VERIFIED-LOCAL] `.strict()` object rejection type-checks and runs under the pinned tsconfig |
| Test runner | Node built-in `node:test` -- zero dependency | [VERIFIED-LOCAL] `node --test "src/**/*.test.ts"` ran a zod `.strict()` assertion to exit 0 with no transpiler, no vitest, no tsx |
| Build step | **None.** Node executes `.ts` directly via type stripping | [VERIFIED-LOCAL] `node src/a.ts` printed correct output on v24.15.0 |

*Type-safety invariant (the mypy --strict equivalent).* `tsc --noEmit` must exit 0 with, at minimum,
`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`,
`noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`, `verbatimModuleSyntax: true`,
`erasableSyntaxOnly: true`, `isolatedModules: true`. `erasableSyntaxOnly` is not optional: without it a
developer can write `enum` or parameter properties, which Node's type stripping cannot execute, and the
no-build-step property silently breaks. The `any` type is banned in `src/**` outside explicitly
annotated boundary-parsing sites, which must immediately narrow via a zod schema.

TypeScript 7.0.2 is one month old at time of writing (released 2026-07-08, RC 2026-06-18) and makes
`strict` the default while turning several deprecated flags into hard errors [VERIFIED-DOC]
https://www.infoq.com/news/2026/08/typescript-7-released/ . Risk is contained because (a) multi-loopr
uses only the `tsc` CLI for `--noEmit` checking and never the programmatic API (which is documented as
not stable until 7.1), (b) there is no bundler or transpiler in the dependency graph to be incompatible
with it, and (c) the tsconfig in `PHASE_1_SPEC.md` §2 sets every relevant flag explicitly rather than
relying on any 7.0 default.

### I2 -- Determinism where it matters

Every correctness-critical claim multi-loopr makes is decided by deterministic code operating on git
object identity and content hashes. **No LLM self-report, no agent's say-so, and no LLM-as-judge is
permitted anywhere in the verification path.** Specifically:

- **AC1 continuity** is decided by `verifyContinuation()` -- five git/hash predicates, `ContinuityVerdict`,
  specified in §9 and `PHASE_1_SPEC.md` §6.
- **AC3 artifact attestation** is decided by SHA-256 comparison between what a turn recorded as written
  and what the next turn recorded as read, not by asking an agent whether it read the file.
- **AC2 non-interactivity** is decided by process exit code plus the absence of a TTY on the child's
  stdin, not by observation.
- **The hard boundary** (§5.1) is decided by a static scanner, not by review judgment.
- **Neutral commits** are decided by `assertNeutralCommits()` scanning the commit range a turn produced
  for attribution trailers, not by trusting a provider's attribution setting. Claude Code does expose
  `attribution: { commit: "", pr: "" }` in `settings.json` [VERIFIED-DOC]
  https://code.claude.com/docs/en/settings and adapters should set it, but that is defence in depth. A
  `commit_attribution` key for Codex is claimed by third-party blogs and is **[UNVERIFIED]** -- it does
  not appear in the official config reference (https://learn.chatgpt.com/docs/config-file/config-reference,
  searched for "commit", "attribution", "co-author"). The deterministic check is therefore the load-bearing
  mechanism and the provider setting is not.

This invariant is directly supported by the literature; see §8.

### I3 -- LLM routing: N/A

multi-loopr's providers are fixed by the confirmed boundary (Claude Code + Codex CLI, BYOA, no hosted
routing of any kind). There is no LLM-routing decision for multi-loopr's own code to make, and
multi-loopr's own code makes no LLM API calls whatsoever -- rules B3/B4 (§5.1) enforce this mechanically.

### I4 -- Commits stay neutral

No AI attribution in any commit multi-loopr or its dispatched agents produce. Enforced by
`assertNeutralCommits()` (see I2) and boundary rule B8.

### I5 -- Isolation is a payload property, not a promise

The relay record schema is closed (`.strict()`), and transcript-shaped keys are rejected with a
dedicated error before schema parsing so the failure names the isolation rule rather than surfacing as a
generic "unrecognized key". See §9 FM2.

## 8. Research grounding

**[RESEARCH FOCUS]** extracted from §1--§6: sequential multi-agent handoff between heterogeneous
autonomous coding agents; structured (non-transcript) context relay; deterministic verification of
inter-agent continuity; role/archetype abstraction with provider adapters.

### 8.1 The determinism + structured-handoff invariants are validated by current literature

**Xu, Zhang, Mitra, Hruschka, "Verification-Aware Planning for Multi-Agent Systems" (VeriMAP),
arXiv:2510.17109, 2025-10-20.** https://arxiv.org/abs/2510.17109 -- §2 (the full method section) read
during this pass, not only the abstract. VeriMAP's stated findings map onto four of multi-loopr's design
decisions:

1. *Handoff failure is the dominant failure class, and it is distinct from reasoning failure.* The paper
   states execution failures "frequently arise not from flawed reasoning alone, but from subtle
   misalignments in task interpretation, output format, or inter-agent handoffs," and that "existing
   verification rarely captures such interpretation or handoff failures." This is FM3 and FM5 named in
   the literature, and it justifies spending Phase 1 on the relay contract rather than on agent quality.
2. *Structured I/O with named variables at every handoff boundary.* VeriMAP §2.1 enforces "(i) Structured
   I/O, requiring that agent inputs and outputs adhere to well-defined formats, such as JSON objects; and
   (ii) Named Variables, requiring that each I/O object has a unique, consistent name across all nodes."
   This is exactly multi-loopr's versioned `HandoffRecord` and is the direct counter to FM5.
3. *Programmatic verification functions give the guarantee; LLM verification does not.* VeriMAP §2.1
   distinguishes "Python VFs ... Being programmatic, they provide deterministic and reproducible
   guarantees" from natural-language VFs used only "for tasks requiring semantic or open-ended
   judgments." Every multi-loopr correctness check (§I2) is in the first category and none is in the
   second. Further, VeriMAP §2.3 adopts "a strict logical AND strategy, where a subtask is marked as
   failed if any VF fails" -- adopted verbatim as multi-loopr's `ContinuityVerdict` aggregation rule
   (§9): any failing check fails the turn.
4. *Withholding upstream reasoning from the downstream agent is a deliberate, validated design, not
   merely a safety preference.* VeriMAP §2.2: "To limit scope and reduce reasoning complexity, Executors
   are not exposed to the original global task," and §2.1 notes this "allows smaller models to
   participate effectively, avoids redundant correction of upstream errors." This is the same mechanism
   as the §6.4 ISOLATION RULE and as multi-loopr's high-volume-low-effort executor tier -- the
   spec-and-diff-only payload is what makes a cheap executor tier correct rather than reckless.

**Enhancement applied within the locked architecture** on the strength of (3): the `ContinuityVerdict`
aggregation rule is now explicitly strict-AND with the failing check IDs enumerated in the verdict, so a
retry has a machine-readable failure signal rather than a boolean. Logged in the changelog.

### 8.2 Protocol classification -- multi-loopr's deliberate divergence from the field

**Sander, Gidey, Lenz, Knoll, "A Technical Taxonomy of LLM Agent Communication Protocols,"
arXiv:2606.19135, 2026-06-17.** https://arxiv.org/abs/2606.19135 -- §5 (Results: Taxonomy Design, all
five accepted dimensions and the rejected ones) read during this pass. Classifying multi-loopr's relay
on the paper's own five dimensions: counterparty = `agent`; payload = `structured data and artifacts`;
interaction state = `session state`; discovery = `static`; schema flexibility = `single`.

The paper's empirical finding across its nine-protocol sample is that "all sampled agent-to-agent
protocols combine hybrid payloads with session-state persistence," where `hybrid` payload means text is
carried alongside structure. multi-loopr deliberately diverges on exactly that axis: `structured data and
artifacts` only, never `hybrid`, because carrying free text is precisely what would let an executor's
rationalisations reach the reviewer (FM2 / §6.4). This is recorded as an intentional, argued divergence
from the prevailing pattern, not an oversight. Likewise `single` schema flexibility is intentional -- the
paper's `evolving` category (runtime schema negotiation) is a direct route to FM5 and is rejected.

### 8.3 Falsification check on the sequential-handoff premise -- no escalation

**Ren, Zang, Wang, Forder, Deb, Carroll, Guo, "AgentRadio: Passive Awareness for Long-Horizon
Multi-Agent Collaboration," arXiv:2607.28430, 2026-07-30.** https://arxiv.org/abs/2607.28430 --
**abstract only; the full text was not retrieved during this pass, and this citation is scoped
accordingly.** The abstract argues that "existing multi-agent systems support such exchange only between
phases, through staged handoffs or synchronized rounds," and reports 62.1% vs 32.3% single-agent task
resolution on SWE-Atlas QnA for four agents with asynchronous mid-execution messaging.

**Assessed: does not falsify multi-loopr V1.** The paper's claim concerns *concurrent* agents whose
subtasks are interdependent and who therefore need mid-execution correction. multi-loopr V1 is explicitly
sequential with exactly one agent active at a time (§3.8, FM6), so there is no concurrent peer to be
passively aware of. What the result does establish is that the sequential/staged model is a *ceiling*,
not an endpoint -- recorded in §3.8 as an argued V2+ direction rather than an open architecture question.
No escalation raised.

### 8.4 Null findings, stated

No paper was found that specifically addresses **heterogeneous-vendor** coding-agent handoff (one
vendor's agent CLI continuing another vendor's agent CLI's work on a shared git repo under the
operator's own credentials). Searched: arXiv `cs.MA`/`cs.AI`/`cs.SE`, 2024-01-01 onward, for
`"multi-agent" AND ("handoff" OR "context transfer" OR "agent communication protocol") AND ("LLM agents"
OR "coding agents")` (11 results, none on-point for the heterogeneous-vendor case). The prior art that
exists is either single-vendor multi-agent (Claude Code Agent Teams, cited as a baseline in
arXiv:2606.00953) or vendor-neutral protocol work (§8.2). **[UNVERIFIED]** as to whether such prior art
exists outside the searched venues. This null result is consistent with the premise in §1 that this is a
gap worth building into; it is not evidence that the approach is correct.

No relevant literature was found for the narrower question of git-commit-ancestry-based verification of
agent continuation. The design in §9 is engineering, not a reproduction of a published method, and is
labelled as such.

## 9. Failure-mode analysis (Step 10 verified and extended)

Each failure mode below now carries the deterministic detection mechanism, not only a description.
`PHASE_1_SPEC.md` §7 binds each to a specific Phase 1 guard and a specific reviewer check.

- **FM1 -- credential expiry / absence mid-run.** A provider's ambient CLI credential expires or is
  invalid during a run. Must fail loudly with a clear, actionable message; must never silently fall back
  to an interactive browser flow (would violate §5).
  *Detection, deterministic and locally verified:*
  - Claude Code: `claude auth status` exits `0` and emits machine-readable JSON on stdout. Observed shape
    on this machine: `{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty",
    "email": ..., "orgId": ..., "orgName": ..., "subscriptionType": "max"}` [VERIFIED-LOCAL].
    Preflight predicate: exit 0 **and** parsed `loggedIn === true`.
  - Codex CLI: `codex login status` exits `1` and prints `Not logged in` when unauthenticated
    [VERIFIED-LOCAL] -- this machine is currently in that state. Preflight predicate: exit 0. The
    *authenticated* stdout shape was **[UNVERIFIED]** (could not be observed on this machine), which is
    precisely why the predicate keys on exit code only. Env-var BYOA (`CODEX_API_KEY`) is accepted as an
    alternative satisfying path [VERIFIED-DOC] https://learn.chatgpt.com/docs/non-interactive-mode .
  - Escalation on failure is exit code `3` with the exact remediation command printed. multi-loopr
    **never** runs `claude auth login`, `claude setup-token`, or `codex login` itself (boundary rule B6).
- **FM2 -- isolation leak.** The relay passes an agent's raw conversation/reasoning where only a
  structured handoff should cross, violating §6.4.
  *Detection:* `HandoffRecord` is `.strict()`, and a pre-parse denylist check rejects any key matching
  `/transcript|conversation|reasoning|chain[_-]?of[_-]?thought|rationale|thinking|scratchpad|messages/i`
  with a dedicated `IsolationLeakError` (exit `5`) naming §6.4, so the failure is legible rather than a
  generic unknown-key error. Additionally, the reviewer's turn payload is assembled only from
  `spec_ref` + git diff + the previous `HandoffRecord`'s allow-listed fields -- never from provider log
  files. Validated by literature, §8.1(4).
- **FM3 -- silent redo.** A receiving agent restarts or ignores the prior agent's phase work instead of
  genuinely continuing it -- what AC1 exists to catch.
  *Detection:* `verifyContinuation(prev, next, repoDir)` -> `ContinuityVerdict`. Five checks, aggregated
  strict-AND (§8.1(3)); the verdict enumerates every failing check ID.
  - **C1 ANCESTRY** -- `git merge-base --is-ancestor <prev.repo.head_after> <next.repo.head_after>` must
    exit `0`. (Exit `1` = not an ancestor; exit `128` = bad object, which is a distinct hard error.)
    [VERIFIED-LOCAL] the `128` path was observed on this repo's empty history.
  - **C2 ADVANCEMENT** -- `next.repo.head_after !== prev.repo.head_after` and
    `next.repo.commits.length >= 1`.
  - **C3 NO-REVERT** -- let `P = git diff --name-only <prev.repo.head_before>..<prev.repo.head_after>`
    (the paths the prior agent touched). For each `p in P`, compare the blob OID of `p` at
    `prev.repo.head_before` with its blob OID at `next.repo.head_after`. If **every** `p` has reverted to
    its pre-A OID, the verdict is `REDO`. If **some** have, the verdict is `PARTIAL_REVERT` with the path
    list. This is the literal, deterministic definition of "not a redo".
  - **C4 SPEC CONTINUITY** -- `next.spec_ref.path === prev.spec_ref.path` and
    `next.spec_ref.sha256 === prev.spec_ref.sha256`. Proves B worked the same phase spec, unmodified,
    rather than starting a new phase.
  - **C5 ARTIFACT ATTESTATION** -- every entry of `prev.artifacts_written` appears in
    `next.artifacts_read` by path, with matching `sha256`. This is AC3's mechanical form.
  - Verdict is `CONTINUED` only if C1--C5 all pass; otherwise `REDO`, `PARTIAL_REVERT`, `IGNORED`, or
    `DIVERGED`, plus the failing IDs. Failure exits `6`.
- **FM4 -- model-tier welding.** A concrete model name gets hardcoded into a role definition or the
  adapter-agnostic layer instead of an abstract tier resolved per-provider (§6.1--6.2).
  *Detection:* boundary rule B7 (§5.1), exit `9`. Note the exit code is distinct from the generic
  boundary exit `7` so the reviewer can distinguish a portability regression from a hard-boundary breach.
- **FM5 -- relay schema drift.** The format the writing agent produces and the format the reading agent
  expects diverge silently.
  *Detection:* the record carries a required `schema_version` literal; the reader rejects any other value
  with `RelaySchemaVersionError` (exit `4`) rather than best-effort parsing. Round-trip property tests
  (write -> read -> deep-equal) are a Phase 1 acceptance criterion. Structurally mandated by §8.1(2).
  *Modernization note:* multi-loopr deliberately does **not** rely on either provider's native
  structured-output mode to produce the record. Codex's `--output-schema` has a reported failure mode
  where it and `--json` are "silently ignored when tools/MCP servers are active, resulting in malformed
  outputs" (openai/codex issue #15451, reported against codex-cli 0.116.0, now closed;
  https://github.com/openai/codex/issues/15451). Relying on it would make the relay contract hostage to a
  provider's structured-output implementation. Instead, the agent is instructed to **write the record to a
  known file path**, and multi-loopr validates that file deterministically -- a mechanism that is
  identical across providers and independent of any structured-output feature.
- **FM6 -- concurrent write collision.** Two agents write to the same repo concurrently. V1's model is
  sequential only; this must be enforced, not assumed.
  *Detection:* exclusive lock file created with `fs.open(path, "wx")` (fails if the file exists -- an
  atomic filesystem primitive, not a check-then-act race). Lock content records `{pid, run_id, host,
  acquired_at}`; a lock whose pid is dead is reclaimable, a live one is not. Held lock exits `8`.
- **FM7 (new, Step 10) -- silent interactive fallback.** A provider CLI blocks on a prompt because the
  invocation did not fully specify its non-interactive posture, hanging the run and violating AC2.
  *Detection and prevention:*
  - Every child process is spawned with `stdio.stdin` set to a pipe that is closed immediately when the
    turn carries no stdin payload -- never inherited from the parent TTY. A CLI that tries to prompt
    reads EOF instead of blocking.
  - Every turn carries a wall-clock timeout; on expiry the process tree is terminated and the turn fails
    with a distinct `TurnTimeoutError`, so a hang is never mistaken for slow progress.
  - Claude Code non-interactive posture: `-p/--print` plus an explicit `--permission-mode`
    (allowed values `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`, `manual`
    [VERIFIED-LOCAL] `claude --help` v2.1.211 lists `acceptEdits, auto, bypassPermissions, manual,
    dontAsk, plan`; [VERIFIED-DOC] https://code.claude.com/docs/en/cli-reference adds `default`) and an
    explicit `--allowedTools` set. Exit 0 on success, non-zero on failure; SIGTERM yields exit `143`
    [VERIFIED-DOC] https://code.claude.com/docs/en/headless .
  - Codex CLI non-interactive posture: `codex exec` **defaults to `approval_policy = "never"` and a
    read-only sandbox**; a writing turn must pass `--sandbox workspace-write` explicitly [VERIFIED-DOC]
    https://learn.chatgpt.com/docs/non-interactive-mode .
  - **Corrected syntax (a real hallucination caught by this pass):** widely-circulated guidance says to
    run `codex exec -a never -s workspace-write`. On the installed binary this is **wrong** --
    `codex exec` accepts no `-a/--ask-for-approval` flag. [VERIFIED-LOCAL] `codex exec -a never --help`
    on codex-cli 0.128.0 returns `error: unexpected argument '-a' found`, and `codex exec --help` lists
    no approval flag. `-a` exists only on the top-level interactive `codex` command. If an approval
    policy must be set for `exec`, it goes through the config override: `-c approval_policy="never"`.
    Adapters must not emit `-a` for `exec`. Also note `--full-auto` is deprecated in favour of explicit
    `--sandbox workspace-write` [VERIFIED-DOC] https://learn.chatgpt.com/docs/non-interactive-mode .
- **FM8 (new, Step 10) -- credential-mode regression via `--bare`.** Claude Code's `--bare` is documented
  as the recommended mode for scripted/SDK calls, and is tempting for a harness that wants reproducible
  startup. But: "In bare mode, Claude Code never reads OAuth credentials or the system keychain. For the
  Anthropic API, set `ANTHROPIC_API_KEY`" [VERIFIED-DOC] https://code.claude.com/docs/en/headless .
  Adopting `--bare` would silently break BYOA-by-subscription (the operator's `claude.ai` /
  `subscriptionType: max` login observed above) and force an API key, changing the credential model the
  boundary depends on.
  *Decision:* multi-loopr V1 does **not** pass `--bare`. Determinism of startup context is instead
  obtained by explicitly passing `--setting-sources`, `--strict-mcp-config`, and an explicit
  `--allowedTools` set. If a future phase proposes `--bare`, it must be treated as a credential-model
  change and escalated, not applied as an optimisation.
- **FM9 (new, Step 10) -- version drift between the pinned provider CLI and the installed one.** The
  installed CLIs on this machine (`claude` 2.1.211, `codex-cli` 0.128.0 [VERIFIED-LOCAL]) already lag the
  current npm latest (`2.1.233`, `0.147.0` [VERIFIED-REGISTRY]). Flags and defaults verified against one
  version are not guaranteed in another; the `-a` finding above is exactly this class of hazard in
  reverse.
  *Detection:* preflight records the observed `--version` string for each provider into the run record
  and compares it against a declared `minimum_supported` range. Outside the range is a preflight failure
  (exit `3`) with the observed and required versions printed. multi-loopr never auto-updates a provider
  CLI.

## 10. Phase plan (V1)

Phase 1 of **5**. `PHASE_1_SPEC.md` is the blueprint for Phase 1 only.

| Phase | Title | Delivers |
|---|---|---|
| 1 | Host-agnostic core substrate | Toolchain; relay schema; role/tier registry; deterministic verifiers (continuity, preflight, boundary, neutral-commits); `ProviderAdapter` port (interface only); lock primitive; `multi-loopr doctor` |
| 2 | Provider adapters | `ClaudeCodeAdapter` + `CodexCliAdapter` implementing the port; pure argv construction; exit-code interpretation; adapter conformance suite |
| 3 | Sequential dispatch engine | Turn loop, lock acquisition, relay write/read cycle, halt/escalation signals, timeouts |
| 4 | loopr artifact integration | `baby_prd.md` / `context.md` / `PHASE_N_SPEC.md` production and reference attestation (AC3) |
| 5 | End-to-end acceptance harness | The toy build task; AC1/AC2/AC3 evidence collection; open-source packaging |

---

## MODERNIZATION CHANGELOG

**Pass date:** 2026-08-16. **Capabilities used:** native web search (WebSearch/WebFetch), arXiv MCP
(`search_papers`, `download_paper`), paper-search MCP (`search_arxiv`, `search_google_scholar`), and
direct local execution of the installed provider CLIs and toolchain. **Capability skipped:** GitHub MCP
(not present in this environment's tool registry -- see the HANDOFF report). Where GitHub source
verification would have been used, local binary probing was substituted, and that substitution is stated
at each such claim.

### A. Model strings and SDK/library versions pinned

1. **Implementation stack chosen and pinned** (§7 I1) -- resolves seed §8 open question 1. Node.js
   `>=24.0.0`, TypeScript `7.0.2`, `@types/node` `26.2.0`, zod `4.4.3` as the sole runtime dependency,
   `node:test` as the test runner, **no build step**. Every element executed locally to confirm it
   works together, including a `tsc --noEmit` pass and a `node --test` pass over a `.ts` file with a zod
   `.strict()` assertion. [VERIFIED-REGISTRY] + [VERIFIED-LOCAL]
2. **Node LTS status corrected** -- v20 is EOL, v22 is maintenance, v24 "Krypton" is Active LTS.
   [VERIFIED-DOC] https://nodejs.org/en/about/previous-releases
3. **Provider CLI versions recorded** -- installed: Claude Code `2.1.211`, codex-cli `0.128.0`
   [VERIFIED-LOCAL]. npm latest: `@anthropic-ai/claude-code` `2.1.233` (stable `2.1.224`),
   `@openai/codex` `0.147.0` [VERIFIED-REGISTRY]. The drift itself is now a modelled failure mode (FM9).
4. **Concrete model names deliberately NOT pinned** (§6.2) -- and pinning them is now a boundary
   violation (rule B7). The two vendor doc pages disagreed with each other on the example model string
   during this same pass (`gpt-5.6` vs `gpt-5.5`), which is the evidence for the decision. Tier maps to
   the stable *effort* enum instead.

### B. Hallucinated or outdated syntax/config corrected

5. **`codex exec -a never` is wrong and is now explicitly banned** (§9 FM7). The installed binary rejects
   `-a` on the `exec` subcommand: `codex exec -a never --help` -> `error: unexpected argument '-a' found`
   [VERIFIED-LOCAL, codex-cli 0.128.0]. Correct forms: rely on `exec`'s documented `never` default, or
   use `-c approval_policy="never"`. This directly contradicts widely-circulated third-party guidance
   surfaced by web search, and is the single highest-value correction of this pass.
6. **`codex exec --full-auto` is deprecated** -- replaced by explicit `--sandbox workspace-write`.
   [VERIFIED-DOC] https://learn.chatgpt.com/docs/non-interactive-mode
7. **`codex exec` default posture recorded** -- read-only sandbox and `approval_policy = "never"` by
   default; a writing turn must opt in to `--sandbox workspace-write`. [VERIFIED-DOC] same source.
8. **Codex config key names and value sets pinned** -- `approval_policy` = `untrusted|on-request|never|{granular=...}`;
   `sandbox_mode` = `read-only|workspace-write|danger-full-access`; `model_reasoning_effort` =
   `minimal|low|medium|high|xhigh`. [VERIFIED-DOC] https://learn.chatgpt.com/docs/config-file/config-reference
9. **Claude Code non-interactive surface pinned** -- `-p/--print`; `--output-format text|json|stream-json`;
   `--json-schema`; `--permission-mode` value set; `--allowedTools`; `--append-system-prompt`;
   `--session-id` (UUID) / `--resume`; `--effort low|medium|high|xhigh|max`; exit 0 on success, non-zero
   on failure, `143` on SIGTERM; piped stdin capped at 10MB. [VERIFIED-LOCAL `claude --help` v2.1.211] +
   [VERIFIED-DOC] https://code.claude.com/docs/en/headless , https://code.claude.com/docs/en/cli-reference
10. **`--bare` explicitly rejected for V1 and the reason recorded as FM8** -- it is the vendor-recommended
    scripting mode but it disables OAuth/keychain credential reading, which would break BYOA-by-subscription.
    [VERIFIED-DOC] https://code.claude.com/docs/en/headless . Without this pass, an executor agent
    following the vendor's own "recommended for scripted calls" note would have silently changed the
    project's credential model.
11. **Commit-attribution mechanism corrected** (§7 I2/I4) -- Claude Code's key is
    `attribution: { commit, pr }` in `settings.json` [VERIFIED-DOC] https://code.claude.com/docs/en/settings .
    A Codex `commit_attribution` key is claimed by third-party blogs but is **[UNVERIFIED]**: it does not
    appear in the official config reference (searched that page for "commit", "attribution",
    "co-author"). Consequently neutrality is enforced by a deterministic git check owned by multi-loopr,
    with provider settings as defence in depth only.
12. **Auth-probe commands and their exact exit/output contracts pinned** (§9 FM1) -- `claude auth status`
    -> exit 0 + JSON with `loggedIn`; `codex login status` -> exit 1 + `Not logged in` when
    unauthenticated. Both [VERIFIED-LOCAL]. The authenticated Codex stdout shape is [UNVERIFIED] because
    this machine is not logged in to Codex, so the predicate keys on exit code only.

### C. Approach validated against literature

13. **Deterministic-over-LLM verification: validated, and the aggregation rule enhanced.** VeriMAP
    (arXiv:2510.17109, §2 read) distinguishes programmatic verification functions that "provide
    deterministic and reproducible guarantees" from LLM verification reserved for open-ended judgment,
    and aggregates with "a strict logical AND strategy, where a subtask is marked as failed if any VF
    fails." **Enhancement applied within the locked architecture:** `ContinuityVerdict` is now specified
    as strict-AND over five named checks (C1--C5) that each return a machine-readable ID on failure,
    rather than a boolean.
14. **Structured, named-variable handoff payloads: validated.** VeriMAP §2.1's Structured I/O + Named
    Variables requirement is the published form of multi-loopr's versioned `HandoffRecord`; cited inline
    at §8.1(2) as support for FM5's guard.
15. **The reviewer isolation rule: validated as a performance mechanism, not only a safety one.**
    VeriMAP §2.2 withholds the global task from executors and reports this "allows smaller models to
    participate effectively." Cited inline at §8.1(4) as the justification for pairing the
    high-volume-low-effort executor tier with a spec-and-diff-only payload.
16. **Structured-only payload recorded as a deliberate divergence from the field.** The protocol taxonomy
    (arXiv:2606.19135, §5 read) finds all nine sampled agent-to-agent protocols use `hybrid` (text +
    structure) payloads with session state. multi-loopr chooses `structured data and artifacts` only and
    `single` schema flexibility, and §8.2 now argues why rather than leaving the divergence unexplained.
17. **Falsification check on sequential handoff: performed, no escalation.** AgentRadio
    (arXiv:2607.28430, **abstract only**) shows asynchronous mid-execution messaging beating staged
    handoffs for *concurrent* agents. Assessed as out of scope for V1's strictly sequential model and
    recorded as an argued V2+ direction in §3.8, not as an open architecture question.
18. **Null finding recorded, not padded** (§8.4) -- no literature found on heterogeneous-vendor coding
    agent handoff, and none on git-ancestry-based continuation verification. The search performed is
    stated. No tangential papers were added to fill the space.

### D. Open questions resolved (seed §8)

19. **Implementation language/stack** -- RESOLVED, §7 I1. See changelog item 1.
20. **Which non-architect archetypes cross-provider-dispatch in V1** -- RESOLVED, §6.3. EXECUTOR only;
    REVIEWER instantiated and dispatched through the same port but provider-parameterised; RESEARCHER
    not instantiated; AUDITOR out.
21. **Exact content/format of the context-relay handoff artifact** -- RESOLVED, §9 FM5 + `PHASE_1_SPEC.md`
    §3. The seed's proposal (spec artifacts + compact structured record + git SHA/diff as ground truth,
    never a raw transcript) survives verification and is adopted, with three modernization-driven
    changes: (a) the record is a **file at a known path written by the agent and validated by
    multi-loopr**, not a provider structured-output payload, because Codex's `--output-schema` has a
    reported silent-failure mode with tools active (openai/codex#15451); (b) it carries a required
    `schema_version` literal; (c) transcript-shaped keys are rejected by a dedicated pre-parse denylist
    so an isolation leak surfaces as an isolation error, not an unknown-key error.

### E. Categories with no change

22. **Locked architectural decision (§4)** -- unchanged. Research corroborated it; nothing falsified it.
23. **Boundary text (§5 prose)** -- unchanged. §5.1 *adds* a mechanised ruleset beneath it; it does not
    weaken or restate the boundary.
24. **Acceptance criteria (§2)** -- unchanged in substance. AC1's measurement was made deterministic; the
    criterion itself was not altered.
25. **Scope out-list (§3.1--3.7)** -- unchanged. §3.8 was added to make an already-implicit sequential
    constraint explicit and testable.

### F. Open architecture questions

**None.** No research finding in this pass falsified or cast serious doubt on a locked architectural
decision. The one candidate (AgentRadio's asynchronous-messaging result, §8.3) was assessed against
V1's strictly sequential scope and does not contradict it. No `## OPEN ARCHITECTURE QUESTIONS` block is
raised and no human decision is pending.

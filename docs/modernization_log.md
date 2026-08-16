# modernization_log.md

Canonical pinned versions and provider-CLI facts for multi-loopr. Mirrored from
`multi-loopr-PRD.md` (Step 10 pass). If this file and the PRD ever disagree, **the PRD wins** --
this is a convenience index, not a second source of truth.

**Last pass:** 2026-08-16 (Step 10, RESEARCHER/PLANNER).
**Verification key:** `LOCAL` = executed on this machine · `DOC` = vendor official docs ·
`REGISTRY` = `npm view <pkg> version` · `UNVERIFIED` = no primary source found.

---

## 1. Model strings

**None pinned, deliberately.** Per PRD §6.2, concrete provider model identifiers are never recorded on
role definitions or anywhere outside `src/adapters/**`. Boundary rule B7 makes a hardcoded model name a
build-failing violation (exit `9`).

Evidence for the decision: OpenAI's own two config doc pages carried different example model strings
within the same pass -- `gpt-5.6` (DOC https://learn.chatgpt.com/docs/config-file/config-basic) vs
`gpt-5.5` (DOC https://learn.chatgpt.com/docs/config-file/config-reference).

Tier is mapped to each provider's **stable effort enum** instead:

| Abstract `ModelTier` | Claude Code `--effort` | Codex `-c model_reasoning_effort` |
|---|---|---|
| `research-grade` | `high` | `high` |
| `verification-grade` | `high` | `high` |
| `high-volume-low-effort` | `low` | `low` |

Allowed value sets (do not invent values outside these):
- Claude Code `--effort`: `low`, `medium`, `high`, `xhigh`, `max` -- LOCAL, `claude --help` v2.1.211.
  The published CLI reference additionally lists `ultracode` (DOC https://code.claude.com/docs/en/cli-reference);
  treat any value absent from the installed binary's own help as unavailable.
- Codex `model_reasoning_effort`: `minimal`, `low`, `medium`, `high`, `xhigh` -- DOC
  https://learn.chatgpt.com/docs/config-file/config-reference

Model *selection* is delegated to each provider CLI's own configured default unless the operator
overrides it in the multi-loopr run config.

## 2. Implementation toolchain (pinned)

| Element | Pin | Source |
|---|---|---|
| Node.js | `>=24.0.0` (Active LTS "Krypton") | LOCAL `node --version` -> `v24.15.0`; DOC https://nodejs.org/en/about/previous-releases |
| npm | `>=11` | LOCAL `npm --version` -> `11.12.1` |
| TypeScript | `7.0.2` (devDependency; `tsc --noEmit` only) | REGISTRY; LOCAL install + type-check pass |
| `@types/node` | `26.2.0` (devDependency) | REGISTRY |
| zod | `4.4.3` -- **the only runtime dependency** | REGISTRY; LOCAL `.strict()` parse + type-check pass |
| Test runner | Node built-in `node:test` (zero dependency) | LOCAL `node --test "src/**/*.test.ts"` -> exit 0 on a `.ts` file |
| Build step | **None** -- Node executes `.ts` directly via type stripping | LOCAL `node src/a.ts` -> correct output on v24.15.0 |
| git | `>=2.40` | LOCAL `git --version` -> `2.54.0.windows.1` |

Node EOL status: v20 EOL, v22 maintenance, v24 Active LTS (DOC, same nodejs.org page).

TypeScript 7.0.2 notes: released 2026-07-08 (RC 2026-06-18); Go-native compiler; `strict` on by default;
several previously-deprecated flags are now hard errors; programmatic API not stable until 7.1
(DOC https://www.infoq.com/news/2026/08/typescript-7-released/). multi-loopr uses only the `tsc` CLI, has
no bundler/transpiler in its graph, and sets every relevant flag explicitly, so it does not rely on any
7.0 default.

**Required tsconfig flags** (any of these missing is a Phase 1 failure):
`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `isolatedModules`,
`allowImportingTsExtensions`, `noEmit`. `package.json` must set `"type": "module"`, and relative imports
must carry an explicit `.ts` extension -- both verified LOCAL (omitting `"type": "module"` produced
`TS1295`/`TS1287` errors; omitting `allowImportingTsExtensions` breaks `.ts`-extension imports).

## 3. Provider CLI versions

| CLI | Installed here (LOCAL) | npm latest (REGISTRY, 2026-08-16) | Package |
|---|---|---|---|
| Claude Code | `2.1.211` | `2.1.233` (`stable` tag: `2.1.224`) | `@anthropic-ai/claude-code` |
| Codex CLI | `codex-cli 0.128.0` | `0.147.0` | `@openai/codex` |

The gap between installed and latest is modelled as **FM9** in the PRD: flags verified on one version are
not guaranteed on another. Preflight records the observed `--version` and range-checks it. multi-loopr
never auto-updates a provider CLI.

## 4. Provider CLI invocation facts (pinned)

### 4.1 Claude Code -- non-interactive

- `-p` / `--print` -- non-interactive. Exit `0` success, non-zero failure, `143` on SIGTERM.
  DOC https://code.claude.com/docs/en/headless
- `--output-format` -- `text` | `json` | `stream-json`. `json` payload includes `result`, `session_id`,
  `total_cost_usd`; with `--json-schema`, also `structured_output`. DOC same.
- `--permission-mode` -- LOCAL help (v2.1.211) lists `acceptEdits`, `auto`, `bypassPermissions`,
  `manual`, `dontAsk`, `plan`; the CLI reference also lists `default`.
  DOC https://code.claude.com/docs/en/cli-reference
- `--allowedTools` / `--disallowedTools` -- permission-rule syntax, e.g. `Bash(git diff *)`. Note the
  space before `*` is significant. DOC headless page.
- `--append-system-prompt`, `--append-system-prompt-file`, `--system-prompt`, `--system-prompt-file` --
  role-profile injection. LOCAL help + DOC cli-reference.
- `--session-id <uuid>`, `--resume <id>`, `--continue` -- session continuity. LOCAL help.
- `--setting-sources`, `--strict-mcp-config` -- startup-context determinism without `--bare`.
- Piped stdin capped at **10MB**. DOC headless page.
- Auth probe: `claude auth status` -> exit `0`, stdout JSON with `loggedIn`, `authMethod`,
  `apiProvider`, `subscriptionType`. LOCAL (observed `authMethod: "claude.ai"`,
  `subscriptionType: "max"`).
- **`--bare` is BANNED in V1** (PRD FM8). It is the vendor-recommended scripting mode but it never reads
  OAuth credentials or the system keychain and requires `ANTHROPIC_API_KEY`, which would silently change
  the BYOA credential model. DOC https://code.claude.com/docs/en/headless
- Commit attribution: `settings.json` key `attribution: { commit: "", pr: "" }`.
  DOC https://code.claude.com/docs/en/settings

### 4.2 Codex CLI -- non-interactive

- `codex exec [PROMPT]` -- non-interactive. Prompt may be the argument, `-`, or piped stdin.
  LOCAL `codex exec --help` v0.128.0.
- **`codex exec` accepts NO `-a` / `--ask-for-approval` flag.** LOCAL: `codex exec -a never --help` ->
  `error: unexpected argument '-a' found`. `-a` exists only on the top-level interactive `codex` command.
  Set the policy via `-c approval_policy="never"` if it must be set explicitly. **Adapters must never
  emit `-a` for `exec`.**
- Defaults in `exec`: `approval_policy = "never"` and a **read-only** sandbox. A writing turn must pass
  `--sandbox workspace-write` explicitly. DOC https://learn.chatgpt.com/docs/non-interactive-mode
- `--full-auto` is **deprecated**; use `--sandbox workspace-write`. DOC same.
- `-s` / `--sandbox` -- `read-only` | `workspace-write` | `danger-full-access`. LOCAL help + DOC.
- `--json` -- JSONL event stream on stdout. Event types: `thread.started`, `turn.started`,
  `turn.completed`, `turn.failed`, `item.*`, `error`. `turn.completed` carries a `usage` object. DOC
  non-interactive page.
- `-o` / `--output-last-message <FILE>` -- writes the final agent message to a file. LOCAL help + DOC.
- `--output-schema <FILE>` -- structured final response. **Not relied upon by multi-loopr** (PRD FM5):
  openai/codex#15451 reports `--json` and `--output-schema` being silently ignored when tools/MCP servers
  are active, producing malformed output (reported against 0.116.0; issue closed).
  https://github.com/openai/codex/issues/15451
- `-C` / `--cd <DIR>`, `--add-dir`, `--skip-git-repo-check`, `--ephemeral`, `--ignore-user-config`,
  `--ignore-rules` -- LOCAL help.
- `codex exec resume [SESSION_ID|--last] [PROMPT]` -- session continuity. LOCAL `codex exec resume --help`.
- Config keys (DOC https://learn.chatgpt.com/docs/config-file/config-reference):
  - `approval_policy` = `untrusted` | `on-request` | `never` | `{ granular = {...} }`
  - `sandbox_mode` = `read-only` | `workspace-write` | `danger-full-access`
  - `model` = string
  - `model_reasoning_effort` = `minimal` | `low` | `medium` | `high` | `xhigh`
- Auth probe: `codex login status` -> exit `1` + `Not logged in` when unauthenticated. LOCAL (this
  machine is currently unauthenticated for Codex). The **authenticated** stdout shape is **UNVERIFIED**;
  the preflight predicate therefore keys on exit code only.
- CI/BYOA env alternative: `CODEX_API_KEY`. DOC https://learn.chatgpt.com/docs/non-interactive-mode
- Commit attribution: a `commit_attribution` config key is claimed by third-party blogs but is
  **UNVERIFIED** -- absent from the official config reference (that page was searched for "commit",
  "attribution", "co-author"). multi-loopr enforces neutral commits with its own deterministic git check
  instead.

## 5. Deterministic verification primitives (pinned behaviour)

- `git merge-base --is-ancestor <A> <B>` -> exit `0` ancestor, `1` not ancestor, `128` bad object.
  LOCAL (the `128` path was observed against this repo's empty history).
- `fs.open(path, "wx")` -- atomic exclusive create; the FM6 lock primitive. No check-then-act race.
- SHA-256 over file bytes -- the AC3 artifact-attestation primitive (`node:crypto`, zero dependency).

## 6. Capabilities skipped in this pass

- **GitHub MCP (read-only dependency-source verification): SKIPPED.** No GitHub MCP server is present in
  this environment's tool registry (`ToolSearch` for GitHub repository/file-content tools returned only
  arXiv/paper-search/notebook tools). Substituted: direct execution of the installed provider CLIs
  (`--help`, `--version`, auth probes, a rejected-flag probe) and `npm view` against the registry. This
  substitution is *stronger* than GitHub source-reading for the specific facts pinned above, because the
  installed binary is the artifact that will actually run -- but it is weaker for any claim about
  upstream source not exercised by a local probe, and no such claim is made here.
- **paper-search MCP `search_google_scholar`: returned empty** for every query attempted; treated as
  unavailable rather than as a null finding.

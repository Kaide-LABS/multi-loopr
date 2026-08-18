# MCP_SERVER_BUILD_COMPLETE.md -- multi-loopr MCP server feature

**Status:** Phase 8 (the MCP server) is built, reviewed, and approved.

This is a fourth, separate feature series layered on top of the already-shipped, already-complete
V1 (`BUILD_COMPLETE.md`, phases 1-5), the already-shipped, already-approved Phase 6 driver
(`DRIVER_BUILD_COMPLETE.md`), and the already-shipped, already-approved Phase 7 role pinning
(`ROLE_PINNING_BUILD_COMPLETE.md`). It is deliberately a distinctly-named marker, not a rewrite of
any of the three, per `PHASE_8_SPEC.md`'s own PHASE ADVANCEMENT instruction: overwriting or
duplicating any of them would corrupt an existing, already-shipped record. Phase 8 is a
single-phase feature series (`PHASE_8_SPEC.md` §0), and it is **the third and last of the three
feature series the operator directed built in this exact order** (driver, role pinning, MCP
server) -- there is no Phase 9, of this feature or of the series (`PHASE_8_SPEC.md` §0,
`.claude/loopr-mcp-server/baby_prd.md` scope edges).

## Commit trail

| Commit | Meaning |
|---|---|
| `3c0c0ee` | `feat: Phase 8 implementation (multi-loopr)` |
| `ebd8041` | `fix: Phase 8 review patches (multi-loopr) -- add missing boundary.test.ts B2 third-dependency-key regression case` |
| `b174da2` | `chore: Phase 8 review approved (multi-loopr)` |
| (this pass) | `docs: multi-loopr MCP server feature complete -- 1 phase shipped, three-feature series complete` |

The one fix patch (`ebd8041`) closed a real, disclosed gap: the implementation commit (`3c0c0ee`)
correctly widened `scanManifest()`'s own allowlist check to the amended, two-key B2 allowlist
(`zod` + `@modelcontextprotocol/sdk`) but never added `PHASE_8_SPEC.md` §8 acceptance criterion 5's
own required regression test proving a third, unauthorized dependency key is still rejected. The
review's fix-patch commit added exactly that test. This is independently re-verified below, not
taken on the approval commit's word.

## Acceptance-suite results -- run live this pass, not self-reported

Every item below was executed directly against the repository at HEAD (`b174da2`) during this
advancement pass.

**Static discipline**
1. `npm run typecheck` -- **PASS**, zero diagnostics.
2. `node src/cli/main.ts doctor --boundary` -- **PASS**, exit `0`, `40 file(s) scanned, 0
   violation(s)`. Re-run with `--json`: `"ok": true, "exit_code": 0, "boundary": {"filesScanned":
   40, "violations": []}`. Confirms `PHASE_8_SPEC.md` §8 acceptance criterion 5 / baby_prd AC5 holds
   against the real, current, post-MCP `package.json`, not the diff alone.
3. `node --test "src/**/*.test.ts"` (the full suite, run to completion) -- **422 passing, 4
   failing.** The 4 failures --
   - `src/adapters/codex-cli.test.ts`: "on this machine's current, real state: CodexCliAdapter().preflight() resolves authenticated: false with a non-empty problems array"
   - `src/cli/main.test.ts`: "doctor --providers exits 3 on this machine and names Codex specifically with actionable guidance" and "doctor (no flags) runs the full report and exits per §4.3 precedence"
   - `src/verify/preflight.test.ts`: "runPreflight always probes both providers, even though on this machine only one is authenticated"

   are the same pre-existing, environment-dependent Codex-auth-state failures already disclosed in
   `DRIVER_BUILD_COMPLETE.md` and `ROLE_PINNING_BUILD_COMPLETE.md`: they assert this machine's Codex
   CLI is in an unauthenticated state, and this machine's real, current sign-in state differs. None
   of the 4 touch any file under `src/mcp/**`, confirmed directly. Not a Phase 8 regression.
4. `git diff --name-only 2b7ece5..b174da2` (the full Phase-7-approved -> Phase-8-approved range) --
   touches exactly `README.md`, `package.json`, `package-lock.json`, `src/cli/main.ts` (+ its
   `.test.ts`), `src/verify/boundary.ts`/`boundary-rules.ts` (+ `boundary.test.ts`), and the seven
   new `src/mcp/**` source files plus their seven colocated test files. **Zero** files under
   `src/domain/**`, `src/dispatch/**`, `src/adapters/**`, `src/ports/**`, `src/util/**`, or any of
   `src/cli/run.ts`/`drive.ts`/`doctor.ts`/`evidence.ts` themselves are touched -- **PASS** against
   `PHASE_8_SPEC.md` §1's exhaustive file list and §9's off-limits scope.
5. `package.json` "dependencies" -- exactly `{"@modelcontextprotocol/sdk": "1.30.0", "zod":
   "4.4.3"}`, confirmed by direct read. Matches `node_modules/@modelcontextprotocol/sdk/package.json`
   `"version": "1.30.0"`, the exact pinned version `PHASE_8_SPEC.md` §2/§8.7 names.

**`doctor --boundary` / B2 allowlist (baby_prd AC5, §7 FM-M3)**
`src/verify/boundary.ts`'s `ALLOWED_DEPENDENCY_KEYS` is a genuine, closed, two-element array
(`["zod", "@modelcontextprotocol/sdk"]`), confirmed by direct read -- not a loosened
any-number-of-dependencies check. `src/verify/boundary.test.ts` (line 71) carries the required
third-dependency-key regression case added by `ebd8041`, confirmed present by direct read: a
fixture `package.json` with a third dependency key alongside both allowed ones still produces a B2
violation with `excerpt === "third-pkg"`. **PASS**, and re-confirmed live above (item 2) against the
real, current, shipped `package.json` -- exit `0`, zero violations.

**No HTTP/SSE transport imported (§7 FM-M2)**
A tree-wide grep of `src/mcp/**` (excluding test files) for `@modelcontextprotocol/sdk` import
specifiers finds exactly three subpaths used anywhere: `server/mcp.js` (`McpServer`),
`server/stdio.js` (`StdioServerTransport`), and a type-only `types.js` import (`CallToolResult`).
No `client/**` subpath, no HTTP or SSE transport subpath, is imported anywhere in `src/mcp/**`.
**PASS.** (The SDK's own bundled HTTP/Streamable-HTTP/SSE transport machinery still ships inside
`node_modules` as part of the monolithic `@modelcontextprotocol/sdk` package -- this is a permanent
property of the dependency choice, not something `src/**` pulls in, disclosed and accepted by the
operator's own confirmed B2 amendment.)

**No scope-creep MCP primitives (§7 FM-M6, §9 non-goal 6)**
A tree-wide grep for `registerResource`/`registerPrompt` across `src/mcp/**` finds zero calls (one
comment in `server.ts` documenting the guard, not a call). `server.test.ts`'s own structural
reflection test confirms `tools/list` against the built server returns exactly four tools (`run`,
`drive`, `doctor`, `evidence`). **PASS.**

**§8 acceptance criteria, mapped to the code and tests that satisfy each:**
1. **AC1 (`run` tool <-> CLI `run --json` equivalence)** -- `src/mcp/tools/run.test.ts`, reusing the
   existing fake-adapter fixture pattern, asserts `deepEqual` reports after stripping
   `run_id`/`generated_at`. **PASS** (part of the 422 passing above).
2. **AC2 (`drive` tool <-> CLI `drive --json` equivalence)** -- `src/mcp/tools/drive.test.ts`,
   identical treatment. **PASS.**
3. **AC3 (role pinning via MCP resolves identically to the CLI)** -- `src/mcp/tools/run.test.ts`
   carries the `PHASE_7_SPEC.md` §6.1 worked-resolution-table cases end-to-end through the MCP tool
   handler. **PASS.**
4. **AC4 (MCP layer contains no orchestration logic of its own)** -- structural criterion, checked
   by direct read this pass: every file under `src/mcp/tools/**` does nothing but validate/translate
   its input and call an existing `runRunCommand`/`runDriveCommand`/`runDoctor`/
   `runEvidenceCommand` function, then translate the result back out. `run`/`drive` write their
   already-SDK-validated input to a process-local temp config file and call the existing CLI-layer
   function unmodified; `doctor`/`evidence` call their existing functions directly with in-memory
   arguments. **PASS.**
5. **AC5 (`doctor --boundary` continues to exit 0)** -- confirmed live above (Static discipline item
   2) against the real, current, shipped `package.json`, plus the third-dependency-key regression
   case. **PASS.**
6. **AC6 (existing CLI commands byte-identical before/after)** -- confirmed by the full pre-existing
   Phase 1-7 test suite passing unmodified (422 of 426, the 4 failures being the pre-existing,
   environment-dependent ones documented above, none in a Phase 8 file), and by the diff stat (item
   4 above) touching none of `src/cli/run.ts`/`drive.ts`/`doctor.ts`/`evidence.ts` themselves.
   **PASS.**

**Overall: every `PHASE_8_SPEC.md` §8 acceptance criterion re-verified this pass against the real
shipped code and a live run, not inherited from the prior review's own claim.**

## The empirical MCP round-trip test-coverage gap -- disclosed, not closed this pass

This is a real, reportable limitation, named explicitly rather than papered over, first surfaced by
the Step 14 comprehension pass (`COMPREHENSION.md` §5/§6, read directly for this disclosure) and
independently confirmed here.

`PHASE_8_SPEC.md` §0's own "Standing constraint specific to this phase" required the executor/
reviewer to confirm two `[UNVERIFIED]` items -- the full branch behavior of the SDK's
`validateToolOutput()`, and live-client reconnect/restart behavior -- **empirically against a real
`tools/call` round-trip**, per `multi-loopr-PRD.md` §8.7, rather than relying on static-source
reading alone. The review that approved this phase (commit `b174da2`) did perform exactly this
check, live, once, during the review session: building a real `McpServer`, connecting a real
`Client` over `InMemoryTransport`, and driving real `tools/list`/`tools/call` traffic, confirming
malformed input is rejected by the SDK's own validation before any handler runs. That check was
genuine and empirical, but it was never captured as a persisted, repeatable test.

Every committed integration test in `src/mcp/**/*.test.ts` -- `server.test.ts`, `run.test.ts`,
`drive.test.ts`, `doctor.test.ts`, `evidence.test.ts` -- substitutes a minimal fake `registerTool`
capture (`fakeServer = { registerTool: (...) => { handler = cb } }`) for the real `McpServer`,
capturing the registered callback and invoking it in-process. This proves the handler's own
translation logic is correct for a given input (and the in-process handler tests do verify that
correctly) -- confirmed by this pass, which independently re-verified every one of those tests
passes. But it does **not** exercise the SDK's own `normalizeObjectSchema`/`safeParseAsync`-before-
handler validation path that §8.7 and this project's own §3.1/FM-M4 rely on as the actual mechanism
that rejects a malformed call before the handler is ever invoked. `server.test.ts`'s own
object-identity assertions (`tools["run"]?.inputSchema === RunConfig`) confirm the schema *wiring*
is correct, but not that the SDK's own live validation behavior matches what static reading claims.

This pass, re-reading `src/mcp/**` and grepping the tree for `InMemoryTransport`/`new Client`/
`.connect(` outside `server.ts` itself, confirms COMPREHENSION.md's finding directly: no such
construct exists anywhere in the shipped test suite, and the approval commit's own message names no
persisted test capturing the live check that was performed. Both PRD §8.7 `[UNVERIFIED]` items
therefore remain genuinely unverified by anything durable in this repository, even though they were
genuinely verified once, live, during review.

**This is a real, disclosed gap in test coverage for a genuinely-verified-but-not-durably-tested
behavior -- not a defect in the translation logic itself (which the in-process handler tests do
verify correctly), and not a live divergence between the approved code and the spec.** Consistent
with this project's own established discipline (comprehension never un-approves), it does not
reverse Phase 8's approval. Closing it -- adding an `InMemoryTransport`-based integration test that
drives a real `McpServer`/`Client` round trip and asserts the SDK's own validation rejects malformed
input before any handler runs -- is left as follow-up work for whoever next touches `src/mcp/**`,
not retrofitted into this already-approved phase. This is the same treatment
`DRIVER_BUILD_COMPLETE.md`'s own disclosed multi-phase-fixture gap and
`ROLE_PINNING_BUILD_COMPLETE.md`'s own disclosed citation-gap received: named plainly, left open,
not silently closed by the mere fact that this is the final phase.

## Citation-gate summary

One citation-adjacent verification binds this phase: the `@modelcontextprotocol/sdk` API shapes
Step 10's own research pass confirmed (`multi-loopr-PRD.md` §8.7) -- import paths, class names, and
method signatures sourced from a direct read of the pinned version's own shipped type declarations
and compiled source, not a remembered or guessed shape. Independently re-verified this pass, not
inherited:

1. **Pinned version match.** `package.json` declares `@modelcontextprotocol/sdk@1.30.0`;
   `node_modules/@modelcontextprotocol/sdk/package.json` reports `"version": "1.30.0"` -- the exact
   version installed matches the exact version the spec's API-shape research was performed against.
2. **Import specifiers match the shipped package.** `src/mcp/server.ts` imports `McpServer` from
   `@modelcontextprotocol/sdk/server/mcp.js` and `StdioServerTransport` from
   `@modelcontextprotocol/sdk/server/stdio.js`; both subpaths exist in the installed package's own
   `exports` map, confirmed by direct read of `node_modules/@modelcontextprotocol/sdk/dist/esm/
   server/mcp.d.ts` and `stdio.d.ts` this pass. `registerTool` (not the four `@deprecated` sibling
   methods the shipped `.d.ts` itself flags) is the method every `src/mcp/tools/*.ts` file calls,
   matching the spec's own naming.
3. **The two `[UNVERIFIED]` items named in `multi-loopr-PRD.md` §8.7** (`validateToolOutput()`'s
   full branch behavior, live-client reconnect/restart behavior) remain genuinely unverified by any
   durable, persisted test in this repository -- see "The empirical MCP round-trip test-coverage
   gap" above. This is disclosed as an open item, not silently marked closed.

**Citation-gate result: PROVISIONAL.** The pinned-version and import-specifier shapes are
independently re-verified PASS this pass. The two `[UNVERIFIED]` items §8.7 named are verified only
by a one-time, non-persisted live check during review, not by anything a future reader can re-run --
disclosed above, not treated as a clean PASS.

## Handoff -- three-feature series complete

`multi-loopr mcp` is complete, reviewed, and usable today: a local, stdio-only Model Context
Protocol server exposing `run`, `drive`, `doctor`, and `evidence` as four MCP tools, reachable
conversationally from any MCP-capable client (Claude Code, or any other MCP host) without hand-
constructing a `RunConfig`/`DriveConfig` JSON file and shelling out to the CLI directly. Every tool
handler is a thin, logic-free translation layer over the existing, unmodified CLI-command
functions -- confirmed structurally this pass (AC4) and by the diff touching none of
`src/cli/run.ts`/`drive.ts`/`doctor.ts`/`evidence.ts` themselves. Role pinning (Phase 7) and the
driver (Phase 6) are both reachable identically through the MCP path, since `run`/`drive` consume
`RunConfig`/`DriveConfig` exactly as the CLI already does, adding no pinning- or driver-specific
logic of its own.

One real, disclosed gap is carried forward, not closed: no test in this repository durably exercises
a real MCP `tools/call` round trip through the SDK's own actual runtime validation machinery (see
above). An operator relying on the MCP server in production should understand that the SDK's
input-validation-before-handler behavior was empirically confirmed once, live, by the review that
approved this phase, but that confirmation is not reproducible from anything currently checked into
this repository's test suite.

**This is the final phase of the entire three-feature series.** The multi-phase driver (Phase 6,
`DRIVER_BUILD_COMPLETE.md`), role pinning (Phase 7, `ROLE_PINNING_BUILD_COMPLETE.md`), and now the
MCP server (Phase 8, this file) are all built, reviewed, and usable together: an operator can drive
a real multi-phase build, with role pins resolved correctly, through either the CLI directly or
through any MCP-capable client talking to `multi-loopr mcp` -- the same underlying `RunConfig`/
`DriveConfig`/`runDispatch`/`runDrive` machinery serves both paths identically. No Phase 9 is
planned for any of the three feature series.

No deployment URL applies -- multi-loopr is a local CLI harness, not a deployed service.

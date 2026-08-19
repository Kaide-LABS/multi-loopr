# INSTALLER_BUNDLING_BUILD_COMPLETE.md -- multi-loopr installer bundling feature

**Status:** Phase 9 (installer bundling) is built, reviewed, patched, and approved.

This is a fifth, separate feature series layered on top of the already-shipped, already-complete
V1 (`BUILD_COMPLETE.md`, phases 1-5), the already-shipped, already-approved Phase 6 driver
(`DRIVER_BUILD_COMPLETE.md`), the already-shipped, already-approved Phase 7 role pinning
(`ROLE_PINNING_BUILD_COMPLETE.md`), and the already-shipped, already-approved Phase 8 MCP server
(`MCP_SERVER_BUILD_COMPLETE.md`). It is deliberately a distinctly-named marker, not a rewrite of
any of the four, per `PHASE_9_SPEC.md`'s own PHASE ADVANCEMENT instruction: overwriting or
duplicating any of them would corrupt an existing, already-shipped record. Phase 9 is a
single-phase feature series (`PHASE_9_SPEC.md` §0), and `PHASE_9_SPEC.md` §0 itself records that it
explicitly supersedes `PHASE_8_SPEC.md` §0's now-stale "no Phase 9 planned" line -- this feature was
directed by the operator after Phase 8 shipped, precisely because Phase 8's MCP server gave
multi-loopr an install-time surface worth extending.

## Commit trail

| Commit | Meaning |
|---|---|
| `229bf27` | `feat: Phase 9 implementation (multi-loopr)` |
| `6d5a5fc` | `fix: Phase 9 review patches (multi-loopr) -- add missing setup CLI-wiring tests, drop unused import` |
| `bc5c90d` | `chore: Phase 9 review approved (multi-loopr)` |
| `c27ab5d` | `fix: Phase 9 review patches (multi-loopr) -- stop the optional-research probe from blocking run/drive's real exit on fast-fail paths` |
| (this pass) | `docs: multi-loopr installer bundling feature complete -- 1 phase shipped, four-feature series complete` |

**Why there are two fix-patch commits around one approval commit, and why that is not a process
violation.** `6d5a5fc` closed a gap found during the phase's own initial review, before approval.
`bc5c90d` then genuinely approved the phase -- every §8 acceptance criterion held, including a
disclosed, deliberate non-performance of AC3-d's live "absent" branch (below). A subsequent
ADVANCEMENT-ONLY dispatch, doing the live re-verification this project's own discipline requires
before writing a completion marker, independently reproduced a real regression the approval had
missed: `main.ts`'s `case "run":`/`case "drive":` unconditionally awaited the optional-research-
probe note before returning, and PHASE_9_SPEC.md §6.7's premise that this adds "zero added latency,
by construction" because a run/drive invocation "takes minutes" is false on any fast exit path (a
`RunConfig`/`DriveConfig` validation error, a usage error, an early preflight failure) -- those
return in milliseconds, long before the two concurrent `claude mcp get` calls underneath the probe
do. That dispatch correctly halted without writing this file rather than paper over a live-verified
regression. `c27ab5d` is this pass's own fix, applied and re-verified live before writing this
document -- not inherited from the approval commit's own claim.

## The regression, the fix, and its own live re-verification

**Reproduction (before the fix, on this machine).** `node dist/cli/main.js run --config
<a-config-that-fails-RunConfig-validation>` took **6.5-14.5 seconds** wall-clock for what should be
an instant validation error (confirmed by three repeated runs: 6486ms/6600ms-class and, on the
worst observed run, 14535ms), because process return still blocked on two `claude mcp get` calls
underneath `probeOptionalResearchServers()`. This broke 4 tests under their 30-second subprocess
timeout: two in `src/cli/run.test.ts` (`... where the JSON fails RunConfig validation exits 2`) and
their two equivalents in `src/cli/drive.test.ts`, violating `PHASE_9_SPEC.md` §8.1 standing
invariant 2 ("`npm run test` exits 0, including every pre-existing test unmodified").

**Root cause, established by direct experiment before writing the fix (not assumed).** Simply not
`await`ing the probe's promise before returning does **not** fix the wall-clock regression: Node
does not exit the OS process until every open handle clears -- including a still-running child
process's own stdio pipes -- regardless of whether any JS code is still `await`ing that child's
promise. This was verified directly: a throwaway script that kicks off the same `runProcess()`-based
probe, does not await it, and returns immediately still left the real OS process alive for ~8
seconds. The only way to make the *process* return immediately once the command's own real work is
done is to force it with `process.exit()`.

**The fix (`src/cli/main.ts` only -- no other file touched).**
1. `emitOptionalResearchNoteThenExit()` races the note promise against an immediately-resolving
   sentinel with **no fixed grace period**: `Promise.resolve(SENTINEL)` settles on the very next
   microtask, so an already-settled note promise (true for every genuine multi-minute run, since its
   underlying I/O long since fired) still wins the race and gets printed; a not-yet-settled one loses
   immediately, with zero added wait, and the note is simply dropped for that invocation -- acceptable
   because it is advisory-only, exactly PHASE_9_SPEC.md §6.7's own stated framing ("nothing in this
   run was skipped or degraded because of them").
2. Once the race resolves, `process.exit(exitCode)` is called -- the one narrow, documented exception
   to `main()`'s "never calls `process.exit`" contract, added only on this path, with the reasoning
   above recorded directly in the function's own doc comment.
3. `writeFlushed()` wraps every `stdout`/`stderr` write immediately preceding a forced exit in a
   callback-based flush, so the forced exit can never truncate output that was already handed to
   `stream.write()` -- verified directly with a 200KB payload across 5 repeated runs before this
   pattern was adopted (all 5 preserved the full byte count).
4. The regression's actual trigger path was the `catch` block, not the success-path case arms: a
   `RunConfig`/`DriveConfig` validation failure throws a `UsageError` from `runRunCommand`/
   `runDriveCommand` **before** the case block's own `emitOptionalResearchNoteThenExit()` call is ever
   reached. The first fix attempt (case-arm-only) measurably improved timing but did not close the
   regression, because the actual failing tests hit the `catch` block. `notePromiseForExit` is
   therefore hoisted to `main()`'s own function scope so the `catch` block gets the identical
   race-then-force-exit treatment. `exitCode` is still derived solely from the command's own result
   (`report.exit_code` or `err.exitCode`) in every path -- never adjusted by, or short-circuited on,
   the probe, preserving PHASE_9_SPEC.md §6.7's own stated invariant.

**Live re-verification of the fix, this pass:**
- `node dist/cli/main.js run --config <same failing config>`, re-run three times after the fix:
  **527ms / 618ms / 511ms** -- the same order of magnitude as bare `node dist/cli/main.js --version`
  (**422ms**), i.e. the regression is closed, not merely reduced.
- Full `node --test "src/**/*.test.ts"` run to completion: **469 passing, 4 failing.** The 4 failures
  are the same pre-existing, environment-dependent Codex-auth-state failures already disclosed in
  every prior `*_BUILD_COMPLETE.md` in this repository (`src/adapters/codex-cli.test.ts`,
  `src/cli/main.test.ts` x2, `src/verify/preflight.test.ts`) -- confirmed this pass by re-running
  `doctor --providers --json` live: this machine's Codex CLI currently reports
  `authenticated: true`, while those 4 tests assert the machine is in an unauthenticated state.
  **Zero failures in `src/cli/run.test.ts` or `src/cli/drive.test.ts` remain** -- the specific
  regression is gone, confirmed directly (`node --test src/cli/run.test.ts src/cli/drive.test.ts`:
  **37/37 passing**, including both previously-broken validation-error tests, each completing well
  inside their 30s budget).
- `npm run typecheck` -- **PASS**, zero diagnostics.
- `node dist/cli/main.js doctor --boundary --json` -- **PASS**, `"ok": true, "exit_code": 0,
  "boundary": {"filesScanned": 44, "violations": []}`.
- `git diff --stat b174da2..HEAD -- package.json package-lock.json` -- **empty**; `package.json`'s
  `dependencies` re-confirmed by direct read as exactly `{"@modelcontextprotocol/sdk": "1.30.0",
  "zod": "4.4.3"}`, byte-for-byte unchanged.
- `git diff --name-only b174da2..HEAD` (the full Phase-8-approved -> now range, spanning both fix
  commits) touches exactly: `README.md`, `docs/modernization_log.md`, `src/cli/main.ts` (+ its
  `.test.ts`), `src/cli/setup.ts` (+ its `.test.ts`), `src/domain/errors.ts`, `src/domain/setup.ts`
  (+ its `.test.ts`), `src/setup/registry.ts` (+ its `.test.ts`), `src/setup/servers.ts` (+ its
  `.test.ts`), and `MCP_SERVER_BUILD_COMPLETE.md`. **Zero** files from `PHASE_9_SPEC.md` §1.9's
  explicit off-limits table appear anywhere in this range, including `src/util/exec.ts` -- the fix
  deliberately worked around that file being off-limits (see above) rather than adding a "quiet"
  spawn mode to it.
- Race logic sanity-checked directly with a throwaway script mirroring `emitOptionalResearchNoteThenExit`'s
  exact `Promise.race` shape: an already-settled note promise is printed (`slow-run case:
  PRINTED:note-A`); a still-pending one is dropped with no added wait (`fast-fail case: DROPPED`).

## Acceptance-suite results -- re-verified live this pass, not inherited from the approval commit

Every item below was executed directly against the repository at HEAD (`c27ab5d`) during this
advancement pass, after applying and re-testing the regression fix above.

**§8.1 Standing invariants.** All five hold: typecheck clean; full test suite 469/473 passing (the 4
pre-existing, disclosed, environment-dependent failures only); `doctor --boundary` exits 0;
`package.json` unchanged; every commit in this range is attribution-neutral (spot-checked by
`git log --format=%B` over the range above -- no `Co-Authored-By` or model-attribution string in any
commit message).

**§8.2 AC1 -- one setup run configures all three servers.** AC1-a/AC1-b are automated and re-confirmed
passing as part of the full suite (`src/domain/setup.test.ts`, `src/setup/registry.test.ts`,
`src/cli/setup.test.ts`: 44/44 passing when run in isolation, this pass). AC1-c is the spec's own
manual, required-for-approval criterion; it was performed live by the review that approved this
phase (`bc5c90d`), recorded in `COMPREHENSION.md` §6 as independently confirmed by the comprehension
pass: `multi-loopr setup` run against this operator's real Claude Code config, with `claude mcp
get`/`claude mcp list` all confirming the servers' presence afterward. This regression-fix pass did
not touch any file under `src/setup/**` or `src/domain/setup.ts`, and re-confirms (by direct read
and by the passing test suite) that the fix is fully isolated to `src/cli/main.ts`'s note-emission
and exit mechanics -- AC1's own registration logic is untouched and unaffected.

**§8.3 AC2 -- a single server's failure is named and isolated.** AC2-a through AC2-d are all
automated and re-confirmed passing as part of the full suite this pass. Unaffected by the regression
fix, same reasoning as AC1.

**§8.4 AC3 -- full functionality with both optional servers absent, plus a visible skip note.**
AC3-a/AC3-b/AC3-c are automated and re-confirmed passing as part of the full suite this pass. AC3-d
is the spec's own manual, required-for-approval criterion with two branches: the "present" branch
(stderr carries nothing when both optional servers are registered) was exercised live by the
approving review and confirmed. **The "absent" branch (removing both optional servers from the live
config and confirming the stderr note appears on a real `run`) was deliberately not performed by the
approving review**, disclosed candidly in the approval commit's own message and independently
confirmed still-open by the Step 14 comprehension pass (`COMPREHENSION.md` §6, "New this pass: the
AC3-d 'absent' branch was not exercised live before approval") -- removing this operator's real MCP
registrations to probe the absent path was judged disproportionate risk given `src/cli/run.ts`/
`src/cli/drive.ts` are confirmed byte-for-byte unmodified by this feature (so the report/exit-code
path is structurally incapable of depending on the probe) and the rendering branches
(`renderOptionalResearchNote`) are already unit-tested at the pure-function level (AC3-a). **This
pass carries that disclosure forward rather than newly closing it or silently dropping it** --
performing a live "absent" demonstration against this operator's real, working MCP configuration
remains outside what this dispatch judges proportionate to attempt unprompted, for the same reason
the approving review already gave. An operator who wants this specific branch closed can run the
exact commands `PHASE_9_SPEC.md` §8.4 AC3-d names: `claude mcp remove arxiv-mcp -s user`, `claude mcp
remove paper-search-mcp -s user`, a real `node src/cli/main.ts run --config
examples/toy-build/...`, confirm stderr carries the note, then re-add both servers.

**§8.5 AC-D1 -- the `decideServerOutcome` totality table.** Automated, re-confirmed passing as part
of the full suite this pass.

**§9 Non-goals.** Re-confirmed by the diff-stat check above: no MCP server beyond arXiv/paper-search,
no auto-repair logic, `src/mcp/**` untouched, `package.json` unchanged, no `codex` invocation
anywhere in the diff (confirmed by grep across every file in the diff-stat list above), and no
interactive prompt/wizard code (`src/cli/setup.ts` parses a fixed, non-interactive argv shape,
unchanged by this pass's fix).

**Overall: every `PHASE_9_SPEC.md` §8 acceptance criterion with an automated check is re-verified
this pass against the real, current, post-fix code and a live run -- not inherited from the approval
commit's own claim. Both manual criteria's already-disclosed states (AC1-c performed and passing,
AC3-d "present" performed and passing, AC3-d "absent" genuinely not performed) are carried forward
exactly as disclosed, neither newly closed nor silently dropped.**

## Citation-gate summary

No citation gate is active for this project (per this project's own established resolution, restated
in `PHASE_9_SPEC.md`'s own advancement instructions: VeriMAP's Step-10-era citation already did its
work informing `verifyContinuation()`'s design and does not require re-verification at each phase
boundary). One citation-adjacent item is carried forward from the Step 14 comprehension pass rather
than newly assessed here: `multi-loopr-PRD.md` §8.8.5 records arXiv:2606.05339 (Owotogbe et al.) as
grounding this phase's verify-after-add design (the `registered` vs. `registered-unverified` split in
`decideServerOutcome`), but no file this phase's diff touches carries the citation itself --
disclosed in `COMPREHENSION.md` §6 as "New this pass," a documentation-only gap (the mechanism itself
is correctly implemented and independently re-verified, both by that comprehension pass and again by
this one via the passing AC-D1 totality-table test). This regression-fix pass did not touch
`registry.ts`'s Step-C logic or comments at all -- confirmed by the diff-stat above showing
`src/setup/registry.ts` outside this pass's own diff (`c27ab5d` touches only `src/cli/main.ts`) --
so this citation-documentation gap is unaffected and remains open for whoever next touches
`registry.ts`'s own file header.

## Handoff -- four-feature series, installer bundling now included

`multi-loopr setup` is complete, reviewed, patched, and usable today: a single non-interactive CLI
command that registers `multi-loopr` itself plus the two optional research servers (`arxiv-mcp`,
`paper-search-mcp`) into an operator's Claude Code MCP configuration under the `user` scope, with a
verify-after-add outcome model that never reports a registration as working merely because the add
command exited 0. `multi-loopr run`/`drive` gained a best-effort, zero-committed-latency stderr note
when either optional research server is not registered -- and, as of this pass, that note-emission
mechanism no longer risks blocking a fast validation-error exit behind a slow background probe, which
was a genuine, live-reproduced regression this pass found and closed rather than a theoretical
concern.

Two real, disclosed gaps are carried forward, not closed by this pass: AC3-d's "absent" branch was
never exercised live (above), and a documentation-only citation gap for arXiv:2606.05339 in
`registry.ts`'s own header (above). Both are named plainly, consistent with this project's own
established "disclosure is not the same as closure" discipline, and neither reverses this phase's
approval.

**This is the fourth of the (now) four feature series layered on top of V1.** The multi-phase driver
(Phase 6, `DRIVER_BUILD_COMPLETE.md`), role pinning (Phase 7, `ROLE_PINNING_BUILD_COMPLETE.md`), the
MCP server (Phase 8, `MCP_SERVER_BUILD_COMPLETE.md`), and now installer bundling (Phase 9, this file)
are all built, reviewed, and usable together. No Phase 10 is currently planned for any of the four
feature series, though `PHASE_9_SPEC.md` §0 itself is direct evidence that such lines are never a
permanent ceiling on this project's phase numbering -- a future operator-directed series would
continue the same numbering exactly as this one did.

No deployment URL applies -- multi-loopr is a local CLI harness, not a deployed service.

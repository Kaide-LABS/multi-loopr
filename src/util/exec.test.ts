// Implements PHASE_1_SPEC.md §1.6 / §6.1 -- exec.test.ts
//
// PHASE_1_SPEC.md's own test-file table (§1.6) does not list a dedicated exec.test.ts, and
// runProcess() is already exercised indirectly by every other suite (git.ts, preflight.ts,
// main.test.ts's real child-process invocations of `node`, `claude`, and `codex`). This file adds
// *direct*, black-box coverage of runProcess()'s own documented contract (§6.1), added by the
// Phase 1 reviewer specifically to close a gap: the Windows `.cmd`/`.bat`-shim relaunch fallback
// described in this module's own file-level comment (see exec.ts) had no dedicated test anywhere,
// despite being a real, unspecified-in-§6.1 behavioural addition with a security-relevant
// rationale (it exists precisely because `shell: false` -- which §6.1 calls mandatory -- cannot
// execute a `.cmd` launcher at all on Windows). This file pins down, with real spawns, both:
// (a) the contract §6.1 states outright (never rejects; a spawn error looks like a resolved
//     failure, not a thrown exception; a genuine ENOENT with shell-unsafe argument content is
//     never silently relaunched), and
// (b) the *actual observed* behaviour of the relaunch path on this platform for a safe-argument,
//     truly nonexistent command -- which is NOT the literal `exitCode: null` §6.1 step 6
//     describes, because cmd.exe itself resolves the sub-command lookup and reports its own exit
//     code (observed: `1`) rather than the parent spawn call ENOENT-ing. This is a genuine,
//     verified deviation from §6.1's literal text, flagged in the Phase 1 review rather than
//     silently left uncovered. It does not currently break any Phase 1 caller because every
//     consumer of RawInvocationResult in this codebase (see preflight.ts's parse* functions) keys
//     on `exitCode !== 0`, never on `exitCode === null` specifically -- but the distinction the
//     type signature (`exitCode: number | null`) was designed to carry is real, and a future
//     phase must not assume `null` is the only way "the command was not found" surfaces on
//     Windows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runProcess } from "./exec.ts";

test("runProcess resolves (never rejects) on a genuinely nonexistent command", async () => {
  await assert.doesNotReject(async () => {
    await runProcess({
      command: "multi-loopr-definitely-not-a-real-binary-xyz",
      args: ["--version"],
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });
  });
});

test("a spawn failure whose argv contains a cmd.exe metacharacter is never relaunched: exitCode stays null, per §6.1 step 6 literally", async () => {
  const result = await runProcess({
    command: "multi-loopr-definitely-not-a-real-binary-xyz",
    args: ["a & b"],
    cwd: process.cwd(),
    timeoutMs: 10_000,
  });
  assert.equal(result.exitCode, null);
  assert.equal(result.signal, null);
  assert.match(result.stderr, /ENOENT/);
  assert.equal(result.timedOut, false);
});

test(
  "REGRESSION (flagged in Phase 1 review): a spawn failure for a nonexistent command with " +
    "shell-safe argv does NOT surface as exitCode: null on this platform -- the Windows " +
    "cmd.exe-relaunch fallback resolves cmd.exe's own 'not recognized' result instead, which is " +
    "a real, verified deviation from PHASE_1_SPEC.md §6.1 step 6's literal text. Pinned here so a " +
    "future change to the fallback (or its removal) is a visible, deliberate decision, not a " +
    "silent regression in either direction.",
  { skip: process.platform !== "win32" },
  async () => {
    const result = await runProcess({
      command: "multi-loopr-definitely-not-a-real-binary-xyz",
      args: ["--version"],
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });
    // What every actual Phase 1 caller relies on (preflight.ts's parse* functions all key on
    // `exitCode !== 0`) continues to hold regardless of which of the two paths above is taken.
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.timedOut, false);
  },
);

test("stdout/stderr are captured and exitCode 0 is reported for a real, trivial subprocess", async () => {
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('hello'); process.exitCode = 0;"],
    cwd: process.cwd(),
    timeoutMs: 10_000,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello");
  assert.equal(result.timedOut, false);
});

test("a nonzero real exit code is reported faithfully, not coerced to null or to a thrown error", async () => {
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", "process.exitCode = 7;"],
    cwd: process.cwd(),
    timeoutMs: 10_000,
  });
  assert.equal(result.exitCode, 7);
  assert.equal(result.signal, null);
});

test("[DET, FM7] a process that blocks past timeoutMs is killed and resolves with timedOut: true, never success", async () => {
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 60_000);"],
    cwd: process.cwd(),
    timeoutMs: 300,
  });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
});

test("[DET, FM7] stdin is closed immediately (never inherited) when no stdin payload is given, so a reading child sees EOF rather than hanging", async () => {
  const result = await runProcess({
    command: process.execPath,
    args: [
      "-e",
      "let n = 0; process.stdin.on('data', (c) => { n += c.length; }); " +
        "process.stdin.on('end', () => { process.stdout.write(String(n)); process.exitCode = 0; });",
    ],
    cwd: process.cwd(),
    timeoutMs: 10_000,
    stdin: null,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "0");
  assert.equal(result.timedOut, false);
});

test("a string stdin payload is written to the child and the pipe is closed", async () => {
  const result = await runProcess({
    command: process.execPath,
    args: [
      "-e",
      "let buf = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => { buf += c; }); " +
        "process.stdin.on('end', () => { process.stdout.write(buf); process.exitCode = 0; });",
    ],
    cwd: process.cwd(),
    timeoutMs: 10_000,
    stdin: "hello from the parent",
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello from the parent");
});

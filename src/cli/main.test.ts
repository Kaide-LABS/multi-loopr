// Implements PHASE_1_SPEC.md §1.6 -- main.test.ts
// Covers §8 acceptance criteria #13-18.
//
// Each case spawns a real `node src/cli/main.ts ...` child process via the sanctioned
// `runProcess` wrapper (src/util/exec.ts) -- this is the most faithful way to test the acceptance
// criteria, which are themselves phrased as literal CLI invocations, and it avoids the hazard of
// globally monkey-patching `process.stdout.write` across an `await` boundary while node:test's own
// reporter is concurrently writing lifecycle events to the very same stream.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import pkg from "../../package.json" with { type: "json" };
import { runProcess } from "../util/exec.ts";
import { DoctorReport } from "./doctor.ts";
import { renderHumanReport } from "./main.ts";

const MAIN_TS_PATH = fileURLToPath(new URL("./main.ts", import.meta.url));
const RUN_TIMEOUT_MS = 30_000;

async function runMain(args: readonly string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const result = await runProcess({
    command: process.execPath,
    args: [MAIN_TS_PATH, ...args],
    cwd: process.cwd(),
    timeoutMs: RUN_TIMEOUT_MS,
  });
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

test("--version prints the package version to stdout only and exits 0", async () => {
  const { exitCode, stdout, stderr } = await runMain(["--version"]);
  assert.equal(exitCode, 0);
  assert.equal(stdout, `${pkg.version}\n`);
  assert.equal(stderr, "");
});

test("-v is an alias for --version", async () => {
  const { exitCode, stdout } = await runMain(["-v"]);
  assert.equal(exitCode, 0);
  assert.equal(stdout, `${pkg.version}\n`);
});

test("--help prints usage to stdout only and exits 0", async () => {
  const { exitCode, stdout, stderr } = await runMain(["--help"]);
  assert.equal(exitCode, 0);
  assert.match(stdout, /^Usage: multi-loopr/);
  assert.equal(stderr, "");
});

test("no arguments at all behaves like --help", async () => {
  const { exitCode, stdout } = await runMain([]);
  assert.equal(exitCode, 0);
  assert.match(stdout, /^Usage: multi-loopr/);
});

test("-h is an alias for --help", async () => {
  const { exitCode, stdout } = await runMain(["-h"]);
  assert.equal(exitCode, 0);
  assert.match(stdout, /^Usage: multi-loopr/);
});

test("an unknown command prints to stderr only and exits 2", async () => {
  const { exitCode, stdout, stderr } = await runMain(["frobnicate"]);
  assert.equal(exitCode, 2);
  assert.equal(stdout, "");
  assert.notEqual(stderr, "");
});

test("an unknown doctor flag is a usage error (exit 2)", async () => {
  const { exitCode, stderr } = await runMain(["doctor", "--not-a-real-flag"]);
  assert.equal(exitCode, 2);
  assert.match(stderr, /Unknown flag/);
});

test("doctor --boundary --providers exits 2 (mutually exclusive)", async () => {
  const { exitCode, stderr } = await runMain(["doctor", "--boundary", "--providers"]);
  assert.equal(exitCode, 2);
  assert.match(stderr, /mutually exclusive/);
});

test("doctor --json emits a single JSON object on stdout satisfying DoctorReport, with providers.length === 2", async () => {
  const { stdout, stderr } = await runMain(["doctor", "--json"]);
  assert.equal(stderr, "");
  const parsed: unknown = JSON.parse(stdout);
  const report = DoctorReport.parse(parsed);
  assert.equal(report.providers.length, 2);
});

test("doctor --boundary --json exits 0 on this clean repo and reports zero violations", async () => {
  const { exitCode, stdout } = await runMain(["doctor", "--boundary", "--json"]);
  assert.equal(exitCode, 0);
  const report = DoctorReport.parse(JSON.parse(stdout));
  assert.deepStrictEqual(report.boundary.violations, []);
});

test("doctor --providers exits 3 on this machine and names Codex specifically with actionable guidance (§8 #18)", async () => {
  const { exitCode, stdout } = await runMain(["doctor", "--providers", "--json"]);
  assert.equal(exitCode, 3);
  const report = DoctorReport.parse(JSON.parse(stdout));
  const claude = report.providers.find((p) => p.provider === "claude-code");
  const codex = report.providers.find((p) => p.provider === "codex-cli");
  assert.equal(claude?.authenticated, true);
  assert.equal(codex?.authenticated, false);
  assert.ok(codex && codex.problems.length > 0, "expected codex-cli to carry at least one problem");
  assert.ok(report.problems.some((p) => p.includes("Codex")), "expected a problem naming Codex specifically");
});

/**
 * A minimal, valid {@link DoctorReport} carrying exactly one provider in the requested credential
 * state. Constructed literally (never probed) because an indeterminate probe cannot be provoked
 * from this machine's real CLIs on demand -- the same constructed-input approach `preflight.test.ts`
 * uses for the `parse*` functions.
 */
function reportWithAuthState(authState: "authenticated" | "unauthenticated" | "indeterminate"): DoctorReport {
  return DoctorReport.parse({
    schema_version: 1,
    generated_at: "2026-08-16T00:00:00.000Z",
    ok: authState === "authenticated",
    exit_code: authState === "authenticated" ? 0 : 3,
    toolchain: {
      node: { found: true, version: "24.0.0", inRange: true },
      git: { found: true, version: "2.54.0", inRange: true },
    },
    providers: [
      {
        provider: "codex-cli",
        cliFound: true,
        version: "codex-cli 0.128.0",
        versionInRange: true,
        authenticated: authState === "authenticated",
        authState,
        problems: [],
      },
    ],
    boundary: { filesScanned: 0, violations: [] },
    lock: { acquirable: true, detail: "not checked" },
    problems: [],
  });
}

test("DoctorReport rejects a providers[] entry with no authState (the new field is part of the schema)", () => {
  const valid = reportWithAuthState("unauthenticated");
  const provider = valid.providers[0];
  assert.ok(provider !== undefined);
  const { authState: _dropped, ...withoutAuthState } = provider;
  assert.equal(DoctorReport.safeParse({ ...valid, providers: [withoutAuthState] }).success, false);
});

test("doctor's human-readable output distinguishes an indeterminate probe from a genuine sign-in failure", () => {
  const unauthenticated = renderHumanReport(reportWithAuthState("unauthenticated"));
  const indeterminate = renderHumanReport(reportWithAuthState("indeterminate"));
  const authenticated = renderHumanReport(reportWithAuthState("authenticated"));

  // The whole point: three states, three distinct operator-facing lines.
  assert.notEqual(indeterminate, unauthenticated);
  assert.notEqual(indeterminate, authenticated);
  assert.notEqual(unauthenticated, authenticated);

  assert.match(unauthenticated, /codex-cli: .*not authenticated/);
  assert.match(indeterminate, /codex-cli: .*UNKNOWN/);
  // An indeterminate result must never render as the sign-in-failure wording, or an operator will
  // chase a credential problem that does not exist (the Windows cmd.exe defect's exact symptom).
  assert.doesNotMatch(indeterminate, /not authenticated/);
  assert.match(indeterminate, /NOT a confirmed sign-in failure/);

  // The `authenticated` line stays byte-identical to what it has always been.
  assert.match(authenticated, /codex-cli: codex-cli 0\.128\.0 \(in range\), authenticated\n/);
});

test("doctor (no flags) runs the full report and exits per §4.3 precedence", async () => {
  const { exitCode, stdout } = await runMain(["doctor"]);
  assert.match(stdout, /^multi-loopr doctor --/);
  // On this machine Codex is unauthenticated (preflight failure, exit 3) and the boundary scan is
  // clean, so the only candidate exit code is 3.
  assert.equal(exitCode, 3);
});

// Implements PHASE_1_SPEC.md §1.6 -- preflight.test.ts
// Covers version parsing, range checking, and auth-probe interpretation. The interpretation tests
// use literally-constructed fake RawInvocationResult objects (see preflight.ts's parse* functions)
// rather than spawning real processes or mocking node:child_process.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { RawInvocationResult } from "../domain/run.ts";
import {
  checkGitAvailable,
  checkNodeVersion,
  inRange,
  parseClaudeAuthResult,
  parseCodexAuthResult,
  parseProviderCliVersionResult,
  parseSemverish,
  PROVIDER_VERSION_RANGES,
  runPreflight,
  TOOL_VERSION_RANGES,
} from "./preflight.ts";

function fakeResult(overrides: Partial<RawInvocationResult> = {}): RawInvocationResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    durationMs: 1,
    timedOut: false,
    ...overrides,
  };
}

test("parseSemverish extracts MAJOR.MINOR.PATCH from real observed version banners", () => {
  assert.deepStrictEqual(parseSemverish("2.1.211 (Claude Code)"), { major: 2, minor: 1, patch: 211 });
  assert.deepStrictEqual(parseSemverish("codex-cli 0.128.0"), { major: 0, minor: 128, patch: 0 });
  assert.deepStrictEqual(parseSemverish("git version 2.54.0.windows.1"), { major: 2, minor: 54, patch: 0 });
});

test("parseSemverish returns null when no triple is present", () => {
  assert.equal(parseSemverish("not a version"), null);
  assert.equal(parseSemverish(""), null);
});

test("inRange is inclusive of min and exclusive of max", () => {
  assert.equal(inRange("2.1.200", "2.1.200", "3.0.0"), true);
  assert.equal(inRange("2.1.211", "2.1.200", "3.0.0"), true);
  assert.equal(inRange("3.0.0", "2.1.200", "3.0.0"), false);
  assert.equal(inRange("2.1.199", "2.1.200", "3.0.0"), false);
});

test("inRange is false when any operand fails to parse", () => {
  assert.equal(inRange("garbage", "2.1.200", "3.0.0"), false);
});

test("PROVIDER_VERSION_RANGES and TOOL_VERSION_RANGES are declared in exactly this module", () => {
  assert.deepStrictEqual(Object.keys(PROVIDER_VERSION_RANGES).sort(), ["claude-code", "codex-cli"]);
  assert.deepStrictEqual(Object.keys(TOOL_VERSION_RANGES).sort(), ["git", "node"]);
});

test("checkNodeVersion reports the running Node.js version as found and in range", () => {
  const result = checkNodeVersion();
  assert.equal(result.found, true);
  assert.equal(result.version, process.versions.node);
  assert.equal(result.inRange, true);
});

test("checkGitAvailable reports the real, locally installed git as found and in range", async () => {
  const dir = await mkdtemp(`${tmpdir()}/multi-loopr-preflight-test-`);
  try {
    const result = await checkGitAvailable(dir);
    assert.equal(result.found, true);
    assert.equal(result.inRange, true);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("parseProviderCliVersionResult: exit 0 -> found with trimmed stdout", () => {
  const parsed = parseProviderCliVersionResult(fakeResult({ exitCode: 0, stdout: "2.1.211 (Claude Code)\n" }));
  assert.deepStrictEqual(parsed, { found: true, version: "2.1.211 (Claude Code)" });
});

test("parseProviderCliVersionResult: non-zero exit -> not found", () => {
  const parsed = parseProviderCliVersionResult(fakeResult({ exitCode: null, stderr: "ENOENT" }));
  assert.deepStrictEqual(parsed, { found: false, version: null });
});

test("parseClaudeAuthResult: exit 0 with loggedIn: true -> authenticated", () => {
  const parsed = parseClaudeAuthResult(
    fakeResult({ exitCode: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) }),
  );
  assert.equal(parsed.authenticated, true);
});

test("parseClaudeAuthResult: exit 0 with loggedIn: false -> not authenticated", () => {
  const parsed = parseClaudeAuthResult(fakeResult({ exitCode: 0, stdout: JSON.stringify({ loggedIn: false }) }));
  assert.equal(parsed.authenticated, false);
});

test("parseClaudeAuthResult: non-JSON stdout -> unauthenticated, not a crash", () => {
  const parsed = parseClaudeAuthResult(fakeResult({ exitCode: 0, stdout: "not json at all" }));
  assert.equal(parsed.authenticated, false);
  assert.match(parsed.detail, /unrecognised/);
});

test("parseClaudeAuthResult: non-zero exit -> not authenticated", () => {
  const parsed = parseClaudeAuthResult(fakeResult({ exitCode: 1, stdout: "" }));
  assert.equal(parsed.authenticated, false);
});

test("parseClaudeAuthResult: CLI absent (ENOENT-shaped result) -> not authenticated, no crash", () => {
  const parsed = parseClaudeAuthResult(fakeResult({ exitCode: null, stdout: "", stderr: "spawn claude ENOENT" }));
  assert.equal(parsed.authenticated, false);
});

test("parseCodexAuthResult: exit 0 -> authenticated regardless of stdout shape", () => {
  const parsed = parseCodexAuthResult(fakeResult({ exitCode: 0, stdout: "" }), {});
  assert.equal(parsed.authenticated, true);
});

test("parseCodexAuthResult: non-zero exit, no API key env var -> not authenticated", () => {
  const parsed = parseCodexAuthResult(fakeResult({ exitCode: 1, stdout: "Not logged in" }), {});
  assert.equal(parsed.authenticated, false);
});

test("parseCodexAuthResult: non-zero exit, CODEX_API_KEY set -> authenticated via env var", () => {
  const parsed = parseCodexAuthResult(fakeResult({ exitCode: 1 }), { CODEX_API_KEY: "sk-fake-for-test" });
  assert.equal(parsed.authenticated, true);
  assert.match(parsed.detail, /API key/);
});

test("parseCodexAuthResult: non-zero exit, OPENAI_API_KEY set -> authenticated via env var", () => {
  const parsed = parseCodexAuthResult(fakeResult({ exitCode: 1 }), { OPENAI_API_KEY: "sk-fake-for-test" });
  assert.equal(parsed.authenticated, true);
});

test("parseCodexAuthResult: CLI absent (ENOENT-shaped result), no env var -> not authenticated, no crash", () => {
  const parsed = parseCodexAuthResult(fakeResult({ exitCode: null, stderr: "spawn codex ENOENT" }), {});
  assert.equal(parsed.authenticated, false);
});

test("runPreflight always probes both providers, even though on this machine only one is authenticated", async () => {
  const dir = await mkdtemp(`${tmpdir()}/multi-loopr-preflight-test-`);
  try {
    const summary = await runPreflight(dir);
    assert.equal(summary.providers.length, 2);
    assert.deepStrictEqual(
      summary.providers.map((p) => p.provider).sort(),
      ["claude-code", "codex-cli"],
    );
    // This machine's real, currently-reproducible state (PHASE_1_SPEC.md §8 acceptance check #18):
    // Claude Code is authenticated, Codex is not.
    const claude = summary.providers.find((p) => p.provider === "claude-code");
    const codex = summary.providers.find((p) => p.provider === "codex-cli");
    assert.equal(claude?.authenticated, true);
    assert.equal(codex?.authenticated, false);
    assert.equal(summary.ok, false);
    assert.ok(summary.problems.some((p) => p.includes("Codex")));
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

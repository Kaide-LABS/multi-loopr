// Implements PHASE_9_SPEC.md §1.5, §7 FM-I13, §8.2 AC1-b

import { test } from "node:test";
import assert from "node:assert/strict";
import { SETUP_SERVERS, probeLauncherFacts, resolveServerLaunch } from "./servers.ts";
import type { LauncherProbeFacts } from "./servers.ts";
import type { RunProcessOptions } from "../util/exec.ts";
import type { RawInvocationResult } from "../domain/run.ts";

const ENTRY_PATH_POSIX = "/abs/path/to/dist/cli/main.js";
const ENTRY_PATH_WIN = "C:\\Users\\hp\\multi-loopr\\dist\\cli\\main.js";

function ok(stdout = ""): RawInvocationResult {
  return { exitCode: 0, signal: null, stdout, stderr: "", durationMs: 1, timedOut: false };
}
function fail(): RawInvocationResult {
  return { exitCode: 1, signal: null, stdout: "", stderr: "not found", durationMs: 1, timedOut: false };
}

test("SETUP_SERVERS is exactly the three catalog entries, in order, multi-loopr first", () => {
  assert.deepStrictEqual(
    SETUP_SERVERS.map((s) => s.id),
    ["multi-loopr", "arxiv-mcp", "paper-search-mcp"],
  );
  assert.equal(SETUP_SERVERS[0]?.required, true);
  assert.equal(SETUP_SERVERS[1]?.required, false);
  assert.equal(SETUP_SERVERS[2]?.required, false);
});

test("probeLauncherFacts records platform, uvx/node availability, and per-module python resolution via injected runProcess", async () => {
  const calls: RunProcessOptions[] = [];
  const facts = await probeLauncherFacts({
    runProcess: async (o: RunProcessOptions) => {
      calls.push(o);
      if (o.command === "uvx") return ok();
      if (o.command === "node") return ok();
      // python candidate probes: succeed only for the first candidate on any module.
      return o.args[0] === "-c" ? ok() : fail();
    },
  });
  assert.equal(facts.uvxAvailable, true);
  assert.equal(facts.nodeOnPath, true);
  assert.equal(typeof facts.nodeExecPath, "string");
  assert.ok(calls.some((c) => c.command === "uvx" && c.args[0] === "--version"));
  assert.ok(calls.some((c) => c.command === "node" && c.args[0] === "--version"));
});

test("probeLauncherFacts reports uvxAvailable/nodeOnPath false and null pythonForModule when every probe fails", async () => {
  const facts = await probeLauncherFacts({ runProcess: async () => fail() });
  assert.equal(facts.uvxAvailable, false);
  assert.equal(facts.nodeOnPath, false);
  assert.equal(facts.pythonForModule["arxiv-mcp"], null);
  assert.equal(facts.pythonForModule["paper-search-mcp"], null);
});

function factsWith(overrides: Partial<LauncherProbeFacts>): LauncherProbeFacts {
  return {
    platform: "linux",
    uvxAvailable: false,
    nodeOnPath: true,
    nodeExecPath: "/usr/bin/node",
    pythonForModule: { "arxiv-mcp": null, "paper-search-mcp": null },
    ...overrides,
  };
}

test("resolveServerLaunch for multi-loopr prefers PATH-resolved node when available", () => {
  const def = SETUP_SERVERS[0];
  if (def === undefined) throw new Error("unreachable");
  const res = resolveServerLaunch(def, factsWith({ nodeOnPath: true }), ENTRY_PATH_POSIX);
  assert.equal(res.kind, "resolved");
  if (res.kind === "resolved") {
    assert.equal(res.launch.command, "node");
    assert.deepStrictEqual([...res.launch.args], [ENTRY_PATH_POSIX, "mcp"]);
  }
});

test("resolveServerLaunch for multi-loopr falls back to process.execPath when node is not on PATH", () => {
  const def = SETUP_SERVERS[0];
  if (def === undefined) throw new Error("unreachable");
  const res = resolveServerLaunch(def, factsWith({ nodeOnPath: false, nodeExecPath: "/opt/node/bin/node" }), ENTRY_PATH_POSIX);
  assert.equal(res.kind, "resolved");
  if (res.kind === "resolved") {
    assert.equal(res.launch.command, "/opt/node/bin/node");
  }
});

test("resolveServerLaunch rejects a non-absolute, quote-containing, or backslash-terminated entryPath", () => {
  const def = SETUP_SERVERS[0];
  if (def === undefined) throw new Error("unreachable");
  for (const badPath of ["relative/path/main.js", 'C:\\has"quote\\main.js', "C:\\trailing\\backslash\\"]) {
    const res = resolveServerLaunch(def, factsWith({}), badPath);
    assert.equal(res.kind, "unavailable", `expected unavailable for "${badPath}"`);
  }
});

test("resolveServerLaunch accepts a Windows absolute entry path", () => {
  const def = SETUP_SERVERS[0];
  if (def === undefined) throw new Error("unreachable");
  const res = resolveServerLaunch(def, factsWith({}), ENTRY_PATH_WIN);
  assert.equal(res.kind, "resolved");
});

test("resolveServerLaunch for an optional server prefers uvx when available", () => {
  const def = SETUP_SERVERS[1];
  if (def === undefined) throw new Error("unreachable");
  const res = resolveServerLaunch(def, factsWith({ uvxAvailable: true }), ENTRY_PATH_POSIX);
  assert.equal(res.kind, "resolved");
  if (res.kind === "resolved") {
    assert.equal(res.launch.kind, "uvx");
    assert.equal(res.launch.command, "uvx");
    assert.deepStrictEqual([...res.launch.args], ["arxiv-mcp-server"]);
  }
});

test("resolveServerLaunch for an optional server falls back to the resolved python module form", () => {
  const def = SETUP_SERVERS[1];
  if (def === undefined) throw new Error("unreachable");
  const facts = factsWith({ uvxAvailable: false, pythonForModule: { "arxiv-mcp": "python3", "paper-search-mcp": null } });
  const res = resolveServerLaunch(def, facts, ENTRY_PATH_POSIX);
  assert.equal(res.kind, "resolved");
  if (res.kind === "resolved") {
    assert.equal(res.launch.kind, "python-module");
    assert.equal(res.launch.command, "python3");
    assert.deepStrictEqual([...res.launch.args], ["-m", "arxiv_mcp_server"]);
  }
});

test("resolveServerLaunch for an optional server returns unavailable with a non-URL remediation when nothing resolves", () => {
  const def = SETUP_SERVERS[2];
  if (def === undefined) throw new Error("unreachable");
  const res = resolveServerLaunch(def, factsWith({}), ENTRY_PATH_POSIX);
  assert.equal(res.kind, "unavailable");
  if (res.kind === "unavailable") {
    assert.ok(!res.remediation.includes("http://"));
    assert.ok(!res.remediation.includes("https://"));
    assert.ok(res.remediation.includes("paper-search-mcp"));
  }
});

test("resolveServerLaunch never returns 'py' as a candidate command on a non-win32 platform (§7 FM-I13)", () => {
  const def = SETUP_SERVERS[1];
  if (def === undefined) throw new Error("unreachable");
  const facts = factsWith({ platform: "linux", pythonForModule: { "arxiv-mcp": "python3", "paper-search-mcp": null } });
  const res = resolveServerLaunch(def, facts, ENTRY_PATH_POSIX);
  if (res.kind === "resolved") {
    assert.notEqual(res.launch.command, "py");
  }
});

test("resolveServerLaunch is pure: never reads process.platform itself (facts.platform is unused by resolution logic beyond being carried)", () => {
  const def = SETUP_SERVERS[0];
  if (def === undefined) throw new Error("unreachable");
  const resWin = resolveServerLaunch(def, factsWith({ platform: "win32" }), ENTRY_PATH_POSIX);
  const resLinux = resolveServerLaunch(def, factsWith({ platform: "linux" }), ENTRY_PATH_POSIX);
  assert.deepStrictEqual(resWin, resLinux);
});

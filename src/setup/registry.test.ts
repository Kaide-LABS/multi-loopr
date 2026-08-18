// Implements PHASE_9_SPEC.md §1.5
// Covers buildMcpAddArgs/buildMcpGetArgs (pure argv, FM-I3/FM-I5), interpretMcpGetResult/
// interpretMcpAddResult, decideServerOutcome's totality table (AC-D1), and
// probeOptionalResearchServers/renderOptionalResearchNote (AC3, FM-I9).

import { test } from "node:test";
import assert from "node:assert/strict";
import type { RawInvocationResult } from "../domain/run.ts";
import type { RunProcessOptions } from "../util/exec.ts";
import type { OptionalServerState, SetupServerId } from "../domain/setup.ts";
import { SETUP_SERVER_IDS, SETUP_OUTCOMES } from "../domain/setup.ts";
import { SETUP_SERVERS, resolveServerLaunch } from "./servers.ts";
import type { LauncherProbeFacts } from "./servers.ts";
import {
  buildMcpAddArgs,
  buildMcpGetArgs,
  decideServerOutcome,
  interpretMcpAddResult,
  interpretMcpGetResult,
  probeOptionalResearchServers,
  renderOptionalResearchNote,
} from "./registry.ts";

function fakeResult(overrides: Partial<RawInvocationResult> = {}): RawInvocationResult {
  return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false, ...overrides };
}

// ---------------------------------------------------------------------------------------------
// buildMcpAddArgs / buildMcpGetArgs
// ---------------------------------------------------------------------------------------------

test("buildMcpAddArgs emits the exact fixed argv shape, --scope user unconditionally", () => {
  const args = buildMcpAddArgs("multi-loopr", { kind: "node", command: "node", args: ["/x/main.js", "mcp"] });
  assert.deepStrictEqual(args, ["mcp", "add", "--scope", "user", "--transport", "stdio", "multi-loopr", "--", "node", "/x/main.js", "mcp"]);
});

test("buildMcpGetArgs emits exactly ['mcp', 'get', name]", () => {
  assert.deepStrictEqual(buildMcpGetArgs("arxiv-mcp"), ["mcp", "get", "arxiv-mcp"]);
});

const FORBIDDEN_TOKENS = ["http", "sse", "--transport http", "--transport sse", "--header", "--client-id", "--client-secret", "--callback-port", "-e", "--env", "login", "logout", "://"];

test("FM-I5: every (server, LaunchResolution) argv the catalog can produce contains none of the forbidden tokens", () => {
  const facts: LauncherProbeFacts = {
    platform: "linux",
    uvxAvailable: true,
    nodeOnPath: true,
    nodeExecPath: "/usr/bin/node",
    pythonForModule: { "arxiv-mcp": "python3", "paper-search-mcp": "python3" },
  };
  const factsVariants: LauncherProbeFacts[] = [
    facts,
    { ...facts, uvxAvailable: false },
    { ...facts, uvxAvailable: false, pythonForModule: {} },
    { ...facts, nodeOnPath: false },
  ];
  for (const f of factsVariants) {
    for (const def of SETUP_SERVERS) {
      const resolution = resolveServerLaunch(def, f, "/home/op/multi-loopr/dist/cli/main.js");
      if (resolution.kind !== "resolved") continue;
      const addArgs = buildMcpAddArgs(def.id, resolution.launch).join(" ");
      const getArgs = buildMcpGetArgs(def.id).join(" ");
      for (const token of FORBIDDEN_TOKENS) {
        assert.ok(!addArgs.includes(token), `add argv "${addArgs}" must not contain "${token}"`);
        assert.ok(!getArgs.includes(token), `get argv "${getArgs}" must not contain "${token}"`);
      }
      assert.deepStrictEqual(addArgs.split(" ").slice(0, 6), ["mcp", "add", "--scope", "user", "--transport", "stdio"]);
    }
  }
});

test("FM-I3: buildMcpAddArgs takes no scope parameter and never emits local/project", () => {
  for (const id of SETUP_SERVER_IDS) {
    const args = buildMcpAddArgs(id, { kind: "node", command: "node", args: [] });
    assert.ok(!args.includes("local"));
    assert.ok(!args.includes("project"));
  }
});

// ---------------------------------------------------------------------------------------------
// interpretMcpGetResult / interpretMcpAddResult
// ---------------------------------------------------------------------------------------------

test("interpretMcpGetResult: exit 0 -> present, exit 1 -> absent, timeout/other -> indeterminate", () => {
  assert.equal(interpretMcpGetResult(fakeResult({ exitCode: 0 })), "present");
  assert.equal(interpretMcpGetResult(fakeResult({ exitCode: 1 })), "absent");
  assert.equal(interpretMcpGetResult(fakeResult({ timedOut: true })), "indeterminate");
  assert.equal(interpretMcpGetResult(fakeResult({ exitCode: 2 })), "indeterminate");
  assert.equal(interpretMcpGetResult(fakeResult({ exitCode: null })), "indeterminate");
});

test("interpretMcpAddResult: exit 0 -> ok, timeout -> indeterminate, otherwise -> failed", () => {
  assert.equal(interpretMcpAddResult(fakeResult({ exitCode: 0 })), "ok");
  assert.equal(interpretMcpAddResult(fakeResult({ timedOut: true })), "indeterminate");
  assert.equal(interpretMcpAddResult(fakeResult({ exitCode: 1 })), "failed");
  assert.equal(interpretMcpAddResult(fakeResult({ exitCode: null })), "failed");
});

// ---------------------------------------------------------------------------------------------
// decideServerOutcome -- AC-D1 totality table
// ---------------------------------------------------------------------------------------------

test("AC-D1: decideServerOutcome's minimum-required table rows all hold", () => {
  assert.equal(decideServerOutcome("present", "not-attempted", "not-attempted"), "already-registered");
  assert.equal(decideServerOutcome("indeterminate", "not-attempted", "not-attempted"), "indeterminate");
  assert.equal(decideServerOutcome("absent", "ok", "present"), "registered");
  assert.equal(decideServerOutcome("absent", "ok", "absent"), "registered-unverified");
  assert.equal(decideServerOutcome("absent", "ok", "indeterminate"), "registered-unverified");
  assert.equal(decideServerOutcome("absent", "failed", "not-attempted"), "failed");
  assert.equal(decideServerOutcome("absent", "indeterminate", "not-attempted"), "indeterminate");
});

test("decideServerOutcome is total over every reachable (pre, add, post) combination and always returns a valid SetupOutcome", () => {
  const preValues: OptionalServerState[] = ["present", "absent", "indeterminate"];
  const addValues: Array<"ok" | "failed" | "indeterminate" | "not-attempted"> = ["ok", "failed", "indeterminate", "not-attempted"];
  const postValues: Array<OptionalServerState | "not-attempted"> = ["present", "absent", "indeterminate", "not-attempted"];
  for (const pre of preValues) {
    for (const add of addValues) {
      for (const post of postValues) {
        const outcome = decideServerOutcome(pre, add, post);
        assert.ok((SETUP_OUTCOMES as readonly string[]).includes(outcome), `unexpected outcome ${outcome} for (${pre},${add},${post})`);
      }
    }
  }
});

test("FM-I1: registered and registered-unverified are genuinely distinct outcomes", () => {
  const registered = decideServerOutcome("absent", "ok", "present");
  const unverified = decideServerOutcome("absent", "ok", "absent");
  assert.equal(registered, "registered");
  assert.equal(unverified, "registered-unverified");
  assert.notEqual(registered, unverified);
});

// ---------------------------------------------------------------------------------------------
// probeOptionalResearchServers / renderOptionalResearchNote
// ---------------------------------------------------------------------------------------------

test("probeOptionalResearchServers returns [] immediately when the claude CLI is not found", async () => {
  const probes = await probeOptionalResearchServers({
    checkProviderCli: async () => ({ found: false, version: null }),
    runProcess: async () => fakeResult({ exitCode: 0 }),
  });
  assert.deepStrictEqual(probes, []);
});

test("probeOptionalResearchServers probes both optional servers concurrently and interprets each", async () => {
  const calledArgs: string[][] = [];
  const probes = await probeOptionalResearchServers({
    checkProviderCli: async () => ({ found: true, version: "2.1.211" }),
    runProcess: async (o: RunProcessOptions) => {
      calledArgs.push([...o.args]);
      const name = o.args[o.args.length - 1] as SetupServerId;
      return fakeResult({ exitCode: name === "arxiv-mcp" ? 0 : 1 });
    },
  });
  assert.equal(probes.length, 2);
  const byId = new Map(probes.map((p) => [p.id, p.state]));
  assert.equal(byId.get("arxiv-mcp"), "present");
  assert.equal(byId.get("paper-search-mcp"), "absent");
  assert.ok(calledArgs.some((a) => a.join(" ") === "mcp get arxiv-mcp"));
  assert.ok(calledArgs.some((a) => a.join(" ") === "mcp get paper-search-mcp"));
});

test("probeOptionalResearchServers never throws -- an unexpected error yields two indeterminate probes", async () => {
  const probes = await probeOptionalResearchServers({
    checkProviderCli: async () => {
      throw new Error("boom");
    },
  });
  assert.equal(probes.length, 2);
  assert.ok(probes.every((p) => p.state === "indeterminate"));
});

test("FM-I9: renderOptionalResearchNote returns null when empty or every probe is present", () => {
  assert.equal(renderOptionalResearchNote([]), null);
  assert.equal(
    renderOptionalResearchNote([
      { id: "arxiv-mcp", state: "present", detail: "" },
      { id: "paper-search-mcp", state: "present", detail: "" },
    ]),
    null,
  );
});

test("FM-I9: renderOptionalResearchNote's non-null output names each server, says 'does not require', and gives the re-run line, with no failure-connotation words", () => {
  const note = renderOptionalResearchNote([
    { id: "arxiv-mcp", state: "absent", detail: "" },
    { id: "paper-search-mcp", state: "absent", detail: "" },
  ]);
  assert.notEqual(note, null);
  const text = note ?? "";
  assert.ok(text.includes("arxiv-mcp"));
  assert.ok(text.includes("paper-search-mcp"));
  assert.ok(text.includes("does not require"));
  assert.ok(text.includes("multi-loopr setup"));
  for (const word of ["error", "ERROR", "failed", "problem", "missing dependency", "required"]) {
    assert.ok(!text.includes(word), `note must not contain "${word}"`);
  }
});

test("FM-I9: an indeterminate probe's rendered note does not claim the server is absent", () => {
  const note = renderOptionalResearchNote([{ id: "arxiv-mcp", state: "indeterminate", detail: "" }]);
  assert.notEqual(note, null);
  const text = note ?? "";
  assert.ok(!text.includes("is not registered"));
  assert.ok(text.includes("could not be determined"));
});

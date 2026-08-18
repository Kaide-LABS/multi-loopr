// Implements PHASE_9_SPEC.md §1.5, §8.2 AC1, §8.3 AC2, §8.4 AC3
// Covers runSetupCommand end-to-end via injected deps, computeSetupExitCode, and
// renderSetupHumanReport.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { RawInvocationResult } from "../domain/run.ts";
import type { RunProcessOptions } from "../util/exec.ts";
import type { SetupOutcome } from "../domain/setup.ts";
import { computeSetupExitCode, renderSetupHumanReport, runSetupCommand } from "./setup.ts";
import type { SetupReport } from "./setup.ts";
import { ExitCode } from "../domain/errors.ts";
import { SETUP_OUTCOMES } from "../domain/setup.ts";
import { DoctorReport } from "./doctor.ts";
import { DriveReport } from "./drive.ts";
import { RunReport } from "./run.ts";

const ENTRY_PATH = "/home/op/multi-loopr/dist/cli/main.js";

function fakeResult(overrides: Partial<RawInvocationResult> = {}): RawInvocationResult {
  return { exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false, ...overrides };
}

test("AC1-a: one setup run configures all three servers -- exact 9-call argv sequence, all registered", async () => {
  // Pre-check must report absent (exit 1) for add to be attempted; post-check must report present.
  // We need per-call sequencing: 1st get (pre) -> 1, 2nd get (post) -> 0.
  const getCallCounts = new Map<string, number>();
  const runProcess = async (o: RunProcessOptions): Promise<RawInvocationResult> => {
    if (o.command === "uvx") return fakeResult({ exitCode: 0 });
    if (o.command === "node") return fakeResult({ exitCode: 0 });
    const sub = o.args[1];
    if (sub === "get") {
      const name = o.args[2] as string;
      const idx = getCallCounts.get(name) ?? 0;
      getCallCounts.set(name, idx + 1);
      return fakeResult({ exitCode: idx === 0 ? 1 : 0 });
    }
    if (sub === "add") {
      return fakeResult({ exitCode: 0 });
    }
    return fakeResult({ exitCode: 1 });
  };
  const recordedCalls: RunProcessOptions[] = [];
  const wrapped = async (o: RunProcessOptions): Promise<RawInvocationResult> => {
    recordedCalls.push(o);
    return runProcess(o);
  };

  const { report, exitCode } = await runSetupCommand(
    { json: false, entryPath: ENTRY_PATH },
    { runProcess: wrapped, checkProviderCli: async () => ({ found: true, version: "2.1.211" }) },
  );

  assert.equal(exitCode, ExitCode.OK);
  assert.equal(report.ok, true);
  assert.equal(report.scope, "user");
  assert.deepStrictEqual(
    report.servers.map((s) => s.outcome),
    ["registered", "registered", "registered"],
  );

  const allArgvs = recordedCalls.map((c) => [c.command, ...c.args].join(" "));
  assert.ok(allArgvs.includes("uvx --version"));
  assert.ok(allArgvs.includes("node --version"));

  // Since `probeLauncherFacts` always probes each optional server's python-module candidates
  // regardless of uvx's own availability (§6.3 step 4 is unconditional), only the `claude`-bound
  // calls are asserted for exact sequence here -- the launcher-probe calls (uvx/node/python) all
  // happen once, up front, before the per-server loop begins.
  const claudeArgvs = recordedCalls.filter((c) => c.command === "claude").map((c) => c.args.join(" "));
  const expectedNames = ["multi-loopr", "arxiv-mcp", "paper-search-mcp"];
  let i = 0;
  for (const name of expectedNames) {
    assert.ok(claudeArgvs[i]?.startsWith(`mcp get ${name}`), `expected pre-check get for ${name}, got ${claudeArgvs[i]}`);
    assert.ok(claudeArgvs[i + 1]?.startsWith(`mcp add --scope user --transport stdio ${name} --`), `expected add for ${name}, got ${claudeArgvs[i + 1]}`);
    assert.ok(claudeArgvs[i + 2]?.startsWith(`mcp get ${name}`), `expected post-check get for ${name}, got ${claudeArgvs[i + 2]}`);
    i += 3;
  }
  assert.equal(claudeArgvs.length, 9); // 3 servers x (pre-check, add, post-check)
});

test("AC1-b: multi-loopr's command/args reflect nodeOnPath true/false", async () => {
  async function run(nodeExitCode: number): Promise<SetupReport> {
    const runProcess = async (o: RunProcessOptions): Promise<RawInvocationResult> => {
      if (o.command === "uvx") return fakeResult({ exitCode: 1 });
      if (o.command === "node") return fakeResult({ exitCode: nodeExitCode });
      if (o.args[1] === "get") return fakeResult({ exitCode: 1 }); // always absent -> add attempted
      if (o.args[1] === "add") return fakeResult({ exitCode: 0 });
      return fakeResult({ exitCode: 1 });
    };
    const { report } = await runSetupCommand(
      { json: false, entryPath: ENTRY_PATH },
      { runProcess, checkProviderCli: async () => ({ found: true, version: "2.1.211" }) },
    );
    return report;
  }

  const withNode = await run(0);
  const selfWithNode = withNode.servers.find((s) => s.id === "multi-loopr");
  assert.equal(selfWithNode?.command, "node");
  assert.deepStrictEqual(selfWithNode?.args, [ENTRY_PATH, "mcp"]);

  const withoutNode = await run(1);
  const selfWithoutNode = withoutNode.servers.find((s) => s.id === "multi-loopr");
  assert.equal(selfWithoutNode?.command, process.execPath);
});

test("AC1-c precondition: skipped-no-agent-cli when claude CLI is not found -- all three servers skipped, exit PREFLIGHT_FAILED", async () => {
  const { report, exitCode } = await runSetupCommand(
    { json: false, entryPath: ENTRY_PATH },
    { checkProviderCli: async () => ({ found: false, version: null }) },
  );
  assert.equal(exitCode, ExitCode.PREFLIGHT_FAILED);
  assert.equal(report.ok, false);
  assert.deepStrictEqual(
    report.servers.map((s) => s.outcome),
    ["skipped-no-agent-cli", "skipped-no-agent-cli", "skipped-no-agent-cli"],
  );
});

test("AC2-a: an isolated arxiv-mcp add failure is named, and the other two still register; exit_code is OK", async () => {
  const getCallCounts = new Map<string, number>();
  const runProcess = async (o: RunProcessOptions): Promise<RawInvocationResult> => {
    if (o.command === "uvx") return fakeResult({ exitCode: 0 });
    if (o.command === "node") return fakeResult({ exitCode: 0 });
    if (o.args[1] === "get") {
      const name = o.args[2] as string;
      const idx = getCallCounts.get(name) ?? 0;
      getCallCounts.set(name, idx + 1);
      return fakeResult({ exitCode: idx === 0 ? 1 : 0 });
    }
    if (o.args[1] === "add") {
      const name = o.args[6] as string;
      if (name === "arxiv-mcp") return fakeResult({ exitCode: 1, stderr: "distinctive-arxiv-failure" });
      return fakeResult({ exitCode: 0 });
    }
    return fakeResult({ exitCode: 1 });
  };

  const { report, exitCode } = await runSetupCommand(
    { json: false, entryPath: ENTRY_PATH },
    { runProcess, checkProviderCli: async () => ({ found: true, version: "2.1.211" }) },
  );

  assert.equal(report.servers.length, 3);
  const arxiv = report.servers.find((s) => s.id === "arxiv-mcp");
  assert.equal(arxiv?.outcome, "failed");
  assert.ok(arxiv?.detail.includes("1"));
  assert.ok(arxiv?.detail.includes("distinctive-arxiv-failure"));
  const self = report.servers.find((s) => s.id === "multi-loopr");
  const paper = report.servers.find((s) => s.id === "paper-search-mcp");
  assert.equal(self?.outcome, "registered");
  assert.equal(paper?.outcome, "registered");
  assert.equal(exitCode, ExitCode.OK);
  assert.ok(report.notes.some((n) => n.includes("arxiv-mcp")));
  assert.equal(report.problems.length, 0);
});

test("AC2-b: a multi-loopr add failure is fatal (exit SETUP_FAILED), but both optional servers were still attempted and registered", async () => {
  const getCallCounts = new Map<string, number>();
  const addCalls: string[] = [];
  const runProcess = async (o: RunProcessOptions): Promise<RawInvocationResult> => {
    if (o.command === "uvx") return fakeResult({ exitCode: 0 });
    if (o.command === "node") return fakeResult({ exitCode: 0 });
    if (o.args[1] === "get") {
      const name = o.args[2] as string;
      const idx = getCallCounts.get(name) ?? 0;
      getCallCounts.set(name, idx + 1);
      return fakeResult({ exitCode: idx === 0 ? 1 : 0 });
    }
    if (o.args[1] === "add") {
      const name = o.args[6] as string;
      addCalls.push(name);
      if (name === "multi-loopr") return fakeResult({ exitCode: 1, stderr: "self-failure" });
      return fakeResult({ exitCode: 0 });
    }
    return fakeResult({ exitCode: 1 });
  };

  const { report, exitCode } = await runSetupCommand(
    { json: false, entryPath: ENTRY_PATH },
    { runProcess, checkProviderCli: async () => ({ found: true, version: "2.1.211" }) },
  );

  assert.equal(exitCode, ExitCode.SETUP_FAILED);
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((p) => p.includes("multi-loopr")));
  assert.ok(addCalls.includes("arxiv-mcp"));
  assert.ok(addCalls.includes("paper-search-mcp"));
  const arxiv = report.servers.find((s) => s.id === "arxiv-mcp");
  const paper = report.servers.find((s) => s.id === "paper-search-mcp");
  assert.equal(arxiv?.outcome, "registered");
  assert.equal(paper?.outcome, "registered");
});

test("AC2-c (FM-I7): computeSetupExitCode reads only the multi-loopr outcome, never the optional servers'", () => {
  const optionalOutcomes: SetupOutcome[] = [...SETUP_OUTCOMES];
  for (const a of optionalOutcomes) {
    for (const b of optionalOutcomes) {
      void a;
      void b;
    }
  }
  // computeSetupExitCode's signature does not even accept optional-server outcomes -- it is
  // structurally incapable of reading them. Assert its result depends only on selfOutcome/agentCliFound.
  for (const self of ["registered", "already-registered"] as const) {
    assert.equal(computeSetupExitCode({ agentCliFound: true, selfOutcome: self }), ExitCode.OK);
  }
  for (const self of ["failed", "registered-unverified", "skipped-launcher-unavailable", "indeterminate"] as const) {
    assert.equal(computeSetupExitCode({ agentCliFound: true, selfOutcome: self }), ExitCode.SETUP_FAILED);
  }
});

test("AC2-d (FM-I1): multi-loopr add ok but post-add get fails -> registered-unverified, exit SETUP_FAILED, distinct rendering", async () => {
  const getCallCounts = new Map<string, number>();
  const runProcess = async (o: RunProcessOptions): Promise<RawInvocationResult> => {
    if (o.command === "uvx") return fakeResult({ exitCode: 0 });
    if (o.command === "node") return fakeResult({ exitCode: 0 });
    if (o.args[1] === "get") {
      const name = o.args[2] as string;
      const idx = getCallCounts.get(name) ?? 0;
      getCallCounts.set(name, idx + 1);
      if (name === "multi-loopr") {
        // pre-check absent (idx 0), post-check also fails (idx 1)
        return fakeResult({ exitCode: 1 });
      }
      return fakeResult({ exitCode: idx === 0 ? 1 : 0 });
    }
    if (o.args[1] === "add") return fakeResult({ exitCode: 0 });
    return fakeResult({ exitCode: 1 });
  };

  const { report, exitCode } = await runSetupCommand(
    { json: false, entryPath: ENTRY_PATH },
    { runProcess, checkProviderCli: async () => ({ found: true, version: "2.1.211" }) },
  );

  const self = report.servers.find((s) => s.id === "multi-loopr");
  assert.equal(self?.outcome, "registered-unverified");
  assert.equal(exitCode, ExitCode.SETUP_FAILED);

  const registeredReport: SetupReport = { ...report, servers: report.servers.map((s) => (s.id === "multi-loopr" ? { ...s, outcome: "registered" as const } : s)) };
  const failedReport: SetupReport = { ...report, servers: report.servers.map((s) => (s.id === "multi-loopr" ? { ...s, outcome: "failed" as const } : s)) };
  const unverifiedRendered = renderSetupHumanReport(report);
  const registeredRendered = renderSetupHumanReport(registeredReport);
  const failedRendered = renderSetupHumanReport(failedReport);
  assert.notEqual(unverifiedRendered, registeredRendered);
  assert.notEqual(unverifiedRendered, failedRendered);
});

test("FM-I8: both optional servers skipped-launcher-unavailable -> zero problems, ok true, exit_code 0, two notes", async () => {
  const getCallCounts = new Map<string, number>();
  const runProcess = async (o: RunProcessOptions): Promise<RawInvocationResult> => {
    if (o.command === "uvx") return fakeResult({ exitCode: 1 });
    if (o.command === "node") return fakeResult({ exitCode: 0 });
    if (o.command === "py" || o.command === "python" || o.command === "python3") return fakeResult({ exitCode: 1 });
    if (o.args[1] === "get") {
      const name = o.args[2] as string;
      const idx = getCallCounts.get(name) ?? 0;
      getCallCounts.set(name, idx + 1);
      // Only multi-loopr is ever resolved (the two optional servers never reach a `get` call at
      // all, since resolveServerLaunch returns "unavailable" for them first) -- pre absent, post present.
      return fakeResult({ exitCode: idx === 0 ? 1 : 0 });
    }
    if (o.args[1] === "add") return fakeResult({ exitCode: 0 });
    return fakeResult({ exitCode: 1 });
  };
  const { report } = await runSetupCommand(
    { json: false, entryPath: ENTRY_PATH },
    { runProcess, checkProviderCli: async () => ({ found: true, version: "2.1.211" }) },
  );
  assert.equal(report.problems.length, 0);
  assert.equal(report.ok, true);
  assert.equal(report.exit_code, ExitCode.OK);
  assert.equal(report.notes.length, 2);
});

test("FM-I6: an unexpected throw during one server's attempt converts to that server's own indeterminate outcome without stopping the loop", async () => {
  const getCallCounts = new Map<string, number>();
  const runProcess = async (o: RunProcessOptions): Promise<RawInvocationResult> => {
    if (o.command === "uvx") return fakeResult({ exitCode: 0 });
    if (o.command === "node") return fakeResult({ exitCode: 0 });
    if (o.args[1] === "get" && o.args[2] === "arxiv-mcp") {
      throw new Error("simulated unexpected throw");
    }
    if (o.args[1] === "get") {
      const name = o.args[2] as string;
      const idx = getCallCounts.get(name) ?? 0;
      getCallCounts.set(name, idx + 1);
      return fakeResult({ exitCode: idx === 0 ? 1 : 0 });
    }
    if (o.args[1] === "add") return fakeResult({ exitCode: 0 });
    return fakeResult({ exitCode: 1 });
  };
  const { report } = await runSetupCommand(
    { json: false, entryPath: ENTRY_PATH },
    { runProcess, checkProviderCli: async () => ({ found: true, version: "2.1.211" }) },
  );
  assert.equal(report.servers.length, 3);
  const arxiv = report.servers.find((s) => s.id === "arxiv-mcp");
  assert.equal(arxiv?.outcome, "indeterminate");
  const self = report.servers.find((s) => s.id === "multi-loopr");
  const paper = report.servers.find((s) => s.id === "paper-search-mcp");
  assert.equal(self?.outcome, "registered");
  assert.equal(paper?.outcome, "registered");
});

test("FM-I12: an already-registered server issues no add call and its detail is a verbatim stdout slice", async () => {
  const addCalls: string[] = [];
  const runProcess = async (o: RunProcessOptions): Promise<RawInvocationResult> => {
    if (o.command === "uvx") return fakeResult({ exitCode: 0 });
    if (o.command === "node") return fakeResult({ exitCode: 0 });
    if (o.args[1] === "get") return fakeResult({ exitCode: 0, stdout: "Scope: User config\nType: stdio\nStatus: some-status" });
    if (o.args[1] === "add") {
      addCalls.push(o.args[6] as string);
      return fakeResult({ exitCode: 0 });
    }
    return fakeResult({ exitCode: 1 });
  };
  const { report, exitCode } = await runSetupCommand(
    { json: false, entryPath: ENTRY_PATH },
    { runProcess, checkProviderCli: async () => ({ found: true, version: "2.1.211" }) },
  );
  assert.equal(addCalls.length, 0);
  assert.deepStrictEqual(
    report.servers.map((s) => s.outcome),
    ["already-registered", "already-registered", "already-registered"],
  );
  assert.equal(exitCode, ExitCode.OK);
  const self = report.servers.find((s) => s.id === "multi-loopr");
  assert.ok(self?.detail.includes("Scope: User config"));
});

test("renderSetupHumanReport never renders 'registered' as working/connected/ready/verified working", () => {
  const report: SetupReport = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    ok: true,
    exit_code: 0,
    scope: "user",
    agent_cli: { found: true, version: "2.1.211" },
    servers: [
      { id: "multi-loopr", required: true, outcome: "registered", launcher: "node", command: "node", args: [ENTRY_PATH, "mcp"], detail: "d", remediation: null },
      { id: "arxiv-mcp", required: false, outcome: "registered", launcher: "uvx", command: "uvx", args: ["arxiv-mcp-server"], detail: "d", remediation: null },
      { id: "paper-search-mcp", required: false, outcome: "already-registered", launcher: "uvx", command: "uvx", args: ["paper-search-mcp"], detail: "d", remediation: null },
    ],
    problems: [],
    notes: [],
  };
  const rendered = renderSetupHumanReport(report);
  for (const forbidden of ["working", "connected", "verified working", "is running"]) {
    assert.ok(!rendered.toLowerCase().includes(forbidden), `must not render "${forbidden}"`);
  }
  assert.ok(rendered.includes("registered"));
});

test("AC3-c: RunReport/DriveReport/DoctorReport key sets are exactly their literal, unmodified expected sets (scope edge 3)", () => {
  assert.deepStrictEqual(
    Object.keys(RunReport.shape).sort(),
    ["schema_version", "generated_at", "run_id", "phase", "ok", "exit_code", "turns", "halt", "problems", "warnings"].sort(),
  );
  assert.deepStrictEqual(
    Object.keys(DriveReport.shape).sort(),
    [
      "schema_version",
      "generated_at",
      "driver_run_id",
      "starting_phase",
      "target_total_phases",
      "max_phases",
      "ok",
      "exit_code",
      "final_state_id",
      "phases",
      "problems",
    ].sort(),
  );
  assert.deepStrictEqual(
    Object.keys(DoctorReport.shape).sort(),
    ["schema_version", "generated_at", "ok", "exit_code", "toolchain", "providers", "boundary", "lock", "problems"].sort(),
  );
});

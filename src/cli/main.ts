#!/usr/bin/env node
// Implements PHASE_1_SPEC.md §6.11
//
// Argument parsing (hand-rolled, no dependency -- `dependencies` is allowlisted to `zod` alone,
// boundary rule B2), command dispatch, and top-level error -> exit-code mapping. Declared as the
// `bin` entry in package.json.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { ExitCode, InternalError, MultiLooprError, UsageError } from "../domain/errors.ts";
import type { DoctorOptions, DoctorReport } from "./doctor.ts";
import { runDoctor } from "./doctor.ts";
import type { RunCommandOptions, RunReport } from "./run.ts";
import { runRunCommand } from "./run.ts";
import type { EvidenceCommandOptions, EvidenceReport } from "./evidence.ts";
import { runEvidenceCommand } from "./evidence.ts";

const USAGE_TEXT = `Usage: multi-loopr <command> [options]

Commands:
  multi-loopr --version | -v                Print the version and exit.
  multi-loopr --help | -h                   Print this usage text and exit.
  multi-loopr doctor [--json]                Full health check: toolchain, both providers,
                                              boundary scan, and a lock smoke test.
  multi-loopr doctor --boundary [--json]     Boundary scan only (fast, no provider probes).
  multi-loopr doctor --providers [--json]    Provider preflight only.
  multi-loopr run --config <path> [--json]   Dispatch one loopr phase's turn sequence.
  multi-loopr evidence --repo-dir <path> --run-id <uuid> [--final-phase] [--json]
                                              Re-derive AC1/AC2/AC3 evidence for a completed run
                                              from its persisted handoff records.
`;

type Command =
  | { readonly kind: "version" }
  | { readonly kind: "help" }
  | ({ readonly kind: "doctor" } & DoctorOptions)
  | ({ readonly kind: "run" } & RunCommandOptions)
  | ({ readonly kind: "evidence" } & EvidenceCommandOptions);

function parseDoctorArgs(rest: readonly string[]): Command {
  let json = false;
  let boundaryFlag = false;
  let providersFlag = false;

  for (const arg of rest) {
    if (arg === "--json") {
      json = true;
    } else if (arg === "--boundary") {
      boundaryFlag = true;
    } else if (arg === "--providers") {
      providersFlag = true;
    } else {
      throw new UsageError(`Unknown flag for doctor: ${arg}`, { flag: arg });
    }
  }

  if (boundaryFlag && providersFlag) {
    throw new UsageError("doctor --boundary and --providers are mutually exclusive.", {
      flags: ["--boundary", "--providers"],
    });
  }

  const only: DoctorOptions["only"] = boundaryFlag ? "boundary" : providersFlag ? "providers" : "all";
  return { kind: "doctor", json, only };
}

/**
 * Parses `run`'s flags: `--config <path>` (consumes the next argv element; missing value or
 * missing flag entirely -> `UsageError`) and `--json`. Any other flag -> `UsageError` -- unknown
 * flags are never ignored, the same rule `PHASE_1_SPEC.md` §4.1 already established for `doctor`.
 */
function parseRunArgs(rest: readonly string[]): Command {
  let configPath: string | null = null;
  let json = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--config") {
      const value = rest[i + 1];
      if (value === undefined) {
        throw new UsageError("run --config requires a path argument.", { flag: "--config" });
      }
      configPath = value;
      i += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new UsageError(`Unknown flag for run: ${String(arg)}`, { flag: arg });
    }
  }

  if (configPath === null) {
    throw new UsageError("run requires --config <path>.", { flag: "--config" });
  }
  return { kind: "run", json, configPath };
}

/**
 * Parses `evidence`'s flags: `--repo-dir <path>` and `--run-id <uuid>` (each consumes the next argv
 * element; missing value or missing flag entirely -> `UsageError`), plus the boolean presence flags
 * `--final-phase` (absent means `false`, mirroring `RunConfig.is_final_phase`'s own default) and
 * `--json`. Any other flag -> `UsageError` -- unknown flags are never ignored, the same rule every
 * prior CLI surface in this project already enforces. Implements PHASE_5_SPEC.md §6.4.
 */
function parseEvidenceArgs(rest: readonly string[]): Command {
  let repoDir: string | null = null;
  let runId: string | null = null;
  let finalPhase = false;
  let json = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--repo-dir") {
      const value = rest[i + 1];
      if (value === undefined) {
        throw new UsageError("evidence --repo-dir requires a path argument.", { flag: "--repo-dir" });
      }
      repoDir = value;
      i += 1;
    } else if (arg === "--run-id") {
      const value = rest[i + 1];
      if (value === undefined) {
        throw new UsageError("evidence --run-id requires a uuid argument.", { flag: "--run-id" });
      }
      runId = value;
      i += 1;
    } else if (arg === "--final-phase") {
      finalPhase = true;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new UsageError(`Unknown flag for evidence: ${String(arg)}`, { flag: arg });
    }
  }

  if (repoDir === null) {
    throw new UsageError("evidence requires --repo-dir <path>.", { flag: "--repo-dir" });
  }
  if (runId === null) {
    throw new UsageError("evidence requires --run-id <uuid>.", { flag: "--run-id" });
  }
  return { kind: "evidence", repoDir, runId, finalPhase, json };
}

/** Parses `argv` (the full `process.argv`-shaped array; `argv.slice(2)` is the user's own args). */
function parseArgs(argv: readonly string[]): Command {
  const args = argv.slice(2);

  if (args.length === 0) {
    return { kind: "help" };
  }

  const first = args[0];
  if ((first === "--version" || first === "-v") && args.length === 1) {
    return { kind: "version" };
  }
  if ((first === "--help" || first === "-h") && args.length === 1) {
    return { kind: "help" };
  }
  if (first === "doctor") {
    return parseDoctorArgs(args.slice(1));
  }
  if (first === "run") {
    return parseRunArgs(args.slice(1));
  }
  if (first === "evidence") {
    return parseEvidenceArgs(args.slice(1));
  }

  throw new UsageError(`Unknown command: ${args.join(" ")}`, { argv: args });
}

/**
 * The operator-facing phrasing of one provider's credential state. The whole point of the
 * three-state {@link DoctorReport} `authState` is that these three strings give *different
 * instructions*: "not authenticated" means go sign in, whereas an indeterminate probe means the
 * check itself did not work and neither answer should be trusted. Rendering both as the same
 * "not authenticated" line -- as this command did before -- sends an operator chasing a sign-in
 * problem that does not exist while the real defect stays invisible.
 */
function renderAuthState(report: DoctorReport["providers"][number]): string {
  switch (report.authState) {
    case "authenticated":
      return "authenticated";
    case "unauthenticated":
      return "not authenticated";
    case "indeterminate":
      return "auth state UNKNOWN (credential probe was inconclusive -- NOT a confirmed sign-in failure)";
  }
}

/**
 * Renders a {@link DoctorReport} as the human-readable `doctor` output. Exported solely so the
 * three-way credential-state rendering can be asserted against literally-constructed reports (the
 * indeterminate state cannot be provoked from a real local probe on demand) -- the same "test the
 * pure interpretation with a constructed input" approach `src/verify/preflight.ts`'s `parse*`
 * functions already use.
 */
export function renderHumanReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`multi-loopr doctor -- ${report.ok ? "OK" : "PROBLEMS FOUND"} (generated ${report.generated_at})`);
  lines.push("");
  lines.push(
    `Node.js: ${report.toolchain.node.found ? (report.toolchain.node.version ?? "unknown") : "not found"} ` +
      `(${report.toolchain.node.inRange ? "in range" : "out of range"})`,
  );
  lines.push(
    `git:     ${report.toolchain.git.found ? (report.toolchain.git.version ?? "unknown") : "not found"} ` +
      `(${report.toolchain.git.inRange ? "in range" : "out of range"})`,
  );
  for (const p of report.providers) {
    lines.push(
      `${p.provider}: ${p.cliFound ? (p.version ?? "unknown") : "not found"} ` +
        `(${p.versionInRange ? "in range" : "out of range"}), ` +
        renderAuthState(p),
    );
  }
  lines.push(
    `boundary: ${String(report.boundary.filesScanned)} file(s) scanned, ` +
      `${String(report.boundary.violations.length)} violation(s)`,
  );
  lines.push(`lock: ${report.lock.acquirable ? "acquirable" : "not acquirable"} (${report.lock.detail})`);
  if (report.problems.length > 0) {
    lines.push("");
    lines.push("Problems:");
    for (const problem of report.problems) {
      lines.push(`  - ${problem}`);
    }
  }
  return lines.join("\n") + "\n";
}

function renderRunHumanReport(report: RunReport): string {
  const lines: string[] = [];
  lines.push(
    `multi-loopr run -- ${report.ok ? "OK" : "FAILED"} (phase ${String(report.phase)}, generated ${report.generated_at})`,
  );
  lines.push("");
  for (const t of report.turns) {
    const verdictSuffix = t.continuity_verdict !== null ? `, continuity ${t.continuity_verdict}` : "";
    const retriedSuffix = t.retried ? " (retried)" : "";
    lines.push(`turn ${String(t.turn_index)} [${t.archetype}/${t.provider}]: ${t.status}${verdictSuffix}${retriedSuffix}`);
  }
  if (report.halt !== null) {
    lines.push("");
    lines.push(`halt: ${report.halt.code} -- ${report.halt.message}`);
  }
  if (report.problems.length > 0) {
    lines.push("");
    lines.push("Problems:");
    for (const problem of report.problems) {
      lines.push(`  - ${problem}`);
    }
  }
  return lines.join("\n") + "\n";
}

function renderEvidenceHumanReport(report: EvidenceReport): string {
  const lines: string[] = [];
  lines.push(
    `multi-loopr evidence -- ${report.ok ? "OK" : "ACCEPTANCE INCOMPLETE"} (run ${report.run_id}, ` +
      `${String(report.turns_found)} turn(s) found, generated ${report.generated_at})`,
  );
  lines.push("");
  lines.push(`AC1 (cross-provider continuity): ${report.ac1.satisfied ? "satisfied" : "not satisfied"} -- ${report.ac1.detail}`);
  lines.push(`AC2 (clean, non-interactive completion): ${report.ac2.satisfied ? "satisfied" : "not satisfied"} -- ${report.ac2.detail}`);
  lines.push(`AC3 (artifact reference and production): ${report.ac3.satisfied ? "satisfied" : "not satisfied"} -- ${report.ac3.detail}`);
  if (report.problems.length > 0) {
    lines.push("");
    lines.push("Problems:");
    for (const problem of report.problems) {
      lines.push(`  - ${problem}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** Parses `argv`, dispatches the requested command, and returns the process exit code. Never calls `process.exit`. */
export async function main(argv: readonly string[]): Promise<number> {
  try {
    const command = parseArgs(argv);
    switch (command.kind) {
      case "version": {
        process.stdout.write(`${pkg.version}\n`);
        return ExitCode.OK;
      }
      case "help": {
        process.stdout.write(USAGE_TEXT);
        return ExitCode.OK;
      }
      case "doctor": {
        const { report, exitCode } = await runDoctor(process.cwd(), { json: command.json, only: command.only });
        process.stdout.write(command.json ? JSON.stringify(report, null, 2) + "\n" : renderHumanReport(report));
        return exitCode;
      }
      case "run": {
        const { report, exitCode } = await runRunCommand({ configPath: command.configPath, json: command.json });
        process.stdout.write(command.json ? JSON.stringify(report, null, 2) + "\n" : renderRunHumanReport(report));
        return exitCode;
      }
      case "evidence": {
        const { report, exitCode } = await runEvidenceCommand({
          repoDir: command.repoDir,
          runId: command.runId,
          finalPhase: command.finalPhase,
          json: command.json,
        });
        process.stdout.write(command.json ? JSON.stringify(report, null, 2) + "\n" : renderEvidenceHumanReport(report));
        return exitCode;
      }
    }
    // Exhaustive per the Command union above; unreachable, but satisfies noImplicitReturns.
    throw new InternalError("Unreachable: unknown command kind.");
  } catch (err) {
    if (err instanceof MultiLooprError) {
      process.stderr.write(`${err.message}\n`);
      return err.exitCode;
    }
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    return ExitCode.INTERNAL;
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMainModule) {
  main(process.argv).then((code) => {
    process.exitCode = code;
  });
}

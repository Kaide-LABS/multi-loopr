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

const USAGE_TEXT = `Usage: multi-loopr <command> [options]

Commands:
  multi-loopr --version | -v                Print the version and exit.
  multi-loopr --help | -h                   Print this usage text and exit.
  multi-loopr doctor [--json]                Full health check: toolchain, both providers,
                                              boundary scan, and a lock smoke test.
  multi-loopr doctor --boundary [--json]     Boundary scan only (fast, no provider probes).
  multi-loopr doctor --providers [--json]    Provider preflight only.
`;

type Command =
  | { readonly kind: "version" }
  | { readonly kind: "help" }
  | ({ readonly kind: "doctor" } & DoctorOptions);

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

  throw new UsageError(`Unknown command: ${args.join(" ")}`, { argv: args });
}

function renderHumanReport(report: DoctorReport): string {
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
        `${p.authenticated ? "authenticated" : "not authenticated"}`,
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

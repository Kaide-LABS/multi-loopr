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
import type { DriveCommandOptions, DriveReport } from "./drive.ts";
import { runDriveCommand } from "./drive.ts";
import { runMcpServer } from "../mcp/server.ts";
import { renderSetupHumanReport, runSetupCommand } from "./setup.ts";
import { probeOptionalResearchServers, renderOptionalResearchNote } from "../setup/registry.ts";

const USAGE_TEXT = `Usage: multi-loopr <command> [options]

Commands:
  multi-loopr --version | -v                Print the version and exit.
  multi-loopr --help | -h                   Print this usage text and exit.
  multi-loopr doctor [--json]                Full health check: toolchain, both providers,
                                              boundary scan, and a lock smoke test.
  multi-loopr doctor --boundary [--json]     Boundary scan only (fast, no provider probes).
  multi-loopr doctor --providers [--json]    Provider preflight only.
  multi-loopr run --config <path> [--json]   Dispatch one loopr phase's turn sequence. Providers may
                                              be pinned to a fixed role via the config's role_pins.
  multi-loopr evidence --repo-dir <path> --run-id <uuid> [--final-phase] [--json]
                                              Re-derive AC1/AC2/AC3 evidence for a completed run
                                              from its persisted handoff records.
  multi-loopr drive --config <path> [--json]  Dispatch a target build's own phases sequentially, one
                                              runDispatch() call per phase, halting on the first
                                              ambiguous or incoherent filesystem read.
  multi-loopr mcp                             Start a local, stdio-only Model Context Protocol server
                                              exposing run/drive/doctor/evidence as MCP tools.
  multi-loopr setup [--json]                  Register multi-loopr's own MCP server plus the two
                                              optional research servers (arxiv-mcp, paper-search-mcp)
                                              into your Claude Code configuration, at user scope.
`;

type Command =
  | { readonly kind: "version" }
  | { readonly kind: "help" }
  | ({ readonly kind: "doctor" } & DoctorOptions)
  | ({ readonly kind: "run" } & RunCommandOptions)
  | ({ readonly kind: "evidence" } & EvidenceCommandOptions)
  | ({ readonly kind: "drive" } & DriveCommandOptions)
  | { readonly kind: "mcp" }
  | { readonly kind: "setup"; readonly json: boolean };

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

/**
 * Parses `drive`'s flags: `--config <path>` (consumes the next argv element; missing value or
 * missing flag entirely -> `UsageError`) and `--json`. Any other flag -> `UsageError` -- unknown
 * flags are never ignored, the same rule every existing CLI surface in this project already
 * enforces. Does not touch `parseRunArgs`/`parseDoctorArgs`/`parseEvidenceArgs` or their own
 * argument surfaces. Implements PHASE_6_SPEC.md §4.1.
 */
function parseDriveArgs(rest: readonly string[]): Command {
  let configPath: string | null = null;
  let json = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--config") {
      const value = rest[i + 1];
      if (value === undefined) {
        throw new UsageError("drive --config requires a path argument.", { flag: "--config" });
      }
      configPath = value;
      i += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new UsageError(`Unknown flag for drive: ${String(arg)}`, { flag: arg });
    }
  }

  if (configPath === null) {
    throw new UsageError("drive requires --config <path>.", { flag: "--config" });
  }
  return { kind: "drive", json, configPath };
}

/**
 * Parses `mcp`'s flags: none. Any element in `rest` is a `UsageError` -- mirrors every other
 * `parse*Args` function's own "unknown flags are never ignored" discipline (PHASE_1_SPEC.md §4.1);
 * `mcp` simply takes none (PHASE_8_SPEC.md §4.1, §9 non-goal 7).
 */
function parseMcpArgs(rest: readonly string[]): Command {
  if (rest.length > 0) {
    throw new UsageError(`Unknown flag for mcp: ${String(rest[0])}`, { flag: rest[0] });
  }
  return { kind: "mcp" };
}

/**
 * Parses `setup`'s flags: `--json` only. Any other argument -> `UsageError` -- unknown flags are
 * never ignored, the same rule every existing CLI surface in this project already enforces. There
 * is deliberately no `--scope`/`--only`/`--skip` flag (PHASE_9_SPEC.md §4.1, §9 non-goals 5).
 * Mirrors `parseDriveArgs`' own shape, minus the `--config` branch.
 */
function parseSetupArgs(rest: readonly string[]): Command {
  let json = false;

  for (const arg of rest) {
    if (arg === "--json") {
      json = true;
    } else {
      throw new UsageError(`Unknown flag for setup: ${String(arg)}`, { flag: arg });
    }
  }

  return { kind: "setup", json };
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
  if (first === "drive") {
    return parseDriveArgs(args.slice(1));
  }
  if (first === "mcp") {
    return parseMcpArgs(args.slice(1));
  }
  if (first === "setup") {
    return parseSetupArgs(args.slice(1));
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

/**
 * Renders a {@link RunReport} as the human-readable `run` output. Exported (mirroring
 * {@link renderHumanReport}'s own existing precedent) so the "Warnings:" block's rendering --
 * PHASE_7_SPEC.md §4.3, the human-output half of AC3 -- can be asserted directly against a
 * synthetic {@link RunReport}, without spawning a real provider turn to trigger it end-to-end.
 */
export function renderRunHumanReport(report: RunReport): string {
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
  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of report.warnings) {
      lines.push(`  - ${warning}`);
    }
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

/**
 * Renders a {@link DriveReport} as the human-readable `drive` output: one line per phase
 * (`phase N [state_id]: decision_kind -- reason`, each a single line) followed by the final
 * `ok`/`exit_code` summary line -- FM-D5's own "illegible output" guard (PHASE_6_SPEC.md §7, §4.3).
 */
function renderDriveHumanReport(report: DriveReport): string {
  const lines: string[] = [];
  lines.push(
    `multi-loopr drive -- ${report.ok ? "OK" : "FAILED"} (driver run ${report.driver_run_id}, generated ${report.generated_at})`,
  );
  lines.push("");
  for (const p of report.phases) {
    lines.push(`phase ${String(p.phase)} [${p.state_id}]: ${p.decision_kind} -- ${p.reason}`);
  }
  if (report.problems.length > 0) {
    lines.push("");
    lines.push("Problems:");
    for (const problem of report.problems) {
      lines.push(`  - ${problem}`);
    }
  }
  lines.push("");
  lines.push(`ok: ${String(report.ok)}, exit_code: ${String(report.exit_code)}, final_state: ${report.final_state_id}`);
  return lines.join("\n") + "\n";
}

/**
 * Sentinel used by {@link emitOptionalResearchNoteThenExit}'s internal race to detect "the probe has
 * not settled yet" without a fixed grace timeout -- see that function's doc comment.
 */
const NOTE_NOT_YET_SETTLED = Symbol("note-not-yet-settled");

/**
 * Writes `text` to `stream` and resolves only once the underlying write is actually flushed (Node's
 * write callback), never merely queued. Used immediately before {@link emitOptionalResearchNoteThenExit}
 * forces `process.exit()`, so a forced exit can never race ahead of -- and truncate -- output that was
 * already handed to `stream.write()`.
 */
function writeFlushed(stream: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise((resolve) => {
    stream.write(text, () => resolve());
  });
}

/**
 * Finishes the `run`/`drive` commands' optional-research-server note (PHASE_9_SPEC.md §6.7) and then
 * terminates the process -- the one narrow, documented exception to "never calls `process.exit`"
 * (see {@link main}'s own doc comment).
 *
 * Why this exists (Phase 9 review regression, fixed by this patch): `notePromise` is
 * `probeOptionalResearchServers()`'s result, kicked off in parallel with the command's own real work
 * so that for a genuine multi-minute `run`/`drive` invocation it has always resolved by the time the
 * primary report is ready -- exactly PHASE_9_SPEC.md §6.7's "zero added latency, by construction"
 * intent. That premise is false on any *fast* exit path (a `RunConfig`/`DriveConfig` validation
 * error, a usage error, an early preflight failure): those return in milliseconds, long before the
 * two concurrent `claude mcp get` calls underneath the probe do. Simply not `await`ing `notePromise`
 * before returning does NOT fix that: Node keeps the OS process alive until every open handle clears
 * -- including a still-running child process's stdio pipes -- regardless of whether any JS code is
 * still `await`ing its promise. The only way to make the *process* (not just this function) return
 * immediately is to force it with `process.exit()` once this command's own output is fully flushed.
 *
 * The race below has no fixed grace period (a several-second compromise would just reintroduce a
 * smaller version of the same bug): `Promise.resolve(NOTE_NOT_YET_SETTLED)` settles on the very next
 * microtask, so if `notePromise` had already resolved by the time we get here -- true for every
 * genuine slow run, since its underlying I/O long since fired -- `Promise.race` picks up its real
 * value (array order: `notePromise` is listed first, so an already-settled `notePromise` wins ties).
 * If `notePromise` has not yet settled, the sentinel wins with no added wait, and the note is simply
 * dropped for this invocation -- acceptable because it is advisory-only (§6.7: "nothing in this run
 * was skipped or degraded because of them").
 */
async function emitOptionalResearchNoteThenExit(
  notePromise: ReturnType<typeof probeOptionalResearchServers>,
  exitCode: number,
): Promise<never> {
  const raced = await Promise.race([notePromise, Promise.resolve(NOTE_NOT_YET_SETTLED)]);
  if (raced !== NOTE_NOT_YET_SETTLED) {
    const note = renderOptionalResearchNote(raced);
    if (note !== null) {
      await writeFlushed(process.stderr, note);
    }
  }
  process.exit(exitCode);
}

/**
 * Parses `argv`, dispatches the requested command, and returns the process exit code. Never calls
 * `process.exit`, with one narrow, documented exception: `run`/`drive` end by calling
 * {@link emitOptionalResearchNoteThenExit}, which forces an immediate `process.exit()` after their
 * own output is flushed, so a still-in-flight optional-research-server probe can never hold the real
 * OS process open on a fast exit path. See that function's doc comment for why a plain `await` (or
 * simply not awaiting) cannot achieve this on its own.
 */
export async function main(argv: readonly string[]): Promise<number> {
  // Hoisted out of the `run`/`drive` case blocks so the `catch` below can also race+exit it: a
  // `RunConfig`/`DriveConfig` validation failure (or any other usage/preflight error) throws a
  // `MultiLooprError` from `runRunCommand`/`runDriveCommand` *before* the case block's own
  // `emitOptionalResearchNoteThenExit` call is ever reached, so that call alone does not cover the
  // fast-fail path this patch exists to fix -- the `catch` block needs the same treatment.
  let notePromiseForExit: ReturnType<typeof probeOptionalResearchServers> | null = null;
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
        const notePromise = probeOptionalResearchServers();
        notePromiseForExit = notePromise;
        const { report, exitCode } = await runRunCommand({ configPath: command.configPath, json: command.json });
        await writeFlushed(process.stdout, command.json ? JSON.stringify(report, null, 2) + "\n" : renderRunHumanReport(report));
        return await emitOptionalResearchNoteThenExit(notePromise, exitCode);
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
      case "drive": {
        const notePromise = probeOptionalResearchServers();
        notePromiseForExit = notePromise;
        const { report, exitCode } = await runDriveCommand({ configPath: command.configPath, json: command.json });
        await writeFlushed(process.stdout, command.json ? JSON.stringify(report, null, 2) + "\n" : renderDriveHumanReport(report));
        return await emitOptionalResearchNoteThenExit(notePromise, exitCode);
      }
      case "mcp": {
        await runMcpServer();
        return ExitCode.OK;
      }
      case "setup": {
        const { report, exitCode } = await runSetupCommand({
          json: command.json,
          entryPath: fileURLToPath(import.meta.url),
        });
        process.stdout.write(command.json ? JSON.stringify(report, null, 2) + "\n" : renderSetupHumanReport(report));
        return exitCode;
      }
    }
    // Exhaustive per the Command union above; unreachable, but satisfies noImplicitReturns.
    throw new InternalError("Unreachable: unknown command kind.");
  } catch (err) {
    const exitCode = err instanceof MultiLooprError ? err.exitCode : ExitCode.INTERNAL;
    const message =
      err instanceof MultiLooprError
        ? `${err.message}\n`
        : `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`;
    await writeFlushed(process.stderr, message);
    // A `run`/`drive` invocation that threw before reaching its own `emitOptionalResearchNoteThenExit`
    // call (e.g. a fast `RunConfig`/`DriveConfig` validation error) still owns a live `notePromise` --
    // give it the exact same race-then-force-exit treatment so this path is not slower than the
    // success path it fixes. Every other command leaves `notePromiseForExit` `null` and returns
    // normally, unchanged from before this patch.
    if (notePromiseForExit !== null) {
      return await emitOptionalResearchNoteThenExit(notePromiseForExit, exitCode);
    }
    return exitCode;
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMainModule) {
  main(process.argv).then((code) => {
    process.exitCode = code;
  });
}

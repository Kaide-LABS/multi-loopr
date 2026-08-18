// Implements PHASE_9_SPEC.md §4, §6.6
//
// The `setup` command: registers three stdio MCP servers into the operator's Claude Code
// configuration by shelling out to the already-present `claude` CLI's own `mcp add`/`mcp get`
// commands. Mirrors `src/cli/run.ts`/`src/cli/drive.ts`/`src/cli/doctor.ts` exactly: its own zod
// report schema, a function returning `{ report, exitCode }`, and never a call to `process.exit`.

import { z } from "zod";
import { ExitCode, InternalError } from "../domain/errors.ts";
import { IsoUtc } from "../domain/relay.ts";
import { ServerSetupResult } from "../domain/setup.ts";
import type { SetupOutcome, SetupServerId } from "../domain/setup.ts";
import { SETUP_SERVERS, probeLauncherFacts, resolveServerLaunch } from "../setup/servers.ts";
import type { LauncherProbeFacts } from "../setup/servers.ts";
import { decideServerOutcome, interpretMcpAddResult, interpretMcpGetResult, mcpAdd, mcpGet } from "../setup/registry.ts";
import type { RunProcessOptions } from "../util/exec.ts";
import type { runProcess as runProcessDefault } from "../util/exec.ts";
import { checkProviderCli as checkProviderCliDefault } from "../verify/preflight.ts";

/** The `setup --json` output shape (PHASE_9_SPEC.md §3.3). */
export const SetupReport = z.strictObject({
  schema_version: z.literal(1),
  generated_at: IsoUtc,
  ok: z.boolean(),
  exit_code: z.number().int(),
  // A literal, not an enum -- there is no `--scope` flag and no code path producing any other
  // value, so "we always use user scope" is a property the type system enforces (PRD §9 FM11).
  scope: z.literal("user"),
  agent_cli: z.strictObject({
    found: z.boolean(),
    version: z.string().nullable(),
  }),
  servers: z.array(ServerSetupResult),
  problems: z.array(z.string()),
  notes: z.array(z.string()),
});

/** The inferred type of {@link SetupReport}. */
export type SetupReport = z.infer<typeof SetupReport>;

/** `setup` command options, derived from CLI flags (`src/cli/main.ts`). */
export interface SetupCommandOptions {
  readonly json: boolean;
  /** Absolute path of the CLI entry module; `src/cli/main.ts` passes `fileURLToPath(import.meta.url)`. */
  readonly entryPath: string;
}

/** Injection seam for `runSetupCommand`. Defaults to the real `runProcess`/`checkProviderCli`. */
export interface SetupDeps {
  readonly runProcess?: (o: RunProcessOptions) => ReturnType<typeof runProcessDefault>;
  readonly checkProviderCli?: typeof checkProviderCliDefault;
}

/**
 * [DET] Computes the process exit code from the decided `multi-loopr`-server outcome and whether
 * the agent CLI was found. Reads only the `multi-loopr` entry's outcome -- `arxiv-mcp` and
 * `paper-search-mcp`'s outcomes never influence this function's result (PRD §9 FM12(a), FM-I7).
 * Implements PHASE_9_SPEC.md §4.2.
 */
export function computeSetupExitCode(input: { readonly agentCliFound: boolean; readonly selfOutcome: SetupOutcome }): number {
  if (!input.agentCliFound) {
    return ExitCode.PREFLIGHT_FAILED;
  }
  switch (input.selfOutcome) {
    case "registered":
    case "already-registered":
      return ExitCode.OK;
    case "failed":
    case "registered-unverified":
    case "skipped-launcher-unavailable":
    case "indeterminate":
    case "skipped-no-agent-cli":
      return ExitCode.SETUP_FAILED;
    default: {
      const exhaustive: never = input.selfOutcome;
      throw new InternalError(`computeSetupExitCode: unreachable outcome`, { outcome: exhaustive });
    }
  }
}

/** Human-readable label for one server's registered/attempted outcome. Never renders `registered` as "working". */
function outcomeLabel(outcome: SetupOutcome): string {
  switch (outcome) {
    case "registered":
      return "registered";
    case "already-registered":
      return "already registered";
    case "registered-unverified":
      return "registered (unverified -- the post-add check did not confirm it)";
    case "failed":
      return "failed";
    case "skipped-launcher-unavailable":
      return "skipped -- no runnable launcher found";
    case "skipped-no-agent-cli":
      return "skipped -- claude CLI not found";
    case "indeterminate":
      return "indeterminate -- the probe did not produce a conclusive answer";
  }
}

/**
 * Renders a {@link SetupReport} as the human-readable `setup` output. Pure and exported so tests
 * can drive it with literally-constructed reports, mirroring `renderHumanReport`/
 * `renderRunHumanReport`'s own existing precedent. Implements PHASE_9_SPEC.md §4.3.
 */
export function renderSetupHumanReport(report: SetupReport): string {
  const lines: string[] = [];
  lines.push(
    `multi-loopr setup -- ${report.ok ? "OK" : "PROBLEMS FOUND"} (${report.scope} scope, generated ${report.generated_at})`,
  );
  lines.push("");
  lines.push(`claude CLI: ${report.agent_cli.found ? (report.agent_cli.version ?? "unknown") : "not found"}`);
  lines.push("");
  for (const s of report.servers) {
    const tag = s.required ? "[required]" : "[optional]";
    lines.push(`  ${s.id.padEnd(18)} ${tag.padEnd(11)} ${outcomeLabel(s.outcome)}`);
  }
  if (report.notes.length > 0) {
    lines.push("");
    lines.push("Notes:");
    for (const note of report.notes) {
      lines.push(`  - ${note}`);
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

function optionalNote(id: SetupServerId, result: { readonly outcome: SetupOutcome; readonly remediation: string | null }): string {
  const reason =
    result.outcome === "skipped-launcher-unavailable"
      ? (result.remediation ?? "no runnable launcher was found")
      : result.outcome === "failed"
        ? "the registration attempt failed"
        : result.outcome === "registered-unverified"
          ? "the registration could not be verified"
          : result.outcome === "indeterminate"
            ? "the check was inconclusive"
            : "it was not registered";
  return (
    `${id} was not registered: ${reason}. multi-loopr does not require it -- every multi-loopr ` +
    `command works exactly the same without it. To add it later: install it, then re-run \`multi-loopr setup\`.`
  );
}

/**
 * Attempts to register one server: pre-check / add / verify (PHASE_9_SPEC.md §6.5), or an
 * `unavailable` short-circuit when {@link resolveServerLaunch} could not resolve a launch command.
 * Never throws -- an unexpected error is caught by the caller's per-iteration `try` and converted
 * to `indeterminate` (FM-I6).
 */
async function attemptServer(
  def: (typeof SETUP_SERVERS)[number],
  facts: LauncherProbeFacts,
  entryPath: string,
  deps: SetupDeps,
): Promise<ServerSetupResult> {
  const resolution = resolveServerLaunch(def, facts, entryPath);
  if (resolution.kind === "unavailable") {
    return {
      id: def.id,
      required: def.required,
      outcome: "skipped-launcher-unavailable",
      launcher: null,
      command: null,
      args: null,
      detail: resolution.reason,
      remediation: resolution.remediation,
    };
  }

  const launch = resolution.launch;

  // Step A -- pre-check.
  const preRaw = await mcpGet(def.id, deps);
  const pre = interpretMcpGetResult(preRaw);

  if (pre === "present") {
    const outcome = decideServerOutcome(pre, "not-attempted", "not-attempted");
    return {
      id: def.id,
      required: def.required,
      outcome,
      launcher: launch.kind,
      command: launch.command,
      args: [...launch.args],
      detail: preRaw.stdout.trim().split("\n").slice(0, 3).join("\n").slice(0, 400),
      remediation: null,
    };
  }
  if (pre === "indeterminate") {
    const outcome = decideServerOutcome(pre, "not-attempted", "not-attempted");
    return {
      id: def.id,
      required: def.required,
      outcome,
      launcher: launch.kind,
      command: launch.command,
      args: [...launch.args],
      detail: "pre-check `claude mcp get` did not produce a conclusive answer; nothing was written",
      remediation: null,
    };
  }

  // pre === "absent" -- Step B.
  const addRaw = await mcpAdd(def.id, launch, deps);
  const add = interpretMcpAddResult(addRaw);

  if (add === "failed") {
    const outcome = decideServerOutcome(pre, add, "not-attempted");
    return {
      id: def.id,
      required: def.required,
      outcome,
      launcher: launch.kind,
      command: launch.command,
      args: [...launch.args],
      detail: `claude mcp add exited ${String(addRaw.exitCode)} (signal ${String(addRaw.signal)}): ${addRaw.stderr.slice(0, 2000)}`,
      remediation: "Check the error above and re-run `multi-loopr setup` once it is resolved.",
    };
  }
  if (add === "indeterminate") {
    const outcome = decideServerOutcome(pre, add, "not-attempted");
    return {
      id: def.id,
      required: def.required,
      outcome,
      launcher: launch.kind,
      command: launch.command,
      args: [...launch.args],
      detail: "`claude mcp add` did not produce a conclusive answer (timed out); registration state unknown",
      remediation: "Re-run `multi-loopr setup` and check `claude mcp get " + def.id + "` directly.",
    };
  }

  // Step C -- verify.
  const postRaw = await mcpGet(def.id, deps);
  const post = interpretMcpGetResult(postRaw);
  const outcome = decideServerOutcome(pre, add, post);
  return {
    id: def.id,
    required: def.required,
    outcome,
    launcher: launch.kind,
    command: launch.command,
    args: [...launch.args],
    detail:
      outcome === "registered"
        ? "registered and confirmed present in the agent's configuration"
        : "`claude mcp add` reported success, but the post-add `claude mcp get` did not confirm it",
    remediation: outcome === "registered" ? null : "Re-run `multi-loopr setup`, or run `claude mcp get " + def.id + "` yourself to inspect the entry.",
  };
}

/**
 * Runs the full `setup` flow: agent-CLI presence check, one launcher-facts probe, then the
 * per-server loop (never breaking, never throwing out of an iteration -- FM-I6), notes, problems,
 * and exit code. Never calls `process.exit`. Implements PHASE_9_SPEC.md §6.6.
 */
export async function runSetupCommand(
  opts: SetupCommandOptions,
  deps?: SetupDeps,
): Promise<{ report: SetupReport; exitCode: number }> {
  const generatedAt = new Date().toISOString();
  const checkProviderCli = deps?.checkProviderCli ?? checkProviderCliDefault;

  const cli = await checkProviderCli("claude-code");

  if (!cli.found) {
    const servers: ServerSetupResult[] = SETUP_SERVERS.map((def) => ({
      id: def.id,
      required: def.required,
      outcome: "skipped-no-agent-cli",
      launcher: null,
      command: null,
      args: null,
      detail: "the claude CLI was not found on PATH; nothing was attempted",
      remediation: "Install the Claude Code CLI and sign in yourself; multi-loopr never installs or signs in on your behalf. Then re-run `multi-loopr setup`.",
    }));
    const exitCode = computeSetupExitCode({ agentCliFound: false, selfOutcome: "skipped-no-agent-cli" });
    const report: SetupReport = {
      schema_version: 1,
      generated_at: generatedAt,
      ok: exitCode === ExitCode.OK,
      exit_code: exitCode,
      scope: "user",
      agent_cli: { found: false, version: null },
      servers,
      problems: ["The claude CLI was not found on PATH. Install it and sign in yourself; multi-loopr never installs or signs in on your behalf."],
      notes: [],
    };
    return { report, exitCode };
  }

  const facts =
    deps?.runProcess !== undefined ? await probeLauncherFacts({ runProcess: deps.runProcess }) : await probeLauncherFacts();

  const results: ServerSetupResult[] = [];
  for (const def of SETUP_SERVERS) {
    try {
      const result = await attemptServer(def, facts, opts.entryPath, deps ?? {});
      results.push(result);
    } catch (err) {
      results.push({
        id: def.id,
        required: def.required,
        outcome: "indeterminate",
        launcher: null,
        command: null,
        args: null,
        detail: `unexpected error while attempting registration: ${err instanceof Error ? err.message : String(err)}`,
        remediation: "Re-run `multi-loopr setup`.",
      });
    }
    // The loop never breaks, never returns early -- one server's failure never prevents the
    // others from being attempted (FM-I6, baby_prd AC2).
  }

  const notes: string[] = [];
  const problems: string[] = [];
  for (const result of results) {
    if (result.id === "multi-loopr") {
      if (result.outcome !== "registered" && result.outcome !== "already-registered") {
        problems.push(`multi-loopr's own server was not successfully registered (${result.outcome}): ${result.detail}`);
      }
      continue;
    }
    // Optional servers: never enter `problems` (PRD §9 FM12(b), FM-I8).
    if (result.outcome !== "registered" && result.outcome !== "already-registered") {
      notes.push(optionalNote(result.id, result));
    }
  }

  const selfResult = results.find((r) => r.id === "multi-loopr");
  const selfOutcome: SetupOutcome = selfResult?.outcome ?? "indeterminate";
  const exitCode = computeSetupExitCode({ agentCliFound: true, selfOutcome });

  const report: SetupReport = {
    schema_version: 1,
    generated_at: generatedAt,
    ok: exitCode === ExitCode.OK,
    exit_code: exitCode,
    scope: "user",
    agent_cli: { found: true, version: cli.version },
    servers: results,
    problems,
    notes,
  };

  return { report, exitCode };
}

// Implements PHASE_9_SPEC.md §6.3, §6.4
//
// The three-server catalog and the pure launcher resolution. Only `probeLauncherFacts` performs
// I/O, and it does so exclusively through `runProcess` (`src/util/exec.ts`) -- never
// `node:child_process` directly (PHASE_1_SPEC.md §8 acceptance check #8).

import type { SetupLauncherKind, SetupServerId } from "../domain/setup.ts";
import type { RunProcessOptions } from "../util/exec.ts";
import { runProcess as runProcessDefault } from "../util/exec.ts";

const LAUNCHER_PROBE_TIMEOUT_MS = 15_000;

/** One entry in the fixed, `as const` three-server catalog. */
export interface SetupServerDefinition {
  readonly id: SetupServerId;
  readonly kind: "self" | "optional";
  readonly required: boolean;
  /** PyPI package name for the `uvx` launch form. `null` for the `self` server. */
  readonly pypiName: string | null;
  /** Python module name for the `python -m` launch form. `null` for the `self` server. */
  readonly moduleName: string | null;
}

/**
 * The fixed, `as const` three-server catalog, iterated in this exact order (PHASE_9_SPEC.md §6.4).
 * `multi-loopr` is first so that the one required server is attempted before anything optional can
 * go wrong.
 */
export const SETUP_SERVERS: readonly SetupServerDefinition[] = [
  { id: "multi-loopr", kind: "self", required: true, pypiName: null, moduleName: null },
  {
    id: "arxiv-mcp",
    kind: "optional",
    required: false,
    pypiName: "arxiv-mcp-server",
    moduleName: "arxiv_mcp_server",
  },
  {
    id: "paper-search-mcp",
    kind: "optional",
    required: false,
    pypiName: "paper-search-mcp",
    moduleName: "paper_search_mcp.server",
  },
] as const;

/**
 * The concretely resolved launch command for one server: the launcher kind, the command to spawn,
 * and its arguments. Mirrors `ResolvedLaunch` in `src/setup/registry.ts`'s argv builders.
 */
export interface ResolvedLaunch {
  readonly kind: SetupLauncherKind;
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * The environment facts `resolveServerLaunch` needs to decide a launch command, gathered once per
 * `multi-loopr setup` invocation by {@link probeLauncherFacts}.
 */
export interface LauncherProbeFacts {
  readonly platform: NodeJS.Platform;
  /** True iff `uvx --version` exited 0. */
  readonly uvxAvailable: boolean;
  /** True iff `node --version` exited 0 (i.e. `node` is resolvable on PATH, not just as argv[0]). */
  readonly nodeOnPath: boolean;
  /** Absolute path to the currently running Node binary -- `process.execPath`. */
  readonly nodeExecPath: string;
  /**
   * For each `SetupServerId` that has a Python module form, the first interpreter command from the
   * platform's candidate list whose `<cmd> -c "import <module>"` exited 0, or null if none did.
   */
  readonly pythonForModule: Readonly<Record<string, string | null>>;
}

/**
 * Python interpreter candidates to probe, in fixed order. `py` (the Windows Python launcher) leads
 * on Windows and is omitted entirely elsewhere, since it does not exist there (PHASE_9_SPEC.md
 * §6.3 step 3, the concrete fix for PRD §8.8.3 item T6's portability defect).
 */
function pythonCandidatesFor(platform: NodeJS.Platform): readonly string[] {
  return platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
}

/**
 * Runs every launcher-availability probe (`uvx --version`, `node --version`, and one
 * `<interpreter> -c "import <module>"` per optional server's module, trying each platform
 * candidate in order) and returns the observed facts. Every probe goes through `runProcess`, so
 * stdin is closed and a timeout is always armed (PRD §9 FM7); `runProcess` never rejects, so this
 * function never throws. `deps.runProcess` is a test seam only, defaulting to the real
 * `runProcess`. Implements PHASE_9_SPEC.md §6.3.
 */
export async function probeLauncherFacts(deps?: {
  readonly runProcess?: (o: RunProcessOptions) => ReturnType<typeof runProcessDefault>;
}): Promise<LauncherProbeFacts> {
  const runProcess = deps?.runProcess ?? runProcessDefault;
  const cwd = process.cwd();

  const uvxResult = await runProcess({ command: "uvx", args: ["--version"], cwd, timeoutMs: LAUNCHER_PROBE_TIMEOUT_MS });
  const uvxAvailable = uvxResult.exitCode === 0;

  const nodeResult = await runProcess({ command: "node", args: ["--version"], cwd, timeoutMs: LAUNCHER_PROBE_TIMEOUT_MS });
  const nodeOnPath = nodeResult.exitCode === 0;

  const candidates = pythonCandidatesFor(process.platform);
  const pythonForModule: Record<string, string | null> = {};
  for (const def of SETUP_SERVERS) {
    if (def.moduleName === null) {
      continue;
    }
    let resolved: string | null = null;
    for (const candidate of candidates) {
      const probe = await runProcess({
        command: candidate,
        args: ["-c", `import ${def.moduleName}`],
        cwd,
        timeoutMs: LAUNCHER_PROBE_TIMEOUT_MS,
      });
      if (probe.exitCode === 0) {
        resolved = candidate;
        break;
      }
    }
    pythonForModule[def.id] = resolved;
  }

  return {
    platform: process.platform,
    uvxAvailable,
    nodeOnPath,
    nodeExecPath: process.execPath,
    pythonForModule,
  };
}

/** The result of {@link resolveServerLaunch}: either a concretely resolved launch, or why not. */
export type LaunchResolution =
  | { readonly kind: "resolved"; readonly launch: ResolvedLaunch }
  | { readonly kind: "unavailable"; readonly reason: string; readonly remediation: string };

/**
 * Rejects an `entryPath` this project's own `src/util/exec.ts` (`buildWindowsCmdRelaunch`) could
 * never safely spawn: not absolute, containing a `"`, or ending in `\`.
 */
function isUnsafeEntryPath(entryPath: string): boolean {
  return !isAbsolutePath(entryPath) || entryPath.includes('"') || entryPath.endsWith("\\");
}

/** Minimal absolute-path check covering both POSIX (`/...`) and Windows (`C:\...`, `\\...`) forms. */
function isAbsolutePath(p: string): boolean {
  return /^([a-zA-Z]:[\\/]|\/|\\\\)/.test(p);
}

/**
 * Pure resolution of the launch command for one catalog entry, given the current machine's
 * launcher facts and the CLI entry module's absolute path. Reads only its three arguments -- no
 * `process.platform`, no I/O. This is what makes every branch testable without a machine that has
 * (or lacks) `uv`. Implements PHASE_9_SPEC.md §6.4.
 */
export function resolveServerLaunch(
  def: SetupServerDefinition,
  facts: LauncherProbeFacts,
  entryPath: string,
): LaunchResolution {
  if (def.kind === "self") {
    if (isUnsafeEntryPath(entryPath)) {
      return {
        kind: "unavailable",
        reason: `the multi-loopr CLI entry path "${entryPath}" cannot be safely written into a spawned command (not absolute, or contains a quote, or ends in a backslash)`,
        remediation: "Reinstall multi-loopr so its entry module resolves to a safe absolute path, then re-run `multi-loopr setup`.",
      };
    }
    return facts.nodeOnPath
      ? { kind: "resolved", launch: { kind: "node", command: "node", args: [entryPath, "mcp"] } }
      : { kind: "resolved", launch: { kind: "node", command: facts.nodeExecPath, args: [entryPath, "mcp"] } };
  }

  // def.kind === "optional"
  if (facts.uvxAvailable && def.pypiName !== null) {
    return { kind: "resolved", launch: { kind: "uvx", command: "uvx", args: [def.pypiName] } };
  }
  const interpreter = facts.pythonForModule[def.id] ?? null;
  if (interpreter !== null && def.moduleName !== null) {
    return { kind: "resolved", launch: { kind: "python-module", command: interpreter, args: ["-m", def.moduleName] } };
  }
  return {
    kind: "unavailable",
    reason: `neither \`uvx\` nor a Python interpreter that can import \`${def.moduleName ?? "unknown"}\` was found`,
    remediation:
      def.pypiName !== null
        ? `Install it yourself, e.g. \`uv tool install ${def.pypiName}\` or \`pip install ${def.pypiName}\`, then re-run \`multi-loopr setup\`.`
        : "Install the required package yourself, then re-run `multi-loopr setup`.",
  };
}

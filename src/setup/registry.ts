// Implements PHASE_9_SPEC.md §6.1, §6.2, §6.5, §6.7
//
// The `claude mcp` interaction layer: pure argv builders, pure raw-result interpreters, the pure
// outcome decision, the two thin I/O wrappers that call them, and the optional-research-server
// availability probe plus its pure note renderer.

import type { OptionalServerState, SetupOutcome, SetupServerId } from "../domain/setup.ts";
import type { ResolvedLaunch } from "./servers.ts";
import type { RawInvocationResult } from "../domain/run.ts";
import type { RunProcessOptions } from "../util/exec.ts";
import { InternalError } from "../domain/errors.ts";
import { runProcess as runProcessDefault } from "../util/exec.ts";
import { checkProviderCli as checkProviderCliDefault } from "../verify/preflight.ts";

const MCP_GET_TIMEOUT_MS = 60_000;
const MCP_ADD_TIMEOUT_MS = 60_000;

type RunProcessFn = (o: RunProcessOptions) => ReturnType<typeof runProcessDefault>;
type CheckProviderCliFn = typeof checkProviderCliDefault;

/**
 * Builds the exact argv for `claude mcp add`:
 * `["mcp", "add", "--scope", "user", "--transport", "stdio", name, "--", command, ...args]`.
 * Pure -- reads only its arguments, never `process.env`/`process.cwd()`/`process.platform`/the
 * clock. `--scope user` is unconditional (PRD §9 FM11); `--transport stdio` is emitted explicitly
 * so the "stdio only" property is visible in the argv itself. Implements PHASE_9_SPEC.md §6.1, §6.2.
 */
export function buildMcpAddArgs(name: SetupServerId, launch: ResolvedLaunch): readonly string[] {
  return ["mcp", "add", "--scope", "user", "--transport", "stdio", name, "--", launch.command, ...launch.args];
}

/** Builds the exact argv for `claude mcp get`: `["mcp", "get", name]`. Pure. Implements PHASE_9_SPEC.md §6.2. */
export function buildMcpGetArgs(name: SetupServerId): readonly string[] {
  return ["mcp", "get", name];
}

/**
 * Pure interpretation of a `claude mcp get <name>` invocation's raw result (PHASE_9_SPEC.md §6.5).
 * Keyed on exit code only, verified locally: `claude mcp get` exits 0 for a present server
 * (including one that is registered but non-functional), 1 for an absent name, and the `Status:`
 * glyph rendered in its stdout is never parsed (PRD §9 FM10) -- it is not a machine-readable
 * signal, and Claude Code's own docs warn it degrades on legacy Windows consoles.
 */
export function interpretMcpGetResult(raw: RawInvocationResult): OptionalServerState {
  if (raw.timedOut) {
    return "indeterminate";
  }
  if (raw.exitCode === 0) {
    return "present";
  }
  if (raw.exitCode === 1) {
    return "absent";
  }
  return "indeterminate";
}

/** Pure interpretation of a `claude mcp add` invocation's raw result. Implements PHASE_9_SPEC.md §6.5. */
export function interpretMcpAddResult(raw: RawInvocationResult): "ok" | "failed" | "indeterminate" {
  if (raw.timedOut) {
    return "indeterminate";
  }
  if (raw.exitCode === 0) {
    return "ok";
  }
  return "failed";
}

/**
 * The single total function mapping the pre-check/add/post-verify triple to a {@link SetupOutcome}.
 * Total over every input combination, with a `never`-typed exhaustiveness assertion in the final
 * arm -- the same compile-time totality proof `decideDriverStep()` uses. Every reachable
 * combination is enumerated in `src/setup/registry.test.ts`'s AC-D1 table test. Implements
 * PHASE_9_SPEC.md §6.5.
 */
export function decideServerOutcome(
  pre: OptionalServerState,
  add: "ok" | "failed" | "indeterminate" | "not-attempted",
  post: OptionalServerState | "not-attempted",
): SetupOutcome {
  switch (pre) {
    case "present":
      return "already-registered";
    case "indeterminate":
      return "indeterminate";
    case "absent":
      switch (add) {
        case "failed":
          return "failed";
        case "indeterminate":
          return "indeterminate";
        case "not-attempted":
          // Unreachable in practice (pre === "absent" always attempts Step B), but this branch
          // still maps to a concrete, total outcome rather than throwing.
          return "indeterminate";
        case "ok":
          switch (post) {
            case "present":
              return "registered";
            case "absent":
            case "indeterminate":
              return "registered-unverified";
            case "not-attempted":
              // Unreachable when add === "ok" (Step C always runs after a successful add), but
              // still mapped rather than left partial.
              return "registered-unverified";
            default: {
              const exhaustive: never = post;
              throw new InternalError(`decideServerOutcome: unreachable post state`, { post: exhaustive });
            }
          }
        default: {
          const exhaustive: never = add;
          throw new InternalError(`decideServerOutcome: unreachable add state`, { add: exhaustive });
        }
      }
    default: {
      const exhaustive: never = pre;
      throw new InternalError(`decideServerOutcome: unreachable pre state`, { pre: exhaustive });
    }
  }
}

/**
 * Runs `claude mcp add ...` for `name`/`launch` and returns the raw result. Thin I/O wrapper around
 * {@link buildMcpAddArgs}. `deps.runProcess` is a test seam only, defaulting to the real
 * `runProcess`.
 */
export async function mcpAdd(
  name: SetupServerId,
  launch: ResolvedLaunch,
  deps?: { readonly runProcess?: RunProcessFn },
): Promise<RawInvocationResult> {
  const runProcess = deps?.runProcess ?? runProcessDefault;
  return runProcess({ command: "claude", args: [...buildMcpAddArgs(name, launch)], cwd: process.cwd(), timeoutMs: MCP_ADD_TIMEOUT_MS });
}

/**
 * Runs `claude mcp get <name>` and returns the raw result. Thin I/O wrapper around
 * {@link buildMcpGetArgs}. `deps.runProcess` is a test seam only, defaulting to the real
 * `runProcess`.
 */
export async function mcpGet(
  name: SetupServerId,
  deps?: { readonly runProcess?: RunProcessFn },
): Promise<RawInvocationResult> {
  const runProcess = deps?.runProcess ?? runProcessDefault;
  return runProcess({ command: "claude", args: [...buildMcpGetArgs(name)], cwd: process.cwd(), timeoutMs: MCP_GET_TIMEOUT_MS });
}

/** One optional research server's observed presence state, from {@link probeOptionalResearchServers}. */
export interface OptionalServerProbe {
  readonly id: SetupServerId;
  readonly state: OptionalServerState;
  readonly detail: string;
}

const OPTIONAL_RESEARCH_SERVER_IDS: readonly SetupServerId[] = ["arxiv-mcp", "paper-search-mcp"];

/**
 * Probes `arxiv-mcp` and `paper-search-mcp`'s presence in the operator's Claude Code config,
 * concurrently, at most once per call and never retried. Returns `[]` immediately if the `claude`
 * CLI itself was not found. Never throws in any branch -- the whole body is wrapped so an
 * unexpected error yields two `indeterminate` probes rather than propagating (PRD §9 FM13).
 * Implements PHASE_9_SPEC.md §6.7.
 */
export async function probeOptionalResearchServers(deps?: {
  readonly runProcess?: RunProcessFn;
  readonly checkProviderCli?: CheckProviderCliFn;
}): Promise<readonly OptionalServerProbe[]> {
  try {
    const checkProviderCli = deps?.checkProviderCli ?? checkProviderCliDefault;
    const cli = await checkProviderCli("claude-code");
    if (!cli.found) {
      return [];
    }
    const runProcess = deps?.runProcess ?? runProcessDefault;
    const results = await Promise.all(
      OPTIONAL_RESEARCH_SERVER_IDS.map(async (id) => {
        const raw = await runProcess({ command: "claude", args: [...buildMcpGetArgs(id)], cwd: process.cwd(), timeoutMs: MCP_GET_TIMEOUT_MS });
        const state = interpretMcpGetResult(raw);
        return { id, state, detail: raw.stdout.trim().slice(0, 400) };
      }),
    );
    return results;
  } catch (err) {
    return OPTIONAL_RESEARCH_SERVER_IDS.map((id) => ({
      id,
      state: "indeterminate" as const,
      detail: `probe failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
    }));
  }
}

/**
 * Pure rendering of {@link OptionalServerProbe}s into a stderr note, or `null` when there is
 * nothing to say (the array is empty, or every probe is `present`). Never claims a server is
 * absent when its state is merely `indeterminate`; never uses failure-connotation words. Implements
 * PHASE_9_SPEC.md §6.7.
 */
export function renderOptionalResearchNote(probes: readonly OptionalServerProbe[]): string | null {
  const nonPresent = probes.filter((p) => p.state !== "present");
  if (probes.length === 0 || nonPresent.length === 0) {
    return null;
  }
  const lines: string[] = [];
  lines.push("multi-loopr: optional research server note");
  for (const p of nonPresent) {
    const stateSentence =
      p.state === "absent"
        ? `${p.id} is not registered in your Claude Code MCP config.`
        : `${p.id}'s registration state could not be determined (the check was inconclusive).`;
    lines.push(`  - ${stateSentence}`);
  }
  lines.push(
    "  multi-loopr does not require these servers -- nothing in this run was skipped or degraded " +
      "because of them. To add them: run `multi-loopr setup`.",
  );
  return lines.join("\n") + "\n";
}

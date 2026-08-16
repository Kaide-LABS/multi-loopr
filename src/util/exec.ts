// Implements PHASE_1_SPEC.md §6.1
//
// The single sanctioned child-process wrapper. This is the ONLY module in the codebase permitted
// to import `node:child_process` -- boundary/reviewer tooling greps for it and fails any other
// file that imports this module directly (PHASE_1_SPEC.md §8 acceptance check #8).
//
// Windows note (AUTONOMOUS CRITIQUE adjustment, see the executor's handoff): npm's global install
// mechanism on Windows publishes CLI tools (including both provider CLIs this project drives) as
// `.cmd` launcher shims, not `.exe` files. Node's `child_process.spawn` cannot execute a `.cmd`/
// `.bat` file at all when `shell: false` -- it fails with `ENOENT` regardless of whether the
// command is genuinely on PATH -- which is a real, OS-level limitation, not a bug in this file
// [observed locally: `spawn("claude", ["--version"], { shell: false })` -> `ENOENT`, while `where
// claude` resolves it to `...\npm\claude.cmd`]. `shell: false` for the primary spawn stays exactly
// as specified (arguments are never handed to a shell for metacharacter interpretation). The
// narrow fallback below only engages when that primary spawn fails with `ENOENT` on `win32`, and
// only relaunches through `cmd.exe /d /s /c` when every argument is already free of cmd.exe's own
// metacharacters -- so the fallback lets cmd.exe do its own PATH+PATHEXT resolution (finding the
// `.cmd` shim, exactly as a human typing the same command at a prompt would) without reintroducing
// shell-injection risk through argument content.

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { RawInvocationResult } from "../domain/run.ts";

/** Options for {@link runProcess}. */
export interface RunProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string | null;
  /** Required: no default. A turn without an explicit timeout is precisely FM7 (PRD §9). */
  readonly timeoutMs: number;
  /** Default 10_000_000 bytes, applied independently to stdout and stderr. */
  readonly maxOutputBytes?: number;
}

const DEFAULT_MAX_OUTPUT_BYTES = 10_000_000;
const SIGKILL_GRACE_MS = 5000;

interface AccumState {
  readonly bytes: number;
  readonly truncated: boolean;
}

function appendChunk(
  chunks: Buffer[],
  chunk: Buffer,
  state: AccumState,
  maxOutputBytes: number,
  streamLabel: "stdout" | "stderr",
): AccumState {
  if (state.truncated) {
    return state;
  }
  if (state.bytes + chunk.length > maxOutputBytes) {
    const remaining = Math.max(0, maxOutputBytes - state.bytes);
    if (remaining > 0) {
      chunks.push(chunk.subarray(0, remaining));
    }
    chunks.push(Buffer.from(`\n...[${streamLabel} truncated at ${maxOutputBytes} bytes]...\n`, "utf8"));
    return { bytes: maxOutputBytes, truncated: true };
  }
  chunks.push(chunk);
  return { bytes: state.bytes + chunk.length, truncated: false };
}

/** cmd.exe metacharacters that must never appear in an argument relaunched through it (fail-safe: refuse, don't escape). */
const CMD_SHELL_UNSAFE_CHARS = /[&|<>^%"\r\n]/;

function canRelaunchViaWindowsCmd(args: readonly string[]): boolean {
  return process.platform === "win32" && args.every((a) => !CMD_SHELL_UNSAFE_CHARS.test(a));
}

function isEnoent(err: Error): boolean {
  return "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Spawns `command`/`args` with `shell: false` (mandatory -- a shell would reintroduce
 * argument-injection and make an adapter's argv contract meaningless) and resolves with a
 * {@link RawInvocationResult}. Never rejects: a spawn failure (e.g. `ENOENT`, the CLI is not
 * installed) resolves with `exitCode: null` and the error text in `stderr`, so callers cannot
 * confuse "not installed" with a thrown bug.
 *
 * `allowWindowsCmdFallback` gates the one-time `cmd.exe` relaunch described at the top of this
 * file; it is only ever `false` on the relaunch attempt itself, preventing a retry loop.
 */
function spawnOnce(
  o: RunProcessOptions,
  command: string,
  args: readonly string[],
  allowWindowsCmdFallback: boolean,
): Promise<RawInvocationResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const maxOutputBytes = o.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

    let child: ChildProcess;
    try {
      child = spawn(command, [...args], {
        cwd: o.cwd,
        env: o.env,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
        timedOut: false,
      });
      return;
    }

    let settled = false;
    let timedOut = false;
    let sigkillTimer: NodeJS.Timeout | null = null;

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutState: AccumState = { bytes: 0, truncated: false };
    let stderrState: AccumState = { bytes: 0, truncated: false };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutState = appendChunk(stdoutChunks, chunk, stdoutState, maxOutputBytes, "stdout");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrState = appendChunk(stderrChunks, chunk, stderrState, maxOutputBytes, "stderr");
    });

    // [DET, FM7] never inherit the parent TTY on stdin.
    if (typeof o.stdin === "string") {
      child.stdin?.end(o.stdin, "utf8");
    } else {
      child.stdin?.end();
    }

    const killTimer: NodeJS.Timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      sigkillTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, SIGKILL_GRACE_MS);
    }, o.timeoutMs);

    function settle(exitCode: number | null, signal: NodeJS.Signals | null, stderrOverride?: string): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(killTimer);
      if (sigkillTimer !== null) {
        clearTimeout(sigkillTimer);
      }
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: stderrOverride ?? Buffer.concat(stderrChunks).toString("utf8"),
        durationMs: Date.now() - start,
        timedOut,
      });
    }

    child.on("error", (err) => {
      // Asynchronous spawn failures (e.g. ENOENT) surface here rather than as a thrown exception.
      if (allowWindowsCmdFallback && isEnoent(err) && canRelaunchViaWindowsCmd(args)) {
        settled = true;
        clearTimeout(killTimer);
        if (sigkillTimer !== null) {
          clearTimeout(sigkillTimer);
        }
        resolve(spawnOnce(o, "cmd.exe", ["/d", "/s", "/c", command, ...args], false));
        return;
      }
      settle(null, null, err.message);
    });

    child.on("close", (code, signal) => {
      settle(code, signal);
    });
  });
}

/**
 * Spawns `o.command`/`o.args` and resolves with a {@link RawInvocationResult}. See the file-level
 * comment for the narrow, safety-gated Windows `.cmd`/`.bat` shim fallback this delegates to.
 *
 * [DET, PRD §9 FM7] stdin is never inherited from the parent TTY: a string payload is written and
 * closed, and when no payload is given stdin is closed immediately. A provider CLI that tries to
 * prompt therefore reads EOF and fails fast instead of hanging the run.
 *
 * [DET, PRD §9 FM7] `timeoutMs` is mandatory and always armed: on expiry the process is sent
 * `SIGTERM`, escalated to `SIGKILL` after a 5 second grace, and the result always carries
 * `timedOut: true` regardless of what exit code the process eventually reports.
 */
export function runProcess(o: RunProcessOptions): Promise<RawInvocationResult> {
  return spawnOnce(o, o.command, o.args, true);
}

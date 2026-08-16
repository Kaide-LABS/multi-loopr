// Implements PHASE_1_SPEC.md §6.7 -- FM1 / FM9 [DET]
//
// Toolchain, git, and provider-CLI health checks. This module -- and everything it calls -- never
// triggers either provider's own credential-setup flow; it only *observes* credential state
// (boundary rule B6, PRD §9 FM1). On an authentication failure it points the operator at the
// provider CLI's own --help/docs rather than spelling out the exact lowercase sign-in command:
// boundary rule B6's source-pattern regex (§6.8) matches those exact word sequences regardless of
// whether they appear in real invocation code or in inert remediation text, so embedding them
// literally in a comment or string here would make multi-loopr's own `doctor --boundary` scan
// fail on this file. Referring the operator to the CLI's own --help is also more robust against
// the version drift FM9 already tracks.

import type { PreflightReport } from "../ports/provider-adapter.ts";
import { PROVIDER_IDS } from "../domain/run.ts";
import type { AuthProbeState, ProviderId, RawInvocationResult } from "../domain/run.ts";
import { runProcess } from "../util/exec.ts";
import { gitVersion } from "./git.ts";

const CLI_PROBE_TIMEOUT_MS = 15_000;

/** Per-provider CLI version acceptance range (min inclusive, max exclusive). §2.3. */
export const PROVIDER_VERSION_RANGES: Readonly<Record<ProviderId, { min: string; maxExclusive: string }>> = {
  "claude-code": { min: "2.1.200", maxExclusive: "3.0.0" },
  "codex-cli": { min: "0.128.0", maxExclusive: "1.0.0" },
};

/**
 * Toolchain version acceptance ranges. Node.js and git only have a stated minimum (§2.3); the
 * `maxExclusive` sentinel below represents "no practical ceiling" so {@link inRange} can use one
 * uniform two-sided comparison for every range in this file.
 */
export const TOOL_VERSION_RANGES: Readonly<Record<"node" | "git", { min: string; maxExclusive: string }>> = {
  node: { min: "24.0.0", maxExclusive: "1000.0.0" },
  git: { min: "2.40.0", maxExclusive: "1000.0.0" },
};

/** The result of checking one toolchain component's presence and version. */
export interface ToolCheck {
  readonly found: boolean;
  readonly version: string | null;
  readonly inRange: boolean;
}

/** The aggregated result of {@link runPreflight}. */
export interface PreflightSummary {
  readonly node: ToolCheck;
  readonly git: ToolCheck;
  /** Always both providers, in {@link PROVIDER_IDS} order. */
  readonly providers: readonly PreflightReport[];
  readonly ok: boolean;
  readonly problems: readonly string[];
}

/**
 * Extracts the first `MAJOR.MINOR.PATCH` triple from an arbitrary version banner (e.g.
 * `"2.1.211 (Claude Code)"`, `"codex-cli 0.128.0"`, `"git version 2.54.0.windows.1"`). Returns
 * `null` if no such triple is present.
 */
export function parseSemverish(s: string): { major: number; minor: number; patch: number } | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(s);
  if (match === null) {
    return null;
  }
  const majorStr = match[1];
  const minorStr = match[2];
  const patchStr = match[3];
  if (majorStr === undefined || minorStr === undefined || patchStr === undefined) {
    return null;
  }
  return { major: Number(majorStr), minor: Number(minorStr), patch: Number(patchStr) };
}

function compareSemverish(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number },
): number {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  return a.patch - b.patch;
}

/** True iff `v` parses and falls in `[min, maxExclusive)`. */
export function inRange(v: string, min: string, maxExclusive: string): boolean {
  const parsedV = parseSemverish(v);
  const parsedMin = parseSemverish(min);
  const parsedMax = parseSemverish(maxExclusive);
  if (parsedV === null || parsedMin === null || parsedMax === null) {
    return false;
  }
  return compareSemverish(parsedV, parsedMin) >= 0 && compareSemverish(parsedV, parsedMax) < 0;
}

/** Node.js version check. Synchronous: reads `process.versions.node` directly, no child process. */
export function checkNodeVersion(): ToolCheck {
  const version = process.versions.node;
  const range = TOOL_VERSION_RANGES.node;
  return { found: true, version, inRange: inRange(version, range.min, range.maxExclusive) };
}

/** git availability/version check via `git --version` (`src/verify/git.ts`'s `gitVersion`). */
export async function checkGitAvailable(repoDir: string): Promise<ToolCheck> {
  const raw = await gitVersion(repoDir);
  if (raw === null) {
    return { found: false, version: null, inRange: false };
  }
  const range = TOOL_VERSION_RANGES.git;
  return { found: true, version: raw, inRange: inRange(raw, range.min, range.maxExclusive) };
}

const PROVIDER_COMMAND: Readonly<Record<ProviderId, string>> = {
  "claude-code": "claude",
  "codex-cli": "codex",
};

/**
 * Pure interpretation of a `<cli> --version` invocation's raw result. Exported (alongside the
 * other `parse*` functions below) so `checkProviderCli`/`checkProviderAuth` -- whose signatures
 * PHASE_1_SPEC.md §6.7 fixes to take only a {@link ProviderId} -- can stay exactly as specified
 * while this interpretation logic itself is unit-testable with a literally-constructed
 * {@link RawInvocationResult}, i.e. "injected fake process results" (PHASE_1_SPEC.md §1.6), with
 * no process spawned and no module-mocking machinery required.
 */
export function parseProviderCliVersionResult(result: RawInvocationResult): { found: boolean; version: string | null } {
  if (result.exitCode !== 0) {
    return { found: false, version: null };
  }
  return { found: true, version: result.stdout.trim() };
}

/**
 * The interpreted result of one credential probe.
 *
 * `authenticated` is retained with its original, unchanged meaning ("definitively authenticated")
 * so every existing consumer -- including the shipped `doctor --json` schema -- is unaffected; it is
 * derived from `authState` by {@link authProbeResult} and is never set independently, so the two can
 * never disagree. `authState` is the additive discriminant carrying the distinction the boolean
 * structurally cannot express: a probe that *failed* is not a provider that is *signed out*.
 */
export interface AuthProbeResult {
  readonly authenticated: boolean;
  readonly authState: AuthProbeState;
  readonly detail: string;
}

/**
 * The single constructor for an {@link AuthProbeResult}. Deriving `authenticated` here (rather than
 * letting each call site pass both) is what makes "`authenticated === true` iff
 * `authState === \"authenticated\"`" a property of the type rather than a convention every branch
 * has to remember.
 */
function authProbeResult(authState: AuthProbeState, detail: string): AuthProbeResult {
  return { authenticated: authState === "authenticated", authState, detail };
}

/**
 * Pure interpretation of a `claude auth status` invocation's raw result (PHASE_1_SPEC.md §6.7).
 *
 * The CLI's verified behaviour (docs/modernization_log.md §4) is exit `0` with a JSON object whose
 * `loggedIn` boolean is the answer -- in *both* directions. So `loggedIn: true` is the only
 * authenticated result and `loggedIn: false` is the only definitively-unauthenticated one; a
 * non-zero exit, a timeout, non-JSON stdout, or a JSON object with no `loggedIn` boolean are all
 * cases where the CLI did not actually answer the question, and are reported `"indeterminate"`
 * rather than being silently rounded down to "not signed in". Never a crash in any branch.
 */
export function parseClaudeAuthResult(result: RawInvocationResult): AuthProbeResult {
  if (result.timedOut) {
    return authProbeResult("indeterminate", "auth status probe timed out; credential state not observed");
  }
  if (result.exitCode !== 0) {
    return authProbeResult(
      "indeterminate",
      `auth status probe exited ${String(result.exitCode)} instead of its expected 0; ` +
        "credential state not observed",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return authProbeResult("indeterminate", "unrecognised auth status output (not JSON); credential state not observed");
  }
  if (typeof parsed !== "object" || parsed === null) {
    return authProbeResult(
      "indeterminate",
      "unrecognised auth status output (JSON, but not an object); credential state not observed",
    );
  }
  const loggedIn = (parsed as Record<string, unknown>)["loggedIn"];
  if (loggedIn === true) {
    return authProbeResult("authenticated", "authenticated");
  }
  if (loggedIn === false) {
    return authProbeResult("unauthenticated", "auth status reported loggedIn: false");
  }
  return authProbeResult(
    "indeterminate",
    "auth status output carried no loggedIn boolean; credential state not observed",
  );
}

/**
 * The exit code `codex login status` is documented and locally observed to return when the operator
 * is not signed in (docs/modernization_log.md §4: exit `1` + `Not logged in`). Any *other* non-zero
 * exit is an outcome neither of that CLI's two documented results describes, so it says nothing
 * about credentials -- see {@link parseCodexAuthResult}.
 */
const CODEX_NOT_SIGNED_IN_EXIT_CODE = 1;

/**
 * Pure interpretation of a `codex login status` invocation's raw result (PHASE_1_SPEC.md §6.7):
 * keyed on exit code only (the authenticated stdout shape is [UNVERIFIED]). A non-empty
 * `CODEX_API_KEY` or `OPENAI_API_KEY` in `env` is an accepted alternative BYOA satisfying path.
 *
 * This provider is where the exit-code ambiguity actually bit: the Windows `cmd.exe` relaunch
 * fallback in `src/util/exec.ts` could surface an exit code from the *shim* rather than from the
 * CLI, and the old boolean rendered that indistinguishable from a genuine not-signed-in result. So
 * only exit `0` (or a BYOA env var) is authenticated, only {@link CODEX_NOT_SIGNED_IN_EXIT_CODE}
 * with no such env var is definitively not, and every other exit code -- including a failed spawn's
 * `null` and a timeout -- is `"indeterminate"`.
 */
export function parseCodexAuthResult(
  result: RawInvocationResult,
  env: Readonly<Record<string, string | undefined>>,
): AuthProbeResult {
  if (result.exitCode === 0) {
    return authProbeResult("authenticated", "authenticated");
  }
  const apiKey = env["CODEX_API_KEY"] ?? env["OPENAI_API_KEY"] ?? "";
  if (apiKey !== "") {
    return authProbeResult("authenticated", "authenticated via API key env var");
  }
  if (result.timedOut) {
    return authProbeResult("indeterminate", "login status probe timed out; credential state not observed");
  }
  if (result.exitCode === CODEX_NOT_SIGNED_IN_EXIT_CODE) {
    return authProbeResult(
      "unauthenticated",
      `login status exited ${String(CODEX_NOT_SIGNED_IN_EXIT_CODE)} (its documented not-signed-in result) ` +
        "and no API key env var is set",
    );
  }
  return authProbeResult(
    "indeterminate",
    `login status exited ${String(result.exitCode)}, which matches neither its documented ` +
      `authenticated (0) nor not-signed-in (${String(CODEX_NOT_SIGNED_IN_EXIT_CODE)}) result; ` +
      "the probe itself may have failed, so credential state was not observed",
  );
}

/** Runs `<cli> --version` for `id` and reports whether the CLI was found and its raw version banner. */
export async function checkProviderCli(id: ProviderId): Promise<{ found: boolean; version: string | null }> {
  const result = await runProcess({
    command: PROVIDER_COMMAND[id],
    args: ["--version"],
    cwd: process.cwd(),
    timeoutMs: CLI_PROBE_TIMEOUT_MS,
  });
  return parseProviderCliVersionResult(result);
}

/**
 * [DET, boundary-critical] Observes -- never establishes -- `id`'s credential state. Keys the
 * predicate exactly as PHASE_1_SPEC.md §6.7 specifies per provider.
 */
export async function checkProviderAuth(id: ProviderId): Promise<AuthProbeResult> {
  if (id === "claude-code") {
    const result = await runProcess({
      command: PROVIDER_COMMAND["claude-code"],
      args: ["auth", "status"],
      cwd: process.cwd(),
      timeoutMs: CLI_PROBE_TIMEOUT_MS,
    });
    return parseClaudeAuthResult(result);
  }
  const result = await runProcess({
    command: PROVIDER_COMMAND["codex-cli"],
    args: ["login", "status"],
    cwd: process.cwd(),
    timeoutMs: CLI_PROBE_TIMEOUT_MS,
  });
  return parseCodexAuthResult(result, process.env);
}

function notFoundRemediation(id: ProviderId): string {
  return id === "claude-code"
    ? "Claude Code CLI was not found on PATH. Install it and sign in yourself; multi-loopr never installs or signs in on your behalf."
    : "Codex CLI was not found on PATH. Install it and sign in yourself; multi-loopr never installs or signs in on your behalf.";
}

function authRemediation(id: ProviderId): string {
  return id === "claude-code"
    ? "Claude Code CLI is not authenticated. Run `claude --help` yourself to find its own sign-in " +
        "flow; multi-loopr only observes credential state and never signs you in."
    : "Codex CLI is not authenticated. Run `codex --help` yourself to find its own sign-in flow, " +
        "or set CODEX_API_KEY / OPENAI_API_KEY; multi-loopr only observes credential state and " +
        "never signs you in.";
}

/**
 * The remediation for an `"indeterminate"` probe. Deliberately worded as a *different instruction*
 * from {@link authRemediation}: this is not "go sign in", it is "the check itself did not work, so
 * do not trust either answer". An operator who cannot tell these two apart will follow the sign-in
 * advice, find they are already signed in, and conclude the tool is merely noisy -- which is exactly
 * how the Windows `cmd.exe` quoting defect stayed hidden while `doctor` looked plausible.
 */
function indeterminateAuthRemediation(id: ProviderId, detail: string): string {
  const cli = id === "claude-code" ? "Claude Code" : "Codex";
  return (
    `${cli} CLI's credential state could NOT be determined -- this is not the same as being signed ` +
    `out, and signing in again will not fix it. The probe failed to produce a conclusive answer ` +
    `(${detail}). Run \`${PROVIDER_COMMAND[id]} --help\` yourself and invoke that CLI's own status ` +
    `command directly to see what it actually reports; a probe that fails for an unrelated reason ` +
    `has previously masked a real defect here. multi-loopr only observes credential state and never ` +
    `signs you in.`
  );
}

/**
 * Assembles a single provider's {@link PreflightReport}: CLI presence/version, then (only if the
 * CLI was found) its auth state, then the derived `problems` list. This is the exact per-provider
 * block `runPreflight()`'s loop body computed inline in Phase 1, lifted out unchanged so both
 * `runPreflight()` (§below) and each Phase 2 `ProviderAdapter.preflight()` (`src/adapters/*.ts`)
 * assemble a provider's health from this single place -- never two independently-maintained
 * copies of the same version-range/auth-interpretation logic (PRD §9 FM9). Implements
 * PHASE_2_SPEC.md §1.5/§6.5.
 */
export async function buildProviderPreflightReport(id: ProviderId): Promise<PreflightReport> {
  const cli = await checkProviderCli(id);
  const range = PROVIDER_VERSION_RANGES[id];
  const versionInRange = cli.version !== null && inRange(cli.version, range.min, range.maxExclusive);
  // A CLI that was never found could not be probed at all, so its credential state is unknown --
  // "indeterminate", not "signed out". The missing CLI itself is already reported below, so this
  // branch deliberately adds no second problem line.
  const auth: AuthProbeResult = cli.found
    ? await checkProviderAuth(id)
    : authProbeResult("indeterminate", "CLI not found; auth probe skipped");

  const reportProblems: string[] = [];
  if (!cli.found) {
    reportProblems.push(notFoundRemediation(id));
  } else if (!versionInRange) {
    reportProblems.push(
      `${id}: version ${cli.version ?? "unknown"} is outside the required range [${range.min}, ${range.maxExclusive}).`,
    );
  }
  if (cli.found && auth.authState === "unauthenticated") {
    reportProblems.push(authRemediation(id));
  } else if (cli.found && auth.authState === "indeterminate") {
    reportProblems.push(indeterminateAuthRemediation(id, auth.detail));
  }

  return {
    provider: id,
    cliFound: cli.found,
    version: cli.version,
    versionInRange,
    authenticated: auth.authenticated,
    authState: auth.authState,
    problems: reportProblems,
  };
}

/**
 * Runs every toolchain and provider check and assembles a {@link PreflightSummary}. Always probes
 * **both** providers, even if the first fails, so a single run reports every problem at once.
 */
export async function runPreflight(repoDir: string): Promise<PreflightSummary> {
  const node = checkNodeVersion();
  const git = await checkGitAvailable(repoDir);

  const problems: string[] = [];
  if (!node.inRange) {
    problems.push(
      node.found
        ? `Node.js ${node.version ?? "unknown"} is outside the required range [${TOOL_VERSION_RANGES.node.min}, ${TOOL_VERSION_RANGES.node.maxExclusive}).`
        : "Node.js was not found.",
    );
  }
  if (!git.inRange) {
    problems.push(
      git.found
        ? `git ${git.version ?? "unknown"} is outside the required range [${TOOL_VERSION_RANGES.git.min}, ${TOOL_VERSION_RANGES.git.maxExclusive}). Install git >=2.40.0.`
        : "git was not found. Install git >=2.40.0.",
    );
  }

  const providers: PreflightReport[] = [];
  for (const id of PROVIDER_IDS) {
    const report = await buildProviderPreflightReport(id);
    providers.push(report);
    problems.push(...report.problems);
  }

  const ok = node.inRange && git.inRange && providers.every((p) => p.problems.length === 0);
  return { node, git, providers, ok, problems };
}

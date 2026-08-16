// Implements PHASE_1_SPEC.md §6.10, §4.2
//
// The `doctor` command: composes preflight + boundary + a lock smoke test into one report.
// `runDoctor` only ever *returns* an exit code; it never calls `process.exit` -- only `main.ts` does.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ExitCode, LockHeldError } from "../domain/errors.ts";
import { IsoUtc } from "../domain/relay.ts";
import { AuthProbeStateSchema, ProviderIdSchema } from "../domain/run.ts";
import type { PreflightReport } from "../ports/provider-adapter.ts";
import type { BoundaryViolation } from "../verify/boundary.ts";
import { listScannedSourceFiles, scanBoundary } from "../verify/boundary.ts";
import type { ToolCheck } from "../verify/preflight.ts";
import { runPreflight } from "../verify/preflight.ts";
import { acquireRunLock, releaseRunLock } from "../util/lock.ts";

const ToolCheckSchema = z.strictObject({
  found: z.boolean(),
  version: z.string().nullable(),
  inRange: z.boolean(),
});

const PreflightReportSchema = z.strictObject({
  provider: ProviderIdSchema,
  cliFound: z.boolean(),
  version: z.string().nullable(),
  versionInRange: z.boolean(),
  // `authenticated` keeps its shipped meaning exactly: `true` iff definitively authenticated. Every
  // consumer already written against it is unaffected. `authState` is purely additive -- it splits
  // the `false` case into the two claims that were previously indistinguishable ("the CLI says you
  // are signed out" vs. "the probe never got an answer"), which is a new field on an existing
  // report, not a new report shape. Hence no `schema_version` bump.
  authenticated: z.boolean(),
  authState: AuthProbeStateSchema,
  problems: z.array(z.string()),
});

const BoundaryViolationSchema = z.strictObject({
  rule: z.enum(["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"]),
  file: z.string(),
  line: z.number().int(),
  excerpt: z.string(),
});

/** The `doctor --json` output shape (PHASE_1_SPEC.md §4.2). */
export const DoctorReport = z.strictObject({
  schema_version: z.literal(1),
  generated_at: IsoUtc,
  ok: z.boolean(),
  exit_code: z.number().int(),
  toolchain: z.strictObject({ node: ToolCheckSchema, git: ToolCheckSchema }),
  providers: z.array(PreflightReportSchema),
  boundary: z.strictObject({
    filesScanned: z.number().int(),
    violations: z.array(BoundaryViolationSchema),
  }),
  lock: z.strictObject({ acquirable: z.boolean(), detail: z.string() }),
  problems: z.array(z.string()),
});

/** The inferred type of {@link DoctorReport}. */
export type DoctorReport = z.infer<typeof DoctorReport>;

/** `doctor` command options, derived from CLI flags (`src/cli/main.ts`). */
export interface DoctorOptions {
  readonly json: boolean;
  readonly only: "all" | "boundary" | "providers";
}

/**
 * Any credential-looking substring is redacted, and the result capped at 200 characters, before a
 * boundary-violation excerpt is placed in a report an operator might paste into a public issue.
 */
const CREDENTIAL_LOOKING_PATTERN = /(sk-|ghp_|xoxb-)[A-Za-z0-9_-]+/g;

function redactExcerpt(excerpt: string): string {
  const redacted = excerpt.replace(CREDENTIAL_LOOKING_PATTERN, "***REDACTED***");
  return redacted.length > 200 ? redacted.slice(0, 200) : redacted;
}

/**
 * Acquires and releases the run lock against a throwaway temp directory (never the real repo, so
 * this can never contend with a genuinely active run). A {@link LockHeldError} here is reported in
 * the result, not thrown.
 */
async function lockSmokeTest(): Promise<{ acquirable: boolean; detail: string }> {
  let tempDir: string;
  try {
    tempDir = await mkdtemp(`${tmpdir()}/multi-loopr-doctor-`);
  } catch (err) {
    return {
      acquirable: false,
      detail: `failed to create smoke-test directory: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  try {
    const runId = randomUUID();
    try {
      await acquireRunLock(tempDir, runId);
      await releaseRunLock(tempDir, runId);
      return { acquirable: true, detail: "lock acquire/release smoke test passed" };
    } catch (err) {
      if (err instanceof LockHeldError) {
        return { acquirable: false, detail: err.message };
      }
      return { acquirable: false, detail: err instanceof Error ? err.message : String(err) };
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
  }
}

function computeExitCode(input: {
  readonly boundaryViolations: readonly BoundaryViolation[];
  readonly providers: readonly PreflightReport[];
  readonly toolchainNode: ToolCheck;
  readonly toolchainGit: ToolCheck;
  readonly lockAcquirable: boolean;
  readonly mode: DoctorOptions["only"];
}): number {
  const candidates: number[] = [];

  const hasNonB7Violation = input.boundaryViolations.some((v) => v.rule !== "B7");
  const hasB7Violation = input.boundaryViolations.some((v) => v.rule === "B7");
  if (hasNonB7Violation) {
    // The harder failure wins when both a B7 and another B-rule fire in the same scan.
    candidates.push(ExitCode.BOUNDARY_VIOLATION);
  } else if (hasB7Violation) {
    candidates.push(ExitCode.TIER_WELDING);
  }

  if (input.mode !== "boundary") {
    const preflightFailed =
      !input.toolchainNode.inRange || !input.toolchainGit.inRange || input.providers.some((p) => p.problems.length > 0);
    if (preflightFailed) {
      candidates.push(ExitCode.PREFLIGHT_FAILED);
    }
  }

  if (input.mode === "all" && !input.lockAcquirable) {
    candidates.push(ExitCode.LOCK_HELD);
  }

  return candidates.length === 0 ? ExitCode.OK : Math.min(...candidates);
}

/**
 * Runs the checks selected by `opts.only` and assembles a {@link DoctorReport}. `only: "all"` runs
 * every check (toolchain + both providers' preflight, the boundary scan, and the lock smoke test);
 * `only: "boundary"` runs the boundary scan alone (no provider probes, fast); `only: "providers"`
 * runs preflight alone (which already bundles the toolchain checks). Sections that were not run
 * for a given mode are reported with neutral placeholders that never contribute to `problems` or
 * the exit code.
 */
export async function runDoctor(
  repoRoot: string,
  opts: DoctorOptions,
): Promise<{ report: DoctorReport; exitCode: number }> {
  const generatedAt = new Date().toISOString();
  const problems: string[] = [];

  const runBoundary = opts.only === "all" || opts.only === "boundary";
  const runProviders = opts.only === "all" || opts.only === "providers";
  const runLockSmokeTest = opts.only === "all";

  let toolchainNode: ToolCheck = { found: true, version: null, inRange: true };
  let toolchainGit: ToolCheck = { found: true, version: null, inRange: true };
  let providerReports: readonly PreflightReport[] = [];

  if (runProviders) {
    const summary = await runPreflight(repoRoot);
    toolchainNode = summary.node;
    toolchainGit = summary.git;
    providerReports = summary.providers;
    problems.push(...summary.problems);
  }

  let boundaryFilesScanned = 0;
  let boundaryViolations: readonly BoundaryViolation[] = [];
  if (runBoundary) {
    boundaryFilesScanned = (await listScannedSourceFiles(repoRoot)).length;
    const rawViolations = await scanBoundary(repoRoot);
    boundaryViolations = rawViolations.map((v) => ({ ...v, excerpt: redactExcerpt(v.excerpt) }));
    for (const v of boundaryViolations) {
      problems.push(`Boundary rule ${v.rule} violated in ${v.file}:${String(v.line)}: ${v.excerpt}`);
    }
  }

  let lockAcquirable = true;
  let lockDetail = "not checked";
  if (runLockSmokeTest) {
    const smoke = await lockSmokeTest();
    lockAcquirable = smoke.acquirable;
    lockDetail = smoke.detail;
    if (!smoke.acquirable) {
      problems.push(`Run lock is not acquirable: ${smoke.detail}`);
    }
  }

  const exitCode = computeExitCode({
    boundaryViolations,
    providers: providerReports,
    toolchainNode,
    toolchainGit,
    lockAcquirable,
    mode: opts.only,
  });

  const report: DoctorReport = {
    schema_version: 1,
    generated_at: generatedAt,
    ok: problems.length === 0,
    exit_code: exitCode,
    toolchain: { node: toolchainNode, git: toolchainGit },
    providers: providerReports.map((p) => ({ ...p, problems: [...p.problems] })),
    boundary: { filesScanned: boundaryFilesScanned, violations: [...boundaryViolations] },
    lock: { acquirable: lockAcquirable, detail: lockDetail },
    problems,
  };

  return { report, exitCode };
}

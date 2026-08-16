// Implements PHASE_3_SPEC.md §1.2 -- run.test.ts
// CLI-level config-file validation errors, --json output shape, exit-code passthrough from
// runDispatch(). Covers §8 acceptance criteria #27, #28, #29, #31.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { UsageError } from "../domain/errors.ts";
import { runProcess } from "../util/exec.ts";
import { RunConfig } from "../domain/run.ts";
import { runRunCommand, RunReport } from "./run.ts";

const MAIN_TS_PATH = fileURLToPath(new URL("./main.ts", import.meta.url));
const RUN_TIMEOUT_MS = 30_000;
const RUN_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

async function runMain(args: readonly string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const result = await runProcess({
    command: process.execPath,
    args: [MAIN_TS_PATH, ...args],
    cwd: process.cwd(),
    timeoutMs: RUN_TIMEOUT_MS,
  });
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

async function git(repoDir: string, args: readonly string[]): Promise<string> {
  const result = await runProcess({ command: "git", args, cwd: repoDir, timeoutMs: RUN_TIMEOUT_MS });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed (exit ${String(result.exitCode)}): ${result.stderr}`);
  }
  return result.stdout;
}

async function freshRepoWithSpec(): Promise<string> {
  const dir = await mkdtemp(`${tmpdir()}/multi-loopr-run-cli-test-`);
  await git(dir, ["init", "--quiet", "-b", "main"]);
  await git(dir, ["config", "user.email", "test@example.com"]);
  await git(dir, ["config", "user.name", "Test"]);
  await writeFile(`${dir}/PHASE_1_SPEC.md`, "spec content\n", "utf8");
  await git(dir, ["add", "PHASE_1_SPEC.md"]);
  await git(dir, ["commit", "--quiet", "-m", "add spec"]);
  return dir;
}

function validConfigJson(dir: string): string {
  const config: RunConfig = {
    run_id: RUN_ID,
    repo_dir: dir,
    executor_providers: ["claude-code", "codex-cli"],
    reviewer_provider: null,
    turn_timeout_ms: 1_800_000,
    phase: 1,
    spec_path: "PHASE_1_SPEC.md",
  };
  return JSON.stringify(config);
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

test("runRunCommand throws UsageError (not RelaySchemaError) when the config file cannot be read", async () => {
  await assert.rejects(
    () => runRunCommand({ configPath: "/definitely/does/not/exist.json", json: false }),
    (err: unknown) => {
      assert.ok(err instanceof UsageError);
      assert.equal(err.exitCode, 2);
      return true;
    },
  );
});

test("runRunCommand throws UsageError when the config file is not valid JSON", async () => {
  const dir = await mkdtemp(`${tmpdir()}/multi-loopr-run-cli-test-`);
  try {
    const configPath = `${dir}/config.json`;
    await writeFile(configPath, "not valid json{{{", "utf8");
    await assert.rejects(
      () => runRunCommand({ configPath, json: false }),
      (err: unknown) => {
        assert.ok(err instanceof UsageError);
        assert.equal(err.exitCode, 2);
        return true;
      },
    );
  } finally {
    await cleanup(dir);
  }
});

test("runRunCommand throws UsageError (exit 2, not RELAY_SCHEMA_INVALID's exit 4) when the config fails RunConfig validation", async () => {
  const dir = await mkdtemp(`${tmpdir()}/multi-loopr-run-cli-test-`);
  try {
    const configPath = `${dir}/config.json`;
    await writeFile(configPath, JSON.stringify({ run_id: "not-a-uuid" }), "utf8");
    await assert.rejects(
      () => runRunCommand({ configPath, json: false }),
      (err: unknown) => {
        assert.ok(err instanceof UsageError);
        assert.equal(err.exitCode, 2);
        return true;
      },
    );
  } finally {
    await cleanup(dir);
  }
});

test("RunConfig rejects phase: 0 and phase: -1", () => {
  const base = {
    run_id: RUN_ID,
    repo_dir: "/tmp/repo",
    executor_providers: ["claude-code", "codex-cli"],
    spec_path: "PHASE_1_SPEC.md",
  };
  assert.equal(RunConfig.safeParse({ ...base, phase: 0 }).success, false);
  assert.equal(RunConfig.safeParse({ ...base, phase: -1 }).success, false);
  assert.equal(RunConfig.safeParse({ ...base, phase: 1 }).success, true);
});

test("RunConfig rejects an absolute spec_path and a spec_path containing a .. segment", () => {
  const base = {
    run_id: RUN_ID,
    repo_dir: "/tmp/repo",
    executor_providers: ["claude-code", "codex-cli"],
    phase: 1,
  };
  assert.equal(RunConfig.safeParse({ ...base, spec_path: "/etc/passwd" }).success, false);
  assert.equal(RunConfig.safeParse({ ...base, spec_path: "C:/etc/passwd" }).success, false);
  assert.equal(RunConfig.safeParse({ ...base, spec_path: "../outside.md" }).success, false);
  assert.equal(RunConfig.safeParse({ ...base, spec_path: "PHASE_1_SPEC.md" }).success, true);
});

test("runRunCommand dispatches a valid config and returns a RunReport whose exit_code passes through runDispatch's own result", async () => {
  // On this development machine Codex CLI is unauthenticated (established by the existing
  // main.test.ts "doctor --providers" test against the same real environment), so a real dispatch
  // deterministically fails preflight -- exercised here as the exit-code-passthrough path.
  const dir = await freshRepoWithSpec();
  try {
    const configPath = `${dir}/config.json`;
    await writeFile(configPath, validConfigJson(dir), "utf8");

    const { report, exitCode } = await runRunCommand({ configPath, json: false });

    assert.equal(exitCode, report.exit_code);
    assert.equal(report.exit_code, 3);
    assert.equal(report.ok, false);
    assert.equal(report.run_id, RUN_ID);
    assert.equal(report.phase, 1);
    assert.deepStrictEqual(report.turns, []);
    RunReport.parse(report);
  } finally {
    await cleanup(dir);
  }
});

test("CLI: multi-loopr run with no --config exits 2 before touching any file", async () => {
  const { exitCode, stdout, stderr } = await runMain(["run"]);
  assert.equal(exitCode, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /--config/);
});

test("CLI: multi-loopr run --config <path> <unknown-flag> is a usage error (exit 2)", async () => {
  const dir = await mkdtemp(`${tmpdir()}/multi-loopr-run-cli-test-`);
  try {
    const { exitCode, stderr } = await runMain(["run", "--config", `${dir}/does-not-matter.json`, "--not-a-real-flag"]);
    assert.equal(exitCode, 2);
    assert.match(stderr, /Unknown flag/);
  } finally {
    await cleanup(dir);
  }
});

test("CLI: multi-loopr run --config <path> where the JSON fails RunConfig validation exits 2", async () => {
  const dir = await mkdtemp(`${tmpdir()}/multi-loopr-run-cli-test-`);
  try {
    const configPath = `${dir}/config.json`;
    await writeFile(configPath, JSON.stringify({ not: "a valid config" }), "utf8");
    const { exitCode, stdout, stderr } = await runMain(["run", "--config", configPath]);
    assert.equal(exitCode, 2);
    assert.equal(stdout, "");
    assert.notEqual(stderr, "");
  } finally {
    await cleanup(dir);
  }
});

test("CLI: multi-loopr run --config <path> --json emits a single RunReport-shaped JSON object on stdout", async () => {
  const dir = await freshRepoWithSpec();
  try {
    const configPath = `${dir}/config.json`;
    await writeFile(configPath, validConfigJson(dir), "utf8");

    const { exitCode, stdout } = await runMain(["run", "--config", configPath, "--json"]);

    const parsed: unknown = JSON.parse(stdout);
    const report = RunReport.parse(parsed);
    assert.equal(exitCode, report.exit_code);
    assert.equal(report.run_id, RUN_ID);
  } finally {
    await cleanup(dir);
  }
});

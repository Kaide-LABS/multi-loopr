// Implements PHASE_1_SPEC.md §3.4
//
// `HandoffRecord` -- the single most load-bearing schema in the project (PRD §9 FM5). It is the
// entire payload that crosses between agents. It carries no free-form transcript, reasoning, or
// conversation (PRD §6.4, §7 I5, §9 FM2): the isolation denylist below is checked before the
// record is ever handed to zod.
//
// Module dependency note: `HandoffRecord.provider` reuses the canonical `ProviderIdSchema` from
// `./run.ts` (runtime import, one direction only). `./run.ts` in turn only needs this module's
// *types* (`FileRef`, `HandoffRecord`) for its own `TurnRequest`/`TurnOutcome` type aliases, which
// it pulls in via `import type` -- erased entirely by Node's type stripping, so no runtime edge
// exists from run.ts back to relay.ts. This keeps the two files' actual runtime dependency a DAG
// instead of an ES-module import cycle (which would risk a "cannot access before initialization"
// failure depending on which of the two modules happens to load first).

import { z } from "zod";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { IsolationLeakError, RelaySchemaError } from "./errors.ts";
import { ModelTierSchema } from "./tiers.ts";
import { ProviderIdSchema } from "./run.ts";
import { isSafeRepoRelPath } from "../util/paths.ts";

// ---------------------------------------------------------------------------------------------
// Primitive sub-schemas (§3.4)
// ---------------------------------------------------------------------------------------------

/** Lowercase-hex SHA-256 digest. */
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
export type Sha256Hex = z.infer<typeof Sha256Hex>;

/**
 * A git object id -- 40 hex chars (SHA-1 repos) or 64 hex chars (repos created with
 * `--object-format=sha256`). Accepting both means a SHA-256-object-format repo does not silently
 * fail validation.
 */
export const GitOid = z.string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/);
export type GitOid = z.infer<typeof GitOid>;

/** UTC-only ISO-8601 timestamp. Offsets are rejected (zod v4 `z.iso.datetime()` default). */
export const IsoUtc = z.iso.datetime();
export type IsoUtc = z.infer<typeof IsoUtc>;

/** UUID identifying a whole multi-turn run. */
export const RunId = z.uuid();
export type RunId = z.infer<typeof RunId>;

/**
 * A repo-relative POSIX path: not absolute (POSIX or Windows-drive form), no backslashes, and no
 * `..` traversal segment. Delegates to `src/util/paths.ts`'s `isSafeRepoRelPath` so the safety
 * rule is defined in exactly one place (PHASE_1_SPEC.md §6.3).
 */
export const RepoRelPath = z
  .string()
  .min(1)
  .max(1024)
  .refine(isSafeRepoRelPath, "must be a safe, repo-relative POSIX path (no absolute path, no backslash separators, no upward traversal)");
export type RepoRelPath = z.infer<typeof RepoRelPath>;

/** A file reference: a repo-relative path plus the SHA-256 of its contents (the AC3 primitive). */
export const FileRef = z.strictObject({ path: RepoRelPath, sha256: Sha256Hex });
export type FileRef = z.infer<typeof FileRef>;

// ---------------------------------------------------------------------------------------------
// HandoffRecord, schema version 1
// ---------------------------------------------------------------------------------------------

/** The current (and, in Phase 1, only) relay schema version. */
export const RELAY_SCHEMA_VERSION = 1 as const;

/** Git ground truth for a single turn. */
export const RepoState = z.strictObject({
  branch: z.string().min(1).max(255),
  head_before: GitOid,
  head_after: GitOid,
  commits: z.array(GitOid).max(500),
});
export type RepoState = z.infer<typeof RepoState>;

/** A machine-readable halt signal; non-null iff `status === "halted"` (R2). */
export const HaltSignal = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  message: z.string().min(1).max(2000),
});
export type HaltSignal = z.infer<typeof HaltSignal>;

const HandoffRecordShape = z.strictObject({
  schema_version: z.literal(RELAY_SCHEMA_VERSION),
  run_id: RunId,
  phase: z.number().int().min(1),
  turn_index: z.number().int().min(0),
  role: z.enum(["executor", "reviewer"]),
  provider: ProviderIdSchema,
  model_tier: ModelTierSchema,
  started_at: IsoUtc,
  completed_at: IsoUtc,
  repo: RepoState,
  spec_ref: FileRef,
  artifacts_read: z.array(FileRef).max(200),
  artifacts_written: z.array(FileRef).max(200),
  status: z.enum(["completed", "blocked", "halted"]),
  work_done: z.string().min(1).max(4000),
  next_steps: z.array(z.string().min(1).max(500)).max(20),
  open_questions: z.array(z.string().min(1).max(500)).max(20),
  halt: HaltSignal.nullable(),
});

/**
 * The versioned inter-agent handoff record (PRD §9 FM5). Carries git ground truth, artifact
 * attestation, and a length-capped factual summary -- never reasoning, conversation, or a
 * transcript (PRD §6.4, §7 I5). Enforces three object-level refinements:
 * - R1: `completed_at >= started_at`.
 * - R2: `status === "halted"` iff `halt !== null`.
 * - R3: `status === "completed"` implies `repo.commits.length >= 1`.
 */
export const HandoffRecord = HandoffRecordShape.refine(
  (r) => new Date(r.completed_at).getTime() >= new Date(r.started_at).getTime(),
  { message: "completed_at must be >= started_at (R1)", path: ["completed_at"] },
).refine((r) => (r.status === "halted") === (r.halt !== null), {
  message: 'status === "halted" iff halt !== null (R2)',
  path: ["halt"],
}).refine((r) => r.status !== "completed" || r.repo.commits.length >= 1, {
  message: 'status === "completed" implies repo.commits.length >= 1 (R3)',
  path: ["repo", "commits"],
});

/** The inferred type of {@link HandoffRecord}. */
export type HandoffRecord = z.infer<typeof HandoffRecord>;

// ---------------------------------------------------------------------------------------------
// Isolation denylist (FM2, PRD §7 I5)
// ---------------------------------------------------------------------------------------------

/**
 * Any relay-payload key matching this pattern is a transcript/reasoning leak (PRD §6.4). Checked
 * recursively, before schema parsing, so the failure names the isolation rule rather than
 * surfacing as a generic "unrecognized key" zod error.
 */
export const FORBIDDEN_RELAY_KEY_PATTERN =
  /transcript|conversation|reasoning|chain[_-]?of[_-]?thought|rationale|thinking|scratchpad|messages|history|justification/i;

const MAX_TRANSCRIPT_SCAN_DEPTH = 12;

/**
 * Recursively walks `raw` (objects and arrays, depth-capped at {@link MAX_TRANSCRIPT_SCAN_DEPTH})
 * and throws {@link IsolationLeakError} naming PRD §6.4 and the offending key path if any object
 * key matches {@link FORBIDDEN_RELAY_KEY_PATTERN}. The depth cap exists so a malicious or
 * degenerate nesting cannot hang the parse.
 */
export function assertNoTranscriptFields(raw: unknown): void {
  walkForTranscriptFields(raw, [], 0);
}

function walkForTranscriptFields(value: unknown, pathSegments: readonly string[], depth: number): void {
  if (depth > MAX_TRANSCRIPT_SCAN_DEPTH) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkForTranscriptFields(item, [...pathSegments, String(index)], depth + 1);
    });
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (FORBIDDEN_RELAY_KEY_PATTERN.test(key)) {
        const path = [...pathSegments, key].join(".");
        throw new IsolationLeakError(
          `Relay payload key "${path}" matches the transcript/reasoning denylist. PRD §6.4 ` +
            "(isolation rule): the relay carries only structured, factual handoff data -- never " +
            "raw conversation, reasoning, or a transcript.",
          { path, key },
        );
      }
      walkForTranscriptFields((value as Record<string, unknown>)[key], [...pathSegments, key], depth + 1);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Parse / serialise / read / write
// ---------------------------------------------------------------------------------------------

/**
 * Parses and validates a raw value as a {@link HandoffRecord}. Fixed order of operations
 * (load-bearing, tested):
 * 1. Reject non-plain-object input -> {@link RelaySchemaError}.
 * 2. {@link assertNoTranscriptFields} -- may throw {@link IsolationLeakError}.
 * 3. Check `schema_version` against {@link RELAY_SCHEMA_VERSION} with a dedicated check (never
 *    falls through to zod for this) -> {@link RelaySchemaError} naming both versions.
 * 4. Full zod parse -> {@link RelaySchemaError} with `z.prettifyError()` output on failure.
 */
export function parseHandoffRecord(raw: unknown): HandoffRecord {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new RelaySchemaError("HandoffRecord payload must be a JSON object.", {
      receivedType: Array.isArray(raw) ? "array" : typeof raw,
    });
  }

  assertNoTranscriptFields(raw);

  const found = (raw as Record<string, unknown>)["schema_version"];
  if (found !== RELAY_SCHEMA_VERSION) {
    throw new RelaySchemaError(
      `HandoffRecord schema_version mismatch: expected ${RELAY_SCHEMA_VERSION}, found ` +
        `${JSON.stringify(found)}.`,
      { expected: RELAY_SCHEMA_VERSION, found },
    );
  }

  const result = HandoffRecord.safeParse(raw);
  if (!result.success) {
    throw new RelaySchemaError(z.prettifyError(result.error));
  }
  return result.data;
}

function orderedFileRef(f: FileRef): FileRef {
  return { path: f.path, sha256: f.sha256 };
}

function orderedRepoState(r: RepoState): RepoState {
  return { branch: r.branch, head_before: r.head_before, head_after: r.head_after, commits: [...r.commits] };
}

function orderedHaltSignal(h: HaltSignal | null): HaltSignal | null {
  return h === null ? null : { code: h.code, message: h.message };
}

/**
 * Serialises a {@link HandoffRecord} with keys in the declaration order of PHASE_1_SPEC.md §3.4
 * (fields 1-18, nested objects likewise), so the round-trip test and rendered diffs are stable.
 * Always ends with a trailing newline.
 */
export function serialiseHandoffRecord(rec: HandoffRecord): string {
  const ordered: HandoffRecord = {
    schema_version: rec.schema_version,
    run_id: rec.run_id,
    phase: rec.phase,
    turn_index: rec.turn_index,
    role: rec.role,
    provider: rec.provider,
    model_tier: rec.model_tier,
    started_at: rec.started_at,
    completed_at: rec.completed_at,
    repo: orderedRepoState(rec.repo),
    spec_ref: orderedFileRef(rec.spec_ref),
    artifacts_read: rec.artifacts_read.map(orderedFileRef),
    artifacts_written: rec.artifacts_written.map(orderedFileRef),
    status: rec.status,
    work_done: rec.work_done,
    next_steps: [...rec.next_steps],
    open_questions: [...rec.open_questions],
    halt: orderedHaltSignal(rec.halt),
  };
  return JSON.stringify(ordered, null, 2) + "\n";
}

/**
 * Reads a UTF-8 JSON file at `absPath` and validates it as a {@link HandoffRecord}. A JSON parse
 * failure is a {@link RelaySchemaError}, not an internal error.
 */
export async function readHandoffRecord(absPath: string): Promise<HandoffRecord> {
  const text = await readFile(absPath, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new RelaySchemaError(
      `Failed to parse ${absPath} as JSON: ${err instanceof Error ? err.message : String(err)}`,
      { path: absPath },
    );
  }
  return parseHandoffRecord(raw);
}

/** Writes a {@link HandoffRecord} to `absPath`, creating parent directories as needed. */
export async function writeHandoffRecord(absPath: string, rec: HandoffRecord): Promise<void> {
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, serialiseHandoffRecord(rec), "utf8");
}

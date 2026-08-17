// Implements PHASE_3_SPEC.md §6.2
//
// Role-profile injection and isolation-respecting cross-turn context assembly (FM2). No function
// in this file ever reads `process.env`, spawns a process, or touches a clock -- consistent with
// `buildInvocation`'s own purity constraint (PHASE_1_SPEC.md §3.6), applied here to the layer one
// step upstream of it.

import type { HandoffRecord } from "../domain/relay.ts";
import { RELAY_SCHEMA_VERSION } from "../domain/relay.ts";
import { getRole } from "../domain/roles.ts";
import { PROVIDER_IDS } from "../domain/run.ts";
import { MODEL_TIERS } from "../domain/tiers.ts";

function quotedList(values: readonly string[]): string {
  return values.map((v) => `"${v}"`).join(", ");
}

/**
 * The eighteen top-level `HandoffRecord` fields, in schema-declaration order (PHASE_1_SPEC.md
 * §3.4), each annotated with the *value shape* it must carry -- not merely its name.
 *
 * [DECISION] The bare name list this replaced was genuinely ambiguous in live dispatch: a real
 * Claude Code executor turn wrote `"schema_version": "1.0"` (a plausible semver-looking string, the
 * overwhelmingly common convention for a field with that name) where the schema requires the bare
 * integer `1`, and the relay's own validation correctly refused the turn. A field name alone does
 * not communicate a value shape, so every field states one, and the literals are read from the
 * canonical schemas (`RELAY_SCHEMA_VERSION`, `PROVIDER_IDS`, `MODEL_TIERS`) rather than duplicated,
 * so the prompt cannot drift from what `parseHandoffRecord()` actually enforces.
 */
function handoffRecordFieldSpecLines(role: "executor" | "reviewer"): readonly string[] {
  return [
    `- schema_version: the bare JSON integer ${String(RELAY_SCHEMA_VERSION)} -- no quotes, no ` +
      `decimal point. This is a schema revision number, not a semver string: "1.0", "1.0.0", and ` +
      `the quoted string "${String(RELAY_SCHEMA_VERSION)}" are all rejected outright.`,
    "- run_id: this run's UUID string. It is the directory name directly under runs/ in the " +
      "handoff path above -- copy it from there, do not invent one.",
    "- phase: a bare integer >= 1 (no quotes). It is the directory name directly under handoff/ " +
      "in the handoff path above.",
    "- turn_index: a bare integer >= 0 (no quotes). The handoff file name starts with this number " +
      "zero-padded; write the field itself as a plain integer, so 000 in the file name is 0 here.",
    `- role: exactly "executor" or "reviewer". For this turn it is "${role}".`,
    `- provider: exactly one of ${quotedList(PROVIDER_IDS)} -- whichever of them appears in the ` +
      "handoff file name above.",
    `- model_tier: exactly one of ${quotedList(MODEL_TIERS)}.`,
    '- started_at, completed_at: ISO-8601 UTC timestamp strings ending in "Z", for example ' +
      '"2026-01-01T09:30:00Z". A numeric offset such as +01:00 is rejected. completed_at must be ' +
      ">= started_at.",
    "- repo: an object with branch (string), head_before, head_after (full git object ids), and " +
      "commits (array of full git object ids).",
    "- spec_ref: an object with path (repo-relative POSIX path) and sha256 (64 lowercase hex " +
      "characters).",
    "- artifacts_read, artifacts_written: arrays (possibly empty) of objects with the same " +
      "path/sha256 shape as spec_ref.",
    '- status: exactly one of "completed", "blocked", "halted".',
    "- work_done: a single non-empty string.",
    "- next_steps, open_questions: arrays of strings, each array possibly empty.",
    "- halt: null, or an object with code (an UPPER_SNAKE_CASE identifier string) and message (a " +
      'non-empty string). It must be non-null exactly when status is "halted", and null otherwise.',
  ];
}

/** A very large diff would make an invocation's `stdin` payload unboundedly large; capped here. */
const DIFF_CAP_CHARS = 20_000;

/** Parameters for {@link buildProtocolInstructions}. */
export interface ProtocolInstructionParams {
  readonly handoffAbsPath: string;
  readonly role: "executor" | "reviewer";
  readonly specRepoRelPath: string;
  /** Repo-relative path to loopr's `baby_prd.md` for this build (PHASE_4_SPEC.md §6.2, new). */
  readonly babyPrdRepoRelPath: string;
  /** Repo-relative path to loopr's `context.md` for this build (PHASE_4_SPEC.md §6.2, new). */
  readonly contextRepoRelPath: string;
}

/**
 * Renders the protocol instructions every dispatched turn receives: the exact `HandoffRecord`
 * shape to produce (name *and* value shape per field -- see
 * {@link handoffRecordFieldSpecLines}), where to write it, the isolation rule, the advisory-only
 * nature of agent-authored `repo`/`spec_ref`, the honest-halt requirement, and (Phase 4, new) the
 * instruction to genuinely read and record loopr's own `baby_prd.md`/`context.md` for this build.
 * Prose is not fixed verbatim by the spec -- what is load-bearing is that each of the eight
 * mandatory-content items appears as a literal substring (PHASE_3_SPEC.md §6.2 items 1-6,
 * PHASE_4_SPEC.md §6.2 items 7-8, all tested individually); item 2's eighteen field names now
 * appear as an annotated list rather than a bare comma-joined one, which satisfies the same
 * substring requirement while removing the value-shape ambiguity that broke a live dispatch.
 * Implements PHASE_3_SPEC.md §6.2, PHASE_4_SPEC.md §6.2.
 */
export function buildProtocolInstructions(p: ProtocolInstructionParams): string {
  return [
    `You are participating in a multi-loopr dispatched ${p.role} turn.`,
    `Read the phase spec at repo-relative path "${p.specRepoRelPath}" and do the work it describes.`,
    "",
    `Read loopr's foundational problem-statement artifact for this build at repo-relative path ` +
      `"${p.babyPrdRepoRelPath}" and record it in artifacts_read.`,
    "",
    `Read loopr's foundational context artifact for this build at repo-relative path ` +
      `"${p.contextRepoRelPath}" and record it in artifacts_read.`,
    "",
    `When your turn ends (whether complete or not), write a single JSON HandoffRecord document to ` +
      `the exact path "${p.handoffAbsPath}". The record must be a JSON object with exactly these ` +
      `eighteen top-level fields, each carrying exactly the value shape stated here:`,
    ...handoffRecordFieldSpecLines(p.role),
    "",
    "These value shapes are validated mechanically and a mismatch refuses the whole turn, so " +
      "follow them literally rather than substituting a conventional-looking equivalent.",
    "",
    "The repo and spec_ref values you write are advisory only: multi-loopr independently " +
      "recomputes both from its own git and file-hash inspection after your turn ends, and " +
      "overwrites whatever you wrote there -- do not spend turn budget trying to get git plumbing " +
      "exactly right.",
    "",
    "work_done, next_steps, and open_questions must be strictly factual: a record of what was " +
      "done and what remains, never your reasoning, chain of thought, or a transcript excerpt, and " +
      "never under a key name that resembles one either. This is PRD §6.4's isolation rule, " +
      "enforced mechanically before your record is even parsed.",
    "",
    'If you cannot complete the phase, report status: "blocked" or status: "halted" (with a ' +
      'populated halt object) honestly. Never report status: "completed" when the phase is not ' +
      "actually done.",
  ].join("\n");
}

/**
 * [DET] Renders exactly the allow-listed fields of `prev` as plain text: `work_done`,
 * `next_steps`, `open_questions`, `artifacts_written`, `status`, `spec_ref`. Never `prev`'s raw
 * JSON dump wholesale (schema-shape leakage, not a deliberate allow-list) and never any provider
 * log/stdout/stderr text -- this function's signature takes only a {@link HandoffRecord}, never a
 * `RawInvocationResult`, so there is no raw process output available to leak even by mistake.
 * Applies PRD §7 I5's isolation rule uniformly to both the second executor turn's context and the
 * reviewer's context. Implements PHASE_3_SPEC.md §6.2.
 */
export function buildHandoffContext(prev: HandoffRecord): string {
  const lines: string[] = [];
  lines.push("Prior turn's handoff context (allow-listed fields only):");
  lines.push(`status: ${prev.status}`);
  lines.push(`spec_ref: ${prev.spec_ref.path} (sha256 ${prev.spec_ref.sha256})`);
  lines.push(`work_done: ${prev.work_done}`);
  lines.push("next_steps:");
  for (const step of prev.next_steps) {
    lines.push(`  - ${step}`);
  }
  lines.push("open_questions:");
  for (const question of prev.open_questions) {
    lines.push(`  - ${question}`);
  }
  lines.push("artifacts_written:");
  for (const artifact of prev.artifacts_written) {
    lines.push(`  - ${artifact.path} (sha256 ${artifact.sha256})`);
  }
  return lines.join("\n");
}

function truncateDiff(diff: string): string {
  if (diff.length <= DIFF_CAP_CHARS) {
    return diff;
  }
  return `${diff.slice(0, DIFF_CAP_CHARS)}\n...[diff truncated at ${String(DIFF_CAP_CHARS)} characters]...\n`;
}

/** Parameters for {@link buildExecutorPrompt}. */
export interface BuildExecutorPromptParams {
  readonly role: "executor";
  readonly specRepoRelPath: string;
  readonly handoffAbsPath: string;
  /** Repo-relative path to loopr's `baby_prd.md` for this build (PHASE_4_SPEC.md §1.4, new). */
  readonly babyPrdRepoRelPath: string;
  /** Repo-relative path to loopr's `context.md` for this build (PHASE_4_SPEC.md §1.4, new). */
  readonly contextRepoRelPath: string;
  readonly priorRecord: HandoffRecord | null;
  readonly retryNote: string | null;
}

/**
 * Concatenates: `getRole("executor").profileSummary` + {@link buildProtocolInstructions} (now
 * including the baby_prd/context mandatory-content items) +
 * (`priorRecord === null` ? nothing : {@link buildHandoffContext}, for the second executor turn) +
 * (`retryNote` when non-null). No production-instruction block is ever added for an executor turn
 * -- {@link buildArtifactProductionInstructions} is reviewer-only. Implements PHASE_3_SPEC.md §6.2,
 * PHASE_4_SPEC.md §6.2.
 */
export function buildExecutorPrompt(params: BuildExecutorPromptParams): string {
  const parts: string[] = [
    getRole("executor").profileSummary,
    buildProtocolInstructions({
      handoffAbsPath: params.handoffAbsPath,
      role: "executor",
      specRepoRelPath: params.specRepoRelPath,
      babyPrdRepoRelPath: params.babyPrdRepoRelPath,
      contextRepoRelPath: params.contextRepoRelPath,
    }),
  ];
  if (params.priorRecord !== null) {
    parts.push(buildHandoffContext(params.priorRecord));
  }
  if (params.retryNote !== null) {
    parts.push(params.retryNote);
  }
  return parts.join("\n\n");
}

/**
 * [DECISION Phase 4] Reviewer-only addendum instructing the reviewer to genuinely write loopr's
 * next phase artifact as part of this turn, never merely reference it -- the mechanical
 * counterpart to `assertNextPhaseSpecProduced()` (`src/dispatch/artifacts.ts`). Prose is not fixed
 * verbatim, but two items are load-bearing and tested by substring: (1) the literal
 * `expectedArtifactPath`, as the exact repo-relative path the reviewer must write real content to;
 * (2) an explicit statement, branching on `isFinalPhase`, of what that content must be -- the real
 * next phase's technical blueprint on a non-final phase, this build's completion record on the
 * final phase -- and that the path must be recorded, with its real hash, in `artifacts_written`, or
 * multi-loopr will treat the phase as bypassed, not completed. Never called from
 * {@link buildExecutorPrompt}. Implements PHASE_4_SPEC.md §6.2.
 */
export function buildArtifactProductionInstructions(expectedArtifactPath: string, isFinalPhase: boolean): string {
  const contentDescription = isFinalPhase
    ? "this build's completion record"
    : `the real next phase's technical blueprint (following this project's own established spec ` +
      `structure), at "${expectedArtifactPath}"`;
  return [
    "You must genuinely produce loopr's next phase artifact for real, as part of this turn -- " +
      "not merely reference or restate an existing one.",
    `Write substantive, real content to the exact repo-relative path "${expectedArtifactPath}". ` +
      `That content must be ${contentDescription}.`,
    `You must also record "${expectedArtifactPath}" with its real SHA-256 hash in ` +
      "artifacts_written -- otherwise multi-loopr will treat this phase as bypassed, not completed.",
  ].join("\n");
}

/** Parameters for {@link buildReviewerPrompt}. */
export interface BuildReviewerPromptParams {
  readonly specRepoRelPath: string;
  readonly handoffAbsPath: string;
  /** Repo-relative path to loopr's `baby_prd.md` for this build (PHASE_4_SPEC.md §1.4, new). */
  readonly babyPrdRepoRelPath: string;
  /** Repo-relative path to loopr's `context.md` for this build (PHASE_4_SPEC.md §1.4, new). */
  readonly contextRepoRelPath: string;
  readonly priorRecord: HandoffRecord;
  readonly diff: string;
  /** The repo-relative path this reviewer turn must genuinely produce (PHASE_4_SPEC.md §1.4, new). */
  readonly expectedArtifactPath: string;
  /** Whether this run's reviewer turn is the target build's own final phase (PHASE_4_SPEC.md §1.4, new). */
  readonly isFinalPhase: boolean;
  readonly retryNote: string | null;
}

/**
 * Concatenates: `getRole("reviewer").profileSummary` + {@link buildProtocolInstructions} (now
 * including the baby_prd/context mandatory-content items) +
 * {@link buildArtifactProductionInstructions} (Phase 4, new -- placed immediately after the
 * protocol instructions and before the handoff/diff context, matching the existing convention that
 * instructions-about-the-task precede context-about-prior-work) + {@link buildHandoffContext} + a
 * capped rendering of `params.diff` + (`retryNote` when non-null). The literal, mechanical form of
 * PRD §9 FM2: "the reviewer's turn payload is assembled only from `spec_ref` + git diff + the
 * previous `HandoffRecord`'s allow-listed fields -- never from provider log files". Implements
 * PHASE_3_SPEC.md §6.2, PHASE_4_SPEC.md §6.2.
 */
export function buildReviewerPrompt(params: BuildReviewerPromptParams): string {
  const parts: string[] = [
    getRole("reviewer").profileSummary,
    buildProtocolInstructions({
      handoffAbsPath: params.handoffAbsPath,
      role: "reviewer",
      specRepoRelPath: params.specRepoRelPath,
      babyPrdRepoRelPath: params.babyPrdRepoRelPath,
      contextRepoRelPath: params.contextRepoRelPath,
    }),
    buildArtifactProductionInstructions(params.expectedArtifactPath, params.isFinalPhase),
    buildHandoffContext(params.priorRecord),
    `Diff under review (${params.specRepoRelPath}'s executor turns):\n${truncateDiff(params.diff)}`,
  ];
  if (params.retryNote !== null) {
    parts.push(params.retryNote);
  }
  return parts.join("\n\n");
}

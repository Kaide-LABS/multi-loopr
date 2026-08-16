// Implements PHASE_3_SPEC.md §6.2
//
// Role-profile injection and isolation-respecting cross-turn context assembly (FM2). No function
// in this file ever reads `process.env`, spawns a process, or touches a clock -- consistent with
// `buildInvocation`'s own purity constraint (PHASE_1_SPEC.md §3.6), applied here to the layer one
// step upstream of it.

import type { HandoffRecord } from "../domain/relay.ts";
import { getRole } from "../domain/roles.ts";

/** The eighteen top-level `HandoffRecord` field names, in schema-declaration order (PHASE_1_SPEC.md §3.4). */
const HANDOFF_RECORD_FIELD_NAMES = [
  "schema_version",
  "run_id",
  "phase",
  "turn_index",
  "role",
  "provider",
  "model_tier",
  "started_at",
  "completed_at",
  "repo",
  "spec_ref",
  "artifacts_read",
  "artifacts_written",
  "status",
  "work_done",
  "next_steps",
  "open_questions",
  "halt",
] as const;

/** A very large diff would make an invocation's `stdin` payload unboundedly large; capped here. */
const DIFF_CAP_CHARS = 20_000;

/** Parameters for {@link buildProtocolInstructions}. */
export interface ProtocolInstructionParams {
  readonly handoffAbsPath: string;
  readonly role: "executor" | "reviewer";
  readonly specRepoRelPath: string;
}

/**
 * Renders the protocol instructions every dispatched turn receives: the exact `HandoffRecord`
 * shape to produce, where to write it, the isolation rule, the advisory-only nature of
 * agent-authored `repo`/`spec_ref`, and the honest-halt requirement. Prose is not fixed verbatim
 * by the spec -- what is load-bearing is that each of the six mandatory-content items appears as a
 * literal substring (PHASE_3_SPEC.md §6.2, tested individually). Implements PHASE_3_SPEC.md §6.2.
 */
export function buildProtocolInstructions(p: ProtocolInstructionParams): string {
  return [
    `You are participating in a multi-loopr dispatched ${p.role} turn.`,
    `Read the phase spec at repo-relative path "${p.specRepoRelPath}" and do the work it describes.`,
    "",
    `When your turn ends (whether complete or not), write a single JSON HandoffRecord document to ` +
      `the exact path "${p.handoffAbsPath}". The record must be a JSON object with exactly these ` +
      `top-level fields: ${HANDOFF_RECORD_FIELD_NAMES.join(", ")}.`,
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
  readonly priorRecord: HandoffRecord | null;
  readonly retryNote: string | null;
}

/**
 * Concatenates: `getRole("executor").profileSummary` + {@link buildProtocolInstructions} +
 * (`priorRecord === null` ? nothing : {@link buildHandoffContext}, for the second executor turn) +
 * (`retryNote` when non-null). Implements PHASE_3_SPEC.md §6.2.
 */
export function buildExecutorPrompt(params: BuildExecutorPromptParams): string {
  const parts: string[] = [
    getRole("executor").profileSummary,
    buildProtocolInstructions({
      handoffAbsPath: params.handoffAbsPath,
      role: "executor",
      specRepoRelPath: params.specRepoRelPath,
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

/** Parameters for {@link buildReviewerPrompt}. */
export interface BuildReviewerPromptParams {
  readonly specRepoRelPath: string;
  readonly handoffAbsPath: string;
  readonly priorRecord: HandoffRecord;
  readonly diff: string;
  readonly retryNote: string | null;
}

/**
 * Concatenates: `getRole("reviewer").profileSummary` + {@link buildProtocolInstructions} +
 * {@link buildHandoffContext} + a capped rendering of `params.diff` + (`retryNote` when non-null).
 * The literal, mechanical form of PRD §9 FM2: "the reviewer's turn payload is assembled only from
 * `spec_ref` + git diff + the previous `HandoffRecord`'s allow-listed fields -- never from
 * provider log files". Implements PHASE_3_SPEC.md §6.2.
 */
export function buildReviewerPrompt(params: BuildReviewerPromptParams): string {
  const parts: string[] = [
    getRole("reviewer").profileSummary,
    buildProtocolInstructions({
      handoffAbsPath: params.handoffAbsPath,
      role: "reviewer",
      specRepoRelPath: params.specRepoRelPath,
    }),
    buildHandoffContext(params.priorRecord),
    `Diff under review (${params.specRepoRelPath}'s executor turns):\n${truncateDiff(params.diff)}`,
  ];
  if (params.retryNote !== null) {
    parts.push(params.retryNote);
  }
  return parts.join("\n\n");
}

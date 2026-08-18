# examples/loopr-role-dispatch -- dispatching loopr's own Step 11/12 methodology

Unlike `examples/toy-build` (which drives multi-loopr's own generic executor/reviewer protocol
prompt), this example demonstrates `RunConfig.executor_prompt_path`/`reviewer_prompt_path`: a
target build's own real, project-specific loopr Step 11 (execution) and Step 12 (adversarial
review + phase advancement) prompts, produced by actually running `loopr customize --step 11` /
`--step 12` for a real project, dispatched through multi-loopr's ordinary cross-provider turn loop.

The fixture here is `tally` -- a small, real CLI tool (a `wc`-like line/word/char/unique-word
counter) that went through a genuine loopr interrogation, a genuine Step 10 (PRD modernization +
Phase 1 blueprint) dispatch, and genuine Step 11/12 customization. `fixture/tally-PRD.md` and
`fixture/PHASE_1_SPEC.md` are that real Step 10 output -- not hand-written placeholders.
`fixture/loopr/loopr-step11.md` and `loopr-step12.md` are the real, project-specific customized
prompts: loopr's actual autonomous-critique invariant list, adversarial QA posture, and phase
discovery/advancement logic, filled in from `tally`'s own confirmed spec, not multi-loopr's own
generic "read the spec, do the work" protocol text.

Run against this fixture as shipped, this example produced a real, working `tally` implementation
across a genuine two-provider handoff (Claude Code wrote the initial implementation; Codex CLI
continued it, verified by `checkC5ArtifactAttestation`; Claude Code reviewed it adversarially,
caught and fixed a real defect -- build byproducts leaking into git -- and correctly judged the
project's own "Phase 1 of 1" scope rather than manufacturing a Phase 2) -- `"ok": true`, zero
retries, zero problems.

Run every command below from this repository's own root (`C:\Users\hp\multi-loopr`) unless a step
says otherwise.

## 1. Materialize the toy repository

Create a fresh directory **outside this repository** (never nested inside multi-loopr's own working
tree), `git init` it, copy this directory's `fixture/` contents into its root, and commit it as the
toy repository's own initial commit -- authored by you, the operator, not by either dispatched agent.

```
mkdir /path/to/tally-target
cd /path/to/tally-target
git init
git config user.email "you@example.com"
git config user.name "Your Name"
cp -r /path/to/multi-loopr/examples/loopr-role-dispatch/fixture/* .
git add .
git commit -m "initial tally fixture"
```

## 2. Generate the run config

Copy `run-config.template.json` and fill in its two placeholders:

```
node -e "console.log(crypto.randomUUID())"
```

Use that value for `run_id`, and the absolute path of the directory you created in step 1 for
`repo_dir`. Save the result as, e.g., `tally-run-config.json`.

`model_overrides` is left in the template exactly as it was used for the run that produced the
result described above (Opus for Claude Code; Codex CLI left to whatever model its own
`~/.codex/config.toml` names by default) -- edit or remove it to suit your own setup.
`executor_prompt_path`/`reviewer_prompt_path` are the two fields this example exists to
demonstrate; every other field behaves exactly as it does for `examples/toy-build`.

## 3. Preflight (recommended, not required)

From this repository's own root:

```
node src/cli/main.ts doctor --providers
```

Confirm both `claude-code` and `codex-cli` show `authenticated: true` before dispatching for real.

## 4. Dispatch

From this repository's own root:

```
node src/cli/main.ts run --config /path/to/tally-run-config.json --json
```

This runs against the toy repository via the config's own `repo_dir` field. Expect three real
turns -- two executors (one per provider) and a reviewer -- each genuinely working from `tally`'s
own customized Step 11/12 methodology, not a generic placeholder prompt.

## 5. Collect evidence

From this repository's own root:

```
node src/cli/main.ts evidence --repo-dir /path/to/tally-target --run-id <the same run_id> --final-phase --json
```

A clean, genuinely continued, genuinely artifact-referencing run reports `"ok": true` with all three
of AC1, AC2, and AC3 `"satisfied": true`. Because this run's `reviewer_prompt_path` genuinely
instructs the reviewer to write `BUILD_COMPLETE.md` on the target's own final phase, a fully clean
run also leaves a real `BUILD_COMPLETE.md` in the materialized repo, reporting the same five
acceptance criteria `tally`'s own loopr interrogation confirmed, verified against real fixture
files rather than self-reported.

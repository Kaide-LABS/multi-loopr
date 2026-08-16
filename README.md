# multi-loopr

A local, headless harness that runs loopr's spec discipline across two AI coding provider CLIs --
Claude Code and Codex CLI -- on a single repository, without depending on a hosted or closed
orchestrator. It uses each provider's own existing (BYOA) credentials, runs entirely on the
operator's own machine, and hands a loopr-disciplined build phase off from one provider's agent
to the other so the second genuinely continues the first's work.

A `multi-loopr run --config <path>` command dispatches one loopr phase's sequential turn sequence.

## Requirements

- Node.js `>=24.0.0`

## Scripts

- `npm run typecheck` -- type-checks the project with `tsc -p tsconfig.json`.
- `npm run test` -- runs the test suite with Node's built-in test runner.
- `npm run check` -- runs `typecheck`, then `test`, then `doctor --boundary`.

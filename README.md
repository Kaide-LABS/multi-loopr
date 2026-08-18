# multi-loopr

A local, headless harness that runs loopr's spec discipline across two AI coding provider CLIs --
Claude Code and Codex CLI -- on a single repository, without depending on a hosted or closed
orchestrator. It uses each provider's own existing (BYOA) credentials, runs entirely on the
operator's own machine, and hands a loopr-disciplined build phase off from one provider's agent
to the other so the second genuinely continues the first's work.

A `multi-loopr run --config <path>` command dispatches one loopr phase's sequential turn sequence.
`run` mechanically enforces that every turn genuinely references loopr's own `baby_prd.md`/
`context.md`/phase spec, and that the reviewer turn genuinely produces the next loopr artifact. By
default, the two configured providers alternate through the executor and reviewer roles, with the
reviewer defaulting to whichever provider did not produce the diff under review. An operator may
instead pin either provider exclusively to the executor role or exclusively to the reviewer role
via the run config's `role_pins` field, producing clean single-role separation instead of the
default alternation; an impossible pinning is rejected before any turn is dispatched, and a pinning
that would force a reviewer to review its own prior work is surfaced plainly in the run's own
output rather than silently proceeding.
`multi-loopr evidence --repo-dir <path> --run-id <uuid>` independently re-derives PRD AC1 (continuity),
AC2 (clean completion), and AC3 (artifact reference and production) from a completed run's own
persisted handoff records, offline and without trusting anything the run itself reported live.
`multi-loopr mcp` starts a local, stdio-only Model Context Protocol server that exposes the same
`run`/`drive`/`doctor`/`evidence` capabilities as MCP tools, so an MCP-capable client (Claude Code,
or any other MCP host) can drive a phased build conversationally without hand-constructing a config
file and shelling out to the CLI directly. Every tool call does exactly what the equivalent CLI
invocation would do -- it is a thin translation layer over the same commands, not a second
orchestration engine.

## Setup

`multi-loopr setup` registers three stdio MCP servers into your Claude Code configuration in one
non-interactive command: `multi-loopr`'s own server, plus two optional research servers,
`arxiv-mcp` and `paper-search-mcp`, that give loopr's own Step 10 research pass access to arXiv and
broader academic search. All three are registered at `user` scope, so the registration is not tied
to any one project directory. Each server is attempted independently and verified afterward with an
independent `claude mcp get` check -- a registration is only ever reported as "registered" once that
check confirms it, never from `claude mcp add`'s exit code alone.

**arXiv and paper-search are optional -- multi-loopr works fully without them.** If either cannot be
installed on your machine (no `uvx` and no importable Python module), `setup` skips it by name with
a plain-language reason and a copy-pasteable remediation line; it never fails the command, and a
subsequent `run`/`drive` invocation still completes exactly the same either way. Re-running
`multi-loopr setup` at any time is safe and idempotent: an already-registered server is left alone.

## Examples

`examples/toy-build/` is a small, real, two-file Node.js CLI build (`wordcount.mjs`) with its own
loopr artifacts, meant to be driven end to end through `multi-loopr run` then `multi-loopr evidence`
as a live demonstration of the full cross-provider handoff. See `examples/toy-build/README.md` for
the exact, copy-pasteable procedure. This README makes no claim that a live toy-build run has been
performed on any particular machine; whether one has is recorded in `COMPREHENSION.md`.

## Requirements

- Node.js `>=24.0.0`

## Scripts

- `npm run typecheck` -- type-checks the project with `tsc -p tsconfig.json`.
- `npm run test` -- runs the test suite with Node's built-in test runner.
- `npm run check` -- runs `typecheck`, then `test`, then `doctor --boundary`.

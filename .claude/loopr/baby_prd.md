# Baby PRD

## TL;DR
I want to be able to complete a spec-disciplined build that spans two different AI coding providers -- without losing context, discipline, or continuity when work hands off from one to the other, and without depending on a closed or hosted orchestrator to make that handoff work. That becomes true for the operator first, as the person running it day to day, and -- once open-sourced -- for any other Claude Code / Codex user who wants multi-provider spec discipline on their own machine instead of inside someone else's platform. My current best guess at how: a local harness where Claude Code and Codex CLI run loopr's discipline together end to end, one starting a phase and the other continuing it. -- 1 acceptance criterion(ia), 1 scope edge(s) named.

## Problem statement
I want to be able to complete a spec-disciplined build that spans two different AI coding providers -- without losing context, discipline, or continuity when work hands off from one to the other, and without depending on a closed or hosted orchestrator to make that handoff work. That becomes true for the operator first, as the person running it day to day, and -- once open-sourced -- for any other Claude Code / Codex user who wants multi-provider spec discipline on their own machine instead of inside someone else's platform. My current best guess at how: a local harness where Claude Code and Codex CLI run loopr's discipline together end to end, one starting a phase and the other continuing it.

## Acceptance criteria
- 1. Run a single toy build task through multi-loopr V1 end to end: Claude Code starts a loopr-disciplined phase, hands off, and Codex CLI picks it up and continues it on the same repo -- observable as two agents' commits on one git history where the second's work demonstrably builds on the first's (not a redo, not ignoring it).
2. The entire run completes with zero browser/interactive prompts after initial credential setup -- observable as a scripted run producing exit 0 with no human interaction mid-run.
3. loopr's own phase artifacts (baby_prd.md, context.md, PHASE_N_SPEC.md) are genuinely produced and read by both agents during the run, not bypassed -- observable by diffing what each agent actually referenced against what it was handed.

## Scope edges
- **out**: 1. More than two providers (deferred) -- V1 proves the premise with exactly two; N-provider routing is a different, harder problem not worth solving before two works.
2. Sophisticated routing/model-selection logic (deferred) -- V1 is a fixed Claude Code <-> Codex CLI pairing, no dynamic provider choice.
3. Cost optimization or budget enforcement (out) -- no token/spend tracking or budget gating in V1.
4. The V2 auditor subagent + severity/confidence escalation tier (deferred) -- archived in kaide-loop's design; V1 runs loopr's core discipline without it.
5. Indexing, knowledge graphs, or any retrieval layer (out) -- context relay is file-based handoff artifacts only, not a search/retrieval system.
6. A GUI (out) -- CLI/headless only.
7. Traycer, or any hosted/closed orchestrator dependency (out, permanently) -- per the architecture decision; not a V2 deferral, a rejected path. -- user-stated

## Boundary
PROPOSED BOUNDARY (draft, not yet confirmed):

multi-loopr V1 covers: a local, headless harness that runs loopr's spec discipline across exactly two AI coding provider CLIs -- Claude Code and Codex CLI -- operating on a single repository. It includes a file-based context relay that lets one provider's agent hand off a loopr-disciplined build phase to the other and have it genuinely continue that work (not restart it, not ignore it), verifiable via git commit history and loopr's own rendered phase artifacts (baby_prd.md, context.md, PHASE_N_SPEC.md) actually being produced and referenced by both agents. It runs entirely on the operator's own machine against their own repo, using each provider's own existing (BYOA) credentials/subscriptions, with no hosted account, no proxying or reselling of provider access, and no interactive/browser step required mid-run once credentials are set up once.

It explicitly does NOT cover: routing or selecting among more than two providers; sophisticated model-selection logic; cost optimization or budget enforcement/tracking; the V2 auditor subagent and its severity/confidence-based escalation tier; indexing, knowledge graphs, or any retrieval layer; a GUI. It also does not, and will not, depend on Traycer or any other hosted/closed orchestrator -- that is a permanent architectural rejection made before this build started, not a V2 deferral to revisit later.

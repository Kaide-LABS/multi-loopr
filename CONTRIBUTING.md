# Contributing to multi-loopr

## Building and testing locally

```
npm ci
npm run check
```

`npm run check` runs, in order: `npm run typecheck` (`tsc -p tsconfig.json`, strict mode, zero
diagnostics required), `npm run test` (the full `node:test` suite), and
`node src/cli/main.ts doctor --boundary` (the hard-boundary scan, PRD §5.1). All three must pass
before any change is considered complete.

## How this project is built

multi-loopr is built phase-by-phase against a numbered `PHASE_N_SPEC.md` technical blueprint for
each phase, under an automated review loop that checks each phase's implementation against its own
spec before the next phase is drafted. `multi-loopr-PRD.md` is the single canonical product
requirements document every phase spec is built from.

## Contribution status

This repository currently has no configured git remote and no public issue tracker. There is no
`git push`/`git remote add` performed as part of this project's own build process -- that remains a
deliberate, credentialed decision left to whoever hosts a public copy of this repository. Until a
public remote exists, this file cannot honestly promise a pull-request workflow; when one does exist,
this file will be updated to describe it.

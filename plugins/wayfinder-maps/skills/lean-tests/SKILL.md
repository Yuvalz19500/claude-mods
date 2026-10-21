---
name: lean-tests
description: Use when choosing which tests to run while implementing, merging or fixing, and to set up change-aware (affected-only) testing in a repo that has none. One full-suite run right before merge, every failure fixed.
---

# Lean tests

The policy, then how to set it up in a repo that doesn't have it yet. It works in any repo, with or without Wayfinder. Repo notes (`CLAUDE.md`, `AGENTS.md`, `docs/testing.md`) win where they are more specific.

## The policy

- **During work** (tickets, implementations, merges, bug fixes, review or checklist fix passes): run only change-aware tests, the tests the change affects. Never the full suite.
- **Before merge**: the full suite runs once, on the branch about to merge, on every platform the repo supports in parallel. Every failure gets fixed before merging, including failures that also happen on the default branch, flaky tests and config or environment failures. Find the cause and fix it; never rerun until green, skip, quarantine, or wave a failure through as pre-existing. After a fix, rerun only the failed tests (`playwright test --last-failed`, `vitest --changed` on the fix, `pytest --lf`) until they pass.
- **Latest versions, no deprecated APIs**: code against the versions of the libraries, frameworks and tools the repo actually has installed (lockfile or manifest), read their current docs before using an API, and never use functionality they mark deprecated. Code a change touches that already uses it moves to the current replacement.

## Is the repo set up?

It is when its notes name one **affected-tests command** (e.g. `pnpm test:affected`, `make test-affected`, `just test-affected`) and say the policy above. If not, set it up before the first implementation that needs it, as its own commit (or the first commit of the wave), following the steps below. Until it is set up, or for a layer the setup can't cover, **fall back to the full suite** for that layer at the points where the affected run would go: slower, but nothing slips through.

## Setting it up

1. **Detect the stack.** Read the manifests and configs: `package.json` and its workspaces, `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `playwright.config.*`, `vitest.config.*`, `jest.config.*`, `pyproject.toml`, `pytest.ini`, `Cargo.toml`, `go.mod`. List each test layer (unit, integration, end-to-end), its runner, the installed runner version, and how to run one file. Check each tool's current docs for the installed version; flags change between majors.

2. **Pick the change-aware tool per layer**, and combine them where the stack allows:
   - **Monorepo package selection**: Turborepo (`turbo run test --affected`, or `--filter=...[<base>]`) or Nx (`nx affected -t test --base=<base>`). Turn on result caching keyed by a hash of each package's input files (Turbo `inputs`/`outputs` in `turbo.json`, Nx `inputs` and `namedInputs`), so an unchanged package replays its cached result instead of rerunning.
   - **Playwright**: `playwright test --only-changed=<base>` runs the spec files changed since `<base>` and the specs that import changed files. Add the specs for screens the change touches when imports don't link them (an e2e spec rarely imports the app code it drives): keep a small map from source folders to spec files in the script.
   - **Vitest**: `vitest run --changed <base>` (follows the import graph).
   - **Jest**: `jest --changedSince=<base>` (`--onlyChanged` for uncommitted work).
   - **pytest**: `pytest-testmon` (`pytest --testmon`) selects tests by recorded coverage. Its `.testmondata` must exist first: build it with one full run, and keep it out of git.
   - **Cargo / Go and others**: run the tests of the crates or packages the diff touches (`cargo test -p <crate>`, `go test ./<pkg>/...`).
   - No tool fits a layer: map changed paths to test files in the script, and fall back to that layer's full run when the map can't decide.

3. **Write one affected-tests command** that takes a base ref (default: the default branch, or the wave branch while a wave runs), runs every layer's selector, and exits non-zero on any failure. Put it where the repo keeps scripts (`package.json` script, `Makefile`, `justfile`, `scripts/`). Make it fall back to the full run of a layer whenever that layer's selector can't run (no testmon data, a config file changed, a lockfile changed): changes to configs, lockfiles, CI or test fixtures affect everything.

4. **Prove it.** Make a small change in one package and confirm the command runs that package's tests and skips the others. Break one line in a covered file and confirm the command goes red. Change a config or lockfile and confirm it falls back to the full run.

5. **Document it** in the repo's `CLAUDE.md` (or `AGENTS.md`) and its testing notes (`docs/testing.md`): the affected-tests command and when to use it, that the full suite runs once right before merge on every platform in parallel with every failure fixed, how to rerun only failed tests, and the latest-versions rule. Short, so every session reads it.

6. **CI** (if the repo has it): PR checks can run the affected command for speed, but keep one full-suite job that runs before merge (on the merge queue, or required on the final push).

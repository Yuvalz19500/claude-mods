---
name: lean-tests
description: Use when choosing which tests to run while implementing, merging or fixing, in any kind of project, and whenever a repo has no affected-only test command yet - then set one up yourself. One full-suite run right before merge, every failure fixed.
---

# Lean tests

The policy, and how to put it in place in a repo that doesn't have it yet. It applies to any kind of project (web or desktop app, service, library, game, embedded, data pipeline), with or without Wayfinder. Repo notes (`CLAUDE.md`, `AGENTS.md`, a testing doc) win where they are more specific.

## The policy

- **During work** (tickets, implementations, merges, bug fixes, review or checklist fix passes): run only change-aware tests, the tests the change affects. Never the full suite.
- **Before merge**: the full suite runs once, on the branch about to merge, on the fastest machine available (the main machine of whoever runs it, the one with the most cores); other machines run only what it can't cover (OS-specific tests and quick non-UI stages on that OS), at the same time. A sharded full run elsewhere is the fallback when that machine is unavailable. It starts as soon as the last test-code change before merge (e.g. the test audit) lands; later fixes get affected tests only, plus a second full run only when a fix touches something many tests share (a shared test kit or fixture, a test config, a lockfile). Every failure gets fixed before merging, including failures that also happen on the default branch, flaky tests and config or environment failures. Find the cause and fix it; never rerun until green, skip, quarantine, or wave a failure through as pre-existing. After a fix, rerun only the failed tests until they pass.
- **Fast full run**: the full-suite command uses the whole machine and runs independent stages at the same time (see **Fast full run** below).
- **Fixed date**: tests never depend on today's date, time or time zone; see the `test-audit` skill's authoring gate.
- **Latest versions, no deprecated APIs**: code against the versions of the libraries, frameworks, engines and tools the repo actually has installed (lockfile, manifest, engine version file), read their current docs before using an API, and never use functionality they mark deprecated. Code a change touches that already uses it moves to the current replacement.

## Set it up yourself

A repo is set up when its notes name one **affected-tests command** and state the policy above. If it isn't, **do the setup yourself**, right away, before the first change that needs a test run: don't explain the steps to the user or ask them to do it. Commit it on the current branch (the wave branch's first commit during a wave), and tell the user in one line what you added and the command's name. Only stop to ask if setting it up needs something you can't do (a paid service, an account, a machine you can't reach); then fall back as below and say what's missing.

Until it works, and for any part it can't cover, **fall back to the full run** of that part at the points where the affected run would go: slower, but nothing slips through.

1. **Find what the project actually uses.** Read its manifests, build files, configs and CI files, and list every test layer: what runs it (test framework, engine test runner, build system), the installed version, how to run one test or file, and what each layer needs to boot. Don't assume an ecosystem: a game may test through its engine's runner, a C++ project through CTest or a custom harness, a monorepo through its build system.

2. **Find each layer's change-aware option**, in that tool's current docs for the installed version. Look for, in order of preference:
   - **A build system that knows the dependency graph and caches results by input hash**, so only targets whose inputs changed rerun and the rest replay cached results.
   - **The test runner's own changed-only or since-ref mode** (it follows imports or recorded coverage from a base ref).
   - **Coverage- or dependency-based selection plugins** for that runner.
   - **A path map** you write: changed source folders to the tests or test groups that cover them (test categories, tags, filters, assemblies, modules). Make it fall back to the layer's full run when it can't decide.

   Examples, not a list to pick from: Bazel, Buck2, Pants, Gradle (build cache), Turborepo or Nx (`affected` plus hash-keyed caching); Playwright `--only-changed`, Vitest `--changed`, Jest `--changedSince`; pytest-testmon; `cargo test -p` / `go test ./pkg/...` on the touched packages; CTest labels; Unity Test Framework or Unreal Automation filtered by assembly, category or test path; Godot test addons filtered by directory. End-to-end specs rarely import the code they drive, so add a path map from source areas to their end-to-end specs.

3. **Write one affected-tests command** that takes a base ref (default: the default branch, or the wave branch during a wave), runs every layer's selection, and exits non-zero on any failure. Put it where the repo keeps its scripts or tasks. Make it run a layer in full when its selection can't work (missing coverage data, first run) or when the change touches what everything depends on: build or test configs, lockfiles, engine or toolchain versions, CI files, shared fixtures. Keep generated selection data (coverage databases, caches) out of version control.

4. **Prove it before you rely on it.** Change one file in one area: the command runs that area's tests and skips the rest. Break one covered line: it goes red. Touch a config or lockfile: it runs everything. Fix the command until all three hold, then revert the probes.

5. **Set up the fast full run** (next section) if the repo doesn't have it yet.

6. **Write it down** in the repo's `CLAUDE.md` (or `AGENTS.md`) and its testing notes, briefly: the affected-tests command and when to use it, the full-suite command, that it runs once right before merge on the fastest machine (which stages other machines cover, and the fallback) with every failure fixed, how to rerun only failed tests, and the latest-versions rule. Every later session then follows it without this skill.

7. **CI**, if the repo has it: PR checks may run the affected command for speed, but keep one full-suite job that runs before merge.

## Fast full run

Set this up yourself, like the affected command, the first time a full run is due and the repo lacks it. Prove it by running it once and comparing its time with the old command.

1. **Size workers to the machine.** Each runner's parallel workers are computed at run time from the logical CPUs of whatever machine runs it (e.g. Node `os.availableParallelism()`), never a fixed low cap or a count tuned to one person's machine, so the repo runs well for anyone who clones it (e.g. Playwright workers ≈ half the logical CPUs, capped around 8, overridable by an env var such as `<PROJECT>_E2E_WORKERS`; pytest-xdist `-n auto`; the build tool's default jobs). Remove hard-coded low caps unless a test truly needs serial. Keep benchmarks and timing tests serial, in their own project or group.
2. **Run independent stages concurrently.** The full-suite command starts the slow stages that don't depend on each other at the same time (backend and unit suites alongside the UI build and end-to-end run), writes each stage's full log to its own file, prints a short summary, and exits non-zero if any stage fails. Don't chain slow stages one after another. Split slow suites across cores for full runs (e.g. pytest-xdist); keep change-aware tools that don't combine with that (e.g. pytest-testmon) for affected runs only.
3. **OS subsets.** Give the command a way to run only the OS-specific stages and the quick non-UI stages, for a second machine on another OS, and a sharded mode (e.g. Playwright `--shard`) for the fallback when the main machine is unavailable.
4. **Load-proof the timing tests.** Run the full suite at the new worker count and fix each test that fails only under load at its root: wait on frames, events or state, never on a number of milliseconds. Reproduce each one, and check its fix, on that machine at that load with a few runs of just that test (e.g. Playwright `--repeat-each=3` to `5`, `go test -count=3`, a short loop of the runner's single-test command), not by recreating the load elsewhere.
5. **Pin the clock.** Find data, demo feeds and clocks that follow the real date (synthetic data, "today" figures, time-zone or DST offsets, timestamps) and route them through a test-only seam pinned to one fixed instant, so every run sees the same values on any day and machine. Fix tests that hard-code values only true on some dates.

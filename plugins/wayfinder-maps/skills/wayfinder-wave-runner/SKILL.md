---
name: "wayfinder-wave-runner"
description: "Use when running a Wayfinder project wave by wave (implement-frontier) in a Claude project: where it runs, models, branches, cleanup and checklists."
---

# Wayfinder wave runner

Rules for building a Wayfinder spec wave by wave. They apply to every Wayfinder project.

## Before each wave
- Ask the user whether the wave runs in the cloud or on their PC. Recommend their PC when it has more cores for parallel agents. Use a decision card if one is available.
- PC: start the wave thread as a Remote Control session in the repo folder on their device. Cloud: start a normal thread.

## One thread per wave
- Each wave is one thread that runs `/wayfinder-maps:implement-frontier` on the spec. Don't split tickets into separate threads.
- That thread computes the frontier, runs one implementer subagent per ticket in parallel in git worktrees, merges, publishes the checklist and drives the PR to merge. This holds on the PC and in the cloud alike.
- Fix passes from review or verify are subagents in the same thread.

## Code review and verify: once, before merge
- Run `/code-review` and verify only once per wave: in the pre-merge pass on the wave branch, after the user OKs the merge and every checklist fix is in, so one review and one verify cover all of the wave's changes.
- Never after the wave's first implementation, never per ticket (implementers don't run them), and never on checklist fix passes. If the repo's `CLAUDE.md` (or `AGENTS.md`) asks for them at another point, follow this rule instead and update that file to match.
- Pre-merge order: code review and its fixes, verify and its fixes, the test audit, the one full-suite run (see **The full run**), merge, cleanup. Briefs must say this.

## Latest versions, no deprecated APIs
- Every thread and subagent codes against the versions of the libraries, frameworks and tools the repo actually has installed: check the lockfile or manifest, and read the current docs for those versions before using an API.
- Never use functionality those versions mark deprecated. When code a ticket touches already uses it, move that code to the current replacement as part of the ticket.
- Briefs must say this. If the repo's `CLAUDE.md` (or `AGENTS.md`) doesn't say it yet, add it there so every session follows it.

## Tests: lean during the wave, full once before merge
- During tickets, implementations, merges, bug fixes and checklist fix passes, run only change-aware tests: what the change affects, never the full suite. Use the repo's affected-tests command if it has one; otherwise the change-aware option of whatever the project uses (e.g. Playwright `--only-changed`, Vitest `--changed`, Jest `--onlyChanged`, pytest-testmon, Nx or Turborepo `affected`, a game engine's runner filtered by area). Combine them where the stack allows: a build system that picks the changed packages or targets, with per-package result caching keyed by a hash of each package's input files so an unchanged package replays its cached result instead of rerunning, then the runner's own changed-only mode inside each package that does run. If the repo has none yet, set one up yourself with the `lean-tests` skill (don't hand the user steps), as the first commit of the wave; until then, fall back to the full suite where the affected run would go.
- The full suite runs only once per wave: on the wave branch, right before merging, after the user OKs the merge, started as soon as the test audit lands. How it runs is under **The full run**.
- Fix every failure that run shows before merging: failures that also happen on `main`, flaky tests and config or environment failures included. Find the cause and fix it at its root; never rerun until green, skip, quarantine, or wave a failure through as pre-existing. Then rerun only the failed tests (e.g. `playwright test --last-failed`, `pytest --lf`) until they pass.
- Verify runs only the specs it adds or changes, not the full suite.
- Every test an implementer, fixer or verify writes or changes passes the `test-audit` skill's authoring gate (what it protects, the bug that fails it, the cheapest layer that catches it, extend instead of copy). Briefs must say this.

## The full run: once, on the fastest machine
Before the first wave's pre-merge run (or as soon as you see the repo lacks any of this), check the repo is set up for it and **set up what's missing yourself**, as a commit on the wave branch, following the `lean-tests` skill's "Fast full run" section. Don't hand the user steps; tell them in one line what you added. Record it in the repo's `CLAUDE.md` (or `AGENTS.md`) and testing doc so later waves skip the check.
- **One machine.** The full suite runs once per wave on the user's main PC (the machine with the most cores), through a Remote Control session in the repo folder, not on several machines at once. A cloud container runs only what that PC can't cover: OS-specific tests (e.g. Linux-only specs) and the quick non-UI stages on that OS, at the same time as the PC run. A sharded cloud full run is the fallback only when the PC is unavailable; say so in one line.
- **Sized to the machine.** Test runners' parallel workers follow the machine's cores (e.g. Playwright workers ≈ half the logical CPUs, capped around 8, overridable by an env var), not a fixed low cap. Timing-sensitive tests wait on frames, events or state, never on milliseconds, so they hold up under that load. Benchmarks and timing tests stay serial.
- **Stages at the same time.** The full-suite command runs independent stages concurrently (backend and unit suites alongside the UI build and end-to-end run), each writing its full log, and fails if any fails. Slow suites split across cores for full runs (e.g. pytest-xdist `-n auto`); change-aware tools that don't combine with that (e.g. pytest-testmon) stay for affected runs.
- **Fixed date.** Tests never depend on today's date or time (see the `test-audit` skill's authoring gate).
- **Timing.** Start the full run as soon as the test audit lands. Fixes that land after it get only affected tests and a rerun of the failed tests. Run the full suite a second time only if a fix touches something many tests share: a shared test kit or fixture, a test config, a lockfile.

## If the PC disconnects mid-wave
- Move the wave to a cloud thread automatically without asking, and resume from the pushed branches. Post one line telling the user it moved.
- So on the PC, commit and push the ticket branches and the wave branch after every meaningful step, and keep a progress note in the wave PR body.

## Models and effort
- Coordinator: the default model (Opus) at low effort.
- Wave threads: Opus at medium (project default; no effort override).
- Implementer, merger, fixer and reviewer subagents: Sonnet at xhigh (set model and effort on every Agent call).
- A subagent that makes a design or an artifact: Opus, effort left at its default.

## Branches and PRs
- Names describe the task: `claude/wave-N` for the wave, `wave-N/<ticket>-<short-name>` for tickets, PR title `Wave N: ...`. Never default names like `claude/project-thread-xxxx`.

## Test audit (last step before the full run)
- The audit is part of the wave thread and lands with the wave. After the user OKs the merge and the wave's one code review and verify are done, the thread runs the `test-audit` skill's audit on the wave branch. As soon as it lands, it starts the wave's one full-suite run (see **The full run**), fixes every failure, merges, and cleans up. No separate thread, branch or PR. Briefs must say this.
- Scope: the tests the wave added or changed (`git diff --name-only main...<wave branch>`), plus the tests in other layers that cover the same code. Not the whole repo unless the user asks.
- Keep it cheap: static checks and read-only ledger subagents (at most three, Sonnet at xhigh), then targeted runs of only the files it edited. The wave's one full run right after it is the backstop, so the audit adds no full run of its own.
- It deletes the tests it marks unneeded, and consolidates and repairs the rest, as commits on the wave branch, test code only. A "Test audit" section in the wave PR body lists each deleted test with the proof that remains and the count removed per layer (e2e first). Production seams the deletions leave unused go there as follow-ups for the next wave.
- If the full run then fails because of an audit edit, restore that test rather than chase it.

## After every merge
- Only `main` remains. Delete every other branch (remote and local) and every worktree, both in the cloud checkout and on the user's PC. Confirm it is clean.
- Delete every file the finished wave no longer needs: project-file images and notes (e.g. /mnt/project-files/waveN) and scratch files. Keep the spec and anything it or CLAUDE.md still references.
- Never try to delete artifacts yourself: the delete raises a permission prompt the user can't see in the app, and the thread freezes on it. Instead, end the cleanup with a list of links to the wave's checklist and screenshot artifact pages for the user to delete themselves.

## Mac builds
- Never build the Mac app on GitHub Actions for testing (it costs usage). Actions Mac builds are for releases only.
- When a Mac build or Mac kit run is needed, ask the user to open their Mac and connect it, then run it there through Remote Control.

## Manual-test checklist
- Publish it as an artifact page. Every item gets a comment box the thread can read back, so the user can reference items without quoting numbers.
- List only what the user must see in the UI themselves (looks right, works, no visual bugs). Run and verify every check Claude can do itself, such as scripts, smoke checks and builds (including on their devices through Remote Control), instead of listing it.

## Checklist testing, item by item
- Publish the checklist after the wave's first implementation and its change-aware tests pass, with no code review or verify first (they run once, before merge). Then stop and wait: don't start testing until the user says to start checklist testing.
- When they say start, walk them through the checklist one item at a time, in the thread:
  - Send one item per message: short numbered steps saying exactly what to click, each followed by what they should see. Keep it short and on point.
  - Wait for their result before sending the next item. Then go through the choices to confirm the same way.
- AI-client steps (prompts an AI would send over MCP): start a Remote Control session on their PC in the repo folder (it has the app's MCP tools) and tell them to send each prompt as a message in the thread. That PC session runs it in their app. Answer in your own voice with what it did.
- What they find during testing gets fixed right away by fixer subagents on the wave branch, running only their targeted tests (no code review or verify: those run once, in the merge pass). Rules they state while testing become conventions: save them and add them to the repo's verify checks.
- When every item passes and they OK the merge: code review and verify (their only run in the wave, covering every change including the checklist fixes), then the test audit, then the wave's one full-suite run (on their main PC, with the cloud covering only OS-specific stages), fix every failure, then merge and clean up.

## Long runs
- Give background end-to-end runs a generous time limit (about 90 minutes in a cloud container).
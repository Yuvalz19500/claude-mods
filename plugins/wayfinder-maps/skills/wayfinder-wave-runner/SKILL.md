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

## Verify before the checklist, code review before merge
- **Verify runs on the merged wave before the checklist.** After every ticket has merged and the wave's one affected end-to-end run is green, run the repo's verify on the wave branch over every screen the wave touched, and fix what it finds, before the checklist is published: the user should only ever check a wave that already looks right. Verify checks, on each touched screen, at the standard window sizes in both themes:
  - Nothing jumps, snaps, flashes or re-renders when the user acts (switches, toggles, tabs, inputs, data arriving): every change eases or cross-fades in place, and text that doesn't change never fades.
  - Alignment: the controls of a list or form share their column edges (inputs, steppers, switches and their unit words), labels share theirs, rows of a group have matching heights.
  - Space: no card or column has an empty tail, wide screens are filled rather than left as a narrow strip, no text is cut off.
  - Each rule the user states while testing joins these checks in the repo's verify (see **Checklist testing**).
- Verify's fixes run in parallel (see **Every pre-merge phase fixes in parallel**), with no end-to-end run; then verify again only the screens the fixers touched.
- `/code-review` runs once per wave, in the pre-merge pass on the wave branch, after the user OKs the merge and every checklist fix is in. Verify runs again in that pass, only over the screens changed since its pre-checklist run (checklist and review fixes).
- Never per ticket (implementers run neither), and never on checklist fix passes. If the repo's `CLAUDE.md` (or `AGENTS.md`) asks for them at another point, follow this rule instead and update that file to match.
- Order: implementers, merges, the affected end-to-end run and its fixes, verify and its fixes, the checklist; then, the moment the user passes the checklist and OKs the merge, the one full-suite run starts (see **The full run**) and, while it runs, code review and its fixes, verify of what changed since and its fixes, and the test audit; then the full run's failures are fixed and proven, one closing run of the failed tests plus the affected tests since the full run's commit, merge, cleanup. Briefs must say this.

## Latest versions, no deprecated APIs
- Every thread and subagent codes against the versions of the libraries, frameworks and tools the repo actually has installed: check the lockfile or manifest, and read the current docs for those versions before using an API.
- Never use functionality those versions mark deprecated. When code a ticket touches already uses it, move that code to the current replacement as part of the ticket.
- Briefs must say this. If the repo's `CLAUDE.md` (or `AGENTS.md`) doesn't say it yet, add it there so every session follows it.

## Tests: lean during the wave, full once before merge
- During tickets, implementations, merges, bug fixes and checklist fix passes, run only change-aware tests: what the change affects, never the full suite. Use the repo's affected-tests command if it has one; otherwise the change-aware option of whatever the project uses (e.g. Playwright `--only-changed`, Vitest `--changed`, Jest `--onlyChanged`, pytest-testmon, Nx or Turborepo `affected`, a game engine's runner filtered by area). Combine them where the stack allows: a build system that picks the changed packages or targets, with per-package result caching keyed by a hash of each package's input files so an unchanged package replays its cached result instead of rerunning, then the runner's own changed-only mode inside each package that does run. If the repo has none yet, set one up yourself with the `lean-tests` skill (don't hand the user steps), as the first commit of the wave; until then, fall back to the full suite where the affected run would go.
- The full suite runs only once per pre-merge pass: on the wave branch, started the moment the user passes the checklist and OKs the merge, in parallel with code review, verify and the test audit. How it runs is under **The full run**.
- Fix every failure that run shows before merging: failures that also happen on `main`, flaky tests and config or environment failures included. Find the cause and fix it at its root; never rerun until green, skip, quarantine, or wave a failure through as pre-existing. Then rerun only the failed tests (e.g. `playwright test --last-failed`, `pytest --lf`) until they pass.
- Verify runs only the specs it adds or changes, not the full suite.
- **Test runs go to the user's PC.** Whenever the user's main PC is on and they aren't using it, every test run (end-to-end, unit, backend, affected runs, fix proofs, the full suite) runs there through its Remote Control session: it is much faster than a cloud container. The cloud writes the code and runs tests only when the PC is unavailable or busy, plus what the PC can't cover (OS-specific stages). When the user has several machines, follow their order (for example their main laptop first, then their desktop, then the cloud) and keep it in project memory, not in the repo. Briefs must say this.
- **No end-to-end runs by implementers or mergers.** Implementers write and extend the end-to-end specs their ticket needs but run none of them: only the cheap layers (type checks, lint and quick stages, the unit or backend tests and pure model specs of what they changed, a dry run of the affected-tests command to confirm their specs get picked), then they list their specs in their report. Mergers run the same cheap checks. After every ticket has merged, the wave runs ONE affected end-to-end run of the whole wave on the user's main machine; one fixer reads each failure's trace and fixes them (a ticket that causes most of the failures gets its own fixer in parallel), then only the failed tests are rerun, and then the checklist is published. Per-ticket runs repeat the specs of shared screens and queue behind each other on one machine; the one run on the merged code runs each spec once and also catches tickets that break each other. Briefs must say this.
- **No end-to-end runs for review, verify, audit or checklist fixes.** Fixers of checklist notes and of the pre-merge phases that run beside the full run (code review, verify, the test audit's follow-ups) write the fix and extend or add the end-to-end specs that would catch it, but no end-to-end run proves them: not per fixer, not per batch. Each runs only the cheap checks (type checks, lint and quick stages, the unit or backend tests of what it changed), merges into the wave branch and reports its specs. Checklist fixes land before the full run starts, so it covers them; review, verify and audit fixes land while it runs, so the closing run (the failed tests plus the affected tests since the full run's commit, see **The full run**) covers them. Two exceptions: the wave's first implementation gets one affected end-to-end run after every ticket has merged, before the checklist is published, so the build the user tests is sound; and fixes of the full run's own failures are proven on the main machine (see **The full run**). Briefs must say this.
- Every test an implementer, fixer or verify writes or changes passes the `test-audit` skill's authoring gate (what it protects, the bug that fails it, the cheapest layer that catches it, extend instead of copy). Briefs must say this.

## The full run: once, on the fastest machine
Before the first wave's pre-merge run (or as soon as you see the repo lacks any of this), check the repo is set up for it and **set up what's missing yourself**, as a commit on the wave branch, following the `lean-tests` skill's "Fast full run" section. Don't hand the user steps; tell them in one line what you added. Record it in the repo's `CLAUDE.md` (or `AGENTS.md`) and testing doc so later waves skip the check.
- **One machine.** The full suite runs once per pass on the main machine of whoever runs the wave (their machine with the most cores), through a Remote Control session in the repo folder. Never split the suite between machines: each test would then run on only one OS, and a bug that shows only on the other one would hide until a release pass. A cloud container runs only what that PC can't cover: OS-specific tests (e.g. Linux-only specs) and the quick non-UI stages on that OS, at the same time as the PC run. A sharded cloud full run is the fallback only when the PC is unavailable; say so in one line.
- **Sized to the machine.** Test runners' parallel workers are computed at run time from the cores of whatever machine runs them (never a count tuned to one person's PC), so the repo is as fast on anyone's machine (e.g. Playwright workers ≈ half the logical CPUs, capped around 8, overridable by an env var), not a fixed low cap. Timing-sensitive tests wait on frames, events or state, never on milliseconds, so they hold up under that load. Benchmarks and timing tests stay serial.
- **Stages at the same time.** The full-suite command runs independent stages concurrently (backend and unit suites alongside the UI build and end-to-end run), each writing its full log, and fails if any fails. Slow suites split across cores for full runs (e.g. pytest-xdist `-n auto`); change-aware tools that don't combine with that (e.g. pytest-testmon) stay for affected runs.
- **Fixed date.** Tests never depend on today's date or time (see the `test-audit` skill's authoring gate).
- **Timing.** Start the full run the moment the user passes the checklist and OKs the merge, on the wave branch as it stands then (every checklist fix in), and run code review, verify and the test audit beside it instead of before it: they touch little, and waiting on them costs hours. Note the commit it ran on.
- **One full run per pass.** Never a second full run, even when a fix touches a shared test kit, fixture, test config or lockfile: the affected-tests command already widens to every test that imports the kit, and to a layer in full when a config or lockfile changes. Everything that lands after the full run started (review, verify and audit fixes, the fixes of its own failures) is covered by one closing run on the main machine: the failed tests (e.g. `--last-failed`) plus the affected tests since the full run's commit (the affected-tests command with that commit as its base). It takes minutes, not hours. If it fails, fix and rerun only that run's failures.
- **Failures stream out mid-run.** The full run reports each failure the moment it happens, not at the end: test name, error, and the path of its trace, log or error context, appended to a failures file the thread reads at every check-in (set up by the `lean-tests` skill's fast full run). Start the fixer on the first failures while the run is still going, and hand it each new one as it arrives.
- **Fixing its failures.** Aim for a fix round well under an hour. One fixer takes all of the run's failures, reading each trace and log first. Every fix is proven on the main machine before it merges, through its Remote Control session: first reproduce the failure there (the same test, at the same load where it failed under load), then run the fixed test 3 times (e.g. Playwright `--repeat-each=3`, `go test -count=3`, or a short loop of the runner's single-test command for pytest, `cargo test`, Vitest or Jest), all green. A fix that hasn't reproduced its failure there first is a guess: don't merge it. Never prove a fix by recreating the main machine's load in a smaller cloud container, and never 10+ runs under artificial load; the cloud may write the fix. When the fixes are in, the closing run above (failed plus affected since the full run's commit) is the last test run before merge.

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

## Test audit (beside the full run)
- The audit is part of the wave thread and lands with the wave. It runs in the pre-merge pass beside the full run (which started when the user OKed the merge, see **The full run**), after code review and the pre-merge verify, on the wave branch. Its edits are covered by the closing run (the failed tests plus the affected tests since the full run's commit). No separate thread, branch or PR. Briefs must say this.
- Scope: the tests the wave added or changed (`git diff --name-only main...<wave branch>`), plus the tests in other layers that cover the same code. Not the whole repo unless the user asks.
- Keep it cheap: static checks and read-only ledger subagents (at most three, Sonnet at xhigh), then targeted runs of only the files it edited. The closing run after it is the backstop, so the audit adds no full run of its own.
- It deletes the tests it marks unneeded, and consolidates and repairs the rest, as commits on the wave branch, test code only. A "Test audit" section in the wave PR body lists each deleted test with the proof that remains and the count removed per layer (e2e first). Production seams the deletions leave unused go there as follow-ups for the next wave.
- If the closing run fails because of an audit edit, restore that test rather than chase it.

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
- Publish the checklist after the wave's first implementation, its change-aware tests (one affected run, end-to-end included, after every ticket has merged) and the verify pass on the merged wave are green and fixed, with no code review first (it runs once, before merge). Then stop and wait: don't start testing until the user says to start checklist testing.
- When they say start, walk them through the checklist one item at a time, in the thread:
  - Send one item per message: short numbered steps saying exactly what to click, each followed by what they should see. Keep it short and on point.
  - Wait for their result before sending the next item. Then go through the choices to confirm the same way.
- AI-client steps (prompts an AI would send over MCP): start a Remote Control session on their PC in the repo folder (it has the app's MCP tools) and tell them to send each prompt as a message in the thread. That PC session runs it in their app. Answer in your own voice with what it did.
- What they find during testing gets fixed right away by fixer subagents on the wave branch, running only their cheap checks and adding or extending the end-to-end specs that would catch each bug, with no end-to-end run: the wave's full run covers them (see **No end-to-end runs for review, verify, audit or checklist fixes**; no code review or verify either: the merge pass reviews them and verifies the screens they touched). Rules they state while testing become conventions: save them and add them to the repo's verify checks.
- When every item passes and they OK the merge: start the wave's one full-suite run at once (on their main machine, with the cloud covering only OS-specific stages), and beside it code review (its only run in the wave, covering every change including the checklist fixes), verify of the screens changed since the pre-checklist verify, then the test audit; fix every full-run failure as it streams in, proven on the main machine, then the closing run (failed plus affected since the full run's commit), then merge and clean up.
- **Every pre-merge phase fixes in parallel.** When a phase of the merge pass (code review, verify, the test audit's follow-ups, the full run) leaves several fixes, start one fixer subagent per finding (or per small group sharing one cause or the same files), all at once, each in its own worktree on its own `<wave branch>--<name>` branch, never one agent working through the whole list. Group findings that touch the same files into one fixer so the branches merge cleanly. Each fixer runs only its cheap checks, adds or extends the end-to-end specs for its fix, and merges as it lands, with no end-to-end run; the closing run covers them all (see **No end-to-end runs for review, verify, audit or checklist fixes**). The full run's own failures go to one fixer, each fix proven on the main machine (see **The full run**). The same holds for checklist fixes when the user reports several at once.

## Long runs: detached and watched
- Every long test run (the full run, the affected end-to-end run, the closing run) starts detached from the session that launched it (e.g. `nohup`, a background process, a scheduled task on Windows), writing its log and failures file to the repo's scratch folder, so a dropped connection or a session restart doesn't kill it.
- Watch it yourself; never wait for the user to ask how it's going. Pair it with a watcher (a background task or monitor that wakes you when the run exits) and scheduled check-ins (about every 15 to 20 minutes) that read its progress and failures file and hand new failures to the fixer.
- If it dies (the process is gone with no summary, or its log stops growing), restart it yourself, resuming with only the tests that hadn't finished where the runner allows it.
- If the machine itself is down or unreachable, move the run to the next machine in the user's order (kept in project memory), and tell them in one line. The cloud is the last fallback.
- Give background runs in a cloud container a generous time limit (about 90 minutes), and split longer ones (see the sharded fallback).
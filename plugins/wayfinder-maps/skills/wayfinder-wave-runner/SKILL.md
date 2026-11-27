---
name: "wayfinder-wave-runner"
description: "Use when running a Wayfinder project wave by wave (implement-frontier) in a Claude project: one thread per ticket, where tests run, models, branches, checklists, the wave's one full run, merge and cleanup."
---

# Wayfinder wave runner

Rules for building a Wayfinder spec wave by wave in a Claude project. They apply to every Wayfinder project. A wave started under an earlier version of this skill (one thread for the whole wave) finishes in the flow it started with.

## The shape of a wave
1. **Wave start** (the project's coordinator, running `/wayfinder-maps:implement-frontier`): fix the frontier, claim it, cut the wave branch and its draft PR, and start **one thread per ticket**.
2. **Ticket threads**, all at once, each in its own cloud container, each following the `implement-ticket` skill: implement test-first, run the ticket's affected tests (end-to-end included) in that container, verify, publish the ticket's checklist, take the user's notes as quick fix iterations, and after the user's OK run the ticket's pre-merge pass (code review, verify, test audit, closing affected run), merge into the wave branch and resolve.
3. **Wave merge** (one thread the coordinator starts only once every ticket thread has merged and resolved, never after just one): the wave's one full-suite run, its fixes, the closing run, the merge to `main`, and the cleanup.

## Wave start
- Only the project's coordinator can start threads. When `implement-frontier` runs in a thread instead, it sends the coordinator the ticket list and the brief below and asks it to start the threads.
- Ticket threads run in the cloud: each gets its own container, so tickets never share CPUs and each runs its own tests. A ticket that needs the user's own machine (a desktop app, an OS only that machine has, their sign-in) gets a Remote Control thread there instead; say which ones in the wave's start message.
- The brief for each ticket thread: `Wave N, ticket NNN "<title>" of the spec at <spec path>. Wave branch claude/wave-N. Follow the wayfinder-maps implement-ticket skill (read its SKILL.md if the Skill tool refuses it) from step 1, for this ticket only. It is already claimed.` Point at the spec, ticket and research notes; don't restate them.
- Before starting the threads, bring the repo's `CLAUDE.md` (or `AGENTS.md`) in line with this skill as the wave branch's first commit, if it still describes one thread per wave. Ticket threads then branch from a wave branch that already says how they work, and no two of them edit it.

## Branches and PRs
- Wave: `claude/wave-N`, cut from the latest `main` (`git fetch origin main` first), one draft PR into `main` titled `Wave N: ...`, closing the wave's tickets.
- Ticket: `claude/wave-N--NNN-<short-name>`, cut from `claude/wave-N`, one PR into `claude/wave-N` titled `Wave N · NNN: <title>`.
- Fixers: `claude/wave-N--NNN-<short-name>--<fix>` for a ticket's fixes, `claude/wave-N--<fix>` for the wave merge thread's fixes.
- Never default names like `claude/project-thread-xxxx`.
- Tickets merge into the wave branch, never into `main` on their own; `main` gets the wave in one merge, after the full run.

## Verify before every checklist, code review before every merge
- Each ticket thread runs the repo's verify over the screens it touched, and fixes what it finds, before publishing its checklist: the user should only ever check a ticket that already looks right. Verify checks, on each touched screen, at the standard window sizes in both themes:
  - Nothing jumps, snaps, flashes or re-renders when the user acts (switches, toggles, tabs, inputs, data arriving): every change eases or cross-fades in place, and text that doesn't change never fades.
  - Alignment: the controls of a list or form share their column edges (inputs, steppers, switches and their unit words), labels share theirs, rows of a group have matching heights.
  - Space: no card or column has an empty tail, wide screens are filled rather than left as a narrow strip, no text is cut off.
  - Each rule the user states while testing joins these checks in the repo's verify (see **Checklist testing**).
- `/code-review` runs once per ticket, in its pre-merge pass, after the user OKs the ticket and every checklist fix is in, over the ticket's diff against the wave branch. Verify runs again in that pass, only over the screens changed since its pre-checklist run.
- Never during implementation and never on checklist fix passes. If the repo's `CLAUDE.md` (or `AGENTS.md`) asks for them at another point, follow this rule instead and update that file to match.

## Latest versions, no deprecated APIs
- Every thread and subagent codes against the versions of the libraries, frameworks and tools the repo actually has installed: check the lockfile or manifest, and read the current docs for those versions before using an API.
- Never use functionality those versions mark deprecated. When code a ticket touches already uses it, move that code to the current replacement as part of the ticket.
- Briefs must say this. If the repo's `CLAUDE.md` (or `AGENTS.md`) doesn't say it yet, add it there so every session follows it.

## Tests
- **Change-aware during the ticket.** Tickets, fixes and merges run only what the change affects, never the full suite: the repo's affected-tests command if it has one, otherwise the change-aware option of whatever the project uses (e.g. Playwright `--only-changed`, Vitest `--changed`, Jest `--onlyChanged`, pytest-testmon, Nx or Turborepo `affected`, a game engine's runner filtered by area). If the repo has none yet, the wave start sets one up with the `lean-tests` skill (don't hand the user steps), as the wave branch's first commit, before any thread starts.
- **Each ticket tests itself, in its own container.** Right after implementing, the ticket thread runs the ticket's affected tests, end-to-end included, against the wave branch, and fixes every failure before its verify and checklist. Its closing run in the pre-merge pass does the same after the wave branch is merged in. These runs stay in the ticket's container. No test run in a wave needs a machine of the user's: tests are in the cloud, one container per thread.
- **Checklist and pre-merge fixes are quick iterations.** Fixers of checklist notes and of the review, verify and audit findings write the fix and the specs that would catch it, run only the cheap checks (type checks, lint and quick stages, the unit or backend tests of what they changed) and merge; the ticket's closing run covers them. Fixes of the full run's own failures are proven in the container that ran it (see **The full run**).
- **Every failure gets fixed**, failures that also happen on `main`, flaky tests and config or environment failures included. Find the cause and fix it at its root; never rerun until green, skip, quarantine, or wave a failure through as pre-existing. Then rerun only the failed tests (e.g. `playwright test --last-failed`, `pytest --lf`).
- **The full suite runs once per wave**, in the wave merge thread, on the wave branch with every ticket in. How it runs is under **The full run**.
- Every test a thread, implementer, fixer or verify writes or changes passes the `test-audit` skill's authoring gate (what it protects, the bug that fails it, the cheapest layer that catches it, extend instead of copy). Briefs must say this.

## The full run: once per wave, in the wave merge thread's container
Before the first wave's full run (or as soon as you see the repo lacks any of this), check the repo is set up for it and **set up what's missing yourself**, as a commit on the wave branch, following the `lean-tests` skill's "Fast full run" section. Don't hand the user steps; tell them in one line what you added. Record it in the repo's `CLAUDE.md` (or `AGENTS.md`) and testing doc so later waves skip the check.
- **When.** The coordinator starts the wave merge thread once every ticket thread has merged into the wave branch and resolved. The full run starts at once there, on the wave branch as it stands; note the commit it ran on. A wave with one open ticket waits for it.
- **Where.** In the wave merge thread's own cloud container, the same way each ticket ran its tests in its own: no test run needs a machine of the user's. One container, never split between containers or machines. Where the whole suite won't fit in one command's time limit, split it into parts run one after another in that container (the repo's shard plan), and merge their reports.
- **Other operating systems.** Tests that only run on an OS the cloud doesn't have are listed in the wave PR and run in the repo's pre-release pass on a machine with that OS, not per wave. Run one on the user's machine during a wave only when the user asks, or when a wave change can't be checked any other way; say so in one line.
- **Sized to the machine.** Test runners' parallel workers are computed at run time from the cores of the machine running them (e.g. Playwright workers about half the logical CPUs, capped around 8, overridable by an env var), never a count tuned to one machine. Timing-sensitive tests wait on frames, events or state, never on milliseconds, so they hold up under load. Benchmarks and timing tests stay serial.
- **Stages at the same time.** The full-suite command runs independent stages concurrently (backend and unit suites alongside the UI build and end-to-end run) where the container's cores allow, each writing its full log, and fails if any fails.
- **Fixed date.** Tests never depend on today's date or time (see the `test-audit` skill's authoring gate).
- **Failures stream out mid-run.** The run reports each failure the moment it happens (test name, error, the path of its trace, log or error context) to a failures file the thread reads at every check-in. Start the fixer on the first failures while the run is still going.
- **Fixing its failures.** Aim for a fix round well under an hour. One fixer takes all of the run's failures, reading each trace and log first. Every fix is proven in the container that ran the full run before it merges: first reproduce the failure there (the same test, at the load where it failed), then run the fixed test 3 times (e.g. Playwright `--repeat-each=3`, `go test -count=3`, or a short loop of the runner's single-test command), all green. A fix that hasn't reproduced its failure is a guess: don't merge it.
- **One full run per wave.** Never a second one, even when a fix touches a shared test kit, fixture, test config or lockfile. The fixes are covered by one closing run in the same container: the failed tests (e.g. `--last-failed`) plus the affected tests since the full run's commit. If it fails, fix and rerun only that run's failures.
- **Then merge.** When the closing run is green, verify the screens the full run's fixes touched, mark the wave PR ready and merge it into `main`: the user's OK on each ticket was their OK for the wave, unless they asked to approve the wave merge too. Then clean up (see **After every merge**).

## Long runs: detached and watched
- Every long test run (a ticket's affected run, the full run, a closing run) starts detached from the session that launched it (e.g. `nohup` or `setsid` on Linux and macOS, `Start-Process` or a scheduled task on Windows), writing its log and failures file to the repo's scratch folder, so a dropped connection or a session restart doesn't kill it.
- Watch it yourself; never wait for the user to ask how it's going. Pair it with a watcher (a background task or monitor that wakes you when the run exits) and scheduled check-ins (about every 15 to 20 minutes) that read its progress and failures file.
- If it dies (the process is gone with no summary, or its log stops growing), restart it yourself, resuming with only the tests that hadn't finished where the runner allows it.
- Give background runs in a cloud container a generous time limit (about 90 minutes), and split longer ones into parts run one after another.

## If a container drops mid-wave
- Every thread commits and pushes its branch after every meaningful step, so a new container resumes from the pushed branch, and a run that died there restarts with the tests it hadn't finished.

## Models and effort
- Coordinator: the default model (Opus) at low effort.
- Ticket threads and the wave merge thread: Opus at medium (project default; no effort override).
- Implementer, fixer and reviewer subagents inside a thread: Sonnet at xhigh (set model and effort on every Agent call).
- A subagent that makes a design or an artifact: Opus, effort left at its default.

## Test audit (in each ticket's pre-merge pass)
- Each ticket thread runs the `test-audit` skill's audit in its pre-merge pass, beside code review and verify, on the ticket branch. Scope: the tests the ticket added or changed (`git diff --name-only claude/wave-N...<ticket branch>`), plus the tests in other layers that cover the same code. Not the whole repo unless the user asks.
- Keep it cheap: static checks and read-only ledger subagents (at most three, Sonnet at xhigh), then targeted runs of only the files it edited. The ticket's closing run is the backstop.
- It deletes the tests it marks unneeded, and consolidates and repairs the rest, as commits on the ticket branch, test code only. A "Test audit" section in the ticket PR body lists each deleted test with the proof that remains and the count removed per layer (end-to-end first). If the closing run fails because of an audit edit, restore that test rather than chase it.

## Manual-test checklist (one per ticket)
- Each ticket thread publishes its own checklist as an artifact page, holding only that ticket. Every item gets a comment box the thread can read back, so the user can reference items without quoting numbers.
- List only what the user must see in the UI themselves (looks right, works, no visual bugs), runs only they can do on their own machines, and choices made for them to confirm. Run and verify every check Claude can do itself, such as scripts, smoke checks and builds, instead of listing it.
- Every card carries short numbered steps from the running build to exactly what it checks, then what they should see. At the top, the command that runs the build being approved.

## Checklist testing, item by item
- Publish the checklist once the ticket's implementation, its affected tests and its verify pass are green and fixed. Then stop and wait: don't start testing until the user says to start.
- When they say start, walk them through it one item at a time, in the ticket's thread: one item per message, short numbered steps saying what to click, each followed by what they should see. Wait for their result before sending the next. Then go through the choices to confirm the same way.
- AI-client steps (prompts an AI would send over MCP): start a Remote Control session on their main machine in the repo folder (it has the app's MCP tools) and tell them to send each prompt as a message in the thread. Answer in your own voice with what it did.
- What they find gets fixed right away by parallel fixer subagents on the ticket branch (see **Tests**, quick iterations). Re-checks of fixes go at the end of the checklist. Rules they state while testing become conventions: save them and add them to the repo's verify checks.
- When every item passes and they OK the merge, the ticket's pre-merge pass starts (`implement-ticket` step 6).
- **Every pre-merge phase fixes in parallel.** When a phase (code review, verify, the test audit, the full run) leaves several fixes, start one fixer subagent per finding (or per small group sharing one cause or the same files), all at once, each in its own worktree on its own branch, never one agent working through the whole list. Group findings that touch the same files into one fixer so the branches merge cleanly. The full run's own failures go to one fixer, each fix proven in the container that ran it.

## After every merge
- A ticket merge: its thread removes its worktrees and deletes its ticket and fixer branches (`implement-ticket` step 7).
- The wave merge: only `main` remains. Delete every other branch (remote and local) and every worktree, in the cloud checkout and on every machine of the user's the wave used, and confirm it is clean. When the cloud can't delete remote branches, give the user one command that deletes them all (in their OS's shell).
- Delete every file the finished wave no longer needs: project-file images and notes (e.g. /mnt/project-files/waveN) and scratch files. Keep the spec and anything it or CLAUDE.md still references.
- Never try to delete artifacts yourself: the delete raises a permission prompt the user can't see in the app, and the thread freezes on it. Instead, end the cleanup with a list of links to the wave's checklist and screenshot artifact pages for the user to delete themselves.

## Builds for an OS only one of the user's machines has
- Never build on paid CI runners (e.g. GitHub Actions macOS or Windows runners) for testing: it costs usage. CI builds are for releases only.
- When a build or run is needed on an OS that only one of the user's machines has, ask them to turn that machine on and connect it, then run it there through Remote Control.

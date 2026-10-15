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
- That thread computes the frontier, runs one implementer subagent per ticket in parallel in git worktrees, merges, runs code review and verify, publishes the checklist and drives the PR. This holds on the PC and in the cloud alike.
- Fix passes from review or verify are subagents in the same thread.

## Tests (keep them cheap)
- Implementers, mergers and fixers run only the tests their change affects (unit tests of the packages they touched plus the e2e specs they added, edited or whose screens they touched; use the repo's affected-tests command if it has one, e.g. `pnpm test:affected --base <wave branch> <specs>`). Never the full suite per ticket.
- The full suite runs twice per wave, both on the wave branch: once after every ticket is merged (before code review and verify), and once in the pre-merge pass after the user OKs the merge, after the test audit (with the Windows run on their PC).
- Verify runs only the specs it adds or changes, not the full suite.
- After a failure, rerun only the failed tests (e.g. `playwright test --last-failed`), not the whole suite. Fix flaky tests instead of rerunning them.
- Every test an implementer, fixer or verify writes or changes passes the `test-audit` skill's authoring gate (what it protects, the bug that fails it, the cheapest layer that catches it, extend instead of copy). Briefs must say this.

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

## Test audit (last step before the pre-merge full run)
- The audit is part of the wave thread and lands with the wave. After the user OKs the merge and the pre-merge code review and verify are done, the thread runs the `test-audit` skill's audit on the wave branch. Then it runs the pre-merge full suite and the Windows run, merges, and cleans up. No separate thread, branch or PR. Briefs must say this.
- Scope: the tests the wave added or changed (`git diff --name-only main...<wave branch>`), plus the tests in other layers that cover the same code. Not the whole repo unless the user asks.
- Keep it cheap: static checks and read-only ledger subagents (at most three, Sonnet at xhigh), then targeted runs of only the files it edited. The pre-merge full run right after it is the backstop, so the audit adds no full run of its own.
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
- Publish the checklist after the wave's first implementation, code review and verify. Then stop and wait: don't start testing until the user says to start checklist testing.
- When they say start, walk them through the checklist one item at a time, in the thread:
  - Send one item per message: short numbered steps saying exactly what to click, each followed by what they should see. Keep it short and on point.
  - Wait for their result before sending the next item. Then go through the choices to confirm the same way.
- AI-client steps (prompts an AI would send over MCP): start a Remote Control session on their PC in the repo folder (it has the app's MCP tools) and tell them to send each prompt as a message in the thread. That PC session runs it in their app. Answer in your own voice with what it did.
- What they find during testing gets fixed right away by fixer subagents on the wave branch, running only their targeted tests (no code review or verify until the merge pass). Rules they state while testing become conventions: save them and add them to the repo's verify checks.
- When every item passes and they OK the merge: code review and verify again, then the test audit, then the full suite once and the Windows run on their PC, then merge and clean up.

## Long runs
- Give background end-to-end runs a generous time limit (about 90 minutes in a cloud container).
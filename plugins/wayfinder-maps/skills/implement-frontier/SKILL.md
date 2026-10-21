---
name: implement-frontier
description: "Implement one wave of a spec: its frontier tickets, in parallel, then stop."
disable-model-invocation: true
---

You have been given a spec. Its tickets form a **task graph** with blocking relationships, and the tickets ready now are its **frontier**: open, unclaimed, every blocker done, nothing waiting on a human.

Your job is one **wave**: implement every frontier ticket as it stands when you start, on one branch and one draft PR, then stop. Tickets that unblock during the wave belong to the next wave, which the user starts when they have checked this one.

Communicate with subagents sparsely, through **context pointers** to the spec, tickets, research notes and commits, rather than restating them. Run **implementer subagents** in the background for maximum concurrency.

Two rules hold for every subagent this run starts, and every brief says them:

- **Latest versions, no deprecated APIs.** Code against the versions of the libraries, frameworks and tools the repo actually has installed (read the lockfile or manifest), and read their current documentation before using an API. Never use functionality those versions mark deprecated; when existing code you touch uses it, move that code to the current replacement.
- **Lean tests during the wave.** While implementing, merging and fixing, run only change-aware tests: the tests the change affects, picked by the repo's affected-tests command or a change-aware option of whatever the project uses (for example Playwright `--only-changed`, Vitest `--changed`, Jest `--onlyChanged`, pytest-testmon, Nx or Turborepo `affected`, a game engine's runner filtered by area). Combine them where the stack allows: a build system that picks the changed packages or targets, with per-package result caching keyed by a hash of each package's input files so an unchanged package replays its cached result instead of rerunning, then the runner's own changed-only mode inside each package that does run. Never the full suite. The `lean-tests` skill holds the policy and the tools; if the repo has no affected-tests command yet, set one up yourself with it (don't hand the user steps) right after step 4, as the wave branch's first commit, before starting implementers, and until then fall back to the full suite where the affected run would go. The full suite runs once per wave, right before it merges, and every failure it shows gets fixed (see step 7).

## Steps

1. Read the spec and its tickets, enough to understand the task graph. Fix the wave: list the frontier tickets by number and title. Done when the list is written down; it does not change for the rest of the run. With an empty frontier, report what blocks it (blocked tickets, tickets waiting on the user) and stop.

2. Claim the wave: set each wave ticket's status to claimed where the tracker keeps it (the ticket file's `Status:` line, or an assignee on the issue).

3. (optional) Use an **exploration subagent** for exploration the wave's tickets need: relevant codebase files or external documentation. It saves its markdown notes in a directory outside the repo that every later subagent can read, so implementers spend their run implementing.

4. Create a branch and a draft PR for the wave. The PR closes the wave's tickets, and only those.

5. Start one **implementer subagent** per wave ticket, each in its own worktree, on its own branch named `<wave branch>--<ticket number>`, so every implementer branch is findable by the wave's prefix. Brief each one to do what `/implement` does for its single ticket: `/tdd` at pre-agreed seams where possible, every test it writes or changes passed through the `test-audit` skill's authoring gate when that skill is available (each test names the behavior it protects and the bug that would fail it, sits at the cheapest layer that catches that bug, and extends an existing test instead of copying one), the latest-versions rule above, typecheck and single test files regularly, then at the end only the tests its change affects (its own and those for the code it touched, picked by the repo's affected-tests command or a change-aware runner), never the full suite, `/code-review` on its work, then commit to its branch.

6. As each implementer completes, merge its branch into the wave branch with a **merger subagent**, and mark that ticket done in the tracker. Once the merge is committed, the merger **cleans up** after that implementer: `git worktree remove` on its worktree, `git branch -D` on its branch, and `git push origin --delete` on the branch if it was pushed. Done when every wave ticket is merged, marked done and cleaned up.

   Mergers run only the merged ticket's affected tests, never the full suite.

7. Run the change-aware tests for the whole wave on the wave branch (everything the wave's diff against its base affects), now that every ticket is in, to catch tickets that break each other. Fix what fails in a single **implementer subagent**, cleaned up the same way once merged, rerunning only the failed tests until they pass. Don't run the full suite here: it runs once per wave, on the wave branch right before the merge (in parallel on every platform the repo tests on), after the user has checked the wave. Every failure in that run gets fixed before merging, including failures that also happen on the default branch and flaky tests: find the cause and fix it, never rerun until green, skip, or wave it through as pre-existing.

8. Run `/code-review` on the wave branch. Fix every issue it raises in a single **implementer subagent**, cleaned up the same way once merged. Fixers in steps 7 and 8 hold their tests to the same `test-audit` gate.

9. Mark the PR ready for review. Then sweep: `git worktree prune`, and confirm `git worktree list` shows no implementer worktree and `git branch -a --list '*<wave branch>--*'` shows no implementer branch, local or remote. Clean up any that remain. Done when both come back empty; the wave branch is the only branch this run leaves.

10. Report the wave and stop: the PR, that its full-suite run is still owed before merging (unless the repo's CI runs the full suite on the PR, in which case name that run), each ticket implemented, the tickets this wave unblocked (the next wave's frontier), and the tickets waiting on the user.

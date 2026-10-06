---
name: implement-frontier
description: "Implement one wave of a spec: its frontier tickets, in parallel, then stop."
disable-model-invocation: true
---

You have been given a spec. Its tickets form a **task graph** with blocking relationships, and the tickets ready now are its **frontier**: open, unclaimed, every blocker done, nothing waiting on a human.

Your job is one **wave**: implement every frontier ticket as it stands when you start, on one branch and one draft PR, then stop. Tickets that unblock during the wave belong to the next wave, which the user starts when they have checked this one.

Communicate with subagents sparsely, through **context pointers** to the spec, tickets, research notes and commits, rather than restating them. Run **implementer subagents** in the background for maximum concurrency.

## Steps

1. Read the spec and its tickets, enough to understand the task graph. Fix the wave: list the frontier tickets by number and title. Done when the list is written down; it does not change for the rest of the run. With an empty frontier, report what blocks it (blocked tickets, tickets waiting on the user) and stop.

2. Claim the wave: set each wave ticket's status to claimed where the tracker keeps it (the ticket file's `Status:` line, or an assignee on the issue).

3. (optional) Use an **exploration subagent** for exploration the wave's tickets need: relevant codebase files or external documentation. It saves its markdown notes in a directory outside the repo that every later subagent can read, so implementers spend their run implementing.

4. Create a branch and a draft PR for the wave. The PR closes the wave's tickets, and only those.

5. Start one **implementer subagent** per wave ticket, each in its own worktree, on its own branch named `<wave branch>--<ticket number>`, so every implementer branch is findable by the wave's prefix. Brief each one to do what `/implement` does for its single ticket: `/tdd` at pre-agreed seams where possible, typecheck and single test files regularly, the full test suite once at the end, `/code-review` on its work, then commit to its branch.

6. As each implementer completes, merge its branch into the wave branch with a **merger subagent**, and mark that ticket done in the tracker. Once the merge is committed, the merger **cleans up** after that implementer: `git worktree remove` on its worktree, `git branch -D` on its branch, and `git push origin --delete` on the branch if it was pushed. Done when every wave ticket is merged, marked done and cleaned up.

7. Run `/code-review` on the wave branch. Fix every issue it raises in a single **implementer subagent**, cleaned up the same way once merged.

8. Mark the PR ready for review. Then sweep: `git worktree prune`, and confirm `git worktree list` shows no implementer worktree and `git branch -a --list '*<wave branch>--*'` shows no implementer branch, local or remote. Clean up any that remain. Done when both come back empty; the wave branch is the only branch this run leaves.

9. Report the wave and stop: the PR, each ticket implemented, the tickets this wave unblocked (the next wave's frontier), and the tickets waiting on the user.

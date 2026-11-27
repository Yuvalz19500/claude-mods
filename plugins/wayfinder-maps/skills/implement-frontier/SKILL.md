---
name: implement-frontier
description: "Start one wave of a spec: its frontier tickets, one thread per ticket, then stop."
disable-model-invocation: true
---

You have been given a spec. Its tickets form a **task graph** with blocking relationships, and the tickets ready now are its **frontier**: open, unclaimed, every blocker done, nothing waiting on a human.

Your job is to start one **wave**: every frontier ticket as it stands when you start, each in a thread of its own, all landing on one wave branch. Tickets that unblock during the wave belong to the next wave. The `wayfinder-wave-runner` skill holds the rules for the whole wave (branches, tests, checklists, the full run, models, cleanup); this skill is its first step.

Communicate through **context pointers** to the spec, tickets, research notes and commits, rather than restating them.

## Steps

1. Read the spec and its tickets, enough to understand the task graph. Fix the wave: list the frontier tickets by number and title. Done when the list is written down; it does not change for the rest of the wave. With an empty frontier, report what blocks it (blocked tickets, tickets waiting on the user) and stop.

2. Claim the wave: set each wave ticket's status to claimed where the tracker keeps it (the ticket file's `Status:` line, or an assignee on the issue).

3. (optional) Use an **exploration subagent** for exploration several tickets share: relevant codebase files or external documentation. It saves its markdown notes where every ticket thread can read them (the project's shared files, or a scratch folder committed on the wave branch), so each thread spends its run implementing.

4. Cut the wave branch `claude/wave-N` from the latest default branch and open a draft PR for it, titled `Wave N: ...`, closing the wave's tickets and only those. Its first commits, before any thread starts, are what every ticket needs and only one session should write:
   - the claim from step 2;
   - an affected-tests command, if the repo has none (set it up yourself with the `lean-tests` skill, don't hand the user steps);
   - the repo's `CLAUDE.md` (or `AGENTS.md`) brought in line with `wayfinder-wave-runner`, where it still describes one thread or one shared container per wave.
   Push it.

5. Start one thread per wave ticket, all at once, with the brief in `wayfinder-wave-runner` (**Wave start**): each runs the `implement-ticket` skill in its own cloud container (or a Remote Control thread on the user's machine for a ticket that needs it). Only the project's coordinator can start threads: if you are running in a thread, send the coordinator the list (number, title, cloud or machine) and the brief, and ask it to start them.

6. Report and stop: the wave PR, one line per ticket linked to its thread and where it runs, the tickets waiting on the user, and what happens next: each thread publishes its own checklist, merges into the wave branch after the user's OK and resolves; once every ticket thread has merged and resolved, the coordinator starts the wave merge thread for the one full run, the merge to `main` and the cleanup.

## Without threads

Where threads can't be started (a plain Claude Code session outside a Claude project), run the same flow in this session instead: one implementer subagent per ticket in the background, each in its own worktree on `claude/wave-N--NNN-<short-name>`, each following `implement-ticket` steps 2 to 4 (its affected tests run in the subagent; when the machine is too small to run several at once, queue them one at a time rather than skip them). Then publish one checklist per ticket, and after the user's OK on each run its pre-merge pass and merge it into the wave branch, as `implement-ticket` steps 5 to 7 describe. Once every ticket has merged, run the wave's one full run, the merge and the cleanup as `wayfinder-wave-runner` describes.

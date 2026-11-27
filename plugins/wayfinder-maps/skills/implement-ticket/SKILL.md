---
name: "implement-ticket"
description: "Use in a wave's ticket thread: build one spec ticket test-first, test it in this thread's own container, publish its checklist, then after the user's OK run its pre-merge pass and merge it into the wave branch."
---

# Implement one wave ticket

A wave gives every frontier ticket its own thread, with its own cloud container (see `wayfinder-wave-runner`). This skill is what one of those threads does, from the first commit to the merge. The thread owns exactly one ticket. It never works another ticket, and it never runs the wave's full suite: that runs once for the whole wave, after every ticket has merged.

The brief that started the thread names the spec, the ticket, the wave number `N` and the wave branch `claude/wave-N`.

## 1. Set up

- Read the spec, the ticket, and every research note or decision the ticket points to. State the ticket's number and title in the thread.
- `git fetch origin claude/wave-N` and cut the ticket branch from it: `claude/wave-N--NNN-<short-name>` (the ticket number and two or three words of its title). Push it and open a draft PR from it into `claude/wave-N`, titled `Wave N · NNN: <title>`, closing only this ticket.
- Post a progress checklist with the steps below.

## 2. Implement, test-first

Follow mattpocock-skills' `implement` for this ticket, calling `tdd` at the seams the ticket or spec agrees on. If the Skill tool refuses either one (they are slash commands), read its `SKILL.md` from the installed plugin and follow it. Two of its steps change here: the full test suite is not run at the end (step 3 runs the ticket's affected tests instead), and `code-review` waits for the pre-merge pass (step 6).

Rules for the implementation, and for every subagent the thread starts (briefs must say them):
- **Latest versions, no deprecated APIs.** Code against the versions the repo's lockfiles or manifests pin, read the current docs for those versions before using an API, never use anything they mark deprecated, and move code you touch off it.
- **Tests pass the `test-audit` gate.** Each test names the behavior it protects and the bug that would fail it, sits at the cheapest layer that catches that bug, and extends an existing test or kit instead of copying one.
- Follow the repo's `CLAUDE.md` (or `AGENTS.md`) for its own conventions (shared components, file-size limits, scratch folders). Where it describes the old one-thread-per-wave flow, this skill wins.
- Typecheck and run single test files as you go. Commit and push after every meaningful step, so the work survives a lost container.

## 3. Test the ticket, here

Right after implementing, run everything the ticket affects, end-to-end specs included, in this thread's own container: the repo's affected-tests command with `claude/wave-N` as its base (the `lean-tests` skill sets one up if the repo lacks it). The container is the ticket's alone, so nothing here waits for a shared machine and no tests are deferred to a later run.
- Long runs go detached with a watcher and check-ins (see `wayfinder-wave-runner`, **Long runs**), with failures streamed to a file as they happen.
- Fix every failure, pre-existing and flaky ones included, at its cause; never skip, quarantine or rerun until green. Then rerun only the failed tests until they pass.
- Tests that only run on an OS the cloud doesn't have are listed in the ticket PR for the repo's pre-release pass; no test here needs a machine of the user's.

## 4. Verify before the checklist

Run the repo's verify over every screen the ticket touched (its own verify skill when it has one): the standard window sizes in both themes; nothing jumps, snaps, flashes or re-renders when the user acts; controls and labels of a list or form share their column edges; no card has an empty tail, wide screens are used, no text is cut off. Run it yourself, in the thread, never in a subagent. Fix what it finds (in parallel when there are several findings, see step 6), then rerun the affected tests of what those fixes changed (the affected-tests command with the post-step-3 commit as its base) and verify again only the screens they touched.

## 5. The ticket's checklist

- Publish a checklist artifact page for this ticket only, following `wayfinder-wave-runner`'s **Manual-test checklist**: only what the user must see in the running app or do on their own machines, short numbered steps on every card, a comment box per card saved to the artifact's shared store, the command that runs this ticket's build at the top. Everything Claude can check itself is run and kept off the page.
- Mark the PR ready for review, reply in the thread with the checklist link, and stop. Don't start walking the items until the user says to.
- When they say start, walk the checklist one item at a time as `wayfinder-wave-runner` describes. Read their comment boxes when they ask.
- **Checklist fixes are quick iterations.** Fix what they find right away, one fixer subagent per finding (or per small group sharing a cause or the same files), in parallel, each on its own `claude/wave-N--NNN-<short-name>--<fix>` branch in its own worktree. Fixers write the fix and the specs that would catch it, run only the cheap checks (type checks, lint and quick stages, the unit or backend tests of what they changed) and merge into the ticket branch. No end-to-end run per fix: the closing run in step 6 covers them. Re-checks of fixes go at the end of the checklist. Rules the user states while testing are saved as conventions and added to the repo's verify checks.

## 6. Pre-merge pass, after the user's OK

When every item passes and the user OKs the merge:
1. Merge the latest `claude/wave-N` into the ticket branch, so the pass tests the ticket as it will land beside the tickets already merged.
2. Run, side by side: `code-review` over the ticket's diff against `claude/wave-N` (the ticket's only review), verify of the screens changed since step 4 (checklist and review fixes), and the `test-audit` skill's audit of the tests the ticket added or changed. Each phase's fixes go to parallel fixer subagents as in step 5, never one agent for the whole list.
3. One closing run in this container: the ticket's affected tests against `claude/wave-N`, end-to-end included. Fix every failure and rerun only the failed tests until green. If an audit edit broke a test, restore that test rather than chase it.
4. Merge the ticket PR into `claude/wave-N` (if the wave branch moved meanwhile, merge it in again and rerun only the affected tests of what came in). Mark the ticket done in the tracker on the wave branch.

## 7. Close the ticket

- Remove every worktree the thread made (`git worktree remove`, then delete its folder), delete the ticket branch and its fixer branches locally and on the remote, stop any app or engine it started, and confirm the sweep is clean. If the cloud can't delete remote branches, list them for the wave's final cleanup.
- Reply with the result in one short message (the merged PR, what verify and review found and fixed, the tests that run only in the wave's full run), and tell the coordinator the ticket has merged, so it can start the wave's merge thread once the last ticket is in.
- Resolve the thread.

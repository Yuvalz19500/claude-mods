---
name: test-audit
description: Use whenever tests are written, changed or reviewed in any repo, and for the audit that deletes tests that prove nothing new (the last step before a wave or batch merges, or on request). Gate every new test, prune duplicate or hollow ones.
---

# Test audit

Adapted from OpenClaw's `test-audit` skill (github.com/openclaw/openclaw, `.agents/skills/test-audit`). It works in any repo, with or without Wayfinder. Two modes:

- **Authoring gate**: every test you add or change, while you write it.
- **Audit**: the last step before a batch of work merges (a Wayfinder wave, a feature PR), or when asked: find and delete the tests that add cost without proof.

Never chase deletion counts. A test stays unless you can show what still proves its contract, or that it proves nothing.

## Know the repo's test layers first

Read the repo's own testing notes: `CLAUDE.md` or `AGENTS.md`, and any testing doc they point to (`docs/testing.md` by convention). They name the layers, what each costs, the commands that run a single file, and the contracts never to delete. Repo notes win over this skill.

If the repo has no such notes, work out its layers from the test folders and the package scripts (unit, integration, end-to-end; what each needs to boot; how to run one file). With the audit's edits, add a short `docs/testing.md` with what you found, so the next run starts from it.

The rule everywhere: each contract has one owner test, at the cheapest layer that can really catch its regression. Logic, parsing, rules, storage and API replies belong in unit or service tests. An end-to-end test owns only what needs the whole running system: what a user sees and does, the hop between processes, platform behavior. An end-to-end test that re-asserts a value a unit test already pins costs a full boot on every run and catches nothing new.

## Authoring gate

Before adding or changing a test, answer all four. If one has no answer, don't write the test.

1. **What does it protect?** A behavior a user or client can observe, an invariant, or a contract another component depends on.
2. **What regression makes it fail?** Name a credible bug. A regression test must fail before the fix for the reason you name, and pass after it.
3. **Why doesn't existing proof catch it?** Search the owner's tests first (`rg` the command, endpoint, function or component name across every layer). Extend an existing table, parametrized case, `describe` loop or shared fixture instead of adding a near copy. A second layer needs a distinct risk (a process hop, a real window, real I/O).
4. **Does it need a seam only tests use?** Use an existing seam, or add one only when the real path can't be reached from a test (a clock, a network stub), and keep it out of release builds if the repo has a way to. Never add a seam that skips the behavior the test claims to prove.

Also:

- One bug, one owner regression test. Don't replay it at every layer the bug crossed.
- A behavior-preserving refactor must not break the test: assert outcomes, not call shapes, class names or private helpers.
- The test's name must match what its assertions actually check.

## Junk patterns

Reject these in new tests; delete or repair them in an audit, unless the retention bar names an independent contract.

- No assertion, or only "is visible" on something any render shows; a sleep or timeout standing in for an assertion.
- Self-comparison, or an expected value computed by the code under test.
- A mock or stub that supplies the very value the test asserts (the stub returns X, the test checks X).
- Copied lists or inventories (exports, menu items, tool names) re-typed into the test, unless the list is itself the contract.
- Exact source, import or string greps that a rename would break while the behavior stays.
- Call-shape assertions (which function was called, with what, how many times) when the outcome is observable.
- The same flow replayed in several tests when one owns it and the others only need its result.
- An end-to-end test asserting a calculation, rule or parse result a cheaper test already pins.
- A negative control that passes because of an unrelated guard, or a rejection the code can never reach.
- A fixture that fabricates what the code under test should produce (ordering, a saved file it never writes).

## Retention bar

Always keep, even when slow or static, plus whatever the repo's notes add:

- Public API, protocol, wire-format, storage, migration, config and security contracts.
- Domain rules and calculations users rely on.
- Platform and packaging checks.
- Layout or accessibility checks the repo's verify process asked for.
- A test that encodes a convention the user stated, or a bug the user found by hand.
- Observable ordering a user or client depends on.

Slow is not a reason to delete; move the proof to a cheaper layer instead. A test that fails on a clean base may be catching a real bug: reproduce and fix the owner, never delete the test for it.

## Audit

Cheap by design: reading, static checks and targeted runs only. **It never runs the full suite itself**. Run it on the batch's own branch just before that branch's final full run (a wave's pre-merge run, or CI), which is the backstop, so the deletions merge with the batch.

1. **Scope.** The test declarations the batch added or changed (`git diff --name-only <default branch>...HEAD`, then the changed test blocks), plus the tests in other layers that cover the same owners. Not the whole repo, unless the user asks for a whole-repo or whole-subsystem sweep; then split it into subsystems and audit them one at a time.
2. **Static pre-scan.** `rg` for the mechanical junk patterns in scope: tests with no assertion, sleeps without a following assertion, duplicate test names, end-to-end assertions on values a unit test owns, tests that import a stub and assert its canned values. Hits are candidates, not verdicts.
3. **Ledger.** Split the scope into at most three read-only lanes by layer or owner, each a subagent. Each reads every scoped test in full, its production owner, callers and the overlapping tests, and marks each declaration:
   - `R` keep: the contract and the bug it catches.
   - `F` keep but repair: the assertion is vacuous or its name lies.
   - `C` consolidate: name the keeper test that takes its assertion first.
   - `D` delete: name the proof that remains, or why no contract exists.
   Judge by assertions, not names. No evidence line, no deletion. Prefer a few sure deletions over many guesses.
4. **Apply** as commits on the batch's branch (or, for an audit on request with no open batch, on a branch of its own from the default branch): delete the `D`s, move `C` assertions into their keepers, repair the `F`s, delete helpers and fixtures nothing calls anymore. Change test code only. A test seam or production path the deletions leave unused goes in the report as a follow-up, not into these commits.
5. **Validate, targeted.** Only what the edits touch: the typecheck or compile step if typed code changed, then the edited test files that still exist, with the repo's single-file commands. For each `C` and `F`, make one deliberate break in the production owner, confirm the keeper goes red, then restore the file with `git checkout -- <file>`. After a failure, rerun only what failed. If the final full run fails because of an audit edit, restore that test.
6. **Report** in a "Test audit" section of the batch's PR body (or its own PR for an audit on request). It lists: tests removed per layer (the expensive layer first), each `D` with its remaining proof, consolidations and repairs, surprising keeps, seams to remove later, and the targeted runs with their results.

## While writing a ticket's or feature's tests

Apply the authoring gate to every test as you add it. In your own code review, look for the junk patterns in the tests you wrote and fix them before committing.

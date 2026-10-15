---
name: "wayfinder-map-threads"
description: "Use whenever the user runs wayfinder on an existing map in a Claude project: start one thread per unblocked map ticket instead of working a ticket in the current session."
---

# Wayfinder map threads

The rule: each time the user runs `/mattpocock-skills:wayfinder` on a map that already exists, every unblocked ticket starts in its own thread. The session that received the command doesn't work a ticket itself. It dispatches tickets and reports. Charting a new map is unchanged and stays in the current session.

This covers map tickets (decisions, prototypes, research, design tasks). Implementation waves of a finished spec still follow `wayfinder-wave-runner`: one thread per wave.

## 1. Find the frontier

- Load the map. For the local-markdown tracker, that's `.scratch/<effort>/map.md` and `.scratch/<effort>/issues/NN-*.md` on `main`. If the map's latest changes sit on an unmerged branch, use that branch and say so.
- The frontier is every ticket whose `Status:` is open (not claimed, resolved or out of scope) and whose `Blocked by:` tickets are all resolved.
- If the user named one ticket, the wave is just that ticket.
- If the frontier is empty, report what blocks it (open blockers, tickets waiting on the user) and stop.

## 2. Claim the wave

Set `Status: claimed` on every wave ticket in one commit, `Claim map tickets NN, NN for threads`, and push it to `main`. Concurrent sessions then skip them. Touch only the `Status:` lines.

## 3. Route each ticket

- **Research** (AFK): a cloud thread. It runs the research skill in a subagent and records the answer.
- **Grilling, prototype or task** (HITL): a cloud thread that works with the user in that thread.
- **Needs the user's PC** (the ticket or the map's Notes say it runs on their PC, Blender, their Claude login or Windows): a Remote Control thread in the repo folder on their device.

## 4. Start the threads

Only the project chat session can start threads.

- **In the project chat session:** post one short line naming the wave, then call `start_thread_session` once per ticket, on that post, using the brief below. Use `start_rc_session` for PC tickets.
- **In a thread session:** send the coordinator one message (find it with `get_channel_session_id`) listing each ticket's number, title, route and the brief below, and ask it to start one thread per ticket. Then reply in the thread with the list.

The brief for each thread:

> Work exactly one ticket of the wayfinder map at `<map path>`: ticket NN, "<title>". Read the wayfinder skill (`find ~/.claude/plugins/cache -path '*engineering/wayfinder/SKILL.md'`) and follow its "Work through the map" steps from step 3, for this ticket only. It is already claimed. Resolve it as its `Type:` line says, and load the skills the map's Notes name. Follow the map's Notes (design artifacts, prototype and research branches, spend cap). Record the answer under `## Answer`, set `Status: resolved`, add one line to the map's Decisions so far, and add or graduate any tickets the answer surfaces. Commit on branch `map/NN-<slug>` and open a PR. When it resolves, list the tickets it unblocked. Don't start them; the user starts the next wave by running wayfinder again.

## 5. Report

Reply with one line per ticket: its title, linked to its thread, and where it runs (cloud or PC). After that, list what's still blocked and what it waits on.
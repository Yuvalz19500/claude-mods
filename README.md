# claude-mods

Mods for [Claude Code](https://claude.com/claude-code), built on the function-hooks plugin API: live panes, bands and hooks that run inside the terminal and the desktop Code tab.

This repo is a plugin marketplace. Add it once, then install any mod from it:

```bash
claude plugin marketplace add Yuvalz19500/claude-mods
claude plugin install wayfinder-maps@claude-mods
```

To update to the latest release:

```bash
claude plugin marketplace update claude-mods
claude plugin update wayfinder-maps@claude-mods
```

What changed in each version is on the [Releases](https://github.com/Yuvalz19500/claude-mods/releases) page.

## Mods

### wayfinder-maps

A side drawer for projects planned with the [`/wayfinder`](https://github.com/mattpocock/skills) skill. Run `/wayfinder-maps` to open it. It works in the desktop Code tab and in the terminal.

The Work buttons run Matt Pocock's skills, so install his `mattpocock-skills` plugin alongside it; the drawer itself reads your maps without it.

**The drawer**

- **Shows up when you need it.** In a project with wayfinder maps, a slim band above the prompt sums up what is ready to take and what is waiting on you, with an **Open map drawer** button. It stays out of the way everywhere else.
- **Every map in the project.** Each map shows its status (open, in progress, done, graduated to a spec), how many tickets are done, and how many are frontier, claimed, waiting on you or blocked.
- **Maps and specs.** Wayfinder maps hold decision tickets. Graduated specs (a `spec.md` beside numbered implementation tickets) appear in their own section and are drawn the same way.
- **Tickets in steps.** Click a map to see its tickets as cards, set out in steps from top to bottom: each ticket sits one step below the last ticket it waits on. A card's edge takes its status's color, and an `after 17 ✓ 16 ◐` line names what it waits on. Cards fill the drawer's width and stack when it is narrow; a click anywhere on a card opens its ticket. **Tree** shows the same tickets as an indented list instead.
- **Status chips.** `All`, `To do`, `⚑ Frontier`, `◐ Claimed`, `◷ Waiting on you`, `◌ Blocked`, `✓ Done`: each counts its tickets and, clicked, shows only them.
- **A page per ticket.** Click a ticket to open it on its own page: its status, what it waits on and what it unblocks (each one click away), its question and answer (or the issue and its comments), **Open file** or **Open issue**, and **Work this ticket**. **← Back to map** returns to the map at that ticket.
- **Follows your theme.** Everything is drawn with the app's own elements, light or dark; the only color it adds is each status's.

**Working the tickets**

Every Work button opens a **new chat with no context**, so free tickets can be worked in parallel: in the desktop app, a new session in the project's folder with a line like `Wayfinder: work ticket 24 (…) [wf-…]` filled in: press Enter and the mod runs the right slash command in that chat (the app won't let a link fill in a slash command itself); in the terminal, a terminal window of its own. `↗` on a button means it opens a new chat; set `workIn` to `here` to work in the current chat instead (the buttons then show `→`).

| Where | Button | What it does |
| --- | --- | --- |
| Map | **Work next: 07 ↗** | A new chat on the next ticket ready to take (`/wayfinder <map> <ticket>`). The card then reads `new chat ↗` and the button moves on to the next free ticket, so you fan out one click at a time. With nothing free it becomes **Work the map**. |
| Spec | **Implement frontier · 5 ↗** | A new chat on this plugin's `/wayfinder-maps:implement-frontier`: one wave of the spec, the tickets ready now, then it stops. |
| Spec | **Implement spec ↗** | A new chat on Matt Pocock's `/implement-spec`: wave after wave until the whole spec is done. |
| Ticket page | **Work this ticket ↗** | A new chat on that one ticket (`/wayfinder` on a map ticket, `/implement` on a spec ticket). |

**The `implement-frontier` skill**

Shipped with this plugin, for implementing a spec one wave at a time, so you can check each wave and answer what waits on you before starting the next. Run it from the drawer or as `/wayfinder-maps:implement-frontier <spec>`. It:

1. Fixes the wave: the frontier tickets as they stand when it starts. Tickets that unblock during the run wait for the next wave.
2. Claims them, opens one branch and one draft PR for the wave, and starts a subagent per ticket, each in its own worktree, doing what `/implement` does (TDD, typecheck, tests, code review, commit).
3. Merges each finished ticket into the wave branch, marks it done, and deletes that subagent's worktree and branch (local and remote) right away.
4. Runs `/code-review` on the wave branch and fixes what it raises.
5. Marks the PR ready, confirms no subagent worktree or branch is left (the wave branch is the only one it leaves), and reports what it built, what the wave unblocked, and what waits on you. Then it stops.

**Where it looks**

| Tracker | What it reads |
| --- | --- |
| Local markdown | Any folder (up to 4 levels deep) holding `map.md` or `spec.md` beside an `issues/` or `tickets/` folder of `NN-slug.md` files: `.scratch/<effort>/`, `docs/wayfinder/<effort>/` and the like. Each ticket's `Type:`, `Status:`, `Assignee:` and `Blocked by:` lines (plain or `**bold**`, inline or as a list). |
| GitHub | Issues labelled `wayfinder:map` in the session's repo, their sub-issues as tickets, and GitHub's native blocked-by dependencies. Falls back to a task list in the map body and `Blocked by: #n` lines. Needs the `gh` CLI, signed in. |

Status words are folded into five states. `resolved`, `done` and closed issues are done. `claimed`, or any assignee on an open ticket, is claimed. `awaiting-design` and `ready-for-human` are waiting on you. An open ticket with an unfinished blocker is blocked. Everything else open (`open`, `ready-for-agent`) is frontier.

The drawer refreshes after every turn and every 30 seconds while it's open. GitHub is fetched at most once a minute; press **Refresh** to fetch now.

**Settings**

Where the Work buttons work, and the prompts they send, can be changed under `/config` (or `pluginConfigs` in settings):

| Option | Default |
| --- | --- |
| `workIn` | `new-chat`: a new chat with no context (a new app session on the desktop, a terminal window in the terminal). `terminal`: always a terminal window. `here`: this chat. |
| `mapPrompt` | `/mattpocock-skills:wayfinder {map}` |
| `mapTicketPrompt` | `/mattpocock-skills:wayfinder {map} {ticket}` |
| `specTicketPrompt` | `/mattpocock-skills:implement {ticket}` |
| `specPrompt` | `/mattpocock-skills:implement-spec {map}` |
| `frontierPrompt` | `/wayfinder-maps:implement-frontier {map}` |

`{map}` is the map's (or spec's) path or issue URL, `{ticket}` the ticket's path or issue URL, `{title}` its title. A prompt starting with `/` runs as that slash command; anything else is sent as a message.

## Developing a mod

Each mod is a folder under `plugins/` with `.claude-plugin/plugin.json`, `hooks/hooks.json` and a hooks module. Check one with:

```bash
claude plugin validate plugins/<mod>
```

Run its tests with `claude plugin test plugins/<mod>`. Load a working copy into a session with `claude --plugin-dir plugins/<mod>`; it hot-reloads on save. Add the mod to `.claude-plugin/marketplace.json` to publish it. [`CLAUDE.md`](CLAUDE.md) has the full build-and-release checklist and the engine's gotchas.

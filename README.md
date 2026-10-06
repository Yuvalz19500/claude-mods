# claude-mods

Mods for [Claude Code](https://claude.com/claude-code), built on the function-hooks plugin API: live panes, bands and hooks that run inside the terminal and the desktop Code tab.

This repo is a plugin marketplace. Add it once, then install any mod from it:

```bash
claude plugin marketplace add Yuvalz19500/claude-mods
claude plugin install wayfinder-maps@claude-mods
```

## Mods

### wayfinder-maps

A side drawer for projects planned with the [`/wayfinder`](https://github.com/mattpocock/skills) skill. Run `/wayfinder-maps` to open it.

- **Shows up when you need it.** In a project with wayfinder maps, a slim band above the prompt sums up what is ready to take and what is waiting on you, with an **Open map drawer** button. It stays out of the way everywhere else.
- **Every map in the project.** Each map shows its status (open, in progress, done, graduated to a spec), how many tickets are done, and how many are frontier, claimed, waiting on you or blocked.
- **Maps and specs.** Wayfinder maps hold decision tickets. Graduated specs (a `spec.md` beside numbered implementation tickets) appear in their own section and are drawn the same way.
- **Tickets in steps.** Click a map to see its tickets as cards, set out in steps from top to bottom: each ticket sits one step below the last ticket it waits on. A card's edge takes its status's color, and an `after 17 ✓ 16 ◐` line names what it waits on. Cards fill the drawer's width and stack when it is narrow. **Tree** shows the same tickets as an indented list instead.
- **Status chips.** `All`, `To do`, `⚑ Frontier`, `◐ Claimed`, `◷ Waiting on you`, `◌ Blocked`, `✓ Done`: each counts its tickets and, clicked, shows only them.
- **A page per ticket.** Click a ticket to open it on its own page: its status, what it waits on and what it unblocks (each one click away), its question and answer (or the issue and its comments), **Open file** or **Open issue**, and **Work this ticket**. **← Back to map** returns to the map at that ticket.
- **Parallel work, each ticket in a fresh chat.** **Work next: 07 ↗** opens a new chat with no context on the next ticket ready to take: in the desktop app a new session in the project's folder with the prompt filled in (press Enter to start it), in the terminal a terminal window of its own. The card then reads `new chat ↗` and **Work next** moves on to the next free ticket, so you can fan out one click at a time.
- **Specs in waves, or whole.** On a spec, **Implement frontier · 5 ↗** opens a new chat on this plugin's `/wayfinder-maps:implement-frontier` skill: it builds the tickets ready now with parallel subagents (each in its own worktree, merged into one draft PR, code-reviewed), then stops, so you can check the work and answer what waits on you before the next wave. **Implement spec ↗** runs Matt Pocock's `/implement-spec`, which keeps going wave after wave until the whole spec is done.
- **Follows your theme.** Everything is drawn with the app's own elements, light or dark; the only color it adds is each status's.

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

`{map}` is the map's path or issue URL, `{ticket}` the ticket's path or issue URL, `{title}` its title. A prompt starting with `/` runs as that slash command; anything else is sent as a message.

## Developing a mod

Each mod is a folder under `plugins/` with `.claude-plugin/plugin.json`, `hooks/hooks.json` and a hooks module. Check one with:

```bash
claude plugin validate plugins/<mod>
```

Run its tests with `claude plugin test plugins/<mod>`. Load a working copy into a session with `claude --plugin-dir plugins/<mod>`; it hot-reloads on save. Add the mod to `.claude-plugin/marketplace.json` to publish it.

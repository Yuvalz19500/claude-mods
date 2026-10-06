# claude-mods

A plugin marketplace of Claude Code **mods**: plugins of function hooks (panes, bands, status lines, hooks). Each mod is a folder `plugins/<mod>/` with an entry in `.claude-plugin/marketplace.json`. `plugins/wayfinder-maps/` is the worked example: copy its patterns before inventing new ones.

## Building a mod

1. **Load the `plugin-authoring` skill first.** It holds the API, the path of this build's `claude-code.d.ts` (the authority on every event, `$` call and element prop), and the hot-reload flow for the desktop app (a dev copy under `~/.claude/dev-mods/<session>/`). In a terminal, `claude --plugin-dir plugins/<mod>` hot-reloads the repo copy instead. While developing a mod that is also installed from this marketplace, disable the installed copy, or two copies claim the same command and pane.
2. **Write the mod** as `.claude-plugin/plugin.json` (name, version, description, author, `"types"`), `hooks/hooks.json`, `hooks/register.tsx`, `types/index.d.ts` (the `$.state` contract) and `tests/*.test.ts(x)`. Pure logic (parsing, layout, text) goes in its own files so tests reach it without the engine.
3. **Check it.** Done when all three are clean and the person has seen it working on the desktop *and* in the terminal:
   - `claude plugin validate plugins/<mod>`
   - `claude plugin test plugins/<mod>`: cover every button the mod draws, pressed once, on `desktop` and `terminal`.
   - `tsc` with the tsconfig printed in the header of `claude-code.d.ts`.
4. **Publish, only on the person's go-ahead.** A release waits until the person has tried the change in the app (desktop and terminal) and said to release it, with every test passing; until then the work lives in the dev copy and the repo's working tree, uncommitted. Then bump `version` in `plugin.json` (semver: a breaking change to a setting, command or skill bumps the minor while below 1.0), bring the README section up to date with every user-facing change, keep the marketplace entry current, commit, push. Then cut a **GitHub release** for it, tagged `<mod>-v<version>` on the release commit:
   ```bash
   git tag <mod>-v<version> <commit> && git push origin <mod>-v<version>
   ```
   ```bash
   gh release create <mod>-v<version> --verify-tag --title "<mod> <version>" --notes-file <notes.md>
   ```
   The notes have four sections, each a bullet list written for someone using the mod, with "None." where empty: **What's new**, **Changes**, **Fixes**, **Breaking changes** (what stops working, and what to do about it). Then:
   ```bash
   claude plugin marketplace update claude-mods
   ```
   ```bash
   claude plugin update <mod>@claude-mods
   ```
   Sessions pick it up on restart.

## Gotchas

What the engine and the surfaces actually do, learned building wayfinder-maps. Each costs a round with the person if missed.

- **`$` travels only to top-level functions of the hooks module**; validate refuses `$` passed anywhere else, imported functions included. Helpers in other files take an object of closures instead (`list: p => $.fs.list(p)`): see `Io` in `wayfinder-maps/hooks/parse.ts`.
- **Desktop focus-then-press.** A first click on a Button only moves the focus to it; the press needs a second click. Run the action on a person's focus move and drop the echoing press: `ClickGate` in `wayfinder-maps/hooks/clicks.ts`, wired in its `ui.focus` and `ui.press` hooks.
- **Desktop Buttons draw on one line** and cut long labels with `…`; a Box takes no clicks. A target bigger than one line (a card) is a `Client`: a surface module that draws the region and gets every pointer event in it, posting to the hooks module's `ui.message` (`wayfinder-maps/hooks/card.tsx`). Where a surface has no `Client` (vscode, mobile), fall back to one Button per wrapped line (`wrapLines` in `text.ts`).
- **Overflow shows `…`.** Any Text that runs past its box, `truncate-end` or not, ends in an ellipsis: size text to fit; draw separators with spacing, not runs of rule characters.
- **Svg flickers.** It draws in a sandboxed frame, rebuilt on every redraw, on its own light background, scaled to fit. Build visuals from Box/Text/Button, which follow the theme.
- **Theme-agnostic color.** Default text color everywhere; add color only where it carries meaning (a status), in mid-tone hues readable on light and dark. Single-cell glyphs (`▍ ✓ ◐ ⚑`) draw alike in the terminal and on the desktop; emoji do not.
- **Slash commands run through `$.command.run({ command, args })`.** `$.prompt.submit` refuses text starting with `/`.
- **A new chat is a link the system opens** (`$.process.run`, no shell; see `wayfinder-maps/hooks/launch.ts`). `claude://code/new?q=<prompt>&folder=<dir>` opens a new desktop-app session with the prompt filled in, not sent (the link takes `q`, `folder` and `file`, nothing that sends); each link moves the app's window to its new-session page, so one link per click. `claude-cli://open?q=<prompt>&cwd=<dir>` opens a terminal session, also only filled in. A session that starts working at once is `claude "<prompt>"` in a window of its own: on Windows `cmd /c start "<title>" claude "<prompt>"`, the prompt kept free of cmd's `"%^&|<>!`.
- **Markdown opens only `https:`, `http:` and `file:` links.** Make a file's relative links absolute `file:///` (`absolutizeLinks` in `text.ts`). `onLinkPress` intercepts clicks only in the fullscreen terminal; elsewhere the link opens.
- **Every `$.state` write redraws its readers.** Background polls write only when the value changed, and never toggle a loading flag.
- **`$.state` outlives a hot reload.** A stored value may predate a field you added: read new fields with a default (`det.links ?? []`).
- **Panes dock** beside the transcript only in the fullscreen terminal from 110 columns; elsewhere they sit above the prompt.

## Tests

- A test fakes each `$` call by answering its event with `{ value }`: `on('fs.read', () => ({ value: '...' }))`. The test's own `$` has no `session` noun; the plugin's calls still reach the test's hooks.
- The engine resolves a relative path against the plugin folder before the test's hook sees it: root fake disks at a name and normalize (`fake()` in `wayfinder-maps/tests/drawer.test.tsx`).
- A test drawing a site no plugin fills answers `ui.render` with a tree (`<Box />`), never `null`.

## Editing files here

Edit source with the Edit and Write tools. Shell one-liners (`node -e`, `sed`, heredocs) mangle backslashes, `${}` and quotes in TypeScript and have broken files in this repo more than once.

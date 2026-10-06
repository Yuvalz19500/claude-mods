/**
 * How a Work button opens a new chat on a ticket: the command line the host
 * runs (no shell), built here so tests reach it without the engine.
 */
export type Platform = 'windows' | 'mac' | 'linux'

export type Launch = {
  argv: string[]
  /** Where to run it; absent, the project root. */
  cwd?: string
  /** True when the chat starts working at once; false when its prompt waits for Enter. */
  startsAtOnce: boolean
}

/**
 * The desktop app's link to a new Code session in `folder`. It carries no
 * prompt: the app turns the `/` of a slash command in one into `／`, so a
 * link can never run a skill. The person pastes the copied command instead.
 */
export const appLink = (folder: string) => `claude://code/new?folder=${encodeURIComponent(folder)}`

/** Claude Code's link to a new terminal session in `cwd`, the prompt filled in (not sent). */
export const cliLink = (prompt: string, cwd: string) =>
  `claude-cli://open?q=${encodeURIComponent(prompt)}&cwd=${encodeURIComponent(cwd)}`

/** Opens a link with the system's handler for its scheme. */
export function openLink(url: string, platform: Platform): string[] {
  // rundll32 hands the link to the shell as is; `start` would read the `&` in it.
  if (platform === 'windows') return ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
  return [platform === 'mac' ? 'open' : 'xdg-open', url]
}

/** A new, empty session in the desktop app, in the project's folder. */
export const appChat = (root: string, platform: Platform): Launch => ({
  argv: openLink(appLink(root), platform),
  startsAtOnce: false,
})

/** The host's own clipboard tool, reading the text on stdin: where the surface takes no copy. */
export function clipboardArgv(platform: Platform): string[] {
  if (platform === 'windows') return ['clip.exe']
  if (platform === 'mac') return ['pbcopy']
  return ['sh', '-c', 'wl-copy 2>/dev/null || xclip -selection clipboard']
}

/** The paste shortcut, as the person's keyboard spells it. */
export const pasteKeys = (platform: Platform) => (platform === 'mac' ? '⌘V' : 'Ctrl+V')

// cmd.exe reads its own command line: these end or change it, quoted or not.
const CMD_UNSAFE = /["%^&|<>!\r\n]/

/**
 * A terminal window of its own. On Windows `start` opens one running
 * `claude <prompt>`, so the chat starts at once; elsewhere, or for a prompt
 * cmd.exe would misread, Claude Code's link opens the person's terminal with
 * the prompt filled in.
 */
export function terminalChat(prompt: string, root: string, title: string, platform: Platform): Launch {
  if (platform === 'windows' && !CMD_UNSAFE.test(prompt) && !CMD_UNSAFE.test(title) && title.includes(' ')) {
    // `start` takes its first quoted argument as the window's title; the space gets it quoted.
    return { argv: ['cmd.exe', '/d', '/c', 'start', title, 'claude', prompt], cwd: root, startsAtOnce: true }
  }
  return { argv: openLink(cliLink(prompt, root), platform), startsAtOnce: false }
}

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

/** The desktop app's link to a new Code session in `folder`, the prompt filled in (not sent). */
export const appLink = (prompt: string, folder: string) =>
  `claude://code/new?q=${encodeURIComponent(prompt)}&folder=${encodeURIComponent(folder)}`

/** Claude Code's link to a new terminal session in `cwd`, the prompt filled in (not sent). */
export const cliLink = (prompt: string, cwd: string) =>
  `claude-cli://open?q=${encodeURIComponent(prompt)}&cwd=${encodeURIComponent(cwd)}`

/** Opens a link with the system's handler for its scheme. */
export function openLink(url: string, platform: Platform): string[] {
  // rundll32 hands the link to the shell as is; `start` would read the `&` in it.
  if (platform === 'windows') return ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
  return [platform === 'mac' ? 'open' : 'xdg-open', url]
}

/**
 * What a link fills a new chat's prompt box with. The app neuters a slash
 * command in a link's prompt (its `/` turns full-width), so the link carries
 * plain words and a token; the mod in the new chat trades the token for the
 * real command when the person presses Enter (see `HANDOFF` in register.tsx).
 */
export const handoffText = (what: string, token: string) => `Wayfinder: ${what} [wf-${token}]`

/** The token in a prompt a handoff link filled in, or null. */
export const handoffToken = (text: string) => text.match(/\[wf-([a-z0-9]{6,})\]/)?.[1] ?? null

/** A new session in the desktop app, in the project's folder, its box filled with `text`. */
export const appChat = (text: string, root: string, platform: Platform): Launch => ({
  argv: openLink(appLink(text, root), platform),
  startsAtOnce: false,
})

// cmd.exe reads its own command line: these end or change it, quoted or not.
const CMD_UNSAFE = /["%^&|<>!\r\n]/

/**
 * A terminal window of its own. On Windows `start` opens one running
 * `claude <prompt>`, so the chat starts at once; elsewhere, or for a prompt
 * cmd.exe would misread, Claude Code's link opens the person's terminal with
 * `linkText` filled in.
 */
export function terminalChat(prompt: string, root: string, title: string, platform: Platform, linkText = prompt): Launch {
  if (platform === 'windows' && !CMD_UNSAFE.test(prompt) && !CMD_UNSAFE.test(title) && title.includes(' ')) {
    // `start` takes its first quoted argument as the window's title; the space gets it quoted.
    return { argv: ['cmd.exe', '/d', '/c', 'start', title, 'claude', prompt], cwd: root, startsAtOnce: true }
  }
  return { argv: openLink(cliLink(linkText, root), platform), startsAtOnce: false }
}

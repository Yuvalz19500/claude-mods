/**
 * The desktop app's link to its new-session page. It names no folder: a
 * `folder` makes the app ask "Trust this workspace?", and trusting the folder
 * already selected there leaves the page's folder and branch broken. The
 * page keeps the folder last chosen; the toast names the project to check.
 * It carries no prompt either: the app turns the `/` of a slash command in
 * one into `／`, so a link can never run a skill. The person pastes the
 * copied command instead.
 */
export const appLink = () => 'claude://code/new';
/** A folder's own name, the last part of its path, as the app's folder picker shows it. */
export const folderName = (path) => path.split(/[\\/]+/).filter(Boolean).pop() ?? path;
/** Claude Code's link to a new terminal session in `cwd`, the prompt filled in (not sent). */
export const cliLink = (prompt, cwd) => `claude-cli://open?q=${encodeURIComponent(prompt)}&cwd=${encodeURIComponent(cwd)}`;
/** Opens a link with the system's handler for its scheme. */
export function openLink(url, platform) {
    // rundll32 hands the link to the shell as is; `start` would read the `&` in it.
    if (platform === 'windows')
        return ['rundll32.exe', 'url.dll,FileProtocolHandler', url];
    return [platform === 'mac' ? 'open' : 'xdg-open', url];
}
/** A new, empty session in the desktop app, in the folder its picker holds. */
export const appChat = (platform) => ({
    argv: openLink(appLink(), platform),
    startsAtOnce: false,
});
/** The host's own clipboard tool, reading the text on stdin: where the surface takes no copy. */
export function clipboardArgv(platform) {
    if (platform === 'windows')
        return ['clip.exe'];
    if (platform === 'mac')
        return ['pbcopy'];
    return ['sh', '-c', 'wl-copy 2>/dev/null || xclip -selection clipboard'];
}
/** The paste shortcut, as the person's keyboard spells it. */
export const pasteKeys = (platform) => (platform === 'mac' ? '⌘V' : 'Ctrl+V');
// cmd.exe reads its own command line: these end or change it, quoted or not.
const CMD_UNSAFE = /["%^&|<>!\r\n]/;
/**
 * A terminal window of its own. On Windows `start` opens one running
 * `claude <prompt>`, so the chat starts at once; elsewhere, or for a prompt
 * cmd.exe would misread, Claude Code's link opens the person's terminal with
 * the prompt filled in.
 */
export function terminalChat(prompt, root, title, platform) {
    if (platform === 'windows' && !CMD_UNSAFE.test(prompt) && !CMD_UNSAFE.test(title) && title.includes(' ')) {
        // `start` takes its first quoted argument as the window's title; the space gets it quoted.
        return { argv: ['cmd.exe', '/d', '/c', 'start', title, 'claude', prompt], cwd: root, startsAtOnce: true };
    }
    return { argv: openLink(cliLink(prompt, root), platform), startsAtOnce: false };
}

import { describe, expect, test } from 'claude-code/testing';
import { appChat, appLink, clipboardArgv, cliLink, folderName, openLink, pasteKeys, terminalChat } from '../hooks/launch';
const PROMPT = '/mattpocock-skills:wayfinder .scratch/orbit/map.md .scratch/orbit/issues/07-pricing.md';
const ROOT = 'C:\\Users\\me\\orbit';
describe('links', () => {
    test('the desktop app link names no folder, so the app asks no trust question, and carries no prompt', () => {
        const url = new URL(appLink());
        expect(url.protocol).toBe('claude:');
        expect(url.searchParams.has('folder')).toBe(false);
        expect(url.searchParams.has('q')).toBe(false);
    });
    test('a folder is named as the app picker shows it', () => {
        expect(folderName(ROOT)).toBe('orbit');
        expect(folderName('C:\\Users\\Ron\\Desktop\\PM BRIBO\\')).toBe('PM BRIBO');
        expect(folderName('/home/me/orbit')).toBe('orbit');
    });
    test('the terminal link carries the prompt and the working directory', () => {
        const url = new URL(cliLink(PROMPT, ROOT));
        expect(url.protocol).toBe('claude-cli:');
        expect(url.hostname).toBe('open');
        expect(url.searchParams.get('q')).toBe(PROMPT);
        expect(url.searchParams.get('cwd')).toBe(ROOT);
    });
    test('each system opens a link with its own handler', () => {
        expect(openLink('claude://x', 'windows')).toEqual(['rundll32.exe', 'url.dll,FileProtocolHandler', 'claude://x']);
        expect(openLink('claude://x', 'mac')).toEqual(['open', 'claude://x']);
        expect(openLink('claude://x', 'linux')).toEqual(['xdg-open', 'claude://x']);
    });
});
describe('new chats', () => {
    test('in the app: a new, empty session', () => {
        const l = appChat('windows');
        expect(l.startsAtOnce).toBe(false);
        expect(l.argv).toEqual(['rundll32.exe', 'url.dll,FileProtocolHandler', 'claude://code/new']);
    });
    test('in a terminal on Windows: a window of its own running claude on the prompt', () => {
        expect(terminalChat(PROMPT, ROOT, 'Wayfinder 07', 'windows')).toEqual({
            argv: ['cmd.exe', '/d', '/c', 'start', 'Wayfinder 07', 'claude', PROMPT],
            cwd: ROOT,
            startsAtOnce: true,
        });
    });
    test('a prompt cmd.exe would misread goes through the link instead', () => {
        const l = terminalChat('/implement a & b', ROOT, 'Wayfinder 07', 'windows');
        expect(l.startsAtOnce).toBe(false);
        expect(l.argv[0]).toBe('rundll32.exe');
        expect(new URL(l.argv[2]).searchParams.get('q')).toBe('/implement a & b');
    });
    test('elsewhere the terminal link opens the person\'s terminal', () => {
        const l = terminalChat(PROMPT, '/home/me/orbit', 'Wayfinder 07', 'mac');
        expect(l.argv[0]).toBe('open');
        expect(l.argv[1]).toBe(cliLink(PROMPT, '/home/me/orbit'));
    });
});
describe('the clipboard', () => {
    test("each system's own tool, reading stdin", () => {
        expect(clipboardArgv('windows')).toEqual(['clip.exe']);
        expect(clipboardArgv('mac')).toEqual(['pbcopy']);
        expect(clipboardArgv('linux')[0]).toBe('sh');
    });
    test('the paste keys as the keyboard spells them', () => {
        expect(pasteKeys('windows')).toBe('Ctrl+V');
        expect(pasteKeys('mac')).toBe('⌘V');
    });
});

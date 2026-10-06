import { describe, expect, test } from 'claude-code/testing'

import { appChat, appLink, cliLink, handoffText, handoffToken, openLink, terminalChat } from '../hooks/launch'

const PROMPT = '/mattpocock-skills:wayfinder .scratch/orbit/map.md .scratch/orbit/issues/07-pricing.md'
const ROOT = 'C:\\Users\\me\\orbit'

describe('links', () => {
  test('the desktop app link carries the prompt and the folder, encoded', () => {
    const url = new URL(appLink(PROMPT, ROOT))
    expect(url.protocol).toBe('claude:')
    expect(url.searchParams.get('q')).toBe(PROMPT)
    expect(url.searchParams.get('folder')).toBe(ROOT)
  })

  test('the terminal link carries the prompt and the working directory', () => {
    const url = new URL(cliLink(PROMPT, ROOT))
    expect(url.protocol).toBe('claude-cli:')
    expect(url.hostname).toBe('open')
    expect(url.searchParams.get('q')).toBe(PROMPT)
    expect(url.searchParams.get('cwd')).toBe(ROOT)
  })

  test('each system opens a link with its own handler', () => {
    expect(openLink('claude://x', 'windows')).toEqual(['rundll32.exe', 'url.dll,FileProtocolHandler', 'claude://x'])
    expect(openLink('claude://x', 'mac')).toEqual(['open', 'claude://x'])
    expect(openLink('claude://x', 'linux')).toEqual(['xdg-open', 'claude://x'])
  })
})

describe('handoff text', () => {
  test('plain words and a token, with no slash for the app to neuter', () => {
    const text = handoffText('work ticket 24 (Sync docs) of Cruxel', 'a1b2c3d4')
    expect(text).toBe('Wayfinder: work ticket 24 (Sync docs) of Cruxel [wf-a1b2c3d4]')
    expect(handoffToken(text)).toBe('a1b2c3d4')
    expect(handoffToken('/mattpocock-skills:wayfinder map.md')).toBeNull()
  })
})

describe('new chats', () => {
  test('in the app: a new session with the prompt filled in', () => {
    const l = appChat(PROMPT, ROOT, 'windows')
    expect(l.startsAtOnce).toBe(false)
    expect(l.argv[2]).toBe(appLink(PROMPT, ROOT))
  })

  test('in a terminal on Windows: a window of its own running claude on the prompt', () => {
    expect(terminalChat(PROMPT, ROOT, 'Wayfinder 07', 'windows')).toEqual({
      argv: ['cmd.exe', '/d', '/c', 'start', 'Wayfinder 07', 'claude', PROMPT],
      cwd: ROOT,
      startsAtOnce: true,
    })
  })

  test('a prompt cmd.exe would misread goes through the link instead', () => {
    const l = terminalChat('/implement a & b', ROOT, 'Wayfinder 07', 'windows')
    expect(l.startsAtOnce).toBe(false)
    expect(l.argv[0]).toBe('rundll32.exe')
    expect(new URL(l.argv[2]!).searchParams.get('q')).toBe('/implement a & b')
  })

  test('elsewhere the terminal link opens the person\'s terminal', () => {
    const l = terminalChat(PROMPT, '/home/me/orbit', 'Wayfinder 07', 'mac')
    expect(l.argv[0]).toBe('open')
    expect(l.argv[1]).toBe(cliLink(PROMPT, '/home/me/orbit'))
  })
})

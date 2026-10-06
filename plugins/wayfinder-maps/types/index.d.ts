/** A ticket's state, folded from whatever its tracker writes. */
export type WfStatus = 'done' | 'claimed' | 'waiting' | 'blocked' | 'open' | 'dropped'

export type WfTicket = {
  id: string
  num: number
  /** How a prompt names it: `07` for a file, `#42` for an issue. */
  ref: string
  title: string
  rawStatus: string
  status: WfStatus
  /** Open, unblocked and unclaimed: takeable now. */
  isFrontier: boolean
  type?: string
  assignee?: string
  blockedBy: number[]
  path?: string
  url?: string
}

export type WfMapStatus = 'open' | 'active' | 'done' | 'graduated'

export type WfMap = {
  id: string
  /** `map` is a wayfinder map of decision tickets; `spec` a graduated spec of implementation tickets. */
  kind: 'map' | 'spec'
  source: 'md' | 'github'
  title: string
  /** How a prompt names it: a relative path or `#12`. */
  ref: string
  /** Folder (md) relative to the project root. */
  dir?: string
  path?: string
  url?: string
  status: WfMapStatus
  tickets: WfTicket[]
}

export type WfData = {
  root: string
  maps: WfMap[]
  loadedAt: number
  errors: string[]
}

export type WfFilter = 'all' | 'unresolved' | 'frontier' | 'claimed' | 'waiting' | 'blocked' | 'done'

export type WfLayout = 'steps' | 'tree'

export type WfView = {
  mapId: string | null
  /** The ticket shown on a page of its own, or null for the map. */
  ticketId: string | null
  filter: WfFilter
  layout: WfLayout
}

/** The command a Work button copied for a new chat, whether it reached the clipboard, and the paste keys. */
export type WfCopied = { text: string; isCopied: boolean; keys: string } | null

/** The open ticket body as the drawer shows it, and the file links in it. */
export type WfDetail = { id: string; body: string; links: { href: string; path: string }[] } | null

declare module 'claude-code' {
  interface PluginState {
    'wayfinder-maps': {
      data: WfData | null
      isLoading: boolean
      isPaneOpen: boolean
      view: WfView
      detail: WfDetail
      /** Tickets a Work button opened a new chat on, by id: when. */
      started: Record<string, number>
      copied: WfCopied
    }
  }
}

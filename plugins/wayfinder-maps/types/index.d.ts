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

export type WfFilter = 'all' | 'unresolved' | 'frontier'

export type WfView = {
  mapId: string | null
  selected: string | null
  filter: WfFilter
}

export type WfDetail = { id: string; body: string } | null

declare module 'claude-code' {
  interface PluginState {
    'wayfinder-maps': {
      data: WfData | null
      isLoading: boolean
      isPaneOpen: boolean
      view: WfView
      detail: WfDetail
    }
  }
}

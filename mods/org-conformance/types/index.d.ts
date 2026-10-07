export type RepoStatus = {
  root: string
  name: string
  branch: string
  isValid: boolean
  reason: string
  hasDevelop: boolean
  dirty: number
  template: string | null
}

export type Conformance = {
  active: RepoStatus | null
  offStandard: number
  total: number
}

declare module 'claude-code' {
  interface PluginState {
    'org-conformance': { status: Conformance | null; isHidden: boolean }
  }
}

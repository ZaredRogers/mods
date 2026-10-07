import type { Register } from 'claude-code'

/**
 * Measured on this workspace: 376 Bash commands pipe a check to `| tail`,
 * which discards the exit code. Of 333 lint runs, ~27% showed violations in
 * their output and only 3 surfaced as errors. This reads the output itself,
 * so a failure cannot pass as a success.
 */
const IS_CHECK =
  /(npm|npx|pnpm|yarn)\s+(run\s+)?(lint|check|test|stan|typecheck)|phpcs|phpcbf|composer\s+(check|stan|test|lint)|php\s+-l\b|stylelint|eslint|playwright\s+test|phpunit|tsc\b|node\s+--check/

type Rule = { pattern: RegExp; label: string; isCounted: boolean }

const RULES: Rule[] = [
  { pattern: /FOUND\s+(\d+)\s+ERROR/i, label: 'phpcs error', isCounted: true },
  { pattern: /\b(\d+)\s+problems?\b/i, label: 'lint problem', isCounted: true },
  { pattern: /✖\s*(\d+)/, label: 'lint problem', isCounted: true },
  { pattern: /Found\s+(\d+)\s+errors?/i, label: 'error', isCounted: true },
  { pattern: /\b(\d+)\s+(?:tests?\s+)?failed\b/i, label: 'failure', isCounted: true },
  { pattern: /\[ERROR\]/, label: 'reported error', isCounted: false },
  { pattern: /(?:PHP\s+)?(?:Parse|Fatal)\s+error/i, label: 'PHP fatal', isCounted: false },
  { pattern: /npm\s+(?:ERR!|error)\s/i, label: 'npm error', isCounted: false },
  { pattern: /database is locked/i, label: 'SQLite lock', isCounted: false },
  { pattern: /Errors parsing/i, label: 'parse error', isCounted: false },
]

/** Returns a short label when the output shows a real violation. */
function scan(text: string): string | null {
  for (const rule of RULES) {
    const hit = rule.pattern.exec(text)
    if (!hit) continue
    if (!rule.isCounted) return rule.label
    const count = Number(hit[1])
    if (Number.isFinite(count) && count > 0) {
      return `${count} ${rule.label}${count === 1 ? '' : 's'}`
    }
  }
  return null
}

export const register: Register = on => {
  /** This turn's failures, for the VS Code panel, which draws no toast. */
  let pending: string[] = []

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) pending = []
    return next(e)
  })

  /**
   * The panel draws only the AskUserQuestion dialog. Asking mid-turn would
   * pause the model, so the turn's failures are asked about once it ends.
   */
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId || pending.length === 0) return r
    const failures = pending
    pending = []
    if (!(await $.session.surfaces()).includes('vscode')) return r

    void $.ui
      .ask(`verify-gate: checks failed this turn: ${failures.join('; ')}. Ask Claude to fix them?`, {
        header: 'Checks',
        options: ['Ask Claude to fix them', 'Dismiss'],
      })
      .then(pick =>
        pick === 'Ask Claude to fix them'
          ? $.prompt.submit({ text: `verify-gate read these failures in check output this turn: ${failures.join('; ')}. Fix them and re-run the checks without piping the output through tail.` })
          : undefined,
      )
      .catch(() => {})

    return r
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!IS_CHECK.test(e.command)) return ran

    const said = scan(JSON.stringify(ran).slice(0, 20000))
    if (said === null) {
      $.ui.status(undefined)
      return ran
    }

    const isSilent = ran.deny === undefined && ran.isError !== true
    const how = isSilent ? ' (exit 0 — this would have passed unnoticed)' : ''
    $.ui.toast(`verify-gate: ${said}${how}`)
    $.ui.status(`check failed: ${said}`)
    pending.push(`${said}${how} in \`${e.command.slice(0, 80)}\``)

    return ran
  })
}

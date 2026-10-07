import type { Register } from 'claude-code'

/**
 * Measured on this workspace: 376 Bash commands pipe a check to `| tail`,
 * which discards the exit code. Of 333 lint runs, ~27% showed violations in
 * their output and only 3 surfaced as errors. This reads the output itself,
 * so a failure cannot pass as a success.
 */
const IS_CHECK =
  /(npm|npx|pnpm|yarn)\s+(run\s+)?(lint|check|test|stan|typecheck)|phpcs|phpcbf|composer\s+(check|stan|test|lint)|php\s+-l\b|stylelint|eslint|playwright\s+test|phpunit|tsc\b|node\s+--check|claude\s+plugin\s+(test|validate)|bun\s+test/

type Rule = { pattern: RegExp; label: string; isCounted: boolean }

const RULES: Rule[] = [
  { pattern: /FOUND\s+(\d+)\s+ERROR/i, label: 'phpcs error', isCounted: true },
  { pattern: /\b(\d+)\s+problems?\b/i, label: 'lint problem', isCounted: true },
  { pattern: /✖\s*(\d+)/, label: 'lint problem', isCounted: true },
  { pattern: /Found\s+(\d+)\s+errors?/i, label: 'error', isCounted: true },
  { pattern: /\b(\d+)\s+(?:tests?\s+)?failed\b/i, label: 'failure', isCounted: true },
  { pattern: /\b(\d+)\s+fail\b/, label: 'test failure', isCounted: true },
  { pattern: /\(fail\)\s/, label: 'test failure', isCounted: false },
  { pattern: /\[ERROR\]/, label: 'reported error', isCounted: false },
  { pattern: /(?:PHP\s+)?(?:Parse|Fatal)\s+error/i, label: 'PHP fatal', isCounted: false },
  { pattern: /npm\s+(?:ERR!|error)\s/i, label: 'npm error', isCounted: false },
  { pattern: /database is locked/i, label: 'SQLite lock', isCounted: false },
  { pattern: /Errors parsing/i, label: 'parse error', isCounted: false },
]

/**
 * npm's own errors when the check's tool is not installed: npx refusing to
 * download it, or finding no binary. The check never ran, so nothing failed;
 * the `npm error` rule stands down while one of these is in the output.
 */
const TOOL_MISSING = /npx canceled due to missing packages|could not determine executable to run/i

/**
 * The model the fix request runs on. `$.prompt.submit` takes no model, so the
 * fix goes to a subagent pinned to this one. Sonnet is model-policy's cap
 * for a "fix" task; a higher pin would be refused there.
 */
const FIX_MODEL = 'sonnet'

/** Returns a short label when the output shows a real violation. */
function scan(text: string): string | null {
  const isToolMissing = TOOL_MISSING.test(text)
  for (const rule of RULES) {
    if (isToolMissing && rule.label === 'npm error') continue
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

/**
 * True in the VS Code chat panel, which draws no band, toast or status line.
 * Measured on 2.1.292: the panel reports no surface at all (`surfaces()` is
 * empty), so its process's entrypoint is what says it is the panel.
 */
async function isPanel($: any): Promise<boolean> {
  const surfaces = await $.session.surfaces()
  if (surfaces.includes('vscode')) return true
  return surfaces.length === 0 && (await $.env.get('CLAUDE_CODE_ENTRYPOINT')) === 'claude-vscode'
}

export const register: Register = on => {
  /** This turn's failures, for the VS Code panel, which draws no toast. */
  let pending: string[] = []
  /** The fix subagent's id, while it runs, so its answer can be relayed. */
  let fixerId: string | undefined

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
    if (e.agentId && e.agentId === fixerId) {
      fixerId = undefined
      void $.prompt
        .submit({ text: `verify-gate's fix subagent (${FIX_MODEL}) finished. Its report:\n\n${e.answer ?? ''}\n\nRelay this to the person. Do not redo the fix.` })
        .catch(() => {})
      return r
    }
    if (e.agentId || pending.length === 0) return r
    const failures = pending
    pending = []
    if (!(await isPanel($))) return r

    void $.ui
      .ask(`verify-gate: checks failed this turn: ${failures.join('; ')}. Ask Claude to fix them?`, {
        header: 'Checks',
        options: ['Ask Claude to fix them', 'Dismiss'],
      })
      .then(async pick => {
        if (pick !== 'Ask Claude to fix them') return
        const spawned = await $.agent.spawn({
          description: 'Fix failed checks',
          subagentType: 'general-purpose',
          model: FIX_MODEL,
          prompt: `verify-gate read these failures in check output: ${failures.join('; ')}. Fix them and re-run the checks without piping the output through tail. Report what you changed and the re-run's result.`,
        })
        if (spawned.deny !== undefined) {
          await $.prompt.submit({ text: `verify-gate could not start its ${FIX_MODEL} fix subagent: ${spawned.deny}. Tell the person; do not fix the checks yourself.` })
          return
        }
        fixerId = spawned.agentId
      })
      .catch(() => {})

    return r
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!IS_CHECK.test(e.command)) return ran

    // Only what the model reads. The whole record also carries `bashEditDiff`,
    // the contents of every file the command changed, so a heredoc that writes
    // `FOUND 3 ERRORS` into a test fixture read as a phpcs failure.
    const out = ran.text ?? (ran.result ? `${ran.result.stdout}\n${ran.result.stderr}` : '')
    const said = scan(out.slice(0, 20000))
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

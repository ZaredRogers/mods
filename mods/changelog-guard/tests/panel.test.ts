import { describe, expect, mock, test } from 'claude-code/testing'

const RULES = JSON.stringify({ rules: [{ rule_id: 'CHK_MAX_LENGTH', validation_logic: 'length(content) <= 250' }] })
const EMPTY = '# Changelog\n\n## [Unreleased]\n'
const BODY = '# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Fixed the tour card spacing on mobile\n'

const wait = () => new Promise(done => (globalThis as any).setTimeout(done, 10))
const sh = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false, stream: 'stdout' as const, text: '' },
})

// The engine beneath the mod, on `surface`; `pick` is the person's answer to the dialog.
function engine(on: any, surface: string, pick: string) {
  const asked: string[] = []
  const sent: string[] = []
  let reads = 0
  mock.env(on, { HOME: '/home/test', CLAUDE_CODE_ENTRYPOINT: surface === 'panel' ? 'claude-vscode' : 'cli' })
  on('session.surfaces', () => ({ value: surface === 'panel' ? [] : [surface] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_$: any, e: any) => (sent.push(e.text), { text: '' }))
  on('process.run', (_$: any, e: any) => {
    const argv = [...e.argv].join(' ')
    if (argv.includes('rules.json')) return sh(RULES)
    if (argv.includes('CHANGELOG.md')) return sh(++reads === 1 ? EMPTY : BODY)
    return sh('')
  })
  on('tool.call', (_$: any, e: any) => {
    if (e.tool !== 'AskUserQuestion') return { result: { ok: true } }
    asked.push(e.questions[0].question)
    return { result: { questions: e.questions, answers: { [e.questions[0].question]: pick } } }
  })
  return { asked, sent }
}

async function turnWithIssue($: any) {
  await $.turn.start({ text: 'log it', turnId: 't1' })
  await $.tool.call({ tool: 'Write', file_path: 'CHANGELOG.md', content: BODY })
  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' })
  await wait()
}

describe('changelog-guard in the VS Code panel', () => {
  test('asks once at the end of the turn and sends the fix request on yes', async ($, on) => {
    const { asked, sent } = engine(on, 'panel', 'Ask Claude to fix them')
    await turnWithIssue($)
    expect(asked.length).toBe(1)
    expect(asked[0]).toContain('would block the merge')
    expect(sent.length).toBe(1)
  })

  test('never asks in the terminal, where the toast draws', async ($, on) => {
    const { asked } = engine(on, 'terminal', 'Ask Claude to fix them')
    await turnWithIssue($)
    expect(asked.length).toBe(0)
  })
})

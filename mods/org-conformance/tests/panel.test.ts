import { describe, expect, mock, test } from 'claude-code/testing'

const VERDICT = /^(feat|fix|chore|docs)\/[a-z0-9]+(-[a-z0-9]+)+$/
const wait = () => new Promise(done => (globalThis as any).setTimeout(done, 10))
const run = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: exitCode === 0 ? '' : 'Invalid branch name: expected {type}/{scope}-{title}', isStdoutTruncated: false, isStderrTruncated: false, stream: 'stdout' as const, text: '' },
})

// A workspace like SD's: the root is no repo; the theme and an upstream clone are.
function engine(on: any, surface: string, branches: Record<string, string>) {
  const asked: string[] = []
  mock.env(on, { HOME: '/home/test', CLAUDE_CODE_ENTRYPOINT: surface === 'panel' ? 'claude-vscode' : 'cli' })
  mock.clock(on, { now: 100000 })
  on('session.root', () => ({ value: '/work' }))
  on('session.surfaces', () => ({ value: surface === 'panel' ? [] : [surface] }))
  on('turn.complete', () => ({ text: '' }))
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = [...e.argv]
    const line = argv.join(' ')
    if (line.includes('validate-branch-name')) return run('', VERDICT.test(argv[argv.length - 1]) ? 0 : 1)
    if (line.includes('find ')) return run('/work/agent-skills/.git\n/work/theme/.git\n')
    const repo = argv[0] === 'git' ? argv[2] : ''
    if (line.includes('--show-toplevel')) return run('', 1)
    if (line.includes('--abbrev-ref')) return run(`${branches[repo] ?? ''}\n`)
    return run('')
  })
  on('tool.call', (_$: any, e: any) => {
    if (e.tool !== 'AskUserQuestion') return { result: { stdout: '', stderr: '' } }
    asked.push(e.questions[0].question)
    return { result: { questions: e.questions, answers: { [e.questions[0].question]: 'Keep warning me' } } }
  })
  return { asked }
}

const endTurn = async ($: any, turnId: string) => {
  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId })
  await wait()
}

describe('org-conformance in the VS Code panel', () => {
  test('warns once about an off-standard repo, ignoring the upstream clone', async ($, on) => {
    const { asked } = engine(on, 'panel', { '/work/theme': 'fixes', '/work/agent-skills': 'trunk' })
    await endTurn($, 't1')
    await endTurn($, 't2')
    expect(asked.length).toBe(1)
    expect(asked[0]).toContain('theme')
    expect(asked[0]).toContain('"fixes"')
    expect(asked[0]).not.toContain('agent-skills')
  })

  test('stays quiet when the repo conforms', async ($, on) => {
    const { asked } = engine(on, 'panel', { '/work/theme': 'feat/theme-404', '/work/agent-skills': 'trunk' })
    await endTurn($, 't1')
    expect(asked.length).toBe(0)
  })

  test('never asks in the terminal, where the band draws', async ($, on) => {
    const { asked } = engine(on, 'terminal', { '/work/theme': 'fixes' })
    await endTurn($, 't1')
    expect(asked.length).toBe(0)
  })
})

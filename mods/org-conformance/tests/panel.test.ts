import { describe, expect, mock, test } from 'claude-code/testing'

const VERDICT = /^(feat|fix|chore|docs)\/[a-z0-9]+(-[a-z0-9]+)+$/
const wait = () => new Promise(done => (globalThis as any).setTimeout(done, 10))
const run = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: exitCode === 0 ? '' : 'Invalid branch name: expected {type}/{scope}-{title}', isStdoutTruncated: false, isStderrTruncated: false, stream: 'stdout' as const, text: '' },
})

// A workspace like SD's: the root is no repo; the theme and an upstream clone are.
// `answers` are what the person picks in each dialog, in order; free text is "Other".
// `names` are Haiku's replies to successive descriptions.
function engine(on: any, surface: string, branches: Record<string, string>, answers: string[] = [], names: string[] = []) {
  const asked: string[] = []
  const cuts: string[] = []
  mock.env(on, { HOME: '/home/test', CLAUDE_CODE_ENTRYPOINT: surface === 'panel' ? 'claude-vscode' : 'cli' })
  mock.clock(on, { now: 100000 })
  on('session.root', () => ({ value: '/work' }))
  on('session.surfaces', () => ({ value: surface === 'panel' ? [] : [surface] }))
  on('turn.complete', () => ({ text: '' }))
  on('model.complete', () => ({
    value: { isAnswered: true, text: names.shift() ?? 'feat/theme-404-template', usage: { input_tokens: 1, output_tokens: 1 } },
  }))
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = [...e.argv]
    const line = argv.join(' ')
    if (line.includes('checkout -b')) cuts.push(argv[argv.indexOf('-b') + 1])
    if (line.includes('validate-branch-name')) return run('', VERDICT.test(argv[argv.length - 1]) ? 0 : 1)
    if (line.includes('find ')) return run('/work/agent-skills/.git\n/work/plugin/.git\n/work/to-specials/.git\n/work/theme/.git\n')
    const repo = argv[0] === 'git' ? argv[2] : ''
    if (line.includes('--show-toplevel')) {
      // repoAt: `cd "<dir>" && git rev-parse --show-toplevel`
      const dir = /cd "([^"]+)"/.exec(line)?.[1] ?? ''
      const repo = Object.keys(branches).find(r => dir === r || dir.startsWith(`${r}/`))
      return repo ? run(`${repo}\n`) : run('', 1)
    }
    if (line.includes('--abbrev-ref')) return run(`${branches[repo] ?? ''}\n`)
    return run('')
  })
  on('tool.call', (_$: any, e: any) => {
    if (e.tool !== 'AskUserQuestion') return { result: { stdout: '', stderr: '' } }
    asked.push(e.questions[0].question)
    const answer = answers.shift() ?? 'Keep warning me'
    return { result: { questions: e.questions, answers: { [e.questions[0].question]: answer } } }
  })
  return { asked, cuts }
}

const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })

const endTurn = async ($: any, turnId: string) => {
  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId })
  await wait()
}

describe('org-conformance in the VS Code panel', () => {
  test('warns once about an off-standard repo, ignoring the upstream clone', async ($, on) => {
    const { asked } = engine(on, 'panel', { '/work/theme': 'fixes', '/work/agent-skills': 'trunk' })
    await bash($, 'cd /work/theme && git status')
    await endTurn($, 't1')
    await endTurn($, 't2')
    expect(asked.length).toBe(1)
    expect(asked[0]).toContain('theme')
    expect(asked[0]).toContain('"fixes"')
    expect(asked[0]).not.toContain('agent-skills')
  })

  test('stays quiet when the repo conforms', async ($, on) => {
    const { asked } = engine(on, 'panel', { '/work/theme': 'feat/theme-404', '/work/agent-skills': 'trunk' })
    await bash($, 'git -C /work/theme status')
    await endTurn($, 't1')
    expect(asked.length).toBe(0)
  })

  test('never asks in the terminal, where the band draws', async ($, on) => {
    const { asked } = engine(on, 'terminal', { '/work/theme': 'fixes' })
    await bash($, 'cd /work/theme && git status')
    await endTurn($, 't1')
    expect(asked.length).toBe(0)
  })

  test('never warns about a repo the session did not touch', async ($, on) => {
    // The bug: an off-standard repo first in the scan was warned about unasked.
    const { asked } = engine(on, 'panel', { '/work/to-specials': 'master', '/work/theme': 'feat/theme-404' })
    await endTurn($, 't1')
    expect(asked.length).toBe(0)
  })

  test('follows the theme through a relative path and a file edit', async ($, on) => {
    const { asked } = engine(on, 'panel', { '/work/to-specials': 'master', '/work/theme': 'fixes' })
    await bash($, 'git -C theme log -1')
    await endTurn($, 't1')
    expect(asked.length).toBe(1)
    expect(asked[0]).toContain('theme')
    expect(asked[0]).not.toContain('to-specials')
  })

  test('a file edit puts its repo in focus', async ($, on) => {
    const { asked } = engine(on, 'panel', { '/work/to-specials': 'master', '/work/theme': 'fixes' })
    await $.tool.call({ tool: 'Edit', file_path: '/work/theme/style.css', old_string: 'a', new_string: 'b' })
    await endTurn($, 't1')
    expect(asked.length).toBe(1)
    expect(asked[0]).toContain('theme')
  })

  test('switching repos warns about the new one only, never the one left behind', async ($, on) => {
    const { asked } = engine(on, 'panel', { '/work/theme': 'fixes', '/work/plugin': 'wip' })
    await bash($, 'cd /work/theme && git status')
    await endTurn($, 't1')
    await bash($, 'cd /work/plugin && git status')
    await endTurn($, 't2')
    await endTurn($, 't3')
    expect(asked.length).toBe(2)
    expect(asked[0]).toContain('"fixes"')
    expect(asked[1]).toContain('plugin')
    expect(asked[1]).not.toContain('theme')
  })

  test('a description typed under Other cuts a conformant branch from develop', async ($, on) => {
    const { asked, cuts } = engine(on, 'panel', { '/work/theme': 'fixes' }, ['404 template for the theme', 'Keep warning me'])
    await bash($, 'cd /work/theme && git status')
    await endTurn($, 't1')
    expect(asked[0]).toContain('under Other')
    expect(cuts).toEqual(['feat/theme-404-template'])
    expect(asked.length).toBe(2)
    expect(asked[1]).toContain('Created "feat/theme-404-template" from develop')
  })

  test('a rejected proposal is reported and can be retried in the same dialog', async ($, on) => {
    const { asked, cuts } = engine(
      on,
      'panel',
      { '/work/theme': 'fixes' },
      ['the 404 page', 'theme 404 template', 'Hide for this session'],
      ['feature/404', 'fix/theme-404-template'],
    )
    await bash($, 'cd /work/theme && git status')
    await endTurn($, 't1')
    expect(asked[1]).toContain('"feature/404" still fails the org standard')
    expect(asked[1]).toContain('try again')
    expect(cuts).toEqual(['fix/theme-404-template'])
    expect(asked[2]).toContain('Created "fix/theme-404-template"')
  })

  test('picking an option never cuts a branch', async ($, on) => {
    const { asked, cuts } = engine(on, 'panel', { '/work/theme': 'fixes' }, ['Hide for this session'])
    await bash($, 'cd /work/theme && git status')
    await endTurn($, 't1')
    expect(asked.length).toBe(1)
    expect(cuts.length).toBe(0)
  })
})

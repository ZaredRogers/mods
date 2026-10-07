import { mock, test, expect } from 'claude-code/testing'

/** Stands in for the org validator at ~/.github: "feat/..." passes, the rest fail. */
const VERDICT = /^(feat|fix|chore|docs|test|refactor|release|a11y|ci|perf|ops)\/[a-z0-9]+(-[a-z0-9]+)+$/

function engine(on: any) {
  mock.env(on, { HOME: '/home/test' })

  on('process.run', ($: any, e: any) => {
    const argv: string[] = [...e.argv]
    const isValidator = argv.some(part => part.includes('validate-branch-name'))
    const ok = isValidator ? VERDICT.test(argv[argv.length - 1]) : true
    return {
      value: {
      exitCode: ok ? 0 : 1,
      stdout: ok ? '' : 'Invalid branch name: expected {type}/{scope}-{title}',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
      stream: 'stdout' as const,
      text: '',
      },
    }
  })

  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }))
}

test('refuses a branch name the org validator rejects', async ($, on) => {
  engine(on)

  const ran = await $.tool.call({
    tool: 'Bash',
    command: 'git checkout -b feature/ls-2017-accommodation-finalisation',
  })

  expect(JSON.stringify(ran)).toContain('fails the org branch standard')
})

test('allows a conformant branch name through', async ($, on) => {
  engine(on)

  const ran = await $.tool.call({
    tool: 'Bash',
    command: 'git checkout -b feat/accommodation-finalisation',
  })

  expect(JSON.stringify(ran)).not.toContain('fails the org branch standard')
})

test('leaves a command that creates no branch alone', async ($, on) => {
  engine(on)

  const ran = await $.tool.call({ tool: 'Bash', command: 'git status --short' })

  expect(JSON.stringify(ran)).not.toContain('fails the org branch standard')
})

test('does not mistake a git branch flag for a branch name', async ($, on) => {
  engine(on)

  const ran = await $.tool.call({ tool: 'Bash', command: 'git branch --format=%(refname:short)' })

  expect(JSON.stringify(ran)).not.toContain('fails the org branch standard')
})

import { mock, test, expect } from 'claude-code/testing'

const TYPE_MAP = `branch_types:
  feat:
    template: pr_feature
  test:
    template: pr_test
`

const TEMPLATE = `---
name: "Test"
title: "test: {scope} - {short description}"
---

# Test Pull Request

## Linked issues

Closes #

## Test Coverage

## Testing Strategy
`

/** A repo at /repo on "test/sd-qa-harness", with the org files at /home/test/.github. */
function engine(on: any, files: Record<string, string> = {}) {
  const written: Record<string, string> = {}
  mock.env(on, { HOME: '/home/test', TMPDIR: '/scratch/' })

  on('session.root', () => ({ value: '/repo' }))

  on('process.run', ($: any, e: any) => {
    const argv: string[] = [...e.argv]
    const joined = argv.join(' ')
    let stdout = ''
    if (joined.includes('branch-types.yml')) stdout = TYPE_MAP
    else if (joined.includes('pr_test.md')) stdout = TEMPLATE
    else if (joined.includes('--abbrev-ref')) stdout = 'test/sd-qa-harness\n'
    else if (joined.includes('show-toplevel')) stdout = '/repo\n'
    return {
      value: {
        exitCode: 0,
        stdout,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
        stream: 'stdout' as const,
        text: '',
      },
    }
  })

  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: '## Linked issues\n\nCloses #\n\n## Test Coverage\n\n## Testing Strategy\n',
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  }))

  on('fs.read', ($: any, e: any) =>
    e.path in files ? { value: files[e.path] } : { error: new Error('ENOENT') },
  )
  on('fs.write', ($: any, e: any) => {
    written[e.path] = e.text
    return { value: undefined }
  })

  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }))
  return written
}

test('refuses a PR with the wrong title and no template body, and leaves a filled draft', async ($, on) => {
  const written = engine(on)

  const ran = await $.tool.call({
    tool: 'Bash',
    command: 'cd /repo && gh pr create --base develop --title "QA harness" --body "Adds tests."',
  })

  const said = JSON.stringify(ran)
  expect(said).toContain('does not follow the org template')
  expect(said).toContain('pr_test.md')
  expect(said).toContain('does not start with')
  expect(said).toContain('missing 3')
  expect(Object.keys(written)[0]).toContain('/scratch/org-conformance/pr-repo-test-sd-qa-harness.md')
})

test('lets a PR through that keeps the template title and headings inline', async ($, on) => {
  engine(on)

  const ran = await $.tool.call({
    tool: 'Bash',
    command: `cd /repo && gh pr create --base develop --title "test: theme - QA harness" --body "$(cat <<'EOF'\n## Linked issues\n\nCloses #36\n\n## Test Coverage\n\n## Testing Strategy\nEOF\n)"`,
  })

  expect(JSON.stringify(ran)).not.toContain('does not follow the org template')
})

test('reads the body from --body-file', async ($, on) => {
  engine(on, {
    '/repo/body.md': '## Linked issues\n\nCloses #36\n\n## Test Coverage\n\n## Testing Strategy\n',
  })

  const ran = await $.tool.call({
    tool: 'Bash',
    command: 'cd /repo && gh pr create -t "test: theme - QA harness" -F body.md',
  })

  expect(JSON.stringify(ran)).not.toContain('does not follow the org template')
})

test('leaves other gh commands alone', async ($, on) => {
  engine(on)

  const ran = await $.tool.call({ tool: 'Bash', command: 'gh pr view 47' })

  expect(JSON.stringify(ran)).not.toContain('org-conformance')
})

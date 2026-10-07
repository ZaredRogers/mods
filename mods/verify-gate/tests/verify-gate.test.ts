import { test, expect } from 'claude-code/testing'

function engine(on: any, stdout: string, isError = false) {
  const said: string[] = []
  on('ui.toast', ($: any, e: any) => (said.push(e.text), { value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => (isError
    ? { result: { stdout }, isError: true as const, text: stdout }
    : { result: { stdout }, text: stdout }))
  return said
}

test('catches phpcs errors that exited 0 behind a tail pipe', async ($, on) => {
  const said = engine(on, 'FOUND 3 ERRORS AFFECTING 2 LINES')
  await $.tool.call({ tool: 'Bash', command: 'phpcs --standard=WordPress inc/ | tail -5' })

  expect(said.join(' ')).toContain('3 phpcs errors')
  expect(said.join(' ')).toContain('exit 0')
})

test('stays quiet when the check is clean', async ($, on) => {
  const said = engine(on, 'FOUND 0 ERRORS\n[OK] No errors')
  await $.tool.call({ tool: 'Bash', command: 'composer check 2>&1 | tail -3' })

  expect(said.length).toBe(0)
})

test('ignores output from a command that is not a check', async ($, on) => {
  const said = engine(on, '12 problems found in the article')
  await $.tool.call({ tool: 'Bash', command: 'cat notes.md' })

  expect(said.length).toBe(0)
})

test('catches a stylelint failure count', async ($, on) => {
  const said = engine(on, '✖ 7 problems (7 errors, 0 warnings)')
  await $.tool.call({ tool: 'Bash', command: 'npm run lint:css 2>&1 | tail -5' })

  expect(said.join(' ')).toContain('7 lint problems')
})

test('a check whose tool is not installed is not a failure', async ($, on) => {
  const said = engine(on, 'npm error npx canceled due to missing packages and no YES option: ["tsc@2.0.4"]')
  await $.tool.call({ tool: 'Bash', command: 'npx --no-install tsc -v 2>&1 | head -1' })

  expect(said.length).toBe(0)
})

test('still catches a real npm error', async ($, on) => {
  const said = engine(on, 'npm error code ELIFECYCLE\nnpm error command failed')
  await $.tool.call({ tool: 'Bash', command: 'npm run test' })

  expect(said.join(' ')).toContain('npm error')
})

test('catches a bun-style (fail) line behind a grep', async ($, on) => {
  const said = engine(on, '(pass) one [1ms]\n(fail) two [2ms]\n  AssertionError')
  await $.tool.call({ tool: 'Bash', command: 'claude plugin test . 2>&1 | grep -A10 "(fail)"' })

  expect(said.join(' ')).toContain('test failure')
})

test('reads a bun summary of zero failures as a pass', async ($, on) => {
  const said = engine(on, ' 10 pass\n 0 fail\nRan 10 tests')
  await $.tool.call({ tool: 'Bash', command: 'claude plugin test .' })

  expect(said.length).toBe(0)
})

test('ignores the contents of files the command edited', async ($, on) => {
  const said: string[] = []
  on('ui.toast', (_$: any, e: any) => (said.push(e.text), { value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({
    result: {
      stdout: 'wrote tests',
      stderr: '',
      interrupted: false,
      bashEditDiff: { files: [{ filePath: 'tests/a.test.ts', hunks: [{ lines: ["+  const stdout = 'FOUND 3 ERRORS'", '+| `[ERROR]` | PHP Fatal error |'] }] }] },
    },
    text: 'wrote tests',
  }))
  await $.tool.call({ tool: 'Bash', command: "python3 - <<'EOF'\n# phpcs fixture\nEOF" })

  expect(said.length).toBe(0)
})

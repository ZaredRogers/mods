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

import { test, expect } from 'claude-code/testing'

const pass = (on: any) => on('tool.call', () => ({ result: { ok: true } }))

test('pins the first browser server and refuses the second', async ($, on) => {
  pass(on)

  const first = await $.tool.call({ tool: 'mcp__playwright__browser_navigate', url: 'http://x' })
  expect(JSON.stringify(first)).not.toContain('browser-arbiter')

  const second = await $.tool.call({ tool: 'mcp__chrome-devtools__navigate_page', url: 'http://x' })
  expect(JSON.stringify(second)).toContain('Browser is already in use')
})

test('lets repeated calls to the pinned server through', async ($, on) => {
  pass(on)

  await $.tool.call({ tool: 'mcp__playwright__browser_navigate', url: 'http://x' })
  const again = await $.tool.call({ tool: 'mcp__playwright__browser_take_screenshot' })

  expect(JSON.stringify(again)).not.toContain('browser-arbiter')
})

test('ignores tools that are not browser tools', async ($, on) => {
  pass(on)

  const ran = await $.tool.call({ tool: 'Bash', command: 'echo hi' })

  expect(JSON.stringify(ran)).not.toContain('browser-arbiter')
})

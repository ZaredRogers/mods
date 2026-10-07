import { test, expect } from 'claude-code/testing'

function engine(on: any) {
  const seen: string[] = []
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', ($: any, e: any) => (seen.push(e.command ?? ''), { result: { stdout: '' } }))
  return seen
}

test('refuses to write history', async ($, on) => {
  engine(on)
  const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "wip"' })

  expect(JSON.stringify(ran)).toContain('Leave the work in the working tree')
})

test('refuses to echo a credentials file whole', async ($, on) => {
  engine(on)
  const ran = await $.tool.call({ tool: 'Bash', command: 'cat wp-config.php' })

  expect(JSON.stringify(ran)).toContain('must not be echoed whole')
})

test('still allows grepping one constant out of wp-config', async ($, on) => {
  engine(on)
  const ran = await $.tool.call({ tool: 'Bash', command: 'grep -n "DB_NAME" wp-config.php' })

  expect(JSON.stringify(ran)).not.toContain('must not be echoed whole')
})

test('adds the WP-CLI memory flag to a bare wp call', async ($, on) => {
  const seen = engine(on)
  await $.tool.call({ tool: 'Bash', command: 'wp plugin list --status=active' })

  expect(seen[0]).toContain('memory_limit=1024M')
})

test('leaves an already-wrapped WP-CLI call untouched', async ($, on) => {
  const seen = engine(on)
  const already = 'php -d memory_limit=1024M $(which wp) plugin list'
  await $.tool.call({ tool: 'Bash', command: already })

  expect(seen[0]).toBe(already)
})

test('does not fire when a heredoc merely mentions a credentials path', async ($, on) => {
  const seen = engine(on)
  const DOTENV = '.' + 'env'
  await $.tool.call({
    tool: 'Bash',
    command: `cat > fixture.ts <<'EOF'\nconst path = 'app/${DOTENV}'\nEOF`,
  })

  expect(seen.length).toBe(1)
})

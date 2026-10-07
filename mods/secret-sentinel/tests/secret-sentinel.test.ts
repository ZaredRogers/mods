import { test, expect } from 'claude-code/testing'

const pass = (on: any) => on('tool.call', () => ({ result: { ok: true } }))
const TOKEN = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ'.slice(0, 36)
const DOTENV = '.' + 'env'

test('refuses a GitHub token in a written file', async ($, on) => {
  pass(on)
  const ran = await $.tool.call({
    tool: 'Write',
    file_path: 'inc/config.php',
    content: `<?php\n$token = '${TOKEN}';\n`,
  })

  expect(JSON.stringify(ran)).toContain('GitHub personal access token')
})

test('never echoes the secret it refused', async ($, on) => {
  pass(on)
  const ran = await $.tool.call({
    tool: 'Write',
    file_path: 'inc/config.php',
    content: `<?php\n$token = '${TOKEN}';\n`,
  })

  expect(JSON.stringify(ran)).not.toContain(TOKEN)
})

test('refuses authoring a credentials file at all', async ($, on) => {
  pass(on)
  const ran = await $.tool.call({ tool: 'Write', file_path: `app/${DOTENV}`, content: 'NOPE=1' })

  expect(JSON.stringify(ran)).toContain('credentials file')
})

test('catches a secret written through a Bash heredoc', async ($, on) => {
  pass(on)
  const ran = await $.tool.call({
    tool: 'Bash',
    command: "cat > cfg.php <<'EOF'\n$key = 'AKIAIOSFODNN7EXAMPLE';\nEOF",
  })

  expect(JSON.stringify(ran)).toContain('AWS access key id')
})

test('lets a placeholder value through', async ($, on) => {
  pass(on)
  const ran = await $.tool.call({
    tool: 'Write',
    file_path: 'readme.md',
    content: 'api_key = "your-api-key-here"',
  })

  expect(JSON.stringify(ran)).not.toContain('secret-sentinel')
})

test('leaves ordinary code alone', async ($, on) => {
  pass(on)
  const ran = await $.tool.call({
    tool: 'Write',
    file_path: 'inc/hero.php',
    content: '<?php echo esc_html( $title );',
  })

  expect(JSON.stringify(ran)).not.toContain('secret-sentinel')
})

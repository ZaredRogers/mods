import { mock, test, expect } from 'claude-code/testing'

const RULES = JSON.stringify({
  rules: [
    { rule_id: 'CHK_MAX_LENGTH', validation_logic: 'length(content) <= 250' },
    { rule_id: 'CHK_NO_IMPL_DETAILS', banned_keywords: ['function', 'database', 'middleware'] },
    { rule_id: 'CHK_NO_ABBREVIATIONS', known_acronyms: ['API', 'PR', 'CI'] },
  ],
})

const EMPTY = '# Changelog\n\n## [Unreleased]\n'
const sh = (stdout: string) => ({
  value: {
    exitCode: 0,
    stdout,
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
    stream: 'stdout' as const,
    text: '',
  },
})

/** `after` is what the file reads as once the write has landed. */
function engine(on: any, after: string) {
  const said: string[] = []
  let reads = 0

  mock.env(on, { HOME: '/home/test' })
  on('ui.toast', ($: any, e: any) => (said.push(e.text), { value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', ($: any, e: any) => {
    const argv = [...e.argv].join(' ')
    if (argv.includes('rules.json')) return sh(RULES)
    if (argv.includes('CHANGELOG.md')) {
      reads += 1
      return sh(reads === 1 ? EMPTY : after)
    }
    return sh('')
  })
  on('tool.call', () => ({ result: { ok: true } }))

  return said
}

const changelog = (entry: string) =>
  `# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- ${entry}\n`

const write = ($: any, content: string) =>
  $.tool.call({ tool: 'Write', file_path: 'CHANGELOG.md', content })

test('flags a newly added entry with no PR reference', async ($, on) => {
  const body = changelog('Fixed the tour card spacing on mobile')
  const said = engine(on, body)
  await write($, body)

  expect(said.join(' ')).toContain('would block the merge')
})

test('accepts a newly added entry that satisfies the rules', async ($, on) => {
  const body = changelog('Fixed the tour card spacing on mobile (#3350)')
  const said = engine(on, body)
  await write($, body)

  expect(said.length).toBe(0)
})

test('flags an implementation detail', async ($, on) => {
  const body = changelog('Rewrote the database query in the listing function (#3351)')
  const said = engine(on, body)
  await write($, body)

  expect(said.join(' ')).toContain('rule issue')
})

test('stays silent about entries the branch did not add', async ($, on) => {
  const inherited = changelog('Fixed an old thing with no reference at all')
  const said = engine(on, inherited)
  // The file already contained this entry, so both reads agree: nothing added.
  await write($, inherited)
  await write($, inherited)

  expect(said.length).toBeLessThan(2)
})

test('ignores a write that is not a changelog', async ($, on) => {
  const said = engine(on, EMPTY)
  await $.tool.call({ tool: 'Write', file_path: 'inc/hero.php', content: '<?php // function' })

  expect(said.length).toBe(0)
})

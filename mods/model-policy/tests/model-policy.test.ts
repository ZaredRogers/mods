import { test, expect } from 'claude-code/testing'

/**
 * Stands for the engine: records what model the spawn reached it with.
 * `project` is the project's .claude/model-policy.json text, when it has one.
 */
function engine(on: any, project?: string) {
  const reached: Array<string | undefined> = []
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('fs.read', ($: any, e: any) => {
    if (e.path === '/proj/.claude/model-policy.json') {
      if (project === undefined) throw new Error('ENOENT: no such file')
      return { value: project }
    }
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('agent.spawn', ($: any, e: any) => {
    reached.push(e.model)

    return { model: e.model ?? e.parentModel, agentId: `a${reached.length}` }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notice', () => ({ value: undefined }))

  return reached
}

const spawn = ($: any, args: Record<string, unknown>) =>
  $.agent.spawn({ prompt: 'Do the task.', ...args })

test('refuses an explicit model above the cap and names the one to use', async ($, on) => {
  const reached = engine(on)

  const got = await spawn($, { description: 'Count pattern files', subagentType: 'general-purpose', model: 'opus' })

  expect(String(got.deny)).toContain('caps this kind of task at haiku')
  expect(String(got.deny)).toContain('Retry with model: "haiku"')
  expect(reached.length).toBe(0)
})

test('lets an explicit model at or under the cap through untouched', async ($, on) => {
  const reached = engine(on)

  const got = await spawn($, { description: 'Fix template header', subagentType: 'general-purpose', model: 'haiku' })

  expect(got.deny).toBe(undefined)
  expect(reached).toEqual(['haiku'])
})

test('an agent-type rule wins over the description keywords', async ($, on) => {
  engine(on)

  // "decide" is a precedent keyword, but Explore is capped at haiku.
  const got = await spawn($, { description: 'Decide where hooks live', subagentType: 'Explore', model: 'sonnet' })

  expect(String(got.deny)).toContain('Rule "mechanical"')
})

test('an Escalation line lets an over-cap model through', async ($, on) => {
  const reached = engine(on)

  const got = await spawn($, {
    description: 'Fix template header',
    subagentType: 'general-purpose',
    model: 'opus',
    prompt: 'Do the task.\nEscalation: sonnet already failed twice on the block binding logic.',
  })

  expect(got.deny).toBe(undefined)
  expect(reached).toEqual(['opus'])
})

test('a one-word Escalation line is not evidence', async ($, on) => {
  engine(on)

  const got = await spawn($, {
    description: 'Fix template header',
    subagentType: 'general-purpose',
    model: 'opus',
    prompt: 'Escalation: hard',
  })

  expect(String(got.deny)).toContain('model-policy')
})

test('a model the table cannot rank is left alone', async ($, on) => {
  const reached = engine(on)

  const got = await spawn($, { description: 'Count files', subagentType: 'general-purpose', model: 'some-other-model' })

  expect(got.deny).toBe(undefined)
  expect(reached).toEqual(['some-other-model'])
})

test('/model-policy prints the table', async ($, on) => {
  engine(on)

  const out = await $.command.run({ command: 'model-policy', args: '' })

  expect(JSON.stringify(out)).toContain('| mechanical | haiku |')
})

test('no model named and the parent is over the cap: runs at the cap', async ($, on) => {
  const reached = engine(on)

  const got = await spawn($, { description: 'Inventory theme patterns', subagentType: 'general-purpose' })

  expect(got.deny).toBe(undefined)
  expect(reached).toEqual(['haiku'])
})

test('a project table replaces the shipped one', async ($, on) => {
  const reached = engine(
    on,
    JSON.stringify({ default: 'opus', rules: [{ id: 'cheap', tier: 'haiku', why: 'Project rule.', keywords: ['tidy'] }] }),
  )

  // "Count" would be capped by the shipped table; the project's default is opus.
  const got = await spawn($, { description: 'Count pattern files', subagentType: 'general-purpose', model: 'opus' })
  const tidy = await spawn($, { description: 'Tidy the docs', subagentType: 'general-purpose', model: 'sonnet' })

  expect(got.deny).toBe(undefined)
  expect(reached).toEqual(['opus'])
  expect(String(tidy.deny)).toContain('Rule "cheap"')
})

test('a broken project table falls back to the shipped one', async ($, on) => {
  engine(on, '{ not json')

  const got = await spawn($, { description: 'Count pattern files', subagentType: 'general-purpose', model: 'opus' })

  expect(String(got.deny)).toContain('Rule "mechanical"')
})

import { describe, expect, mock, test } from 'claude-code/testing'

const ANSWER = 'I wrote tests for the login form and they pass locally.'
const REPLY = 'Run the tests you just wrote\nDo the same for settings\nOpen a draft PR'

const wait = () => new Promise(done => (globalThis as any).setTimeout(done, 10))

// The engine beneath the mod; `pick` is what the person chooses in the dialog.
function engine(on: any, pick: string | null) {
  const sent: string[] = []
  const clock = mock.clock(on)
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('prompt.submit', (_$: any, e: any) => {
    if (e.origin?.kind === 'plugin') sent.push(e.text)
    return { text: '' }
  })
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.list', () => ({ value: [] }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'add tests', toolUses: [] }] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: REPLY, usage: { input_tokens: 1, output_tokens: 1 } } }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$: any, e: any) =>
    pick === null
      ? { deny: 'dismissed' }
      : { result: { questions: e.questions, answers: { [e.questions[0].question]: pick } } },
  )
  return { sent, clock }
}

async function finishTurn($: any) {
  await $.session.start({ surface: 'vscode', isInteractive: true, cwd: '/work' })
  await $.turn.start({ text: 'add tests', turnId: 't1' })
  await $.turn.complete({ reason: 'answer', answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't1' })
  await wait()
}

const runNext = ($: any) => $.command.run({ command: 'next', args: '', origin: { kind: 'user' } } as any)

describe('/next', () => {
  test('sends the suggestion the person picks', async ($, on) => {
    const { sent, clock } = engine(on, 'Open a draft PR')
    await finishTurn($)
    const r = await runNext($)
    expect(sent).toEqual([]) // not from inside the command
    await clock.advance(1)
    await wait()
    expect(r.text).toContain('Open a draft PR')
    expect(sent).toEqual(['Open a draft PR'])
  })

  test('sends nothing when the dialog is dismissed', async ($, on) => {
    const { sent } = engine(on, null)
    await finishTurn($)
    const r = await runNext($)
    await wait()
    expect(r.text).toContain('dismissed')
    expect(sent).toEqual([])
  })

  test('says so when there is nothing to suggest', async ($, on) => {
    const { sent } = engine(on, 'x')
    await $.session.start({ surface: 'vscode', isInteractive: true, cwd: '/work' })
    const r = await runNext($)
    expect(r.text).toContain('no suggestions')
    expect(sent).toEqual([])
  })
})

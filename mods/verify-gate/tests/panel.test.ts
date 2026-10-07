import { describe, expect, test } from 'claude-code/testing'

const wait = () => new Promise(done => (globalThis as any).setTimeout(done, 10))

// The engine beneath the mod, on `surface`; `pick` is the person's answer to the dialog.
function engine(on: any, surface: string, pick: string) {
  const asked: string[] = []
  const sent: string[] = []
  on('session.surfaces', () => ({ value: [surface] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_$: any, e: any) => (sent.push(e.text), { text: '' }))
  on('tool.call', (_$: any, e: any) => {
    if (e.tool === 'AskUserQuestion') {
      asked.push(e.questions[0].question)
      return { result: { questions: e.questions, answers: { [e.questions[0].question]: pick } } }
    }
    const stdout = 'FOUND 3 ERRORS AFFECTING 2 LINES'
    return { result: { stdout }, text: stdout }
  })
  return { asked, sent }
}

async function turnWithFailure($: any) {
  await $.turn.start({ text: 'lint it', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'phpcs --standard=WordPress inc/ | tail -5' })
  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' })
  await wait()
}

describe('verify-gate in the VS Code panel', () => {
  test('asks once at the end of the turn and sends the fix request on yes', async ($, on) => {
    const { asked, sent } = engine(on, 'vscode', 'Ask Claude to fix them')
    await turnWithFailure($)
    expect(asked.length).toBe(1)
    expect(asked[0]).toContain('3 phpcs errors')
    expect(sent.length).toBe(1)
    expect(sent[0]).toContain('3 phpcs errors')
  })

  test('sends nothing when dismissed', async ($, on) => {
    const { asked, sent } = engine(on, 'vscode', 'Dismiss')
    await turnWithFailure($)
    expect(asked.length).toBe(1)
    expect(sent.length).toBe(0)
  })

  test('never asks in the terminal, where the toast draws', async ($, on) => {
    const { asked } = engine(on, 'terminal', 'Ask Claude to fix them')
    await turnWithFailure($)
    expect(asked.length).toBe(0)
  })
})

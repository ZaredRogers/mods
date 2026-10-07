# next-steps

After each turn, 2 or 3 likely next prompts, suggested by Haiku from the session so far.

A fork of [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods)
`next-steps` 0.1.1 by Hamza Zafar, MIT — see `LICENSE`. The community copy is disabled
(`next-steps@claude-code-mods`); both share the plugin name and state keys, so never enable both.

## In the terminal and the desktop app

Unchanged from upstream: a `next:` row above the prompt. In an **empty** prompt, `1`–`3`
drafts that suggestion (nothing sends on its own) and `0` dismisses the row.

## In the VS Code panel — `/next`

The panel draws no band and has no prompt box a plugin can draft into (`$.prompt.fill` is
refused with `no_composer`). Its one interactive surface is the AskUserQuestion dialog, so:

- `/next` asks the last reply's suggestions as a question.
- Picking one **sends** it as your next prompt — choosing is the explicit act, since a draft
  is impossible there. Text typed under *Other* is sent the same way.
- Dismissing sends nothing.

The send goes from a timer rather than from inside the command: a prompt submitted from a
`command.run` hook would wait on the turn that hook is holding.

## Files

- `hooks/register.tsx` — upstream's band and digit keys, plus `/next`
- `tests/next-steps.test.ts` — upstream's tests
- `tests/next-command.test.ts` — `/next`: sends the pick, sends nothing on dismiss

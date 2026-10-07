import type { Register } from 'claude-code'

/**
 * 31 of 140 tool errors in this workspace were "Browser is already in use" /
 * "browser is already running", every one of them caused by alternating
 * between the playwright and chrome-devtools MCP servers in one session.
 * Whichever is used first wins the session.
 */
const BROWSER = /^mcp__(playwright|chrome-devtools)__/

let pinned: string | null = null

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    pinned = null
    await $.command.register({
      name: 'browser-release',
      description: 'Release the pinned browser MCP so the other may be used',
    })

    return next(e)
  })

  on('command.run', { command: 'browser-release' }, async () => {
    const was = pinned
    pinned = null

    return {
      text: was
        ? `browser-arbiter: released "${was}". The next browser call pins afresh.`
        : 'browser-arbiter: no browser was pinned.',
    }
  })

  on('tool.call', ($, e, next) => {
    const server = BROWSER.exec(e.tool)?.[1]
    if (server === undefined) return next(e)

    if (pinned !== null && server !== pinned) {
      return {
        deny: `browser-arbiter: this session is driving the "${pinned}" browser. Opening "${server}" as well is what produces "Browser is already in use" — the two servers fight over one profile. Use the mcp__${pinned}__* tools, or run /browser-release first if you really want to switch.`,
      }
    }

    pinned = server

    return next(e)
  })
}

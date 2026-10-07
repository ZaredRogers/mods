# browser-arbiter

Pins the session to one browser MCP server, so the two cannot collide.

## Why it exists

**31 of 140 tool errors in this workspace were "Browser is already in use" / "browser is
already running"** — every one of them caused by alternating between the `playwright` and
`chrome-devtools` MCP servers inside a single session. The two drive the same browser profile
and neither knows about the other.

## What it does

The first call to an `mcp__playwright__*` or `mcp__chrome-devtools__*` tool **pins** that
server for the session. Any call to the other server is then denied, with an explanation of
why and what to do:

> this session is driving the "playwright" browser. Opening "chrome-devtools" as well is what
> produces "Browser is already in use" — the two servers fight over one profile. Use the
> `mcp__playwright__*` tools, or run `/browser-release` first if you really want to switch.

The pin resets on `session.start`. Nothing else is touched — every non-browser tool passes
through.

## `/browser-release`

Unpins, so the next browser call pins afresh. Use it when you genuinely need the other server
— close the open browser first, or you will get the collision the mod exists to prevent.

```
/browser-release
→ browser-arbiter: released "playwright". The next browser call pins afresh.
```

## A note on scope

The pin lives in a module-level variable, not `$.state`, so it resets whenever the mod
reloads — which includes every edit to its own source while hot reloading is on. That is fine
for its purpose and means a stuck pin can always be cleared by touching the file.

Subagents are not separately tracked: a subagent driving the browser pins the same session.

## Files

- `hooks/register.ts` — the pin, the deny and the command
- `tests/browser-arbiter.test.ts` — pin, cross-server deny, release

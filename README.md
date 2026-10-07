# lightspeed-mods

A local Claude Code marketplace of LightSpeedWP mods — guardrails that enforce the org and
project standards at the point the agent would otherwise break them.

Every one of these was written against **measured** behaviour in the Southern Destinations
workspace, not against a hunch. The counts are in each mod's README.

## The mods

| Mod | What it does | Adds |
|---|---|---|
| [secret-sentinel](mods/secret-sentinel/) | Refuses to write a credential into a file, or to author a credentials file at all. Names the kind, never the value. | — |
| [wp-guardrails](mods/wp-guardrails/) | Blocks `git commit`/`push`, blocks reading `wp-config.php` whole, auto-adds the WP-CLI memory flag. | — |
| [verify-gate](mods/verify-gate/) | Reads lint/test/PHP output, so a failure hidden behind `\| tail` or an exit 0 can't pass as a success. | status line |
| [org-conformance](mods/org-conformance/) | Branch line above the prompt, driven by the org's own validator and PR templates in `~/.github`. | `/branch` `/pr` |
| [browser-arbiter](mods/browser-arbiter/) | Pins the session to one browser MCP so playwright and chrome-devtools can't fight over one profile. | `/browser-release` |
| [changelog-guard](mods/changelog-guard/) | Runs the org's Changelog Quality rules as entries are written, before CI blocks the merge. | `/changelog` |
| [next-steps](mods/next-steps/) | 2–3 likely next prompts after each turn. Fork of the community mod, adding `/next` for the VS Code panel. | `/next` |

Three of them (`secret-sentinel`, `wp-guardrails`, `browser-arbiter`) **deny** tool calls.
Three (`verify-gate`, `org-conformance`, `changelog-guard`) only report — except
`org-conformance`, which also denies a non-conformant branch name.

## In the VS Code panel

The VS Code chat panel runs mods but draws none of their bands, panes, toasts or status lines,
and has no prompt box a plugin can fill. It does draw the AskUserQuestion dialog (`$.ui.ask`).
So each mod with UI detects the panel — which reports **no surface at all** (`$.session.surfaces()` is empty), so the check is an empty list plus `CLAUDE_CODE_ENTRYPOINT=claude-vscode` — and, in the panel only, falls back to:

| Mod | In the panel |
|---|---|
| org-conformance | asks once per repo and branch, at turn end, when the repo is off-standard |
| verify-gate, changelog-guard | ask once at turn end about that turn's findings; *Ask Claude to fix them* sends the request |
| next-steps | `/next` asks the suggestions; the pick is sent |
| wp-guardrails | nothing — its one toast is information only |

Measured on extension 2.1.292, 2026-10-07.

## Installing

The marketplace is registered once:

```bash
claude plugin marketplace add ~/.claude/mods
claude plugin install secret-sentinel@lightspeed-mods
```

`claude plugin list` shows what's enabled; `claude plugin disable <name>@lightspeed-mods`
turns one off without uninstalling.

## Working on one

```bash
claude plugin validate ~/.claude/mods/mods/<name>    # manifest + what the engine would refuse
claude plugin test     ~/.claude/mods/mods/<name>    # the mod's own tests
tsc -p                 ~/.claude/mods/mods/<name>    # type-check (after it has loaded once)
```

To iterate with hot reloading, work on a copy in this session's
`~/.claude/dev-mods/<session-id>/` folder — edits there reload at the end of each turn —
then bring the result back here and bump the version in both `plugin.json` and
`.claude-plugin/marketplace.json`.

`.claude-plugin/types/` inside each mod is written by the engine, not by hand.

## Conventions for a new mod

1. A folder under `mods/`, with `.claude-plugin/plugin.json`, `hooks/hooks.json`,
   `hooks/register.ts` (or `.tsx`), `tests/<name>.test.ts`, `tsconfig.json`.
2. A `types/index.d.ts` declaring the `$.state` contract, if it keeps state.
3. **A `README.md`** — why it exists (with the measurement that justified it), what it does,
   what it denies, how to override it, and its known gaps.
4. An entry in `.claude-plugin/marketplace.json`.
5. A deny message that says what to do instead, not just "no".

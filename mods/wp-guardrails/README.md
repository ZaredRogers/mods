# wp-guardrails

Three project rules from `AGENTS.md`, enforced on `Bash` rather than trusted to the model.

## What it does

Hooks `tool.call` on `Bash` only.

### 1. Never commit, never push — denied

Matches `git commit` and `git push` (including through `git -C <path>`) and denies with:

> committing and pushing are Zared's, not yours. Leave the work in the working tree and hand
> it over with the commit message as text he can copy.

Branching, staging and editing are untouched — only the two commands that write history.

### 2. Secrets must not be echoed whole — denied

Denies `cat`/`less`/`more`/`head`/`tail`/`bat` against `wp-config.php`, `.env`, `.env.*` and
`.mcp.json`. The message points at the alternative: `grep -n "DB_NAME" wp-config.php`.

This overlaps `secret-sentinel` by design — that one stops a secret going *into* a file, this
one stops one coming *out* into the transcript.

### 3. The WP-CLI memory flag — rewritten, not denied

The default PHP memory limit OOMs on these installs. Measured on this workspace: **31 of 445
WP-CLI calls forgot the flag.** Any bare `wp …` is rewritten to

```bash
php -d memory_limit=1024M $(which wp) …
```

and a toast says so. `wp --version` and any command already naming `memory_limit` pass
through untouched. This is the one rule that corrects rather than blocks, because there is
exactly one right answer and no judgement involved.

## Scope

It fires in every session, not just the Southern Destinations workspace. Rules 1 and 2 are
safe anywhere. Rule 3 only rewrites `wp`, so it is inert outside a WordPress project.

## Overriding it

There is no bypass flag. If a commit genuinely has to happen — an interactive rebase, a
bisect — run it in a terminal outside Claude Code, which is the behaviour `AGENTS.md` asks
for anyway.

## Files

- `hooks/register.ts` — the three checks
- `tests/wp-guardrails.test.ts` — deny and rewrite cases

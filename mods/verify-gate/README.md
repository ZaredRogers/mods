# verify-gate

Catches lint, test and PHP failures that exit 0 or are hidden behind a `| tail` pipe.

## Why it exists

Measured on this workspace:

- **376 Bash commands pipe a check into `| tail`** — which discards the exit code of the
  check and reports `tail`'s instead. `tail` always succeeds.
- **Of 333 lint runs, roughly 27% showed violations in their output and only 3 surfaced as
  errors.**

So "verify, then claim" was failing not because the model lied, but because the shell told it
the run had passed. This mod reads the output itself.

## What it does

Hooks `tool.call` on `Bash`, lets the command run, then — only if the command looks like a
check — scans the result for a violation.

Commands treated as checks:

```
npm/npx/pnpm/yarn run lint|check|test|stan|typecheck
phpcs   phpcbf   php -l   phpunit   composer check|stan|test|lint
eslint  stylelint  tsc  node --check  playwright test
claude plugin test|validate  bun test
```

Patterns it recognises in the output, in order:

| Pattern | Reported as |
|---|---|
| `FOUND n ERROR` | phpcs errors |
| `n problems` / `✖ n` | lint problems |
| `Found n errors` | errors |
| `n failed` / `n tests failed` | failures |
| `n fail` / `(fail)` (bun, `claude plugin test`) | test failures |
| `[ERROR]` | reported error |
| `PHP Parse error` / `Fatal error` | PHP fatal |
| `npm ERR!` | npm error |
| `database is locked` | SQLite lock |
| `Errors parsing` | parse error |

Counted patterns only fire on a count greater than zero, so `0 problems` reads as a pass.

A check whose tool is not installed did not run, so it did not fail. When npx reports
`canceled due to missing packages` or `could not determine executable to run`, the
`npm error` row stands down. Before this, `npx --no-install tsc -v` flagged a false
"npm error" twice.

## What you see

A toast, and a status-line entry that stays up until the next check comes back clean:

```
verify-gate: 12 lint problems (exit 0 — this would have passed unnoticed)
check failed: 12 lint problems
```

The `(exit 0 …)` suffix appears when the tool call itself reported success — i.e. exactly the
case the mod exists for.

## It reports, it does not block

`verify-gate` never denies. The command runs, the result is returned unchanged, and the
failure is surfaced alongside it. Blocking a check run would be the wrong move — you want the
output. The point is that the output can no longer be mistaken for a pass.

## Known gaps

- It scans only the output the model reads (stdout and stderr), never the rest of the tool's
  record, which carries a diff of every file the command edited. Before 0.3.0 it scanned the
  whole record, so writing `FOUND 3 ERRORS` into a test fixture read as a phpcs failure.
- It scans the first 20,000 characters of that output. A violation buried deeper in a very
  long run is missed.
- A check with a failure format not in the table above passes silently. Add the pattern to
  `RULES` in `hooks/register.ts` when you meet one.

## In the VS Code panel

The VS Code chat panel draws no toast or status line — only the AskUserQuestion dialog. There,
the turn's check failures are collected and asked about **once, when the turn ends** (asking mid-turn
would pause the model): *Ask Claude to fix them* hands the failures to a `general-purpose` subagent pinned to
**Sonnet** (`FIX_MODEL` in `hooks/register.ts`, model-policy's cap for a fix task), and relays
its report back to the session when it finishes. `$.prompt.submit` takes no model, so a
subagent is the only way to hold the fix to a model.
*Dismiss* drops them. The terminal and the desktop app keep the toast.

## Files

- `hooks/register.ts` — the check matcher and the output scanner
- `tests/verify-gate.test.ts` — one case per pattern, plus the `0 problems` pass
- `tests/panel.test.ts` — the end-of-turn question in the panel, the Sonnet fix subagent, and
  silence in the terminal. The relay of the subagent's report isn't tested: the test harness
  drops `agentId` from a mocked spawn, so that path needs a live check.

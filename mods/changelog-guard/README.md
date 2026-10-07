# changelog-guard

Runs the org's Changelog Quality rules locally, as entries are written, before CI blocks the
merge.

## Why it exists

`lightspeedwp/.github` runs **Changelog Quality Validation** on every PR and blocks the merge
on new failures. Its validator needs an npm install the team does not have locally, so the
first anyone hears of a bad entry is a red check on the PR.

These are the same rules, read from the org's own
`~/.github/.github/validation/changelog/rules.json`, applied at the moment the entry is
written. The rules are never hard-coded here — the max length, the banned keywords and the
known-acronyms list all come from that file.

## Scoped the way CI is scoped

CI gates only on failures *a branch introduces* — pre-existing `Unreleased` failures do not
block. This mod reads `git show develop:./CHANGELOG.md` and checks only the entries your
branch added. Without that scoping an old changelog reads as pure noise.

## Rules checked

| Rule | Severity | What fires it |
|---|---|---|
| `CHK_MAX_LENGTH` | critical | entry longer than the org's limit |
| `CHK_HAS_PR_LINK` | critical | no `#1234` reference |
| `CHK_NO_IMPL_DETAILS` | critical | a banned implementation-detail keyword |
| `CHK_FORMAT_MARKDOWN` | high | raw HTML tag, or unbalanced `**` / backticks |
| `CHK_UNIQUE_CONTENT` | high | >90% similar to another new entry (Levenshtein) |
| `CHK_NO_ABBREVIATIONS` | medium | an all-caps token not in the known-acronyms list |

**Critical and high block the merge. Medium does not.**

`CHK_LINK_VALIDITY` needs the GitHub API and `CHK_CONSISTENT_TENSE` is too heuristic to
assert offline — both are deliberately left to CI, and the output says so.

## What you see

Writing a `CHANGELOG.md` entry that breaks a rule produces a toast:

> changelog-guard: 2 rule issue(s) in the 1 entry just added — 2 would block the merge. Run
> /changelog for detail.

Separately, once you have edited source (`.php`, `.js`, `.ts`, `.tsx`, `.css`, `.scss`,
`.json`) without touching `CHANGELOG.md`, the status line carries a reminder until you do:

```
changelog: not updated yet on this branch
```

## `/changelog`

Full report on the entries this branch adds. Takes an optional path; defaults to
`CHANGELOG.md` in the working directory.

```
/changelog
→ changelog-guard: 3 issue(s) in the 2 entries this branch adds —
  CI blocks the merge on critical and high.

    critical  CHK_HAS_PR_LINK
      "Fixed the nav overlay submenu behaviour" — no PR or issue reference (#1234)
    medium    CHK_NO_ABBREVIATIONS
      "Added JSONLD output to tour templates" — unknown abbreviation: JSONLD

  4 pre-existing entries were not checked — CI does not gate on those.
```

It never edits the file.

## Known gaps

- Entries are read from disk after the write, so a `CHANGELOG.md` edited outside the agent is
  only seen the next time `/changelog` runs.
- If `develop` cannot be read (no such branch, a fresh repo) every `Unreleased` entry is
  treated as new, which over-reports rather than under-reports.

## In the VS Code panel

The VS Code chat panel draws no toast or status line — only the AskUserQuestion dialog. There,
the turn's rule issues are collected and asked about **once, when the turn ends** (asking mid-turn
would pause the model): *Ask Claude to fix them* sends a fix request as the next prompt,
*Dismiss* drops them. The terminal and the desktop app keep the toast.

## Files

- `hooks/register.ts` — rule loading, scoping, checks, command
- `tests/changelog-guard.test.ts`
- `tests/panel.test.ts` — the end-of-turn question in the panel, and silence in the terminal

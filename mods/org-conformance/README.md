# org-conformance

Keeps branches and PRs aligned to the LightSpeedWP standard in `~/.github`.

## The design rule

**This mod never restates the org's rules.** It shells out to the org's own validator and
reads the org's own branch-type map and PR templates, so when the org updates, the mod
inherits it. Everything it knows comes from three files in `~/.github`:

| File | Used for |
|---|---|
| `scripts/validation/validate-branch-name.cjs` | is this branch name valid, and why not |
| `.github/branch-types.yml` | branch type → PR template routing, and the allowed types |
| `.github/PULL_REQUEST_TEMPLATE/*.md` | the template bodies |

If `~/.github` is missing or stale, the mod degrades quietly — the band disappears and the
commands say what they could not read.

## The band above the prompt

```
sd-theme-2026  feat/theme-404  · 3 dirty · feature.md        [hide]
```

Green branch name = valid and `develop` exists. Yellow = something is off, with the reason
inline (`✗ not {type}/{scope}-{title}`, `· no develop`). `+n off-standard` counts the *other*
repos in the workspace on non-conformant branches.

The repo shown follows the work: the mod tracks the last repo a Bash call touched via `-C` or
`cd` (absolute, `~` or relative to the workspace root), or a file the model read or wrote, which matters here because the SD workspace root is not a git repo while the theme and
plugin beneath it are. `hide` dismisses the band for the session.

Refreshes on prompt submit (throttled to 5s) and after any `git` command.

## In the VS Code panel

The VS Code chat panel draws no band, toast or status line — only the AskUserQuestion dialog.
There, when the repo **this session is working in** is off-standard (invalid branch name, or no
`develop`), the mod asks about it **once per repo and branch**, at the end of a turn so it never
pauses work mid-turn. Switching to another repo warns about that one only; a repo the session
never touched is never warned about, whatever the scan found first:
*Keep warning me* or *Hide for this session*. The terminal and the desktop app keep the band.

**Typing under *Other* cuts the branch.** Whatever you type in the dialog's *Other* field is
taken as a `/branch` description (or a name, if it is already `{type}/{scope}-{title}`) and runs
exactly as `/branch` does: Haiku proposes, the org validator checks, and it is cut from `develop`
— or refused, with the reason, when there is no `develop` or there are uncommitted files. The
outcome comes back in the same dialog, since the panel shows nothing else; a refused name can be
retried there by typing again under *Other* (up to three tries). `/branch` still works as before.

`agent-skills/` and `.agents/` are skipped everywhere: they are clones of other people's repos
and follow their own branch rules.

## `/branch`

With no argument, reports the current state:

```
/branch
→ sd-theme-2026 is on "feat/theme-404" (conformant).
  Base "develop" exists; 3 uncommitted file(s).
  Give me a description to get a name: /branch 404 template for the theme
```

With a description, it asks Haiku for a conformant name (constrained to the allowed types read
from `branch-types.yml`), validates that name against the org validator, and **only then**
cuts it from `develop`. If you pass something already in `{type}/{scope}` form it is used
as-is, no model call.

It refuses to act, and creates nothing, when:

- the proposed name fails the validator (reason given);
- the repo has no `develop` branch (prints the command to create it);
- the working tree is dirty (switching would carry the changes across).

Nothing is ever staged or committed.

> The most common rejection: **`feature` is not an allowed type, `feat` is.**

## `/pr`

Resolves this branch's type to its PR template, then fills it using the branch's commits and
changed files (`develop...HEAD`), via Sonnet at low effort. Headings and checklists are kept
in the template's own order; sections without supporting evidence are left empty rather than
invented.

`/pr raw` prints the empty template instead. If the model is unreachable you get the raw
template too, so the command always returns something usable.

**It prints the body — it does not open the PR.** Opening it is yours.

## The one thing it denies

`git checkout -b` / `git switch -c` / `git branch <name>` with a name the org validator
rejects. Everything else about git is left alone — `wp-guardrails` handles commit and push.

## Files

- `tests/panel.test.ts` — the panel warning: once per repo and branch, never in the terminal; a description under *Other* cuts the branch

- `hooks/register.tsx` — band, commands, branch-name gate
- `types/index.d.ts` — the `$.state` contract (`status`, `isHidden`)
- `tests/org-conformance.test.ts`

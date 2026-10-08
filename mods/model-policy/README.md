# model-policy

Holds every subagent spawn to one model rule table. If a call names no model and would inherit
Opus for a task the table caps lower, the subagent runs at the cap. If a call **names** a model
above the cap, it is refused, and the refusal says which model to retry with.

## Why

AGENTS.md rules 6 and 11 say to start subagents on a lower tier and escalate to Opus only on
evidence. As prose, that rule was not followed. Measured across the 135 Southern Destinations
transcripts on 2026-10-07:

- **12,858 of 13,096** main-session assistant messages ran on Opus.
- **146 of 829** subagent messages (18%) also ran on Opus. All of them came from `Explore`
  sweeps that named no model and so inherited the parent's. `Explore` and `Plan` are built
  with `model: inherit`.
- Every user and `lsx-agents` definition already pins `model: sonnet` (5 + 67 of them), so the
  leak is the built-in agents.

Pinning `model:` in agent frontmatter fixes one agent type. This mod fixes the *task*: it reads
the call's description, so "count the patterns" is capped at Haiku whichever agent type runs it.

## What it does

It hooks `agent.spawn`, which fires for every Agent tool call and every workflow `agent()`.

1. **Match a rule.** A rule marked `overridesAgent` whose keyword matches the `description`
   wins first — that is `analysis`, so an `Explore` call that asks *why* or for *render
   conditions* runs on Sonnet rather than Explore's Haiku. Then a rule that names the agent
   type (`Explore`, `Plan`). Then the first rule whose keyword matches. If nothing matches,
   the default applies.
2. **Compare** the model the subagent would run on with that rule's cap:

| The spawn | Over the cap → |
|---|---|
| names no model, so it would inherit the parent's | **runs at the cap**: the model is rewritten and the call shows a notice |
| names a model (`model: "opus"`) | **refused**: *"Retry with model: "sonnet""* |
| is a `fork`, which always inherits | **refused**: start a named subagent with the capped model |
| is a workflow `agent()` | **toast** by default (`"workflow": "deny"` refuses it instead) |

At or under the cap, and for a model it cannot rank, the call goes through untouched. A lower
tier than the cap is always allowed.

`/model-policy` prints the table that is in force and this session's decisions.

## The table

It is set in [`hooks/policy.ts`](hooks/policy.ts) and nowhere else:

| Rule | Cap | Agent types | Keywords in the description (whole words) |
|---|---|---|---|
| analysis | sonnet | — (overrides agent type) | render condition(s), why, root cause, diagnose/diagnosis, investigate/investigation, analyse/analyze/analysis, trace, explain, inert, behaviour of |
| mechanical | haiku | Explore, claude-code-guide | count, tally, inventory, enumerate, list, find, locate, where is, look up, grep, search, measure, catalogue, triage |
| precedent | opus | Plan | first, precedent, pattern-setter, boundary, scope, architecture, architect, judgement, decide, decision |
| follow-pattern | sonnet | — | phpcs, phpcbf, lint, changelog, PR text, PR description, release notes, token sweep, migrate, migration, port, fix, slice, template, pattern, implement, refactor, apply, test |
| *default* | sonnet | | |

Rule order matters for keywords: `mechanical` comes first, then `precedent`, then
`follow-pattern`. So "Count templates" is capped at Haiku, "First single template" is allowed
Opus, and "Fix template 3" is capped at Sonnet.

### A project's own table

A project can replace the whole table with `.claude/model-policy.json` at its root, in the same
shape:

```json
{
  "default": "sonnet",
  "workflow": "warn",
  "rules": [
    { "id": "mechanical", "tier": "haiku", "why": "…", "agents": ["Explore"], "keywords": ["count", "inventory"] }
  ]
}
```

If that file is not valid, the shipped table is used and a toast says why. The `why` text is
quoted in every refusal, so it can point to the project rule it enforces.

## Overriding it

When the cheaper tier is genuinely not enough, keep the higher model and put the evidence in
the prompt on a line of its own:

```text
Escalation: sonnet produced the wrong block bindings twice on this template.
```

The reason must be at least 15 characters, so a bare "Escalation: hard" does not count. The
line reaches the subagent too, which is harmless. To turn the mod off:
`claude plugin disable model-policy@lightspeed-mods`.

## What it can't do

- **Your own conversation's model.** No hook can change the model of the main session. Use
  `/model sonnet` for a mechanical session yourself.
- **Agent definitions that pin a lower model.** When a call names no model, the mod assumes
  it would inherit the parent's model, because the spawn event is raised before the
  definition's model is resolved. Every pin measured here is `sonnet` and every cap is
  `haiku` or above, so a call names no model only ever *lowers* or *keeps* the model.
  A definition pinned to `haiku` on a task capped at `sonnet` would be raised. Give that
  agent type a `haiku` rule.
- **Keyword matching is coarse.** The match reads the 3–5 word `description` and never the
  prompt, so a vague description can land on the wrong rule. A miss toward a lower tier fits
  rule 11. Toward a higher one, the cap is still at most what the description claimed.
- **Workflow agents** only warn by default, because refusing an agent partway through a run
  can strand the rest of it.
- **Tests cover** named, unnamed, escalated, unrankable, project-table and broken-table
  spawns. The test kit can't raise a `fork` or a workflow spawn, so those two paths are
  untested. Not yet type-checked with `tsc` (it isn't installed), so run
  `tsc -p ~/.claude/mods/mods/model-policy` once the mod has loaded.

import type { Register } from 'claude-code'
import { SHIPPED, type Policy, type Rule, type Tier } from './policy'

/**
 * Main sessions in this workspace ran on Opus for 12,858 of 13,096 assistant
 * messages, and 146 of 829 subagent messages ran on Opus too. Those came from
 * Explore sweeps that named no model and so inherited the parent's.
 * AGENTS.md rules 6 and 11 say lower tiers first, Opus only on evidence.
 * This holds every subagent spawn to a rule table, so the rule is applied
 * here and not left to prose in AGENTS.md.
 */

type Decision = {
  agent: string
  description: string
  action: 'pass' | 'capped' | 'denied' | 'warned' | 'escalated'
  from: string
  to: string
  rule: string
}

const RANK: Record<Tier, number> = { haiku: 1, sonnet: 2, opus: 3, fable: 4 }

/** A prompt line that carries the evidence for running above the cap. */
const ESCALATION = /^\s*Escalation:\s*(\S.{14,})$/im

const PROJECT_POLICY = '.claude/model-policy.json'

let decisions: Decision[] = []

/** An alias or a full model id, by family; null when it names none we rank. */
function tierOf(model: string | undefined): Tier | null {
  const m = /(haiku|sonnet|opus|fable)/i.exec(model ?? '')

  return m ? (m[1].toLowerCase() as Tier) : null
}

function isPolicy(v: any): v is Policy {
  return (
    v !== null &&
    typeof v === 'object' &&
    v.default in RANK &&
    Array.isArray(v.rules) &&
    v.rules.every((r: any) => typeof r?.id === 'string' && r.tier in RANK)
  )
}

/** The project's table when it has a valid one, otherwise the shipped one. */
async function loadPolicy($: any): Promise<{ policy: Policy; source: string; problem?: string }> {
  const project = `${await $.session.cwd()}/${PROJECT_POLICY}`
  let problem: string | undefined

  try {
    const parsed = JSON.parse(await $.fs.read(project))
    if (isPolicy(parsed)) return { policy: parsed, source: project }
    problem = `${project} is not a valid table (needs "default" and "rules" with known tiers); using the shipped one.`
  } catch (err: any) {
    if (err instanceof SyntaxError) problem = `${project} is not valid JSON; using the shipped one.`
  }

  return { policy: SHIPPED, source: 'model-policy (shipped table)', problem }
}

function keywordHit(rule: Rule, text: string): boolean {
  return (rule.keywords ?? []).some(k => new RegExp(`\\b(?:${k})\\b`, 'i').test(text))
}

/**
 * An `overridesAgent` keyword match wins first, then an agent-type match, then
 * any keyword match; within each, table order.
 */
function match(policy: Policy, agent: string, description: string): Rule {
  const overriding = policy.rules.find(r => r.overridesAgent && keywordHit(r, description))
  if (overriding) return overriding

  const byAgent = policy.rules.find(r => (r.agents ?? []).includes(agent))
  const byWords = policy.rules.find(r => keywordHit(r, description))

  return (
    byAgent ??
    byWords ?? {
      id: 'default',
      tier: policy.default,
      why: 'No rule matched; the table default applies.',
    }
  )
}

function remember(d: Decision): void {
  decisions.push(d)
  if (decisions.length > 50) decisions = decisions.slice(-50)
}

function overCapMessage(
  what: string,
  from: Tier,
  rule: Rule,
  fix: string,
): string {
  return [
    `model-policy: ${what} would run on ${from}, but the table caps this kind of task at ${rule.tier}.`,
    `Rule "${rule.id}": ${rule.why}`,
    fix,
    `If you have evidence ${rule.tier} is not enough (it already failed at this, or this call sets a precedent), keep ${from} and add a line to the prompt: "Escalation: <that evidence>".`,
  ].join(' ')
}

function renderTable(policy: Policy, source: string): string {
  const rows = policy.rules.map(
    r =>
      `| ${r.id} | ${r.tier} | ${(r.agents ?? []).join(', ') || '—'} | ${(r.keywords ?? []).join(', ') || '—'} |`,
  )

  return [
    `Table: ${source}`,
    '',
    '| Rule | Cap | Agent types | Description keywords |',
    '|---|---|---|---|',
    ...rows,
    `| default | ${policy.default} | — | — |`,
    '',
    `Workflow agents over the cap: ${policy.workflow ?? 'warn'}.`,
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    decisions = []
    await $.command.register({
      name: 'model-policy',
      description: 'Show the subagent model rule table and this session’s decisions',
    })

    return next(e)
  })

  on('command.run', { command: 'model-policy' }, async $ => {
    const { policy, source, problem } = await loadPolicy($)
    const log = decisions.length
      ? decisions.map(
          d => `- ${d.action}: "${d.description}" (${d.agent}) ${d.from} → ${d.to} [${d.rule}]`,
        )
      : ['- no subagents spawned yet']

    return {
      text: [renderTable(policy, source), problem ?? '', 'This session:', ...log]
        .filter(Boolean)
        .join('\n'),
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const { policy, problem } = await loadPolicy($)
    if (problem) $.ui.toast(`model-policy: ${problem}`)

    const rule = match(policy, e.subagentType, e.description)
    const cap = rule.tier
    // A plugin's own spawn may carry no parent model: its parent is the session.
    const parentModel = e.parentModel ?? (await $.session.model())
    const parent = tierOf(parentModel)
    const named = !e.fork && e.model !== undefined
    const asked = e.fork ? parent : named ? tierOf(e.model) : null
    // A named model we cannot rank is the caller's call, not the parent's.
    const runs = named && asked === null ? null : (asked ?? parent)
    const what = `"${e.description}" (${e.subagentType})`
    const log = (action: Decision['action'], to: string) =>
      remember({
        agent: e.subagentType,
        description: e.description,
        action,
        from: runs ?? e.model ?? parentModel,
        to,
        rule: rule.id,
      })

    // A model we cannot rank, or a run already at or under the cap.
    if (runs === null || RANK[runs] <= RANK[cap]) {
      log('pass', runs ?? String(e.model))

      return next(e)
    }

    if (ESCALATION.test(e.prompt)) {
      log('escalated', runs)

      return next(e)
    }

    // A workflow's agent can only be refused, and refusing one mid-run can
    // strand the rest of the run, so the table chooses.
    if (e.workflow) {
      const fix = `Set model: "${cap}" on this agent() call in the workflow script.`
      if (policy.workflow === 'deny') {
        log('denied', runs)

        return { deny: overCapMessage(what, runs, rule, fix) }
      }
      log('warned', runs)
      $.ui.toast(`model-policy: workflow agent ${what} runs on ${runs}; the cap is ${cap}.`)

      return next(e)
    }

    if (e.fork) {
      log('denied', runs)

      return {
        deny: overCapMessage(
          what,
          runs,
          rule,
          `A fork always inherits the parent's model and ignores model, so start a named subagent instead (for example general-purpose) with model: "${cap}".`,
        ),
      }
    }

    // The caller chose this model: refuse, and say what to retry with.
    if (named) {
      log('denied', runs)

      return { deny: overCapMessage(what, runs, rule, `Retry with model: "${cap}".`) }
    }

    // No model named, so it would inherit the parent's: run it at the cap.
    log('capped', cap)
    if (e.tool_use_id) {
      $.ui.notice(e.tool_use_id, `model-policy: ran on ${cap} (rule "${rule.id}") instead of inheriting ${runs}`)
    }

    return next({ ...e, model: cap })
  }).catch(($, e, next) => {
    // Fail open: a broken table must not stop every subagent. Say so.
    $.ui.toast('model-policy: the guard failed, so this subagent ran unchecked. Run /model-policy.')

    return next(e)
  })
}

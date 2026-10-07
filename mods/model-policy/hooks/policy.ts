/**
 * The subagent model rule table: the one place the tiers are set.
 *
 * Each rule caps the model a kind of task may run on without an
 * "Escalation:" line in the prompt. A project replaces this whole table with
 * its own .claude/model-policy.json, the same shape as JSON.
 *
 * Matching: a rule naming the agent type wins over a keyword match; within
 * each pass the first rule in this list wins; nothing matched uses `default`.
 * Keywords are regex fragments matched as whole words against the Agent
 * call's description, case-insensitively.
 */

export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable'

export type Rule = {
  id: string
  tier: Tier
  why: string
  agents?: string[]
  keywords?: string[]
}

export type Policy = {
  default: Tier
  /** What a workflow agent over the cap gets: a toast, or refused. */
  workflow?: 'warn' | 'deny'
  rules: Rule[]
}

export const SHIPPED: Policy = {
  default: "sonnet",
  workflow: "warn",
  rules: [
    {
      id: "mechanical",
      tier: "haiku",
      why: "Mechanical counting, inventory and lookups run on Haiku (AGENTS.md rule 6).",
      agents: ["Explore", "claude-code-guide"],
      keywords: ["count", "counts", "counting", "tally", "inventory", "enumerate", "list", "find", "locate", "where is", "look ?up", "lookup", "grep", "search", "measure", "catalogue", "catalog", "triage"],
    },
    {
      id: "precedent",
      tier: "opus",
      why: "The first of a type, boundary calls and scope judgements set the precedent on Opus (AGENTS.md rule 6).",
      agents: ["Plan"],
      keywords: ["first", "precedent", "pattern[- ]setter", "boundary", "scope", "architecture", "architect", "judg(e)?ment", "decide", "decision"],
    },
    {
      id: "follow-pattern",
      tier: "sonnet",
      why: "Work against an established pattern runs on Sonnet: templates 2-N, phpcs loops, token sweeps, CHANGELOG and PR text, content migration (AGENTS.md rule 6).",
      agents: [],
      keywords: ["phpcs", "phpcbf", "lint", "changelog", "pr text", "pr description", "release notes", "token sweep", "migrate", "migration", "port", "fix", "slice", "template", "pattern", "implement", "refactor", "apply", "test", "tests"],
    },
  ],
}

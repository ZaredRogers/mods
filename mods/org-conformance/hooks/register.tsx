import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Conformance, RepoStatus } from '../types'

/**
 * The org standard lives in the lightspeedwp/.github clone at ~/.github.
 * This mod never restates the rules: it shells out to the org's own
 * validator and reads the org's own branch-type -> PR-template map, so
 * when the org updates, the mod inherits it.
 */
const VALIDATOR = 'scripts/validation/validate-branch-name.cjs'
const TYPE_MAP = '.github/branch-types.yml'
const TEMPLATES = '.github/PULL_REQUEST_TEMPLATE'
const BASE = 'develop'
const STALE_MS = 5000

const status = atom({ plugin: 'org-conformance', key: 'status' } as const, null)
const isHidden = atom({ plugin: 'org-conformance', key: 'isHidden' } as const, false)

type Sh = { exitCode: number; stdout: string; stderr: string }

const sh = async ($: any, argv: readonly string[], cwd?: string): Promise<Sh> => {
  try {
    const r = await $.process.run(argv, { cwd, timeoutMs: 15000 })
    return { exitCode: r.exitCode, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  } catch {
    return { exitCode: 1, stdout: '', stderr: '' }
  }
}

const git = ($: any, root: string, ...args: string[]) =>
  sh($, ['git', '-C', root, ...args])

const orgRoot = async ($: any) => `${(await $.env.get('HOME')) ?? ''}/.github`

/** Every git repo in the workspace. The SD root is not one; the theme and
 *  plugin below it are, so a plain rev-parse is not enough. */
async function findRepos($: any): Promise<string[]> {
  const root = await $.session.root()
  const own = await git($, root, 'rev-parse', '--show-toplevel')
  if (own.exitCode === 0 && own.stdout.trim()) return [own.stdout.trim()]

  const found = await sh($, [
    'bash',
    '-c',
    `find ${JSON.stringify(root)} -maxdepth 5 -type d -name .git -not -path '*/node_modules/*' -not -path '*/vendor/*' 2>/dev/null | sort | head -60`,
  ])
  return found.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(path => path.replace(/\/\.git$/, ''))
    .filter(path => !NOT_ORG.test(path))
}

/** Clones of other people's repos: their branches follow their own rules. */
const NOT_ORG = /\/(agent-skills|\.agents)$/

/** The org validator is the single source of truth for branch names. */
async function validate(
  $: any,
  branch: string,
): Promise<{ isValid: boolean; reason: string }> {
  if (!branch || branch === 'HEAD') return { isValid: true, reason: '' }
  const script = `${await orgRoot($)}/${VALIDATOR}`
  const ran = await sh($, ['node', script, branch])
  if (ran.exitCode === 0) return { isValid: true, reason: '' }

  const said = `${ran.stdout}\n${ran.stderr}`
    .split('\n')
    .map(line => line.replace(/^[^A-Za-z]*/, '').trim())
    .filter(Boolean)
    .find(line => /invalid|forbidden|must|expected|allowed|pattern/i.test(line))

  return { isValid: false, reason: said ?? 'not {type}/{scope}-{title}' }
}

/** branch type -> PR template, from the org's own routing contract. */
async function templateFor($: any, branch: string): Promise<string | null> {
  if (!branch.includes('/')) return null
  const type = branch.split('/')[0]
  const text = (await sh($, ['cat', `${await orgRoot($)}/${TYPE_MAP}`])).stdout
  let seen: string | null = null

  for (const line of text.split('\n')) {
    const key = /^ {2}([a-z0-9-]+):\s*$/.exec(line)
    if (key) {
      seen = key[1]
      continue
    }
    const tpl = /^ {4}template:\s*(\S+)/.exec(line)
    if (tpl && seen === type) return tpl[1]
  }
  return null
}

/** The template's text, or '' when it cannot be read. */
async function templateText($: any, template: string): Promise<string> {
  return (await sh($, ['cat', `${await orgRoot($)}/${TEMPLATES}/${template}.md`])).stdout
}

/** The template minus its YAML frontmatter: what a PR body should look like. */
const bodyOf = (template: string) => template.replace(/^---\n[\s\S]*?\n---\n+/, '')

/** The `##` headings a body must keep, read from the template itself. */
const headingsOf = (template: string) =>
  bodyOf(template)
    .split('\n')
    .filter(line => /^##\s+\S/.test(line))
    .map(line => line.trim())

/** The fixed part of the template's `title:` pattern, e.g. "test: " from "test: {scope} - …". */
function titlePrefixOf(template: string): { pattern: string; prefix: string } | null {
  const said = /^title:\s*["']?(.*?)["']?\s*$/m.exec(template.split(/\n---\n/)[0] ?? '')
  if (!said) return null
  return { pattern: said[1], prefix: said[1].split('{')[0] }
}

/** Fill the template from the branch's commits and changed files; null when the model is unreachable. */
async function fillTemplate($: any, active: RepoStatus, template: string): Promise<string | null> {
  const diff = (await git($, active.root, 'diff', '--stat', `${BASE}...HEAD`)).stdout
  const log = (await git($, active.root, 'log', '--oneline', `${BASE}..HEAD`)).stdout

  const reply = await $.model.complete({
    model: 'sonnet',
    effort: 'low',
    maxTokens: 1600,
    system:
      'You fill in a pull request template. Keep every heading and checklist the template has, in its order. Fill only what the evidence supports; leave a section empty rather than inventing. Output the completed markdown and nothing else.',
    prompt: `Branch: ${active.branch}\nRepo: ${active.name}\n\nCommits:\n${log || '(none)'}\n\nChanged files:\n${diff || '(none)'}\n\nTemplate:\n${bodyOf(template)}`,
  })

  return reply.isAnswered ? reply.text : null
}

/** The value of `--flag value`, `--flag=value` or `--flag "quoted value"` in a command. */
function flag(command: string, names: string[]): string | null {
  const alt = names.map(n => n.replace(/-/g, '\\-')).join('|')
  const hit = new RegExp(`(?:^|\\s)(?:${alt})(?:\\s+|=)(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)'|([^\\s;&|]+))`).exec(command)
  return hit ? (hit[1] ?? hit[2] ?? hit[3] ?? '') : null
}

/**
 * Check a `gh pr create` against the org template its branch routes to.
 * Resolves to the refusal text, or null when the PR conforms.
 */
async function checkPr($: any, command: string, cwd: string | null): Promise<string | null> {
  const root = touched ?? (await repoAt($, cwd ?? (await $.session.root())))
  if (!root) return null
  const active = await statusOf($, root)
  const head = flag(command, ['--head', '-H'])
  if (head) {
    const { isValid, reason } = await validate($, head)
    Object.assign(active, { branch: head, isValid, reason, template: await templateFor($, head) })
  }

  if (!active.template) {
    return `org-conformance: "${active.branch}" has no org branch type, so no PR template routes to it${active.isValid ? '' : ` (${active.reason})`}. Cut a conformant branch first — the user can run /branch.`
  }
  const template = await templateText($, active.template)
  if (!template.trim()) return null

  const problems: string[] = []

  const want = titlePrefixOf(template)
  const title = flag(command, ['--title', '-t'])
  if (want && !(title ?? '').startsWith(want.prefix)) {
    problems.push(title === null ? 'no --title' : `title "${title}" does not start with "${want.prefix}"`)
  }

  let body = command
  const file = flag(command, ['--body-file', '-F'])
  if (file && file !== '-') {
    const path = file.startsWith('/') ? file : `${cwd ?? active.root}/${file}`
    body += `\n${await $.fs.read(path).catch(() => '')}`
  }
  const missing = headingsOf(template).filter(h => !body.split('\n').some(line => line.trim() === h))
  if (missing.length > 0) problems.push(`body is missing ${missing.length} of the template's headings (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''})`)

  if (problems.length === 0) return null

  const filled = (await fillTemplate($, active, template)) ?? bodyOf(template)
  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp/').replace(/\/?$/, '/')
  const draft = `${tmp}org-conformance/pr-${active.name}-${active.branch.replace(/[^a-z0-9]+/gi, '-')}.md`
  await $.fs.write(draft, filled)

  return [
    `org-conformance: this PR does not follow the org template. Branch "${active.branch}" routes to ${active.template}.md; ${problems.join('; ')}.`,
    `A filled draft is at ${draft} — read it, complete any empty sections from what you know of the work (never invent), then re-run with:`,
    `  --title "${want?.pattern ?? '…'}"   (fill the placeholders)`,
    `  --body-file ${draft}`,
  ].join('\n')
}

async function statusOf($: any, root: string): Promise<RepoStatus> {
  const branch = (await git($, root, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()
  const dirty = (await git($, root, 'status', '--porcelain')).stdout
    .split('\n')
    .filter(Boolean).length
  const hasDevelop =
    (await git($, root, 'rev-parse', '--verify', '-q', BASE)).exitCode === 0
  const { isValid, reason } = await validate($, branch)
  const template = await templateFor($, branch)

  return {
    root,
    name: root.split('/').filter(Boolean).pop() ?? root,
    branch,
    isValid,
    reason,
    hasDevelop,
    dirty,
    template,
  }
}

/** The repo the model last worked in, so the band follows the work. */
let touched: string | null = null

/** Repo@branch pairs already warned about in the panel this session. */
const warned = new Set<string>()
let checkedAt = 0

/** Resolved repo root per directory, so a Bash call costs no extra probe. */
const rootOf = new Map<string, string>()

const IGNORED = /^\/(dev|tmp|private|proc|usr|bin|etc|var)\b/

/** The repo a path sits in, probed once per directory and remembered. */
async function repoAt($: any, path: string): Promise<string | null> {
  if (IGNORED.test(path)) return null
  const known = rootOf.get(path)
  if (known !== undefined) return known === '' ? null : known

  const found = (
    await sh($, [
      'bash',
      '-c',
      `cd ${JSON.stringify(path)} 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null`,
    ])
  ).stdout.trim()

  rootOf.set(path, found)

  return found === '' ? null : found
}

/** Puts the repo `path` sits in (absolute, ~, or relative to the session root) in focus. */
async function touch($: any, path: string) {
  if (path.startsWith('-') || path.includes('$')) return
  const home = (await $.env.get('HOME')) ?? ''
  const absolute = path.startsWith('/')
    ? path
    : path === '~' || path.startsWith('~/')
      ? `${home}${path.slice(1)}`
      : `${await $.session.root()}/${path}`
  const found = await repoAt($, absolute)
  if (found !== null && !NOT_ORG.test(found)) touched = found
}

async function refresh($: any, isForced = false) {
  const now = await $.clock.now()
  if (!isForced && now - checkedAt < STALE_MS) return
  checkedAt = now

  const roots = await findRepos($)
  if (roots.length === 0) {
    await update($, status, () => null)
    return
  }

  // The repo the work touched wins, even one the scan did not list; the
  // first repo is only the band's fallback before anything was touched.
  const pick = touched ?? roots[0]
  const active = await statusOf($, pick)

  let offStandard = 0
  for (const root of roots) {
    if (root === pick) continue
    const branch = (await git($, root, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()
    const checked = await validate($, branch)
    if (!checked.isValid) offStandard += 1
  }

  const next: Conformance = { active, offStandard, total: roots.length }
  await update($, status, () => next)
}

/**
 * Name a branch from `asked` (a description, or a name already well formed),
 * check it against the org validator and cut it from develop. Shared by
 * /branch and the panel warning's "Other" answer; resolves to the reply.
 */
async function cutBranch($: any, asked: string): Promise<string> {
  await refresh($, true)
  const active = (await read($, status))?.active
  if (!active) return 'org-conformance: no git repository found here.'

  // Already a well-formed name? Use it. Otherwise ask Haiku for one.
  let name = asked
  let note = ''
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(asked)) {
    const org = await orgRoot($)
    const allowed = (await sh($, ['bash', '-c', `sed -n '/^branch_types:/,$p' ${org}/${TYPE_MAP} | grep -oE '^  [a-z0-9-]+:' | tr -d ' :' | paste -sd, -`])).stdout.trim()
    const reply = await $.model.complete({
      model: 'haiku',
      effort: 'low',
      maxTokens: 40,
      system:
        'You name git branches for LightSpeedWP. Answer with one branch name and nothing else. Form: {type}/{scope}-{title}. Lowercase, digits and single hyphens only. No underscores, dots, spaces or consecutive hyphens. Exactly one slash.',
      prompt: `Allowed types: ${allowed}\n\nWork described as: ${asked}\n\nBranch name:`,
    })
    if (!reply.isAnswered) return 'org-conformance: could not reach the model to propose a name.'
    name = reply.text.trim().split(/\s+/)[0]
    note = `(proposed by haiku from "${asked}")\n`
  }

  const checked = await validate($, name)
  if (!checked.isValid) {
    return `${note}"${name}" still fails the org standard: ${checked.reason}\nNothing was created.`
  }

  if (!active.hasDevelop) {
    return `${note}"${name}" is conformant, but ${active.name} has no "${BASE}" branch.\nCreate the base first, then re-run:\n  git -C ${active.root} branch ${BASE}\nNothing was created.`
  }
  if (active.dirty > 0) {
    return `${note}"${name}" is conformant, but ${active.name} has ${active.dirty} uncommitted file(s) — switching now would carry them across.\nDeal with those, then:\n  git -C ${active.root} checkout -b ${name} ${BASE}\nNothing was created.`
  }

  const made = await git($, active.root, 'checkout', '-b', name, BASE)
  await refresh($, true)
  return made.exitCode === 0
    ? `${note}Created "${name}" from ${BASE} in ${active.name}. Nothing staged or committed.`
    : `${note}git refused: ${made.stderr.trim() || made.stdout.trim()}`
}

const KEEP = 'Keep warning me'
const HIDE = 'Hide for this session'
const ROUNDS = 3

/**
 * The panel's warning dialog. Anything typed under "Other" is a branch
 * description, cut as /branch would; the outcome comes back in the same
 * dialog, since the panel draws nothing else, so a refusal can be retried.
 */
async function offerBranch($: any, question: string): Promise<void> {
  for (let round = 0; round < ROUNDS; round++) {
    const pick = (await $.ui.ask(question, { header: 'Branch', options: [KEEP, HIDE] })).trim()
    if (pick === HIDE) return void (await update($, isHidden, () => true))
    if (pick === KEEP || !pick) return

    const outcome = await cutBranch($, pick)
    if (/^(?:\(proposed[^\n]*\n)?Created "/.test(outcome)) {
      const done = await $.ui.ask(`${outcome}\n\nHide branch warnings for this session?`, {
        header: 'Branch',
        options: [KEEP, HIDE],
      })
      if (done.trim() === HIDE) await update($, isHidden, () => true)
      return
    }
    question = `${outcome}\n\nType another description under Other to try again. Hide these warnings?`
  }
}

/**
 * True in the VS Code chat panel, which draws no band, toast or status line.
 * Measured on 2.1.292: the panel reports no surface at all (`surfaces()` is
 * empty), so its process's entrypoint is what says it is the panel.
 */
async function isPanel($: any): Promise<boolean> {
  const surfaces = await $.session.surfaces()
  if (surfaces.includes('vscode')) return true
  return surfaces.length === 0 && (await $.env.get('CLAUDE_CODE_ENTRYPOINT')) === 'claude-vscode'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'branch',
      description: 'Cut an org-conformant branch from develop',
    })
    await $.command.register({
      name: 'pr',
      description: 'Resolve and fill the org PR template for this branch',
    })
    refresh($, true).catch(() => {})

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    refresh($).catch(() => {})

    return next(e)
  })

  /**
   * The VS Code panel draws no band, only the AskUserQuestion dialog. There,
   * an off-standard repo is asked about once per repo and branch, at the end
   * of a turn, so the dialog never pauses the model mid-work.
   */
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    if (!(await isPanel($))) return r
    if (await read($, isHidden)) return r

    await refresh($, true).catch(() => {})
    const active = (await read($, status))?.active
    // Only a repo this session actually worked in: never the scan's fallback.
    if (!active || touched === null || active.root !== touched) return r
    if (active.isValid && active.hasDevelop) return r

    const key = `${active.root}@${active.branch}`
    if (warned.has(key)) return r
    warned.add(key)

    const problems = [
      !active.isValid && `"${active.branch}" fails the org standard (${active.reason})`,
      !active.hasDevelop && `there is no ${BASE} branch`,
    ].filter(Boolean)

    void offerBranch(
      $,
      `${active.name}: ${problems.join('; ')}. Type a description under Other to cut a conformant branch from ${BASE}, or run /branch <description>. Hide these warnings?`,
    ).catch(() => {})

    return r
  })

  /** Refuse a branch name the org validator rejects, before it exists. */
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = e.command
    const cut =
      /git\s+(?:-C\s+\S+\s+)?(?:checkout\s+-b|switch\s+-c|branch)\s+([^\s;&|]+)/.exec(
        command,
      )

    if (cut && !cut[1].startsWith('-')) {
      const name = cut[1]
      const checked = await validate($, name)
      if (!checked.isValid) {
        return {
          deny: `org-conformance: "${name}" fails the org branch standard (${checked.reason}). The form is {type}/{scope}-{title} with an allowed type — "feature" is not one, "feat" is. Run /branch to get a conformant name.`,
        }
      }
    }

    let cwd: string | null = null
    for (const hit of command.matchAll(/(?:-C\s+|cd\s+)(["']?)([^\s;&|'"]+)\1/g)) {
      await touch($, hit[2])
      if (hit[0].startsWith('cd')) cwd = hit[2].startsWith('/') ? hit[2] : `${await $.session.root()}/${hit[2]}`
    }

    // A PR opened by the model must use the org template its branch routes to.
    if (/\bgh\s+pr\s+create\b/.test(command)) {
      const refused = await checkPr($, command, cwd).catch(() => null)
      if (refused) return { deny: refused }
    }

    const ran = await next(e)
    if (/\bgit\b/.test(command)) refresh($, true).catch(() => {})

    return ran
  })

  /** A file the model reads or writes puts its repo in focus too. */
  on('tool.call', async ($, e, next) => {
    const path = (e as any).file_path ?? (e as any).notebook_path
    if (e.tool !== 'Bash' && typeof path === 'string' && path.startsWith('/')) {
      await touch($, path.replace(/\/[^/]*$/, '') || '/')
    }
    return next(e)
  })

  on('command.run', { command: 'branch' }, async ($, e) => {
    const asked = e.args.trim()
    if (asked) return { text: await cutBranch($, asked) }

    await refresh($, true)
    const active = (await read($, status))?.active
    if (!active) return { text: 'org-conformance: no git repository found here.' }
    const verdict = active.isValid ? 'conformant' : `NOT conformant — ${active.reason}`
    return {
      text: `${active.name} is on "${active.branch}" (${verdict}).\nBase "${BASE}" ${active.hasDevelop ? 'exists' : 'is MISSING'}; ${active.dirty} uncommitted file(s).\n\nGive me a description to get a name: /branch 404 template for the theme`,
    }
  })

  on('command.run', { command: 'pr' }, async ($, e) => {
    await refresh($, true)
    const active = (await read($, status))?.active
    if (!active) return { text: 'org-conformance: no git repository found here.' }
    if (!active.template) {
      return {
        text: `"${active.branch}" has no org branch type, so no PR template routes to it.${active.isValid ? '' : ` It also fails validation: ${active.reason}`}`,
      }
    }

    const body = await templateText($, active.template)
    if (!body.trim()) {
      return { text: `org-conformance: template ${active.template} not found in ${await orgRoot($)}/${TEMPLATES}.` }
    }

    const wants = e.args.trim() === 'raw'
    if (wants) return { text: `Template for "${active.branch}" -> ${active.template}\n\n${body}` }

    const filled = await fillTemplate($, active, body)
    if (filled === null) return { text: `Template for "${active.branch}" -> ${active.template}\n\n${body}` }

    const title = titlePrefixOf(body)
    return {
      text: `${active.template} (routed from type "${active.branch.split('/')[0]}")${title ? `\nTitle: ${title.pattern}` : ''}\n\n${filled}`,
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await read($, status)
    const active = now?.active
    if (!active || e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const isClean = active.isValid && active.hasDevelop

    return (
      <Box>
        <Text dimColor>{active.name} </Text>
        <Text color={isClean ? 'green' : 'yellow'}>{active.branch}</Text>
        {!active.isValid && <Text color="yellow"> ✗ {active.reason}</Text>}
        {!active.hasDevelop && <Text color="yellow"> · no {BASE}</Text>}
        {active.dirty > 0 && <Text dimColor> · {active.dirty} dirty</Text>}
        {active.template && <Text dimColor> · {active.template}</Text>}
        {now.offStandard > 0 && (
          <Text dimColor> · +{now.offStandard} off-standard</Text>
        )}
        <Text dimColor> </Text>
        <Button key="hide" label="hide" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}

import type { Register } from 'claude-code'

/**
 * lightspeedwp/.github runs "Changelog Quality Validation" on every PR and
 * blocks the merge on new failures. Its validator needs an npm install the
 * team does not have locally, so the first anyone hears of a bad entry is a
 * red check. These are the same rules, read from the org's own rules.json,
 * applied the moment the entry is written.
 *
 * CHK_LINK_VALIDITY needs the GitHub API and CHK_CONSISTENT_TENSE is too
 * heuristic to assert offline; both are left to CI.
 */
const RULES_PATH = '.github/validation/changelog/rules.json'

type Rules = {
  maxLength: number
  banned: string[]
  acronyms: string[]
}

type Finding = { severity: string; rule: string; entry: string; said: string }

let cached: Rules | null = null

async function loadRules($: any): Promise<Rules | null> {
  if (cached !== null) return cached

  const home = (await $.env.get('HOME')) ?? ''
  let raw = ''
  try {
    const ran = await $.process.run(['cat', `${home}/.github/${RULES_PATH}`], { timeoutMs: 10000 })
    raw = ran.stdout ?? ''
  } catch {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    const find = (id: string) => parsed.rules?.find((rule: any) => rule.rule_id === id)
    const length = /(\d+)/.exec(find('CHK_MAX_LENGTH')?.validation_logic ?? '')
    cached = {
      maxLength: length ? Number(length[1]) : 250,
      banned: find('CHK_NO_IMPL_DETAILS')?.banned_keywords ?? [],
      acronyms: find('CHK_NO_ABBREVIATIONS')?.known_acronyms ?? [],
    }
    return cached
  } catch {
    return null
  }
}

/** The bullet entries under ## [Unreleased]. */
function unreleasedEntries(markdown: string): string[] {
  const start = /^##\s*\[?Unreleased\]?/im.exec(markdown)
  if (start === null) return []
  const rest = markdown.slice(start.index + start[0].length)
  const end = /^##\s/m.exec(rest)
  const section = end === null ? rest : rest.slice(0, end.index)

  return section
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[-*]\s+\S/.test(line))
    .map(line => line.replace(/^[-*]\s+/, ''))
}

function similarity(a: string, b: string): number {
  const long = a.length >= b.length ? a : b
  const short = a.length >= b.length ? b : a
  if (long.length === 0) return 1

  let previous = Array.from({ length: short.length + 1 }, (_, i) => i)
  for (let i = 1; i <= long.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= short.length; j += 1) {
      const cost = long[i - 1] === short[j - 1] ? 0 : 1
      row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost)
    }
    previous = row
  }

  return (long.length - previous[short.length]) / long.length
}

function check(entries: string[], rules: Rules): Finding[] {
  const found: Finding[] = []
  const brief = (entry: string) => (entry.length > 48 ? `${entry.slice(0, 48)}…` : entry)

  entries.forEach((entry, index) => {
    const plain = entry.replace(/`[^`]*`/g, '')

    if (entry.length > rules.maxLength) {
      found.push({ severity: 'critical', rule: 'CHK_MAX_LENGTH', entry: brief(entry), said: `${entry.length} chars, limit ${rules.maxLength}` })
    }

    if (!/#\d+/.test(entry)) {
      found.push({ severity: 'critical', rule: 'CHK_HAS_PR_LINK', entry: brief(entry), said: 'no PR or issue reference (#1234)' })
    }

    const banned = rules.banned.filter(word =>
      new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(plain),
    )
    if (banned.length > 0) {
      found.push({ severity: 'critical', rule: 'CHK_NO_IMPL_DETAILS', entry: brief(entry), said: `implementation detail: ${banned.slice(0, 3).join(', ')}` })
    }

    if (/<[a-z][^>]*>/i.test(entry)) {
      found.push({ severity: 'high', rule: 'CHK_FORMAT_MARKDOWN', entry: brief(entry), said: 'raw HTML tag' })
    }
    if ((entry.match(/\*\*/g) ?? []).length % 2 !== 0 || (entry.match(/`/g) ?? []).length % 2 !== 0) {
      found.push({ severity: 'high', rule: 'CHK_FORMAT_MARKDOWN', entry: brief(entry), said: 'unbalanced ** or `' })
    }

    const shouty = (plain.match(/(?<![A-Z])[A-Z]{2,}(?![a-z])/g) ?? []).filter(
      word => !rules.acronyms.includes(word),
    )
    if (shouty.length > 0) {
      found.push({ severity: 'medium', rule: 'CHK_NO_ABBREVIATIONS', entry: brief(entry), said: `unknown abbreviation: ${[...new Set(shouty)].slice(0, 3).join(', ')}` })
    }

    for (let other = index + 1; other < entries.length; other += 1) {
      if (similarity(entry, entries[other]) > 0.9) {
        found.push({ severity: 'high', rule: 'CHK_UNIQUE_CONTENT', entry: brief(entry), said: 'near-duplicate of another entry' })
        break
      }
    }
  })

  return found
}

function report(findings: Finding[]): string {
  const order = ['critical', 'high', 'medium']
  const sorted = [...findings].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))

  return sorted
    .map(one => `  ${one.severity.padEnd(8)} ${one.rule}\n    "${one.entry}" — ${one.said}`)
    .join('\n')
}

/** The Unreleased entries of a file on disk. */
async function readEntries($: any, path: string): Promise<string[]> {
  try {
    const ran = await $.process.run(['cat', path], { timeoutMs: 10000 })
    return unreleasedEntries(ran.stdout ?? '')
  } catch {
    return []
  }
}

/**
 * The Unreleased entries as develop has them. CI gates only on failures a
 * branch introduces — "pre-existing Unreleased failures do not block" — so
 * this mod scopes to the same set, or the whole file reads as noise.
 */
async function baseEntries($: any, path: string): Promise<string[] | null> {
  const cut = path.lastIndexOf('/')
  const dir = cut === -1 ? '.' : path.slice(0, cut)
  const name = cut === -1 ? path : path.slice(cut + 1)
  try {
    const ran = await $.process.run(
      ['bash', '-c', `cd ${JSON.stringify(dir)} 2>/dev/null && git show develop:./${name} 2>/dev/null`],
      { timeoutMs: 10000 },
    )
    const text = ran.stdout ?? ''
    return text.trim() === '' ? null : unreleasedEntries(text)
  } catch {
    return null
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
  let touchedSource = false
  let touchedChangelog = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'changelog',
      description: "Check this branch's new Unreleased entries against the org rules",
    })

    return next(e)
  })

  on('command.run', { command: 'changelog' }, async ($, e) => {
    const rules = await loadRules($)
    if (rules === null) {
      return { text: `changelog-guard: could not read the org rules at ~/.github/${RULES_PATH}` }
    }

    const target = e.args.trim() === '' ? 'CHANGELOG.md' : e.args.trim()
    const all = await readEntries($, target)
    if (all.length === 0) {
      return { text: `changelog-guard: no entries under ## [Unreleased] in ${target}.` }
    }

    const base = await baseEntries($, target)
    const mine = base === null ? all : all.filter(entry => !base.includes(entry))
    const inherited = all.length - mine.length

    if (mine.length === 0) {
      return {
        text: `changelog-guard: ${target} has ${all.length} Unreleased entries, none of them added on this branch. Nothing for CI to gate on.`,
      }
    }

    const findings = check(mine, rules)
    const context =
      inherited > 0
        ? `\n\n${inherited} pre-existing entr${inherited === 1 ? 'y' : 'ies'} were not checked — CI does not gate on those.`
        : ''

    if (findings.length === 0) {
      return {
        text: `changelog-guard: ${mine.length} new entr${mine.length === 1 ? 'y' : 'ies'} on this branch, all passing the org rules.${context}`,
      }
    }

    return {
      text: `changelog-guard: ${findings.length} issue(s) in the ${mine.length} entr${mine.length === 1 ? 'y' : 'ies'} this branch adds — CI blocks the merge on critical and high.\n\n${report(findings)}${context}\n\nCHK_LINK_VALIDITY and CHK_CONSISTENT_TENSE are left to CI.`,
    }
  })

  /** This turn's rule issues, for the VS Code panel, which draws no toast. */
  let pending: string[] = []

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) pending = []
    return next(e)
  })

  /**
   * The panel draws only the AskUserQuestion dialog. Asking mid-turn would
   * pause the model, so the turn's issues are asked about once it ends.
   */
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId || pending.length === 0) return r
    const issues = pending
    pending = []
    if (!(await isPanel($))) return r

    void $.ui
      .ask(`${issues.join(' ')} Ask Claude to fix the entries?`, {
        header: 'Changelog',
        options: ['Ask Claude to fix them', 'Dismiss'],
      })
      .then(pick =>
        pick === 'Ask Claude to fix them'
          ? $.prompt.submit({ text: `${issues.join(' ')} Fix the CHANGELOG entries you added this turn so they pass the org's Changelog Quality rules (Keep a Changelog 1.1.0, tagged with the Linear issue).` })
          : undefined,
      )
      .catch(() => {})

    return r
  })

  on('tool.call', async ($, e, next) => {
    const path = String((e as any).file_path ?? '')
    const isChangelog = /CHANGELOG\.md$/i.test(path)
    const isWrite = e.tool === 'Write' || e.tool === 'Edit'

    if (isWrite && !isChangelog && /\.(php|js|ts|tsx|jsx|css|scss|json)$/i.test(path)) {
      touchedSource = true
    }

    if (!isWrite || !isChangelog) {
      const ran = await next(e)
      if (touchedSource && !touchedChangelog) {
        $.ui.status('changelog: not updated yet on this branch')
      }
      return ran
    }

    const before = await readEntries($, path)
    const ran = await next(e)

    touchedChangelog = true
    $.ui.status(undefined)

    const rules = await loadRules($)
    if (rules === null) return ran

    const after = await readEntries($, path)
    const added = after.filter(entry => !before.includes(entry))
    if (added.length === 0) return ran

    const findings = check(added, rules)
    const blocking = findings.filter(one => one.severity !== 'medium')

    if (findings.length > 0) {
      const said = `changelog-guard: ${findings.length} rule issue(s) in the ${added.length} entr${added.length === 1 ? 'y' : 'ies'} just added${blocking.length > 0 ? ` — ${blocking.length} would block the merge` : ''}. Run /changelog for detail.`
      $.ui.toast(said)
      pending.push(`${said}\n${report(findings)}`)
    }

    return ran
  })
}

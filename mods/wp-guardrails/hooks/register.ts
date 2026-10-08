import type { Register } from 'claude-code'

/** The default memory limit OOMs on these installs; 31 of 445 calls forgot it. */
const WRAPPER = 'php -d memory_limit=1024M $(which wp)'
const BARE_WP = /(^|[;&|]\s*|&&\s*|\|\|\s*)wp\s+(?!--version)/g

/** Zared reviews every change before it enters history. No exceptions. */
const WRITES_HISTORY = /(^|[;&|]\s*)git\s+(?:-C\s+\S+\s+)?(commit|push)\b/

/**
 * A branch cut from a remote ref tracks that ref: `git switch -c
 * test/asd-36-example origin/develop` leaves the new branch's upstream at
 * origin/develop, so the first plain push from the editor lands the work on
 * develop. It happened on sd-enhancements on 2026-10-08, and before.
 * `--no-track` leaves the branch with no upstream, so the first push publishes
 * it under its own name.
 */
const CUTS_TRACKING_BRANCH =
  /(^|[;&|]\s*)(git\s+(?:-C\s+\S+\s+)?(?:switch\s+(?:-c|--create|-C)|checkout\s+-[bB]|branch))(?![^;&|]*--(?:no-)?track)(?=\s+[^;&|]*\s(?:origin|upstream)\/)/g

/** Files whose whole contents must never reach the transcript. */
const READS_SECRET =
  /(^|[;&|]\s*)(cat|less|more|head|tail|bat)((\s+-{1,2}[^\s;&|]+)*)\s+["']?([^\s;&|"'>]*\/)?(wp-config\.php|\.env(\.[a-z0-9]+)?|\.mcp\.json)["']?(\s|$|[;&|])/

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const command = e.command

    if (WRITES_HISTORY.test(command)) {
      return {
        deny: 'wp-guardrails: committing and pushing are Zared\'s, not yours. Leave the work in the working tree and hand it over with the commit message as text he can copy.',
      }
    }

    if (READS_SECRET.test(command)) {
      return {
        deny: 'wp-guardrails: that file holds live credentials and must not be echoed whole. Grep the one constant you need instead, e.g. grep -n "DB_NAME" wp-config.php.',
      }
    }

    if (CUTS_TRACKING_BRANCH.test(command)) {
      CUTS_TRACKING_BRANCH.lastIndex = 0
      $.ui.toast('wp-guardrails: cut the branch with --no-track, so it does not push to its base')

      return next({ ...e, command: command.replace(CUTS_TRACKING_BRANCH, '$1$2 --no-track') })
    }

    if (command.includes('memory_limit') || !BARE_WP.test(command)) {
      return next(e)
    }

    BARE_WP.lastIndex = 0
    const fixed = command.replace(BARE_WP, (_m, lead: string) => `${lead}${WRAPPER} `)
    $.ui.toast('wp-guardrails: added the WP-CLI memory flag')

    return next({ ...e, command: fixed })
  })
}

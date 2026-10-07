import type { Register } from 'claude-code'

/**
 * lightspeedwp/.github specifies a `secrets-scanner` hook — "scans changed
 * files for likely secrets before commit or release workflows" — but ships
 * only a README; no patterns were ever written. This implements it at the
 * point it actually helps: before the write lands.
 *
 * It has already happened twice in this org: a Trustpilot API key committed
 * to sd-lsx-child, and Salesforce production credentials in plaintext.
 *
 * Rule: name the file and the kind of secret, NEVER echo the value.
 */
type Signature = { name: string; pattern: RegExp }

const SIGNATURES: Signature[] = [
  { name: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub personal access token', pattern: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { name: 'GitHub OAuth/server token', pattern: /\bgh[osur]_[A-Za-z0-9]{36}\b/ },
  { name: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Stripe live key', pattern: /\bsk_live_[0-9a-zA-Z]{20,}\b/ },
  { name: 'OpenAI-style key', pattern: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'private key block', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'JSON private_key field', pattern: /"private_key"\s*:\s*"-{5}BEGIN/ },
  { name: 'bearer token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}={0,2}/ },
  { name: 'basic auth in a URL', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]{6,}@/i },
]

/** A quoted assignment to a secret-shaped name, long enough to be real. */
const ASSIGNED =
  /\b(api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd|db_password|private[_-]?key)\b\s*[:=]>?\s*["']([^"'\n]{12,})["']/gi

/** A masked or templated value: never a credential. */
const IS_MASK =
  /^(?:x{3,}|\*{3,}|\.{3,}|-{3,}|none|null|true|false|<[^>]*>|\$\{[^}]*\}|%[A-Za-z_]+%|\{\{[^}]*\}\})$/i

/**
 * A lower-case kebab phrase naming itself a placeholder ("your-api-key-here").
 * Deliberately case-sensitive: a real credential carries upper case or high
 * entropy, so this cannot swallow one.
 */
const IS_WORDY =
  /^[a-z0-9._-]*\b(?:changeme|placeholder|your|example|dummy|sample|fake|redacted|todo|here|insert|replace|goes)\b[a-z0-9._-]*$/

function isPlaceholder(value: string): boolean {
  return IS_MASK.test(value) || IS_WORDY.test(value)
}

/** Files that exist to hold credentials and must never be authored here. */
const SECRET_FILE = /(^|\/)(\.env(\.[a-z0-9]+)?|\.mcp\.json|wp-config\.php|id_rsa|id_ed25519|\.netrc|credentials\.json)$/

/** Returns the kinds of secret found, never the values. */
function findSecrets(text: string): string[] {
  const found = new Set<string>()

  for (const signature of SIGNATURES) {
    if (signature.pattern.test(text)) found.add(signature.name)
  }

  ASSIGNED.lastIndex = 0
  let hit = ASSIGNED.exec(text)
  while (hit !== null) {
    const value = hit[2]
    if (!isPlaceholder(value) && /[A-Za-z]/.test(value) && /[0-9\W]/.test(value)) {
      found.add(`hard-coded ${hit[1].toLowerCase().replace(/[_-]/g, ' ')}`)
    }
    hit = ASSIGNED.exec(text)
  }

  return [...found]
}

/** The text a call would write, whichever tool is writing it. */
function writtenBy(e: any): { text: string; path: string } | null {
  if (e.tool === 'Write') return { text: String(e.content ?? ''), path: String(e.file_path ?? '') }
  if (e.tool === 'Edit') return { text: String(e.new_string ?? ''), path: String(e.file_path ?? '') }
  if (e.tool === 'Bash') {
    const command = String(e.command ?? '')
    const isWriting = /(^|[;&|]\s*)(cat|tee|printf|echo)\b[^|;&]*>>?\s*\S/.test(command) || /<<\s*['"]?\w+['"]?/.test(command)
    return isWriting ? { text: command, path: '' } : null
  }
  return null
}

export const register: Register = on => {
  on('tool.call', ($, e, next) => {
    const writing = writtenBy(e)
    if (writing === null) return next(e)

    if (writing.path !== '' && SECRET_FILE.test(writing.path)) {
      return {
        deny: `secret-sentinel: ${writing.path} is a credentials file — it is not authored through the agent, and its contents must never reach the transcript or a commit.`,
      }
    }

    const found = findSecrets(writing.text)
    if (found.length === 0) return next(e)

    const where = writing.path === '' ? 'this command' : writing.path
    return {
      deny: `secret-sentinel: refusing to write ${found.join(', ')} into ${where}. Put the value in an environment variable or a gitignored local config and reference it by name. (The value is deliberately not repeated here.) If this is a false positive, rename the variable or move the sample value out of a quoted literal.`,
    }
  })
}

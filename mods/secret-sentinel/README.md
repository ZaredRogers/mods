# secret-sentinel

Refuses to write a credential into a file — and refuses to author a credentials file at all.

## Why it exists

`lightspeedwp/.github` specifies a `secrets-scanner` hook ("scans changed files for likely
secrets before commit or release workflows") but ships only a README; no patterns were ever
written. This implements it at the point it actually helps: **before the write lands**, not
before the commit.

It has already happened twice in this org — a Trustpilot API key committed to `sd-lsx-child`,
and Salesforce production credentials stored in plaintext.

## What it does

Hooks `tool.call` on every write-shaped call — `Write`, `Edit`, and a `Bash` command that
redirects, `tee`s or heredocs into a file — and denies it if either check fires.

**1. The target is a credentials file.** Denied outright, whatever the content:

```
.env  .env.*  .mcp.json  wp-config.php  id_rsa  id_ed25519  .netrc  credentials.json
```

**2. The content looks like a secret.** Twelve signatures — AWS access key ids, GitHub PATs
(classic and fine-grained), Slack tokens, Google API keys, Stripe live keys, OpenAI-style keys,
PEM private-key blocks, `Bearer` tokens, basic auth embedded in a URL — plus any quoted
assignment to a secret-shaped name (`api_key`, `client_secret`, `db_password`, …) with a value
of 12 characters or more.

**The deny message names the kind of secret and the file. It never repeats the value.**
That is the whole point: a mod that echoed the credential back would put it in the transcript,
which is the thing it exists to prevent.

## False positives

Placeholders are allowed through. A value is treated as a placeholder when it is masked
(`xxxx`, `****`, `<token>`, `${VAR}`, `%VAR%`, `{{var}}`) or when it is a lower-case kebab
phrase that names itself one (`your-api-key-here`, `changeme`, `replace-me`). The wordy test
is deliberately case-sensitive — a real credential carries upper case or high entropy, so it
cannot be swallowed by it.

If a legitimate write is blocked: rename the variable, or move the sample value out of a
quoted literal.

## Known gaps

- A secret pasted into a file by a tool this mod does not see (an MCP write, `git apply`) is
  not caught.
- It inspects the text being written, not the file as a whole, so a credential already on
  disk is not found. That is a scanner's job, not a gate's.

## Files

- `hooks/register.ts` — the gate
- `tests/secret-sentinel.test.ts` — signature and placeholder cases

#!/usr/bin/env bun
/*
Pre-`changeset version` gap-filler. Changesets only documents changes that ship
with a changeset file, so a commit pushed without one is invisible to the release
notes. This synthesises a changeset for every commit since the last release that
touches the published package yet added no changeset of its own, deriving the bump
and summary from the conventional-commit subject. Hand-written changesets always
win — a commit that added one is left untouched.

Idempotent: each synthesised file is named `auto-<shortHash>.md`, so re-running
(e.g. the release action refreshing the Version Packages PR) never duplicates an
entry. Runs inside `version-packages`, so both local and CI versioning fill the gap.
*/
import { $ } from 'bun'

const REPO = 'briancray/belte'
const PACKAGE = '@briancray/belte'

// Paths whose changes actually ship in the npm tarball (package.json `files`);
// a commit touching only tests/examples/docs is not release-noteworthy.
const SHIPPED_PREFIXES = [
    'packages/belte/src',
    'packages/belte/template',
    'packages/belte/bin',
    'packages/belte/tsconfig.app.json',
]

type Bump = 'minor' | 'patch'

/*
The last release boundary: the most recent commit that changed the package
version (every `changeset version` run rewrites it). Tags are unreliable here —
0.3.x shipped without them — so anchor on package.json. Empty when the package
has never been versioned, which makes the range the whole history.
*/
async function lastReleaseCommit(): Promise<string> {
    const hash =
        await $`git log -1 --format=%H -G ${'"version"'} -- packages/belte/package.json`.text()
    return hash.trim()
}

/*
Conventional-commit subject → bump + cleaned note. `feat` is a feature (minor);
everything else that ships is a patch. A `!` marker or `BREAKING CHANGE` body stays
minor — major is reserved pre-1.0 — but is flagged so the migration note is visible.
*/
function classify(subject: string, body: string): { bump: Bump; note: string } {
    const match = subject.match(/^(\w+)(?:\([^)]*\))?(!)?:\s*(.+)$/)
    const type = match?.[1] ?? ''
    const breaking = Boolean(match?.[2]) || /BREAKING CHANGE/.test(body)
    const description = match?.[3] ?? subject
    const bump: Bump = type === 'feat' ? 'minor' : 'patch'
    return { bump, note: breaking ? `Breaking: ${description}` : description }
}

// Files (with status) a commit changed, as raw `--name-status` lines.
async function changedEntries(hash: string): Promise<string[]> {
    const out = await $`git show --name-status --format= ${hash}`.text()
    return out
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
}

const anchor = await lastReleaseCommit()
const range = anchor ? `${anchor}..HEAD` : 'HEAD'
const log = await $`git log --no-merges --reverse --format=%H ${range}`.text()
const hashes = log
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

for (const hash of hashes) {
    const entries = await changedEntries(hash)
    // The path is everything after the status column (handles renames loosely).
    const paths = entries.map((line) => line.split(/\s+/).slice(1).join(' '))
    const touchesShipped = paths.some((path) =>
        SHIPPED_PREFIXES.some((prefix) => path.startsWith(prefix)),
    )
    if (!touchesShipped) {
        continue
    }
    // A changeset committed alongside the change is authoritative — leave it be.
    const addedChangeset = entries.some((line) =>
        /^A\s+\.changeset\/(?!README\.md).+\.md$/.test(line),
    )
    if (addedChangeset) {
        continue
    }
    const short = hash.slice(0, 7)
    const file = `.changeset/auto-${short}.md`
    if (await Bun.file(file).exists()) {
        continue
    }
    const subject = (await $`git log -1 --format=%s ${hash}`.text()).trim()
    const body = (await $`git log -1 --format=%b ${hash}`.text()).trim()
    const { bump, note } = classify(subject, body)
    const link = `[\`${short}\`](https://github.com/${REPO}/commit/${hash})`
    await Bun.write(file, `---\n"${PACKAGE}": ${bump}\n---\n\n${note} (${link})\n`)
    console.log(`autofilled ${file}: ${bump} — ${note}`)
}

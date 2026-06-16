#!/usr/bin/env bun
/*
Pre-`changeset version` gap-filler. Changesets only documents changes that ship
with a changeset file, so a commit pushed without one is invisible to the release
notes. This synthesises a changeset for every commit since the last release that
touches a published package yet added no changeset of its own, deriving the bump
and summary from the conventional-commit subject. Hand-written changesets always
win — a commit that added one is left untouched.

Multi-package: every public `packages/*` is covered, each owning the paths its
own package.json `files` ship. A commit is attributed to whichever package(s)
its changed files belong to, so a `@abide/claude-code` change bumps claude-code,
not abide; a commit spanning two packages lists both in one changeset.

Idempotent: each synthesised file is named `auto-<shortHash>.md`, so re-running
(e.g. the release action refreshing the Version Packages PR) never duplicates an
entry. Runs inside `version-packages`, so both local and CI versioning fill the gap.
*/
import { $, Glob } from 'bun'

const REPO = 'briancray/abide'

type Bump = 'minor' | 'patch'

type Package = {
    name: string
    manifest: string // its package.json path, the release anchor scans these
    // Path prefixes whose changes actually ship in this package's npm tarball
    // (its package.json `files`), so a commit touching only tests/docs/CHANGELOG
    // is not release-noteworthy. CHANGELOG is excluded — it's written by the
    // release itself, not a shippable source change.
    prefixes: string[]
}

// Every publishable package in the workspace, with the shipped prefixes it owns.
async function publishedPackages(): Promise<Package[]> {
    const manifests = await Array.fromAsync(new Glob('packages/*/package.json').scan('.'))
    const packages: Package[] = []
    for (const manifest of manifests.sort()) {
        const json = (await Bun.file(manifest).json()) as {
            name: string
            private?: boolean
            files?: string[]
        }
        if (json.private || !json.name) {
            continue
        }
        const dir = manifest.slice(0, manifest.length - '/package.json'.length)
        const files = (json.files ?? ['src']).filter((entry) => entry !== 'CHANGELOG.md')
        packages.push({
            name: json.name,
            manifest,
            prefixes: files.map((entry) => `${dir}/${entry}`),
        })
    }
    return packages
}

/*
The last release boundary: the most recent "chore: version packages" commit —
the fixed subject the release workflow gives every `changeset version` merge (see
release.yml). Matching the subject is package-count-independent and, unlike a
`"version"` pickaxe over the package.json files, never mistakes a commit that
*adds* a new package (its package.json brings a fresh version line) for a release.
Falls back to the version pickaxe for pre-workflow history that lacks the subject,
and is empty when nothing has ever been versioned (range = whole history).
*/
async function lastReleaseCommit(manifests: string[]): Promise<string> {
    const bySubject =
        await $`git log -1 --format=%H --grep ${'^chore: version packages'} --extended-regexp`.text()
    if (bySubject.trim()) {
        return bySubject.trim()
    }
    const byPickaxe = await $`git log -1 --format=%H -G ${'"version"'} -- ${manifests}`.text()
    return byPickaxe.trim()
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

const packages = await publishedPackages()
const anchor = await lastReleaseCommit(packages.map((pkg) => pkg.manifest))
const range = anchor ? `${anchor}..HEAD` : 'HEAD'
const log = await $`git log --no-merges --reverse --format=%H ${range}`.text()
const hashes = log
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

for (const hash of hashes) {
    const entries = await changedEntries(hash)
    // --name-status is tab-separated (`M\tpath`, `R100\told\tnew`). The last field is
    // the path that exists post-commit — the rename destination, or the sole path.
    const paths = entries.map((line) => line.split('\t').at(-1) ?? '')
    // Every package whose shipped prefixes this commit touched. A prefix matches the
    // path itself (a shipped file) or a child of it (a shipped dir); the `/` boundary
    // stops `packages/x/src` from also claiming a sibling like `packages/x/src-internal`.
    const owners = packages.filter((pkg) =>
        paths.some((path) =>
            pkg.prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
        ),
    )
    if (owners.length === 0) {
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
    const frontmatter = owners.map((pkg) => `"${pkg.name}": ${bump}`).join('\n')
    await Bun.write(file, `---\n${frontmatter}\n---\n\n${note} (${link})\n`)
    console.log(
        `autofilled ${file}: ${bump} — ${owners.map((pkg) => pkg.name).join(', ')} — ${note}`,
    )
}

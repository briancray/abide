/*
README surface inventory — the generative spine of the write-readme skill.
Instead of the skill hardcoding which surfaces exist (lists that go stale),
this derives them from the code every run:

  1. exports — each `exports` target must carry an `@readme <slug>` tag
     (co-located with the code so placement can't drift). Untagged = a new
     capability with no disposition: hard failure.
  2. env / routes — enumerated, split into documented vs internal-only.
  3. change ledger — every source surface and changeset added/removed since
     the README was last regenerated, so behaviour changes (not just new
     export keys) demand a conscious disposition.

Run: `bun run scripts/readmeSurfaces.ts`. Exits non-zero if any export is
untagged. Everything else is reported for the writer to account for.
*/

const ROOT = new URL('../', import.meta.url).pathname
const REPO = new URL('../../../', import.meta.url).pathname

/* env vars / routes that are dev/hot-reload/bundler plumbing — never in the README */
const INTERNAL_ENV = new Set([
    'ABIDE_DEV',
    'ABIDE_DEV_NO_WATCH',
    'ABIDE_PARENT_PID',
    'ABIDE_TARGET',
    'ABIDE_WEBVIEW_LIB',
    // OS-standard vars read for the data dir — not abide config to document
    'HOME',
    'APPDATA',
    'XDG_DATA_HOME',
])
const INTERNAL_ROUTES = new Set([
    '/__abide/dev',
    '/__abide/reload',
    '/__abide/resolve',
    '/__abide/disconnect',
    '/__abide/config',
])

/* run argv directly (no shell) so regex metacharacters pass through literally */
const run = (cmd: string[]) =>
    new Response(Bun.spawn(cmd, { cwd: REPO, stdout: 'pipe', stderr: 'ignore' }).stdout).text()

/* 1. exports → @readme tag */
const pkg = await Bun.file(`${ROOT}package.json`).json()
const exportsMap: Record<string, string> = pkg.exports
const bySlug = new Map<string, string[]>()
const untagged: string[] = []

/* one mapped export per file (project rule), so one @readme tag per file */
for (const [key, relative] of Object.entries(exportsMap)) {
    const path = ROOT + (relative as string).replace(/^\.\//, '')
    // tsconfig and other non-source targets carry no tag — treat as plumbing
    if (!path.endsWith('.ts')) {
        bySlug.set('plumbing', [...(bySlug.get('plumbing') ?? []), key])
        continue
    }
    const source = await Bun.file(path).text()
    const tag = source.match(/^\/\/ @readme ([a-z-]+)/m)?.[1]
    if (!tag) {
        untagged.push(key)
        continue
    }
    bySlug.set(tag, [...(bySlug.get(tag) ?? []), key])
}

/* 2. env + routes from source */
const grep = async (pattern: string) =>
    (await run(['grep', '-rhoE', pattern, 'packages/abide/src'])).split('\n').filter(Boolean)

const envVars = [
    ...new Set((await grep('(Bun|process)\\.env\\.[A-Z_]+')).map((m) => m.split('.').at(-1) ?? m)),
].sort()
const routes = [...new Set(await grep('/__abide/[a-z]+|/openapi\\.json'))].sort()

/* 3. change ledger since the README was last regenerated */
const lastReadmeCommit = (
    await run(['git', 'log', '-1', '--format=%H', '--', 'packages/abide/README.md'])
).trim()
const paths = ['packages/abide/src', 'packages/abide/package.json']
// diff the README commit against the WORKING TREE (no ..HEAD) so uncommitted
// surfaces count, then fold in untracked files git diff can't see
const trackedChanges = await run(['git', 'diff', '--name-status', lastReadmeCommit, '--', ...paths])
const untrackedChanges = (await run(['git', 'status', '--porcelain', '--', ...paths]))
    .split('\n')
    .filter((line) => line.startsWith('??'))
    .map((line) => `A\t${line.slice(3)}`)
    .join('\n')
const changedSurfaces = [trackedChanges.trim(), untrackedChanges.trim()].filter(Boolean).join('\n')
const changesets = (await run(['ls', '.changeset']))
    .split('\n')
    .filter((name) => name.endsWith('.md') && name !== 'README.md')

/* report */
const section = (title: string, body: string) => console.log(`\n### ${title}\n${body || '(none)'}`)

section(
    'exports by @readme disposition',
    [...bySlug.entries()]
        .sort()
        .map(([slug, keys]) => `${slug}: ${keys.join(', ')}`)
        .join('\n'),
)
section(
    'env vars',
    envVars
        .map((name) => `${INTERNAL_ENV.has(name) ? '  internal' : 'DOCUMENT '} ${name}`)
        .join('\n'),
)
section(
    'routes',
    routes
        .map((route) => `${INTERNAL_ROUTES.has(route) ? '  internal' : 'DOCUMENT '} ${route}`)
        .join('\n'),
)
section(`source surfaces changed since README (${lastReadmeCommit.slice(0, 7)})`, changedSurfaces)
section('pending changesets (each needs a disposition)', changesets.join('\n'))

if (untagged.length > 0) {
    console.error(
        `\nFAIL: ${untagged.length} export(s) with no @readme tag — a new capability with no home:\n` +
            untagged.map((key) => `  ${key}`).join('\n') +
            `\nAdd a // @readme <slug> line above each export, then place it at that altitude.`,
    )
    process.exit(1)
}
console.log('\nOK: every export carries an @readme disposition.')

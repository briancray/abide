/*
Documentation surface inventory — the generative spine of the docs (AGENTS.md
surface map + the kitchen-sink example nav). Instead of those hardcoding which
surfaces exist (lists that go stale), this derives them from the code every run:

  1. exports — each `exports` target must carry an `@documentation <slug>` tag
     (co-located with the code so placement can't drift). The slug is its
     documentation section; it groups into the kitchen-sink nav. Untagged = a
     new capability with no disposition: hard failure.
  2. env / routes — enumerated, split into documented vs internal-only.
  3. change ledger — every source surface and changeset added/removed since
     the README was last regenerated, so behaviour changes (not just new
     export keys) demand a conscious disposition.

Run: `bun run scripts/readmeSurfaces.ts`. Exits non-zero if any export is
untagged. Everything else is reported for the doc/example writer to account for.
*/

import { bandFor, GRAMMAR_BUCKETS, SLUG_GRAMMAR } from './surfaceWeight.ts'

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

/* The documentation information architecture: each section (a `@documentation`
   slug) rolls up into one of four top-level groups — these groups are the
   kitchen-sink example's nav structure, and the slugs are its sections. The
   reference index is a separate axis — every public export appears there too, as
   a non-prose listing — so it isn't a group here. `plumbing` is internal
   (reference-only, no demo). A non-plumbing slug missing from this map is
   reported as ungrouped. */
const SECTION_GROUPS: Record<string, string[]> = {
    'beyond the browser': ['agent', 'bundle', 'cli', 'mcp'],
    'build the server': ['configuration', 'request-scope', 'response', 'render', 'rpc', 'sockets'],
    'build the ui': [
        'templating',
        'cache',
        'page',
        'navigate',
        'probes',
        'tail',
        'url',
        'effect',
        'reactive-state',
        'ui',
    ],
    deploy: ['observability', 'testing', 'building'],
}

/* run argv directly (no shell) so regex metacharacters pass through literally */
const run = (cmd: string[]) =>
    new Response(Bun.spawn(cmd, { cwd: REPO, stdout: 'pipe', stderr: 'ignore' }).stdout).text()

/* 1. exports → @documentation tag */
const pkg = await Bun.file(`${ROOT}package.json`).json()
const exportsMap: Record<string, string> = pkg.exports
const bySlug = new Map<string, string[]>()
const untagged: string[] = []

/* one mapped export per file (project rule), so one @documentation tag per file */
for (const [key, relative] of Object.entries(exportsMap)) {
    const path = ROOT + (relative as string).replace(/^\.\//, '')
    // tsconfig and other non-source targets carry no tag — treat as plumbing
    if (!path.endsWith('.ts')) {
        bySlug.set('plumbing', [...(bySlug.get('plumbing') ?? []), key])
        continue
    }
    const source = await Bun.file(path).text()
    const tag = source.match(/^\/\/ @documentation ([a-z-]+)/m)?.[1]
    if (!tag) {
        untagged.push(key)
        continue
    }
    bySlug.set(tag, [...(bySlug.get(tag) ?? []), key])
}

/* 1b. sub-methods hung off an exported object — the cache.patch class. The
   per-file @documentation tag covers the export itself, not the methods assigned
   to it (cache.invalidate, tail.status), so a new sub-method drifts undocumented
   silently — exactly how cache.patch shipped unlisted in the surface map. Walk
   each exported symbol's own file for `symbol.method =` assignments and cross-ref
   the AGENTS.md surface map; an absent one is undocumented surface — hard failure,
   symmetric with an untagged export. Object.assign-composed exports (outbox, log)
   merge members through brace-bodied literals that don't regex cleanly, so they
   are reported for a manual members check rather than gated. */
const agents = await Bun.file(`${ROOT}AGENTS.md`).text()
const undocumentedSubmethods: string[] = []
const assignComposed: string[] = []
for (const [key, relative] of Object.entries(exportsMap)) {
    const rel = (relative as string).replace(/^\.\//, '')
    if (!rel.endsWith('.ts')) {
        continue
    }
    // one export per file, named after the export (project rule), so the path leaf is the symbol
    const symbol = key.split('/').at(-1) as string
    const source = await Bun.file(ROOT + rel).text()
    for (const match of source.matchAll(new RegExp(`^${symbol}\\.([a-zA-Z]\\w*)\\s*=`, 'gm'))) {
        const ref = `${symbol}.${match[1]}`
        if (!agents.includes(ref)) {
            undocumentedSubmethods.push(`${ref}  (${key})`)
        }
    }
    if (new RegExp(`export const ${symbol}\\b[^\\n]*Object\\.assign\\(`).test(source)) {
        assignComposed.push(`${symbol}  (${key})`)
    }
}

/* 1c. surface weight per slug → page-tree band. exports + sub-methods +
   grammar-bucket members (extracted from the parser's own sources), banded into
   share / page / section. See scripts/surfaceWeight.ts for the model. */
const COMPILE_DIR = `${ROOT}src/lib/ui/compile/`
/* memoise each grammar bucket's member count (read its parser source once) */
const bucketCount = new Map<string, number>()
for (const [bucket, { file, extract }] of Object.entries(GRAMMAR_BUCKETS)) {
    bucketCount.set(bucket, extract(await Bun.file(COMPILE_DIR + file).text()).length)
}

/* sub-methods per slug: reverse the key→slug map, tally `symbol.method =` hits */
const slugOf = new Map<string, string>()
for (const [slug, keys] of bySlug) {
    for (const key of keys) {
        slugOf.set(key, slug)
    }
}
const subMethodsBySlug = new Map<string, number>()
for (const [key, relative] of Object.entries(exportsMap)) {
    const rel = (relative as string).replace(/^\.\//, '')
    if (!rel.endsWith('.ts')) {
        continue
    }
    const symbol = key.split('/').at(-1) as string
    const source = await Bun.file(ROOT + rel).text()
    const count = [...source.matchAll(new RegExp(`^${symbol}\\.([a-zA-Z]\\w*)\\s*=`, 'gm'))].length
    const slug = slugOf.get(key)
    if (slug !== undefined) {
        subMethodsBySlug.set(slug, (subMethodsBySlug.get(slug) ?? 0) + count)
    }
}

/* the page-tree shape annotation for one slug */
const shapeFor = (slug: string): string => {
    const exportCount = (bySlug.get(slug) ?? []).filter((key) => key !== '(no exports yet)').length
    const grammarMembers = (SLUG_GRAMMAR[slug] ?? []).reduce(
        (sum, bucket) => sum + (bucketCount.get(bucket) ?? 0),
        0,
    )
    const weight = exportCount + (subMethodsBySlug.get(slug) ?? 0) + grammarMembers
    const band = bandFor(weight)
    const seams = SLUG_GRAMMAR[slug]
    const shape =
        band === 'light'
            ? 'share'
            : band === 'medium'
              ? 'page'
              : seams
                ? `section: ${seams.join(', ')}`
                : 'section'
    return `weight ${weight} ${band.toUpperCase()} → ${shape}`
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

/* documentation IA: each top-level group → its sections (slugs) → exports */
section(
    'sections by group',
    Object.entries(SECTION_GROUPS)
        .map(([group, slugs]) => {
            const rows = slugs.map(
                (slug) =>
                    `  ${slug}: ${(bySlug.get(slug) ?? ['(no exports yet)']).join(', ')}  [${shapeFor(slug)}]`,
            )
            return `${group}\n${rows.join('\n')}`
        })
        .join('\n'),
)

/* a non-plumbing slug not rolled into a group has no home in the IA */
const groupedSlugs = new Set(Object.values(SECTION_GROUPS).flat())
const ungroupedSlugs = [...bySlug.keys()].filter(
    (slug) => slug !== 'plumbing' && !groupedSlugs.has(slug),
)
section('ungrouped slugs (assign each to a group in SECTION_GROUPS)', ungroupedSlugs.join('\n'))

/* reference axis: every public export, the full non-prose index (incl. plumbing) */
const allExports = [...bySlug.values()].flat().sort()
section(`reference — all ${allExports.length} public exports`, allExports.join(', '))
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
section('Object.assign-composed exports (verify members are documented)', assignComposed.join('\n'))

if (untagged.length > 0 || undocumentedSubmethods.length > 0) {
    if (untagged.length > 0) {
        console.error(
            `\nFAIL: ${untagged.length} export(s) with no @documentation tag — a new capability with no home:\n` +
                untagged.map((key) => `  ${key}`).join('\n') +
                `\nAdd a // @documentation <slug> line above each export, then place it at that group.`,
        )
    }
    if (undocumentedSubmethods.length > 0) {
        console.error(
            `\nFAIL: ${undocumentedSubmethods.length} sub-method(s) absent from AGENTS.md — surface hung off an export, undocumented (the cache.patch class):\n` +
                undocumentedSubmethods.map((ref) => `  ${ref}`).join('\n') +
                `\nDocument each in AGENTS.md beside its export, or remove it if it is not real surface.`,
        )
    }
    process.exit(1)
}
console.log('\nOK: every export and exported sub-method carries a documentation disposition.')

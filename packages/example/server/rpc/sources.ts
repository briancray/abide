// The source panes' supply: a case's body, read off the disk it was written on.
//
// `Function.prototype.toString` is the obvious way to do this and it is the wrong one here, for a
// reason that only shows up once the demos are served by an app rather than by a dev server: the text
// a function reports is the text the BUNDLER emitted. Minified, that is one mangled line — so the
// pane under a card would stop being the code anybody wrote at exactly the moment the site is built
// the way it ships. Reading the file keeps the pane honest in both lanes, and it is also the thing
// that let `outdent` go: authored text is already indented the way it was authored.
//
// It is an endpoint because of WHERE IT IS, and it costs the browser nothing but the address — the
// slicer, the demo file and the disk are all on this side of `server/rpc/`.

import { error, GET } from 'abide/server'
import { META, type SuiteName } from '../../demos/SUITES.ts'
import { type Face, type Span, scan, sliceOf } from '../../site/code.ts'

const noSuchSource = error.typed('NoSuchSource', 404, 'no case body by that name', {
    schema: (value: unknown) => {
        const { suite, title } = value as { suite?: unknown; title?: unknown }
        if (typeof suite !== 'string' || typeof title !== 'string') {
            throw new Error('suite and title must be strings')
        }
        return { suite, title }
    },
})

/**
 * The demo file a suite is written in.
 *
 * Resolved against `META` rather than against the argument, which is the whole of the path handling
 * here: a name that is not a suite never reaches a path, so `../` in an argument is a 404 about a
 * suite that does not exist rather than a file read outside the demos directory.
 */
function fileFor(suite: string): URL | null {
    if (!Object.hasOwn(META, suite)) return null
    return new URL(`../../demos/${META[suite as SuiteName].name}.ts`, import.meta.url)
}

/**
 * A demo file's text and its scan, kept between requests.
 *
 * Finding ONE case body scans the whole file — thousands of spans and about a millisecond for the
 * larger suites — and a page of cards asks for two panes per card, all out of the same file. The
 * `memo` on the pane is the BROWSER's, so it dedupes within one page load of one visitor and nothing
 * across them. This is the server's half: keyed by `lastModified`, so a request pays a stat, and an
 * edit under `abide dev` still re-reads on the next ask.
 */
interface Scanned {
    at: number
    source: string
    spans: Span[]
}

const SCANNED = new Map<string, Scanned>()

async function scannedFor(file: URL): Promise<Scanned> {
    const held = Bun.file(file)
    const at = held.lastModified
    const cached = SCANNED.get(file.href)
    if (cached !== undefined && cached.at === at) return cached
    const source = await held.text()
    const fresh: Scanned = { at, source, spans: scan(source) }
    SCANNED.set(file.href, fresh)
    return fresh
}

/**
 * One case's `run` or `interact`, exactly as written.
 *
 * Keyed by the case's TITLE rather than by its index, because the title is what the page already
 * shows and an index is a number that silently means a different case the moment one is inserted
 * above it. A `memo`'s args are its cache key, so two cards asking for the same body ask once.
 */
export const bodyOf = GET(async ({ suite, title, face }: { suite: string; title: string; face: Face }) => {
    const file = fileFor(suite)
    if (file === null) return noSuchSource({ suite, title }, `no suite named ${suite}`)

    const scanned = await scannedFor(file)
    const cut = sliceOf(scanned.source, title, face, scanned.spans)
    // The runtime says the case has this face and the file does not, which is a file edited into
    // disagreement with the module loaded from it — worth saying rather than showing an empty pane.
    if (cut === null) return noSuchSource({ suite, title }, `no ${face} for "${title}" in ${suite}`)
    return { source: cut }
})

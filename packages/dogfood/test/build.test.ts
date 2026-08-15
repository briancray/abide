// `abide build` — the client bundle, as an artifact.
//
// Not a demo, and for the reason `pages.test.ts` is not one: a demo case runs the same body headless
// AND inside a browser card, and a browser cannot run a bundler or read what one wrote. Every claim
// here is about BYTES ON DISK, which is the only substrate a client bundle has.
//
// The build is SPAWNED once and the whole file reads its output, because a bundle takes seconds and
// running one per assertion would buy nothing — the claims are all about one output, and asserting
// them against seven separate builds would only test that the bundler is deterministic, which is a
// different claim and has its own case below.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { brotliDecompressSync } from 'node:zlib'
import { CLIENT_DIR, type ClientAsset, type ClientManifest, MANIFEST_FILE } from 'abide/cli'
import { type Ended, abide as spawnAbide } from 'harness/spawn'
import { SERVER_ONLY_MARKER } from '../server/db.ts'
import { DOGFOOD_ROOT as ROOT } from './root.ts'

const OUT = `${ROOT}/${CLIENT_DIR}`

/** Every case here builds the dogfood app unless it names a root of its own. */
function abide(argv: string[], cwd = ROOT, env?: Record<string, string>): Promise<Ended> {
    return spawnAbide(argv, { cwd, env })
}

let built: Ended
let manifest: ClientManifest
/** Every asset's text, keyed by name — what "does not ship" is asserted against. */
const texts = new Map<string, string>()

// A real build, so it gets a real budget: bun's default hook timeout is 5s and this bundles every page,
// every capability suite and every example rung — 52 files. It sat just under the default until the
// reference ladders added forty-odd modules to compile, and then the whole file failed on a hook rather
// than on anything it asserts. `start.test.ts` builds too and has said 30s all along.
beforeAll(async () => {
    built = await abide(['build'])
    manifest = (await Bun.file(`${ROOT}/${MANIFEST_FILE}`).json()) as ClientManifest
    for (const name of Object.keys(manifest.assets)) {
        texts.set(name, await Bun.file(`${OUT}/${name}`).text())
    }
}, 60_000)

test('the build succeeds, and the manifest names exactly what is on disk', async () => {
    expect(built.code).toBe(0)
    expect(built.err).toBe('')

    // The entry is keyed by the path relative to the project root, not by an absolute one: a manifest
    // holding this machine's home directory is one that means something different in a container.
    expect(Object.keys(manifest.entries)).toEqual(['client.ts'])
    const entry = manifest.entries['client.ts'] as string
    expect(manifest.assets[entry]?.kind).toBe('entry')

    for (const [name, asset] of Object.entries(manifest.assets)) {
        const file = Bun.file(`${OUT}/${name}`)
        expect(await file.exists()).toBe(true)
        // The size in the document is the size on disk. A manifest a server sets `Content-Length`
        // from is a manifest that has to be right about this rather than approximately right.
        expect(file.size).toBe(asset.size)
        // JavaScript, and the one stylesheet the client graph imported: `pages/layout.abide` writes
        // `import '../app.css'`, so the css is an asset of this lane rather than a file the document
        // had to name. Nothing else has a kind here.
        expect(asset.type).toMatch(/javascript|css/)
    }

    // The css came through the module graph, which is the claim: no entry named it, no html linked
    // it, and it is content-hashed and compressed like every other file in here.
    const styles = Object.values(manifest.assets).filter((asset) => asset.type.includes('css'))
    expect(styles.length).toBe(1)
    expect((styles[0] as ClientAsset).encodings.length).toBeGreaterThan(0)

    // The report is stdout — it is what somebody reads, and the exit code is what says it failed.
    expect(built.out).toContain(CLIENT_DIR)
    expect(built.out).toContain(entry)
})

test('every name carries a content hash, and the same tree builds the same names', async () => {
    for (const name of Object.keys(manifest.assets)) {
        // `[name]-[hash].[ext]`: the address is immutable, which is what lets an operator cache the
        // whole directory forever, and the name is still in front of the hash so a network panel
        // says which page a chunk is.
        expect(name).toMatch(/^[\w[\]. -]+-[a-z0-9]{8}\.(js|css)$/)
    }

    // Deterministic, which is the property the caching claim actually rests on: a rebuild that
    // renamed every chunk would invalidate a cache on every deploy that changed nothing.
    const again = await abide(['build'])
    expect(again.code).toBe(0)
    const second = (await Bun.file(`${ROOT}/${MANIFEST_FILE}`).json()) as ClientManifest
    expect(Object.keys(second.assets).sort()).toEqual(Object.keys(manifest.assets).sort())
    expect(second.entries).toEqual(manifest.entries)
})

test('the server half does not ship — the address does', () => {
    // The claim the lane exists for, asserted against the OUTPUT rather than against the option that
    // produced it: `target: 'browser'` is one word, and getting it wrong ships a database driver to
    // everybody who loads the page.
    //
    // `SERVER_ONLY_MARKER` is reachable from `findUser` rather than being an exported constant
    // nothing reads, which is what makes this falsifiable — the same entry built in the SERVER lane
    // does contain it, and a probe tree-shaking would have removed anyway proves nothing. The
    // handler's own name is deliberately not asserted: minification renames it, so its absence would
    // be true for a reason that has nothing to do with elision.
    for (const [name, text] of texts) {
        expect(text, `${name} carries the server-only marker`).not.toContain(SERVER_ONLY_MARKER)
    }

    // What DID cross is the address, which is the whole of what a stub is. Asked of the chunk the
    // importing module landed in rather than of the entry: the lane is generated from `pages/` now,
    // so `pages/users/[id]/page.abide` is what imports the endpoint and a page is a CHUNK by
    // construction — asserting it on the entry would be asserting that the page failed to split.
    //
    // And of THAT chunk rather than of any asset: the transport suite names the same address in its
    // own text, so "some file contains it" is a string that would still be there with the stub gone.
    const page = manifest.graph?.modules?.['pages/users/[id]/page.abide']
    expect(page).toBeDefined()
    expect(texts.get(page as string)).toContain('users/getUser')
})

test('the operator’s environment is not inlined into a browser bundle', async () => {
    // `env: 'disable'`, asserted rather than trusted. Bun will substitute `process.env.X` at build
    // time on request, and this is the one build where doing so publishes whatever the deploy shell
    // was holding to everybody who loads the page — a client asks `GET /__abide/identity` for what it
    // is allowed to know, and there is no `GET /__abide/config` at all.
    //
    // Its own fixture rather than an assertion over the dogfood app's bundle: nothing in the dogfood app
    // reads `process.env` directly, so the same expectation there would pass for want of anything to
    // inline. This entry reads one, and the value is set on the BUILD's environment.
    //
    // NAMED rather than conventional: the lane is generated from `pages/` now, so a file called
    // `client.ts` is built by nothing unless the build is pointed at it.
    const root = `${import.meta.dir}/../.abide/env-root`
    await Bun.write(`${root}/client.ts`, `console.log(process.env.ABIDE_BUILD_PROBE ?? 'unset')\n`)
    try {
        const probed = await abide(['build', 'client.ts'], root, { ABIDE_BUILD_PROBE: 'leaked-value-9f3a' })
        expect(probed.code).toBe(0)
        const document = (await Bun.file(`${root}/${MANIFEST_FILE}`).json()) as ClientManifest
        for (const name of Object.keys(document.assets)) {
            const text = await Bun.file(`${root}/${CLIENT_DIR}/${name}`).text()
            // The read survives into the bundle; the VALUE does not.
            expect(text).toContain('ABIDE_BUILD_PROBE')
            expect(text, `${name} carries the operator's value`).not.toContain('leaked-value-9f3a')
        }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('a page is its own chunk, absent from the entry until somebody navigates', () => {
    const entryName = manifest.entries['client.ts'] as string
    const entry = texts.get(entryName) as string

    // Splitting is the row's first word, and this is what it buys: `/users/[id]`'s page is not in the
    // first load. A route table built by scanning at runtime could not have this property, which is
    // why the table is static `import()` calls the bundler can see.
    expect(entry).not.toContain('<h1>user ')
    const chunks = Object.entries(manifest.assets).filter(([, asset]) => asset.kind === 'chunk')
    expect(chunks.length).toBeGreaterThan(1)

    // Each page really is somewhere, and in a chunk of its own rather than all in one.
    //
    // The needle carries its element, because the site's own prose is in these chunks too: `user ` on
    // its own is in six of them, in sentences about users, and a page that "is somewhere" has to be
    // found by the markup it renders rather than by a word it happens to contain.
    const holding = (needle: string): string[] =>
        [...texts].filter(([name, text]) => name !== entryName && text.includes(needle)).map(([n]) => n)
    expect(holding('<h1>user ')).toHaveLength(1)
    expect(holding('<h1>files ')).toHaveLength(1)
    // Two different pages are two different chunks — one chunk holding both would be a split that
    // split nothing. The same element-carrying needles, for the reason above: the bare words are in
    // the prose of six chunks, so comparing those two lists passes on sentences rather than on pages.
    expect(holding('<h1>user ')).not.toEqual(holding('<h1>files '))
})

test('a sidecar is written only when it is smaller, and holds the same bytes', async () => {
    for (const [name, asset] of Object.entries(manifest.assets)) {
        const identity = new Uint8Array(await Bun.file(`${OUT}/${name}`).arrayBuffer())

        // Smallest FIRST, so a server negotiating `Accept-Encoding` takes the first match rather than
        // comparing sizes per request.
        for (let at = 1; at < asset.encodings.length; at++) {
            expect((asset.encodings[at] as { size: number }).size).toBeGreaterThanOrEqual(
                (asset.encodings[at - 1] as { size: number }).size,
            )
        }

        const written = new Set(asset.encodings.map((one) => one.encoding))
        for (const sidecar of asset.encodings) {
            const bytes = new Uint8Array(await Bun.file(`${OUT}/${sidecar.file}`).arrayBuffer())
            expect(bytes.byteLength).toBe(sidecar.size)
            // A sidecar is the SAME resource, not a second one: a build that shipped a stale or
            // truncated compressed form would serve it to every browser that asked for it and
            // nobody would see the identity bytes again.
            const back = sidecar.encoding === 'br' ? brotliDecompressSync(bytes) : Bun.gunzipSync(bytes)
            expect(new Uint8Array(back)).toEqual(identity)
            // And it is actually smaller — the one reason to write it at all.
            expect(sidecar.size).toBeLessThan(asset.size)
        }

        // What is NOT listed is not on disk either. `encodings` is a list rather than two flags
        // exactly so that a server never has to stat for a file that was never worth writing.
        for (const [encoding, extension] of [
            ['br', '.br'],
            ['gzip', '.gz'],
        ] as const) {
            if (written.has(encoding)) continue
            expect(await Bun.file(`${OUT}/${name}${extension}`).exists()).toBe(false)
        }
    }

    // Every sidecar the dogfood app wrote is smaller than what it stands in for. The other half of the
    // rule — the sidecar NOT written — needs an asset small enough to grow under compression, and the
    // example no longer has one: its smallest chunk is a page, and a page is a few hundred bytes of
    // markup that compresses fine.
    //
    // So it is built. A one-line entry is the smallest bundle there is, and gzip's header alone makes
    // it bigger — which is what turns "only when smaller" into a branch this suite has actually taken
    // rather than one it has only read. The loop above still asserts the other half for every asset
    // the dogfood app DOES ship: an encoding absent from `encodings` is absent from the disk too.
    const root = `${import.meta.dir}/../.abide/tiny-root`
    await Bun.write(`${root}/client.ts`, 'export const a = 1\n')
    try {
        const tiny = await abide(['build', 'client.ts'], root)
        expect(tiny.code).toBe(0)
        const document = (await Bun.file(`${root}/${MANIFEST_FILE}`).json()) as ClientManifest
        const assets = Object.entries(document.assets)
        expect(assets.length).toBe(1)
        const [name, asset] = assets[0] as [string, ClientAsset]
        expect(asset.encodings).toEqual([])
        expect(await Bun.file(`${root}/${CLIENT_DIR}/${name}.gz`).exists()).toBe(false)
        expect(await Bun.file(`${root}/${CLIENT_DIR}/${name}.br`).exists()).toBe(false)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('an entry is keyed by what the file IS, not by how it was typed', async () => {
    // Three spellings of one entry. A manifest that recorded `./client.ts` because that is what the
    // deploy script happened to type is one a server cannot look `client.ts` up in — and the two
    // would sit in the same document as though they were different entry points.
    //
    // A fixture rather than the dogfood app, for two reasons that arrived together: the dogfood app has no
    // `client.ts` any more — the lane is generated from `pages/` — and this was three full builds of
    // the whole app for a claim about manifest KEYS, so a route added to `pages/` was what made it
    // start needing a minute.
    const root = `${import.meta.dir}/../.abide/spelling-root`
    await Bun.write(`${root}/client.ts`, 'export const a = 1\n')
    try {
        for (const spelling of ['client.ts', './client.ts', `${root}/client.ts`]) {
            const named = await abide(['build', spelling], root)
            expect(named.code).toBe(0)
            const document = (await Bun.file(`${root}/${MANIFEST_FILE}`).json()) as ClientManifest
            expect(Object.keys(document.entries)).toEqual(['client.ts'])
        }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('a build replaces the last one rather than piling up beside it', async () => {
    // A hash means a build never overwrites the previous one's output, so merging would leave every
    // chunk every build ever produced in the directory — served by nothing, and shipped in the image.
    const stale = `${OUT}/page-deadbeef.js`
    await Bun.write(stale, '// from a build that no longer exists\n')
    expect(await Bun.file(stale).exists()).toBe(true)

    const again = await abide(['build'])
    expect(again.code).toBe(0)
    expect(await Bun.file(stale).exists()).toBe(false)
})

test('a flag it does not know, and nothing to build, are usage failures', async () => {
    // Refused rather than ignored: a `--minify` somebody typed and this quietly dropped is a build
    // that did not do what was asked and said nothing about it.
    const flagged = await abide(['build', '--minify'])
    expect(flagged.code).toBe(2)
    expect(flagged.err).toContain('--minify')
    expect(flagged.out).toBe('')

    // A directory with no pages is a usage failure that names what was looked for, rather than a
    // build of nothing that exits `0`. `pages/` and not `client.ts`, because the lane is generated
    // from the one and there is no longer any such thing as the other.
    const empty = `${import.meta.dir}/../.abide/empty-root`
    await Bun.write(`${empty}/package.json`, '{}\n')
    try {
        const nothing = await abide(['build'], empty)
        expect(nothing.code).toBe(2)
        expect(nothing.err).toContain('pages/')
    } finally {
        await rm(empty, { recursive: true, force: true })
    }
})

test('an app is bundled from its pages, split per route', async () => {
    // The dogfood app exercises the generated lane too — it is the only lane now — so this root is not
    // about the lane EXISTING. It is about the two properties a build of the dogfood app cannot show:
    // that the table is right for a tree small enough to state exhaustively, and that a page ADDED
    // grows it. Both need a directory this case controls.
    const root = `${import.meta.dir}/../.abide/generated-root`
    await Bun.write(
        `${root}/pages/layout.abide`,
        '<script>\n  const { children } = $props\n</script>\n<main>{children}</main>\n',
    )
    await Bun.write(`${root}/pages/page.abide`, '<h1>home</h1>\n')
    await Bun.write(`${root}/pages/about/page.abide`, '<h1>about</h1>\n')
    try {
        const generated = await abide(['build'], root)
        expect(generated.code).toBe(0)
        expect(generated.err).toBe('')
        // Said out loud: a lane nobody wrote is a file the next reader will not find in their source
        // tree, and the line that says where it came from is the whole of the fix.
        expect(generated.out).toContain('.abide/client.entry.ts')

        const document = (await Bun.file(`${root}/${MANIFEST_FILE}`).json()) as ClientManifest
        // Keyed by the CONVENTIONAL name and not by where the module sits. The generated lane is at
        // `.abide/client.entry.ts` and an app's own is at `client.ts`, and an `app.html` writing
        // `src="./client.ts"` must resolve either — a document should not have to know which of the
        // two it got.
        expect(Object.keys(document.entries)).toEqual(['client.ts'])

        // The whole reason the table is written with a static `import()` per row rather than scanned
        // at runtime: a call the bundler can SEE is a chunk. Three source modules, three distinct
        // files, none of them the entry — a table built by scanning would put every page in the
        // first load and this is the assertion that would still pass if it did not.
        const modules = document.graph?.modules as Record<string, string>
        const entry = document.entries['client.ts'] as string
        const chunks = ['pages/layout.abide', 'pages/page.abide', 'pages/about/page.abide']
        for (const source of chunks) {
            expect(modules[source]).toBeDefined()
            expect(modules[source]).not.toBe(entry)
        }
        expect(new Set(chunks.map((source) => modules[source])).size).toBe(3)

        // A page ADDED is a row the table has to grow. The generated lane is written per build for
        // this reason alone — a scan cached at startup is a route that renders on the server and
        // 404s in the browser, which is exactly the failure hand-writing the table produces.
        await Bun.write(`${root}/pages/deeper/page.abide`, '<h1>deeper</h1>\n')
        const again = await abide(['build'], root)
        expect(again.code).toBe(0)
        const grown = (await Bun.file(`${root}/${MANIFEST_FILE}`).json()) as ClientManifest
        expect(grown.graph?.modules['pages/deeper/page.abide']).toBeDefined()
        const lane = await Bun.file(`${root}/.abide/client.entry.ts`).text()
        expect(lane).toContain('"/deeper"')
        // Sorted by route path, so two builds of one tree produce the same bytes rather than a hash
        // that changes because the scan came back in a different order.
        expect(lane.indexOf('"/about"')).toBeLessThan(lane.indexOf('"/deeper"'))
    } finally {
        await rm(root, { recursive: true, force: true })
    }
}, 60_000)

test('a page that does not compile fails the build, on stderr', async () => {
    // A PAGE rather than a hand-written entry: the lane is generated, so a page is what a broken
    // client build now has in it, and the module the bundler chokes on is one the app wrote.
    const broken = `${import.meta.dir}/../.abide/broken-root`
    await Bun.write(
        `${broken}/pages/page.abide`,
        `<script>\nimport './nothing-is-here.ts'\n</script>\n<p>x</p>\n`,
    )
    try {
        const failed = await abide(['build'], broken)
        // `1` and not `2`: it ran and did not work, which is a different thing to CI from a command
        // line that was wrong.
        expect(failed.code).toBe(1)
        expect(failed.err).toContain('nothing-is-here')
        expect(failed.out).toBe('')
    } finally {
        await rm(broken, { recursive: true, force: true })
    }
})

afterAll(async () => {
    // Left BUILT rather than cleaned: `.abide/` is gitignored, and the output of the last run is the
    // thing somebody looking into why a case failed wants to open.
    await rm(`${OUT}/page-deadbeef.js`, { force: true })
})

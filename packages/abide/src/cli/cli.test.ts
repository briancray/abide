import { afterAll, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadClientBuild } from '../server/internal/clientBundle.ts'
import { build } from './build.ts'
import { main } from './main.ts'
import { scaffold } from './scaffold.ts'
import { type ServeResult, serve } from './serve.ts'

const FIXTURE_DIR = join(import.meta.dir, '../server/__fixtures__/app')

// SSR HTML now carries the client skeleton's comment anchors; strip them for structural assertions.
function stripAnchors(html: string): string {
    return html.replace(/<!--\[-->|<!--\]-->|<!---->/g, '')
}

const running: ServeResult[] = []
const tempDirs: string[] = []

function tempPath(prefix: string): string {
    const dir = join(tmpdir(), `abide-${prefix}-${Bun.randomUUIDv7()}`)
    tempDirs.push(dir)
    return dir
}

afterAll(async () => {
    for (const app of running) await app.stop()
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
    await rm(join(FIXTURE_DIR, 'dist'), { recursive: true, force: true })
})

describe('serve — boots a file-based project on a real port', () => {
    test('SSR page and RPC respond over real HTTP', async () => {
        const app = await serve(FIXTURE_DIR, { port: 0 })
        running.push(app)

        expect(app.url).toMatch(/^http:\/\/localhost:\d+$/)

        const home = await fetch(`${app.url}/`)
        expect(home.status).toBe(200)
        expect(home.headers.get('content-type')).toContain('text/html')
        expect(stripAnchors(await home.text())).toContain('<h1>hi x</h1>')

        const query = `?__abide_args=${encodeURIComponent(JSON.stringify({ name: 'world' }))}`
        const greet = await fetch(`${app.url}/__abide/rpc/greet${query}`)
        expect(greet.status).toBe(200)
        expect(await greet.json()).toBe('hi world')
    })

    test('non-dev mode does not inject the live-reload snippet', async () => {
        const app = await serve(FIXTURE_DIR, { port: 0 })
        running.push(app)
        const html = await (await fetch(`${app.url}/`)).text()
        expect(html).not.toContain('__abide_dev_reload')
    })

    test('dev hops to the next open port when the requested one is taken', async () => {
        // Hold a fixed port with a throwaway server, then ask dev for that same port.
        const held = 34567
        const blocker = Bun.serve({ port: held, fetch: () => new Response('busy') })
        try {
            const app = await serve(FIXTURE_DIR, { dev: true, port: held })
            running.push(app)
            const boundPort = Number(new URL(app.url).port)
            // dev must have moved past the busy port, landing on a higher, free one.
            expect(boundPort).toBeGreaterThan(held)
            expect((await fetch(`${app.url}/`)).status).toBe(200)
        } finally {
            blocker.stop(true)
        }
    })

    // A hop moves the app; APP_URL still names where it was. Since APP_URL is the expected origin BOTH
    // origin gates compare against, a stale one makes the server reject its OWN browser — every WS
    // upgrade a 403 (CSWSH, which the client mux then reconnect-loops on) and, silently, every MUTATION
    // a 403 (CSRF), while reads sail through because reads are exempt. The page looks healthy and is
    // read-only. Asserting the URL alone cannot see any of that: `app.url` was always right. Assert the
    // GATES — an upgrade from where the app actually bound.
    test('a dev port hop carries APP_URL to the bound origin, so the origin gates admit the app', async () => {
        const held = 34579
        const previousAppUrl = Bun.env.APP_URL
        const blocker = Bun.serve({ port: held, fetch: () => new Response('busy') })
        Bun.env.APP_URL = `http://localhost:${held}`
        try {
            const app = await serve(FIXTURE_DIR, { dev: true, port: held })
            running.push(app)
            const bound = new URL(app.url).origin
            expect(Bun.env.APP_URL).toBe(bound)

            // The browser's own origin is admitted (101), where a stale APP_URL made this a 403.
            const upgrade = await fetch(`${app.url}/__abide/sockets`, {
                headers: {
                    Connection: 'Upgrade',
                    Upgrade: 'websocket',
                    'Sec-WebSocket-Version': '13',
                    'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
                    Origin: bound,
                },
            })
            expect(upgrade.status).toBe(101)

            // REALIGNED, not relaxed — a genuinely foreign origin is still rejected.
            const foreign = await fetch(`${app.url}/__abide/sockets`, {
                headers: {
                    Connection: 'Upgrade',
                    Upgrade: 'websocket',
                    'Sec-WebSocket-Version': '13',
                    'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
                    Origin: 'http://evil.example',
                },
            })
            expect(foreign.status).toBe(403)
        } finally {
            blocker.stop(true)
            Bun.env.APP_URL = previousAppUrl
        }
    })

    test('a hop leaves an APP_URL that names a different port alone', async () => {
        // An APP_URL naming some other port is a statement about a front door the hop did not move — a
        // tunnel, a reverse proxy. Rewriting it would break the very gate it feeds. The rewrite is keyed
        // to APP_URL's port matching the port we ASKED for, which is what identifies it as this server.
        const held = 34581
        const previousAppUrl = Bun.env.APP_URL
        const blocker = Bun.serve({ port: held, fetch: () => new Response('busy') })
        Bun.env.APP_URL = 'https://app.example'
        try {
            const app = await serve(FIXTURE_DIR, { dev: true, port: held })
            running.push(app)
            expect(Bun.env.APP_URL).toBe('https://app.example')
        } finally {
            blocker.stop(true)
            Bun.env.APP_URL = previousAppUrl
        }
    })
})

describe('serve dev — live-reload wiring', () => {
    test('dev mode injects the live-reload snippet into served HTML', async () => {
        const app = await serve(FIXTURE_DIR, { dev: true, port: 0 })
        running.push(app)
        const html = await (await fetch(`${app.url}/`)).text()
        expect(html).toContain('id="__abide-dev-reload"')
        expect(html).toContain('__abide_dev_reload')
        expect(html).toContain('/__abide/sockets')

        // The injected snippet is an inline JS string — a syntax slip would ship silently (the HTML tests
        // above only match substrings). Extract it and assert it actually PARSES, and that it wires the
        // scroll capture/restore that keeps position across a dev reload.
        const match = html.match(/<script id="__abide-dev-reload"[^>]*>([\s\S]*?)<\/script>/)
        expect(match).not.toBeNull()
        const snippet = match?.[1] ?? ''
        expect(() => new Function(snippet)).not.toThrow()
        expect(snippet).toContain('sessionStorage')
        expect(snippet).toContain('scrollX')
    })
})

describe('scaffold — writes a minimal starter project', () => {
    test('creates the expected files with sane contents', async () => {
        const root = await scaffold(tempPath('scaffold'), 'myapp')

        const page = Bun.file(join(root, 'src/ui/pages/page.abide'))
        expect(await page.exists()).toBe(true)
        expect(await page.text()).toContain('greet(')

        const rpc = Bun.file(join(root, 'src/server/rpc/greet.ts'))
        expect(await rpc.exists()).toBe(true)
        expect(await rpc.text()).toContain('GET(')

        const appModule = Bun.file(join(root, 'src/app.ts'))
        expect(await appModule.exists()).toBe(true)
        expect(await appModule.text()).toContain('middleware')

        const configModule = Bun.file(join(root, 'src/server/config.ts'))
        expect(await configModule.exists()).toBe(true)

        const pkg = await Bun.file(join(root, 'package.json')).json()
        expect(pkg.name).toBe('myapp')
        expect(pkg.dependencies.abide).toBeDefined()
        expect(pkg.scripts.dev).toBe('abide dev')
        expect(pkg.scripts.build).toBe('abide build')
        expect(pkg.scripts.start).toBe('abide start')

        // The template's monorepo-only Playwright dogfood harness must NOT leak into a scaffolded app
        // (its serve-e2e imports abide by workspace path): no e2e scripts, no @playwright/test dep, no
        // e2e/ files or playwright config copied out.
        expect(pkg.scripts.e2e).toBeUndefined()
        expect(pkg.scripts['e2e:ci']).toBeUndefined()
        expect(pkg.devDependencies?.['@playwright/test']).toBeUndefined()
        expect(await Bun.file(join(root, 'playwright.config.ts')).exists()).toBe(false)
        expect(await Bun.file(join(root, 'e2e/smoke.spec.ts')).exists()).toBe(false)

        expect(await Bun.file(join(root, 'tsconfig.json')).exists()).toBe(true)
    })
})

describe('build — content-addressed split client', () => {
    // `build` answers a `BuildResult`, not a path. The dispatcher named the binding `outDir` and
    // interpolated the whole record, so `abide build` reported `abide build — [object Object]` — the
    // one line a user reads to find out where the bundle went. Asserted through `main` because the
    // defect was entirely in the dispatcher's reporting; `build` itself was always right.
    test('the COMMAND reports the output directory, not a stringified record', async () => {
        const lines: string[] = []
        await main(['build'], {
            cwd: FIXTURE_DIR,
            write: (line) => lines.push(line),
            writeError: () => {},
        })
        // The banner is one `write` of a multi-line block, so split rather than scan the calls.
        const printed = lines.join('\n').split('\n')
        expect(printed.join('\n')).not.toContain('[object Object]')
        const reported = printed.find((line) => line.includes('output'))
        expect(reported).toBeDefined()
        expect(reported).toContain(join('dist', '_app'))
    })

    test('writes every hashed chunk + a manifest into dist/_app/<hash>/', async () => {
        const { outDir } = await build(FIXTURE_DIR)
        expect(outDir).toContain(join('dist', '_app'))

        // The manifest names the content-hashed loader entry + every emitted file.
        const index = await Bun.file(join(outDir, 'index.json')).json()
        expect(typeof index.hash).toBe('string')
        expect(index.hash.length).toBeGreaterThan(0)
        expect(index.entry).toMatch(/^loader-[a-z0-9]+\.js$/)
        expect(Array.isArray(index.files)).toBe(true)
        expect(index.files).toContain(index.entry)

        // Every manifest-listed file was written to disk, non-empty. There is more than one file (the
        // loader entry + at least one code-split page chunk) — proof the app actually split.
        for (const name of index.files as string[]) {
            const file = Bun.file(join(outDir, name))
            expect(await file.exists()).toBe(true)
            expect((await file.text()).length).toBeGreaterThan(0)
        }
        expect((index.files as string[]).length).toBeGreaterThan(1)

        // A stable top-level pointer for `abide start` mirrors the per-build record (incl. chunkByPattern).
        const manifest = await Bun.file(join(FIXTURE_DIR, 'dist', 'manifest.json')).json()
        expect(manifest.hash).toBe(index.hash)
        expect(manifest.entry).toBe(index.entry)
        expect(typeof manifest.chunkByPattern).toBe('object')

        // Precompressed sidecars land on disk beside their identity file, and the manifest NAMES them —
        // `abide start` reads that list rather than probing, so a sidecar the manifest claims must exist.
        expect(typeof index.encodings).toBe('object')
        const encodedNames = Object.keys(index.encodings as Record<string, string[]>)
        expect(encodedNames.length).toBeGreaterThan(0)
        for (const name of encodedNames) {
            for (const encoding of (index.encodings as Record<string, string[]>)[name] ?? []) {
                const suffix = encoding === 'brotli' ? '.br' : '.gz'
                const sidecar = Bun.file(join(outDir, name + suffix))
                expect(await sidecar.exists()).toBe(true)
                // A stored encoding is only ever kept because it BEAT the identity bytes; a sidecar that
                // is not smaller means the build wrote one it should have discarded.
                expect(sidecar.size).toBeLessThan(Bun.file(join(outDir, name)).size)
            }
        }

        // Loading that build back reconstructs every representation byte-for-byte — the boot path for
        // `abide start` is the same map the in-memory build produces.
        const loaded = await loadClientBuild(FIXTURE_DIR)
        if (loaded === undefined) throw new Error('expected a loaded client build')
        for (const name of encodedNames) {
            const asset = loaded.files.get(name)
            if (asset === undefined) throw new Error(`missing asset ${name}`)
            expect(asset.brotli).not.toBeNull()
            expect(asset.brotli?.byteLength).toBe(Bun.file(join(outDir, `${name}.br`)).size)
        }
    })

    test('abide start SERVES the pre-built dist artifacts (no rebuild)', async () => {
        await build(FIXTURE_DIR)
        const manifest = await Bun.file(join(FIXTURE_DIR, 'dist', 'manifest.json')).json()
        // Tamper the built loader on disk with a sentinel. A prebuilt serve must return THIS exact file,
        // proving it reads the `abide build` artifacts rather than re-running the bundler at boot (a
        // rebuild — deterministic — would produce the clean, sentinel-free output).
        const loaderPath = join(FIXTURE_DIR, 'dist', '_app', manifest.hash, manifest.entry)
        const sentinel = '/*ABIDE_PREBUILT_SENTINEL*/'
        await Bun.write(loaderPath, sentinel + (await Bun.file(loaderPath).text()))

        const clientBuild = await loadClientBuild(FIXTURE_DIR)
        if (clientBuild === undefined) throw new Error('expected a loaded client build')
        const app = await serve(FIXTURE_DIR, { dev: false, port: 0, clientBuild })
        running.push(app)

        // Ask for identity explicitly. The sentinel was written into the IDENTITY file only, while the
        // build also wrote precompressed `.br`/`.gz` sidecars beside it — and `fetch` volunteers
        // `Accept-Encoding: br` by default, which would serve an untampered representation and make this
        // assertion silently about the wrong file.
        const served = await (
            await fetch(`${app.url}/__abide/chunk/${manifest.entry}`, {
                headers: { 'accept-encoding': 'identity' },
            })
        ).text()
        expect(served).toContain(sentinel) // came from the dist file on disk, not a fresh build
        const doc = await (await fetch(`${app.url}/`)).text()
        expect(doc).toContain(`<script type="module" src="/__abide/chunk/${manifest.entry}">`)
    })
})

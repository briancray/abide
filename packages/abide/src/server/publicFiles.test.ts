// `src/ui/public/**` — files served verbatim at their literal request path. The counterpart to the
// content-addressed `/__abide/chunk/` route: fixed path, real MIME type, revalidated rather than
// immutable. Also covers the traversal guard and the CSS `external` passthrough that lets a bundled
// stylesheet reference a public font by absolute URL instead of inlining it as base64.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestApp } from '../test/createTestApp.ts'

const dir = join(tmpdir(), `abide-public-test-${Bun.hash(import.meta.path).toString(36)}`)
const publicDir = join(dir, 'src/ui/public')

// A woff2 is BINARY — the byte-fidelity assertion below is the point of the whole route, since the
// chunk pipeline stores its files as strings and would mojibake these bytes.
const FONT_BYTES = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f])

beforeAll(async () => {
    await mkdir(join(publicDir, 'fonts'), { recursive: true })
    await mkdir(join(dir, 'src/ui/pages'), { recursive: true })
    await writeFile(join(publicDir, 'fonts/test.woff2'), FONT_BYTES)
    await writeFile(join(publicDir, 'robots.txt'), 'User-agent: *\nAllow: /\n')
    // A stylesheet that references the public font by ROOT-ABSOLUTE url — the shape Bun would otherwise
    // reject as unresolvable, admitted by the public dir's `external` set.
    await writeFile(
        join(dir, 'src/ui/pages/page.css'),
        "@font-face { font-family: T; src: url('/fonts/test.woff2') format('woff2'); }\n",
    )
    await writeFile(
        join(dir, 'src/ui/pages/page.abide'),
        "<script>import './page.css'</script><h1>home</h1>\n",
    )
    // The file a traversal attempt would be reaching for: OUTSIDE public/, inside the project.
    await writeFile(join(dir, 'src/app.ts'), 'export const middleware = []\n')
})

afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
})

test('serves a public file at its literal path with the right content type and exact bytes', async () => {
    const app = await createTestApp({ dir })
    try {
        const response = await app.fetch('/fonts/test.woff2')
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('font/woff2')
        // Byte-for-byte: a text round-trip would corrupt 0xff/0xfe/0x80 into replacement characters.
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(FONT_BYTES)
    } finally {
        await app.stop()
    }
})

test('a public file is cacheable and shared, not identity-scoped', async () => {
    const app = await createTestApp({ dir })
    try {
        const response = await app.fetch('/robots.txt')
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
        // Declaring its own cache-control opts it out of the router's `private, no-cache` + Vary: Cookie
        // default — a public asset is the same bytes for every user.
        expect(response.headers.get('cache-control')).toContain('public')
        expect(response.headers.get('vary') ?? '').not.toContain('Cookie')
    } finally {
        await app.stop()
    }
})

test('a matching If-None-Match revalidates to 304 with no body', async () => {
    const app = await createTestApp({ dir })
    try {
        const first = await app.fetch('/robots.txt')
        const etag = first.headers.get('etag')
        expect(etag).not.toBeNull()
        const second = await app.fetch('/robots.txt', { headers: { 'if-none-match': etag ?? '' } })
        expect(second.status).toBe(304)
        expect(await second.text()).toBe('')
    } finally {
        await app.stop()
    }
})

test('path traversal out of the public dir is refused', async () => {
    const app = await createTestApp({ dir })
    try {
        // Both the raw and the percent-encoded form must fail to reach `src/app.ts`.
        for (const attempt of ['/../app.ts', '/fonts/../../app.ts', '/..%2f..%2fapp.ts']) {
            const response = await app.fetch(attempt)
            expect(response.status).not.toBe(200)
        }
    } finally {
        await app.stop()
    }
})

test('a public file never shadows a framework route', async () => {
    const app = await createTestApp({ dir })
    try {
        // `/openapi.json` is generated; a same-named public file must not win. (None exists here — the
        // assertion is that the generated document still answers with the public route installed.)
        const response = await app.fetch('/openapi.json')
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type') ?? '').toContain('json')
    } finally {
        await app.stop()
    }
})

test('bundled CSS references a public font by URL instead of inlining it as base64', async () => {
    const app = await createTestApp({ dir })
    try {
        const doc = await (await app.fetch('/')).text()
        const link = doc.match(/href="(\/__abide\/chunk\/style-[a-z0-9]+\.css)"/)
        if (link === null) throw new Error(`no hashed stylesheet in document:\n${doc}`)
        const css = await (await app.fetch(link[1] as string)).text()
        // The whole point: the url() survived as a reference. Bun's default is to inline ANY relative
        // CSS asset as a data URL at any size, which would push the font's bytes (+33%) into this
        // render-blocking stylesheet and re-download them on every content change to it.
        expect(css).toContain('/fonts/test.woff2')
        expect(css).not.toContain('data:font')
    } finally {
        await app.stop()
    }
})

test('an unknown path still falls through to page routing', async () => {
    const app = await createTestApp({ dir })
    try {
        const response = await app.fetch('/')
        expect(response.status).toBe(200)
        expect(await response.text()).toContain('home')
    } finally {
        await app.stop()
    }
})

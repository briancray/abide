// SECTION 29 — `csp` as an app's rung, served by `abide start` (spawned, for `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const PAGE = `<script>
import { reactive } from 'abide'
import { getTotal } from '#server/rpc/totals.ts'

const total = reactive(() => getTotal())
</script>

<main><p id="total">{total()}</p></main>`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': PAGE,
        'server/rpc/totals.ts': `import { GET } from 'abide/server'\n\nexport const getTotal = GET(() => 1240)\n`,
        'server/app.ts': `import { csp, middleware } from 'abide/server'

middleware(csp({ 'img-src': ['https:'], 'frame-ancestors': [], 'worker-src': ["'self'"] }))

export default (request: Request) =>
    new URL(request.url).pathname === '/nonce'
        ? new Response(csp.nonce(), { headers: { 'content-type': 'text/html' } })
        : undefined
`,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

function directives(header: string | null): Map<string, string> {
    const found = new Map<string, string>()
    for (const part of (header ?? '').split('; ')) {
        const at = part.indexOf(' ')
        found.set(part.slice(0, at), part.slice(at + 1))
    }
    return found
}

// 29.5, 29.6, 29.7, 29.8 — THE BASELINE, with a given directive replaced, an empty one dropped and
// an unknown one added. THE REVERT: append the app's values to the baseline's in `policy`; img-src
// reads `'self' data: https:`.
test('sources replace, drop and add directives over the baseline — 29.5 to 29.8', async () => {
    const found = directives(
        (await Bun.fetch(`${base}/`)).headers.get('content-security-policy'),
    )
    expect(found.get('default-src')).toBe("'self'")
    expect(found.get('img-src')).toBe('https:')
    expect(found.has('frame-ancestors')).toBe(false)
    expect(found.get('worker-src')).toBe("'self'")
    expect(found.get('object-src')).toBe("'none'")
})

// 29.9, 29.10 — THE INLINE `render` EMITS IS PERMITTED BY ITS HASH, and the bytes that hash covers
// are the same in every response. THE REVERT: inline the rows into the runner as they were; the
// page's script no longer hashes to anything in `script-src`.
test("render's inline script is permitted by its hash, and is the same every time — 29.9, 29.10", async () => {
    const pages = await Promise.all([
        Bun.fetch(`${base}/`),
        Bun.fetch(`${base}/`),
    ])
    const scripts: string[] = []
    for (const page of pages) {
        const html = await page.text()
        const runner = /<script>(\(function\(s,c\)[\s\S]*?)<\/script>/.exec(
            html,
        )?.[1]
        expect(runner).toBeDefined()
        scripts.push(runner as string)
        const hash = `'sha256-${new Bun.CryptoHasher('sha256').update(runner as string).digest('base64')}'`
        const policy = directives(page.headers.get('content-security-policy'))
        expect(policy.get('script-src')).toContain(hash)
    }
    expect(scripts[0]).toBe(scripts[1] as string)
})

// 29.2, 29.3 — ONE NONCE PER RESPONSE, the one the header carries, and a policy on a document alone.
test('csp.nonce is the nonce in the header, and a non-document carries no policy — 29.2, 29.3', async () => {
    const [first, second] = await Promise.all([
        Bun.fetch(`${base}/nonce`),
        Bun.fetch(`${base}/nonce`),
    ])
    const nonce = await first.text()
    expect(
        directives(first.headers.get('content-security-policy')).get(
            'script-src',
        ),
    ).toContain(`'nonce-${nonce}'`)
    expect(await second.text()).not.toBe(nonce)
    const json = await Bun.fetch(`${base}/__abide/rpc/totals/getTotal`)
    expect(json.headers.get('content-security-policy')).toBeNull()
})

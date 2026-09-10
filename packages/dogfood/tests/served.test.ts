// THE WIRE PANEL AND THE NETWORK ARE TWO ARTIFACTS ONCE AN EXAMPLE SERVES ITSELF, and that is
// the whole cost of 40.20's second arm: while the fixture WAS the answer, an exchange the panel
// showed was an exchange that had happened, and now the panel is authored beside routes that
// answer independently. So the join is checked here — every wire entry dispatched through the
// arm's own routes, body against body.
//
// `Bun.serve` is stubbed the way the frame stubs it, which is also what makes the arm importable:
// the file is real Bun code and calls it at the top level.
import { expect, test } from 'bun:test'

const EXAMPLES_DIR = new URL('../examples/', import.meta.url)

type Routes = Record<string, (request: Request) => Response | Promise<Response>>

async function routesOf(name: string, file: string): Promise<Routes> {
    let captured: Routes = {}
    const serve = Bun.serve
    // The stub takes the one field the arms pass, against an overload set it cannot satisfy.
    ;(Bun as { serve: unknown }).serve = (options: { routes?: Routes }) => {
        captured = options.routes ?? {}
    }
    try {
        await import(
            `${new URL(`${name}/vanilla/${file}`, EXAMPLES_DIR).pathname}?${Math.random()}`
        )
    } finally {
        Bun.serve = serve
    }
    return captured
}

async function served(): Promise<{ name: string; manifest: Manifest }[]> {
    const out: { name: string; manifest: Manifest }[] = []
    for (const path of new Bun.Glob('*/example.json').scanSync({
        cwd: EXAMPLES_DIR.pathname,
    })) {
        const name = path.slice(0, path.indexOf('/'))
        const manifest = (await Bun.file(
            new URL(path, EXAMPLES_DIR),
        ).json()) as Manifest
        if (manifest.served) out.push({ name, manifest })
    }
    return out
}

type Manifest = {
    served?: string
    wire?: { request: string; body: string }[]
}

test('every wire entry is what the served arm answers', async () => {
    const examples = await served()
    // The mechanism exists for an example that has it; zero here would pass silently.
    expect(examples.length).toBeGreaterThan(0)
    for (const { name, manifest } of examples) {
        const routes = await routesOf(name, manifest.served ?? '')
        const path = Object.keys(routes)[0] ?? ''
        expect(path).not.toBe('')
        for (const entry of manifest.wire ?? []) {
            const address = entry.request.split(' ')[1] ?? ''
            const search = address.slice(address.indexOf('?'))
            const answer = await routes[path]?.(
                new Request(`http://example.invalid${path}${search}`),
            )
            expect(await answer?.json()).toEqual(JSON.parse(entry.body))
        }
    }
})

// WHAT THE FIXTURES COULD NOT DO, and the reason the routes are here: the search fires per
// keystroke, so the address is different every time and no authored set covers it. `as` is one
// the wire does not name and the reader typed anyway.
test('memo-keyed answers a query no wire entry names', async () => {
    const routes = await routesOf('memo-keyed', 'server.ts')
    const answer = await routes['/api/search']?.(
        new Request('http://example.invalid/api/search?query=as'),
    )
    expect(await answer?.json()).toEqual([])
    const grace = await routes['/api/search']?.(
        new Request('http://example.invalid/api/search?query=gr'),
    )
    expect(await grace?.json()).toEqual(['Grace Hopper'])
})

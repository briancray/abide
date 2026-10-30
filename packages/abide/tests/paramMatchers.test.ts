// 23.26, 30.35, 30.37 — A SEGMENT NAMING A MATCHER, end to end: the param file it names, found up the
// tree at build, carried into both route tables, and the walk taking a part only where the matcher
// does — lifting the period default for `BRK.B`, and handing a part it refuses to the next route.
// Built and served (spawned, for `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Glob } from 'bun'
import { checkApp } from '#compiler/checkApp.ts'
import { url } from '#shared'
import { appFixture, buildApp, serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const PAGE = (label: string, param: string): string => `<script>
import { route } from '@abide/abide'
</script>

<p>${label} {route.params().${param}}</p>
`

let app = ''
let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ app, base, stop } = await serveApp({
        'holdings/TICKER.param.ts':
            '// A ticker, a share class after a period included.\nexport const TICKER = /[A-Z]+(?:\\.[A-Z]+)?/\n',
        'holdings/[symbol=TICKER].abide': PAGE('holding', 'symbol'),
        'holdings/[symbol=TICKER]/quote.handler.ts': `import { GET } from '@abide/abide/server'

export default GET(({ symbol }: { symbol: string }) => symbol)
`,
        'WORD.param.ts': 'export const WORD = /[a-z]+/',
        'docs/[name=WORD].abide': PAGE('word', 'name'),
        'docs/[...rest].abide': PAGE('rest', 'rest'),
    }))
}, 60_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

const page = async (path: string): Promise<string> => {
    const answer = await Bun.fetch(`${base}${path}`)
    return `${answer.status} ${(await answer.text()).match(/<p>([^<]*)<\/p>/)?.[1] ?? ''}`
}

// THE REVERT: give every segment the period default in `parseRoutePattern`, whatever it names; the
// holding answers 404 where its page is due, and so does its quote.
test('a segment naming a matcher takes the parts the matcher accepts — 23.26, 30.35', async () => {
    expect(await page('/holdings/BRK.B')).toBe('200 holding BRK.B')
    expect(await page('/holdings/brk')).toBe('404 ')
    const quote = await Bun.fetch(`${base}/holdings/BRK.B/quote`)
    expect(quote.status).toBe(200)
    expect(await quote.json()).toBe('BRK.B')
})

// 30.37 — A PART A MATCHER REFUSES IS THE NEXT ROUTE'S: `/docs/[name=WORD]` ranks above the rest, and
// a part it will not take reaches `/docs/[...rest]` rather than nothing.
test('a part a matcher refuses falls through to the next route — 30.37', async () => {
    expect(await page('/docs/intro')).toBe('200 word intro')
    expect(await page('/docs/Intro2')).toBe('200 rest Intro2')
})

// 23.26 — THE CLIENT'S TABLE CARRIES THE MATCHER TOO, so a navigation in the browser resolves an
// address as the server does (30.8). THE REVERT: drop the `matchers` column from `tableOf`; the
// client table names `[symbol=TICKER]` with nothing to resolve it in.
test("the client's route table carries each row's matcher — 23.26", async () => {
    let carried = false
    for await (const file of new Glob('*.js').scan(`${app}/.abide/client`))
        if (
            /matchers:\{"?TICKER"?:/.test(
                await Bun.file(`${app}/.abide/client/${file}`).text(),
            )
        )
            carried = true
    expect(carried).toBe(true)
})

// 30.19 — `url` WRITES WHAT A NAMED SEGMENT TAKES, a period included, and still never a dot-segment.
// THE REVERT: refuse any period in `encodedSegment` whatever the segment names; `BRK.B` throws.
test('url writes a period into a segment naming a matcher, and no dot-segment — 30.19', () => {
    expect(url('/holdings/[symbol=TICKER]', { symbol: 'BRK.B' })).toBe(
        '/holdings/BRK.B',
    )
    expect(() => url('/holdings/[symbol=TICKER]', { symbol: '..' })).toThrow(
        '30.19',
    )
    expect(() => url('/holdings/[symbol]', { symbol: 'BRK.B' })).toThrow(
        '30.19',
    )
})

// 20.23 — THE GENERATED SURFACES SAY WHAT A SEGMENT TAKES, and its matcher names no tool and no path:
// the path a client asks is `{symbol}`, and the tool the one a plain `[symbol]` would be. THE REVERT:
// publish the declared schema alone in `openApiOf` and `list`; neither carries the pattern.
test('OpenAPI and MCP publish the pattern a segment takes, and no matcher name — 20.23', async () => {
    const TICKER = '^(?!\\.\\.?$)(?:[A-Z]+(?:\\.[A-Z]+)?)$'
    const document = (await (
        await Bun.fetch(`${base}/__abide/openapi.json`)
    ).json()) as {
        paths: Record<
            string,
            { get?: { parameters?: { schema: { pattern?: string } }[] } }
        >
    }
    expect(
        document.paths['/holdings/{symbol}/quote']?.get?.parameters?.[0]?.schema
            .pattern,
    ).toBe(TICKER)
    const listed = (await (
        await Bun.fetch(`${base}/__abide/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        })
    ).json()) as {
        result: {
            tools: {
                name: string
                inputSchema: { properties?: Record<string, { pattern?: string }> }
            }[]
        }
    }
    const quote = listed.result.tools.find(
        (tool) => tool.name === 'get_holdings_symbol_quote',
    )
    expect(quote?.inputSchema.properties?.symbol?.pattern).toBe(TICKER)
})

// 23.9, 30.3 — A MATCHER THAT IS AN ALTERNATION OF LITERALS TYPES ITS PARAM as their union, read and
// written: the page reads `tab` as `'new' | 'edit'`, and `url` refuses `'view'` before any address is
// built. THE REVERT: declare every route `true` in `routesDeclaration`; the read is a `string` the
// union does not take (2322 on line 3), and `'view'` passes.
test('an alternation of literals types its param as their union — 23.9, 30.3', async () => {
    const app = appFixture({
        'tabs/TAB.param.ts': 'export const TAB = /new|edit/',
        'tabs/[tab=TAB].abide': `<script>
import { route, url } from '@abide/abide'
const tab: 'new' | 'edit' = route.params().tab
const other = url('/tabs/[tab=TAB]', { tab: 'view' })
</script>
<p>{tab} {other}</p>`,
    })
    const found = await checkApp(app)
    expect(found.map(({ line, code }) => `${line} ${code}`)).toEqual([
        '4 2322',
    ])
}, 60_000)

const refusedBuild = async (files: Record<string, string>): Promise<string> => {
    const built = await buildApp(appFixture(files))
    expect(built.exitCode).not.toBe(0)
    return built.stderr
}

// THE REVERT: drop the `found === undefined` refusal from `matchersOf`; the build passes, and the
// route table names a matcher nothing resolves.
test('a segment naming no param file is refused — 23.26', async () => {
    expect(
        await refusedBuild({ 'a/[x=NOPE].abide': '<p>x</p>' }),
    ).toContain('RULEBOOK 23.26')
}, 30_000)

// THE REVERT: drop the `other.found !== found` refusal from `matchersOf`; a page under `/a/[x=WORD]`
// and one under `/a/[y]/b` decide one position two ways, and the build passes.
test('two routes deciding one position by two matchers are refused — 23.27', async () => {
    expect(
        await refusedBuild({
            'a/WORD.param.ts': 'export const WORD = /[a-z]+/',
            'a/[x=WORD].abide': '<p>x</p>',
            'a/[y]/b.abide': '<p>b</p>',
        }),
    ).toContain('RULEBOOK 23.27')
}, 30_000)

// THE REVERT: skip the `matcher instanceof Error` refusal in `matchersOf`; a flagged matcher builds.
test('a param file the build cannot read as a matcher is refused — 23.24', async () => {
    expect(
        await refusedBuild({
            'a/WORD.param.ts': 'export const WORD = /[a-z]+/i',
            'a/[x=WORD].abide': '<p>x</p>',
        }),
    ).toContain('RULEBOOK 23.24')
}, 30_000)

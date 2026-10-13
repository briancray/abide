// 11.27 AND 11.29 — A DEFAULT WRITTEN IN A KEYED BODY'S PARAMETER IS PART OF ITS KEY. `{}` and
// `{ page: 1 }` run the same body over `({ page = 1 }) => …`, and keyed on the args as passed they
// were two entries: the value right for both callers, and the body run twice. What is counted is
// the RUNS, because the output cannot tell one run from two.

import { expect, test } from 'bun:test'
import { GET } from '#server'
import { inScope } from '#server/requestScope.ts'
import { reactive } from '#shared'
import { defaultsInSource } from '#shared/reactive/parameterDefaults.ts'

// THE REVERT: key `reach` on `given` rather than on `normalized(self, given)` in `Keyed.ts`;
// this reports `runs: 2`, with `{}`, `{"page":1}` and no args three entries where one is due.
test('a call leaving a member to its parameter default reaches the entry of one that wrote it — 11.29', () => {
    let runs = 0
    const pages = reactive(({ page = 1 }: { page?: number | undefined }) => {
        runs += 1
        return page
    })
    // Absent args are `{}`, as the wire writes both (11.27).
    const reached = [
        pages({}),
        pages({ page: 1 }),
        pages({ page: undefined }),
        (pages as (args?: unknown) => unknown)(),
    ]
    expect(`runs: ${runs}`).toBe('runs: 1')
    expect([...pages.entries.keys()]).toEqual(['{"page":1}'])
    for (const each of reached) expect(each).toBe(reached[0])
    // A member the caller did write is its own entry.
    pages({ page: 2 })
    expect(`runs: ${runs}`).toBe('runs: 2')
})

// A PATTERN MATCHES WHAT THE ENTRY WAS KEYED ON, so a trigger naming the default reaches the entry
// a call left to it. THE REVERT as above: the `{}` entry holds no `page`, and the refresh reaches
// nothing — `runs: 1` where 2 are due.
test('a trigger naming the default reaches the entry a call left to it — 11.29', () => {
    let runs = 0
    const pages = reactive(({ page = 1 }: { page?: number }) => {
        runs += 1
        return page
    })
    pages({})()
    pages.refresh({ page: 1 })
    pages({})()
    expect(`runs: ${runs}`).toBe('runs: 2')
})

// 11.27 BEHIND RUNGS: the value the onion runs in is keyed ahead of the handler's own, so the
// defaults are applied at the call. THE REVERT: drop `normalized` from `call` in `rpc.ts`; the rung
// runs for `{}` and again for `{ page: 1 }` — `rung runs: 2`.
test("an Rpc's rungs run once for a call that left a member to the handler's default — 11.27", async () => {
    let rungRuns = 0
    let bodyRuns = 0
    const list = GET(
        async ({ page = 1 }: { page?: number }) => {
            bodyRuns += 1
            return page
        },
        {
            middleware: [
                (next) => {
                    rungRuns += 1
                    return next()
                },
            ],
        },
    )
    // A rung reads the request, so the calls are made inside one.
    await inScope(new Request('http://app/'), async () => {
        expect(await list({})).toBe(1)
        expect(await list({ page: 1 })).toBe(1)
    })
    expect(`rung runs: ${rungRuns}, body runs: ${bodyRuns}`).toBe(
        'rung runs: 1, body runs: 1',
    )
})

// THE READER, over the spellings a body's text arrives in: bun's transpile of the source, and a
// minified bundle's — `!0` for `true`, `void 0` for `undefined`, `1e3`, a renamed binding.
test("the defaults are read off a body's text as bun and a minifier write it", () => {
    expect(
        defaultsInSource(
            `({ page = 1, q = "x", on = !0, off = !1, tags = [], filter = { "a-b": [1, "two"] }, gone = void 0 }) => page`,
        ),
    ).toEqual({
        names: ['page', 'q', 'on', 'off', 'tags', 'filter'],
        values: [1, 'x', true, false, [], { 'a-b': [1, 'two'] }],
    })
    expect(
        defaultsInSource(
            'async function*({page:n=1e3,"a-b":o=-2,size:s=0x10,t:u=`plain`,...r}){yield n}',
        ),
    ).toEqual({
        names: ['page', 'a-b', 'size', 't'],
        values: [1000, -2, 16, 'plain'],
    })
    expect(defaultsInSource("({ s = 'it\\'s\\n' }) => s")).toEqual({
        names: ['s'],
        values: ["it's\n"],
    })
    // Nothing to read: a plain parameter, a pattern with no default, no parameter at all.
    expect(defaultsInSource('args => args.page')).toBeNull()
    expect(defaultsInSource('(args) => args.page')).toBeNull()
    expect(defaultsInSource('({ page }) => page')).toBeNull()
    expect(defaultsInSource('function () { [native code] }')).toBeNull()
})

// A DEFAULT THAT IS NOT A LITERAL IS REFUSED, rather than left out of the key: left out, it is the
// double entry this closes, and it cannot be read without running the body. THE REVERT: hand back
// `null` where a default does not read; four of the five are accepted.
test('a default the key cannot read is refused at construction, naming the member — 11.29', () => {
    const refused: string[] = []
    for (const text of [
        '({ since = Date.now() }) => since',
        '({ limit = PAGE_SIZE }) => limit',
        '({ nested: { x = 2 } = {} }) => x',
        '({ n = 1n }) => n',
        '({ t = `a${b}` }) => t',
    ]) {
        try {
            defaultsInSource(text)
            refused.push('accepted')
        } catch (thrown) {
            refused.push((thrown as Error).message.split(', which')[0] ?? '')
        }
    }
    expect(refused).toEqual([
        "A keyed body's parameter defaults `since` to `Date.now()`",
        "A keyed body's parameter defaults `limit` to `PAGE_SIZE`",
        "A keyed body's parameter defaults `nested` to a default inside a nested pattern",
        "A keyed body's parameter defaults `n` to `1n`",
        "A keyed body's parameter defaults `t` to ``a${b}``",
    ])
    expect(() =>
        reactive(({ since = Date.now() }: { since?: number }) => since),
    ).toThrow('RULEBOOK 11.29')
})

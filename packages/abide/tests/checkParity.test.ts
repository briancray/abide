// 38.11 — WHAT AN EDITOR SHOWS FOR A FILE IS WHAT `abide check` FINDS IN IT: one pipeline asked of
// one file (`compiledSources`), not a second one that agrees most of the time. Each `.abide` of the
// fixture is checked alone and its findings held to the whole app's for its path — an ambient read
// in a `global` body (11.37), an `args` default the parameter does not write (11.30) and two pages
// answering one route (19.1).
//
// THE REVERT: have `checkSource` read and diagnose the page itself rather than through
// `compiledSources` — the lints and the emit go unasked, and the page's 11.37 and 11.30 and the
// second page's 19.1 go unshown (2 and 1 findings against none).

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { checkApp, checkSource } from '#compiler/checkApp.ts'
import { type AppChecker, openChecker } from '#compiler/compileApp.ts'
import type { Diagnosis } from '#compiler/Diagnostics.ts'

import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const PAGE = `<script>
import { jsonSchema, principal, reactive } from '@abide/abide'

const who = reactive(() => principal, { global: true })
const rows = reactive(({ limit }: { limit?: number }) => limit, {
    args: jsonSchema({ type: 'object', properties: { limit: { type: 'integer', default: 20 } } }),
})
</script>

<p>{who} {rows}</p>`

const ABOUT = `<p>about</p>`

const FILES: Record<string, string> = {
    'index.abide': PAGE,
    'about.abide': ABOUT,
    'about/index.abide': ABOUT,
}

let app = ''
let whole: Diagnosis[] = []
let checker: AppChecker | undefined

beforeAll(async () => {
    app = appFixture(FILES)
    whole = await checkApp(app)
    checker = await openChecker(app)
}, 60_000)

afterAll(async () => {
    await checker?.close()
    removeTemporaryModules()
})

function rows(found: readonly Diagnosis[]): string[] {
    const lines: string[] = []
    for (const { line, column, category, message } of found)
        lines.push(`${line}:${column} ${category} ${message}`)
    return lines.sort()
}

test('the fixture trips each finding the editor used to miss', () => {
    const cited = whole.map((diagnosis) => diagnosis.message).join('\n')
    expect(cited).toContain('RULEBOOK 11.37')
    expect(cited).toContain('11.30')
    expect(cited).toContain('RULEBOOK 19.1')
})

for (const relative of Object.keys(FILES))
    test(`${relative} checked alone finds what the app's check finds in it — 38.11`, async () => {
        const path = `${app}/${relative}`
        const alone = await checkSource(
            checker as AppChecker,
            path,
            FILES[relative] as string,
        )
        expect(rows(alone)).toEqual(
            rows(whole.filter((diagnosis) => diagnosis.path === path)),
        )
    }, 60_000)

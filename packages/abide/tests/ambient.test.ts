// 11.37 — A `global` BODY READING A REQUEST'S AMBIENT IS A BUILD ERROR NAMING IT, found by the
// checker's own symbols: abide's under another name is caught, an app's own of the same spelling is
// not, and neither is a request-local body or a `csp` read for anything but its `nonce`.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { checkApp } from '#compiler/checkApp.ts'
import { compileApp } from '#compiler/compileApp.ts'
import type { Diagnosis } from '#compiler/TypeSession.ts'
import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'
import { refusal } from './typed.ts'

const SESSION = `import { cookies as jar, principal, reactive } from '@abide/abide'
import { csp, GET, request } from '@abide/abide/server'

export const who = reactive(() => principal, { global: true })
export const crumbs = reactive(() => jar(), { global: true })
export const nonce = reactive(() => csp.nonce, { global: true })
export const policy = reactive(() => csp, { global: true })
export const local = reactive(() => request().url)
export const viewer = GET(() => principal.authenticated, { global: true })
`

const PAGE = `<script>
import { reactive } from '@abide/abide'

const route = { x: 1 }
const mine = reactive(() => route.x, { global: true })
</script>

<p>{mine}</p>`

let app = ''
let found: Diagnosis[] = []

beforeAll(async () => {
    app = appFixture({
        'package.json': JSON.stringify({
            name: 'ambient-fixture',
            type: 'module',
            imports: { '#src/*': './*' },
        }),
        'page.abide': PAGE,
        'shared/session.ts': SESSION,
    })
    found = (await checkApp(app)).filter((diagnosis) =>
        diagnosis.message.includes('11.37'),
    )
}, 60_000)

afterAll(removeTemporaryModules)

function place(text: string, needle: string): { line: number; column: number } {
    const at = text.indexOf(needle)
    const before = text.slice(0, at)
    return {
        line: before.split('\n').length,
        column: at - before.lastIndexOf('\n'),
    }
}

// THE REVERTS: match the name as spelled rather than the symbol's own and the aliased `jar()` goes
// unfound (3 against 4); drop `readsNonce` and the bare `csp` is found (5 against 4); read
// `reactive(…)` alone in `reactiveOptions` and the `GET`'s global body goes unfound (3 against 4).
// The page's own `route` is the near miss the declaration's path keeps out.
test('a global body reading an ambient is found at the read — 11.37', () => {
    expect(
        found.map(({ path, line, column }) => ({
            file: path.slice(app.length + 1),
            line,
            column,
        })),
    ).toEqual([
        { file: 'shared/session.ts', ...place(SESSION, 'principal, {') },
        { file: 'shared/session.ts', ...place(SESSION, 'jar()') },
        { file: 'shared/session.ts', ...place(SESSION, 'csp.nonce') },
        {
            file: 'shared/session.ts',
            ...place(SESSION, 'principal.authenticated'),
        },
    ])
    expect(found[1]?.message).toContain('`cookies`')
    expect(found[2]?.message).toContain('`csp.nonce`')
})

// THE BUILD REFUSES, every read named. THE REVERT: drop the `ambient` throw in `compileApp`;
// the compile succeeds.
test('a build refuses a global body reading an ambient — 11.37', async () => {
    const refused = await refusal(compileApp(app))
    expect(refused).toContain('RULEBOOK 11.37')
    expect(refused).toContain('`principal`')
    expect(refused).toContain('`csp.nonce`')
}, 60_000)

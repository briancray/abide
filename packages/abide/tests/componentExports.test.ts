// 34.33 — A `<script module>`'S NAMED EXPORT IS THE `.abide`'S, beside its component: to a page and
// to a handler file, on the server and in the browser's bundle, and to the checker. ONE EVALUATION:
// the module the component renders from is the module the importer calls into, so a function an
// importer calls moves what the component reads.

import { afterAll, expect, test } from 'bun:test'

import { checkApp } from '#compiler/checkApp.ts'

import { appFixture, buildApp, startApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

const COUNTER = `<script module>
const counted: string[] = []

export function count(name: string): number {
    counted.push(name)
    return counted.length
}

export const GREETING = 'hello'
</script>
<p>counted {counted.join(',')}</p>
`

// THE REVERT: drop `export * from` in `abideModules`' `boundModule`; the handler file's import of
// `count` is `undefined`, and the address answers 500 where 200 is due.
test('a page and a handler file call what a component exports — 34.33', async () => {
    const app = appFixture({
        'lib/Counter.abide': COUNTER,
        'index.abide': `<script>
import Counter, { count, GREETING } from '#src/lib/Counter.abide'

count('page')
</script>
<h1>{GREETING}</h1>
<Counter/>
`,
        'tally.handler.ts': `import { GET } from '@abide/abide/server'
import { count, GREETING } from '#src/lib/Counter.abide'

export default GET(() => \`\${GREETING} \${count('handler')}\`)
`,
    })
    const built = await buildApp(app)
    expect(built.stderr).toBe('')
    expect(built.exitCode).toBe(0)
    const { base, stop } = await startApp(app)
    try {
        const tallied = await Bun.fetch(`${base}/tally`)
        expect(tallied.status).toBe(200)
        expect(await tallied.text()).toContain('hello 1')
        const page = await (await Bun.fetch(`${base}/`)).text()
        expect(page).toContain('<h1>hello</h1>')
        // The page's call lands in the module the component renders from, after the handler's.
        expect(page).toContain('counted handler,page')
    } finally {
        stop()
    }
}, 60_000)

// A PAGE READS ANOTHER `.abide`'S CHECKED MODULE ITSELF; a `.ts` reads the `.abide.d.ts` stand-in.
// THE REVERT: drop the `export * from` line in `ShadowHost`'s stand-in; the `.ts`'s import of
// `count` is a 2614 ("has no exported member") beside the page's 2322 — 2 errors where 1 is due.
test('the checker types what a component exports, at a page and a .ts — 34.33', async () => {
    const app = appFixture({
        'lib/Counter.abide': COUNTER,
        'index.abide': `<script>
import Counter, { count } from '#src/lib/Counter.abide'

const wrong: string = count('page')
</script>
<Counter/>
`,
        'lib/tally.ts': `import { count } from '#src/lib/Counter.abide'

export const tally: number = count('ts')
`,
    })
    const found = await checkApp(app)
    const errors = found.filter((diagnosis) => diagnosis.category === 'error')
    expect(errors.map((diagnosis) => diagnosis.code)).toEqual([2322])
    expect(errors[0]?.path).toEndWith('index.abide')
}, 60_000)

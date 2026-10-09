// 35.4 — A HANDLER THAT IMPORTS A `.abide` RENDERS IT, in both lanes. The handler is the app's own
// `.ts` and is not compiled, so its import reached bun as written and bun loaded the unknown
// extension as a `file`: the handler held the component's PATH, and `render(Card({ name }))` threw
// "Card is not a function" — a 500 where the document is due.
//
// THE REVERT: drop the `Bun.plugin(componentImports(…))` line from `sourceModuleLoader`. Both
// lanes then answer 500 rather than 200, 2 of 2.

import { afterAll, expect, test } from 'bun:test'
import { addressOf, appFixture, BIN, buildApp, startApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const FILES = {
    'ui/components/Card.abide': `<script>
import { props } from 'abide'

const { name } = props<{ name: string }>()
</script>
<p>hello {name}</p>
`,
    'server/rpc/preview.ts': `import { GET, page, render } from 'abide/server'
import Card from '#ui/components/Card.abide'

export const preview = GET(async ({ name }: { name: string }) =>
    page(await render(Card({ name }), '<html><body></body></html>')),
)
`,
}
const ADDRESS = '/__abide/rpc/preview/preview?name=ada'

afterAll(removeTemporaryModules)

async function answered(base: string): Promise<[number, string]> {
    const answer = await Bun.fetch(`${base}${ADDRESS}`)
    return [answer.status, await answer.text()]
}

test('abide start renders a component a handler imports — 35.4', async () => {
    const app = appFixture(FILES)
    const built = await buildApp(app)
    expect(built.exitCode).toBe(0)
    const { base, stop } = await startApp(app)
    try {
        const [status, body] = await answered(base)
        expect(status).toBe(200)
        expect(body).toContain('<p>hello ada</p>')
    } finally {
        stop()
    }
}, 30_000)

test('abide dev renders a component a handler imports — 35.4', async () => {
    const app = appFixture(FILES)
    const dev = Bun.spawn(['bun', BIN, 'dev', '--root', app, '--port', '0'], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
    })
    try {
        const [status, body] = await answered(await addressOf(dev))
        expect(status).toBe(200)
        expect(body).toContain('<p>hello ada</p>')
    } finally {
        dev.kill()
    }
}, 30_000)

// 36.3 — `NODE_ENV`, AS THE APP READS IT: named by the command where the process was started with
// none, and left exactly as given where it was. Spawned, because the default is the command's and
// the value is the process's — and `bun test` starts this one with `NODE_ENV=test`, so every spawn
// here says which environment it hands the child.
//
// THE REVERT: drop the `process.env.NODE_ENV ??=` line from `start` in `bin/abide.ts`; the unset
// case answers `null` where `"production"` is due. Drop the `env` `serveDev` hands its worker and
// the dev case answers `null` too — the command set it, and the worker never saw it.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { appFixture, buildApp, startApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const BIN = new URL('../bin/abide.ts', import.meta.url).pathname
const ADDRESS = '/environment/name'

let app = ''
const stops: (() => void)[] = []

beforeAll(async () => {
    app = appFixture({
        'page.abide': '<main>home</main>',
        'environment/environment.abide': `<script server>
import { GET } from '@abide/abide/server'

export const name = GET(() => process.env.NODE_ENV ?? null)
</script>
`,
    })
    const built = await buildApp(app)
    if (built.exitCode !== 0) throw new Error(built.stderr)
}, 30_000)

afterAll(() => {
    for (const stop of stops) stop()
    removeTemporaryModules()
})

function without(name: string): Record<string, string | undefined> {
    const env = { ...process.env }
    delete env[name]
    return env
}

async function nameFrom(base: string): Promise<unknown> {
    return await (await Bun.fetch(`${base}${ADDRESS}`)).json()
}

test('abide start names the environment production where none was given — 36.3', async () => {
    const { base, stop } = await startApp(app, without('NODE_ENV'))
    stops.push(stop)
    expect(await nameFrom(base)).toBe('production')
})

test('an environment name the process was given is read verbatim — 36.3', async () => {
    const { base, stop } = await startApp(app, {
        ...process.env,
        NODE_ENV: 'Staging',
    })
    stops.push(stop)
    expect(await nameFrom(base)).toBe('Staging')
})

test('abide dev names the environment development where none was given — 36.3', async () => {
    const server = Bun.spawn(
        ['bun', BIN, 'dev', '--root', app, '--port', '0'],
        {
            stdout: 'pipe',
            stderr: 'pipe',
            env: without('NODE_ENV'),
        },
    )
    stops.push(() => server.kill())
    let seen = ''
    let base = ''
    for await (const chunk of server.stdout as ReadableStream<Uint8Array>) {
        seen += new TextDecoder().decode(chunk)
        const found = /http:\/\/[^\s]+/.exec(seen)
        if (found) {
            base = new URL(found[0]).origin
            break
        }
    }
    expect(base).not.toBe('')
    expect(await nameFrom(base)).toBe('development')
}, 30_000)

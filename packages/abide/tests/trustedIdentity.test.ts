// 54.28-54.30 — A CALLER A TRUSTED PROXY NAMES: served on a real listener, since what decides is the
// peer `request.ip` answers, and a call made in process has none.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

let base = ''
let stop = (): void => {}

const HANDLER = (
    proxies: string,
) => `import { principal, rpc, signedIn, trustedIdentity } from '@abide/abide/server'

const trust = trustedIdentity({
    header: 'x-forwarded-user',
    proxies: ${proxies},
    claims: (name) => ({ name }),
})

export default rpc(async () => (await principal.resolved).name, {
    middleware: [trust, signedIn],
    description: 'Who the caller is.',
})
`

beforeAll(async () => {
    ;({ base, stop } = await serveApp(
        {
            'fromLoopback.server.ts': HANDLER(`['127.0.0.0/8', '::1']`),
            'fromGateway.server.ts': HANDLER(`['10.0.0.0/8']`),
        },
        process.env,
        ['--hostname', '127.0.0.1'],
    ))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

const asked = (path: string, user?: string) =>
    Bun.fetch(`${base}/${path}`, {
        headers: user === undefined ? {} : { 'x-forwarded-user': user },
    })

// THE REVERT: drop the peer check, and Theo is signed in by a header he wrote himself.
test('a header from a trusted proxy signs the caller in, and from anyone else is ignored — 54.28, 54.29', async () => {
    const trusted = await asked('fromLoopback', 'grace')
    expect([trusted.status, await trusted.json()]).toEqual([200, 'grace'])
    const forged = await asked('fromGateway', 'theo')
    expect(forged.status).toBe(401)
})

test('a trusted proxy naming nobody leaves the caller as they came — 54.30', async () => {
    expect((await asked('fromLoopback')).status).toBe(401)
    expect((await asked('fromLoopback', '')).status).toBe(401)
})

test('a caller a proxy names is signed in for the request alone, with no cookie sealed — 54.30', async () => {
    const answer = await asked('fromLoopback', 'grace')
    expect(answer.headers.get('set-cookie') ?? '').not.toContain(
        'abide-principal',
    )
})

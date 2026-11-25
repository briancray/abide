// THE GUARDS — rungs a handler's `middleware` names (54.1-54.6), each driven through the whole request
// path of an app booted in this process over the handlers below, signed in as the call says.

import { expect, test } from 'bun:test'

import { authorize, GET, POST, readOnly, signedIn } from '#server'
import { MOUNT } from '#shared/mount.ts'

import { inMemoryApp } from './inMemoryApp.ts'

let bodyRuns = 0

const getFigure = GET(
    () => {
        bodyRuns += 1
        return { total: 18_400 }
    },
    { middleware: [authorize({ role: 'admin' })] },
)
const getOwn = GET(() => 'own', { middleware: [signedIn] })
const getAudit = GET(() => 'audit', {
    middleware: [
        authorize((member) => member.name === 'maya', {
            message: 'Maya audits.',
        }),
    ],
})
const getPayroll = GET(() => 'payroll', {
    middleware: [authorize({ role: 'admin' }, { status: 404 })],
})
const getPipeline = GET(() => 'pipeline', {
    middleware: [
        authorize({ groups: ['sales'], region: { codes: ['emea', 'apac'] } }),
    ],
})
const signIn = POST(() => 'signed in')
const archive = POST(() => 'archived', {
    middleware: [readOnly({ allow: [signIn] })],
})

const app = await inMemoryApp({
    'team/getFigure.handler.ts': { default: getFigure },
    'team/getOwn.handler.ts': { default: getOwn },
    'team/getAudit.handler.ts': { default: getAudit },
    'team/getPayroll.handler.ts': { default: getPayroll },
    'team/getPipeline.handler.ts': { default: getPipeline },
    'team/signIn.handler.ts': { default: signIn },
    'team/archive.handler.ts': { default: archive },
})

/** `status name` of what `address` answers a caller signed in with `claims`, or nobody. */
async function answered(
    address: string,
    claims?: Record<string, unknown>,
    method = 'GET',
): Promise<string> {
    const answer = await app.fetch(
        new Request(`http://app.invalid/team/${address}`, {
            method,
            headers: { 'content-type': 'application/json' },
            ...(method === 'GET' ? {} : { body: '{}' }),
        }),
        claims === undefined ? {} : { principal: claims },
    )
    const body = await answer.json()
    return `${answer.status} ${body?.type ?? JSON.stringify(body)}${body?.detail ? `: ${body.detail}` : ''}`
}

// 54.24 UNDER A SUB-PATH: word for word, the path included — the one routing names, below the mount.
// THE REVERT: name the request bun received, and the hidden 404 says `/docs/team/getPayroll` where
// the unserved address says `/team/getNothing`.
test('authorize at 404 names the path routing names, under a mount — 54.24, 15.7', async () => {
    const standing = MOUNT.current
    MOUNT.current = () => '/docs'
    const body = async (address: string) =>
        (
            await app.fetch(
                new Request(`http://app.invalid/docs/team/${address}`),
                {
                    principal: { name: 'theo', role: 'sales' },
                },
            )
        ).text()
    try {
        expect(await body('getPayroll')).toBe(
            (await body('getNothing')).replace('getNothing', 'getPayroll'),
        )
    } finally {
        MOUNT.current = standing
    }
})

// THE REVERT: hand `signedIn`'s caller to `next` whatever `principal.authenticated` says, and
// nobody reads `own` — `200 "own"` where `401 SignedOut` is due.
test('signedIn refuses nobody SignedOut at 401, and lets a member through — 54.1', async () => {
    expect(await answered('getOwn')).toBe('401 SignedOut: Sign in first.')
    expect(await answered('getOwn', { name: 'theo' })).toBe('200 "own"')
})

// THE REVERT: compare nothing in `authorize`, and Theo reads the figure — `200 {"total":18400}`.
test('authorize refuses a member the claims do not match Forbidden at 403, before the body runs — 54.2, 54.3, 54.4', async () => {
    const before = bodyRuns
    expect(await answered('getFigure')).toBe('401 SignedOut: Sign in first.')
    expect(await answered('getFigure', { name: 'theo', role: 'sales' })).toBe(
        '403 Forbidden: Forbidden',
    )
    expect(bodyRuns).toBe(before)
    expect(await answered('getFigure', { name: 'maya', role: 'admin' })).toBe(
        '200 {"total":18400}',
    )
})

// THE REVERT: compare arrays item for item in `matchesPattern`, and Maya, in a group beside sales, is
// refused — `403 Forbidden` where `200 "pipeline"` is due.
test('authorize admits a member whose claims hold the ones it names, an array holding every item it lists — 54.3', async () => {
    const maya = {
        name: 'maya',
        groups: ['support', 'sales'],
        region: { name: 'world', codes: ['apac', 'amer', 'emea'] },
    }
    expect(await answered('getPipeline', maya)).toBe('200 "pipeline"')
    expect(
        await answered('getPipeline', { ...maya, groups: ['support'] }),
    ).toBe('403 Forbidden: Forbidden')
    expect(
        await answered('getPipeline', {
            ...maya,
            region: { codes: ['emea'] },
        }),
    ).toBe('403 Forbidden: Forbidden')
    expect(await answered('getPipeline', { ...maya, groups: 'sales' })).toBe(
        '403 Forbidden: Forbidden',
    )
})

test('authorize given a function admits whom it passes, refusing with the message given — 54.3, 54.4', async () => {
    expect(await answered('getAudit', { name: 'theo' })).toBe(
        '403 Forbidden: Maya audits.',
    )
    expect(await answered('getAudit', { name: 'maya' })).toBe('200 "audit"')
})

// THE REVERT: ignore `status`, and Theo is told the address exists — `403 Forbidden`.
test('authorize at 404 answers a member it does not admit as an address nothing serves — 54.24', async () => {
    expect(await answered('getPayroll', { name: 'theo', role: 'sales' })).toBe(
        await answered('getNothing', { name: 'theo', role: 'sales' }),
    )
    expect(await answered('getPayroll', { name: 'maya', role: 'admin' })).toBe(
        '200 "payroll"',
    )
})

test('a rung refuses an in-process call as it refuses one over the wire — 54.4', async () => {
    const refusal = await app.run(
        async () => {
            try {
                return await getFigure()
            } catch (error) {
                return error
            }
        },
        { principal: { name: 'theo', role: 'sales' } },
    )
    expect(getFigure.isError(refusal, 'Forbidden')).toBe(true)
})

// THE REVERT: let every method through `readOnly`, and the archive takes the write — `200
// "archived"`.
test('readOnly refuses a write ReadOnly at 403 — 54.5', async () => {
    expect(await answered('archive', undefined, 'POST')).toBe(
        '403 ReadOnly: This copy takes no changes.',
    )
})

// As the per-request lane hands it a request (37.20): addressed below the mount, by any method.
// THE REVERT: drop the `allow` loop, and sign-in is refused — `POST signIn: refused`.
test('readOnly hands a read and a write to an allowed handler to next — 54.5, 54.6', async () => {
    const rung = readOnly({ allow: [signIn] })
    const passed = async (method: string, address: string) => {
        const answer = await rung(async () => 'through', {
            request: new Request(`http://app.invalid${address}`, { method }),
        })
        return `${method} ${address.split('/').pop()}: ${answer === 'through' ? 'through' : 'refused'}`
    }
    expect(signIn.address).toBe('/team/signIn')
    expect(
        [
            await passed('GET', '/team/getOwn'),
            await passed('HEAD', '/team/getOwn'),
            await passed('OPTIONS', '/team/archive'),
            await passed('POST', '/team/signIn'),
            await passed('POST', '/team/archive'),
            await passed('DELETE', '/team/archive'),
        ].join(' | '),
    ).toBe(
        'GET getOwn: through | HEAD getOwn: through | OPTIONS archive: through | POST signIn: through | POST archive: refused | DELETE archive: refused',
    )
})

// 37.20 — UNDER A SUB-PATH TOO: the lane hands the path below the mount, and an address carries it.
// THE REVERT: rebuild the address as `url('/').slice(0, -1)` + the path; the bare mount `/docs` loses
// its last letter, and sign-in is refused — `POST signIn: refused`.
test('readOnly hands a write to an allowed handler under a mount — 54.6, 37.20', async () => {
    const standing = MOUNT.current
    MOUNT.current = () => '/docs'
    try {
        const answer = await readOnly({ allow: [signIn] })(
            async () => 'through',
            {
                request: new Request('http://app.invalid/team/signIn', {
                    method: 'POST',
                }),
            },
        )
        expect(
            `POST signIn: ${answer === 'through' ? 'through' : 'refused'}`,
        ).toBe('POST signIn: through')
    } finally {
        MOUNT.current = standing
    }
})

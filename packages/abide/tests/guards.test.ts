// THE GUARDS — rungs a handler's `middleware` names (54.1-54.6), each driven through the whole request
// path of an app booted in this process over the handlers below, signed in as the call says.

import { expect, test } from 'bun:test'

import { GET, POST, readOnly, requireRole, signedIn } from '#server'

import { inMemoryApp } from './inMemoryApp.ts'

let bodyRuns = 0

const getFigure = GET(
    () => {
        bodyRuns += 1
        return { total: 18_400 }
    },
    { middleware: [requireRole('admin')] },
)
const getOwn = GET(() => 'own', { middleware: [signedIn] })
const getAudit = GET(() => 'audit', {
    middleware: [
        requireRole((member) => member.name === 'maya', {
            message: 'Maya audits.',
        }),
    ],
})
const getPayroll = GET(() => 'payroll', {
    middleware: [requireRole('admin', { status: 404 })],
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

// THE REVERT: hand `signedIn`'s caller to `next` whatever `principal.authenticated` says, and
// nobody reads `own` — `200 "own"` where `401 SignedOut` is due.
test('signedIn refuses nobody SignedOut at 401, and lets a member through — 54.1', async () => {
    expect(await answered('getOwn')).toBe('401 SignedOut: Sign in first.')
    expect(await answered('getOwn', { name: 'theo' })).toBe('200 "own"')
})

// THE REVERT: compare nothing in `requireRole`, and Theo reads the figure — `200 {"total":18400}`.
test('requireRole refuses a member without the role Forbidden at 403, before the body runs — 54.2, 54.3, 54.4', async () => {
    const before = bodyRuns
    expect(await answered('getFigure')).toBe('401 SignedOut: Sign in first.')
    expect(await answered('getFigure', { name: 'theo', role: 'sales' })).toBe(
        '403 Forbidden: Only admins may do this.',
    )
    expect(bodyRuns).toBe(before)
    expect(await answered('getFigure', { name: 'maya', role: 'admin' })).toBe(
        '200 {"total":18400}',
    )
})

test('requireRole given a function admits whom it passes, refusing with the message given — 54.3, 54.4', async () => {
    expect(await answered('getAudit', { name: 'theo' })).toBe(
        '403 Forbidden: Maya audits.',
    )
    expect(await answered('getAudit', { name: 'maya' })).toBe('200 "audit"')
})

// THE REVERT: ignore `status`, and Theo is told the address exists — `403 Forbidden`.
test('requireRole at 404 answers a member without the role as an address nothing serves — 54.28', async () => {
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

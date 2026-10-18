// SECTION 26 — THE PRINCIPAL, over a served app (spawned, for `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { handlerFiles, serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const HANDLERS = `import { GET, POST, principal } from '@abide/abide/server'
import { RESOLVED } from '#src/lib/RESOLVED.server.ts'

export const signIn = POST(async ({ name }: { name: string }) => {
    await principal.set({ name })
    return principal.authenticated()
})

export const whoami = GET(async () => ({
    authenticated: await principal.authenticated,
    resolved: await principal.resolved,
    caller: principal.caller(),
}))

export const signOut = POST(() => {
    principal.clear()
    return principal.authenticated()
})

export const resolutions = GET(() => RESOLVED.count)
`

// How many times `onPrincipal` ran, in the server's process.
const RESOLVED = `export const RESOLVED = { count: 0 }
`

const PAGE = `<script>
import { principal } from '@abide/abide'
</script>

<main>{principal.authenticated() ? 'in' : 'out'}</main>`

let base = ''
let stop = (): void => {}
const RPC = '/session'

beforeAll(async () => {
    process.env.ABIDE_PRINCIPAL_SECRET = 'new-secret,old-secret'
    ;({ base, stop } = await serveApp({
        'index.abide': PAGE,
        ...handlerFiles('session', HANDLERS),
        'lib/RESOLVED.server.ts': RESOLVED,
        // 26.4 — an app answer that tries to claim the baseline's fields.
        'layout.abide': `<script server>
import { onPrincipal } from '@abide/abide/server'\nimport { RESOLVED } from '#src/lib/RESOLVED.server.ts'\n\nonPrincipal((claims) => {\n    RESOLVED.count += 1\n    return { ...(claims as object), role: 'admin', authenticated: 'spoofed' }\n})\n</script>
`,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

function cookieFrom(answer: Response, name: string): string | undefined {
    for (const line of answer.headers.getSetCookie())
        if (line.startsWith(`${name}=`)) return line.slice(0, line.indexOf(';'))
    return undefined
}

async function signedIn(): Promise<{ principal: string; caller: string }> {
    const first = await Bun.fetch(`${base}${RPC}/whoami`)
    const caller = cookieFrom(first, 'abide-caller') as string
    const answer = await Bun.fetch(`${base}${RPC}/signIn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: caller },
        body: '{"name":"ada"}',
    })
    expect(await answer.json()).toBe(true)
    const line = answer.headers
        .getSetCookie()
        .find((each) => each.startsWith('abide-principal=')) as string
    // 26.12.
    expect(line).toContain('HttpOnly')
    expect(line).toContain('SameSite=Lax')
    return { principal: line.slice(0, line.indexOf(';')), caller }
}

// 26.10 — an anonymous visitor is a document, never null.
test('an anonymous caller is authenticated false — 26.10', async () => {
    const answer = await Bun.fetch(`${base}/__abide/principal`)
    expect(answer.headers.get('cache-control')).toBe('private, no-store')
    expect(await answer.json()).toEqual({ authenticated: false })
})

// 26.4, 26.6, 26.8 — SIGNED IN, the app's resolver over the claims and the baseline over both, with
// the caller the browser already had. THE REVERT: spread the baseline before the resolved fields in
// `documentOf`; `authenticated` reads "spoofed".
test('set authenticates, the baseline wins, and the caller survives — 26.4, 26.6', async () => {
    const { principal, caller } = await signedIn()
    const answer = await Bun.fetch(`${base}${RPC}/whoami`, {
        headers: { cookie: `${principal}; ${caller}` },
    })
    const body = (await answer.json()) as {
        authenticated: boolean
        resolved: Record<string, unknown>
        caller: string
    }
    expect(body.authenticated).toBe(true)
    expect(body.resolved.name).toBe('ada')
    expect(body.resolved.role).toBe('admin')
    expect(body.resolved.authenticated).toBe(true)
    expect(`abide-caller=${body.caller}`).toBe(caller)
})

// 26.11 — THE SEAL IS A STANDARD JWT: three parts, an HS256 header, the claims as the payload's own
// members beside \`exp\` in seconds, and a signature any HMAC over the secret reproduces — so another
// service holding the secret verifies it with no abide in it. THE REVERT: seal the claims under one
// private member as before; \`name\` is not a member of the payload.
test('the seal is an HS256 JWT another service can verify — 26.11', async () => {
    const { principal } = await signedIn()
    const token = principal.slice('abide-principal='.length)
    const [header, payload, signature] = token.split('.') as [
        string,
        string,
        string,
    ]
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
        alg: 'HS256',
        typ: 'JWT',
    })
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
    expect(claims.name).toBe('ada')
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000)
    expect(claims.exp).toBeLessThan(Date.now() / 1000 + 8 * 24 * 60 * 60)
    const expected = new Bun.CryptoHasher('sha256', 'new-secret')
        .update(`${header}.${payload}`)
        .digest('base64url')
    expect(signature).toBe(expected)
})

// 26.13 — A TAMPERED SEAL IS AN ANONYMOUS CALLER, not an error: a payload signed by nobody, a token
// naming \`alg: none\`, one cut short and one that will not decode. THE REVERT: skip the signature
// check in \`unseal\`; the forged claims are served as authenticated.
test('a seal with a bad signature reads as anonymous — 26.13', async () => {
    const { principal } = await signedIn()
    const [header, , signature] = principal
        .slice('abide-principal='.length)
        .split('.')
    const encode = (value: unknown): string =>
        Buffer.from(JSON.stringify(value)).toString('base64url')
    const forged = encode({
        name: 'mallory',
        exp: Math.floor(Date.now() / 1000) + 60,
    })
    for (const cookie of [
        `abide-principal=${header}.${forged}.${signature}`,
        `abide-principal=${encode({ alg: 'none', typ: 'JWT' })}.${forged}.`,
        `abide-principal=${header}.${forged}`,
        'abide-principal=%%%',
    ]) {
        const answer = await Bun.fetch(`${base}/__abide/principal`, {
            headers: { cookie },
        })
        expect(await answer.json()).toEqual({ authenticated: false })
    }
})

// 26.7, 26.9 — CLEAR SIGNS OUT FOR THE REST OF THIS REQUEST AND THE NEXT, and rotates the caller.
test('clear signs out now and next time, and rotates the caller — 26.7, 26.9', async () => {
    const { principal, caller } = await signedIn()
    const answer = await Bun.fetch(`${base}${RPC}/signOut`, {
        method: 'POST',
        headers: { cookie: `${principal}; ${caller}` },
    })
    expect(await answer.json()).toBe(false)
    const lines = answer.headers.getSetCookie()
    expect(
        lines.some(
            (line) =>
                line.startsWith('abide-principal=;') &&
                line.includes('Expires='),
        ),
    ).toBe(true)
    const rotated = cookieFrom(answer, 'abide-caller')
    expect(rotated).toBeDefined()
    expect(rotated).not.toBe(caller)
})

// 26.17, 41.5, 41.13, 41.20 — A PAGE THAT READ THE PRINCIPAL SEEDS IT as it seeds any handler: the head
// starts the browser's request for it, and that request is answered from the render's resolution
// rather than by resolving again. Counted as `onPrincipal` runs, because a second resolution answers
// the same document. THE REVERT: `PRINCIPAL.document = resolvePrincipal` in `#server/principal.ts`;
// the head starts nothing, the answer is `Direct`, and `onPrincipal` runs 2 times where 1 is due.
test("a page's read of the principal is seeded, and the browser's read is answered from it — 26.17", async () => {
    const { principal, caller } = await signedIn()
    const cookie = `${principal}; ${caller}`
    const count = async (): Promise<number> =>
        (await (await Bun.fetch(`${base}${RPC}/resolutions`)).json()) as number
    const before = await count()
    const page = await Bun.fetch(`${base}/`, { headers: { cookie } })
    const html = await page.text()
    expect(html).toContain('"/__abide/principal"')
    const answer = await Bun.fetch(`${base}/__abide/principal`, {
        headers: { cookie },
    })
    expect(answer.headers.get('server-timing')).toStartWith('Seeded;')
    expect(await answer.json()).toMatchObject({
        authenticated: true,
        name: 'ada',
    })
    expect((await count()) - before).toBe(1)
})

// A SIGN-IN OR SIGN-OUT A HANDLER ANSWERED SAYS SO, in a header a browser's `fetch` can read — the
// principal cookie is `HttpOnly` and `set-cookie` is withheld from script, so nothing else on the
// answer tells the page its `principal` moved. A read of the principal says nothing. THE REVERT:
// drop the two `PRINCIPAL_HEADER` writes in `#server/principal.ts`; both answers carry `null`.
test('an answer whose handler signed the caller in or out says so — principal refresh', async () => {
    const { principal, caller } = await signedIn()
    const cookie = `${principal}; ${caller}`
    const signIn = await Bun.fetch(`${base}${RPC}/signIn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: '{"name":"grace"}',
    })
    expect(signIn.headers.get('abide-principal')).toBe('set')
    const read = await Bun.fetch(`${base}${RPC}/whoami`, {
        headers: { cookie },
    })
    expect(read.headers.get('abide-principal')).toBeNull()
    const signOut = await Bun.fetch(`${base}${RPC}/signOut`, {
        method: 'POST',
        headers: { cookie },
    })
    expect(signOut.headers.get('abide-principal')).toBe('clear')
})

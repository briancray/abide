// SECTION 26 — THE PRINCIPAL, over a served app (spawned, for `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const HANDLERS = `import { GET, POST, principal } from 'abide/server'

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
`

let base = ''
let stop = (): void => {}
const RPC = '/__abide/rpc/session'

beforeAll(async () => {
    process.env.ABIDE_PRINCIPAL_SECRET = 'new-secret,old-secret'
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': '<main>home</main>',
        'server/rpc/session.ts': HANDLERS,
        // 26.4 — an app answer that tries to claim the baseline's fields.
        'server/app.ts': `import { onPrincipal } from 'abide/server'\n\nonPrincipal((claims) => ({ ...(claims as object), role: 'admin', authenticated: 'spoofed' }))\n`,
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
    expect(answer.headers.get('cache-control')).toBe('no-store')
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

// 26.13 — A TAMPERED SEAL IS AN ANONYMOUS CALLER, not an error. THE REVERT: skip the signature check
// in `unseal`; the forged claims are served as authenticated.
test('a seal with a bad signature reads as anonymous — 26.13', async () => {
    const { principal } = await signedIn()
    const [payload] = principal.slice('abide-principal='.length).split('.')
    const forged = Buffer.from(
        JSON.stringify({ c: { name: 'mallory' }, e: Date.now() + 60_000 }),
    ).toString('base64url')
    for (const cookie of [
        `abide-principal=${forged}.${principal.split('.')[1]}`,
        `abide-principal=${payload}`,
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

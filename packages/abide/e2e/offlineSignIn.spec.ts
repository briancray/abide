// SECTION 45 BEHIND A SIGN-IN PROXY: the app served through a gateway that sends a page load with no
// session to an identity provider on another origin, which sends it back with the session's cookie —
// by a redirect, or by a form it posts back — and answers anything else with no session 401. The
// gateway tells a page load as such gateways do, by `sec-fetch-dest: document`, so a navigation the
// worker asks again itself, `empty`, is refused rather than sent to sign in.

import { expect, type Page, test } from '@playwright/test'
import type { Server, Subprocess } from 'bun'

import { servedFixture } from './servedFixture.ts'

test.describe.configure({ mode: 'default' })

const FILES = {
    'layout.abide': `<html lang="en">
<head>
    <meta charset="utf-8" />
</head>
<body>
    <slot/>
</body>
</html>`,
    'index.abide': '<main id="home"><h1>Home</h1></main>',
    'about/index.abide': '<main id="about"><h1>About</h1></main>',
}

const SESSION = 'session=1; Path=/; HttpOnly; SameSite=Lax'

let app: Subprocess | undefined
let gateway: Server<undefined> | undefined
let provider: Server<undefined> | undefined
let base = ''
/** What the gateway refused, and how often the identity provider was asked. */
const said = { refused: [] as string[], signIns: 0 }

test.beforeAll(async ({}, testInfo) => {
    const served = await servedFixture(
        `e2e-offline-sign-in-${testInfo.project.name}`,
        FILES,
        { ABIDE_OFFLINE: '1' },
    )
    app = served.server
    provider = Bun.serve({
        port: 0,
        fetch(request) {
            said.signIns++
            const url = new URL(request.url)
            const back = url.searchParams.get('back') ?? '/'
            // SAML's `form_post`: the provider's page posts the session back to the app.
            if (url.searchParams.get('how') === 'post')
                return new Response(
                    `<form id="back" method="post" action="${base}/acs"><input name="back" value="${back}"></form><script>document.getElementById('back').submit()</script>`,
                    { headers: { 'content-type': 'text/html' } },
                )
            return Response.redirect(
                `${base}/callback?back=${encodeURIComponent(back)}`,
                302,
            )
        },
    })
    // ANOTHER ORIGIN, and another site: `127.0.0.1` against the app's `localhost`.
    const signIn = `http://127.0.0.1:${provider.port}`
    gateway = Bun.serve({
        port: 0,
        async fetch(request) {
            const url = new URL(request.url)
            if (url.pathname === '/callback')
                return new Response(null, {
                    status: 302,
                    headers: {
                        location: url.searchParams.get('back') ?? '/',
                        'set-cookie': SESSION,
                    },
                })
            if (url.pathname === '/acs' && request.method === 'POST')
                return new Response(null, {
                    status: 303,
                    headers: {
                        location: String(
                            (await request.formData()).get('back'),
                        ),
                        'set-cookie': SESSION,
                    },
                })
            if (!(request.headers.get('cookie') ?? '').includes('session=1')) {
                if (request.headers.get('sec-fetch-dest') === 'document')
                    return Response.redirect(
                        `${signIn}/authorize?back=${encodeURIComponent(url.pathname)}&how=${url.searchParams.get('how') ?? 'redirect'}`,
                        302,
                    )
                if (request.headers.get('sec-fetch-mode') === 'navigate')
                    said.refused.push(url.pathname)
                return new Response('unauthorized', { status: 401 })
            }
            const headers = new Headers(request.headers)
            headers.set('accept-encoding', 'identity')
            const answer = await fetch(
                `${served.base}${url.pathname}${url.search}`,
                {
                    method: request.method,
                    headers,
                    body: request.body,
                    redirect: 'manual',
                },
            )
            return new Response(answer.body, answer)
        },
    })
    base = `http://localhost:${gateway.port}`
})

test.afterAll(() => {
    app?.kill()
    gateway?.stop(true)
    provider?.stop(true)
})

/** Signs in, and waits until the worker controls the page and has saved it (45.13, 45.28). */
async function signedIn(page: Page): Promise<void> {
    await page.goto(base)
    await expect(page.locator('#home h1')).toHaveText('Home')
    await expect
        .poll(() =>
            page.evaluate(
                async () =>
                    navigator.serviceWorker.controller !== null &&
                    (await (
                        await caches.open('abide:saved')
                    ).match(location.href)) !== undefined,
            ),
        )
        .toBe(true)
}

/** Whether the browser holds the gateway's session cookie. */
async function session(page: Page): Promise<boolean> {
    return (await page.context().cookies(base)).some(
        (cookie) => cookie.name === 'session',
    )
}

test.beforeEach(() => {
    said.refused.length = 0
    said.signIns = 0
})

// 45.25 — A LAPSED SESSION IS SENT TO SIGN IN AND BACK, through the worker: the navigation it asks for
// is the browser's own preload, a page load the gateway redirects, and the provider's redirect back
// and the cookie it carries land as they would with no worker. THE REVERT: ask `fetch(request)` in
// place of `event.preloadResponse` in the worker's `opened`; the gateway refuses `/about` 401, and the
// page reads `unauthorized`.
test('a lapsed session is redirected to sign in and back through the worker — 45.25', async ({
    page,
    context,
}) => {
    await signedIn(page)
    await context.clearCookies({ name: 'session' })
    said.signIns = 0
    await page.goto(`${base}/about`)
    await expect(page.locator('#about h1')).toHaveText('About')
    expect({ ...said, session: await session(page) }).toEqual({
        refused: [],
        signIns: 1,
        session: true,
    })
})

// 45.25, 45.7 — AND BY A FORM THE PROVIDER POSTS BACK, SAML's `form_post`: a navigation that is not a
// `GET` is the browser's alone, and the redirect it answers is the preload's. THE REVERT: as above;
// the gateway refuses `/about` 401 once the form has landed.
test('a lapsed session signed in by a form posted back lands through the worker — 45.25', async ({
    page,
    context,
}) => {
    await signedIn(page)
    await context.clearCookies({ name: 'session' })
    said.signIns = 0
    await page.goto(`${base}/about?how=post`)
    await expect(page.locator('#about h1')).toHaveText('About')
    expect({ ...said, session: await session(page) }).toEqual({
        refused: [],
        signIns: 1,
        session: true,
    })
})

// 45.29 — A PAGE OPENED FROM ITS COPY WITH THE SESSION LAPSED IS SENT TO SIGN IN, on this load: the
// copy opens at once, the page asked for behind it is refused, and the window is opened again — now
// with no copy, so as the browser's own navigation, which the gateway redirects. THE REVERT: drop the
// `navigate` loop from the worker's `revalidated`; the copy stands, nobody is sent to sign in, and
// `signIns` reads 0.
test('a page opened from its copy with the session lapsed is sent to sign in — 45.29', async ({
    page,
    context,
}) => {
    await signedIn(page)
    await context.clearCookies({ name: 'session' })
    said.signIns = 0
    await page.goto(base)
    await expect.poll(() => session(page)).toBe(true)
    await expect(page.locator('#home h1')).toHaveText('Home')
    expect(said).toEqual({ refused: [], signIns: 1 })
})

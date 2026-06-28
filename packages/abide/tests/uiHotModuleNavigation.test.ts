import { describe, expect, test } from 'bun:test'
import { DEV_HOT_PREFIX } from '../src/lib/shared/DEV_HOT_PREFIX.ts'
import { bootTestServer } from './support/bootTestServer.ts'

/*
The hot-module endpoint serves `application/javascript` for the browser's `import()`.
A TOP-LEVEL NAVIGATION to it (clicking the module link in a stack trace, opening the
URL) would DOWNLOAD the file — browsers can't render JS as a document. A navigation
sends `Accept: text/html`; `import()` sends a wildcard Accept. The dev router catches
the navigation and 302s back to a real page so the error renders in context instead of
saving a file. `import()` is untouched.
*/
describe('hot-module endpoint: navigation vs import', () => {
    const hotUrl = (origin: string) => `${origin}${DEV_HOT_PREFIX}src/ui/Missing.abide?v=1`

    test('a navigation (Accept: text/html) redirects to the mount root with no referer', async () => {
        const { origin, stop } = await bootTestServer({ dev: true })
        try {
            const response = await fetch(hotUrl(origin), {
                headers: { Accept: 'text/html,application/xhtml+xml' },
                redirect: 'manual',
            })
            expect(response.status).toBe(302)
            expect(new URL(response.headers.get('location')!, origin).pathname).toBe('/')
        } finally {
            stop()
        }
    })

    test('a navigation with a same-origin referer redirects back to that page', async () => {
        const { origin, stop } = await bootTestServer({ dev: true })
        try {
            const response = await fetch(hotUrl(origin), {
                headers: { Accept: 'text/html', Referer: `${origin}/reference` },
                redirect: 'manual',
            })
            expect(response.status).toBe(302)
            expect(response.headers.get('location')).toBe(`${origin}/reference`)
        } finally {
            stop()
        }
    })

    test('a cross-origin referer is ignored — redirects to the root, not the foreign page', async () => {
        const { origin, stop } = await bootTestServer({ dev: true })
        try {
            const response = await fetch(hotUrl(origin), {
                headers: { Accept: 'text/html', Referer: 'http://evil.example/x' },
                redirect: 'manual',
            })
            expect(response.status).toBe(302)
            expect(new URL(response.headers.get('location')!, origin).pathname).toBe('/')
        } finally {
            stop()
        }
    })

    test('an import() fetch (wildcard Accept) is NOT redirected — reaches the compiler', async () => {
        const { origin, stop } = await bootTestServer({ dev: true })
        try {
            // A missing module reaches devHotModuleResponse and 404s; the point is it is
            // not a 302, proving import()s still resolve as JS rather than bouncing to a page.
            const response = await fetch(hotUrl(origin), {
                headers: { Accept: '*/*' },
                redirect: 'manual',
            })
            expect(response.status).not.toBe(302)
            expect(response.status).toBe(404)
        } finally {
            stop()
        }
    })
})

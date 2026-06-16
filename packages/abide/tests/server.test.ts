import { describe, expect, test } from 'bun:test'
import { server } from '../src/lib/server/server.ts'

describe('server', () => {
    /*
    No Bun.serve booted and no request scope: a genuine before-init misuse
    (module top-level / app.ts init). The in-process fallback is gated on the
    request scope, so it must not swallow this — keep throwing.
    */
    test('throws outside a request scope when no server has booted', () => {
        expect(() => server()).toThrow('called before init')
    })
})
